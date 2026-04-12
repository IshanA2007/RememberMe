"""Recognition service — InsightFace embedding + cosine matching.

Governed by:
  * docs/SERVICE_BACKEND.md §2.2
  * docs/PIPELINE.md §1.3 (server recognition handling)
  * docs/API_SPEC.md §10.5 (matched / unknown response shapes)
  * CLAUDE.md §5 (RECOGNITION_THRESHOLD=0.50, RECOGNITION_MARGIN=0.05,
    embedding dim=512 / float32)

Design:
  * InsightFace (`buffalo_l` on CPU) is loaded lazily at first use. If the
    package or model weights are unavailable the engine returns ``None`` and
    every `embed_image` call yields a 512-dim zero vector — recognition will
    always return `matched=false` in that degraded mode. This keeps the
    module importable in test/dev environments that don't ship the heavy
    C-extension InsightFace deps.
  * `embed_image` always L2-normalizes its output so cosine similarity
    reduces to a plain dot product against the already-normalized
    `PatientEmbeddingCache` entries.
  * `cosine_match` receives the normalized query vector + the cache entries
    list and returns `(best_entry, best_sim, second_sim)` — the decision rule
    (`best_sim >= threshold AND best_sim - second_sim >= margin`) lives at
    the caller (the WS router) so it can read the settings once per session.
"""

from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np

    from app.services.cache import EmbeddingCacheEntry

log = logging.getLogger(__name__)

# Module-level singleton for the loaded FaceAnalysis app. `None` until we have
# attempted to load; `False` signals "we tried and failed, do not retry".
_engine: Any = None
_load_attempted: bool = False


def get_engine() -> Any | None:
    """Return the InsightFace FaceAnalysis app, or ``None`` if unavailable.

    First call performs the lazy import + model preparation. On any failure
    (missing package, missing onnxruntime, missing model weights, GPU/CPU
    provider init failure) we log a single WARNING and return ``None`` for
    the remainder of the process lifetime.
    """
    global _engine, _load_attempted
    if _load_attempted:
        return _engine
    _load_attempted = True
    try:
        from insightface.app import FaceAnalysis  # type: ignore[import-not-found]

        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(320, 320))
        _engine = app
        log.info("InsightFace engine loaded (buffalo_l, CPU)")
    except Exception as exc:  # noqa: BLE001 — any failure means "degraded"
        log.warning(
            "InsightFace unavailable (%s); recognition will return stub-unknown",
            exc,
        )
        _engine = None
    return _engine


def embed_image(rgb_np: "np.ndarray") -> "np.ndarray":
    """Return a 512-dim float32 L2-normalized embedding for an RGB numpy image.

    Returns a zero vector when:
      * InsightFace is not available (degraded mode).
      * The image contains no detectable face.

    When multiple faces are detected the largest (by bbox area) wins —
    matching the MediaPipe-side behavior in `RememberMeInterface` which
    crops the focus face before sending.
    """
    import numpy as np  # deferred

    app = get_engine()
    if app is None:
        return np.zeros(512, dtype=np.float32)
    faces = app.get(rgb_np)
    if not faces:
        return np.zeros(512, dtype=np.float32)
    faces.sort(
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    emb = faces[0].normed_embedding.astype(np.float32)
    n = float(np.linalg.norm(emb))
    if n > 1e-9:
        emb = emb / n
    return emb.astype(np.float32, copy=False)


def cosine_match(
    query: "np.ndarray", entries: list["EmbeddingCacheEntry"]
) -> tuple["EmbeddingCacheEntry | None", float, float]:
    """Return `(best, best_sim, second_sim)` given an L2-normalized query.

    Both sides are expected to be pre-normalized so cosine similarity == dot
    product. When `entries` is empty, returns `(None, -1.0, -1.0)`. When only
    one entry is present, `second_sim` is `-1.0`.
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
