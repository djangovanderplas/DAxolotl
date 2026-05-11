"""SQLAlchemy ORM models.

The MVP wires up ``User``, ``Group``, ``UserGroup``, ``Dataset``, and
``Channel`` end-to-end. The rest (``DerivedChannel``, ``View``,
``Annotation``, ``Pipeline``) have full schemas so future build-plan
steps can pick them up without touching migrations — none of them are
queried by routers yet.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from daxolotl.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
    is_admin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)


class UserGroup(Base):
    __tablename__ = "user_groups"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), primary_key=True)
    role: Mapped[str] = mapped_column(default="member")  # 'member' | 'admin'


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    test_id: Mapped[str] = mapped_column(index=True)
    raw_path: Mapped[str]
    processed_path: Mapped[str] = mapped_column(default="")
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    channels: Mapped[list[Channel]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (
        UniqueConstraint("dataset_id", "group_name", "name", name="uq_channel_in_dataset"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    group_name: Mapped[str]
    name: Mapped[str]
    unit: Mapped[str | None]
    dtype: Mapped[str]
    sample_count: Mapped[int]
    properties_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_valve: Mapped[bool] = mapped_column(default=False)
    column_name: Mapped[str]  # parquet column key, e.g. "ch_42"

    dataset: Mapped[Dataset] = relationship(back_populates="channels")


# --- post-MVP-but-schema-now ---------------------------------------------


class DerivedChannel(Base):
    __tablename__ = "derived_channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"))
    name: Mapped[str]
    script: Mapped[str] = mapped_column(Text)
    depends_on_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    cache_path: Mapped[str | None] = mapped_column(default=None)


class View(Base):
    __tablename__ = "views"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    dataset_ids_json: Mapped[list[int]] = mapped_column(JSON, default=list)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow)


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    view_id: Mapped[int] = mapped_column(ForeignKey("views.id"))
    plot_id: Mapped[str]
    t: Mapped[float]
    label: Mapped[str]
    color: Mapped[str | None] = mapped_column(default=None)
    kind: Mapped[str]  # 'point' | 'vline' | 'region'


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)
    steps_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
