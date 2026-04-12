"""WebSocket router — `/ws/recognize` (API_SPEC §10, PIPELINE §1).

Responsibilities:
  * Authenticate the connection (JWT via `?token=`; dev-bypass honors the
    same token shapes as REST).
  * Resolve the caller to a patient and enforce `auth.user_id == patient_id`.
  * Enforce single-session-per-patient (second connect → 4409).
  * Load the patient's face embedding cache; emit `session_ready`.
  * On each `recognize` frame: throttle, decode, embed (off-loop), match,
    emit a `recognition_result` or `error`.
  * On each `ping`: reply with `pong`.
  * On disconnect: release the session slot.

Close codes (API_SPEC §10.8):
  * 4401 — missing/invalid token.
  * 4403 — token does not own the requested patient.
  * 4409 — duplicate session for the same patient.
  * 4500 — cache could not load on connect.

Constants locked by CLAUDE.md §5:
  * 500 ms throttle between `recognize` frames.
  * 200 KB decoded image cap.
  * 512-dim float32 embedding.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.db import open_connection
from app.services import auth as auth_service
from app.services import cache as cache_service
from app.services import memory as memory_service
from app.services.recognition import cosine_match, embed_image

router = APIRouter()
log = logging.getLogger(__name__)

# Track live sessions so we can enforce one-per-patient (PIPELINE §1.1 step 5).
# Key = patient_id (string form, same as ws query param).
ACTIVE_SESSIONS: dict[str, WebSocket] = {}

# Throttle window (ms) between consecutive `recognize` frames from a single
# WS session (API_SPEC §10.4 / §11 / CLAUDE.md §5).
_RECOGNIZE_THROTTLE_MS = 500

# Decoded-image hard cap (API_SPEC §12 / CLAUDE.md §5).
_IMAGE_MAX_BYTES = 200 * 1024

# Accept only the two MIMEs enumerated by API_SPEC §10.4.
_ALLOWED_MIMES = {"image/jpeg", "image/png"}


def _iso_utc_now() -> str:
    """Millisecond-precision ISO 8601 UTC timestamp with trailing `Z`."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _ws_conn_factory() -> Any:
    """Thin closure so `cache_service.refresh*` can open fresh connections."""
    return open_connection()


