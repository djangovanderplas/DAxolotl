"""SQLAlchemy engine + session, plus the ``init_db`` bootstrap.

``init_db`` is idempotent: it creates tables that don't exist and seeds the
``dev@local`` user / ``default`` group rows iff the rows are missing. Called
from the FastAPI lifespan and the CLI's ``ingest`` command.

The module-level ``engine`` and ``SessionLocal`` are deliberately referenced
by attribute (e.g. ``daxolotl.db.SessionLocal``) inside the helpers below so
test fixtures can ``monkeypatch.setattr`` them at runtime to point at a temp
SQLite without reloading the world.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from daxolotl.config import settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):  # type: ignore[no-untyped-def]
    return create_engine(
        url,
        future=True,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
    )


engine = _make_engine(settings.db_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: a request-scoped SQLAlchemy session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and seed the dev user / default group if missing."""
    from daxolotl import models  # imported here to dodge a circular import

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.query(models.User).filter_by(email="dev@local").first() is None:
            db.add(models.User(email="dev@local", name="Dev", is_admin=True))
        if db.query(models.Group).filter_by(name="default").first() is None:
            db.add(models.Group(name="default"))
        db.commit()
