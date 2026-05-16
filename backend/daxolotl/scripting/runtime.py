"""Trusted-user Python scripting runtime for derived numeric channels.

This runtime intentionally uses ``exec()`` for local engineering workflows.
It is **not a sandbox**: scripts can consume CPU/memory, loop forever, inspect
objects reachable from exposed globals, and should only be run for trusted users
on a trusted machine. There is no process isolation, timeout, or resource limit.

# TODO(post-mvp): replace trusted ``exec()`` with RestrictedPython or a
# subprocess sandbox before broader/internal-web deployment.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import signal

from daxolotl.processing.filters import butterworth_lowpass, moving_average


@dataclass(frozen=True)
class ScriptResult:
    name: str
    y: np.ndarray


class ChannelNamespace:
    """Expose source channels by exact key and sanitized attribute name."""

    def __init__(self, channels: dict[str, np.ndarray]) -> None:
        self._channels = channels
        self._attributes: dict[str, np.ndarray] = {}
        for key, values in channels.items():
            attr = _sanitize_identifier(key.split("/")[-1])
            if attr not in self._attributes:
                self._attributes[attr] = values

    def __getitem__(self, key: str) -> np.ndarray:
        return self._channels[key]

    def __getattr__(self, name: str) -> np.ndarray:
        try:
            return self._attributes[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def keys(self) -> list[str]:
        return list(self._channels)


def run_script(
    *,
    code: str,
    output_name: str,
    t: np.ndarray,
    channels: dict[str, np.ndarray],
) -> list[ScriptResult]:
    """Execute trusted code and return final-expression / ``out_`` outputs."""
    namespace = ChannelNamespace(channels)
    locals_dict: dict[str, Any] = {
        "channels": namespace,
        "t": t,
    }
    globals_dict = {
        "__builtins__": {
            "abs": abs,
            "float": float,
            "int": int,
            "len": len,
            "max": max,
            "min": min,
            "range": range,
            "round": round,
            "sum": sum,
        },
        "np": np,
        "abs_": np.abs,
        "butter": lambda y, cutoff, order=4, fs=None: _butter(t, y, cutoff, order, fs),
        "decimate": _decimate,
        "differentiate": _differentiate,
        "integrate": _integrate,
        "moving_avg": moving_average,
        "notch": lambda y, freq, q, fs=None: _notch(t, y, freq, q, fs),
        "resample": lambda y, t_new: _resample(t, y, t_new),
    }
    compiled = compile(_capture_final_expression(code), "<daxolotl-script>", "exec")
    exec(compiled, globals_dict, locals_dict)

    results: list[ScriptResult] = []
    if "_result" in locals_dict:
        results.append(ScriptResult(output_name, _as_output(locals_dict["_result"], len(t))))

    out_values = [
        (key.removeprefix("out_"), value)
        for key, value in locals_dict.items()
        if key.startswith("out_")
    ]
    for suffix, value in sorted(out_values):
        name = output_name if len(out_values) == 1 and not results else f"{output_name} {suffix}"
        results.append(ScriptResult(name, _as_output(value, len(t))))

    if not results:
        raise ValueError("Script did not produce a final expression or out_* variable")
    return results


def _capture_final_expression(code: str) -> ast.Module:
    module = ast.parse(code, mode="exec")
    if module.body and isinstance(module.body[-1], ast.Expr):
        expr = module.body[-1]
        module.body[-1] = ast.Assign(
            targets=[ast.Name(id="_result", ctx=ast.Store())],
            value=expr.value,
            lineno=expr.lineno,
            col_offset=expr.col_offset,
        )
        ast.fix_missing_locations(module)
    return module


def _as_output(value: Any, expected_len: int) -> np.ndarray:
    arr = np.asarray(value, dtype=np.float64)
    if arr.ndim == 0:
        arr = np.full(expected_len, float(arr))
    if arr.ndim != 1:
        raise ValueError("Script outputs must be one-dimensional arrays or scalars")
    if len(arr) != expected_len:
        raise ValueError(
            f"Script output length {len(arr)} does not match time length {expected_len}"
        )
    return arr


def _sanitize_identifier(value: str) -> str:
    sanitized = re.sub(r"\W+", "_", value).strip("_")
    if not sanitized or sanitized[0].isdigit():
        sanitized = f"ch_{sanitized}"
    return sanitized


def _butter(
    t: np.ndarray,
    y: np.ndarray,
    cutoff: float,
    order: int,
    fs: float | None,
) -> np.ndarray:
    if fs is None:
        return butterworth_lowpass(t, np.asarray(y), cutoff_hz=float(cutoff), order=int(order))
    sos = signal.butter(int(order), float(cutoff), btype="lowpass", fs=float(fs), output="sos")
    return signal.sosfiltfilt(sos, np.asarray(y, dtype=np.float64))


def _notch(
    t: np.ndarray,
    y: np.ndarray,
    freq: float,
    q: float,
    fs: float | None,
) -> np.ndarray:
    sample_rate = fs if fs is not None else (len(t) - 1) / float(t[-1] - t[0])
    b, a = signal.iirnotch(float(freq), float(q), fs=float(sample_rate))
    return signal.filtfilt(b, a, np.asarray(y, dtype=np.float64))


def _resample(t: np.ndarray, y: np.ndarray, t_new: np.ndarray) -> np.ndarray:
    """Resample through anti-aliased polyphase filtering before interpolation."""
    target = np.asarray(t_new, dtype=np.float64)
    if len(target) == len(t):
        return np.interp(target, t, y)
    gcd = np.gcd(len(target), len(t))
    filtered = signal.resample_poly(
        np.asarray(y, dtype=np.float64),
        len(target) // gcd,
        len(t) // gcd,
    )
    source_t = np.linspace(float(t[0]), float(t[-1]), len(filtered))
    return np.interp(target, source_t, filtered)


def _decimate(y: np.ndarray, q: int) -> np.ndarray:
    """Downsample with scipy's anti-aliasing decimator."""
    return signal.decimate(np.asarray(y, dtype=np.float64), int(q), ftype="iir", zero_phase=True)


def _differentiate(y: np.ndarray, t: np.ndarray) -> np.ndarray:
    return np.gradient(np.asarray(y, dtype=np.float64), np.asarray(t, dtype=np.float64))


def _integrate(y: np.ndarray, t: np.ndarray) -> np.ndarray:
    values = np.asarray(y, dtype=np.float64)
    times = np.asarray(t, dtype=np.float64)
    out = np.zeros_like(values)
    if len(values) > 1:
        out[1:] = np.cumsum((values[:-1] + values[1:]) * 0.5 * np.diff(times))
    return out
