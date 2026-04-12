"""Faces router — face registry CRUD (API_SPEC §3).

Endpoints:
  * GET    /api/patients/{id}/faces        — list faces for a patient
  * POST   /api/patients/{id}/faces        — create a face (Dashboard or Vision mode)
  * PATCH  /api/faces/{id}                 — edit name/title/description
  * DELETE /api/faces/{id}                 — remove face (cascades memories)
  * POST   /api/faces/{id}/embedding       — set/replace the 512-float embedding

Embedding storage (DATA_SCHEMAS §4):
  * Stored as a BLOB of exactly 2048 bytes (512 × float32 little-endian).
  * L2-normalization is done by `cache.load_embeddings_from_db` on read, so
    the write path just serializes the raw floats to ensure bit-exact
    round-trip. (Re-normalizing on write would lose precision.)
"""

from __future__ import annotations

import sqlite3
import struct
from typing import Any

from fastapi import APIRouter, Depends, Path, Response, status

from app.deps import get_auth, get_db, http_error
from app.models import (
    FaceCreateRequest,
    FaceEmbeddingRequest,
    FaceListResponse,
    FaceObject,
    FacePatchRequest,
    iso_utc,
)
from app.ratelimit import default_limiter, make_key
from app.routers._authz import (
    ensure_patient_or_caretaker_of,
    parse_id,
)
from app.services import cache as cache_service
from app.services.auth import AuthContext

router = APIRouter()

_EMBED_DIM = 512
_EMBED_BYTES = _EMBED_DIM * 4  # float32 LE


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _row_to_face(row: sqlite3.Row | dict[str, Any]) -> FaceObject:
    """Map a `faces` row to the canonical shape (API_SPEC §3.1)."""
    has_embedding = row["embedding"] is not None
    return FaceObject(
        face_id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        name=row["name"],
        title=row["title"],
        description=row["description"],
        has_embedding=has_embedding,
        created_at=iso_utc(row["created_at"]),
        updated_at=iso_utc(row["updated_at"]),
    )


def _serialize_embedding(embedding: list[float]) -> bytes:
    """Validate + pack a 512-float embedding into a 2048-byte little-endian BLOB.

    Raises `HTTPException(422)` on wrong length or non-finite values.
    """
    import math

    if len(embedding) != _EMBED_DIM:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            f"embedding must have exactly {_EMBED_DIM} floats",
            {"got": len(embedding), "expected": _EMBED_DIM},
        )
    for v in embedding:
        if not isinstance(v, (int, float)) or not math.isfinite(float(v)):
            raise http_error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "SEMANTIC_ERROR",
                "embedding must contain only finite numbers",
            )
    # struct is deterministic LE float32; sidesteps the numpy dep for writes.
    return struct.pack(f"<{_EMBED_DIM}f", *[float(v) for v in embedding])


def _fetch_face(conn: sqlite3.Connection, face_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, patient_id, name, title, description, embedding,
               created_at, updated_at
        FROM faces WHERE id = ?
        """,
        (face_id,),
    ).fetchone()


def _check_write_limit(user_id: int) -> None:
    if not default_limiter.check(make_key(user_id, "write"), 120, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Write rate limit exceeded (120/min)",
        )


# ---------------------------------------------------------------------------
# §3.1 GET /api/patients/{id}/faces
# ---------------------------------------------------------------------------


@router.get("/patients/{patient_id}/faces", response_model=FaceListResponse)
def list_faces(
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> FaceListResponse:
    """List faces registered for a patient."""
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)

    rows = db.execute(
        """
        SELECT id, patient_id, name, title, description, embedding,
               created_at, updated_at
        FROM faces
        WHERE patient_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (pid,),
    ).fetchall()
    return FaceListResponse(faces=[_row_to_face(r) for r in rows])


# ---------------------------------------------------------------------------
# §3.2 POST /api/patients/{id}/faces
# ---------------------------------------------------------------------------


