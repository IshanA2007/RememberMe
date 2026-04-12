"""Reminders router — scheduling CRUD + upcoming-window poll (API_SPEC §5).

Endpoints:
  * GET    /api/patients/{id}/reminders             — list (optional from/to)
  * GET    /api/patients/{id}/reminders/upcoming    — Vision poll source
  * POST   /api/patients/{id}/reminders             — create
  * PATCH  /api/reminders/{id}                      — partial update
  * DELETE /api/reminders/{id}                      — remove

`trigger_at` constraints (DATA_SCHEMAS §7 + SERVICE_BACKEND §2.8):
  * Must be strictly in the future on create AND on PATCH-that-changes-it.
  * Any parse failure or past timestamp → 422 SEMANTIC_ERROR.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Path, Query, status

from app.deps import get_auth, get_db, http_error
from app.models import (
    ReminderCreateRequest,
    ReminderListResponse,
    ReminderObject,
    ReminderPatchRequest,
)
from app.ratelimit import default_limiter, make_key
from app.routers._authz import ensure_patient_or_caretaker_of, parse_id
from app.services import scheduling
from app.services.auth import AuthContext

router = APIRouter()

_MAX_UPCOMING_WINDOW = 3600  # API_SPEC §5.2


def _check_write_limit(user_id: int) -> None:
    if not default_limiter.check(make_key(user_id, "write"), 120, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Write rate limit exceeded (120/min)",
        )


# ---------------------------------------------------------------------------
# §5.1 GET /api/patients/{id}/reminders
# ---------------------------------------------------------------------------


@router.get(
    "/patients/{patient_id}/reminders", response_model=ReminderListResponse
)
def list_reminders(
    patient_id: str = Path(...),
    from_dt: str | None = Query(None, alias="from"),
    to_dt: str | None = Query(None, alias="to"),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ReminderListResponse:
    """List reminders for a patient, with optional `from`/`to` window."""
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)
    reminders = scheduling.list_reminders(db, pid, from_dt=from_dt, to_dt=to_dt)
    return ReminderListResponse(reminders=reminders)


# ---------------------------------------------------------------------------
# §5.2 GET /api/patients/{id}/reminders/upcoming
# ---------------------------------------------------------------------------


@router.get(
    "/patients/{patient_id}/reminders/upcoming",
    response_model=ReminderListResponse,
)
def upcoming_reminders(
    patient_id: str = Path(...),
    window_seconds: int = Query(600, ge=1),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ReminderListResponse:
    """Return reminders firing within `[now, now + window_seconds]`.

    `window_seconds` defaults to 600; values above 3600 → 422 SEMANTIC_ERROR.
    """
    if window_seconds > _MAX_UPCOMING_WINDOW:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            f"window_seconds must be ≤ {_MAX_UPCOMING_WINDOW}",
            {"window_seconds": window_seconds, "max": _MAX_UPCOMING_WINDOW},
        )
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)
    reminders = scheduling.upcoming_reminders(db, pid, window_seconds=window_seconds)
    return ReminderListResponse(reminders=reminders)


# ---------------------------------------------------------------------------
# §5.3 POST /api/patients/{id}/reminders
# ---------------------------------------------------------------------------


@router.post(
    "/patients/{patient_id}/reminders",
    response_model=ReminderObject,
    status_code=status.HTTP_201_CREATED,
)
def create_reminder(
    payload: ReminderCreateRequest,
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ReminderObject:
    """Create a reminder. Patient and caretaker are both allowed.

    `scheduling.create_reminder` raises `ValueError` when `trigger_at` is
    not a future ISO 8601 timestamp — we translate to 422.
    """
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)
    _check_write_limit(auth.user_id)

    try:
        reminder = scheduling.create_reminder(
            db,
            patient_id=pid,
            title=payload.title.strip(),
            description=payload.description,
            trigger_at=payload.trigger_at,
            created_by_user_id=auth.user_id,
            created_by_role=auth.role,
        )
    except ValueError as exc:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            str(exc),
            {"trigger_at": payload.trigger_at},
        ) from exc
    return reminder


# ---------------------------------------------------------------------------
# §5.4 PATCH /api/reminders/{id}
# ---------------------------------------------------------------------------


@router.patch("/reminders/{reminder_id}", response_model=ReminderObject)
def update_reminder(
    payload: ReminderPatchRequest,
    reminder_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ReminderObject:
    """Partial update. If `trigger_at` is provided, must be in the future."""
    rid = parse_id(
        reminder_id, code="REMINDER_NOT_FOUND", message="Reminder not found"
    )
    _check_write_limit(auth.user_id)

    existing = scheduling.get_reminder(db, rid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "REMINDER_NOT_FOUND",
            "Reminder not found",
            {"reminder_id": reminder_id},
        )
    ensure_patient_or_caretaker_of(db, auth, int(existing.patient_id))

    # Build the partial fields dict for the service, stripping None values.
    fields = {
        "title": payload.title.strip() if payload.title is not None else None,
        "description": payload.description,
        "trigger_at": payload.trigger_at,
    }
    try:
        return scheduling.update_reminder(db, rid, fields)
    except ValueError as exc:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            str(exc),
            {"trigger_at": payload.trigger_at},
        ) from exc


# ---------------------------------------------------------------------------
# §5.5 DELETE /api/reminders/{id}
# ---------------------------------------------------------------------------


@router.delete(
    "/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_reminder(
    reminder_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> None:
    """Delete a reminder."""
    rid = parse_id(
        reminder_id, code="REMINDER_NOT_FOUND", message="Reminder not found"
    )
    _check_write_limit(auth.user_id)

    existing = scheduling.get_reminder(db, rid)
    if existing is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "REMINDER_NOT_FOUND",
            "Reminder not found",
            {"reminder_id": reminder_id},
        )
    ensure_patient_or_caretaker_of(db, auth, int(existing.patient_id))
    scheduling.delete_reminder(db, rid)
    return None
