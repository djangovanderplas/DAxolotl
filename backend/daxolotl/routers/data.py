"""Channel data endpoints for plot display."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from daxolotl.auth import CurrentUser, get_current_user
from daxolotl.config import settings
from daxolotl.db import get_db
from daxolotl.decimation import decimate_min_max
from daxolotl.models import Channel, Dataset
from daxolotl.processing.filters import butterworth_lowpass, moving_average
from daxolotl.storage import read_channel_data, read_xy_parquet, write_xy_parquet

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


class FilterSpec(BaseModel):
    kind: Literal["none", "butterworth", "moving_average"] = "none"
    cutoff_hz: float = 20.0
    order: int = 4
    window_samples: int = 25


class FullDataRequest(BaseModel):
    t_min: float | None = None
    t_max: float | None = None
    filter: FilterSpec | None = None


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


def _filter_cache_path(dataset: Dataset, channel: Channel, filter_spec: FilterSpec) -> Path:
    source_path = Path(dataset.processed_path)
    try:
        source_stat = source_path.stat()
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Processed data cache not found") from exc

    payload = {
        "dataset_id": dataset.id,
        "channel_id": channel.id,
        "column": channel.column_name,
        "source": str(source_path.resolve()),
        "source_mtime_ns": source_stat.st_mtime_ns,
        "source_size": source_stat.st_size,
        "filter": filter_spec.model_dump(),
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()[:24]
    return settings.data_dir.resolve() / ".processed" / "filters" / f"{digest}.parquet"


def _apply_filter(dataset: Dataset, channel: Channel, filter_spec: FilterSpec) -> Path | None:
    if filter_spec.kind == "none":
        return None
    if filter_spec.kind == "butterworth" and filter_spec.cutoff_hz <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cutoff_hz must be greater than 0")
    if filter_spec.kind == "butterworth" and filter_spec.order not in {2, 4}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "order must be 2 or 4")
    if filter_spec.kind == "moving_average" and filter_spec.window_samples < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "window_samples must be at least 1")

    cache_path = _filter_cache_path(dataset, channel, filter_spec)
    if cache_path.exists():
        return cache_path

    t, y = read_channel_data(Path(dataset.processed_path), channel.column_name)
    if filter_spec.kind == "butterworth":
        y_filtered = butterworth_lowpass(
            t,
            y,
            cutoff_hz=filter_spec.cutoff_hz,
            order=filter_spec.order,
        )
    else:
        y_filtered = moving_average(y, filter_spec.window_samples)

    write_xy_parquet(cache_path, t, y_filtered)
    return cache_path


def _read_out(
    dataset: Dataset,
    channel: Channel,
    *,
    t_min: float | None,
    t_max: float | None,
    max_points: int | None,
    filter_spec: FilterSpec | None = None,
) -> ChannelDataOut:
    filter_spec = filter_spec or FilterSpec()
    filtered_path = _apply_filter(dataset, channel, filter_spec)
    if filtered_path is None:
        t, y = read_channel_data(Path(dataset.processed_path), channel.column_name, t_min, t_max)
    else:
        t, y = read_xy_parquet(filtered_path, t_min, t_max)
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
    filter_kind: Literal["none", "butterworth", "moving_average"] = "none",
    cutoff_hz: float = 20.0,
    order: int = 4,
    window_samples: int = 25,
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
        filter_spec=FilterSpec(
            kind=filter_kind,
            cutoff_hz=cutoff_hz,
            order=order,
            window_samples=window_samples,
        ),
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
        filter_spec=req.filter,
    )
