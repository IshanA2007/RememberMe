"""Scheduling service — CRUD + upcoming window for `reminders`.

Governed by:
  * docs/SERVICE_BACKEND.md §2.8
  * docs/DATA_SCHEMAS.md §7
  * docs/API_SPEC.md §5
  * docs/PIPELINE.md §3 (poll / fire)

Invariants:
  * `trigger_at` is stored as ISO 8601 UTC TEXT.
  * `trigger_at > now` at creation time — router translates `ValueError` -> 422.
  * `created_by_role` must be one of `patient`/`caretaker`.
  * IDs are returned as strings in `ReminderObject`.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from app.models import ReminderObject, iso_utc

# Upcoming query default + max window. Max from API_SPEC §5.2 (3600 s).
_DEFAULT_UPCOMING_WINDOW = 600
_MAX_UPCOMING_WINDOW = 3600


def _now_utc() -> datetime:
    """Single source for 'now' so tests can monkeypatch this module."""
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    """Parse an ISO 8601 string, coercing trailing `Z` and assuming UTC."""
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Row -> model
# ---------------------------------------------------------------------------


def _row_to_reminder(row: sqlite3.Row | dict[str, Any]) -> ReminderObject:
    """Map a DB row to the canonical shape (API_SPEC §5.1)."""
    return ReminderObject(
        reminder_id=str(row["id"]),
        patient_id=str(row["patient_id"]),
        title=row["title"],
        description=row["description"],
        trigger_at=iso_utc(row["trigger_at"]),
        created_by_user_id=str(row["created_by_user_id"]),
        created_by_role=row["created_by_role"],
        created_at=iso_utc(row["created_at"]),
        updated_at=iso_utc(row["updated_at"]),
    )


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def list_reminders(
    conn: sqlite3.Connection,
    patient_id: int,
    from_dt: str | None = None,
    to_dt: str | None = None,
) -> list[ReminderObject]:
    """List reminders for a patient, optional inclusive `from`/`to` window."""
    sql = [
        """
        SELECT id, patient_id, title, description, trigger_at,
               created_by_user_id, created_by_role, created_at, updated_at
        FROM reminders
        WHERE patient_id = ?
        """
    ]
    params: list[Any] = [patient_id]
    if from_dt:
        sql.append(" AND trigger_at >= ?")
        params.append(from_dt)
    if to_dt:
        sql.append(" AND trigger_at <= ?")
        params.append(to_dt)
    sql.append(" ORDER BY trigger_at ASC")
    rows = conn.execute("".join(sql), params).fetchall()
    return [_row_to_reminder(r) for r in rows]


def upcoming_reminders(
    conn: sqlite3.Connection, patient_id: int, window_seconds: int | None = None
) -> list[ReminderObject]:
    """Return reminders firing within `[now, now + window]`.

    Clamps `window_seconds` to `[1, 3600]` (API_SPEC §5.2 max=3600).
    """
    window = window_seconds if window_seconds is not None else _DEFAULT_UPCOMING_WINDOW
    window = max(1, min(int(window), _MAX_UPCOMING_WINDOW))
    now = _now_utc()
    end = now + timedelta(seconds=window)
    rows = conn.execute(
        """
        SELECT id, patient_id, title, description, trigger_at,
               created_by_user_id, created_by_role, created_at, updated_at
        FROM reminders
        WHERE patient_id = ? AND trigger_at >= ? AND trigger_at <= ?
        ORDER BY trigger_at ASC
        """,
        (patient_id, iso_utc(now), iso_utc(end)),
    ).fetchall()
    return [_row_to_reminder(r) for r in rows]


def get_reminder(conn: sqlite3.Connection, reminder_id: int) -> ReminderObject | None:
    row = conn.execute(
        """
        SELECT id, patient_id, title, description, trigger_at,
               created_by_user_id, created_by_role, created_at, updated_at
        FROM reminders WHERE id = ?
        """,
        (reminder_id,),
    ).fetchone()
    return _row_to_reminder(row) if row else None


def create_reminder(
    conn: sqlite3.Connection,
    patient_id: int,
    title: str,
    description: str | None,
    trigger_at: str,
    created_by_user_id: int,
    created_by_role: str,
) -> ReminderObject:
    """Insert a reminder. Raises `ValueError` when `trigger_at` is not future.

    The caller (router) catches ValueError and emits `422 SEMANTIC_ERROR`.
    """
    try:
        parsed = _parse_iso(trigger_at)
    except ValueError as exc:
        raise ValueError(f"trigger_at not a valid ISO 8601 timestamp: {exc}") from exc
    if parsed <= _now_utc():
        raise ValueError("trigger_at must be strictly in the future")

    canonical = iso_utc(parsed)
    cur = conn.execute(
        """
        INSERT INTO reminders (
            patient_id, title, description, trigger_at,
            created_by_user_id, created_by_role
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (patient_id, title, description, canonical, created_by_user_id, created_by_role),
    )
    new_id = int(cur.lastrowid)
    out = get_reminder(conn, new_id)
    assert out is not None
    return out


def update_reminder(
    conn: sqlite3.Connection, reminder_id: int, fields: dict[str, Any]
) -> ReminderObject:
    """Partial update. Accepts keys: title, description, trigger_at.

    If `trigger_at` is supplied it is validated (future-only) like `create`.
    """
    allowed = {"title", "description", "trigger_at"}
    sets: list[str] = []
    params: list[Any] = []
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "trigger_at":
            parsed = _parse_iso(value)
            if parsed <= _now_utc():
                raise ValueError("trigger_at must be strictly in the future")
            value = iso_utc(parsed)
        sets.append(f"{key} = ?")
        params.append(value)
    if not sets:
        out = get_reminder(conn, reminder_id)
        assert out is not None
        return out
    sets.append("updated_at = CURRENT_TIMESTAMP")
    params.append(reminder_id)
    conn.execute(
        f"UPDATE reminders SET {', '.join(sets)} WHERE id = ?",  # noqa: S608 — keys whitelisted above
        params,
    )
    out = get_reminder(conn, reminder_id)
    assert out is not None
    return out


def delete_reminder(conn: sqlite3.Connection, reminder_id: int) -> None:
    """Delete a reminder by id (no-op if already gone)."""
    conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))


def reminder_belongs_to_patient(
    conn: sqlite3.Connection, reminder_id: int, patient_id: int
) -> bool:
    """True iff the reminder exists AND is owned by `patient_id`."""
    row = conn.execute(
        "SELECT 1 FROM reminders WHERE id = ? AND patient_id = ?",
        (reminder_id, patient_id),
    ).fetchone()
    return row is not None
