import numpy as np
import pytest
from daxolotl.processing.valves import parse_valve_metadata, unpack_valves


def test_parse_metadata_round_trip():
    names = ";".join(f"V{i:02d}" for i in range(32))
    unp = ";".join("1" if i % 3 == 0 else "0" for i in range(32))
    n, u = parse_valve_metadata(names, unp)
    assert n[0] == "V00"
    assert n[31] == "V31"
    assert u.shape == (32,)
    assert u[0] == 1 and u[1] == 0


def test_parse_metadata_rejects_wrong_count():
    with pytest.raises(ValueError):
        parse_valve_metadata("a;b;c", "0;0;0")


def test_unpack_known_bits():
    packed = np.array(
        [
            0,
            1 << 10,
            (1 << 10) | (1 << 17),
            np.uint32(0xFFFFFFFF),
        ],
        dtype=np.uint32,
    )
    unp = np.zeros(32, dtype=np.uint8)
    out = unpack_valves(packed, unp)
    assert out.shape == (32, 4)

    assert out.dtype == np.bool_
    assert not out[10, 0]
    assert out[10, 1] and out[10, 2]
    assert not out[17, 1] and out[17, 2]
    assert out[0, 3] and out[31, 3]


def test_unpack_xor_unpowered():
    # Bit 8 is normally-open: raw 0 means "commanded open".
    packed = np.array([0, 1 << 8], dtype=np.uint32)
    unp = np.zeros(32, dtype=np.uint8)
    unp[8] = 1
    out = unpack_valves(packed, unp)
    assert out[8, 0]  # raw 0 XOR unpowered 1 ``→`` commanded open
    assert not out[8, 1]  # raw 1 XOR unpowered 1 ``→`` commanded closed


def test_unpack_casts_non_uint32_input():
    packed = np.array([1 << 5], dtype=np.int64)
    unp = np.zeros(32, dtype=np.uint8)
    out = unpack_valves(packed, unp)
    assert out[5, 0]
