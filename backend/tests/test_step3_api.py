from __future__ import annotations

from pathlib import Path

from daxolotl import db as db_module
from daxolotl.cli import app as cli_app
from daxolotl.config import settings
from daxolotl.ingest import resolve_ingest_path
from daxolotl.main import app
from daxolotl.models import Channel, Dataset, Group, User
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from typer.testing import CliRunner


def _configure_temp_db(monkeypatch, tmp_path: Path) -> None:
    engine = db_module._make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", testing_session)
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    settings.data_dir.mkdir(parents=True, exist_ok=True)


def _client(monkeypatch, tmp_path: Path):
    _configure_temp_db(monkeypatch, tmp_path)
    return TestClient(app)


def _ingest_synthetic(client: TestClient, synthetic_tdms: Path, name: str = "synthetic_HF"):
    response = client.post("/api/datasets", json={"path": str(synthetic_tdms), "name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_startup_seeds_dev_user_and_default_group(monkeypatch, tmp_path: Path) -> None:
    with _client(monkeypatch, tmp_path), db_module.SessionLocal() as db:
        user = db.query(User).filter_by(email="dev@local").one_or_none()
        group = db.query(Group).filter_by(name="default").one_or_none()

    assert user is not None
    assert user.is_admin is True
    assert group is not None


def test_register_and_list_dataset_writes_parquet(
    monkeypatch,
    tmp_path: Path,
    synthetic_tdms: Path,
) -> None:
    with _client(monkeypatch, tmp_path) as client:
        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]

        assert created["name"] == "synthetic_HF"
        assert created["metadata"]["sample_count"] == 1000
        assert any(ch["name"] == "Chamber Eth" for ch in created["channels"])

        listed = client.get("/api/datasets")
        assert listed.status_code == 200
        assert listed.json()[0]["id"] == dataset_id
        assert listed.json()[0]["channels"] == []

        fetched = client.get(f"/api/datasets/{dataset_id}")
        assert fetched.status_code == 200
        assert len(fetched.json()["channels"]) > 0

        with db_module.SessionLocal() as db:
            dataset = db.get(Dataset, dataset_id)
            assert dataset is not None
            assert Path(dataset.processed_path).exists()
            assert Path(dataset.processed_path).is_relative_to(settings.data_dir.resolve())


def test_channel_data_endpoint_returns_full_and_decimated_data(
    monkeypatch,
    tmp_path: Path,
    synthetic_tdms: Path,
) -> None:
    with _client(monkeypatch, tmp_path) as client:
        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]
        channel = next(ch for ch in created["channels"] if ch["name"] == "Chamber Eth")

        full_response = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={"max_points": 2000},
        )
        assert full_response.status_code == 200
        full = full_response.json()
        assert full["decimated"] is False
        assert full["point_count"] == 1000
        assert full["full_point_count"] == 1000
        assert full["unit"] == "bar"
        assert full["y"][0] == 0.0

        decimated_response = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={"max_points": 100},
        )
        assert decimated_response.status_code == 200
        decimated = decimated_response.json()
        assert decimated["decimated"] is True
        assert decimated["point_count"] <= 100
        assert decimated["full_point_count"] == 1000


def test_full_channel_data_endpoint_uses_requested_window(
    monkeypatch,
    tmp_path: Path,
    synthetic_tdms: Path,
) -> None:
    with _client(monkeypatch, tmp_path) as client:
        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]
        channel = next(ch for ch in created["channels"] if ch["name"] == "Chamber Eth")

        response = client.post(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data/full",
            json={"t_min": 0.01, "t_max": 0.02},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decimated"] is False
    assert body["point_count"] == body["full_point_count"]
    assert min(body["t"]) >= 0.01
    assert max(body["t"]) <= 0.02


def test_channel_data_endpoint_filters_and_caches_server_side(
    monkeypatch,
    tmp_path: Path,
    synthetic_tdms: Path,
) -> None:
    with _client(monkeypatch, tmp_path) as client:
        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]
        channel = next(ch for ch in created["channels"] if ch["name"] == "Chamber Eth")

        response = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={
                "filter_kind": "moving_average",
                "window_samples": 11,
                "max_points": 2000,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["decimated"] is False
        assert body["point_count"] == 1000
        assert body["y"][0] != 0.0

        filter_files = list((settings.data_dir / ".processed" / "filters").glob("*.parquet"))
        assert len(filter_files) == 1

        cached = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={
                "filter_kind": "moving_average",
                "window_samples": 11,
                "max_points": 2000,
            },
        )
        assert cached.status_code == 200
        assert cached.json()["y"] == body["y"]
        assert len(list((settings.data_dir / ".processed" / "filters").glob("*.parquet"))) == 1

        butterworth = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={
                "filter_kind": "butterworth",
                "cutoff_hz": 20,
                "order": 4,
                "max_points": 2000,
            },
        )
        assert butterworth.status_code == 200, butterworth.text
        assert butterworth.json()["point_count"] == 1000


