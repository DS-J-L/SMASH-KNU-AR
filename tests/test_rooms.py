from contextlib import ExitStack
import asyncio
import base64
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.connections import Peer
from backend.server import create_app
from backend.settings import load_settings
from helpers import recv_type

PATH = "/ws/single/signaling"


@pytest.fixture
def client():
    with TestClient(create_app(load_settings())) as c:
        yield c


def hello(role="camera", cid="C0", device="phone", room="room-1"):
    return {"schema": "room.v1", "type": "join", "room_id": room,
            "role": role, "camera_id": cid, "device_id": device}


def join(ws, **kwargs):
    ws.send_json(hello(**kwargs))
    return recv_type(ws, "joined")


def command(ws, kind, room="room-1"):
    ws.send_json({"schema": "room.v1", "type": kind, "room_id": room})


def test_four_slots_and_legacy_readiness_unchanged(client):
    assert client.get('/api/single/rooms').json()['rooms'][0]['state'] == 'empty'
    with ExitStack() as stack:
        monitor = stack.enter_context(client.websocket_connect(PATH))
        join(monitor, role='monitor', cid=None, device='pc')
        assert recv_type(monitor, 'room_status')['state'] == 'waiting'
        for cid in ('C0', 'C1', 'C2'):
            camera = stack.enter_context(client.websocket_connect(PATH))
            join(camera, cid=cid, device=cid)
        status = client.get('/api/single/rooms').json()['rooms'][0]
        assert status['state'] == 'connected' and status['camera_count'] == 3
        assert status['monitor_connected']
        assert not client.app.state.runtime.status()['game_ready']
        assert client.app.state.runtime.registry.current('C0') is None
    assert client.get('/api/single/rooms').json()['rooms'][0]['state'] == 'empty'


@pytest.mark.parametrize('patch,code', [
    ({'room_id': 'room-4'}, 'unknown_room'),
    ({'room_id': 'room-3'}, 'unknown_room'),
    ({'room_id': []}, 'unknown_room'),
    ({'role': 'admin'}, 'invalid_role'),
    ({'camera_id': 'C3'}, 'invalid_camera_id'),
    ({'role': 'monitor'}, 'invalid_camera_id'),
    ({'device_id': ' '}, 'invalid_device_id'),
    ({'type': 'ping'}, 'join_required'),
])
def test_invalid_join_does_not_occupy_slot(client, patch, code):
    with client.websocket_connect(PATH) as ws:
        ws.send_json(hello() | patch)
        assert recv_type(ws, 'error')['code'] == code
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert client.get('/api/single/rooms').json()['rooms'][0]['state'] == 'empty'


@pytest.mark.parametrize('role,cid', [('camera', 'C0'), ('monitor', None)])
def test_duplicate_slot_and_same_device_reconnect(client, role, cid):
    with client.websocket_connect(PATH) as old:
        first = join(old, role=role, cid=cid)
        with client.websocket_connect(PATH) as other:
            other.send_json(hello(role, cid, 'other'))
            assert recv_type(other, 'error')['code'] == 'slot_in_use'
        with client.websocket_connect(PATH) as new:
            second = join(new, role=role, cid=cid)
            assert first['connection_id'] != second['connection_id']
            assert recv_type(old, 'error')['code'] == 'superseded'
            with pytest.raises(WebSocketDisconnect) as exc:
                old.receive_json()
            assert exc.value.code == 4001
            command(new, 'ping')
            assert recv_type(new, 'pong')['room_id'] == 'room-1'
            slot = cid if role == 'camera' else 'monitor'
            assert client.app.state.rooms.members['room-1'][slot].connection_id == second['connection_id']


