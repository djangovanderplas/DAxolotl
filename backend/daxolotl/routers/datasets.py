"""``/api/datasets`` — register, list, get one."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from daxolotl.auth import CurrentUser, get_current_user
from daxolotl.db import get_db
from daxolotl.ingest import ingest_file, resolve_ingest_path
from daxolotl.models import Dataset

router = APIRouter(prefix="/api/datasets", tags=["datasets"])
CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
DbDep = Annotated[Session, Depends(get_db)]


class IngestRequest(BaseModel):
    path: str
    name: str | None = None
    group_id: int | None = None


class ChannelOut(BaseModel):
    id: int
    group_name: str
    name: str
    unit: str | None
    dtype: str
    sample_count: int
    is_valve: bool


class DatasetOut(BaseModel):
    id: int
    name: str
    test_id: str
    raw_path: str
    created_at: str
    metadata: dict[str, Any]
    channels: list[ChannelOut] = []


def _to_out(d: Dataset, include_channels: bool = True) -> DatasetOut:
    channels = (
        [
            ChannelOut(
                id=c.id,
                group_name=c.group_name,
                name=c.name,
                unit=c.unit,
                dtype=c.dtype,
                sample_count=c.sample_count,
                is_valve=c.is_valve,
            )
            for c in d.channels
        ]
        if include_channels
        else []
    )
    return DatasetOut(
        id=d.id,
        name=d.name,
        test_id=d.test_id,
        raw_path=d.raw_path,
        created_at=d.created_at.isoformat(),
        metadata=d.metadata_json or {},
        channels=channels,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def register_dataset(
    req: IngestRequest,
    current_user: CurrentUserDep,
    db: DbDep,
) -> DatasetOut:
    """Load a TDMS file from disk into the DB + parquet cache."""
    try:
        path = resolve_ingest_path(req.path)
        dataset = ingest_file(
            path, db=db, owner_id=current_user.id, name=req.name, group_id=req.group_id
        )
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"File not found: {exc}") from None
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    return _to_out(dataset)


@router.get("")
def list_datasets(
    current_user: CurrentUserDep,
    db: DbDep,
) -> list[DatasetOut]:
    rows = db.query(Dataset).order_by(Dataset.created_at.desc()).all()
    return [_to_out(d, include_channels=False) for d in rows]


@router.get("/{dataset_id}")
def get_dataset(
    dataset_id: int,
    current_user: CurrentUserDep,
    db: DbDep,
) -> DatasetOut:
    d = db.get(Dataset, dataset_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")
    return _to_out(d)
