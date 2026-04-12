"""In-process token-bucket-ish rate limiter.

Governed by:
  * docs/API_SPEC.md §11 (rate limit table)
  * docs/SERVICE_BACKEND.md §2.6 / §2.7 (per-user budgets)

Simple sliding-window counter per `(user_id, scope)` key. Implementation:
a deque of monotonic timestamps; on `check` we evict entries older than
the window, then decide if the newest request would exceed `max_per_window`.

Scope strings used across the codebase:
  * `"tts"`          -> 10 req/min (API_SPEC §11)
  * `"stt"`          -> 30 req/min
  * `"conversations"`-> 30 req/min
  * `"write"`        -> 120 req/min
  * `"read"`         -> 600 req/min

This is process-local — fine for the single-host hackathon deployment.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable


class RateLimiter:
    """Thread-safe sliding-window limiter keyed by arbitrary string."""

    def __init__(self, time_fn: Callable[[], float] | None = None) -> None:
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._time_fn = time_fn or time.monotonic

    def check(self, key: str, max_per_window: int, window_seconds: float) -> bool:
        """Return True if this request fits in the budget; False if it doesn't.

        On True the request is counted (timestamp pushed onto the bucket).
        On False no timestamp is recorded — the caller should emit a 429.
        """
        if max_per_window <= 0 or window_seconds <= 0:
            return False
        now = self._time_fn()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._buckets[key]
            # Evict expired entries from the left.
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= max_per_window:
                return False
            bucket.append(now)
            return True

    def reset(self, key: str | None = None) -> None:
        """Clear one or all buckets. Intended for tests."""
        with self._lock:
            if key is None:
                self._buckets.clear()
            else:
                self._buckets.pop(key, None)


# A module-level default instance so callers can share state across the app.
# Not a hard singleton — tests can instantiate their own limiter.
default_limiter = RateLimiter()


def make_key(user_id: int, scope: str) -> str:
    """Canonical key format: `<user_id>:<scope>`."""
    return f"{user_id}:{scope}"
