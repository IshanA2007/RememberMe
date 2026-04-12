"""FastAPI dependency helpers.

Exposes:
  * `get_db` — per-request SQLite connection (yield/close).
  * `get_auth` — resolves bearer token to `AuthContext`, raises 401 on failure.
  * `require_patient(patient_id)` — caller is that patient.
  * `require_caretaker_of(patient_id)` — caller is a caretaker linked to patient.
  * `require_patient_or_caretaker_of(patient_id)` — OR of the two.
  * `http_error` — helper that raises HTTPException with the API_SPEC §0.3 envelope.

Contract references:
  * docs/API_SPEC.md §0.3 (error envelope)
  * docs/API_SPEC.md §0.4 (authority matrix)
  * docs/SERVICE_BACKEND.md §2.1 (auth dependencies)
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status

from app.db import get_connection
from app.services.auth import AuthContext, AuthError, resolve_user, verify_jwt

# ---------------------------------------------------------------------------
# Error helper
# ---------------------------------------------------------------------------


def http_error(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> HTTPException:
    """Build an `HTTPException` whose body matches the error envelope shape.

    FastAPI will render `detail` as the JSON body directly, producing:
    ``{"error": {"code": ..., "message": ..., "details": {...}}}``
    """
    body = {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        }
    }
    return HTTPException(status_code=status_code, detail=body)


# ---------------------------------------------------------------------------
# DB dependency
# ---------------------------------------------------------------------------


def get_db() -> Iterator[sqlite3.Connection]:
    """Yield a SQLite connection for the current request; close on exit."""
    yield from get_connection()


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------


def _extract_bearer(request: Request) -> str:
    """Parse `Authorization: Bearer <token>` — raise 401 if absent/malformed."""
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header:
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "UNAUTHENTICATED",
            "Missing Authorization header",
        )
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "UNAUTHENTICATED",
            "Authorization header must be 'Bearer <token>'",
        )
    return parts[1].strip()


def get_auth(
    request: Request,
    db: sqlite3.Connection = Depends(get_db),
) -> AuthContext:
    """Verify the bearer token and resolve it to an `AuthContext`.

    Raises:
        401 UNAUTHENTICATED — missing/invalid token OR user row absent.
          (The auth/me router special-cases the latter into 404 before calling
           this dependency; other routers see the row-missing case as 401.)
    """
    token = _extract_bearer(request)
    try:
        claims = verify_jwt(token)
    except AuthError as exc:
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            exc.code,
            exc.message,
            exc.details,
        ) from exc

    ctx = resolve_user(claims, db)
    if ctx is None:
        # Row doesn't exist yet. For `/api/auth/me` the router handles this
        # case before reaching this dependency; for everything else treat it
        # as unauthenticated — we cannot honor a token for a non-existent user.
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "UNAUTHENTICATED",
            "Token valid but user is not registered",
        )
    return ctx


# ---------------------------------------------------------------------------
# Authority dependencies
# ---------------------------------------------------------------------------


def _caretaker_is_linked(
    conn: sqlite3.Connection, caretaker_id: int, patient_id: int
) -> bool:
    """True iff a `patient_caretakers` row exists linking the two."""
    row = conn.execute(
        "SELECT 1 FROM patient_caretakers WHERE caretaker_id = ? AND patient_id = ?",
        (caretaker_id, patient_id),
    ).fetchone()
    return row is not None


def _parse_patient_id(patient_id: str) -> int:
    """Coerce a path-param string ID to int; 404 on garbage."""
    try:
        return int(patient_id)
    except (TypeError, ValueError) as exc:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Patient not found",
            {"patient_id": patient_id},
        ) from exc


def require_patient(patient_id: str) -> Callable[..., AuthContext]:
    """Dep factory: caller is the patient named by `patient_id`."""
    target = _parse_patient_id(patient_id)

    def _dep(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.role != "patient" or auth.user_id != target:
            raise http_error(
                status.HTTP_403_FORBIDDEN,
                "FORBIDDEN",
                "Caller is not this patient",
                {"patient_id": patient_id},
            )
        return auth

    return _dep


def require_caretaker_of(patient_id: str) -> Callable[..., AuthContext]:
    """Dep factory: caller is a caretaker linked to `patient_id`."""
    target = _parse_patient_id(patient_id)

    def _dep(
        auth: AuthContext = Depends(get_auth),
        db: sqlite3.Connection = Depends(get_db),
    ) -> AuthContext:
        if auth.role != "caretaker" or not _caretaker_is_linked(db, auth.user_id, target):
            raise http_error(
                status.HTTP_403_FORBIDDEN,
                "FORBIDDEN",
                "Caller is not a caretaker for this patient",
                {"patient_id": patient_id},
            )
        return auth

    return _dep


def require_patient_or_caretaker_of(patient_id: str) -> Callable[..., AuthContext]:
    """Dep factory: caller is the patient OR a linked caretaker."""
    target = _parse_patient_id(patient_id)

    def _dep(
        auth: AuthContext = Depends(get_auth),
        db: sqlite3.Connection = Depends(get_db),
    ) -> AuthContext:
        if auth.role == "patient" and auth.user_id == target:
            return auth
        if auth.role == "caretaker" and _caretaker_is_linked(db, auth.user_id, target):
            return auth
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Caller has no authority over this patient",
            {"patient_id": patient_id},
        )

    return _dep
