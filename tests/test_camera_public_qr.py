import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.auth import PUBLIC_CAMERA_FILES
from backend.server import create_app
from backend.settings import load_settings
from helpers import recv_type


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key='private-monitor-key'))) as c:
        yield c


def test_camera_entry_and_exact_dependencies_are_public(client):
    for pathname in PUBLIC_CAMERA_FILES:
        response=client.get(pathname)
        assert response.status_code==200,pathname
        assert 'set-cookie' not in response.headers
    assert client.get('/monitor/').status_code==401
    assert client.get('/monitor/app.js').status_code==401
    assert client.get('/api/single/rooms').status_code==401
    assert client.get('/api/calibration').status_code==401
    assert client.get('/camera/').status_code==401  # Legacy pose inference page remains protected.


def test_anonymous_camera_can_join_but_cannot_start_game(client):
    with client.websocket_connect('/ws/single/signaling') as ws:
        ws.send_json({'schema':'room.v1','type':'join','room_id':'room-2','role':'camera','camera_id':'C0','device_id':'public-phone','transport':'server'})
        assert recv_type(ws,'joined')['camera_id']=='C0'
        ws.send_json({'schema':'room.v1','type':'start_game','room_id':'room-2'})
        assert recv_type(ws,'error')['code']=='monitor_required'


def test_anonymous_monitor_cannot_claim_even_an_empty_room(client):
    with client.websocket_connect('/ws/single/signaling') as ws:
        ws.send_json({'schema':'room.v1','type':'join','room_id':'room-1','role':'monitor','device_id':'intruder'})
        assert recv_type(ws,'error')['code']=='access_key_required'
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code==4401
    assert not client.app.state.rooms.status('room-1')['monitor_connected']


def test_authorized_monitor_cookie_still_works(client):
    assert client.get('/monitor/?key=private-monitor-key').status_code==200
    with client.websocket_connect('/ws/single/signaling') as ws:
        ws.send_json({'schema':'room.v1','type':'join','room_id':'room-1','role':'monitor','device_id':'pc'})
        assert recv_type(ws,'joined')['role']=='monitor'


@pytest.mark.parametrize('room',['room-1','room-2'])
def test_room_pages_are_separate_and_protected_without_intercepting_demo(client,room):
    assert client.get(f'/monitor/{room}/').status_code==401
    client.get('/monitor/?key=private-monitor-key')
    response=client.get(f'/monitor/{room}/')
    assert response.status_code==200 and 'id="game-start"' in response.text
    assert 'id="game-back"' in response.text
    assert client.get('/monitor/fracture/').status_code==200


def test_qr_svg_has_permanent_camera_url_without_secret(client):
    path='/api/single/rooms/room-1/qr/C1.svg'
    assert client.get(path).status_code==401
    client.get('/monitor/?key=private-monitor-key')
    response=client.get(path,params={'base_url':'https://smash.example:8443'})
    assert response.status_code==200
    assert response.headers['content-type'].startswith('image/svg+xml')
    root=ET.fromstring(response.content)
    target=root.find('{http://www.w3.org/2000/svg}desc').text
    assert target=='https://smash.example:8443/camera/room/?room=room-1&camera=C1'
    assert 'private-monitor-key' not in response.text and 'token=' not in response.text
    assert root.find('.//{http://www.w3.org/2000/svg}path') is not None
    assert client.get(path,params={'base_url':'https://smash.example:8443'}).content==response.content


@pytest.mark.parametrize('base',['javascript:alert(1)','https://example.com/?key=secret','https://user:password@example.com','https://example.com/path','https://example.com/#secret'])
def test_qr_rejects_credentials_and_non_origin_urls(client,base):
    client.get('/monitor/?key=private-monitor-key')
    assert client.get('/api/single/rooms/room-1/qr/C0.svg',params={'base_url':base}).status_code==400


def test_removed_room_and_disallowed_single_camera_qrs_are_not_available(client):
    client.get('/monitor/?key=private-monitor-key')
    for route in ['/monitor/room-3/','/api/single/rooms/room-3/qr/C0.svg',
                  '/api/single/rooms/room-2/qr/C1.svg','/api/single/rooms/room-2/qr/C2.svg']:
        assert client.get(route).status_code==404
    assert client.get('/api/single/rooms/room-2/qr/C0.svg').status_code==200
