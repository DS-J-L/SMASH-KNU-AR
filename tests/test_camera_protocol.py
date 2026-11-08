"""Messages shaped like feat/p1-camera-mediapipe, without camera/browser hardware."""
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.server import create_app
from backend.settings import load_settings
from helpers import pose_2d, recv_type


@pytest.fixture
def client():
    with TestClient(create_app(load_settings())) as c:
        yield c


def hello(stream_id='phone-stream', source='live', device_id='phone-a'):
    return {'schema_version': '0.1', 'type': 'camera_hello', 'camera_id': 'C0',
            'device_id': device_id, 'stream_id': stream_id, 'clock_id': 'perf-phone',
            'source': source, 'device_info': {}}


def start(ws, **kw):
    message = hello(**kw)
    ws.send_json(message)
    ack = recv_type(ws, 'camera_ack')
    assert ack['stream_id'] == message['stream_id']
    return ack


def send_pose(ws, ack, frame_id=0, source='live', **kw):
    ws.send_json(pose_2d(ack, frame_id, sample_only=False, clock_id='perf-phone',
                        source='rvfc_capture_time', **kw) | {'source': source})


def barrier(ws):
    ws.send_json({'type': 'test_barrier'})
    assert recv_type(ws, 'error')['code'] == 'unsupported_message'


def test_phone_registration_clock_and_pose(client):
    with client.websocket_connect('/ws/pose') as ws:
        ack = start(ws)
        ping = recv_type(ws, 'clock_ping')
        # Phone pong has no schema_version and uses different field names.
        ws.send_json({'type': 'clock_pong', 'ping_id': ping['ping_id'],
                      'server_time_ms': ping['server_time_ms'], 'client_time_ms': 1000.0,
                      'clock_id': 'perf-phone'})
        send_pose(ws, ack)
        barrier(ws)
        stream = client.app.state.runtime.registry.current('C0')
        assert stream.latest.pose.stream_id == 'phone-stream'
        assert stream.clock.clock_id == 'perf-phone'
        assert stream.latest.pose.timestamp_source == 'rvfc_capture_time'
        # Accept rvfc provenance but do not silently treat it as approved sensor time.
        assert stream.latest.aligned_capture_at_server_ms is None


def test_phone_rotation_resets_frames_and_rejects_old_stream(client):
    with client.websocket_connect('/ws/pose') as ws:
        ack = start(ws)
        send_pose(ws, ack, 10)
        new = dict(ack, stream_id='rotated-stream')
        send_pose(ws, new, 0, width=720, height=1280)
        barrier(ws)
        stream = client.app.state.runtime.registry.current('C0')
        assert stream.stream_id == 'rotated-stream'
        assert len(stream.frames) == 1 and stream.last_frame_id == 0
        send_pose(ws, ack, 0)
        assert recv_type(ws, 'error')['code'] == 'stream_mismatch'
        send_pose(ws, new, 0)
        assert recv_type(ws, 'error')['code'] == 'duplicate_frame'


def test_phone_unknown_visibility_is_missing_observation(client):
    with client.websocket_connect('/ws/pose') as ws:
        ack = start(ws)
        send_pose(ws, ack, wrists={'left_wrist': {'u_px': 10, 'v_px': 20, 'visibility': None},
                                   'right_wrist': None}, capture_time_ms=None)
        barrier(ws)
        pose = client.app.state.runtime.registry.current('C0').latest.pose
        assert pose.wrists == {'left_wrist': None, 'right_wrist': None}
        assert pose.timestamp_source == 'unknown'


def test_phone_replay_is_always_sample(client):
    with client.websocket_connect('/ws/pose') as ws:
        ack = start(ws, source='replay')
        assert ack['sample_only'] is True
        send_pose(ws, ack, source='replay')
        barrier(ws)
        assert client.app.state.runtime.registry.current('C0').latest.pose.sample_only is True
        send_pose(ws, ack, 1, source='live')
        assert recv_type(ws, 'error')['code'] == 'sample_flag_mismatch'


def test_phone_duplicate_and_reconnect(client):
    with client.websocket_connect('/ws/pose') as first:
        start(first)
        with client.websocket_connect('/ws/pose') as duplicate:
            duplicate.send_json(hello(device_id='phone-b'))
            assert recv_type(duplicate, 'error')['code'] == 'duplicate_camera_id'
        with client.websocket_connect('/ws/pose') as second:
            ack = start(second, stream_id='reconnected')
            send_pose(second, ack)
            barrier(second)
            assert client.app.state.runtime.registry.current('C0').last_frame_id == 0


def test_phone_reused_stream_rejected_on_reconnect(client):
    with client.websocket_connect('/ws/pose') as first:
        start(first)
        with client.websocket_connect('/ws/pose') as second:
            second.send_json(hello())
            assert recv_type(second, 'error')['code'] == 'stream_mismatch'
            with pytest.raises(WebSocketDisconnect):
                second.receive_json()


def test_phone_bad_echo_does_not_update_clock(client):
    with client.websocket_connect('/ws/pose') as ws:
        start(ws)
        ping = recv_type(ws, 'clock_ping')
        ws.send_json({'type': 'clock_pong', 'ping_id': ping['ping_id'],
                      'server_time_ms': ping['server_time_ms'] + 1,
                      'client_time_ms': 1000, 'clock_id': 'perf-phone'})
        assert recv_type(ws, 'error')['code'] == 'invalid_field'


def test_phone_route_requires_access_key():
    settings = replace(load_settings(), access_key='test-only-key')
    with TestClient(create_app(settings)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/pose'):
                pass
        with client.websocket_connect('/ws/pose?key=test-only-key') as ws:
            start(ws)
