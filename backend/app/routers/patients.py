"""Patients router — caretaker directory + per-patient snapshots (API_SPEC §2, §8).

Endpoints:
  * GET /api/patients                  — caretaker lists assigned patients
  * GET /api/patients/{id}/quick-info  — single-call dashboard snapshot
  * GET /api/patients/{id}/activity    — caretaker monitoring view
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Path, status

from app.deps import get_auth, get_db, http_error
from app.models import (
    ActivityNewlyRecognizedFace,
    ActivityRecentConversationMemory,
    ActivityResponse,
    PatientDirectoryEntry,
    PatientDirectoryResponse,
    QuickInfoRecentMemory,
    QuickInfoResponse,
    QuickInfoUpcomingReminder,
    iso_utc,
)
from app.routers._authz import ensure_patient_or_caretaker_of, parse_id
from app.services.auth import AuthContext

router = APIRouter()


def _seven_days_from_now() -> tuple[str, str]:
    """Return `(now_iso, now_plus_7d_iso)` for activity/quick-info windows."""
    now = datetime.now(timezone.utc)
    return iso_utc(now), iso_utc(now + timedelta(days=7))


def _seven_days_ago() -> str:
    """ISO timestamp for the activity window lookback."""
    return iso_utc(datetime.now(timezone.utc) - timedelta(days=7))


# ---------------------------------------------------------------------------
# §2.1 GET /api/patients
# ---------------------------------------------------------------------------


@router.get("", response_model=PatientDirectoryResponse)
def list_assigned_patients(
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> PatientDirectoryResponse:
    """List every patient this caretaker is linked to (caretaker-only)."""
    if auth.role != "caretaker":
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Only caretakers may list assigned patients",
        )

    rows = db.execute(
        """
        SELECT p.id AS id, p.display_name AS display_name,
               pc.created_at AS assigned_at
        FROM patient_caretakers pc
        JOIN patients p ON p.id = pc.patient_id
        WHERE pc.caretaker_id = ?
        ORDER BY pc.created_at DESC, p.id ASC
        """,
        (auth.user_id,),
    ).fetchall()

    return PatientDirectoryResponse(
        patients=[
            PatientDirectoryEntry(
                patient_id=str(r["id"]),
                display_name=r["display_name"],
                assigned_at=iso_utc(r["assigned_at"]),
            )
            for r in rows
        ]
    )


# ---------------------------------------------------------------------------
# §8.1 GET /api/patients/{id}/quick-info
# ---------------------------------------------------------------------------


@router.get("/{patient_id}/quick-info", response_model=QuickInfoResponse)
def quick_info(
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> QuickInfoResponse:
    """Single-call snapshot for the patient dashboard.

    Allowed to both patient (self) and caretakers linked to the patient.
    """
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)

    patient_row = db.execute(
        "SELECT display_name FROM patients WHERE id = ?", (pid,)
    ).fetchone()
    if patient_row is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Patient not found",
            {"patient_id": patient_id},
        )

    face_count = int(
        db.execute(
            "SELECT COUNT(*) AS c FROM faces WHERE patient_id = ?", (pid,)
        ).fetchone()["c"]
    )

    memory_rows = db.execute(
        """
        SELECT m.id AS memory_id, m.face_id AS face_id, m.content AS content,
               m.source AS source, m.created_at AS created_at,
               f.name AS face_name
        FROM memories m
        JOIN faces f ON f.id = m.face_id
        WHERE f.patient_id = ?
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 10
        """,
        (pid,),
    ).fetchall()
    recent_memories = [
        QuickInfoRecentMemory(
            memory_id=str(r["memory_id"]),
            face_id=str(r["face_id"]),
            face_name=r["face_name"],
            content=r["content"],
            source=r["source"],
            created_at=iso_utc(r["created_at"]),
        )
        for r in memory_rows
    ]

    now_iso, end_iso = _seven_days_from_now()
    reminder_rows = db.execute(
        """
        SELECT id, title, trigger_at
        FROM reminders
        WHERE patient_id = ? AND trigger_at >= ? AND trigger_at <= ?
        ORDER BY trigger_at ASC
        LIMIT 5
        """,
        (pid, now_iso, end_iso),
    ).fetchall()
    upcoming = [
        QuickInfoUpcomingReminder(
            reminder_id=str(r["id"]),
            title=r["title"],
            trigger_at=iso_utc(r["trigger_at"]),
        )
        for r in reminder_rows
    ]

    return QuickInfoResponse(
        patient_id=str(pid),
        display_name=patient_row["display_name"],
        face_count=face_count,
        recent_memories=recent_memories,
        upcoming_reminders=upcoming,
    )


# ---------------------------------------------------------------------------
# §8.2 GET /api/patients/{id}/activity
# ---------------------------------------------------------------------------


@router.get("/{patient_id}/activity", response_model=ActivityResponse)
def activity(
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ActivityResponse:
    """Caretaker monitoring view — the last week of interesting rows.

    `newly_recognized_faces`: faces created in the last 7 days (hackathon
    approximation — the DB does not track "first seen" separately).
    `recent_conversation_memories`: source='conversation' memories from the
    last 7 days, joined with face name.
    """
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)

    if (
        db.execute("SELECT 1 FROM patients WHERE id = ?", (pid,)).fetchone()
        is None
    ):
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Patient not found",
            {"patient_id": patient_id},
        )

    since_iso = _seven_days_ago()

    face_rows = db.execute(
        """
        SELECT id, name, created_at
        FROM faces
        WHERE patient_id = ? AND created_at >= ?
        ORDER BY created_at DESC, id DESC
        """,
        (pid, since_iso),
    ).fetchall()
    newly = [
        ActivityNewlyRecognizedFace(
            face_id=str(r["id"]),
            name=r["name"],
            first_seen_at=iso_utc(r["created_at"]),
        )
        for r in face_rows
    ]

    conv_memory_rows = db.execute(
        """
        SELECT m.id AS memory_id, m.face_id AS face_id, m.content AS content,
               m.created_at AS created_at, m.transcript_id AS transcript_id,
               f.name AS face_name
        FROM memories m
        JOIN faces f ON f.id = m.face_id
        WHERE f.patient_id = ? AND m.source = 'conversation'
          AND m.created_at >= ?
        ORDER BY m.created_at DESC, m.id DESC
        """,
        (pid, since_iso),
    ).fetchall()
    recent_conv = [
        ActivityRecentConversationMemory(
            memory_id=str(r["memory_id"]),
            face_id=str(r["face_id"]),
            face_name=r["face_name"],
            content=r["content"],
            created_at=iso_utc(r["created_at"]),
            transcript_id=str(r["transcript_id"]) if r["transcript_id"] is not None else "",
        )
        for r in conv_memory_rows
    ]

    now_iso, end_iso = _seven_days_from_now()
    reminder_rows = db.execute(
        """
        SELECT id, title, trigger_at
        FROM reminders
        WHERE patient_id = ? AND trigger_at >= ? AND trigger_at <= ?
        ORDER BY trigger_at ASC
        """,
        (pid, now_iso, end_iso),
    ).fetchall()
    upcoming = [
        QuickInfoUpcomingReminder(
            reminder_id=str(r["id"]),
            title=r["title"],
            trigger_at=iso_utc(r["trigger_at"]),
        )
        for r in reminder_rows
    ]

    return ActivityResponse(
        patient_id=str(pid),
        newly_recognized_faces=newly,
        recent_conversation_memories=recent_conv,
        upcoming_reminders=upcoming,
    )
