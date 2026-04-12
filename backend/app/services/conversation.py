"""Conversation service — transcript ingestion + async memory extraction.

Governed by:
  * docs/SERVICE_BACKEND.md §2.4
  * docs/PIPELINE.md §2.2 / §2.3 / §2.4
  * docs/API_SPEC.md §6
  * docs/DATA_SCHEMAS.md §6

Flow:
  1. `submit_transcript` (sync, <100 ms): insert transcript row + side table
     rows in a single transaction; return the new id with status='queued'.
  2. `process_transcript` (async background): runs the LLM extraction and
     inserts derived memories, then invalidates the embedding cache so the
     next recognition call reloads.

Failure policy (PIPELINE §2.4): on ANY LLM or parse error, set
`status='failed'`, store `error_message`, do NOT insert any memory rows,
and do NOT retry.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from typing import Any

from app.db import open_connection
from app.models import ConversationDetailResponse, iso_utc
from app.services import cache as cache_service
from app.services import llm as llm_service
from app.services import memory as memory_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sync submission
# ---------------------------------------------------------------------------


def submit_transcript(
    conn: sqlite3.Connection,
    patient_id: int,
    transcript: str,
    recorded_at: str,
    duration_seconds: float,
    recognized_face_ids: list[int],
) -> int:
    """Insert transcript + recognized-faces rows atomically. Return new id.

    The router is responsible for authority, schema validation, and having
    pre-checked that every `recognized_face_ids` row belongs to this
    patient (otherwise the FK will reject insertion).
    """
    # Normalize recorded_at to canonical ISO 8601 UTC for storage.
    recorded_at_iso = iso_utc(recorded_at)
    try:
        conn.execute("BEGIN")
        cur = conn.execute(
            """
            INSERT INTO conversation_transcripts (
                patient_id, transcript, recorded_at, duration_seconds, status
            ) VALUES (?, ?, ?, ?, 'queued')
            """,
            (patient_id, transcript, recorded_at_iso, float(duration_seconds)),
        )
        transcript_id = int(cur.lastrowid)
        for face_id in recognized_face_ids:
            conn.execute(
                """
                INSERT INTO conversation_recognized_faces (transcript_id, face_id)
                VALUES (?, ?)
                """,
                (transcript_id, int(face_id)),
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return transcript_id


# ---------------------------------------------------------------------------
# Async processing
# ---------------------------------------------------------------------------


def _mark_status(
    conn: sqlite3.Connection,
    transcript_id: int,
    status: str,
    error_message: str | None = None,
    processed_at: bool = False,
) -> None:
    """Update `status` (+ optional `error_message` / `processed_at`)."""
    if processed_at:
        conn.execute(
            """
            UPDATE conversation_transcripts
            SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (status, error_message, transcript_id),
        )
    else:
        conn.execute(
            """
            UPDATE conversation_transcripts
            SET status = ?, error_message = ?
            WHERE id = ?
            """,
            (status, error_message, transcript_id),
        )


def _fetch_transcript_and_faces(
    conn: sqlite3.Connection, transcript_id: int
) -> tuple[sqlite3.Row | None, list[sqlite3.Row]]:
    """Return (transcript_row, [face_row, ...]) for this transcript."""
    transcript_row = conn.execute(
        """
        SELECT id, patient_id, transcript FROM conversation_transcripts
        WHERE id = ?
        """,
        (transcript_id,),
    ).fetchone()
    if transcript_row is None:
        return None, []
    face_rows = conn.execute(
        """
        SELECT f.id AS id, f.name AS name, f.title AS title
        FROM conversation_recognized_faces crf
        JOIN faces f ON f.id = crf.face_id
        WHERE crf.transcript_id = ?
        """,
        (transcript_id,),
    ).fetchall()
    return transcript_row, face_rows