@router.websocket("/ws/recognize")
async def recognize_ws(websocket: WebSocket) -> None:
    """`/ws/recognize` — per-patient real-time face recognition channel."""
    settings = get_settings()

    token = websocket.query_params.get("token")
    patient_id_q = websocket.query_params.get("patient_id")
    if not token or not patient_id_q:
        # Connection never accepted — just close with 4401 per §10.8.
        await websocket.close(code=4401, reason="missing_auth")
        return

    # --- JWT verification ---------------------------------------------------
    try:
        claims = auth_service.verify_jwt(token)
    except auth_service.AuthError as exc:
        log.info("ws 4401: %s", exc.message)
        await websocket.close(code=4401, reason="invalid_token")
        return
    except Exception as exc:  # noqa: BLE001 — any unexpected failure = 4401
        log.info("ws 4401: %s", exc)
        await websocket.close(code=4401, reason="invalid_token")
        return

    # --- User resolution ----------------------------------------------------
    # Use a dedicated connection for the session-setup phase so we don't hold
    # a DB handle open while idle.
    setup_conn = open_connection()
    try:
        try:
            auth_ctx = auth_service.resolve_user(claims, setup_conn)
        except auth_service.AuthError:
            await websocket.close(code=4401, reason="invalid_token")
            return
        if auth_ctx is None:
            await websocket.close(code=4401, reason="user_not_registered")
            return
        if auth_ctx.role != "patient" or str(auth_ctx.user_id) != str(patient_id_q):
            await websocket.close(code=4403, reason="forbidden")
            return

        # --- Single-session enforcement (PIPELINE §1.1 step 5) --------------
        if patient_id_q in ACTIVE_SESSIONS:
            await websocket.close(code=4409, reason="duplicate_session")
            return

        try:
            patient_id_int = int(patient_id_q)
        except ValueError:
            await websocket.close(code=4403, reason="forbidden")
            return

        await websocket.accept()
        ACTIVE_SESSIONS[patient_id_q] = websocket
    finally:
        setup_conn.close()

    # --- Handshake: load cache + send session_ready -------------------------
    try:
        try:
            await cache_service.refresh(
                patient_id_int, conn_factory=_ws_conn_factory
            )
            cache = await cache_service.get_cache(patient_id_int)
        except Exception as exc:  # noqa: BLE001 — all-cause fatal per §10.7
            log.exception("ws cache load failed")
            try:
                await websocket.send_json(
                    {
                        "type": "session_error",
                        "code": "CACHE_LOAD_FAILED",
                        "message": str(exc),
                    }
                )
            finally:
                await websocket.close(code=4500, reason="cache_load_failed")
            return

        await websocket.send_json(
            {
                "type": "session_ready",
                "patient_id": patient_id_q,
                "server_time": _iso_utc_now(),
                "embedding_cache_loaded": True,
                "face_count": len(cache.entries),
            }
        )

        # --- Main loop ------------------------------------------------------
        last_recognize_ms = 0.0
        loop = asyncio.get_event_loop()

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:  # noqa: BLE001 — any parse failure -> BAD_FRAME
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "BAD_FRAME",
                        "message": "invalid JSON",
                    }
                )
                continue
            if not isinstance(msg, dict):
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "BAD_FRAME",
                        "message": "frame must be a JSON object",
                    }
                )
                continue

            msg_id = msg.get("msg_id")
            t = msg.get("type")

            # ---- ping ------------------------------------------------------
            if t == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "msg_id": msg_id or "",
                        "server_time": _iso_utc_now(),
                    }
                )
                continue

            # ---- unknown type ---------------------------------------------
            if t != "recognize":
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "BAD_FRAME",
                        "message": "unknown type",
                    }
                )
                continue

            # ---- throttle ---------------------------------------------------
            now_ms = time.monotonic() * 1000
            if now_ms - last_recognize_ms < _RECOGNIZE_THROTTLE_MS:
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "RATE_LIMITED",
                        "message": f"throttle {_RECOGNIZE_THROTTLE_MS}ms",
                    }
                )
                continue
            last_recognize_ms = now_ms

            # ---- mime check ------------------------------------------------
            mime = msg.get("image_mime", "")
            if mime not in _ALLOWED_MIMES:
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "UNSUPPORTED_MIME",
                        "message": f"image_mime {mime!r} not supported",
                    }
                )
                continue

            # ---- base64 decode + size check --------------------------------
            b64 = msg.get("image_b64", "")
            if not isinstance(b64, str) or not b64:
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "BAD_FRAME",
                        "message": "image_b64 missing",
                    }
                )
                continue
            try:
                raw_bytes = base64.b64decode(b64, validate=True)
            except Exception:  # noqa: BLE001 — any b64 failure -> BAD_FRAME
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "BAD_FRAME",
                        "message": "bad base64",
                    }
                )
                continue
            if len(raw_bytes) > _IMAGE_MAX_BYTES:
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "IMAGE_TOO_LARGE",
                        "message": f"decoded > {_IMAGE_MAX_BYTES} bytes",
                    }
                )
                continue

            # ---- cache refresh (if dirty / stale) --------------------------
            try:
                await cache_service.refresh_if_stale(
                    patient_id_int, conn_factory=_ws_conn_factory
                )
                cache = await cache_service.get_cache(patient_id_int)
            except Exception:  # noqa: BLE001
                log.exception("ws cache refresh failed")
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "INTERNAL_ERROR",
                        "message": "cache",
                    }
                )
                continue

            # ---- embed in executor (CPU-bound, don't block loop) -----------
            try:

                def _compute(raw_bytes: bytes = raw_bytes):  # bind default
                    from PIL import Image
                    import numpy as np

                    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
                    rgb = np.asarray(img)
                    return embed_image(rgb)

                emb = await loop.run_in_executor(None, _compute)
            except Exception:  # noqa: BLE001
                log.exception("ws embed failed")
                await websocket.send_json(
                    {
                        "type": "error",
                        "msg_id": msg_id,
                        "code": "RECOGNIZER_FAILED",
                        "message": "embed",
                    }
                )
                continue

            best, best_sim, second_sim = cosine_match(emb, cache.entries)
            matched = (
                best is not None
                and best_sim >= settings.RECOGNITION_THRESHOLD
                and (best_sim - second_sim) >= settings.RECOGNITION_MARGIN
            )

            if matched and best is not None:
                # Open a short-lived connection for the memory read so we
                # don't hold one open for the whole session.
                mem_conn = open_connection()
                try:
                    summary = memory_service.recent_memory_summary(
                        mem_conn, best.face_id
                    )
                finally:
                    mem_conn.close()
                await websocket.send_json(
                    {
                        "type": "recognition_result",
                        "msg_id": msg_id or "",
                        "frame_id": msg.get("frame_id", ""),
                        "matched": True,
                        "face_id": str(best.face_id),
                        "name": best.name,
                        "title": best.title,
                        "confidence": float(best_sim),
                        "margin": float(best_sim - second_sim),
                        "recent_memory_summary": summary,
                        "server_time": _iso_utc_now(),
                    }
                )
            else:
                await websocket.send_json(
                    {
                        "type": "recognition_result",
                        "msg_id": msg_id or "",
                        "frame_id": msg.get("frame_id", ""),
                        "matched": False,
                        "embedding": [float(v) for v in emb.tolist()],
                        "best_similarity": float(best_sim) if best is not None else 0.0,
                        "server_time": _iso_utc_now(),
                    }
                )

    except WebSocketDisconnect:
        # Client gone — release the session slot silently.
        pass
    except Exception:  # noqa: BLE001 — never let a WS crash kill the app
        log.exception("ws session error")
    finally:
        # Release the single-session lock unconditionally so a reconnect can
        # land even if something above raised.
        ACTIVE_SESSIONS.pop(patient_id_q, None)
