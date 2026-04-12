"""FastAPI application entrypoint.

Wires every router, applies CORS, runs pending migrations at startup, and
(optionally) seeds hackathon fixtures when `SEED_ON_STARTUP=true`.

Source of truth references:
  * docs/SERVICE_BACKEND.md §3 (routing map), §5 (config), §7 (startup)
  * docs/API_SPEC.md §0.3 (error envelope)
  * CLAUDE.md §5 (constants)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import open_connection
from app.migrations_runner import apply_pending_migrations
from app.routers import (
    auth,
    conversations,
    faces,
    health,
    memories,
    patients,
    reminders,
    stt,
    tts,
    ws,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("rememberme")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001 — FastAPI contract
    """Run startup + shutdown hooks around the app's serving lifetime.

    Startup (SERVICE_BACKEND §7):
      1. Open SQLite with WAL pragmas (`db.open_connection`).
      2. Apply any pending migrations.
      3. If `SEED_ON_STARTUP` is set, insert hackathon fixtures.
      4. Log ready state (and whether dev-auth-bypass is on).
    Shutdown: just log — no background tasks own resources across restart.
    """
    conn = open_connection()
    try:
        applied = apply_pending_migrations(conn)
        if applied:
            log.info("migrations applied: %s", ", ".join(applied))
    finally:
        conn.close()

    if settings.SEED_ON_STARTUP:
        # Imported lazily so `from app.main import app` works in environments
        # where we never mean to seed.
        from app import seed

        seed.run()

    log.info(
        "RememberMe backend started (dev_auth_bypass=%s, seeded=%s)",
        settings.BACKEND_DEV_AUTH_BYPASS,
        settings.SEED_ON_STARTUP,
    )
    yield
    log.info("RememberMe backend shutting down")


app = FastAPI(title="RememberMe API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ----------------------------------------------------------------
# /api prefix convention from API_SPEC §1-9; WS router mounts `/ws/recognize`
# itself and therefore has no prefix here.
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(patients.router, prefix="/api/patients")
app.include_router(faces.router, prefix="/api")
app.include_router(memories.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(conversations.router, prefix="/api/conversations")
app.include_router(tts.router, prefix="/api/tts")
app.include_router(stt.router, prefix="/api/stt")
app.include_router(ws.router)


# --- Error envelope handlers ------------------------------------------------


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError  # noqa: ARG001 — fastapi contract
) -> JSONResponse:
    """Translate pydantic validation failures into our §0.3 envelope."""
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request body failed validation",
                "details": {"errors": exc.errors()},
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(
    request: Request, exc: HTTPException  # noqa: ARG001 — fastapi contract
) -> JSONResponse:
    """Forward `HTTPException.detail` (already envelope-shaped via `http_error`)
    as the JSON body, falling back to wrapping plain string details.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    # Plain-string detail (e.g. FastAPI default 404). Wrap to match §0.3.
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "HTTP_ERROR",
                "message": str(detail) if detail is not None else "",
                "details": {},
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request, exc: Exception  # noqa: ARG001 — fastapi contract
) -> JSONResponse:
    """Catch-all so we never leak a stack trace as the response body."""
    log.exception("unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "internal",
                "details": {},
            }
        },
    )
