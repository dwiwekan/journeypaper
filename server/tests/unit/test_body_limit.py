import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture()
def client():
    # No database is touched: the engine connects lazily and /echo never uses it.
    app = create_app(Settings(database_url="postgresql+psycopg://x@127.0.0.1:1/x", max_body_bytes=1000))

    @app.post("/echo")
    async def echo(request: Request):
        return {"n": len(await request.body())}

    with TestClient(app) as c:
        yield c


def test_body_under_limit_passes(client):
    assert client.post("/echo", content=b"x" * 1000).json() == {"n": 1000}


def test_body_over_limit_413_by_header(client):
    r = client.post("/echo", content=b"x" * 1001)
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


def test_body_over_limit_413_when_streamed(client):
    def chunks():
        for _ in range(5):
            yield b"x" * 300

    r = client.post("/echo", content=chunks())
    assert "content-length" not in {k.lower() for k in r.request.headers}
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
