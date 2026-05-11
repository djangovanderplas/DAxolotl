"""Skeleton smoke test — confirms the FastAPI app boots and /api/health responds."""

from daxolotl.main import app
from fastapi.testclient import TestClient


def test_health() -> None:
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body
