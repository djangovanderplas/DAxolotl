"""Min/max binning decimation for plot display.

Given a series of length ``N`` and a target ``max_points`` ``M``, we partition
the input into ``M // 2`` contiguous buckets and emit, per bucket, the
``(t, y)`` pair at the bucket's minimum and the pair at its maximum. The
returned series therefore has up to ``M`` points and preserves both peaks
and valleys — a flat-line decimator would lose ignition/cutoff spikes.

Booleans and integer series work transparently; ``argmin``/``argmax`` over
``bool`` produces the first ``False`` and first ``True`` per bucket, which
is what you want for valve transitions.
"""

from __future__ import annotations

import numpy as np


def decimate_min_max(
    t: np.ndarray, y: np.ndarray, max_points: int
) -> tuple[np.ndarray, np.ndarray]:
    """Decimate ``(t, y)`` to at most ``max_points`` samples.

    Returns the input untouched when ``len(y) <= max_points`` or when
    ``max_points`` is too small to meaningfully bucket.
    """
    n = len(y)
    if n == 0 or max_points < 4 or n <= max_points:
        return t, y

    n_buckets = max_points // 2
    edges = np.linspace(0, n, n_buckets + 1, dtype=np.int64)

    out_t = np.empty(2 * n_buckets, dtype=t.dtype)
    out_y = np.empty(2 * n_buckets, dtype=y.dtype)

    for i in range(n_buckets):
        lo, hi = int(edges[i]), int(edges[i + 1])
        if hi <= lo:
            # Degenerate bucket — repeat the previous sample.
            ref = max(0, lo - 1)
            out_t[2 * i] = out_t[2 * i + 1] = t[ref]
            out_y[2 * i] = out_y[2 * i + 1] = y[ref]
            continue
        chunk = y[lo:hi]
        amin = int(np.argmin(chunk)) + lo
        amax = int(np.argmax(chunk)) + lo
        first, second = (amin, amax) if amin <= amax else (amax, amin)
        out_t[2 * i] = t[first]
        out_y[2 * i] = y[first]
        out_t[2 * i + 1] = t[second]
        out_y[2 * i + 1] = y[second]

    return out_t, out_y
