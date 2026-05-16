"""Numeric filters used by plot data endpoints.

These functions run server-side on numpy arrays so the browser does not have to
filter millions of JavaScript numbers on the UI thread.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt


def sample_rate_hz(t: np.ndarray) -> float | None:
    """Estimate sample rate from a monotonic seconds array."""
    if len(t) < 2:
        return None
    duration = float(t[-1] - t[0])
    if not np.isfinite(duration) or duration <= 0:
        return None
    return float((len(t) - 1) / duration)


def moving_average(y: np.ndarray, window_samples: int) -> np.ndarray:
    """Centered moving average with edge shrinking."""
    window = max(1, int(round(window_samples)))
    if window <= 1 or len(y) <= 2:
        return np.asarray(y)

    arr = np.asarray(y, dtype=np.float64)
    radius = window // 2
    prefix = np.concatenate(([0.0], np.cumsum(arr)))
    out = np.empty_like(arr)
    for idx in range(len(arr)):
        start = max(0, idx - radius)
        end = min(len(arr), idx + radius + 1)
        out[idx] = (prefix[end] - prefix[start]) / (end - start)
    return out


def butterworth_lowpass(
    t: np.ndarray,
    y: np.ndarray,
    *,
    cutoff_hz: float,
    order: int = 4,
) -> np.ndarray:
    """Zero-phase Butterworth low-pass using scipy SOS filtering."""
    fs = sample_rate_hz(t)
    if fs is None or cutoff_hz <= 0 or len(y) <= max(16, order * 6):
        return np.asarray(y)

    cutoff = min(float(cutoff_hz), fs * 0.49)
    sos = butter(order, cutoff, btype="lowpass", fs=fs, output="sos")
    return sosfiltfilt(sos, np.asarray(y, dtype=np.float64))
