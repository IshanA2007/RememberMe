"""Hackathon seed fixtures — idempotent.

Mirrors `docs/DATA_SCHEMAS.md §10`. Safe to run repeatedly: every INSERT is
guarded by an existence check on the natural key we care about.

Identity mapping for `BACKEND_DEV_AUTH_BYPASS` tokens:
  * Patient token `dev-patient-1-Alice`   -> sub `auth0|dev-patient-1`
  * Caretaker token `dev-caretaker-1-Carol` -> sub `auth0|dev-caretaker-1`

The seed writes those subs so the dev-bypass flow resolves to real rows
without needing `/api/auth/register` first.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import open_connection
from app.models import iso_utc

log = logging.getLogger(__name__)

# Natural-key constants for seeded fixtures. Keep in one place so tests can
# reuse them without duplicating magic strings.
PATIENT_SUB = "auth0|dev-patient-1"
CARETAKER_SUB = "auth0|dev-caretaker-1"


def _exists(conn: Any, sql: str, params: tuple) -> bool:
    row = conn.execute(sql, params).fetchone()
    return row is not None


def _future_iso(offset_minutes: int = 10) -> str:
    """ISO 8601 UTC timestamp `now + offset_minutes` (default 10 min)."""
    when = datetime.now(timezone.utc) + timedelta(minutes=offset_minutes)
    return iso_utc(when)


def run() -> None:
    """Insert fixture rows if not already present. Runs in a transaction."""
    conn = open_connection()
    try:
        conn.execute("BEGIN")

        # --- patient ---------------------------------------------------------
        patient_row = conn.execute(
            "SELECT id FROM patients WHERE auth0_sub = ?", (PATIENT_SUB,)
        ).fetchone()
        if patient_row is None:
            cur = conn.execute(
                """
                INSERT INTO patients (auth0_sub, display_name, email)
                VALUES (?, ?, ?)
                """,
                (PATIENT_SUB, "Alice Patient", "alice@demo.test"),
            )
            patient_id = int(cur.lastrowid)
        else:
            patient_id = int(patient_row["id"])

        # --- caretaker -------------------------------------------------------
        caretaker_row = conn.execute(
            "SELECT id FROM caretakers WHERE auth0_sub = ?", (CARETAKER_SUB,)
        ).fetchone()
        if caretaker_row is None:
            cur = conn.execute(
                """
                INSERT INTO caretakers (auth0_sub, display_name, email)
                VALUES (?, ?, ?)
                """,
                (CARETAKER_SUB, "Carol Caretaker", "carol@demo.test"),
            )
            caretaker_id = int(cur.lastrowid)
        else:
            caretaker_id = int(caretaker_row["id"])

        # --- patient_caretakers link -----------------------------------------
        if not _exists(
            conn,
            "SELECT 1 FROM patient_caretakers WHERE patient_id = ? AND caretaker_id = ?",
            (patient_id, caretaker_id),
        ):
            conn.execute(
                """
                INSERT INTO patient_caretakers (patient_id, caretaker_id)
                VALUES (?, ?)
                """,
                (patient_id, caretaker_id),
            )

        # --- seed face (no embedding — caretaker-pre-registered) -------------
        face_row = conn.execute(
            "SELECT id FROM faces WHERE patient_id = ? AND lower(name) = lower(?)",
            (patient_id, "Sarah"),
        ).fetchone()
        if face_row is None:
            cur = conn.execute(
                """
                INSERT INTO faces (patient_id, name, title, description, embedding)
                VALUES (?, ?, ?, ?, NULL)
                """,
                (patient_id, "Sarah", "daughter", "Lives in Seattle."),
            )
            face_id = int(cur.lastrowid)
        else:
            face_id = int(face_row["id"])

        # --- seed memory (caretaker-authored) --------------------------------
        memory_row = conn.execute(
            """
            SELECT id FROM memories
            WHERE face_id = ? AND source = 'caretaker' AND content = ?
            """,
            (face_id, "Works as a nurse."),
        ).fetchone()
        if memory_row is None:
            conn.execute(
                """
                INSERT INTO memories (
                    face_id, content, source, created_by_user_id,
                    created_by_role, transcript_id
                ) VALUES (?, ?, 'caretaker', ?, 'caretaker', NULL)
                """,
                (face_id, "Works as a nurse.", caretaker_id),
            )

        # --- seed reminder (future trigger so `upcoming` can surface it) ----
        reminder_row = conn.execute(
            "SELECT id FROM reminders WHERE patient_id = ? AND title = ?",
            (patient_id, "Take medication"),
        ).fetchone()
        if reminder_row is None:
            conn.execute(
                """
                INSERT INTO reminders (
                    patient_id, title, description, trigger_at,
                    created_by_user_id, created_by_role
                ) VALUES (?, ?, ?, ?, ?, 'caretaker')
                """,
                (
                    patient_id,
                    "Take medication",
                    "Blue pill with water.",
                    _future_iso(10),
                    caretaker_id,
                ),
            )

        conn.execute("COMMIT")
        log.info(
            "seed complete: patient=%s caretaker=%s face=%s",
            patient_id,
            caretaker_id,
            face_id,
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
