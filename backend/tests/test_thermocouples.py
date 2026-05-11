import numpy as np
import pytest
from daxolotl.processing.thermocouples import (
    cjc_voltage_to_celcius,
    linearize,
    temperature_to_voltage,
    voltage_to_temperature,
)

# -- CJC thermistor chain ---------------------------------------------------


def test_cjc_thermistor_room_temperature():
    # 0.027 V is the value we see on the real HF16 CJC channel — expected
    # cold-junction temperature is ~22.77 °C with the NI 9213 defaults.
    t = cjc_voltage_to_celcius(np.array([0.027]))
    assert 22.0 < t[0] < 23.5


def test_cjc_thermistor_monotonic_in_voltage():
    # NI 9213 NTC: thermistor V rises as temperature falls, so the chain
    # is strictly decreasing in input voltage.
    t = cjc_voltage_to_celcius(np.array([0.020, 0.027, 0.035]))
    assert t[0] > t[1] > t[2]


# -- Lookup-table forward/inverse round-trip --------------------------------


def test_k_type_round_trip_at_known_points():
    temps = np.array([-100.0, 0.0, 25.0, 100.0, 500.0])
    v = temperature_to_voltage(temps, "K")
    back = voltage_to_temperature(v, "K")
    assert np.allclose(back, temps, atol=0.01)


def test_t_type_round_trip_at_known_points():
    temps = np.array([-100.0, 0.0, 25.0, 100.0, 300.0])
    v = temperature_to_voltage(temps, "T")
    back = voltage_to_temperature(v, "T")
    assert np.allclose(back, temps, atol=0.01)


def test_k_type_table_zero_volts_is_zero_c():
    t = voltage_to_temperature(np.array([0.0]), "K")
    assert abs(t[0]) < 0.1


def test_k_type_table_4_096_mv_near_100c():
    # NI 9213 calibration: V = 4.096 mV ``→`` ~100 °C.
    t = voltage_to_temperature(np.array([4.096e-3]), "K")
    assert abs(t[0] - 100.0) < 0.5


# -- linearize() full chain -------------------------------------------------


def test_linearize_recovers_cjc_when_raw_is_zero():
    # raw = 0 differential ``→`` measured_V == cjc_V ``→`` T == cjc_C.
    raw = np.zeros(3)
    cjc = np.array([0.027, 0.027, 0.027])
    t = linearize(raw, "K", cjc_v=cjc)
    expected = cjc_voltage_to_celcius(cjc)
    assert np.allclose(t, expected, atol=1e-6)


def test_linearize_no_cjc_is_plain_inverse_lookup():
    raw = np.array([0.001, 0.002, 0.004])
    expected = voltage_to_temperature(raw, "K")
    got = linearize(raw, "K")
    assert np.allclose(got, expected)


def test_autozero_subtracted_before_lookup():
    raw = np.array([0.001])  # 1 mV ``→`` ~25 °C K-type
    az = np.array([0.001])
    t = linearize(raw, "K", autozero_v=az)
    assert abs(t[0]) < 0.1


def test_linearize_full_chain_recovers_known_temperature():
    # Forge a TC reading: hot junction at -180 °C, cold junction at ~22.77 °C,
    # raw differential is V(-180) - V(22.77). Linearize should recover -180.
    cjc_v = np.array([0.027])
    cjc_c = cjc_voltage_to_celcius(cjc_v)
    v_hot = temperature_to_voltage(np.array([-180.0]), "K")
    v_cold = temperature_to_voltage(cjc_c, "K")
    raw_differential = v_hot - v_cold
    t = linearize(raw_differential, "K", cjc_v=cjc_v)
    assert t[0] == pytest.approx(-180.0, abs=0.1)


def test_unknown_type_returns_nan():
    t = linearize(np.array([0.001]), "Q", cjc_v=np.array([0.027]))
    assert np.isnan(t[0])
