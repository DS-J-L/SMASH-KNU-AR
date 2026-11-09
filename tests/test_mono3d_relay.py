"""Test-only relay /ws/test/mono3d: phone page -> PC viewer."""
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.server import create_app
from backend.settings import load_settings


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key="s3cret"))) as c:
        yield c


def receive_until(ws, kind, limit=10):
    for _ in range(limit):
        message = ws.receive_json()
        if message["type"] == kind:
            return message
    raise AssertionError(f"{kind} not received")


def test_access_key_is_required(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/test/mono3d?role=viewer") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_phone_messages_reach_viewer_and_late_viewer_gets_latest(client):
    with client.websocket_connect("/ws/test/mono3d?role=viewer&key=s3cret") as viewer:
        assert receive_until(viewer, "mono3d_status")["phone_connected"] is False
        with client.websocket_connect("/ws/test/mono3d?role=phone&key=s3cret") as phone:
            assert receive_until(phone, "mono3d_status")["viewers"] == 1
            assert receive_until(viewer, "mono3d_status")["phone_connected"] is True
            phone.send_text(json.dumps({"type": "mono3d_calib", "building": {"center": [0, 0, 0.5]}}))
            phone.send_text(json.dumps({"type": "mono3d_frame", "hits": 2, "source": "multi_view"}))
            calib = receive_until(viewer, "mono3d_calib")
            assert calib["building"]["center"] == [0, 0, 0.5] and calib["source"] == "mono_approx"
            frame = receive_until(viewer, "mono3d_frame")
            assert frame["hits"] == 2 and frame["source"] == "mono_approx"   # never relabelled as multi-view

            phone.send_json({"type": []})
            assert receive_until(phone, "error")["code"] == "unsupported_message"

            phone.send_text(json.dumps({"type": "pose_3d"}))
            assert receive_until(phone, "error")["code"] == "unsupported_message"

            with client.websocket_connect("/ws/test/mono3d?role=viewer&key=s3cret") as late:
                assert receive_until(late, "mono3d_calib")["building"]["center"] == [0, 0, 0.5]
        assert receive_until(viewer, "mono3d_phone_left")["type"] == "mono3d_phone_left"


def test_new_phone_replaces_old_and_bad_role_is_refused(client):
    with client.websocket_connect("/ws/test/mono3d?role=phone&key=s3cret") as first:
        receive_until(first, "mono3d_status")
        with client.websocket_connect("/ws/test/mono3d?role=phone&key=s3cret") as second:
            receive_until(second, "mono3d_status")
            assert receive_until(first, "error")["code"] == "superseded"
    with client.websocket_connect("/ws/test/mono3d?role=other&key=s3cret") as bad:
        assert bad.receive_json()["code"] == "bad_role"
