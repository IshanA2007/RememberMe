"""Pending faces service — server-persisted queue of unknown embeddings.

Governed by:
  * docs/API_SPEC.md §3b
  * docs/DATA_SCHEMAS.md §7b
  * docs/PIPELINE.md §1.6 (flow) + §1.7 (lifecycle)
  * CLAUDE.md §5 (RECOGNITION_THRESHOLD=0.50, RECOGNITION_MARGIN=0.05,
    embedding dim=512 / float32)

Flow (submit):
  1. Validate embedding (len 512, finite) + thumbnail (≤50 KB decoded) + mime.
  2. Refresh the patient's registered-face cache.
  3. If the submission matches a registered face (cosine ≥ 0.50 AND margin
     ≥ 0.05), return `already_known=true` with the matched `face_id`;
     create nothing.
  4. Else dedupe against existing pending_faces for this patient: if any row
     has cosine similarity ≥ 0.85, update that row in place (embedding +
     thumbnail + captured_at + updated_at) and return `merged=true`.
  5. Else insert a new row and return it with `merged=false, already_known=false`.

Embeddings are always L2-normalized before storage so cosine similarity
reduces to a dot product on read (matching `cache.load_embeddings_from_db`).
"""

from __future__ import annotations

import base64
import logging
import math
import sqlite3
import struct
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from app.models import iso_utc
from app.services import cache as cache_service
from app.services.recognition import cosine_match

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np

log = logging.getLogger(__name__)

# DATA_SCHEMAS §4: embedding is 512 × float32 LE = 2048 bytes.
_EMBED_DIM = 512
_EMBED_BYTES = _EMBED_DIM * 4

# PIPELINE.md §1.6 / DATA_SCHEMAS §7b: in-queue dedupe threshold.
DEDUPE_THRESHOLD = 0.85
# CLAUDE.md §5 constants for the already-registered match check.
KNOWN_THRESHOLD = 0.50
KNOWN_MARGIN = 0.05

# API_SPEC §3b.1: thumbnail cap (≤ 50 KB decoded).
MAX_THUMB_BYTES = 50 * 1024


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _pack_embedding(vec: "np.ndarray") -> bytes:
    """Serialize a 512-element float32 array to a 2048-byte LE blob."""
    import numpy as np  # deferred

    a = np.asarray(vec, dtype=np.float32).reshape(-1)
    if a.shape[0] != _EMBED_DIM:
        raise ValueError(f"embedding must be {_EMBED_DIM}-d, got {a.shape[0]}")
    return a.astype("<f4").tobytes()


def _unpack_embedding(blob: bytes) -> "np.ndarray":
    """Deserialize a 2048-byte LE blob to a float32 array."""
    import numpy as np  # deferred

    return np.frombuffer(blob, dtype="<f4").astype(np.float32, copy=True)