def test_device_cannot_take_two_slots_and_room_cannot_change(client):
    with client.websocket_connect(PATH) as camera:
        join(camera)
        with client.websocket_connect(PATH) as duplicate:
            duplicate.send_json(hello(cid='C1'))
            assert recv_type(duplicate, 'error')['code'] == 'device_in_use'
        command(camera, 'get_status', room='room-2')
        assert recv_type(camera, 'error')['code'] == 'room_mismatch'
        command(camera, 'unknown')
        assert recv_type(camera, 'error')['code'] == 'unsupported_message'
        command(camera, 'ping')
        assert recv_type(camera, 'pong')['room_id'] == 'room-1'


def test_leave_notifies_monitor(client):
    with client.websocket_connect(PATH) as monitor:
        join(monitor, role='monitor', cid=None, device='pc')
        recv_type(monitor, 'room_status')
        with client.websocket_connect(PATH) as camera:
            join(camera)
            assert recv_type(monitor, 'room_status')['camera_count'] == 1
            command(camera, 'leave')
            with pytest.raises(WebSocketDisconnect):
                recv_type(camera, 'unused')
            status = recv_type(monitor, 'room_status')
            assert status['camera_count'] == 0 and status['state'] == 'waiting'


def test_heartbeat_timeout_releases_slot():
    settings = replace(load_settings(), heartbeat_timeout_s=0.15)
    with TestClient(create_app(settings)) as client:
        with client.websocket_connect(PATH) as ws:
            join(ws)
            assert recv_type(ws, 'error')['code'] == 'heartbeat_timeout'
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4408
        assert client.get('/api/single/rooms').json()['rooms'][0]['state'] == 'empty'


def test_signals_are_addressed_and_server_stamps_sender(client):
    with client.websocket_connect(PATH) as monitor, client.websocket_connect(PATH) as camera:
        pc = join(monitor, role='monitor', cid=None, device='pc')
        phone = join(camera)
        camera.send_json({'schema':'room.v1', 'type':'offer', 'room_id':'room-1',
                          'target_connection_id':pc['connection_id'], 'from_connection_id':'forged',
                          'payload':{'type':'offer','sdp':'test-sdp'}})
        signal = recv_type(monitor, 'offer')
        assert signal['from_connection_id'] == phone['connection_id']
        assert signal['camera_id'] == 'C0'
        assert signal['target_connection_id'] == pc['connection_id']
        monitor.send_json({'schema':'room.v1', 'type':'answer', 'room_id':'room-1',
                          'target_connection_id':phone['connection_id'],
                          'payload':{'type':'answer','sdp':'answer-sdp'}})
        assert recv_type(camera, 'answer')['from_connection_id'] == pc['connection_id']


def test_wrong_role_stale_target_and_cross_room_signals_are_rejected(client):
    with client.websocket_connect(PATH) as c0, client.websocket_connect(PATH) as c1:
        join(c0, device='phone0')
        second = join(c1, cid='C1', device='phone1')
        signal = {'schema':'room.v1','room_id':'room-1','type':'offer',
                  'target_connection_id':second['connection_id'], 'payload':{'type':'offer','sdp':'sdp'}}
        c0.send_json(signal)
        assert recv_type(c0,'error')['code'] == 'invalid_target'
        c0.send_json(signal | {'target_connection_id':'old-connection'})
        assert recv_type(c0,'error')['code'] == 'target_unavailable'
        c0.send_json(signal | {'room_id':'room-2'})
        assert recv_type(c0,'error')['code'] == 'room_mismatch'


def test_server_video_is_stamped_and_not_sent_back_to_camera(client):
    with client.websocket_connect(PATH) as monitor, client.websocket_connect(PATH) as camera:
        pc = join(monitor, role='monitor', cid=None, device='pc')
        camera.send_json(hello() | {'transport':'server'})
        phone = recv_type(camera,'joined')
        assert recv_type(camera,'room_status')['cameras'][0]['transport'] == 'server'
        # More than the 16KB control limit, within the separately bounded video limit.
        data = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8'+b'x'*20000+b'\xff\xd9').decode()
        camera.send_json({'schema':'room.v1','room_id':'room-1','type':'video_frame',
                          'frame_id':1,'camera_id':'C2','data_url':data,'prepared_at_server_ms':1700000000123.5})
        frame = recv_type(monitor,'video_frame')
        assert frame['camera_id'] == 'C0' and frame['data_url'] == data
        assert frame['prepared_at_server_ms'] == 1700000000123.5
        assert frame['from_connection_id'] == phone['connection_id']
        assert frame['target_connection_id'] == pc['connection_id']
        command(camera,'ping')
        assert recv_type(camera,'pong')['type'] == 'pong'


