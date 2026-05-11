"""Channel data endpoints for plot display."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from daxolotl.auth import CurrentUser, get_current_user
from daxolotl.db import get_db
from daxolotl.decimation import decimate_min_max
from daxolotl.models import Channel, Dataset
from daxolotl.storage import read_channel_data

router = APIRouter(prefix="/api/datasets", tags=["data"])
CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
DbDep = Annotated[Session, Depends(get_db)]
MaxPointsQuery = Annotated[int, Query()]


class ChannelDataOut(BaseModel):
    dataset_id: int
    channel_id: int
    channel_name: str
    group_name: str
    unit: str | None
    t: list[Any]
    y: list[Any]
    decimated: bool
    point_count: int
    full_point_count: int


class FullDataRequest(BaseModel):
    t_min: float | None = None
    t_max: float | None = None


def _validate_window(t_min: float | None, t_max: float | None) -> None:
    if t_min is not None and t_max is not None and t_min > t_max:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid time window: t_min must be less than or equal to t_max",
        )


def _json_values(values: np.ndarray) -> list[Any]:
    """Convert numpy arrays to JSON-safe lists, mapping non-finite floats to null."""
    arr = np.asarray(values)
    if np.issubdtype(arr.dtype, np.floating):
        return [None if not np.isfinite(v) else float(v) for v in arr]
    return arr.tolist()


def _get_dataset_and_channel(
    dataset_id: int,
    channel_id: int,
    db: Session,
) -> tuple[Dataset, Channel]:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")

    channel = (
        db.query(Channel).filter(Channel.id == channel_id, Channel.dataset_id == dataset_id).first()
    )
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")

    if not dataset.processed_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Processed data cache not found")
    cache_path = Path(dataset.processed_path)
    if not cache_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Processed data cache not found")

    return dataset, channel


def _read_out(
    dataset: Dataset,
    channel: Channel,
    *,
    t_min: float | None,
    t_max: float | None,
    max_points: int | None,
) -> ChannelDataOut:
    t, y = read_channel_data(Path(dataset.processed_path), channel.column_name, t_min, t_max)
    full_point_count = int(len(t))
    decimated = False

    if max_points is not None and full_point_count > max_points:
        t, y = decimate_min_max(t, y, max_points)
        decimated = len(t) < full_point_count

    return ChannelDataOut(
        dataset_id=dataset.id,
        channel_id=channel.id,
        channel_name=channel.name,
        group_name=channel.group_name,
        unit=channel.unit,
        t=_json_values(t),
        y=_json_values(y),
        decimated=decimated,
        point_count=int(len(t)),
        full_point_count=full_point_count,
    )


@router.get("/{dataset_id}/channels/{channel_id}/data")
def get_channel_data(
    dataset_id: int,
    channel_id: int,
    current_user: CurrentUserDep,
    db: DbDep,
    t_min: float | None = None,
    t_max: float | None = None,
    max_points: MaxPointsQuery = 4000,
) -> ChannelDataOut:
    """Return display-ready channel data, decimated with min/max binning if needed."""
    _validate_window(t_min, t_max)
    if max_points < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "max_points must be at least 1")

    dataset, channel = _get_dataset_and_channel(dataset_id, channel_id, db)
    return _read_out(
        dataset,
        channel,
        t_min=t_min,
        t_max=t_max,
        max_points=max_points,
    )


@router.post("/{dataset_id}/channels/{channel_id}/data/full")
def get_full_channel_data(
    dataset_id: int,
    channel_id: int,
    req: FullDataRequest,
    current_user: CurrentUserDep,
    db: DbDep,
) -> ChannelDataOut:
    """Return full-resolution channel data for a selected time window."""
    _validate_window(req.t_min, req.t_max)
    dataset, channel = _get_dataset_and_channel(dataset_id, channel_id, db)
    return _read_out(
        dataset,
        channel,
        t_min=req.t_min,
        t_max=req.t_max,
        max_points=None,
    )