def _iso_utc_now() -> str:
    """Canonical ISO 8601 UTC with trailing Z, second-precision."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_to_item(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    """Map a pending_faces row to the list-view JSON shape (API_SPEC §3b.2)."""
    return {
        "pending_face_id": str(row["id"]),
        "patient_id": str(row["patient_id"]),
        "thumbnail_b64": row["thumbnail_b64"],
        "thumbnail_mime": row["thumbnail_mime"],
        "captured_at": iso_utc(row["captured_at"]),
        "created_at": iso_utc(row["created_at"]),
        "updated_at": iso_utc(row["updated_at"]),
    }


def _validate_embedding(embedding: list[float]) -> "np.ndarray":
    """Return an L2-normalized float32 array; raises ValueError on bad input."""
    import numpy as np  # deferred

    if len(embedding) != _EMBED_DIM:
        raise ValueError(
            f"embedding must have exactly {_EMBED_DIM} floats (got {len(embedding)})"
        )
    for v in embedding:
        if not isinstance(v, (int, float)) or not math.isfinite(float(v)):
            raise ValueError("embedding must contain only finite numbers")
    arr = np.asarray(embedding, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm > 1e-9:
        arr = arr / norm
    return arr.astype(np.float32, copy=False)


def _validate_thumbnail(thumbnail_b64: str, thumbnail_mime: str) -> None:
    """Decode + enforce size + mime; raises ValueError on any failure."""
    if thumbnail_mime not in ("image/jpeg", "image/png"):
        raise ValueError("thumbnail_mime must be image/jpeg or image/png")
    try:
        raw = base64.b64decode(thumbnail_b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("thumbnail_b64 must be valid base64") from exc
    if len(raw) > MAX_THUMB_BYTES:
        raise ValueError(
            f"thumbnail exceeds {MAX_THUMB_BYTES} bytes decoded (got {len(raw)})"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def submit_pending_face(
    conn: sqlite3.Connection,
    patient_id: int,
    embedding: list[float],
    thumbnail_b64: str,
    thumbnail_mime: str,
    captured_at: str,
) -> dict[str, Any]:
    """Submit an unknown embedding; returns the response dict (API_SPEC §3b.1).

    The returned dict is directly serializable as `PendingFaceObject`, with
    `merged` / `already_known` / `face_id` / `pending_face_id` set according
    to which of the three branches fired:

      * already_known=true  — matches a registered face; no row touched.
      * merged=true         — near-duplicate of an existing pending row; updated.
      * neither             — new row inserted.

    Raises:
        ValueError — validation failure (caller translates to 422 SEMANTIC_ERROR
        or 413 PAYLOAD_TOO_LARGE depending on the message).
    """
    import numpy as np  # deferred

    # --- (0) validate the inputs up front. ---
    _validate_thumbnail(thumbnail_b64, thumbnail_mime)
    q = _validate_embedding(embedding)

    # --- (a) already-known check against registered faces. ---
    # The cache service treats any callable as a factory it owns + closes; we
    # therefore pass `app.db.open_connection` rather than the request's live
    # `conn` (sqlite3.Connection is itself callable, and passing `lambda: conn`
    # would let the service close our request-scoped connection out from under
    # the pending-faces write below).
    from app.db import open_connection

    await cache_service.refresh_if_stale(
        patient_id, conn_factory=open_connection
    )
    cache = await cache_service.get_cache(patient_id)
    best, best_sim, second_sim = cosine_match(q, cache.entries)
    if (
        best is not None
        and best_sim >= KNOWN_THRESHOLD
        and (best_sim - second_sim) >= KNOWN_MARGIN
    ):
        now = _iso_utc_now()
        return {
            "pending_face_id": None,
            "patient_id": str(patient_id),
            "thumbnail_b64": thumbnail_b64,
            "thumbnail_mime": thumbnail_mime,
            "captured_at": captured_at,
            "created_at": now,
            "updated_at": now,
            "merged": False,
            "already_known": True,
            "face_id": str(best.face_id),
        }

    # --- (b) dedupe against existing pending rows. ---
    pending_rows = conn.execute(
        """
        SELECT id, patient_id, embedding, thumbnail_b64, thumbnail_mime,
               captured_at, created_at, updated_at
        FROM pending_faces
        WHERE patient_id = ?
        ORDER BY updated_at DESC
        """,
        (patient_id,),
    ).fetchall()
    for row in pending_rows:
        blob: bytes = row["embedding"]
        if blob is None or len(blob) != _EMBED_BYTES:
            # Defensive: skip malformed rows instead of exploding.
            continue
        existing = _unpack_embedding(blob)
        # Existing embeddings are stored L2-normalized; q is too → dot == cosine.
        sim = float(np.dot(q, existing))
        if sim >= DEDUPE_THRESHOLD:
            now = _iso_utc_now()
            conn.execute(
                """
                UPDATE pending_faces
                SET embedding = ?, thumbnail_b64 = ?, thumbnail_mime = ?,
                    captured_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    _pack_embedding(q),
                    thumbnail_b64,
                    thumbnail_mime,
                    captured_at,
                    now,
                    row["id"],
                ),
            )
            merged_row = conn.execute(
                """
                SELECT id, patient_id, thumbnail_b64, thumbnail_mime,
                       captured_at, created_at, updated_at
                FROM pending_faces WHERE id = ?
                """,
                (row["id"],),
            ).fetchone()
            assert merged_row is not None
            out = _row_to_item(merged_row)
            out["merged"] = True
            out["already_known"] = False
            out["face_id"] = None
            return out

    # --- (c) insert new. ---
    now = _iso_utc_now()
    cur = conn.execute(
        """
        INSERT INTO pending_faces (
            patient_id, embedding, thumbnail_b64, thumbnail_mime,
            captured_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            patient_id,
            _pack_embedding(q),
            thumbnail_b64,
            thumbnail_mime,
            captured_at,
            now,
            now,
        ),
    )
    new_id = int(cur.lastrowid)
    row = conn.execute(
        """
        SELECT id, patient_id, thumbnail_b64, thumbnail_mime,
               captured_at, created_at, updated_at
        FROM pending_faces WHERE id = ?
        """,
        (new_id,),
    ).fetchone()
    assert row is not None
    out = _row_to_item(row)
    out["merged"] = False
    out["already_known"] = False
    out["face_id"] = None
    return out


def list_pending_faces(
    conn: sqlite3.Connection, patient_id: int, limit: int = 50
) -> list[dict[str, Any]]:
    """List pending faces for a patient newest-first (API_SPEC §3b.2)."""
    rows = conn.execute(
        """
        SELECT id, patient_id, thumbnail_b64, thumbnail_mime,
               captured_at, created_at, updated_at
        FROM pending_faces
        WHERE patient_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (patient_id, limit),
    ).fetchall()
    return [_row_to_item(r) for r in rows]


