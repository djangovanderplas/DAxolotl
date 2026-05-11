"""Bit-unpack the packed digital outputs channel into per-valve booleans.

NI DAQ packs 32 boolean valve commands as bits in one ``uint32`` channel
(typically ``Digital Outputs/Digital Outputs``). The channel carries two
semicolon-separated string properties:

  - ``Valve names``: 32 entries, one per bit. Some are unused placeholders
    (e.g. ``12V Port 7``) — we still expose them so bit indices stay
    aligned with the physical wiring; the UI can hide noise.
  - ``Unpowered states``: 32 entries of ``0`` / ``1`` — the *electrical*
    state of the relay when unpowered. XOR'ing the raw bit with this
    yields the *commanded* state where ``1`` means "valve commanded open".
"""

from __future__ import annotations

import numpy as np


def parse_valve_metadata(names_str: str, unpowered_str: str) -> tuple[list[str], np.ndarray]:
    """Split the property strings into a 32-entry name list and uint8 array.

    Raises ``ValueError`` if either string doesn't decode to exactly 32 entries.
    """
    names = [n.strip() for n in names_str.split(";")]
    unp = np.fromiter((int(s.strip()) for s in unpowered_str.split(";")), dtype=np.uint8)
    if len(names) != 32 or len(unp) != 32:
        raise ValueError(
            f"Expected 32 entries; got {len(names)} names, {len(unp)} unpowered states"
        )
    return names, unp


def unpack_valves(packed: np.ndarray, unpowered: np.ndarray) -> np.ndarray:
    """Unpack a ``uint32`` array into a ``(32, N)`` boolean array of commanded states.

    ``out[bit, i] = ((packed[i] >> bit) & 1) ^ unpowered[bit]``.
    """
    if packed.dtype != np.uint32:
        packed = packed.astype(np.uint32)
    if unpowered.shape != (32,):
        raise ValueError(f"unpowered must have shape (32,), got {unpowered.shape}")
    bits = ((packed[None, :] >> np.arange(32, dtype=np.uint32)[:, None]) & 1).astype(np.uint8)
    return (bits ^ unpowered[:, None]).astype(bool)
