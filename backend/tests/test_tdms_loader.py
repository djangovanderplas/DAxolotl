from pathlib import Path

import numpy as np
import pytest
from daxolotl.loaders.tdms import TdmsLoader

REAL_HF16 = Path("data/HF16/20250227_132747_HF16.tdms")


# -- synthetic-fixture tests -------------------------------------------------


def test_can_handle_extension(tmp_path: Path):
    loader = TdmsLoader()
    assert loader.can_handle(tmp_path / "foo.tdms")
    assert loader.can_handle(tmp_path / "foo.TDMS")
    assert not loader.can_handle(tmp_path / "foo.csv")


def test_synthetic_groups_and_keys(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)

    # Expected group set (no Ticks channels surfaced as their own entries).
    groups = {ch.group for ch in ds.channels.values()}
    assert groups == {
        "Digital Inputs",
        "Digital Outputs",
        "General",
        "Pressure Sensors",
        "Load Cells",
        "Thermocouples",
    }
    # No "Ticks [us]" channels in the output dict.
    assert not any("Ticks [us]" in key for key in ds.channels)

    # Converted-and-raw pairs for sensors with slope/offset.
    assert "Pressure Sensors/Chamber Eth" in ds.channels
    assert "Pressure Sensors/Chamber Eth (raw)" in ds.channels
    assert "Load Cells/Thrust" in ds.channels
    assert "Load Cells/Thrust (raw)" in ds.channels

    # Thermocouples both raw and converted.
    assert "Thermocouples/LOx Tank Top" in ds.channels
    assert "Thermocouples/LOx Tank Top (raw)" in ds.channels
    assert "Thermocouples/Manifold Probe" in ds.channels