@pytest.mark.parametrize('transport,frame,code', [
    ('webrtc', {'frame_id':1,'data_url':'data:image/jpeg;base64,/9j/2Q=='}, 'invalid_transport'),
    ('server', {'frame_id':True,'data_url':'data:image/jpeg;base64,/9j/2Q=='}, 'invalid_frame'),
    ('server', {'frame_id':1,'data_url':'data:image/png;base64,AAAA'}, 'invalid_frame'),
    ('server', {'frame_id':1,'data_url':'data:image/jpeg;base64,!!!'}, 'invalid_frame'),
    ('server', {'frame_id':1,'data_url':'data:image/jpeg;base64,/9j/2Q==','prepared_at_server_ms':True}, 'invalid_frame_time'),
])
def test_relay_frame_validation(client, transport, frame, code):
    with client.websocket_connect(PATH) as camera:
        camera.send_json(hello() | {'transport':transport})
        recv_type(camera,'joined')
        camera.send_json({'schema':'room.v1','type':'video_frame','room_id':'room-1',**frame})
        assert recv_type(camera,'error')['code'] == code


def test_slow_video_consumer_gets_latest_frame_and_control_messages():
    async def run():
        started, release = asyncio.Event(), asyncio.Event()
        sent = []
        class Socket:
            async def send_text(self, text):
                started.set()
                await release.wait()
                sent.append(json.loads(text))
        peer = Peer(Socket(), 'slow').start()
        try:
            peer.send_video('C0', {'frame':0})
            await started.wait()
            for n in range(1, 20):
                peer.send_video('C0', {'frame':n})
            peer.send({'type':'pong'})
            release.set()
            for _ in range(20):
                await asyncio.sleep(0)
            assert sent == [{'frame':0},{'frame':19},{'type':'pong'}]
            assert peer.dropped == 18
        finally:
            await peer.stop()
    asyncio.run(run())


def test_clock_ping_has_correlated_server_timestamps(client):
    with client.websocket_connect(PATH) as ws:
        join(ws)
        ws.send_json({'schema':'room.v1','type':'ping','room_id':'room-1','ping_id':42})
        pong = recv_type(ws,'pong')
        assert pong['ping_id'] == 42
        assert 1_700_000_000_000 < pong['server_received_ms'] <= pong['server_sent_ms']
        ws.send_json({'schema':'room.v1','type':'ping','room_id':'room-1','ping_id':True})
        assert recv_type(ws,'error')['code'] == 'invalid_ping_id'
        command(ws,'ping')
        assert recv_type(ws,'pong')['ping_id'] is None  # Old heartbeat clients still work.


def test_room_capacities_are_three_and_one(client):
    rooms=client.get('/api/single/rooms').json()['rooms']
    assert [(r['room_id'],r['max_cameras']) for r in rooms]==[('room-1',3),('room-2',1)]
    assert rooms[0]['camera_mode']=='multi_camera' and rooms[1]['camera_mode']=='single_camera'
    assert [c['camera_id'] for c in rooms[1]['cameras']]==['C0']


@pytest.mark.parametrize('cid',['C1','C2'])
def test_single_room_rejects_additional_camera_slots(client,cid):
    with client.websocket_connect(PATH) as ws:
        ws.send_json(hello(cid=cid,room='room-2'))
        assert recv_type(ws,'error')['code']=='invalid_camera_id'
    assert client.app.state.rooms.status('room-2')['camera_count']==0