@router.post(
    "/patients/{patient_id}/faces",
    response_model=FaceObject,
    status_code=status.HTTP_201_CREATED,
)
def create_face(
    payload: FaceCreateRequest,
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> FaceObject:
    """Create a face in Dashboard mode (no embedding) or Vision mode (embedding).

    Uniqueness: `(patient_id, lower(name))` — 409 CONFLICT on collision.
    """
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)
    _check_write_limit(auth.user_id)

    embedding_blob: bytes | None = None
    if payload.embedding is not None:
        embedding_blob = _serialize_embedding(payload.embedding)

    try:
        cur = db.execute(
            """
            INSERT INTO faces (patient_id, name, title, description, embedding)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                pid,
                payload.name.strip(),
                payload.title,
                payload.description,
                embedding_blob,
            ),
        )
    except sqlite3.IntegrityError as exc:
        # Unique index (patient_id, lower(name)) — per API_SPEC §3.2 -> 409.
        raise http_error(
            status.HTTP_409_CONFLICT,
            "CONFLICT",
            "A face with this name already exists for the patient",
            {"patient_id": patient_id, "name": payload.name},
        ) from exc

    new_id = int(cur.lastrowid)
    row = _fetch_face(db, new_id)
    assert row is not None
    # Invalidate cache so WS sessions rebuild on next frame.
    cache_service.invalidate(pid)
    return _row_to_face(row)


# ---------------------------------------------------------------------------
# §3.3 PATCH /api/faces/{id}
# ---------------------------------------------------------------------------


@router.patch("/faces/{face_id}", response_model=FaceObject)
def update_face(
    payload: FacePatchRequest,
    face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> FaceObject:
    """Partial update of name/title/description. `updated_at` bumps on any change."""
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    _check_write_limit(auth.user_id)

    existing = _fetch_face(db, fid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    ensure_patient_or_caretaker_of(db, auth, int(existing["patient_id"]))

    # Build the UPDATE set clause dynamically from the set fields only.
    sets: list[str] = []
    params: list[Any] = []
    if payload.name is not None:
        sets.append("name = ?")
        params.append(payload.name.strip())
    if payload.title is not None:
        sets.append("title = ?")
        params.append(payload.title)
    if payload.description is not None:
        sets.append("description = ?")
        params.append(payload.description)
    if not sets:
        # No-op PATCH: return the existing row unchanged.
        return _row_to_face(existing)
    sets.append("updated_at = CURRENT_TIMESTAMP")
    params.append(fid)

    try:
        db.execute(
            f"UPDATE faces SET {', '.join(sets)} WHERE id = ?",  # noqa: S608 — fixed whitelist
            params,
        )
    except sqlite3.IntegrityError as exc:
        raise http_error(
            status.HTTP_409_CONFLICT,
            "CONFLICT",
            "A face with this name already exists for the patient",
            {"face_id": face_id},
        ) from exc

    row = _fetch_face(db, fid)
    assert row is not None
    cache_service.invalidate(int(row["patient_id"]))
    return _row_to_face(row)


# ---------------------------------------------------------------------------
# §3.5 DELETE /api/faces/{id}
# ---------------------------------------------------------------------------


@router.delete(
    "/faces/{face_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_face(
    face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """Remove a face. Memories cascade via FK ON DELETE CASCADE."""
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    _check_write_limit(auth.user_id)

    existing = _fetch_face(db, fid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    patient_id = int(existing["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    db.execute("DELETE FROM faces WHERE id = ?", (fid,))
    cache_service.invalidate(patient_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# §3.4 POST /api/faces/{id}/embedding
# ---------------------------------------------------------------------------


@router.post("/faces/{face_id}/embedding", response_model=FaceObject)
def set_face_embedding(
    payload: FaceEmbeddingRequest,
    face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> FaceObject:
    """Attach or replace a face's embedding. Used when Vision finally sees a
    caretaker-pre-registered face for the first time.
    """
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    _check_write_limit(auth.user_id)

    existing = _fetch_face(db, fid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    patient_id = int(existing["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    blob = _serialize_embedding(payload.embedding)
    db.execute(
        """
        UPDATE faces
        SET embedding = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (blob, fid),
    )
    row = _fetch_face(db, fid)
    assert row is not None
    cache_service.invalidate(patient_id)
    return _row_to_face(row)


# ---------------------------------------------------------------------------
# §3.6 DELETE /api/faces/{id}/embedding — clear face scan, keep the row
# ---------------------------------------------------------------------------


@router.delete("/faces/{face_id}/embedding", response_model=FaceObject)
def clear_face_embedding(
    face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> FaceObject:
    """Clear the stored face scan without touching name/title/description/memories.

    After this call the face row still exists and its memories are preserved,
    but `has_embedding` is `false` and Vision will treat the person as unknown
    on the next sighting — producing a fresh pending_faces entry for
    re-registration. Use this when the stored embedding is stale (lighting,
    haircut, glasses, camera, etc.).
    """
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    _check_write_limit(auth.user_id)

    existing = _fetch_face(db, fid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    patient_id = int(existing["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    db.execute(
        """
        UPDATE faces
        SET embedding = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (fid,),
    )
    row = _fetch_face(db, fid)
    assert row is not None
    cache_service.invalidate(patient_id)
    return _row_to_face(row)
