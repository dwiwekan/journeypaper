"""A fixed-window request counter per key, per instance (milestone 1 is enough)."""
from __future__ import annotations

import threading
import time
from typing import Callable, Dict, Tuple


class RateLimiter:
    def __init__(self, per_minute: int, clock: Callable[[], float] = time.monotonic):
        self.per_minute = per_minute
        self.clock = clock
        self._hits: Dict[str, Tuple[int, int]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> bool:
        """Counts one request for key; False once the key is over its limit this minute."""
        window = int(self.clock() // 60)
        with self._lock:
            if len(self._hits) > 10_000:
                self._hits = {k: v for k, v in self._hits.items() if v[0] == window}
            w, n = self._hits.get(key, (window, 0))
            n = n + 1 if w == window else 1
            self._hits[key] = (window, n)
            return n <= self.per_minute
