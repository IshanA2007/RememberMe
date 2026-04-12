"""TTS proxy — streams ElevenLabs MP3 back to the caller.

Governed by:
  * docs/SERVICE_BACKEND.md §2.6
  * docs/API_SPEC.md §7.1
  * CLAUDE.md §5 (text max 1000 chars, voice never default to None -> use
    `ELEVENLABS_DEFAULT_VOICE_ID`)

Contract:
  * `synthesize(text, voice_id)` -> TtsStream (async context manager).
  * TtsStream.chunks() -> async iterator of raw MP3 bytes.
  * `open_stream` performs the HTTP request and checks the status code
    BEFORE returning, so the caller can raise a proper HTTP error before
    the StreamingResponse sends headers.
  * Raises `UpstreamError` on non-2xx responses; router maps to 502.
  * Never logs the API key.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from types import TracebackType

from app.config import get_settings

logger = logging.getLogger(__name__)

_ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
_DEFAULT_TIMEOUT_SECONDS = 30.0
_CHUNK_SIZE = 4096


class UpstreamError(Exception):
    """ElevenLabs TTS failed (non-2xx, timeout, network)."""


class TtsStream:
    """Holds the open httpx stream; use as an async context manager."""

    def __init__(self, client, response):  # noqa: ANN001
        self._client = client
        self._response = response

    async def chunks(self) -> AsyncIterator[bytes]:
        async for chunk in self._response.aiter_bytes(chunk_size=_CHUNK_SIZE):
            if chunk:
                yield chunk

    async def close(self) -> None:
        try:
            await self._response.aclose()
        except Exception:  # noqa: BLE001
            pass
        try:
            await self._client.aclose()
        except Exception:  # noqa: BLE001
            pass

    async def __aenter__(self) -> "TtsStream":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()


async def open_stream(
    text: str, voice_id: str | None = None
) -> TtsStream:
    """Open a TTS stream. Checks upstream status BEFORE returning.

    The caller gets back a `TtsStream` only if ElevenLabs responded 2xx.
    On any non-2xx (or network error) this raises `UpstreamError` so the
    router can translate to a proper 502 before HTTP headers are sent.

    The caller MUST close the stream (use `async with`).
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
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }

    client = httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_SECONDS)
    try:
        response = await client.send(
            client.build_request("POST", url, headers=headers, json=payload),
            stream=True,
        )
        if response.status_code >= 400:
            body = await response.aread()
            safe = body[:256].decode("utf-8", errors="replace")
            logger.warning(
                "ElevenLabs TTS non-2xx: %s body=%s",
                response.status_code,
                safe,
            )
            await response.aclose()
            await client.aclose()
            raise UpstreamError(
                f"ElevenLabs returned {response.status_code}"
            )
        return TtsStream(client, response)
    except UpstreamError:
        raise
    except httpx.HTTPError as exc:
        await client.aclose()
        logger.warning("ElevenLabs TTS network error: %s", exc)
        raise UpstreamError(f"ElevenLabs TTS network error: {exc}") from exc
    except Exception:
        await client.aclose()
        raise


# Keep the old generator interface as a convenience wrapper.
async def synthesize(
    text: str, voice_id: str | None = None
) -> AsyncIterator[bytes]:
    """Stream MP3 bytes from ElevenLabs for `text`.

    Yields chunks; raises `UpstreamError` on failure. Prefer `open_stream`
    in routers so the error surfaces before StreamingResponse sends headers.
    """
    async with await open_stream(text, voice_id) as stream:
        async for chunk in stream.chunks():
            yield chunk
