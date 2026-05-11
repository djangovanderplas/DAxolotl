"""Tiny utility helpers shared across modules."""

from __future__ import annotations

from typing import Any


def jsonable_properties(props: dict[str, Any]) -> dict[str, Any]:
    """Coerce numpy / nptdms scalar types into plain Python so JSON columns swallow them."""
    out: dict[str, Any] = {}
    for k, v in props.items():
        if hasattr(v, "item"):
            v = v.item()
        out[str(k)] = v
    return out