async def process_transcript(transcript_id: int) -> None:
    """Background worker: run LLM, insert memories, update status.

    Opens its own DB connection because FastAPI request-scoped deps are gone
    by the time background tasks run. Any exception is caught and translated
    into `status='failed'` — we never let a background crash kill the app.
    """
    conn = open_connection()
    patient_id: int | None = None
    try:
        transcript_row, face_rows = _fetch_transcript_and_faces(conn, transcript_id)
        if transcript_row is None:
            logger.warning("process_transcript %s not found", transcript_id)
            return
        patient_id = int(transcript_row["patient_id"])

        # Enter the processing state before calling the LLM so status polling
        # reflects reality even if we hang for 15 s.
        _mark_status(conn, transcript_id, "processing")

        faces_payload = [
            {"face_id": int(r["id"]), "name": r["name"], "title": r["title"]}
            for r in face_rows
        ]
        transcript_text: str = transcript_row["transcript"]

        # Anthropic client is sync — offload to the default executor so we
        # don't block the event loop.
        loop = asyncio.get_running_loop()
        memories = await loop.run_in_executor(
            None, llm_service.summarize, transcript_text, faces_payload
        )

        # Insert every valid memory in a single transaction so either all or
        # none land — keeps the completed state consistent with memory rows.
        try:
            conn.execute("BEGIN")
            for m in memories:
                memory_service.create_memory(
                    conn,
                    face_id=int(m["face_id"]),
                    content=m["content"],
                    source="conversation",
                    created_by_user_id=None,
                    created_by_role=None,
                    transcript_id=transcript_id,
                )
            _mark_status(conn, transcript_id, "completed", processed_at=True)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    except llm_service.LlmError as exc:
        logger.warning("LLM failed for transcript %s: %s", transcript_id, exc)
        _mark_status(
            conn, transcript_id, "failed", error_message=str(exc), processed_at=True
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("process_transcript %s crashed", transcript_id)
        _mark_status(
            conn, transcript_id, "failed", error_message=str(exc), processed_at=True
        )
    finally:
        conn.close()
        if patient_id is not None:
            # Even on failure, invalidate — worst case, we redundantly reload
            # an unchanged cache. On success we want WS sessions to see new
            # memory-driven summaries next cycle.
            cache_service.invalidate(patient_id)


# ---------------------------------------------------------------------------
# Read path (used by GET /api/conversations/{id})
# ---------------------------------------------------------------------------


def get_transcript(
    conn: sqlite3.Connection, transcript_id: int
) -> ConversationDetailResponse | None:
    """Build the `ConversationDetailResponse` shape for a single transcript."""
    row = conn.execute(
        """
        SELECT id, patient_id, status, processed_at
        FROM conversation_transcripts WHERE id = ?
        """,
        (transcript_id,),
    ).fetchone()
    if row is None:
        return None
    memory_rows = conn.execute(
        """
        SELECT id FROM memories WHERE transcript_id = ? ORDER BY id ASC
        """,
        (transcript_id,),
    ).fetchall()
    processed_at = row["processed_at"]
    return ConversationDetailResponse(
        transcript_id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        status=row["status"],
        processed_at=iso_utc(processed_at) if processed_at else None,
        derived_memory_ids=[str(m["id"]) for m in memory_rows],
    )


def transcript_belongs_to_patient(
    conn: sqlite3.Connection, transcript_id: int, patient_id: int
) -> bool:
    """Check ownership — used by the router's authority guards."""
    row = conn.execute(
        "SELECT 1 FROM conversation_transcripts WHERE id = ? AND patient_id = ?",
        (transcript_id, patient_id),
    ).fetchone()
    return row is not None


def faces_all_belong_to_patient(
    conn: sqlite3.Connection, face_ids: list[int], patient_id: int
) -> bool:
    """Bulk ownership check for `recognized_face_ids` at submission time."""
    if not face_ids:
        return True
    # sqlite3 doesn't expand IN for parameter lists; build the placeholder list.
    placeholders = ",".join(["?"] * len(face_ids))
    rows = conn.execute(
        f"SELECT id FROM faces WHERE patient_id = ? AND id IN ({placeholders})",  # noqa: S608 — placeholders only
        (patient_id, *face_ids),
    ).fetchall()
    return len(rows) == len(set(face_ids))
