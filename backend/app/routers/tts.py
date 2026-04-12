"""TTS router — ElevenLabs proxy (API_SPEC §7.1).

Endpoints:
  * POST /api/tts/synthesize — returns `audio/mpeg` streamed MP3

Rate limit: 10 req/min per user (API_SPEC §11). Text ≤ 1000 chars (validated
by the pydantic model).

On upstream failure: 502 UPSTREAM_ERROR with our error envelope.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse

from app.deps import get_auth, http_error
from app.models import TtsRequest
from app.ratelimit import default_limiter, make_key
from app.services import tts_proxy
from app.services.auth import AuthContext

router = APIRouter()


@router.post("/synthesize")
async def synthesize(
    payload: TtsRequest,
    auth: AuthContext = Depends(get_auth),
) -> StreamingResponse:
    """Synthesize speech for `text` and stream the audio back.

    The proxy service yields MP3 chunks as they arrive from ElevenLabs,
    keeping TTFB low for the Vision overlay. If the upstream raises we
    translate to 502 per API_SPEC §7.1.
    """
    if not default_limiter.check(make_key(auth.user_id, "tts"), 10, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "TTS limited to 10/min per user",
        )

    async def _streamer():
        try:
            async for chunk in tts_proxy.synthesize(payload.text, payload.voice_id):
                yield chunk
        except tts_proxy.UpstreamError as exc:
            # Once the body is opened we can't reset the status code — in
            # practice the error triggers before any chunk arrives because
            # synthesize() raises on the initial response.status_code check.
            raise http_error(
                status.HTTP_502_BAD_GATEWAY,
                "UPSTREAM_ERROR",
                f"ElevenLabs TTS failed: {exc}",
            ) from exc

    return StreamingResponse(_streamer(), media_type="audio/mpeg")
