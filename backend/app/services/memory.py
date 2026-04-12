"""Memory service — CRUD + recent summary for the `memories` table.

Governed by:
  * docs/SERVICE_BACKEND.md §2.3
  * docs/DATA_SCHEMAS.md §5
  * docs/API_SPEC.md §4

Invariants (from DATA_SCHEMAS.md §5 CHECK constraints):
  * `source = 'conversation' -> transcript_id IS NOT NULL`
  * `source != 'conversation' -> created_by_user_id IS NOT NULL`

Content is 1–280 chars; caller is expected to pre-validate via pydantic.
IDs are returned as strings in `MemoryObject` to match API_SPEC §0.1.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from app.models import MemoryObject, iso_utc

# Matches DATA_SCHEMAS §5 and API_SPEC §4 — recent summary constants come
# from docs/PIPELINE.md §1.3 (3 rows, joined by " ", truncated to 280).
_RECENT_LIMIT = 3
_RECENT_MAX_CHARS = 280
# Hard cap for DB column on write-paths; pydantic also validates on inputs.
_CONTENT_MAX_CHARS = 280


# ---------------------------------------------------------------------------
# Row -> model
# ---------------------------------------------------------------------------


def _row_to_memory(row: sqlite3.Row | dict[str, Any]) -> MemoryObject:
    """Map a DB row to the canonical response shape (API_SPEC §4.1)."""
    # sqlite3.Row supports indexing by column name.
    created_by_user_id = row["created_by_user_id"]
    transcript_id = row["transcript_id"]
    return MemoryObject(
        memory_id=str(row["id"]),
        face_id=str(row["face_id"]),
        content=row["content"],
        source=row["source"],
        created_by_user_id=str(created_by_user_id) if created_by_user_id is not None else None,
        created_by_role=row["created_by_role"],
        transcript_id=str(transcript_id) if transcript_id is not None else None,
        created_at=iso_utc(row["created_at"]),
        updated_at=iso_utc(row["updated_at"]) if row["updated_at"] else None,
    )


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def list_memories(
    conn: sqlite3.Connection,
    face_id: int,
    limit: int = 50,
    before: str | None = None,
) -> list[MemoryObject]:
    """List memories newest-first for a face, optionally older than `before`.

    `before` is an ISO timestamp; when provided we return only rows with
    `created_at < before` (strict).
    """
    limit = max(1, min(limit, 200))
    if before:
        rows = conn.execute(
            """
            SELECT id, face_id, content, source, created_by_user_id,
                   created_by_role, transcript_id, created_at, updated_at
            FROM memories
            WHERE face_id = ? AND created_at < ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (face_id, before, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id, face_id, content, source, created_by_user_id,
                   created_by_role, transcript_id, created_at, updated_at
            FROM memories
            WHERE face_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (face_id, limit),
        ).fetchall()
    return [_row_to_memory(r) for r in rows]


def get_memory(conn: sqlite3.Connection, memory_id: int) -> MemoryObject | None:
    """Fetch a single memory or None if the id doesn't exist."""
    row = conn.execute(
        """
        SELECT id, face_id, content, source, created_by_user_id,
               created_by_role, transcript_id, created_at, updated_at
        FROM memories WHERE id = ?
        """,
        (memory_id,),
    ).fetchone()
    return _row_to_memory(row) if row else None


def memory_belongs_to_patient(
    conn: sqlite3.Connection, memory_id: int, patient_id: int
) -> bool:
    """True iff the memory's face belongs to `patient_id`."""
    row = conn.execute(
        """
        SELECT 1 FROM memories m
        JOIN faces f ON f.id = m.face_id
        WHERE m.id = ? AND f.patient_id = ?
        """,
        (memory_id, patient_id),
    ).fetchone()
    return row is not None


def create_memory(
    conn: sqlite3.Connection,
    face_id: int,
    content: str,
    source: str,
    created_by_user_id: int | None,
    created_by_role: str | None,
    transcript_id: int | None = None,
) -> MemoryObject:
    """Insert a memory and return the persisted object.

    The CHECK constraints in DATA_SCHEMAS §5 do the heavy lifting — this
    function merely trusts the inputs and surfaces `IntegrityError` from
    SQLite upward for the router to translate into the correct envelope.

    `content` is hard-trimmed to 280 chars to match `DATA_SCHEMAS §5`.
    """
    trimmed = content[:_CONTENT_MAX_CHARS]
    cur = conn.execute(
        """
        INSERT INTO memories (
            face_id, content, source, created_by_user_id, created_by_role,
            transcript_id
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (face_id, trimmed, source, created_by_user_id, created_by_role, transcript_id),
    )
    new_id = int(cur.lastrowid)
    out = get_memory(conn, new_id)
    assert out is not None, "just-inserted memory must be readable"
    return out


def update_memory_content(
    conn: sqlite3.Connection, memory_id: int, content: str
) -> MemoryObject:
    """Update `content` + `updated_at` on a memory. `source` never changes."""
    trimmed = content[:_CONTENT_MAX_CHARS]
    conn.execute(
        """
        UPDATE memories
        SET content = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (trimmed, memory_id),
    )
    out = get_memory(conn, memory_id)
    assert out is not None, "memory must still exist after UPDATE"
    return out


def delete_memory(conn: sqlite3.Connection, memory_id: int) -> None:
    """Delete a memory by id (no-op if already gone)."""
    conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))


def recent_memory_summary(
    conn: sqlite3.Connection,
    face_id: int,
    limit: int = _RECENT_LIMIT,
    max_chars: int = _RECENT_MAX_CHARS,
) -> str:
    """Build the recognition overlay summary: up to 3 newest memories.

    Per PIPELINE.md §1.3 step 30: `SELECT content ... ORDER BY created_at DESC
    LIMIT 3`, concatenate with a single space, truncate to 280 chars.
    """
    rows = conn.execute(
        """
        SELECT content FROM memories
        WHERE face_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        (face_id, limit),
    ).fetchall()
    joined = " ".join(r["content"] for r in rows)
    if len(joined) > max_chars:
        return joined[:max_chars]
    return joined
