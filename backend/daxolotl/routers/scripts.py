"""Dataset-level trusted script endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from daxolotl.auth import CurrentUser, get_current_user
from daxolotl.config import settings
from daxolotl.db import get_db
from daxolotl.models import Channel, Dataset, DerivedChannel
from daxolotl.scripting.runtime import run_script
from daxolotl.storage import read_channel_data, write_xy_parquet

router = APIRouter(prefix="/api/datasets", tags=["scripts"])
CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
DbDep = Annotated[Session, Depends(get_db)]


class ScriptRequest(BaseModel):
    name: str
    code: str


class ScriptChannelOut(BaseModel):
    id: int
    name: str
    group_name: str
    unit: str | None
    dtype: str
    sample_count: int
    is_valve: bool


class ScriptResponse(BaseModel):
    dataset_id: int
    channels: list[ScriptChannelOut]


@router.post("/{dataset_id}/script", status_code=status.HTTP_201_CREATED)
def create_derived_channels(
    dataset_id: int,
    req: ScriptRequest,
    current_user: CurrentUserDep,
    db: DbDep,
) -> ScriptResponse:
    """Run trusted Python and register cached derived channels."""
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")
    if not dataset.processed_path or not Path(dataset.processed_path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Processed data cache not found")

    try:
        t, source_channels = _load_script_inputs(dataset)
        results = run_script(code=req.code, output_name=req.name, t=t, channels=source_channels)
    except KeyError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown channel: {exc}") from None
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None

    created: list[Channel] = []
    try:
        for result in results:
            derived = DerivedChannel(
                dataset_id=dataset.id,
                name=result.name,
                script=req.code,
                depends_on_json={"channels": sorted(source_channels)},
                cache_path=None,
            )
            db.add(derived)
            db.flush()

            cache_path = _derived_cache_path(dataset.id, derived.id, result.name)
            write_xy_parquet(cache_path, t, result.y)
            derived.cache_path = str(cache_path)

            channel = Channel(
                dataset_id=dataset.id,
                group_name="Derived",
                name=result.name,
                unit=None,
                dtype=str(np.asarray(result.y).dtype),
                sample_count=int(len(result.y)),
                properties_json={
                    "derived_channel_id": derived.id,
                    "derived_cache_path": str(cache_path),
                    "script_name": req.name,
                },
                is_valve=False,
                column_name="y",
            )
            db.add(channel)
            db.flush()
            created.append(channel)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return ScriptResponse(
        dataset_id=dataset.id,
        channels=[
            ScriptChannelOut(
                id=channel.id,
                name=channel.name,
                group_name=channel.group_name,
                unit=channel.unit,
                dtype=channel.dtype,
                sample_count=channel.sample_count,
                is_valve=channel.is_valve,
            )
            for channel in created
        ],
    )


def _load_script_inputs(dataset: Dataset) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    channels: dict[str, np.ndarray] = {}
    t_ref: np.ndarray | None = None
    source_path = Path(dataset.processed_path)
    for channel in dataset.channels:
        if channel.is_valve or (channel.properties_json or {}).get("derived_cache_path"):
            continue
        t, y = read_channel_data(source_path, channel.column_name)
        if t_ref is None:
            t_ref = t
        key = f"{channel.group_name}/{channel.name}"
        channels[key] = y
    if t_ref is None:
        raise ValueError("Dataset has no numeric source channels")
    return t_ref, channels


def _derived_cache_path(dataset_id: int, derived_id: int, name: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in name)
    return (
        settings.data_dir.resolve()
        / ".processed"
        / "derived"
        / f"{dataset_id}_{derived_id}_{safe}.parquet"
    )
