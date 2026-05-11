"""Parquet storage for processed channel data.

One ``.parquet`` per dataset. Layout:

    column ``t``     : float64, seconds, zero at dataset start.
    column ``ch_<id>`` : the channel's ``y`` array, native dtype.

The shared ``t`` column assumes all channels in the dataset are on the same
timebase — true for every TDMS file we've seen, and asserted at load time
by the TDMS loader's ``ticks_aligned_across_groups`` metadata flag. If a
future file diverges, the loader will surface that fact and this writer
will need to split per-group.

# TODO(post-mvp): per-group parquet for divergent timebases.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from daxolotl.config import settings
from daxolotl.loaders.base import LoadedDataset


def processed_path_for(dataset_id: int, test_id: str) -> Path:
    """Where the dataset's parquet cache lives. Sibling of raw test data."""
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in test_id)
    return settings.data_dir.resolve() / ".processed" / f"{safe}_{dataset_id}.parquet"


def write_dataset_parquet(
    loaded: LoadedDataset, channels_by_id: dict[int, str], path: Path
) -> None:
    """Materialise the dataset to a parquet file.

    ``channels_by_id`` maps the DB-assigned channel ID to the
    ``LoadedDataset.channels`` key (``"Group/Name"``).
    """
    if not loaded.channels:
        raise ValueError("LoadedDataset has no channels to write")

    sample_t = next(iter(loaded.channels.values())).t
    arrays: list[pa.Array] = [pa.array(sample_t)]
    names: list[str] = ["t"]
    for ch_id, key in channels_by_id.items():
        arrays.append(pa.array(loaded.channels[key].y))
        names.append(f"ch_{ch_id}")

    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_arrays(arrays, names=names), path, compression="snappy")


def read_channel_data(
    parquet_path: Path,
    column_name: str,
    t_min: float | None = None,
    t_max: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Read ``t`` and one channel column, optionally clipped by time range."""
    table = pq.read_table(parquet_path, columns=["t", column_name])
    t = table.column("t").to_numpy()
    y = table.column(column_name).to_numpy()
    if t_min is None and t_max is None:
        return t, y
    mask = np.ones(len(t), dtype=bool)
    if t_min is not None:
        mask &= t >= t_min
    if t_max is not None:
        mask &= t <= t_max
    return t[mask], y[mask]
