"""Synthetic observations over public room membership, without a real phone/model."""
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from backend.server import create_app
from backend.settings import load_settings
from backend.ingest.schemas import BODY_NAMES
from helpers import pose_2d, recv_type

PATH = '/ws/single/signaling'


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key='pc-only'))) as client:
        yield client


def enter(ws, cid='C0', room='room-1', device='phone', role='camera'):
    ws.send_json({'schema': 'room.v1', 'type': 'join', 'room_id': room, 'role': role,
                  'camera_id': cid, 'device_id': device})
    return recv_type(ws, 'joined')


def send(ws, payload, room='room-1'):
    ws.send_json({'schema': 'room.v1', 'type': 'pose', 'room_id': room, 'payload': payload})


def receive(ws, kind):
    for _ in range(60):
        message = recv_type(ws, 'pose')['payload']
        if message['type'] == kind:
            return message
    raise AssertionError(kind)


def hello(member, stream='stream-a'):
    return {'schema_version': '0.1', 'type': 'camera_hello', 'source': 'live',
            'camera_id': member['camera_id'], 'device_id': member['device_id'],
            'stream_id': stream, 'clock_id': 'perf-phone'}


def observation(ack, n=0, **over):
    return pose_2d(ack, n, sample_only=False, clock_id='perf-phone', source='unknown',
                   capture_time_ms=None, **over) | {'source': 'live'}


def test_three_public_room_cameras_feed_existing_registry_and_clean_up(client):
    with ExitStack() as stack:
        for cid in ('C0', 'C1', 'C2'):
            ws = stack.enter_context(client.websocket_connect(PATH))
            member = enter(ws, cid=cid, device=cid)
            send(ws, hello(member))
            ack = receive(ws, 'camera_ack')
            send(ws, observation(ack, body={name:None for name in BODY_NAMES}, head={'u_px':320,'v_px':100,'visibility':0.9}))
            assert receive(ws, 'pose_received')['frame_id'] == 0
            stream = client.app.state.runtime.registry.current(cid)
            assert stream.latest.pose.wrists['left_wrist'] is not None
            assert stream.latest.pose.wrists['right_wrist'] is None
            assert len(stream.latest.pose.body)==22
            assert stream.latest.pose.head.u_px==320
            assert stream.latest.aligned_capture_at_server_ms is None
        assert len(client.app.state.runtime.registry.streams) == 3
        assert not client.app.state.runtime.status()['game_ready']
    assert not client.app.state.runtime.registry.streams
    assert client.get('/ws/pose').status_code == 401  # Legacy route is still protected.


@pytest.mark.parametrize('room,role,cid', [('room-2', 'camera', 'C0'), ('room-1', 'monitor', None)])
def test_only_room_one_cameras_can_send_pose(client, room, role, cid):
    if role == 'monitor':
        client.get('/monitor/?key=pc-only')
    with client.websocket_connect(PATH) as ws:
        member = enter(ws, room=room, role=role, cid=cid)
        send(ws, hello(member), room)
        assert receive(ws, 'error')['code'] == 'pose_not_allowed'
        assert not client.app.state.runtime.registry.streams


@pytest.mark.parametrize('change,code', [
    ({'camera_id': 'C1'}, 'pose_identity_mismatch'),
    ({'device_id': 'someone-else'}, 'pose_identity_mismatch'),
    ({'source': 'replay'}, 'pose_live_required'),
])
def test_pose_identity_cannot_escape_room_slot(client, change, code):
    with client.websocket_connect(PATH) as ws:
        member = enter(ws)
        send(ws, hello(member) | change)
        assert receive(ws, 'error')['code'] == code
        assert not client.app.state.runtime.registry.streams
        ws.send_json({'schema': 'room.v1', 'type': 'ping', 'room_id': 'room-1'})
        assert recv_type(ws, 'pong')['type'] == 'pong'


def test_pose_clock_stream_restart_and_missing_detection(client):
    with client.websocket_connect(PATH) as ws:
        member = enter(ws)
        send(ws, hello(member))
        ack = receive(ws, 'camera_ack')
        ping = receive(ws, 'clock_ping')
        send(ws, {'type': 'clock_pong', 'ping_id': ping['ping_id'],
                  'server_time_ms': ping['server_time_ms'], 'client_time_ms': 1000,
                  'clock_id': 'perf-phone'})
        send(ws, observation(ack, wrists={'left_wrist': None, 'right_wrist': None}))
        receive(ws, 'pose_received')
        old = client.app.state.runtime.registry.current('C0')
        assert len(old.clock.samples) == 1
        assert all(j is None for j in old.latest.pose.wrists.values())
        send(ws, observation(ack))
        assert receive(ws, 'error')['code'] == 'duplicate_frame'
        send(ws, hello(member, 'resized'))
        new_ack = receive(ws, 'camera_ack')
        send(ws, observation(new_ack, width=640, height=480))
        receive(ws, 'pose_received')
        current = client.app.state.runtime.registry.current('C0')
        assert current is not old and not current.clock.ready
        send(ws, observation(ack, 1))
        assert receive(ws, 'error')['code'] == 'stream_mismatch'


def test_rejoining_same_device_cannot_be_unregistered_by_old_socket(client):
    with client.websocket_connect(PATH) as old:
        member = enter(old)
        send(old, hello(member))
        receive(old, 'camera_ack')
        with client.websocket_connect(PATH) as new:
            member = enter(new)
            send(new, hello(member, 'new-run'))
            ack = receive(new, 'camera_ack')
            send(new, observation(ack))
            receive(new, 'pose_received')
            assert client.app.state.runtime.registry.current('C0').stream_id == 'new-run'
