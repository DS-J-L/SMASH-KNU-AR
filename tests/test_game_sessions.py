from types import SimpleNamespace
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from backend.game_sessions import GameSessions
from backend.ingest.schemas import MessageError
from backend.server import create_app
from backend.settings import load_settings
from helpers import recv_type


def context(room='room-1', device='pc'):
    pc = SimpleNamespace(role='monitor', room_id=room, device_id=device)
    ids=['C0','C1','C2'] if room=='room-1' else ['C0']
    cameras={cid:SimpleNamespace(role='camera',camera_id=cid,connection_id='camera-connection' if cid=='C0' else f'{cid}-connection') for cid in ids}
    message = {'session_id':'session-1','mode':'video_check',
               'cameras':[{'camera_id':cid,'connection_id':camera.connection_id,'video_ready':True} for cid,camera in cameras.items()]}
    return pc, message, {'monitor':pc,**cameras}


def test_room_sessions_are_independent_and_expire_using_monotonic_time():
    now=[0]; sessions=GameSessions(lambda:now[0])
    pc,msg,members=context()
    first=sessions.start(pc,msg,members)
    now[0]=20
    pc2,msg2,members2=context('room-2','pc2')
    sessions.start(pc2,msg2,members2)
    assert sessions.status('room-1')['remaining_ms']==40000
    assert sessions.status('room-2')['remaining_ms']==60000
    now[0]=60
    assert sessions.status('room-1')['state']=='ended'
    assert sessions.status('room-1')['score'] is None
    assert sessions.status('room-2')['state']=='playing'
    assert sessions.status('room-3') is None


def test_start_retries_are_idempotent_and_new_round_gets_new_id():
    now=[0]; sessions=GameSessions(lambda:now[0]); pc,msg,members=context()
    sessions.start(pc,msg,members)
    now[0]=10
    assert sessions.start(pc,msg,members)['remaining_ms']==50000
    with pytest.raises(MessageError,match='session_in_progress'):
        sessions.start(pc,msg|{'session_id':'next'},members)
    now[0]=61
    assert sessions.start(pc,msg,members)['state']=='ended'
    assert sessions.start(pc,msg|{'session_id':'next'},members)['state']=='playing'
    with pytest.raises(MessageError,match='old_session'):
        sessions.start(pc,msg,members)


@pytest.mark.parametrize('change', [
    {'cameras':[]}, {'cameras':[{'camera_id':'C0','connection_id':'old','video_ready':True}]},
    {'cameras':[{'camera_id':'C0','connection_id':'camera-connection','video_ready':False}]},
])
def test_start_checks_current_camera_bindings_and_reported_video(change):
    pc,msg,members=context()
    with pytest.raises(MessageError,match='camera_not_ready'):
        GameSessions().start(pc,msg|change,members)


def test_camera_cannot_start_and_unconnected_game_mode_is_rejected():
    pc,msg,members=context()
    with pytest.raises(MessageError,match='monitor_required'):
        GameSessions().start(members['C0'],msg,members)
    with pytest.raises(MessageError,match='game_not_connected'):
        GameSessions().start(pc,msg|{'mode':'multiview_3d'},members)


def test_socket_ack_room_selection_and_result_after_sixty_seconds():
    with TestClient(create_app(load_settings())) as client:
        assert [r['room_id'] for r in client.get('/api/single/rooms').json()['rooms']]==['room-1','room-2']
        now=[0]; client.app.state.rooms.games.now=lambda:now[0]
        with client.websocket_connect('/ws/single/signaling') as pc, client.websocket_connect('/ws/single/signaling') as phone:
            header={'schema':'room.v1','room_id':'room-2'}
            pc.send_json(header|{'type':'join','role':'monitor','device_id':'pc'})
            recv_type(pc,'joined')
            phone.send_json(header|{'type':'join','role':'camera','camera_id':'C0','device_id':'phone'})
            camera=recv_type(phone,'joined')
            pc.send_json(header|{'type':'start_game','session_id':'round-1','mode':'video_check',
                                 'cameras':[{'camera_id':'C0','connection_id':camera['connection_id'],'video_ready':True}]})
            ack=recv_type(pc,'game_ack')['game']
            assert ack['room_id']=='room-2' and ack['remaining_ms']==60000
            now[0]=60
            pc.send_json(header|{'type':'get_game_status'})
            result=recv_type(pc,'game_status')['game']
            assert result['state']=='ended' and result['reason']=='time_up'
            assert client.app.state.rooms.games.status('room-1') is None


@pytest.mark.parametrize('count',[0,1,2])
def test_multi_room_cannot_start_without_all_three_cameras(count):
    pc,msg,members=context()
    kept=['C0','C1','C2'][:count]
    members={key:value for key,value in members.items() if key=='monitor' or key in kept}
    msg['cameras']=[item for item in msg['cameras'] if item['camera_id'] in kept]
    with pytest.raises(MessageError,match='camera_not_ready'):
        GameSessions().start(pc,msg,members)


