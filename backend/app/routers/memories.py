"""Memories router — per-face CRUD (API_SPEC §4).

Endpoints:
  * GET    /api/faces/{id}/memories    — paginated list (newest first)
  * POST   /api/faces/{id}/memories    — create manual/caretaker memory
  * PATCH  /api/memories/{id}          — edit content (only content is mutable)
  * DELETE /api/memories/{id}          — remove memory

Source rules (API_SPEC §0.4, §4.2):
  * `POST` never accepts `source="conversation"` — those land via the
    conversation ingest pipeline.
  * Patient caller must declare `source="manual"`; caretaker must declare
    `source="caretaker"`. Mismatch → 422 SEMANTIC_ERROR.
  * `PATCH/DELETE`: patient may only act on their own `manual` memories;
    caretaker may act on ANY memory on an assigned patient's face.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Path, Query, status

from app.deps import get_auth, get_db, http_error
from app.models import (
    MemoryCreateRequest,
    MemoryListResponse,
    MemoryObject,
    MemoryPatchRequest,
)
from app.ratelimit import default_limiter, make_key
from app.routers._authz import ensure_patient_or_caretaker_of, parse_id
from app.services import memory as memory_service
from app.services.auth import AuthContext

router = APIRouter()


def _check_write_limit(user_id: int) -> None:
    if not default_limiter.check(make_key(user_id, "write"), 120, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Write rate limit exceeded (120/min)",
        )


def _face_patient_id(conn: sqlite3.Connection, face_id: int) -> int | None:
    """Return the face's owning patient_id, or None if the face doesn't exist."""
    row = conn.execute(
        "SELECT patient_id FROM faces WHERE id = ?", (face_id,)
    ).fetchone()
    return int(row["patient_id"]) if row else None


def _memory_row(conn: sqlite3.Connection, memory_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT m.id AS id, m.face_id AS face_id, m.source AS source,
               m.created_by_user_id AS created_by_user_id,
               m.created_by_role AS created_by_role,
               f.patient_id AS patient_id
        FROM memories m JOIN faces f ON f.id = m.face_id
        WHERE m.id = ?
        """,
        (memory_id,),
    ).fetchone()


# ---------------------------------------------------------------------------
# §4.1 GET /api/faces/{id}/memories
# ---------------------------------------------------------------------------


@router.get("/faces/{face_id}/memories", response_model=MemoryListResponse)
def list_memories(
    face_id: str = Path(...),
    limit: int = Query(50, ge=1, le=200),
    before: str | None = Query(None),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> MemoryListResponse:
    """List memories newest-first for a face, optionally filtered `created_at < before`."""
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    patient_id = _face_patient_id(db, fid)
    if patient_id is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    memories = memory_service.list_memories(db, fid, limit=limit, before=before)
    # `has_more` is a best-effort: if we got exactly `limit` rows there might
    # be more. Clients can paginate via `before=memories[-1].created_at`.
    return MemoryListResponse(memories=memories, has_more=len(memories) >= limit)


# ---------------------------------------------------------------------------
# §4.2 POST /api/faces/{id}/memories
# ---------------------------------------------------------------------------


@router.post(
    "/faces/{face_id}/memories",
    response_model=MemoryObject,
    status_code=status.HTTP_201_CREATED,
)
def create_memory(
    payload: MemoryCreateRequest,
    face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> MemoryObject:
    """Create a `manual` (patient) or `caretaker` memory on a face.

    `source` must agree with the caller's role (API_SPEC §0.4 matrix).
    `source="conversation"` is rejected at the pydantic layer already;
    any sneak-past here would hit the role-mismatch branch.
    """
    fid = parse_id(face_id, code="FACE_NOT_FOUND", message="Face not found")
    _check_write_limit(auth.user_id)

    patient_id = _face_patient_id(db, fid)
    if patient_id is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "FACE_NOT_FOUND",
            "Face not found",
            {"face_id": face_id},
        )
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    # Extra defensive check — the model already excludes "conversation".
    if payload.source == "conversation":  # type: ignore[comparison-overlap]
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "conversation memories must be created via POST /api/conversations",
        )

    if auth.role == "patient" and payload.source != "manual":
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "Patients may only create memories with source='manual'",
            {"source": payload.source},
        )
    if auth.role == "caretaker" and payload.source != "caretaker":
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "Caretakers may only create memories with source='caretaker'",
            {"source": payload.source},
        )

    memory = memory_service.create_memory(
        db,
        face_id=fid,
        content=payload.content.strip(),
        source=payload.source,
        created_by_user_id=auth.user_id,
        created_by_role=auth.role,
        transcript_id=None,
    )
    return memory


# ---------------------------------------------------------------------------
# §4.3 PATCH /api/memories/{id}
# ---------------------------------------------------------------------------


@router.patch("/memories/{memory_id}", response_model=MemoryObject)
def update_memory(
    payload: MemoryPatchRequest,
    memory_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> MemoryObject:
    """Edit a memory's content. Source is immutable (API_SPEC §4.3).

    Authority:
      * Patient: only their own `manual` memories (matches on
        `created_by_user_id` + `source='manual'`).
      * Caretaker: any memory on an assigned patient's face.
    """
    mid = parse_id(memory_id, code="MEMORY_NOT_FOUND", message="Memory not found")
    _check_write_limit(auth.user_id)

    row = _memory_row(db, mid)
    if row is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "MEMORY_NOT_FOUND",
            "Memory not found",
            {"memory_id": memory_id},
        )
    patient_id = int(row["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    if auth.role == "patient":
        if row["source"] != "manual" or int(row["created_by_user_id"] or 0) != auth.user_id:
            raise http_error(
                status.HTTP_403_FORBIDDEN,
                "FORBIDDEN",
                "Patient may only edit their own manual memories",
                {"memory_id": memory_id},
            )
    # Caretakers have already passed the authority check; they may edit any
    # source on an assigned patient (per API_SPEC §4.3).

    return memory_service.update_memory_content(db, mid, payload.content.strip())


# ---------------------------------------------------------------------------
# §4.4 DELETE /api/memories/{id}
# ---------------------------------------------------------------------------


@router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    memory_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> None:
    """Delete a memory. Same authority rules as PATCH."""
    mid = parse_id(memory_id, code="MEMORY_NOT_FOUND", message="Memory not found")
    _check_write_limit(auth.user_id)

    row = _memory_row(db, mid)
    if row is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "MEMORY_NOT_FOUND",
            "Memory not found",
            {"memory_id": memory_id},
        )
    patient_id = int(row["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    if auth.role == "patient":
        if row["source"] != "manual" or int(row["created_by_user_id"] or 0) != auth.user_id:
            raise http_error(
                status.HTTP_403_FORBIDDEN,
                "FORBIDDEN",
                "Patient may only delete their own manual memories",
                {"memory_id": memory_id},
            )

    memory_service.delete_memory(db, mid)
    return None
