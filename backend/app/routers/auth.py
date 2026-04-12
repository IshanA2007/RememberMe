"""Auth router — identity resolution + provisioning (API_SPEC §1).

Endpoints:
  * GET  /api/auth/me              — resolve caller's user row + role
  * POST /api/auth/register        — first-time provisioning (idempotent)
  * POST /api/auth/caretaker/assign — link a caretaker to a patient

Notes:
  * `GET /auth/me` must NOT use the shared `get_auth` dep (which 401s on an
    unresolved user). Instead we verify the JWT manually and translate the
    "row absent" case into `404 NOT_FOUND` so the client knows to register.
  * `POST /auth/register` idempotency: 201 on the first call, 409 on repeats
    identified by matching `auth0_sub`.
  * `POST /auth/caretaker/assign` is the only place a caller may touch a row
    that belongs to another user — only when the caller is one of the two
    parties in the assignment.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request, status

from app.config import get_settings
from app.deps import get_auth, get_db, http_error
from app.models import (
    CaretakerAssignRequest,
    CaretakerAssignResponse,
    MeResponse,
    RegisterRequest,
)
from app.ratelimit import default_limiter, make_key
from app.services.auth import (
    AuthContext,
    AuthError,
    resolve_user,
    verify_jwt,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_write_limit(user_id: int) -> None:
    """Enforce the global 120/min write budget (API_SPEC §11)."""
    if not default_limiter.check(make_key(user_id, "write"), 120, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Write rate limit exceeded (120/min)",
        )


def _extract_bearer(request: Request) -> str:
    """Local copy of the bearer extraction used by `get_auth` so the /me
    handler can run its own 401→404 translation without invoking the dep."""
    header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
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


def _me_from_row(
    row: sqlite3.Row, role: str, auth0_sub: str
) -> MeResponse:
    """Serialize a `patients` or `caretakers` row into the canonical shape."""
    from app.models import iso_utc

    return MeResponse(
        user_id=str(row["id"]),
        auth0_sub=auth0_sub,
        role=role,  # type: ignore[arg-type]
        display_name=row["display_name"],
        email=row["email"],
        created_at=iso_utc(row["created_at"]),
    )


def _table_for_role(role: str) -> str:
    """Whitelist role -> DB table. Caller trusts this is safe."""
    if role == "patient":
        return "patients"
    if role == "caretaker":
        return "caretakers"
    raise http_error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "SEMANTIC_ERROR",
        "Unknown role",
        {"role": role},
    )


# ---------------------------------------------------------------------------
# §1.1 GET /api/auth/me
# ---------------------------------------------------------------------------


@router.get("/me", response_model=MeResponse)
def get_me(
    request: Request,
    db: sqlite3.Connection = Depends(get_db),
) -> MeResponse:
    """Return the caller's user row + role.

    Special case vs. every other route: a valid token whose `sub` has no user
    row yields `404 NOT_FOUND`, not 401 — the caller is expected to call
    `POST /api/auth/register` next.
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
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "No user row for this token; register first",
            {"auth0_sub": claims.get("sub")},
        )

    return MeResponse(
        user_id=str(ctx.user_id),
        auth0_sub=ctx.auth0_sub,
        role=ctx.role,  # type: ignore[arg-type]
        display_name=ctx.display_name,
        email=ctx.email,
        # AuthContext doesn't carry `created_at`; re-fetch for authoritative value.
        created_at=_fetch_created_at(db, ctx.role, ctx.user_id),
    )


def _fetch_created_at(conn: sqlite3.Connection, role: str, user_id: int) -> str:
    from app.models import iso_utc

    table = _table_for_role(role)
    row = conn.execute(
        f"SELECT created_at FROM {table} WHERE id = ?",  # noqa: S608 — whitelist
        (user_id,),
    ).fetchone()
    if row is None:
        # Should be impossible (we just resolved the user), but be defensive.
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "User row vanished between auth and read",
        )
    return iso_utc(row["created_at"])


# ---------------------------------------------------------------------------
# §1.2 POST /api/auth/register
# ---------------------------------------------------------------------------


