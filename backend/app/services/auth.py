"""Auth service — Auth0 JWT verification + dev-mode bypass.

Governed by:
  * docs/SERVICE_BACKEND.md §2.1
  * docs/PIPELINE.md §6
  * docs/API_SPEC.md §0.4 (authority matrix)
  * CLAUDE.md §5 (AUTH0_ROLE_CLAIM default)

Flow:
  1. `verify_jwt(token)` -> claims dict. In real mode, RS256 JWKS verification.
     In dev-bypass mode (`BACKEND_DEV_AUTH_BYPASS=true`) parses tokens shaped
     `dev-<role>-<sub>-<display>` and returns synthetic claims.
  2. `resolve_user(claims, conn)` -> `AuthContext | None` by looking up
     `auth0_sub` in `patients` (role=patient) or `caretakers` (role=caretaker).
     Returns None when the row doesn't exist yet (caller -> 404 NOT_FOUND to
     drive the `/api/auth/register` flow).

JWKS cache:
  * Fetched lazily on first request and on unknown `kid`.
  * TTL: 60 minutes (SERVICE_BACKEND §2.1).
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any

from app.config import get_settings

# NOTE: `httpx` and `jose` are imported lazily inside functions so that the
# `auth` module itself loads under environments where the external libs are
# not yet installed (e.g. import-smoke tests during Task B4/B5). Production
# paths always go through `verify_jwt` / `JwksCache._fetch`, which re-import.

logger = logging.getLogger(__name__)

# JWKS TTL in seconds — docs/SERVICE_BACKEND.md §2.1.
_JWKS_TTL_SECONDS = 60 * 60


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class AuthError(Exception):
    """Base auth failure. Carries an error code for the envelope."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class InvalidToken(AuthError):
    """Token is missing, malformed, expired, or signature invalid."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__("UNAUTHENTICATED", message, details)


# ---------------------------------------------------------------------------
# AuthContext
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuthContext:
    """Resolved identity for a request.

    Fields map to either `patients` or `caretakers` depending on `role`.
    """

    user_id: int
    role: str  # 'patient' | 'caretaker'
    auth0_sub: str
    display_name: str
    email: str | None = None


# ---------------------------------------------------------------------------
# JWKS cache
# ---------------------------------------------------------------------------


class JwksCache:
    """Thread-safe JWKS cache with TTL + on-demand re-fetch.

    `get_key(kid)` returns the JWK dict for a given key id. On cache miss or
    unknown kid, the cache is re-fetched from Auth0. Stale-if-error is NOT
    implemented — we prefer failing closed.
    """

    def __init__(self, domain: str, timeout_seconds: float = 5.0) -> None:
        self._url = f"https://{domain}/.well-known/jwks.json"
        self._timeout = timeout_seconds
        self._lock = threading.Lock()
        self._keys: dict[str, dict[str, Any]] = {}
        self._fetched_at: float = 0.0

    def _fetch(self) -> None:
        """Synchronously fetch and index JWKs. Caller holds `self._lock`."""
        import httpx  # deferred import — see module header

        try:
            resp = httpx.get(self._url, timeout=self._timeout)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise InvalidToken(
                "JWKS fetch failed",
                details={"reason": "jwks_unavailable"},
            ) from exc
        payload = resp.json()
        keys = payload.get("keys", [])
        if not isinstance(keys, list):
            raise InvalidToken(
                "JWKS payload malformed",
                details={"reason": "jwks_malformed"},
            )
        self._keys = {k["kid"]: k for k in keys if "kid" in k}
        self._fetched_at = time.time()

    def _is_stale(self) -> bool:
        return (time.time() - self._fetched_at) > _JWKS_TTL_SECONDS

    def get_key(self, kid: str) -> dict[str, Any]:
        """Return the JWK with this kid; re-fetch on miss or TTL expiry."""
        with self._lock:
            if not self._keys or self._is_stale() or kid not in self._keys:
                self._fetch()
            key = self._keys.get(kid)
        if key is None:
            raise InvalidToken(
                "Signing key not found in JWKS",
                details={"kid": kid},
            )
        return key


_jwks_cache_singleton: JwksCache | None = None


def _get_jwks_cache() -> JwksCache:
    """Lazy singleton accessor for the JWKS cache (per-process)."""
    global _jwks_cache_singleton
    if _jwks_cache_singleton is None:
        settings = get_settings()
        _jwks_cache_singleton = JwksCache(settings.AUTH0_DOMAIN)
    return _jwks_cache_singleton


# ---------------------------------------------------------------------------
# Dev bypass
# ---------------------------------------------------------------------------


def _parse_dev_token(token: str) -> dict[str, Any]:
    """Parse a dev-bypass token of shape `dev-<role>-<sub>-<display>`.

    Example: ``dev-patient-1-Alice`` -> claims dict with:
      * sub = ``auth0|dev-1``
      * role claim = ``patient``
      * name = ``Alice``

    Display name may contain hyphens — we split only on the first three.
    """
    prefix = "dev-"
    if not token.startswith(prefix):
        raise InvalidToken(
            "Dev token must start with 'dev-'",
            details={"reason": "dev_bad_prefix"},
        )
    rest = token[len(prefix) :]
    parts = rest.split("-", 2)  # role, sub, display-with-possible-hyphens
    if len(parts) != 3:
        raise InvalidToken(
            "Dev token shape is dev-<role>-<sub>-<display>",
            details={"reason": "dev_bad_shape"},
        )
    role, sub, display = parts
    if role not in ("patient", "caretaker"):
        raise InvalidToken(
            "Dev token role must be 'patient' or 'caretaker'",
            details={"reason": "dev_bad_role", "role": role},
        )
    if not sub:
        raise InvalidToken(
            "Dev token sub is empty",
            details={"reason": "dev_empty_sub"},
        )
    if not display:
        raise InvalidToken(
            "Dev token display is empty",
            details={"reason": "dev_empty_display"},
        )
    settings = get_settings()
    # Role is embedded in the synthetic sub so a patient with dev-sub "1" and
    # a caretaker with dev-sub "1" resolve to distinct user rows. Seed fixtures
    # rely on `auth0|dev-<role>-<sub>` matching what we emit here.
    return {
        "sub": f"auth0|dev-{role}-{sub}",
        settings.AUTH0_ROLE_CLAIM: role,
        "name": display,
        # Email intentionally omitted — dev contexts do not have one.
    }


# ---------------------------------------------------------------------------
# JWT verification
# ---------------------------------------------------------------------------


def verify_jwt(token: str) -> dict[str, Any]:
    """Validate `token` and return its claims.

    In dev-bypass mode: logs `DEV AUTH BYPASS ACTIVE` (warning) and parses the
    synthetic token shape. Never use in production.
    """
    settings = get_settings()

    if settings.BACKEND_DEV_AUTH_BYPASS:
        logger.warning("DEV AUTH BYPASS ACTIVE")
        return _parse_dev_token(token)

    if not token:
        raise InvalidToken("Empty bearer token")

    from jose import jwt  # deferred — see module header
    from jose.exceptions import JWTError

    # Extract `kid` from header without verifying, so we can look up the key.
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise InvalidToken("Malformed JWT header", details={"reason": str(exc)}) from exc
    kid = header.get("kid")
    if not kid:
        raise InvalidToken("JWT header missing kid")

    key = _get_jwks_cache().get_key(kid)

    issuer = f"https://{settings.AUTH0_DOMAIN}/"
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.AUTH0_AUDIENCE,
            issuer=issuer,
        )
    except JWTError as exc:
        raise InvalidToken(
            "JWT validation failed",
            details={"reason": str(exc)},
        ) from exc
    return claims


# ---------------------------------------------------------------------------
# User resolution
# ---------------------------------------------------------------------------


def _extract_role(claims: dict[str, Any]) -> str:
    """Pull role from the configured custom-claim path; raise on missing."""
    settings = get_settings()
    role = claims.get(settings.AUTH0_ROLE_CLAIM)
    if role not in ("patient", "caretaker"):
        raise InvalidToken(
            "JWT missing or invalid role claim",
            details={"claim": settings.AUTH0_ROLE_CLAIM, "value": role},
        )
    return role


def resolve_user(claims: dict[str, Any], conn: sqlite3.Connection) -> AuthContext | None:
    """Look up the user row for these claims.

    Returns None if no `patients`/`caretakers` row exists yet — caller turns
    this into `404 NOT_FOUND` to drive the registration flow.
    Raises `InvalidToken` when the claims themselves are malformed.
    """
    sub = claims.get("sub")
    if not sub or not isinstance(sub, str):
        raise InvalidToken("JWT missing sub claim")
    role = _extract_role(claims)

    table = "patients" if role == "patient" else "caretakers"
    row = conn.execute(
        f"SELECT id, display_name, email FROM {table} WHERE auth0_sub = ?",  # noqa: S608 — table name from fixed whitelist
        (sub,),
    ).fetchone()
    if row is None:
        return None
    return AuthContext(
        user_id=int(row["id"]),
        role=role,
        auth0_sub=sub,
        display_name=row["display_name"],
        email=row["email"],
    )
