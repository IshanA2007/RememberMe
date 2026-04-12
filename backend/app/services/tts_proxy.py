"""TTS proxy — streams ElevenLabs MP3 back to the caller.

Governed by:
  * docs/SERVICE_BACKEND.md §2.6
  * docs/API_SPEC.md §7.1
  * CLAUDE.md §5 (text max 1000 chars, voice never default to None -> use
    `ELEVENLABS_DEFAULT_VOICE_ID`)

Contract:
  * `synthesize(text, voice_id)` -> async iterator of raw MP3 bytes.
  * Raises `UpstreamError` on non-2xx responses; router maps to 502.
  * Never logs the API key.

We use `httpx.AsyncClient` with `stream()` so the audio chunks are yielded
as soon as they arrive — the router pipes these into a FastAPI
`StreamingResponse`, keeping TTFB low for the vision app.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from app.config import get_settings

logger = logging.getLogger(__name__)

_ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
_DEFAULT_TIMEOUT_SECONDS = 30.0
_CHUNK_SIZE = 4096


class UpstreamError(Exception):
    """ElevenLabs TTS failed (non-2xx, timeout, network)."""


async def synthesize(
    text: str, voice_id: str | None = None
) -> AsyncIterator[bytes]:
    """Stream MP3 bytes from ElevenLabs for `text`.

    The response streams chunk-by-chunk. Consumers should iterate via
    `async for chunk in synthesize(...)`. On any non-2xx from ElevenLabs
    (or network failure) we raise `UpstreamError` — the router maps this
    to `502 UPSTREAM_ERROR` per API_SPEC §7.1.
    """
    import httpx  # deferred

    settings = get_settings()
    effective_voice = voice_id or settings.ELEVENLABS_DEFAULT_VOICE_ID
    url = _ELEVENLABS_TTS_URL.format(voice_id=effective_voice)
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,  # NEVER log this
        "accept": "audio/mpeg",
        "content-type": "application/json",
    }
    # Model id / voice settings mirror ElevenLabs' canonical TTS request.
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }

    try:
        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_SECONDS) as client:
            async with client.stream(
                "POST", url, headers=headers, json=payload
            ) as response:
                if response.status_code >= 400:
                    # Read body for log context (never log API key / headers).
                    body = await response.aread()
                    safe = body[:256].decode("utf-8", errors="replace")
                    logger.warning(
                        "ElevenLabs TTS non-2xx: %s body=%s",
                        response.status_code,
                        safe,
                    )
                    raise UpstreamError(
                        f"ElevenLabs returned {response.status_code}"
                    )
                async for chunk in response.aiter_bytes(chunk_size=_CHUNK_SIZE):
                    if chunk:
                        yield chunk
    except UpstreamError:
        raise
    except httpx.HTTPError as exc:
        logger.warning("ElevenLabs TTS network error: %s", exc)
        raise UpstreamError(f"ElevenLabs TTS network error: {exc}") from exc
