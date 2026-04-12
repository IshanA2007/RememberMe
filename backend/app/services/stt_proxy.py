"""STT proxy — ElevenLabs speech-to-text.

Governed by:
  * docs/SERVICE_BACKEND.md §2.7
  * docs/API_SPEC.md §7.2
  * CLAUDE.md §5 (audio max 10 MB — enforced upstream in the router)

Contract:
  * `transcribe(audio_bytes, filename, mime) -> dict` matching `SttResponse`:
      { "transcript": str, "confidence": float, "duration_seconds": float }
  * Raises `UpstreamError` on non-2xx or network failure.
  * Never logs the API key.

ElevenLabs STT response shape reference:
  POST https://api.elevenlabs.io/v1/speech-to-text (as of 2025)
  {
    "text": "...",
    "language_code": "en",
    "language_probability": 0.99,
    "words": [ { "text": "...", "start": 0.0, "end": 0.4, "type": "word" }, ... ]
  }

The mapping below:
  * `transcript`       <- response["text"]
  * `confidence`       <- response["language_probability"] if present, else 1.0
  * `duration_seconds` <- max(word["end"]) over words, else 0.0

If ElevenLabs changes the field names, adjust the mapping here — clients
and the rest of the backend only see the API_SPEC shape.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

_ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
_DEFAULT_TIMEOUT_SECONDS = 60.0
_DEFAULT_MODEL_ID = "scribe_v1"


class UpstreamError(Exception):
    """ElevenLabs STT failed (non-2xx, timeout, network)."""


def _derive_confidence(body: dict[str, Any]) -> float:
    """Pick a best-effort confidence in [0, 1]."""
    prob = body.get("language_probability")
    if isinstance(prob, (int, float)) and 0.0 <= float(prob) <= 1.0:
        return float(prob)
    return 1.0


def _derive_duration(body: dict[str, Any]) -> float:
    """Best-effort clip duration in seconds, taken from the last word's end."""
    words = body.get("words")
    if not isinstance(words, list):
        return 0.0
    latest = 0.0
    for w in words:
        if not isinstance(w, dict):
            continue
        end = w.get("end")
        if isinstance(end, (int, float)):
            latest = max(latest, float(end))
    return latest


async def transcribe(
    audio_bytes: bytes, filename: str, mime: str
) -> dict[str, Any]:
    """Upload the audio clip and return the normalized STT response."""
    import httpx  # deferred

    settings = get_settings()
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,  # NEVER log this
        "accept": "application/json",
    }
    # multipart form; ElevenLabs requires model_id.
    files = {"file": (filename, audio_bytes, mime or "application/octet-stream")}
    data = {"model_id": _DEFAULT_MODEL_ID}

    try:
        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _ELEVENLABS_STT_URL,
                headers=headers,
                files=files,
                data=data,
            )
        if response.status_code >= 400:
            safe = response.text[:256]
            logger.warning(
                "ElevenLabs STT non-2xx: %s body=%s", response.status_code, safe
            )
            raise UpstreamError(
                f"ElevenLabs returned {response.status_code}"
            )
        body: Any = response.json()
    except UpstreamError:
        raise
    except httpx.HTTPError as exc:
        logger.warning("ElevenLabs STT network error: %s", exc)
        raise UpstreamError(f"ElevenLabs STT network error: {exc}") from exc
    except ValueError as exc:
        logger.warning("ElevenLabs STT JSON parse failed: %s", exc)
        raise UpstreamError("ElevenLabs STT returned non-JSON body") from exc

    if not isinstance(body, dict):
        raise UpstreamError("ElevenLabs STT root was not an object")
    transcript = body.get("text")
    if not isinstance(transcript, str):
        raise UpstreamError("ElevenLabs STT body missing `text`")

    return {
        "transcript": transcript,
        "confidence": _derive_confidence(body),
        "duration_seconds": _derive_duration(body),
    }
