import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.server import create_app
from backend.settings import load_settings


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key="s3cret"))) as c:
        yield c


def test_requests_without_key_are_refused(client):
    assert client.get("/api/health").status_code == 401
    assert client.get("/monitor/").status_code == 401
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/status") as ws:
            ws.receive_json()


def test_key_in_url_sets_cookie_for_later_requests(client):
    r = client.get("/monitor/?key=s3cret")
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie and "s3cret" not in cookie
    assert client.get("/api/health").status_code == 200        # cookie jar now carries it
    with client.websocket_connect("/ws/status") as ws:
        assert ws.receive_json()["type"] == "system_status"


def test_wrong_key_is_refused(client):
    assert client.get("/api/health?key=nope").status_code == 401
