"""Shared ingest pipeline used by the HTTP router and the CLI.

Steps:
  1. Pick a loader for ``path``.
  2. Run the loader to produce a ``LoadedDataset``.
  3. Persist a ``Dataset`` row + one ``Channel`` row per loaded channel.
  4. Write the parquet cache once channel IDs exist.
  5. Commit and return the dataset row.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from daxolotl.config import settings
from daxolotl.loaders.tdms import TdmsLoader
from daxolotl.models import Channel, Dataset
from daxolotl.storage import processed_path_for, write_dataset_parquet
from daxolotl.util import jsonable_properties


def resolve_ingest_path(raw_path: str | Path) -> Path:
    """Resolve a user-supplied path to exactly one supported source file.

    Relative paths are accepted either relative to the current working
    directory (``data/HF16/foo.tdms``) or relative to ``settings.data_dir``
    (``HF16/foo.tdms``). Directories are allowed only when they contain exactly
    one top-level ``.tdms`` file.
    """
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute() and not candidate.exists():
        candidate = settings.data_dir / candidate
    candidate = candidate.resolve()

    if not candidate.exists():
        raise FileNotFoundError(candidate)

    if candidate.is_dir():
        tdms_files = sorted(
            p for p in candidate.iterdir() if p.is_file() and p.suffix.lower() == ".tdms"
        )
        if not tdms_files:
            raise ValueError(f"No .tdms file found in directory: {candidate}")
        if len(tdms_files) > 1:
            names = ", ".join(p.name for p in tdms_files)
            raise ValueError(f"Directory contains multiple .tdms files: {names}")
        return tdms_files[0]

    return candidate


def ingest_file(
    path: Path,
    *,
    db: Session,
    owner_id: int,
    name: str | None = None,
    group_id: int | None = None,
) -> Dataset:
    """Load ``path``, persist channels, write the parquet cache."""
    loader = TdmsLoader()
    if not loader.can_handle(path):
        raise ValueError(f"Unsupported file type: {path.suffix}")
    if not path.exists():
        raise FileNotFoundError(path)

    loaded = loader.load(path)
    ds_name = name or loaded.name

    dataset = Dataset(
        name=ds_name,
        test_id=ds_name,
        raw_path=str(path.resolve()),
        processed_path="",
        owner_id=owner_id,
        group_id=group_id,
        metadata_json=jsonable_properties(loaded.metadata),
    )
    db.add(dataset)
    db.flush()

    channels_by_id: dict[int, str] = {}
    for key, cd in loaded.channels.items():
        c = Channel(
            dataset_id=dataset.id,
            group_name=cd.group,
            name=cd.name,
            unit=cd.unit,
            dtype=str(cd.y.dtype),
            sample_count=int(cd.y.shape[0]),
            properties_json=jsonable_properties(cd.properties),
            is_valve=cd.is_valve,
            column_name="",
        )
        db.add(c)
        db.flush()
        c.column_name = f"ch_{c.id}"
        channels_by_id[c.id] = key

    processed = processed_path_for(dataset.id, ds_name)
    write_dataset_parquet(loaded, channels_by_id, processed)
    dataset.processed_path = str(processed)

    db.commit()
    db.refresh(dataset)
    return dataset
