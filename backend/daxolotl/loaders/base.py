"""Loader contract.

Each concrete loader (TDMS, CSV, ...) implements the ``Loader`` protocol and
returns a ``LoadedDataset`` shaped for the rest of the app: a flat
``{group_name/channel_name -> ChannelData}`` mapping, the merged time origin
already applied, and side-channels (sequence steps, valve list) called out
explicitly so the UI doesn't have to rediscover them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np


@dataclass
class ChannelData:
    """A single 1-D time-series channel.

    ``t`` and ``y`` have the same length. ``t`` is seconds, zero at start
    of the parent dataset. ``properties`` carries any pass-through metadata
    from the source file (slope/offset/type/...).
    """

    name: str
    group: str
    unit: str | None
    t: np.ndarray
    y: np.ndarray
    properties: dict[str, Any] = field(default_factory=dict)
    is_valve: bool = False

    @property
    def key(self) -> str:
        """The dict key used in ``LoadedDataset.channels``."""
        return f"{self.group}/{self.name}"


@dataclass
class LoadedDataset:
    """The contract every loader returns.

    Attributes
    ----------
    name : str
        Human-readable dataset name (file stem if the source has nothing better).
    channels : dict[str, ChannelData]
        Keyed by ``"GroupName/ChannelName"``. For sensors with a slope/offset
        or thermocouples with a type, the *converted* (engineering-units)
        channel is the bare ``"Group/Name"`` and the raw values live under
        ``"Group/Name (raw)"``.
    metadata : dict
        File-level info: sample count, duration, anchor group, raw root
        properties, etc.
    sequence_steps : ChannelData | None
        The ``General/Active Sequence Step`` channel surfaced separately so
        the UI can render it as a banded overlay without re-discovering it.
    valve_channels : list[str]
        Channel keys that correspond to bit-unpacked valve states. The UI
        uses this to populate the "valves overlay" picker.
    """

    name: str
    channels: dict[str, ChannelData]
    metadata: dict[str, Any]
    sequence_steps: ChannelData | None
    valve_channels: list[str]


class Loader(Protocol):
    """Anything that can recognise and parse a source file into a dataset."""

    def can_handle(self, path: Path) -> bool: ...
    def load(self, path: Path) -> LoadedDataset: ...
