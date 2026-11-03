import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.server import create_app
from backend.settings import load_settings
from helpers import pose_2d, recv_type, register


@pytest.fixture
def client():
    with TestClient(create_app(load_settings())) as c:
        yield c


def _registered(ws, **kw):
    ws.send_json(register(**kw))
    return recv_type(ws, "registered")


def test_register_gives_stream_and_no_calibration(client):
    with client.websocket_connect("/ws/ingest") as ws:
        reg = _registered(ws)
        assert reg["camera_id"] == "C0" and len(reg["stream_id"]) == 32
        assert reg["expected"] is None          # no calibration configured
        assert recv_type(ws, "clock_ping")["ping_id"] == 1


def test_first_message_must_be_register(client):
    with client.websocket_connect("/ws/ingest") as ws:
        ws.send_json({"schema_version": "0.1", "type": "pose_2d"})
        assert ws.receive_json()["code"] == "not_registered"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4400


def test_unknown_camera_id_is_rejected(client):
    with client.websocket_connect("/ws/ingest") as ws:
        ws.send_json(register(camera_id="C9"))
        assert ws.receive_json()["code"] == "invalid_camera_id"


def test_second_device_on_same_camera_is_rejected(client):
    with client.websocket_connect("/ws/ingest") as a:
        _registered(a, device_id="phone-1")
        with client.websocket_connect("/ws/ingest") as b:
            b.send_json(register(device_id="phone-2"))
            assert b.receive_json()["code"] == "camera_id_in_use"
            with pytest.raises(WebSocketDisconnect) as exc:
                b.receive_json()
            assert exc.value.code == 4409


def test_same_device_reconnect_gets_new_stream_and_old_is_superseded(client):
    with client.websocket_connect("/ws/ingest") as a:
        first = _registered(a, device_id="phone-1")
        with client.websocket_connect("/ws/ingest") as b:
            second = _registered(b, device_id="phone-1")
            assert second["stream_id"] != first["stream_id"]
            assert recv_type(a, "error")["code"] == "superseded"
            # frames tagged with the old stream are refused on the new connection
            b.send_json(pose_2d(first, 0))
            assert recv_type(b, "error")["code"] == "stream_mismatch"


@pytest.mark.parametrize("mutate, code", [
    (lambda m: m["joints"]["left_wrist"].update(visibility=1.5), "invalid_visibility"),
    (lambda m: m.update(camera_id="C1"), "camera_id_mismatch"),
    (lambda m: m["image"].update(mirrored=True), "mirrored_not_supported"),
    (lambda m: m["image"].update(width=0), "invalid_field"),
    (lambda m: m["timing"].update(timestamp_source="guess"), "invalid_field"),
    (lambda m: m.update(schema_version="9"), "unsupported_schema_version"),
    (lambda m: m["joints"].pop("right_wrist"), "invalid_field"),
])
def test_invalid_pose_2d_is_rejected_without_closing(client, mutate, code):
    with client.websocket_connect("/ws/ingest") as ws:
        stream = _registered(ws)
        bad = pose_2d(stream, 0)
        mutate(bad)
        ws.send_json(bad)
        err = recv_type(ws, "error")
        assert err["code"] == code and err.get("frame_id") == 0
        ws.send_json(pose_2d(stream, 1))          # connection keeps working
        ws.send_json({"schema_version": "0.1", "type": "nope"})
        assert recv_type(ws, "error")["code"] == "unsupported_message"


def test_non_finite_and_oversized_messages(client):
    with client.websocket_connect("/ws/ingest") as ws:
        stream = _registered(ws)
        text = json.dumps(pose_2d(stream, 0)).replace('"u_px": 600.0', '"u_px": NaN')
        ws.send_text(text)
        assert recv_type(ws, "error")["code"] == "non_finite_number"
        ws.send_text(json.dumps({"type": "pose_2d", "pad": "x" * 20_000}))
        assert recv_type(ws, "error")["code"] == "message_too_large"


def test_duplicate_and_out_of_order_frames(client):
    with client.websocket_connect("/ws/ingest") as ws:
        stream = _registered(ws)
        ws.send_json(pose_2d(stream, 5))
        ws.send_json(pose_2d(stream, 5))
        assert recv_type(ws, "error")["code"] == "duplicate_frame"
        ws.send_json(pose_2d(stream, 3))
        assert recv_type(ws, "error")["code"] == "out_of_order_frame"


def test_status_separates_registered_receiving_and_clock(client):
    with client.websocket_connect("/ws/status") as st, client.websocket_connect("/ws/ingest") as ws:
        st.receive_json()
        stream = _registered(ws, sample_only=False)
        ws.send_json(pose_2d(stream, 0, sample_only=False))
        st.send_json({"type": "get_status"})
        for _ in range(20):
            status = recv_type(st, "system_status")
            c0 = status["cameras"][0]
            if c0["status"] == "receiving":
                break
            st.send_json({"type": "get_status"})
        assert c0["status"] == "receiving" and c0["stream_id"] == stream["stream_id"]
        assert c0["clock"]["ready"] is False           # no clock_pong answered yet
        assert c0["tracking_input"] == "not_calibrated"
        assert status["readiness"]["camera_input"] is False   # only one of three cameras
        assert status["game_ready"] is False


def test_clock_pong_makes_clock_ready(client):
    with client.websocket_connect("/ws/ingest") as ws:
        _registered(ws)
        for _ in range(3):
            ping = recv_type(ws, "clock_ping")
            ws.send_json({"schema_version": "0.1", "type": "clock_pong", "ping_id": ping["ping_id"],
                          "server_send_ms": ping["server_send_ms"], "device_time_ms": time.time() * 1000 + 5000,
                          "clock_id": "clk"})
        ws.send_json({"schema_version": "0.1", "type": "clock_pong", "ping_id": 999,
                      "server_send_ms": 0, "device_time_ms": 0, "clock_id": "clk"})
        assert recv_type(ws, "error")["code"] == "unknown_ping"
        rt = client.app.state.runtime
        clock = rt.registry.current("C0").clock
        assert clock.ready and abs(clock.offset_ms - 5000) < 100


def test_silent_stream_times_out():
    settings = load_settings(heartbeat_timeout_s=0.3)
    with TestClient(create_app(settings)) as client:
        with client.websocket_connect("/ws/ingest") as ws:
            _registered(ws)
            time.sleep(1.0)
            assert client.app.state.runtime.registry.current("C0") is None
            assert recv_type(ws, "error")["code"] == "heartbeat_timeout"


def test_contract_examples_are_accepted_by_the_validators():
    import json as _json
    from pathlib import Path

    from backend.ingest.schemas import parse_clock_pong, parse_pose_2d, parse_register
    root = Path(__file__).resolve().parents[1] / "contracts"
    ids = ("C0", "C1", "C2")
    parse_register(_json.loads((root / "register.example.json").read_text(encoding="utf-8")), ids)
    parse_clock_pong(_json.loads((root / "clock_pong.example.json").read_text(encoding="utf-8")))
    pose = parse_pose_2d(_json.loads((root / "pose_2d.example.json").read_text(encoding="utf-8")), ids)
    assert pose.capture_time_ms is None and pose.timestamp_source == "unknown"
