"""Recognition service — ArcFace embedding + cosine matching.

Governed by:
  * docs/SERVICE_BACKEND.md §2.2
  * docs/PIPELINE.md §1.3 (server recognition handling)
  * docs/API_SPEC.md §10.5 (matched / unknown response shapes)
  * CLAUDE.md §5 (RECOGNITION_THRESHOLD=0.50, RECOGNITION_MARGIN=0.05,
    embedding dim=512 / float32)

Design:
  * Uses the ONNX Runtime directly with an ArcFace 512-d embedding model
    (InsightFace's `w600k_mbf` — MobileFaceNet backbone, WebFace600K-trained).
    Detection runs client-side (MediaPipe); the server only embeds the crop.
  * Model weights are downloaded lazily to `backend/data/models/arcface.onnx`
    (via `_ensure_model`). Ships nothing by default — first use incurs a
    one-time ~13 MB download.
  * If downloading or loading fails, `embed_image` degrades to a 512-dim zero
    vector so recognition always answers `matched=false`; this keeps the
    process alive when the demo has no network.
  * `embed_image` always L2-normalizes so cosine similarity reduces to a dot
    product against the cache entries.
"""

from __future__ import annotations

import logging
import os
import threading
import zipfile
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np

    from app.services.cache import EmbeddingCacheEntry

log = logging.getLogger(__name__)

# Source: InsightFace buffalo_sc release (small/compact variant: detection + arcface).
# Total zip ~16 MB; we extract only the arcface file.
_BUFFALO_SC_URL = (
    "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip"
)
_ARCFACE_ZIP_MEMBER = "buffalo_sc/w600k_mbf.onnx"

_engine_lock = threading.Lock()
_session: Any = None
_load_attempted: bool = False


def _model_path() -> Path:
    """Target path for the ArcFace ONNX weights.

    Honors ``REMEMBERME_MODEL_DIR`` env var for override (useful in CI/tests);
    defaults to ``backend/data/models/arcface.onnx`` relative to the repo root.
    """

    root = os.environ.get("REMEMBERME_MODEL_DIR")
    if root:
        base = Path(root)
    else:
        # services/recognition.py -> app/services -> app -> backend
        base = Path(__file__).resolve().parents[2] / "data" / "models"
    return base / "arcface.onnx"


def _ensure_model(path: Path, timeout_seconds: float = 90.0) -> bool:
    """Download + extract the ArcFace ONNX if missing. Return True on success."""

    if path.exists() and path.stat().st_size > 0:
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    zip_path = path.with_suffix(".zip")

    try:
        import httpx  # deferred

        log.info("Downloading ArcFace model pack from %s", _BUFFALO_SC_URL)
        with httpx.stream("GET", _BUFFALO_SC_URL, timeout=timeout_seconds, follow_redirects=True) as r:
            r.raise_for_status()
            with zip_path.open("wb") as fh:
                for chunk in r.iter_bytes(chunk_size=131072):
                    fh.write(chunk)
    except Exception as exc:  # noqa: BLE001
        log.warning("ArcFace download failed (%s); recognition will degrade", exc)
        if zip_path.exists():
            zip_path.unlink(missing_ok=True)
        return False

    try:
        with zipfile.ZipFile(zip_path) as zf:
            # buffalo_sc zips nest under a top-level directory in some builds
            # and not in others. Scan for a *.onnx member matching arcface.
            target_member: str | None = None
            for name in zf.namelist():
                lower = name.lower().replace("\\", "/")
                if lower.endswith("w600k_mbf.onnx"):
                    target_member = name
                    break
            if target_member is None:
                log.warning(
                    "ArcFace zip did not contain w600k_mbf.onnx; members=%s",
                    zf.namelist(),
                )
                return False
            with zf.open(target_member) as src, path.open("wb") as dst:
                dst.write(src.read())
    except Exception as exc:  # noqa: BLE001
        log.warning("ArcFace extraction failed (%s)", exc)
        return False
    finally:
        zip_path.unlink(missing_ok=True)

    log.info("ArcFace model installed at %s (%d bytes)", path, path.stat().st_size)
    return True