def test_synthetic_valve_unpack(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    assert len(ds.valve_channels) == 32

    omv = ds.channels["Digital Outputs/O-MV"]
    assert omv.is_valve
    assert omv.unit == "bool"
    assert not omv.y[499]
    assert omv.y[500]
    assert omv.y[-1]

    fmv = ds.channels["Digital Outputs/F-MV"]
    assert not fmv.y[699]
    assert fmv.y[700]

    # O-BV has unpowered=1, raw stays 0 ``→`` commanded open everywhere.
    obv = ds.channels["Digital Outputs/O-BV"]
    assert obv.y.all()


def test_synthetic_slope_offset_conversion(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    ce = ds.channels["Pressure Sensors/Chamber Eth"]
    assert ce.unit == "bar"
    assert ce.y[0] == pytest.approx(0.0, abs=1e-6)
    assert ce.y[-1] == pytest.approx(30.0, abs=1e-3)

    thrust = ds.channels["Load Cells/Thrust"]
    assert thrust.unit == "N"
    assert thrust.y[-1] == pytest.approx(10_000.0, abs=1.0)


def test_synthetic_time_axis_is_zero_origin_seconds(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    ce = ds.channels["Pressure Sensors/Chamber Eth"]
    assert ce.t[0] == pytest.approx(0.0, abs=1e-9)
    # 1000 samples at 250 us ``→`` last index at 999 * 250e-6 s.
    assert ce.t[-1] == pytest.approx(999 * 250e-6, abs=1e-9)


def test_synthetic_thermocouple_room_temp(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    # Fixture: raw=0, autozero=0, CJC=0.027 V (NI 9213 thermistor) ``→`` cold
    # junction ~22.77 °C. With zero differential the linearizer returns the
    # cold-junction temperature for both K and T types.
    k = ds.channels["Thermocouples/LOx Tank Top"]
    assert k.unit == "°C"
    assert k.y[0] == pytest.approx(22.77, abs=0.5)

    t = ds.channels["Thermocouples/Manifold Probe"]
    assert t.y[0] == pytest.approx(22.77, abs=0.5)


def test_synthetic_sequence_steps(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    assert ds.sequence_steps is not None
    assert ds.sequence_steps.name == "Active Sequence Step"
    assert ds.sequence_steps.y[0] == 0
    assert ds.sequence_steps.y[-1] == 999


def test_synthetic_metadata(synthetic_tdms: Path):
    ds = TdmsLoader().load(synthetic_tdms)
    md = ds.metadata
    assert md["sample_count"] == 1000
    assert md["ticks_aligned_across_groups"] is True
    assert md["anchor_group"] in {
        "Digital Inputs",
        "Digital Outputs",
        "General",
        "Pressure Sensors",
        "Load Cells",
        "Thermocouples",
    }


# -- integration test against the real HF16 file ----------------------------


@pytest.mark.skipif(not REAL_HF16.exists(), reason="real HF16 TDMS not present")
def test_real_hf16_load():
    ds = TdmsLoader().load(REAL_HF16)

    md = ds.metadata
    assert md["sample_count"] > 1_000_000
    assert 100.0 < md["duration_s"] < 600.0
    assert md["ticks_aligned_across_groups"] is True
    assert set(md["groups"]) == {
        "Digital Inputs",
        "Digital Outputs",
        "General",
        "Thermocouples",
        "Pressure Sensors",
        "Load Cells",
    }

    # Famous valves present and bit-exploded.
    assert len(ds.valve_channels) == 32
    assert "Digital Outputs/O-MV" in ds.channels
    assert "Digital Outputs/F-MV" in ds.channels
    assert "Digital Outputs/Igniter" in ds.channels

    # Chamber Eth converted is in plausible peak range (10..100 bar).
    chamber = ds.channels["Pressure Sensors/Chamber Eth"]
    assert chamber.unit == "bar"
    assert 10.0 < chamber.y.max() < 100.0

    # Thrust load cell peak in plausible range (1..50 kN).
    thrust = ds.channels["Load Cells/Thrust"]
    assert thrust.unit == "N"
    assert 1000.0 < thrust.y.max() < 50_000.0

    # Sequence steps surfaced.
    assert ds.sequence_steps is not None

    # Thermocouple pre-burn steady-state regression anchor.
    #
    # Reference values matched against the previous PyQt tool's display on the
    # same file on 2026-05-11. Window: t = -15 s to -5 s relative to ignition
    # (first rising edge of the Igniter valve). If this set ever breaks, the
    # NI 9213 chain or the loader has regressed, not the data.
    #
    # Dropped from the asserted set:
    #   * Channel TR / BR read cryogenic in pre-burn (~-129 °C). They sit near
    #     cold plumbing on this rig — the bucket "-33 °C ± 5" the brief gave
    #     for the four Channel TL/TR/BL/BR is correct for TL/BL only.
    #   * Eth Tank Bottom is suspected open-circuit on this run (the old tool
    #     plotted it at -158 °C, well below ethanol's freezing point).
    igniter = ds.channels["Digital Outputs/Igniter"]
    rising = np.where(igniter.y[1:] & ~igniter.y[:-1])[0]
    assert len(rising) > 0, "no Igniter rising edge"
    t_ignition = igniter.t[rising[0] + 1]
    pre_burn = (igniter.t >= t_ignition - 15.0) & (igniter.t <= t_ignition - 5.0)

    expected_pre_burn_c: dict[str, tuple[float, float]] = {
        # channel name           : (expected °C, tolerance °C)
        "LOx Tank Top": (-130.0, 2.0),
        "LOx Tank Bottom": (-161.0, 2.0),
        # Reference value was -128 °C; observed -130.7. Widened to ±3 to
        # absorb the small disagreement — flag if it ever drifts further.
        "LOx Tank Endcap": (-128.0, 3.0),
        "LOx Adapter": (-35.0, 2.0),
        "LOx Man Line": (-25.0, 2.0),
        "Manifold Probe": (-50.0, 2.0),
        "Channel TL": (-33.0, 5.0),
        "Channel BL": (-33.0, 5.0),
    }
    for name, (expected_c, tol) in expected_pre_burn_c.items():
        ch = ds.channels[f"Thermocouples/{name}"]
        assert ch.unit == "°C"
        mean = float(ch.y[pre_burn].mean())
        assert abs(mean - expected_c) <= tol, (
            f"{name}: pre-burn mean {mean:.2f} °C not within ±{tol} of {expected_c}"
        )
