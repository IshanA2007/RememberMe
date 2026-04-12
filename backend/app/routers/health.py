"""Health router — `GET /api/health` (API_SPEC §9.1).

The only endpoint in the service that requires no auth. Returns a fixed shape
suitable for process-level liveness probes.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.models import HealthResponse

router = APIRouter()


# Kept constant so the shape matches API_SPEC §9.1 byte-for-byte.
_SERVICE_VERSION = "0.1.0"


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Liveness probe. No auth. Always 200 when the process is up."""
    return HealthResponse(status="ok", version=_SERVICE_VERSION)
