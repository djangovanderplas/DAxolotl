"""Thermocouple linearization for the NI 9213 module.

Implements the LabVIEW "Convert to Thermocouples.vi" reference chain
(adapted from the previous in-house tool — see ``reference/old_DA_tool``).
The chain handles cold-junction temperature, autozero, and the
manufacturer's calibrated lookup tables.

Pipeline (per sample)
---------------------
::

    cjc_C  = cjc_voltage_to_celcius(cjc_thermistor_V)
    cjc_V  = temperature_to_voltage(cjc_C, tc_type)
    meas_V = raw_V - autozero_V + cjc_V
    T_C    = voltage_to_temperature(meas_V, tc_type)

The CJC channel in TDMS is the **raw voltage** across the NI 9213's
on-board thermistor — not a temperature. ``cjc_voltage_to_celcius``
applies the module's gain compensation, voltage-divider resistance
inversion, and the Steinhart-Hart equation to recover °C. The defaults
below (``completion_resistance``, ``cjc_range``, ``cjc_gain_compensation``,
``cjc_offset``) are the NI 9213 factory values pulled directly from the
LabVIEW VI. Override only if your module is configured differently.

Lookup tables
-------------
``data/k_type.txt`` and ``data/t_type.txt`` are the NI 9213 calibration
tables in TSV format: ``temperature_C[TAB]voltage_V``, 1 °C spacing.
Coverage: K-type -270 → +1372 °C; T-type -270 → +400 °C. Tables are loaded
once at import via ``importlib.resources`` (not ``pkg_resources``, which
is deprecated). Interpolation is ``np.interp`` (vectorised linear) —
the reference's hand-rolled ``get_fractional_index`` /
``lookup_fractional_index`` were doing the same job, slower.

Unsupported thermocouple types return NaN so the channel is visible but
not silently miscalibrated.
"""

from __future__ import annotations

from importlib import resources

import numpy as np

# NI 9213 CJC thermistor defaults — LabVIEW "Convert to Thermocouples.vi".
_COMPLETION_RESISTANCE = 10000.0
_CJC_RANGE = 2.5
_CJC_GAIN_COMPENSATION = 32.0
_CJC_OFFSET = 1.0
# Steinhart-Hart coefficients (NI 9213 on-board thermistor).
_STEINHART_A = 0.0012873851
_STEINHART_B = 0.00023575235
_STEINHART_C = 9.497806e-8


def _load_table(name: str) -> tuple[np.ndarray, np.ndarray]:
    table_path = resources.files("daxolotl.processing").joinpath("data", f"{name}.txt")
    with resources.as_file(table_path) as path:
        data = np.loadtxt(path, delimiter="\t")
    return data[:, 0], data[:, 1]


_K_TEMP_C, _K_VOLTS = _load_table("k_type")
_T_TEMP_C, _T_VOLTS = _load_table("t_type")


def cjc_voltage_to_celcius(
    cjc: np.ndarray,
    completion_resistance: float = _COMPLETION_RESISTANCE,
    cjc_range: float = _CJC_RANGE,
    cjc_gain_compensation: float = _CJC_GAIN_COMPENSATION,
    cjc_offset: float = _CJC_OFFSET,
) -> np.ndarray:
    """Recover cold-junction °C from the NI 9213 CJC thermistor voltage.

    Parameters
    ----------
    cjc : ndarray
        Raw thermistor voltage (V) from the ``Thermocouples/CJC`` channel.
    completion_resistance, cjc_range, cjc_gain_compensation, cjc_offset
        NI 9213 hardware constants. Defaults match the LabVIEW VI; pass
        overrides only for a non-default module configuration.
    """
    cjc_compensated = cjc_gain_compensation * cjc
    cjc_resistance = (completion_resistance * cjc_compensated) / (cjc_range - cjc_compensated)
    ln_r = np.log(cjc_resistance)
    temp_k = 1.0 / (_STEINHART_A + ln_r * (_STEINHART_B + _STEINHART_C * ln_r * ln_r))
    return temp_k - (273.15 + cjc_offset)


def temperature_to_voltage(temperature_c: np.ndarray, tc_type: str) -> np.ndarray:
    """Forward NI 9213 lookup: temperature (°C) → thermocouple voltage (V)."""
    upper = tc_type.upper()
    if upper == "K":
        return np.interp(temperature_c, _K_TEMP_C, _K_VOLTS)
    if upper == "T":
        return np.interp(temperature_c, _T_TEMP_C, _T_VOLTS)
    return np.full_like(np.asarray(temperature_c, dtype=np.float64), np.nan)


def voltage_to_temperature(voltage_v: np.ndarray, tc_type: str) -> np.ndarray:
    """Inverse NI 9213 lookup: thermocouple voltage (V) → temperature (°C)."""
    upper = tc_type.upper()
    if upper == "K":
        return np.interp(voltage_v, _K_VOLTS, _K_TEMP_C)
    if upper == "T":
        return np.interp(voltage_v, _T_VOLTS, _T_TEMP_C)
    return np.full_like(np.asarray(voltage_v, dtype=np.float64), np.nan)


def linearize(
    raw_v: np.ndarray,
    tc_type: str,
    cjc_v: np.ndarray | None = None,
    autozero_v: np.ndarray | None = None,
) -> np.ndarray:
    """Convert a raw NI 9213 thermocouple voltage to °C.

    Applies the full CJC + autozero + lookup chain (see module docstring).

    Parameters
    ----------
    raw_v : ndarray
        Raw thermocouple junction voltage (V).
    tc_type : 'K' | 'T'
        Type letter from the channel's ``_type`` property. Anything else
        returns an array of NaN.
    cjc_v : ndarray, optional
        Raw thermistor voltage from the ``CJC`` channel. If ``None``,
        cold-junction compensation is skipped (only useful for unit tests).
    autozero_v : ndarray, optional
        Per-sample autozero offset (V) — subtracted from ``raw_v`` first.
    """
    if tc_type.upper() not in {"K", "T"}:
        return np.full_like(np.asarray(raw_v, dtype=np.float64), np.nan)

    measured_v = raw_v.astype(np.float64)
    if autozero_v is not None:
        measured_v = measured_v - autozero_v.astype(np.float64)
    if cjc_v is not None:
        cjc_c = cjc_voltage_to_celcius(cjc_v.astype(np.float64))
        measured_v = measured_v + temperature_to_voltage(cjc_c, tc_type)
    return voltage_to_temperature(measured_v, tc_type)