def test_three_camera_room_can_start_only_when_every_video_is_ready():
    pc,msg,members=context()
    sessions=GameSessions()
    msg['cameras'][2]['video_ready']=False
    with pytest.raises(MessageError,match='camera_not_ready'):
        sessions.start(pc,msg,members)
    msg['cameras'][2]['video_ready']=True
    assert sessions.start(pc,msg,members)['camera_ids']==['C0','C1','C2']


def test_manual_stop_freezes_elapsed_time_and_old_requests_cannot_stop_the_next_session():
    now=[0];sessions=GameSessions(lambda:now[0]);pc,msg,members=context()
    sessions.start(pc,msg,members);now[0]=12.5
    stop={'session_id':msg['session_id']}
    result=sessions.stop(pc,stop)
    assert result['state']=='ended' and result['reason']=='manual_stop'
    assert result['elapsed_ms']==12500 and result['remaining_ms']==0
    now[0]=30
    assert sessions.stop(pc,stop)==result
    assert sessions.status(pc.room_id)==result
    sessions.start(pc,msg|{'session_id':'next'},members)
    with pytest.raises(MessageError,match='session_mismatch'):
        sessions.stop(pc,stop)
    assert sessions.status(pc.room_id)['state']=='playing'


def test_stop_checks_role_reason_room_and_does_not_overwrite_time_up():
    now=[0];sessions=GameSessions(lambda:now[0]);pc,msg,members=context()
    sessions.start(pc,msg,members)
    with pytest.raises(MessageError,match='monitor_required'):
        sessions.stop(members['C0'],{'session_id':msg['session_id']})
    other,_,_=context('room-2')
    with pytest.raises(MessageError,match='session_mismatch'):
        sessions.stop(other,{'session_id':msg['session_id']})
    with pytest.raises(MessageError,match='invalid_stop_reason'):
        sessions.stop(pc,{'session_id':msg['session_id'],'reason':'fake'})
    now[0]=61
    assert sessions.stop(pc,{'session_id':msg['session_id']})['reason']=='time_up'


@pytest.mark.parametrize('room,cid', [('room-1','C0'),('room-1','C1'),('room-1','C2'),('room-2','C0')])
def test_required_camera_disconnect_stops_room_and_rejoin_keeps_result(room,cid):
    with TestClient(create_app(load_settings())) as client, ExitStack() as stack:
        now=[0];client.app.state.rooms.games.now=lambda:now[0]
        pc=stack.enter_context(client.websocket_connect('/ws/single/signaling'))
        header={'schema':'room.v1','room_id':room}
        pc.send_json(header|{'type':'join','role':'monitor','device_id':'pc'})
        recv_type(pc,'joined')
        cameras={};report=[]
        for camera_id in (['C0','C1','C2'] if room=='room-1' else ['C0']):
            phone=stack.enter_context(client.websocket_connect('/ws/single/signaling'))
            phone.send_json(header|{'type':'join','role':'camera','camera_id':camera_id,'device_id':camera_id})
            camera=recv_type(phone,'joined');cameras[camera_id]=phone
            report.append({'camera_id':camera_id,'connection_id':camera['connection_id'],'video_ready':True})
        pc.send_json(header|{'type':'start_game','mode':'video_check','session_id':'running','cameras':report})
        recv_type(pc,'game_ack');now[0]=10
        cameras[cid].close()
        for _ in range(20):
            status=recv_type(pc,'room_status')
            if status['game'] and status['game']['state']=='ended':break
        assert status['game']['reason']=='camera_disconnected'
        assert status['game']['elapsed_ms']==10000
        replacement=stack.enter_context(client.websocket_connect('/ws/single/signaling'))
        replacement.send_json(header|{'type':'join','role':'camera','camera_id':cid,'device_id':cid})
        recv_type(replacement,'joined');now[0]=30
        pc.send_json(header|{'type':'get_game_status'})
        result=recv_type(pc,'game_status')['game']
        assert result['state']=='ended' and result['elapsed_ms']==10000


def test_socket_stop_ack_and_camera_cannot_stop_session():
    with TestClient(create_app(load_settings())) as client:
        now=[0];client.app.state.rooms.games.now=lambda:now[0]
        with client.websocket_connect('/ws/single/signaling') as pc, client.websocket_connect('/ws/single/signaling') as phone:
            header={'schema':'room.v1','room_id':'room-2'}
            pc.send_json(header|{'type':'join','role':'monitor','device_id':'pc'});recv_type(pc,'joined')
            phone.send_json(header|{'type':'join','role':'camera','camera_id':'C0','device_id':'phone'})
            camera=recv_type(phone,'joined')
            pc.send_json(header|{'type':'start_game','mode':'video_check','session_id':'running',
                                 'cameras':[{'camera_id':'C0','connection_id':camera['connection_id'],'video_ready':True}]})
            recv_type(pc,'game_ack')
            stop=header|{'type':'stop_game','session_id':'running','reason':'camera_stalled'}
            phone.send_json(stop)
            error=recv_type(phone,'error')
            assert error['code']=='monitor_required' and error['request_type']=='stop_game'
            now[0]=3;pc.send_json(stop)
            result=recv_type(pc,'game_status')['game']
            assert result['reason']=='camera_stalled' and result['elapsed_ms']==3000
