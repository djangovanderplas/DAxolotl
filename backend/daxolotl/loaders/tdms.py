"""TDMS loader for NI DAQ hotfire / coldflow files.

This is the file-format-specific code that produces a ``LoadedDataset``
from a National Instruments ``.tdms`` recording. Read this first if you
need to onboard a new test rig — the quirks documented below are not in
the file itself.

Quirks handled (verified against the HF16 20250227 file)
--------------------------------------------------------
1. **Per-group ``Ticks [us]`` channels.** Every group carries its own
   uint32/int32/float64 ``Ticks [us]`` array. On HF16 they're byte-identical
   across groups, so the merged timebase is a no-op; the loader still
   implements ``np.searchsorted`` nearest-neighbour resampling so divergent
   tick streams in a future file Just Work. The anchor group is whichever
   has the most samples. ``t`` is in seconds, zero at the dataset's start.

2. **``Digital Outputs/Digital Outputs`` is bit-packed.** One ``uint32``
   channel encodes 32 valve commands. Two properties on that channel —
   ``Valve names`` (semicolon-separated) and ``Unpowered states``
   (semicolon-separated 0/1) — describe each bit. We explode it into 32
   ``Digital Outputs/<valve_name>`` boolean channels (``is_valve=True``),
   XOR'd with unpowered state so ``1`` always means "commanded open".
   The raw packed channel is preserved as ``Digital Outputs/Digital
   Outputs`` (unit ``uint32``).

3. **Pressure / load-cell ``_slope`` & ``_offset``.** Engineering units
   are computed as

       value = raw * slope + offset

   **DEVIATION FROM THE DESIGN BRIEF.** The brief states ``raw / slope +
   offset``. On the HF16 file that formula produces a flat -24 bar on
   Chamber Eth (the offset alone) across the entire firing window and a
   flat -158 N on the thrust load cell. With ``*`` instead of ``/``, the
   Chamber Eth peak becomes ~42 bar and thrust peaks at ~13.9 kN — both
   physically plausible for a small bipropellant engine. The brief author
   flagged the formula direction for verification on first run; this is
   the verification. Re-flag if a future hardware setup reverses it.

   Both raw and converted variants are exposed: ``Group/Name`` is the
   converted (default-display) channel, ``Group/Name (raw)`` is the
   untouched series.

4. **Thermocouple ``_type``.** K and T types are linearized by
   ``processing.thermocouples.linearize`` using the NI 9213 calibrated
   lookup tables. The group's ``Autozero`` (voltage) and ``CJC`` (raw
   thermistor voltage) channels are passed in and decoded by the
   linearizer — CJC goes through a Steinhart-Hart chain to recover
   cold-junction °C, then the forward lookup converts that to a
   compensating voltage. ``Autozero`` and ``CJC`` themselves are
   pass-through channels (no ``_type`` ``→`` no conversion). Channels
   with unsupported types fall through to NaN.

5. **``General/Active Sequence Step``** is surfaced on
   ``LoadedDataset.sequence_steps`` for the overlay UI. The semantic
   interpretation of its (large) integer values is left to consumers —
   on this file it appears to be a monotonic timing counter rather than a
   small step index.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from nptdms import TdmsFile

from daxolotl.loaders.base import ChannelData, LoadedDataset
from daxolotl.processing.thermocouples import linearize as tc_linearize
from daxolotl.processing.valves import parse_valve_metadata, unpack_valves

TICKS_CHANNEL = "Ticks [us]"


class TdmsLoader:
    """Loader for NI TDMS files. See module docstring for quirks handled."""

    def can_handle(self, path: Path) -> bool:
        return path.suffix.lower() == ".tdms"

    def load(self, path: Path) -> LoadedDataset:
        tdms = TdmsFile.read(path)
        groups = list(tdms.groups())

        anchor_name, t_seconds, group_idx, ticks_aligned = _build_timebase(tdms, groups)

        # Pre-load Thermocouples helpers (CJC thermistor voltage / Autozero
        # voltage) once. Cheaper than reading per-channel inside the loop.
        cjc_v, autozero_v = _load_tc_helpers(tdms, groups, group_idx, len(t_seconds))

        channels: dict[str, ChannelData] = {}
        valve_keys: list[str] = []
        sequence_steps: ChannelData | None = None

        for g in groups:
            gname = g.name
            idx = group_idx[gname]
            for ch in g.channels():
                cname = ch.name
                if cname == TICKS_CHANNEL:
                    continue

                props: dict[str, Any] = dict(ch.properties)
                y = ch[:][idx]  # idx is an identity arange when ticks are already aligned

                # 1. Packed valve channel ``→`` split into 32 booleans + keep raw.
                if gname == "Digital Outputs" and cname == "Digital Outputs":
                    channels[f"{gname}/{cname}"] = ChannelData(
                        name=cname,
                        group=gname,
                        unit="uint32",
                        t=t_seconds,
                        y=y.astype(np.uint32),
                        properties=props,
                    )
                    names, unpowered = parse_valve_metadata(
                        str(props["Valve names"]), str(props["Unpowered states"])
                    )
                    bits = unpack_valves(y.astype(np.uint32), unpowered)
                    for i, vn in enumerate(names):
                        vkey = f"{gname}/{vn}"
                        channels[vkey] = ChannelData(
                            name=vn,
                            group=gname,
                            unit="bool",
                            t=t_seconds,
                            y=bits[i],
                            properties={
                                "valve_index": i,
                                "unpowered": int(unpowered[i]),
                            },
                            is_valve=True,
                        )
                        valve_keys.append(vkey)
                    continue

                # 2. Sensors with slope/offset ``→`` keep raw + add converted.
                if "_slope" in props and "_offset" in props:
                    slope = float(props["_slope"])
                    offset = float(props["_offset"])
                    channels[f"{gname}/{cname} (raw)"] = ChannelData(
                        name=f"{cname} (raw)",
                        group=gname,
                        unit=None,
                        t=t_seconds,
                        y=y.astype(np.float64),
                        properties=props,
                    )
                    converted = y.astype(np.float64) * slope + offset
                    channels[f"{gname}/{cname}"] = ChannelData(
                        name=cname,
                        group=gname,
                        unit=_infer_sensor_unit(gname, cname),
                        t=t_seconds,
                        y=converted,
                        properties={**props, "converted": True},
                    )
                    continue

                # 3. Thermocouple channels (have ``_type``) ``→`` linearize.
                if "_type" in props:
                    channels[f"{gname}/{cname} (raw)"] = ChannelData(
                        name=f"{cname} (raw)",
                        group=gname,
                        unit="V",
                        t=t_seconds,
                        y=y.astype(np.float64),
                        properties=props,
                    )
                    converted = tc_linearize(
                        y.astype(np.float64), str(props["_type"]), cjc_v, autozero_v
                    )
                    channels[f"{gname}/{cname}"] = ChannelData(
                        name=cname,
                        group=gname,
                        unit="°C",
                        t=t_seconds,
                        y=converted,
                        properties={**props, "converted": True},
                    )
                    continue

                # 4. Active Sequence Step ``→`` first-class side channel.
                if gname == "General" and cname == "Active Sequence Step":
                    cd = ChannelData(
                        name=cname, group=gname, unit=None, t=t_seconds, y=y, properties=props
                    )
                    channels[f"{gname}/{cname}"] = cd
                    sequence_steps = cd
                    continue

                # 5. Default pass-through.
                channels[f"{gname}/{cname}"] = ChannelData(
                    name=cname, group=gname, unit=None, t=t_seconds, y=y, properties=props
                )

        metadata: dict[str, Any] = {
            "root_properties": dict(tdms.properties),
            "sample_count": int(len(t_seconds)),
            "duration_s": float(t_seconds[-1] - t_seconds[0]) if len(t_seconds) else 0.0,
            "anchor_group": anchor_name,
            "ticks_aligned_across_groups": ticks_aligned,
            "groups": [g.name for g in groups],
        }

        return LoadedDataset(
            name=str(tdms.properties.get("name", path.stem)),
            channels=channels,
            metadata=metadata,
            sequence_steps=sequence_steps,
            valve_channels=valve_keys,
        )


# --- helpers ----------------------------------------------------------------


def _build_timebase(
    tdms: TdmsFile, groups: list[Any]
) -> tuple[str, np.ndarray, dict[str, np.ndarray], bool]:
    """Return (anchor_group_name, t_seconds, per_group_indices, ticks_aligned).

    Picks the group with the most ``Ticks [us]`` samples as the anchor. Other
    groups are resampled to that anchor by ``np.searchsorted`` nearest-neighbour
    (single-pass; suitable for monotonically increasing ticks).
    """
    ticks_per_group: dict[str, np.ndarray] = {}
    for g in groups:
        for ch in g.channels():
            if ch.name == TICKS_CHANNEL:
                ticks_per_group[g.name] = ch[:].astype(np.int64)
                break

    if not ticks_per_group:
        raise ValueError(f"No '{TICKS_CHANNEL}' channel in any group; cannot establish timebase")

    anchor_name = max(ticks_per_group, key=lambda n: len(ticks_per_group[n]))
    anchor_ticks = ticks_per_group[anchor_name]
    t_seconds = (anchor_ticks - int(anchor_ticks[0])) / 1e6

    group_idx: dict[str, np.ndarray] = {}
    aligned = True
    for gname, ticks in ticks_per_group.items():
        if len(ticks) == len(anchor_ticks) and np.array_equal(ticks, anchor_ticks):
            group_idx[gname] = np.arange(len(anchor_ticks))
        else:
            aligned = False
            idx = np.searchsorted(ticks, anchor_ticks)
            idx = np.clip(idx, 0, len(ticks) - 1)
            group_idx[gname] = idx

    # Groups without a ticks channel (rare) inherit the anchor index map.
    for g in groups:
        group_idx.setdefault(g.name, np.arange(len(anchor_ticks)))

    return anchor_name, t_seconds, group_idx, aligned


def _load_tc_helpers(
    tdms: TdmsFile,
    groups: list[Any],
    group_idx: dict[str, np.ndarray],
    n_samples: int,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Pre-load CJC and Autozero arrays from the Thermocouples group, if present."""
    group_names = {g.name for g in groups}
    if "Thermocouples" not in group_names:
        return None, None
    tc_group = tdms["Thermocouples"]
    tc_channels = {c.name for c in tc_group.channels()}
    idx = group_idx.get("Thermocouples", np.arange(n_samples))
    cjc = tc_group["CJC"][:][idx].astype(np.float64) if "CJC" in tc_channels else None
    autozero = (
        tc_group["Autozero"][:][idx].astype(np.float64) if "Autozero" in tc_channels else None
    )
    return cjc, autozero


def _infer_sensor_unit(group: str, channel: str) -> str | None:
    """Best-effort unit guess. TDMS doesn't carry units; this lets the UI display something."""
    g = group.lower()
    if g == "pressure sensors":
        return "bar"
    if g == "load cells":
        return "N" if "thrust" in channel.lower() else "kg"
    return None
