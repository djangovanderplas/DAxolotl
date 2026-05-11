import numpy as np
from daxolotl.decimation import decimate_min_max


def test_decimate_min_max_preserves_extremes_in_each_bucket() -> None:
    t = np.arange(8, dtype=float)
    y = np.array([0.0, 10.0, 1.0, 2.0, -5.0, 3.0, 4.0, 8.0])

    out_t, out_y = decimate_min_max(t, y, max_points=4)

    assert out_t.tolist() == [0.0, 1.0, 4.0, 7.0]
    assert out_y.tolist() == [0.0, 10.0, -5.0, 8.0]


def test_decimate_min_max_returns_input_when_already_small() -> None:
    t = np.arange(4, dtype=float)
    y = np.array([1.0, 2.0, 3.0, 4.0])

    out_t, out_y = decimate_min_max(t, y, max_points=4)

    assert out_t is t
    assert out_y is y


def test_decimate_min_max_handles_bool_valve_transitions() -> None:
    t = np.arange(8, dtype=float)
    y = np.array([False, False, True, False, False, True, True, False])

    _out_t, out_y = decimate_min_max(t, y, max_points=4)

    assert out_y.dtype == np.bool_
    assert out_y.tolist() == [False, True, False, True]