@router.post("/register", response_model=MeResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    db: sqlite3.Connection = Depends(get_db),
) -> MeResponse:
    """First-time provisioning. The JWT is verified here (not via get_auth)
    because the `auth0_sub` we need is in the claims, not a DB row yet.

    Contract:
      * 201 with `MeResponse` on success
      * 409 `CONFLICT` if the `auth0_sub` already has a user row (idempotent
        clients should just call `/auth/me` instead)
      * 422 `SEMANTIC_ERROR` if the token's role claim disagrees with the body
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

    # Extract the role claim inline — re-implementing the tiny check here
    # keeps us off the service module's private helpers.
    role_from_token = claims.get(get_settings().AUTH0_ROLE_CLAIM)
    if role_from_token not in ("patient", "caretaker"):
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "UNAUTHENTICATED",
            "JWT missing or invalid role claim",
            {"claim": get_settings().AUTH0_ROLE_CLAIM, "value": role_from_token},
        )

    if role_from_token != payload.role:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "Role in body disagrees with role in JWT",
            {"body_role": payload.role, "jwt_role": role_from_token},
        )

    auth0_sub = claims.get("sub")
    if not isinstance(auth0_sub, str) or not auth0_sub:
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "UNAUTHENTICATED",
            "JWT missing sub claim",
        )
    email_raw = claims.get("email")
    email = email_raw if isinstance(email_raw, str) else None
    display_name = payload.display_name.strip()

    table = _table_for_role(payload.role)
    # Idempotency: explicit existence check before INSERT lets us surface 409
    # with a useful message (otherwise we'd only know via IntegrityError).
    existing = db.execute(
        f"SELECT id FROM {table} WHERE auth0_sub = ?",  # noqa: S608 — whitelist
        (auth0_sub,),
    ).fetchone()
    if existing is not None:
        raise http_error(
            status.HTTP_409_CONFLICT,
            "CONFLICT",
            "User already registered",
            {"auth0_sub": auth0_sub},
        )

    try:
        cur = db.execute(
            f"""
            INSERT INTO {table} (auth0_sub, display_name, email)
            VALUES (?, ?, ?)
            """,  # noqa: S608 — whitelist
            (auth0_sub, display_name, email),
        )
    except sqlite3.IntegrityError as exc:
        # Race against the pre-check above (two concurrent registers).
        raise http_error(
            status.HTTP_409_CONFLICT,
            "CONFLICT",
            "User already registered",
            {"auth0_sub": auth0_sub},
        ) from exc

    new_id = int(cur.lastrowid)
    row = db.execute(
        f"SELECT id, display_name, email, created_at FROM {table} WHERE id = ?",  # noqa: S608
        (new_id,),
    ).fetchone()
    assert row is not None
    return _me_from_row(row, payload.role, auth0_sub)


# ---------------------------------------------------------------------------
# §1.3 POST /api/auth/caretaker/assign
# ---------------------------------------------------------------------------


@router.post(
    "/caretaker/assign",
    response_model=CaretakerAssignResponse,
    status_code=status.HTTP_201_CREATED,
)
def assign_caretaker(
    payload: CaretakerAssignRequest,
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> CaretakerAssignResponse:
    """Create a `patient_caretakers` row.

    Authority rule (API_SPEC §1.3): only the patient or the caretaker named
    in the request may submit. Anybody else → 403.
    """
    _check_write_limit(auth.user_id)

    try:
        patient_id = int(payload.patient_id)
        caretaker_id = int(payload.caretaker_id)
    except ValueError as exc:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "patient_id and caretaker_id must be numeric strings",
            {"patient_id": payload.patient_id, "caretaker_id": payload.caretaker_id},
        ) from exc

    # Caller must be one of the two parties. Role + id must match.
    is_party = (
        (auth.role == "patient" and auth.user_id == patient_id)
        or (auth.role == "caretaker" and auth.user_id == caretaker_id)
    )
    if not is_party:
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Caller is not a party to this assignment",
            {"patient_id": payload.patient_id, "caretaker_id": payload.caretaker_id},
        )

    # Both parties must exist.
    if db.execute("SELECT 1 FROM patients WHERE id = ?", (patient_id,)).fetchone() is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Patient not found",
            {"patient_id": payload.patient_id},
        )
    if (
        db.execute("SELECT 1 FROM caretakers WHERE id = ?", (caretaker_id,)).fetchone()
        is None
    ):
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Caretaker not found",
            {"caretaker_id": payload.caretaker_id},
        )

    try:
        db.execute(
            """
            INSERT INTO patient_caretakers (patient_id, caretaker_id)
            VALUES (?, ?)
            """,
            (patient_id, caretaker_id),
        )
    except sqlite3.IntegrityError as exc:
        # Composite PK violation = the link already exists; treat as conflict.
        raise http_error(
            status.HTTP_409_CONFLICT,
            "CONFLICT",
            "Assignment already exists",
            {"patient_id": payload.patient_id, "caretaker_id": payload.caretaker_id},
        ) from exc

    row = db.execute(
        """
        SELECT created_at FROM patient_caretakers
        WHERE patient_id = ? AND caretaker_id = ?
        """,
        (patient_id, caretaker_id),
    ).fetchone()
    from app.models import iso_utc

    assert row is not None
    return CaretakerAssignResponse(
        patient_id=str(patient_id),
        caretaker_id=str(caretaker_id),
        created_at=iso_utc(row["created_at"]),
    )
