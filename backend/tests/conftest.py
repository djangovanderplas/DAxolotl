"""Shared pytest fixtures.

The synthetic TDMS fixture mirrors the HF16 file's group/property
structure with controlled values, so unit tests can assert exact
numbers without checking a 280 MB binary into git. The real HF16 file
under ``data/HF16/`` is used by an opt-in integration test in
``test_tdms_loader.py``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from nptdms import ChannelObject, GroupObject, RootObject, TdmsWriter

N_SAMPLES = 1000
DT_US = 250  # 4 kHz, same as the real DAQ
T0_US = 1_000_000

# Bit layout the synthetic file uses; tests reference these by name.
O_MV_BIT = 10
F_MV_BIT = 18


def _valve_names() -> list[str]:
    names = [f"V{i:02d}" for i in range(32)]
    names[O_MV_BIT] = "O-MV"
    names[F_MV_BIT] = "F-MV"
    # Mark a normally-open valve so we can test unpowered-state XOR.
    names[8] = "O-BV"
    return names


@pytest.fixture(scope="session")
def synthetic_tdms(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Write a tiny TDMS file mirroring the real hotfire structure."""
    path = tmp_path_factory.mktemp("tdms") / "synthetic.tdms"

    ticks_u32 = (T0_US + np.arange(N_SAMPLES) * DT_US).astype(np.uint32)
    ticks_i32 = ticks_u32.astype(np.int32)
    ticks_f64 = ticks_u32.astype(np.float64)

    # Digital Outputs: O-MV bit flips on at idx 500. O-BV (bit 8, unpowered=1)
    # stays 0 in raw — so its *commanded* state should read True throughout.
    do_raw = np.zeros(N_SAMPLES, dtype=np.uint32)
    do_raw[500:] |= 1 << O_MV_BIT
    do_raw[700:] |= 1 << F_MV_BIT

    names = _valve_names()
    unpowered = ["0"] * 32
    unpowered[8] = "1"  # O-BV: normally open

    # Pressure: Chamber Eth — synthesise raw such that converted ramps 0 → 30 bar.
    p_slope, p_offset = 6250.0, -24.0
    target_bar = np.linspace(0.0, 30.0, N_SAMPLES)
    p_raw = (target_bar - p_offset) / p_slope

    # Load cell Thrust: ramps 0 → 10 kN.
    th_slope, th_offset = -9609320.0, -158.0
    target_n = np.linspace(0.0, 10_000.0, N_SAMPLES)
    th_raw = (target_n - th_offset) / th_slope

    # Thermocouples: raw = 0 V differential, autozero = 0, CJC is the *raw
    # thermistor voltage* (NI 9213 convention). 0.027 V is the value we see on
    # the real HF16 file and corresponds to a cold-junction temperature of
    # ~22.77 °C via the Steinhart-Hart chain. With zero differential, the
    # linearizer recovers exactly the cold-junction temperature for both types.
    tc_k = np.zeros(N_SAMPLES, dtype=np.float64)
    tc_t = np.zeros(N_SAMPLES, dtype=np.float64)
    autozero = np.zeros(N_SAMPLES, dtype=np.float64)
    cjc = np.full(N_SAMPLES, 0.027, dtype=np.float64)

    seq = np.arange(N_SAMPLES, dtype=np.int32)

    with TdmsWriter(path) as w:
        w.write_segment(
            [
                RootObject(properties={"name": "synthetic_HF"}),
                GroupObject("Digital Inputs"),
                ChannelObject(
                    "Digital Inputs",
                    "Digital Inputs",
                    np.zeros(N_SAMPLES, dtype=np.uint32),
                ),
                ChannelObject("Digital Inputs", "Ticks [us]", ticks_u32),
                GroupObject("Digital Outputs"),
                ChannelObject(
                    "Digital Outputs",
                    "Digital Outputs",
                    do_raw,
                    properties={
                        "Valve names": ";".join(names),
                        "Unpowered states": ";".join(unpowered),
                    },
                ),
                ChannelObject("Digital Outputs", "Ticks [us]", ticks_u32),
                GroupObject("General"),
                ChannelObject("General", "Active Sequence Step", seq),
                ChannelObject("General", "Elapsed Time [us]", ticks_i32),
                ChannelObject("General", "Ticks [us]", ticks_i32),
                GroupObject("Pressure Sensors"),
                ChannelObject(
                    "Pressure Sensors",
                    "Chamber Eth",
                    p_raw,
                    properties={"_slope": p_slope, "_offset": p_offset},
                ),
                ChannelObject("Pressure Sensors", "Ticks [us]", ticks_f64),
                GroupObject("Load Cells"),
                ChannelObject(
                    "Load Cells",
                    "Thrust",
                    th_raw,
                    properties={"_slope": th_slope, "_offset": th_offset},
                ),
                ChannelObject("Load Cells", "Ticks [us]", ticks_f64),
                GroupObject("Thermocouples"),
                ChannelObject("Thermocouples", "LOx Tank Top", tc_k, properties={"_type": "K"}),
                ChannelObject("Thermocouples", "Manifold Probe", tc_t, properties={"_type": "T"}),
                ChannelObject("Thermocouples", "Autozero", autozero),
                ChannelObject("Thermocouples", "CJC", cjc),
                ChannelObject("Thermocouples", "Ticks [us]", ticks_f64),
            ]
        )

    return path
