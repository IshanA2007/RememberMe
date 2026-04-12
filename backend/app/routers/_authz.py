"""Shared authority helpers used inline by routers.

The `deps.py` factories take a path parameter at factory-time, which works
for dependencies declared in the route signature. Inside a handler body we
need the same checks keyed off a runtime-resolved ID (e.g. after looking up
a face's owning patient), so this module exposes the same logic without the
`Depends` wrapper.

All helpers raise `HTTPException` with the API_SPEC §0.3 error envelope on
authorization failure; they return `None` on success.
"""

from __future__ import annotations

import sqlite3

from fastapi import status

from app.deps import http_error
from app.services.auth import AuthContext


def _caretaker_linked(
    conn: sqlite3.Connection, caretaker_id: int, patient_id: int
) -> bool:
    row = conn.execute(
        "SELECT 1 FROM patient_caretakers WHERE caretaker_id = ? AND patient_id = ?",
        (caretaker_id, patient_id),
    ).fetchone()
    return row is not None


def ensure_patient(auth: AuthContext, patient_id: int) -> None:
    """Caller must be the patient named by `patient_id`."""
    if auth.role != "patient" or auth.user_id != patient_id:
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Caller is not this patient",
            {"patient_id": str(patient_id)},
        )


def ensure_caretaker_of(
    conn: sqlite3.Connection, auth: AuthContext, patient_id: int
) -> None:
    """Caller must be a caretaker linked to `patient_id`."""
    if auth.role != "caretaker" or not _caretaker_linked(
        conn, auth.user_id, patient_id
    ):
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Caller is not a caretaker for this patient",
            {"patient_id": str(patient_id)},
        )


def ensure_patient_or_caretaker_of(
    conn: sqlite3.Connection, auth: AuthContext, patient_id: int
) -> None:
    """Caller must be the patient OR a linked caretaker."""
    if auth.role == "patient" and auth.user_id == patient_id:
        return
    if auth.role == "caretaker" and _caretaker_linked(conn, auth.user_id, patient_id):
        return
    raise http_error(
        status.HTTP_403_FORBIDDEN,
        "FORBIDDEN",
        "Caller has no authority over this patient",
        {"patient_id": str(patient_id)},
    )


def parse_id(raw: str, code: str = "NOT_FOUND", message: str = "Resource not found") -> int:
    """Coerce a path-param string to int; 404 on garbage."""
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            code,
            message,
            {"id": raw},
        ) from exc