def get_engine() -> Any | None:
    """Return an ``onnxruntime.InferenceSession`` for ArcFace, or ``None``.

    Lazy: the first call downloads the model (if missing) and loads the
    session. Subsequent calls return the cached session. Thread-safe.
    """

    global _session, _load_attempted
    with _engine_lock:
        if _load_attempted:
            return _session
        _load_attempted = True
        path = _model_path()
        if not _ensure_model(path):
            _session = None
            return None
        try:
            import onnxruntime as ort  # deferred

            providers = ["CPUExecutionProvider"]
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _session = ort.InferenceSession(str(path), sess_options=opts, providers=providers)
            inputs = [(i.name, i.shape) for i in _session.get_inputs()]
            outputs = [(o.name, o.shape) for o in _session.get_outputs()]
            log.info("ArcFace ONNX session loaded (inputs=%s outputs=%s)", inputs, outputs)
        except Exception as exc:  # noqa: BLE001
            log.warning("ArcFace load failed (%s); recognition will degrade", exc)
            _session = None
        return _session


def _preprocess(rgb_np: "np.ndarray") -> "np.ndarray":
    """Resize to 112x112, convert to NCHW float32 in [-1, 1]."""

    import numpy as np  # deferred
    from PIL import Image  # deferred

    if rgb_np.ndim == 2:
        rgb_np = np.stack([rgb_np] * 3, axis=-1)
    if rgb_np.shape[-1] == 4:
        rgb_np = rgb_np[..., :3]

    img = Image.fromarray(rgb_np.astype(np.uint8), mode="RGB").resize(
        (112, 112), Image.BILINEAR
    )
    arr = np.asarray(img, dtype=np.float32)
    # ArcFace: (x - 127.5) / 127.5 → [-1, 1]
    arr = (arr - 127.5) / 127.5
    # HWC → CHW → NCHW
    arr = np.transpose(arr, (2, 0, 1))[np.newaxis, :]
    return np.ascontiguousarray(arr, dtype=np.float32)


def embed_image(rgb_np: "np.ndarray") -> "np.ndarray":
    """Return a 512-dim float32 L2-normalized embedding for an RGB numpy image.

    Returns a zero vector when the model is unavailable (degraded mode).
    The caller guarantees the input is already cropped to a single face
    (MediaPipe on the Vision client performs detection + crop).
    """

    import numpy as np  # deferred

    sess = get_engine()
    if sess is None:
        return np.zeros(512, dtype=np.float32)

    try:
        x = _preprocess(rgb_np)
        input_name = sess.get_inputs()[0].name
        out = sess.run(None, {input_name: x})[0]  # shape (1, 512)
        emb = np.asarray(out, dtype=np.float32).reshape(-1)
        if emb.shape[0] != 512:
            log.warning("Unexpected embedding shape %s; returning zeros", emb.shape)
            return np.zeros(512, dtype=np.float32)
        norm = float(np.linalg.norm(emb))
        if norm > 1e-9:
            emb = emb / norm
        return emb.astype(np.float32, copy=False)
    except Exception as exc:  # noqa: BLE001
        log.warning("embed_image failed (%s); returning zeros", exc)
        return np.zeros(512, dtype=np.float32)


def cosine_match(
    query: "np.ndarray", entries: list["EmbeddingCacheEntry"]
) -> tuple["EmbeddingCacheEntry | None", float, float]:
    """Return `(best, best_sim, second_sim)` given an L2-normalized query.

    Both sides must be pre-normalized so cosine similarity == dot product.
    Empty entries: returns `(None, -1.0, -1.0)`. Single entry: `second_sim = -1.0`.
    """

    import numpy as np  # deferred

    if not entries:
        return None, -1.0, -1.0
    matrix = np.stack([e.embedding for e in entries])
    sims = (matrix @ query).astype(float)
    order = np.argsort(sims)[::-1]
    best = entries[int(order[0])]
    best_sim = float(sims[int(order[0])])
    second_sim = float(sims[int(order[1])]) if len(order) > 1 else -1.0
    return best, best_sim, second_sim
