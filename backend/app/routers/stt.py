"""STT router — ElevenLabs multipart audio transcribe (API_SPEC §7.2).

Endpoints:
  * POST /api/stt/transcribe (multipart/form-data) — returns {transcript,
    confidence, duration_seconds}

Constraints:
  * `audio` file must be ≤ 10 MB (API_SPEC §12) → 413 PAYLOAD_TOO_LARGE
  * `patient_id` form field must match caller's patient id (API_SPEC §0.4)
  * Rate limit: 30 req/min per user (API_SPEC §11)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.deps import get_auth, http_error
from app.models import SttResponse
from app.ratelimit import default_limiter, make_key
from app.routers._authz import parse_id
from app.services import stt_proxy
from app.services.auth import AuthContext

router = APIRouter()

_MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB per API_SPEC §12
_ALLOWED_MIMES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp3",
    "audio/mpeg",
    "audio/mp4",
    # Browsers sometimes omit mime; stt_proxy will forward whatever we pass.
}


@router.post("/transcribe", response_model=SttResponse)
async def transcribe(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    auth: AuthContext = Depends(get_auth),
) -> SttResponse:
    """Transcribe an audio blob. Only the patient themselves may call this.

    We read the file fully into memory so we can check size before forwarding.
    """
    if not default_limiter.check(make_key(auth.user_id, "stt"), 30, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "STT limited to 30/min per user",
        )

    pid = parse_id(patient_id)
    if auth.role != "patient" or auth.user_id != pid:
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Only the patient themselves may call STT",
            {"patient_id": patient_id},
        )

    raw = await audio.read()
    if len(raw) > _MAX_AUDIO_BYTES:
        raise http_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "PAYLOAD_TOO_LARGE",
            "Audio file exceeds 10 MB",
            {"size": len(raw), "limit": _MAX_AUDIO_BYTES},
        )

    content_type = (audio.content_type or "application/octet-stream").lower()
    # Content-type isn't strictly enforced — ElevenLabs sniffs — but log-ish
    # flag unexpected values by declining obvious mismatches early.
    if content_type not in _ALLOWED_MIMES and not content_type.startswith("audio/"):
        raise http_error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_MEDIA_TYPE",
            "audio Content-Type must be audio/*",
            {"content_type": content_type},
        )

    try:
        result = await stt_proxy.transcribe(
            raw, filename=audio.filename or "audio", mime=content_type
        )
    except stt_proxy.UpstreamError as exc:
        raise http_error(
            status.HTTP_502_BAD_GATEWAY,
            "UPSTREAM_ERROR",
            f"ElevenLabs STT failed: {exc}",
        ) from exc

    return SttResponse(
        transcript=result["transcript"],
        confidence=float(result.get("confidence", 1.0)),
        duration_seconds=float(result.get("duration_seconds", 0.0)),
    )