def test_channel_data_endpoint_accepts_butterworth_query_params(
    monkeypatch,
    tmp_path: Path,
    synthetic_tdms: Path,
) -> None:
    with _client(monkeypatch, tmp_path) as client:
        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]
        channel = next(ch for ch in created["channels"] if ch["name"] == "Chamber Eth")

        response = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={
                "filter_kind": "butterworth",
                "cutoff_hz": 20,
                "order": 4,
                "max_points": 2000,
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["point_count"] == 1000
        assert body["full_point_count"] == 1000

        invalid_order = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={
                "filter_kind": "butterworth",
                "cutoff_hz": 20,
                "order": 3,
            },
        )
        assert invalid_order.status_code == 400


def test_dataset_and_channel_errors(monkeypatch, tmp_path: Path, synthetic_tdms: Path) -> None:
    with _client(monkeypatch, tmp_path) as client:
        not_found = client.post("/api/datasets", json={"path": "does-not-exist.tdms"})
        assert not_found.status_code == 404

        created = _ingest_synthetic(client, synthetic_tdms)
        dataset_id = created["id"]
        channel = next(ch for ch in created["channels"] if ch["name"] == "Chamber Eth")

        bad_window = client.get(
            f"/api/datasets/{dataset_id}/channels/{channel['id']}/data",
            params={"t_min": 10.0, "t_max": 1.0},
        )
        assert bad_window.status_code == 400

        missing_dataset = client.get("/api/datasets/999/channels/1/data")
        assert missing_dataset.status_code == 404

        missing_channel = client.get(f"/api/datasets/{dataset_id}/channels/999/data")
        assert missing_channel.status_code == 404

        with db_module.SessionLocal() as db:
            dataset = db.get(Dataset, dataset_id)
            assert dataset is not None
            Path(dataset.processed_path).unlink()

        missing_cache = client.get(f"/api/datasets/{dataset_id}/channels/{channel['id']}/data")
        assert missing_cache.status_code == 404


def test_cli_ingest_accepts_directory(monkeypatch, tmp_path: Path, synthetic_tdms: Path) -> None:
    _configure_temp_db(monkeypatch, tmp_path)
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    tdms_copy = input_dir / synthetic_tdms.name
    tdms_copy.write_bytes(synthetic_tdms.read_bytes())

    result = CliRunner().invoke(cli_app, ["ingest", str(input_dir), "--name", "cli_HF"])

    assert result.exit_code == 0, result.output
    assert "Ingested dataset" in result.output
    with db_module.SessionLocal() as db:
        dataset = db.query(Dataset).filter_by(name="cli_HF").one_or_none()
        assert dataset is not None
        assert Path(dataset.processed_path).exists()
        assert db.query(Channel).filter_by(dataset_id=dataset.id).count() > 0


def test_resolve_ingest_path_accepts_relative_path_under_data_dir(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    source = settings.data_dir / "HF16" / "example.tdms"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"not a real tdms; resolver only checks paths")

    assert resolve_ingest_path("HF16/example.tdms") == source.resolve()


def test_resolve_ingest_path_rejects_empty_or_ambiguous_directories(tmp_path: Path) -> None:
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    ambiguous_dir = tmp_path / "ambiguous"
    ambiguous_dir.mkdir()
    (ambiguous_dir / "one.tdms").write_bytes(b"")
    (ambiguous_dir / "two.tdms").write_bytes(b"")

    try:
        resolve_ingest_path(empty_dir)
    except ValueError as exc:
        assert "No .tdms file" in str(exc)
    else:
        raise AssertionError("empty directory was accepted")

    try:
        resolve_ingest_path(ambiguous_dir)
    except ValueError as exc:
        assert "multiple .tdms files" in str(exc)
    else:
        raise AssertionError("ambiguous directory was accepted")
