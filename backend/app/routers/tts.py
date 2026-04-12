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

    We open the upstream connection and verify the status code BEFORE
    creating the StreamingResponse. This ensures any UpstreamError
    surfaces as a proper 502 JSON envelope instead of crashing inside
    the response body after headers are already sent.
    """
    if not default_limiter.check(make_key(auth.user_id, "tts"), 10, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "TTS limited to 10/min per user",
        )

    try:
        stream = await tts_proxy.open_stream(payload.text, payload.voice_id)
    except tts_proxy.UpstreamError as exc:
        raise http_error(
            status.HTTP_502_BAD_GATEWAY,
            "UPSTREAM_ERROR",
            f"ElevenLabs TTS failed: {exc}",
        ) from exc

    async def _streamer():
        async with stream:
            async for chunk in stream.chunks():
                yield chunk

    return StreamingResponse(_streamer(), media_type="audio/mpeg")
