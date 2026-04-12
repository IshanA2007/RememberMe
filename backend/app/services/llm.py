"""LLM service — Anthropic Messages API wrapper for memory extraction.

Governed by:
  * docs/SERVICE_BACKEND.md §2.5
  * docs/PIPELINE.md §2.3 (deterministic prompt template — use VERBATIM)
  * CLAUDE.md §5 (per-memory cap: 180 chars)
  * Plan §0.4 (default model: claude-sonnet-4-5, temperature 0.2, max_tokens 512)

Contract:
  * `summarize(transcript, faces)` returns list[{"face_id": int, "content": str}]
  * Drops any face_id not in the provided set.
  * Hard-caps each memory `content` at 180 chars.
  * On ANY failure (network, non-JSON, bad shape) raises `LlmError`.

The Anthropic SDK is synchronous; callers should run `summarize` inside
`asyncio.loop.run_in_executor` when called from an async context.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterable

from app.config import get_settings

logger = logging.getLogger(__name__)

# Hard caps from CLAUDE.md §5 / SERVICE_BACKEND §2.5.
_CONTENT_HARD_CAP = 180
_MAX_TOKENS = 512
_TEMPERATURE = 0.2


class LlmError(Exception):
    """Any failure in the LLM round-trip: network, parse, or shape."""


# ---------------------------------------------------------------------------
# Prompt construction — uses the exact template from PIPELINE.md §2.3.
# ---------------------------------------------------------------------------


def _build_prompt(transcript: str, faces: Iterable[dict[str, Any]]) -> str:
    """Render the deterministic PIPELINE.md §2.3 template.

    `faces` must be an iterable of dicts with `face_id` (stringifiable),
    `name`, and optional `title`.
    """
    people_json = json.dumps(
        [
            {
                "face_id": str(f["face_id"]),
                "name": f.get("name", ""),
                "title": f.get("title"),
            }
            for f in faces
        ],
        ensure_ascii=False,
    )
    return (
        "You extract short factual memories from spoken conversations involving a dementia patient.\n"
        "Each memory must be:\n"
        "  - At most 180 characters\n"
        "  - A single self-contained fact (no pronouns requiring outside context)\n"
        "  - Attributable to one of the people present\n"
        "\n"
        f"People present (by face_id): {people_json}\n"
        "\n"
        "Conversation transcript:\n"
        '"""\n'
        f"{transcript}\n"
        '"""\n'
        "\n"
        "Output JSON only, schema:\n"
        '{ "memories": [ { "face_id": "<string>", "content": "<string>" } ] }\n'
        "\n"
        "Rules:\n"
        "  - Only include face_ids from the \"People present\" list\n"
        "  - If a fact has no clear owner, omit it\n"
        "  - Return an empty memories array if no clear facts\n"
    )


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------


def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse the first JSON object from `text`.

    We're lenient: some models wrap JSON in markdown fences. Strategy:
      1. Try `json.loads` directly.
      2. Otherwise locate the first `{` and pair it with the matching `}`.
    """
    stripped = text.strip()
    try:
        result = json.loads(stripped)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Fallback: slice from first '{' to the matching closing brace.
    start = stripped.find("{")
    if start == -1:
        raise LlmError("LLM response contained no JSON object")
    depth = 0
    for idx in range(start, len(stripped)):
        ch = stripped[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = stripped[start : idx + 1]
                try:
                    parsed = json.loads(candidate)
                except json.JSONDecodeError as exc:
                    raise LlmError(f"LLM JSON failed to parse: {exc}") from exc
                if not isinstance(parsed, dict):
                    raise LlmError("LLM JSON root must be an object")
                return parsed
    raise LlmError("LLM JSON object was not closed")


# ---------------------------------------------------------------------------
# Anthropic client accessor
# ---------------------------------------------------------------------------


def _get_client() -> Any:
    """Return a cached Anthropic client instance. Imported lazily."""
    global _client_singleton
    if _client_singleton is not None:
        return _client_singleton
    try:
        from anthropic import Anthropic  # deferred — keeps module importable
    except ImportError as exc:  # pragma: no cover
        raise LlmError("anthropic package is not installed") from exc
    settings = get_settings()
    _client_singleton = Anthropic(api_key=settings.LLM_API_KEY)
    return _client_singleton


_client_singleton: Any | None = None


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def summarize(
    transcript: str, faces: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Call the LLM and return validated `[{face_id:int, content:str}]`.

    Contract:
      * face_id in the return set is always a Python int (for DB writes).
      * content length is always ≤ 180.
      * Empty list is a valid answer.
    Any error → `LlmError`.
    """
    settings = get_settings()
    prompt = _build_prompt(transcript, faces)
    allowed_ids = {str(f["face_id"]) for f in faces}

    try:
        client = _get_client()
        response = client.messages.create(
            model=settings.LLM_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            messages=[{"role": "user", "content": prompt}],
        )
    except LlmError:
        raise
    except Exception as exc:  # noqa: BLE001 — map all provider errors
        logger.exception("LLM call failed")
        raise LlmError(f"LLM call failed: {exc}") from exc

    try:
        # `response.content` is a list of content blocks; we only use the first
        # text block per Anthropic convention.
        blocks = getattr(response, "content", None) or []
        if not blocks:
            raise LlmError("LLM response had no content blocks")
        raw_text = getattr(blocks[0], "text", None)
        if not isinstance(raw_text, str):
            raise LlmError("LLM response first block is not text")
    except LlmError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise LlmError(f"LLM response shape unexpected: {exc}") from exc

    payload = _extract_json_object(raw_text)
    memories_raw = payload.get("memories")
    if not isinstance(memories_raw, list):
        raise LlmError("LLM JSON missing `memories` array")

    cleaned: list[dict[str, Any]] = []
    for item in memories_raw:
        if not isinstance(item, dict):
            continue
        face_id_raw = item.get("face_id")
        content_raw = item.get("content")
        if not isinstance(face_id_raw, (str, int)) or not isinstance(content_raw, str):
            continue
        face_id_str = str(face_id_raw)
        if face_id_str not in allowed_ids:
            continue
        try:
            face_id_int = int(face_id_str)
        except ValueError:
            continue
        content = content_raw.strip()
        if not content:
            continue
        if len(content) > _CONTENT_HARD_CAP:
            content = content[:_CONTENT_HARD_CAP]
        cleaned.append({"face_id": face_id_int, "content": content})
    return cleaned
