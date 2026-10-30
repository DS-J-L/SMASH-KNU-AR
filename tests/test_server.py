from fastapi.testclient import TestClient

from backend.server import app


def test_health_and_browser_entrypoints():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/").url.path == "/monitor/"
        for path in ("/monitor/", "/camera/", "/shared/status-socket.js"):
            assert client.get(path).status_code == 200


def test_non_web_project_files_are_not_served():
    with TestClient(app) as client:
        for path in ("/config/cameras.example.json", "/backend/server.py", "/calib/README.md", "/data/README.md"):
            assert client.get(path).status_code == 404


def test_socket_never_claims_game_or_cameras_are_ready():
    """Without phones, calibration and scene the server must not report any readiness."""
    with TestClient(app) as client, client.websocket_connect("/ws/status") as socket:
        first = socket.receive_json()
        assert first["game_ready"] is False
        assert not any(first["readiness"].values())
        assert {camera["camera_id"] for camera in first["cameras"]} == {"C0", "C1", "C2"}
        assert all(camera["status"] == "disconnected" for camera in first["cameras"])
        assert all(camera["calibration"]["status"] == "missing" for camera in first["cameras"])
        socket.send_json({"type": "get_status"})
        assert socket.receive_json() == first


def test_bad_messages_do_not_break_the_status_connection():
    with TestClient(app) as client, client.websocket_connect("/ws/status") as socket:
        socket.receive_json()
        socket.send_text("not json")
        assert socket.receive_json()["code"] == "invalid_json"
        socket.send_json([])
        assert socket.receive_json()["code"] == "unsupported_message"
        socket.send_json({"type": "get_status"})
        assert socket.receive_json()["type"] == "system_status"
