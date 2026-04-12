"""Embedding cache service — per-patient L2-normalized face embeddings.

Governed by:
  * docs/SERVICE_BACKEND.md §2.9
  * docs/PIPELINE.md §5 (refresh flow)
  * docs/DATA_SCHEMAS.md §8.1 / §4 (BLOB format = 512 float32 LE = 2048 bytes)
  * CLAUDE.md §5 (`CACHE_REFRESH_SECONDS = 30`)

Design:
  * One process, one `_caches` dict keyed by `patient_id`.
  * Per-patient `asyncio.Lock` serialises refreshes so concurrent WS
    connections for the same patient don't stampede the DB.
  * `invalidate` just flips the dirty flag + bumps version; the actual reload
    happens inside `refresh_if_stale` which is called before each recognition.
  * Cache entries store embeddings already L2-normalized so recognition can
    reduce cosine similarity to a plain dot product.

The `numpy` dependency is imported lazily at function level so `import
cache` succeeds in environments without numpy (e.g. during Task B5 import
smoke).
"""

from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TYPE_CHECKING

from app.config import get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np

# Embedding shape constants from DATA_SCHEMAS.md §4.
_EMBED_DIM = 512
_EMBED_BLOB_BYTES = _EMBED_DIM * 4  # 2048 bytes: 512 * sizeof(float32)


# ---------------------------------------------------------------------------
# Cache data shapes
# ---------------------------------------------------------------------------


@dataclass
class EmbeddingCacheEntry:
    """One L2-normalised face embedding with its display metadata."""

    face_id: int
    name: str
    title: str | None
    description: str | None
    embedding: "np.ndarray"  # float32[512], L2-normalized


@dataclass
class PatientEmbeddingCache:
    """All active face embeddings for one patient, plus refresh bookkeeping."""

    patient_id: int
    entries: list[EmbeddingCacheEntry] = field(default_factory=list)
    last_refreshed_at: datetime = field(
        default_factory=lambda: datetime.fromtimestamp(0, tz=timezone.utc)
    )
    dirty: bool = True
    version: int = 0


# ---------------------------------------------------------------------------
# Process-wide singletons
# ---------------------------------------------------------------------------


_caches: dict[int, PatientEmbeddingCache] = {}
_locks: dict[int, asyncio.Lock] = {}
# Top-level guard for lazily creating per-patient locks.
_locks_guard = asyncio.Lock()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _get_lock(patient_id: int) -> asyncio.Lock:
    """Return (creating if needed) the per-patient asyncio.Lock."""
    async with _locks_guard:
        lock = _locks.get(patient_id)
        if lock is None:
            lock = asyncio.Lock()
            _locks[patient_id] = lock
        return lock


# ---------------------------------------------------------------------------
# DB deserialization
# ---------------------------------------------------------------------------


def _l2_normalize(vec: "np.ndarray") -> "np.ndarray":
    """Return `vec / max(||vec||, eps)` so we never divide by zero."""
    import numpy as np  # deferred

    norm = float(np.linalg.norm(vec))
    if norm < 1e-9:
        # Degenerate embedding; keep as zero vector so dot product ~ 0.
        return vec.astype(np.float32, copy=False)
    return (vec / norm).astype(np.float32, copy=False)


def load_embeddings_from_db(
    conn: sqlite3.Connection, patient_id: int
) -> list[EmbeddingCacheEntry]:
    """Materialize all non-null embeddings for a patient.

    Skips rows whose BLOB is the wrong size (defensive — shouldn't happen if
    writers enforce the 2048-byte invariant, but we don't want one bad row
    to crash recognition for the rest of the patient's faces).
    """
    import numpy as np  # deferred

    rows = conn.execute(
        """
        SELECT id, name, title, description, embedding
        FROM faces
        WHERE patient_id = ? AND embedding IS NOT NULL
        """,
        (patient_id,),
    ).fetchall()
    entries: list[EmbeddingCacheEntry] = []
    for r in rows:
        blob: bytes = r["embedding"]
        if blob is None or len(blob) != _EMBED_BLOB_BYTES:
            # Skip malformed rows instead of exploding the whole cache.
            continue
        arr = np.frombuffer(blob, dtype=np.float32)
        if arr.shape != (_EMBED_DIM,):
            continue
        # numpy buffers returned by frombuffer are read-only; copy before norm.
        arr = np.array(arr, dtype=np.float32, copy=True)
        arr = _l2_normalize(arr)
        entries.append(
            EmbeddingCacheEntry(
                face_id=int(r["id"]),
                name=r["name"],
                title=r["title"],
                description=r["description"],
                embedding=arr,
            )
        )
    return entries


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------


async def get_cache(patient_id: int) -> PatientEmbeddingCache:
    """Return the cache for `patient_id`, creating an empty one on demand.

    Does NOT hit the DB; callers that need fresh data should follow up with
    `refresh_if_stale` (which will also trigger the first load).
    """
    cache = _caches.get(patient_id)
    if cache is None:
        cache = PatientEmbeddingCache(patient_id=patient_id)
        _caches[patient_id] = cache
    return cache


def invalidate(patient_id: int) -> None:
    """Mark the patient's cache as dirty + bump version. Cheap/sync."""
    cache = _caches.get(patient_id)
    if cache is None:
        cache = PatientEmbeddingCache(patient_id=patient_id)
        _caches[patient_id] = cache
    cache.dirty = True
    cache.version += 1


async def refresh(
    patient_id: int,
    conn_factory: "Any | None" = None,
) -> PatientEmbeddingCache:
    """Reload embeddings from the DB and atomically swap the entries list.

    `conn_factory` is either a callable returning a `sqlite3.Connection` or an
    open Connection. Injecting this keeps the service testable — production
    callers pass `app.db.open_connection`.
    """
    lock = await _get_lock(patient_id)
    async with lock:
        cache = await get_cache(patient_id)
        conn = _resolve_conn(conn_factory)
        owns_conn = conn_factory is None or callable(conn_factory)
        try:
            new_entries = load_embeddings_from_db(conn, patient_id)
        finally:
            if owns_conn:
                conn.close()
        # Atomic swap — last assignment wins. Python refs make this
        # effectively instantaneous; the old list is GC'd once no reader
        # holds it.
        cache.entries = new_entries
        cache.last_refreshed_at = _now_utc()
        cache.dirty = False
        return cache


async def refresh_if_stale(
    patient_id: int,
    conn_factory: "Any | None" = None,
) -> PatientEmbeddingCache:
    """Reload iff dirty OR older than `CACHE_REFRESH_SECONDS`.

    Acquires the per-patient lock for the duration of the (potential)
    reload so concurrent callers get one refresh, not N.
    """
    settings = get_settings()
    cache = await get_cache(patient_id)
    now = _now_utc()
    age = (now - cache.last_refreshed_at).total_seconds()
    if cache.dirty or age > settings.CACHE_REFRESH_SECONDS:
        return await refresh(patient_id, conn_factory)
    return cache


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_conn(conn_factory: "Any | None") -> sqlite3.Connection:
    """Accept either a callable factory or a live Connection; default to app.db."""
    if conn_factory is None:
        from app.db import open_connection  # local import to avoid cycles
        return open_connection()
    if callable(conn_factory):
        return conn_factory()
    return conn_factory  # assume it's a live Connection