def get_pending_face(
    conn: sqlite3.Connection, pending_face_id: int
) -> sqlite3.Row | None:
    """Fetch the full pending_faces row (including embedding) by id."""
    return conn.execute(
        """
        SELECT id, patient_id, embedding, thumbnail_b64, thumbnail_mime,
               captured_at, created_at, updated_at
        FROM pending_faces WHERE id = ?
        """,
        (pending_face_id,),
    ).fetchone()


def accept_pending_face(
    conn: sqlite3.Connection,
    pending_face_id: int,
    name: str,
    title: str | None,
    description: str | None,
) -> dict[str, Any]:
    """Atomically promote a pending row to a `faces` row and delete the pending row.

    Returns the new face as a dict matching API_SPEC §3.1 (FaceObject).

    Raises:
        LookupError — pending_face_id not found.
        ValueError("duplicate_name") — a face with this name already exists for
            the owning patient (case-insensitive).
    """
    row = get_pending_face(conn, pending_face_id)
    if row is None:
        raise LookupError("pending face not found")
    patient_id = int(row["patient_id"])
    embedding_blob = row["embedding"]

    # Case-insensitive name uniqueness inside the owning patient.
    exists = conn.execute(
        "SELECT id FROM faces WHERE patient_id = ? AND lower(name) = lower(?)",
        (patient_id, name),
    ).fetchone()
    if exists is not None:
        raise ValueError("duplicate_name")

    # Use `with conn:` so both writes land atomically; SQLite commits on exit,
    # rolls back on exception.
    with conn:
        cur = conn.execute(
            """
            INSERT INTO faces (
                patient_id, name, title, description, embedding
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (patient_id, name.strip(), title, description, embedding_blob),
        )
        face_id = int(cur.lastrowid)
        conn.execute("DELETE FROM pending_faces WHERE id = ?", (pending_face_id,))

    # Invalidate so the WS cache reloads the new embedding on the next tick.
    cache_service.invalidate(patient_id)

    face_row = conn.execute(
        """
        SELECT id, patient_id, name, title, description, embedding,
               created_at, updated_at
        FROM faces WHERE id = ?
        """,
        (face_id,),
    ).fetchone()
    assert face_row is not None
    return {
        "face_id": str(face_row["id"]),
        "patient_id": str(face_row["patient_id"]),
        "name": face_row["name"],
        "title": face_row["title"],
        "description": face_row["description"],
        "has_embedding": face_row["embedding"] is not None,
        "created_at": iso_utc(face_row["created_at"]),
        "updated_at": iso_utc(face_row["updated_at"]),
    }


def delete_pending_face(
    conn: sqlite3.Connection, pending_face_id: int
) -> bool:
    """Remove a pending row; returns True iff a row was deleted."""
    cur = conn.execute(
        "DELETE FROM pending_faces WHERE id = ?", (pending_face_id,)
    )
    return cur.rowcount > 0
