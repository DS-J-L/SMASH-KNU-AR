"""Synthetic phone observations; no physical camera or marker calibration."""
from collections import deque
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.game_sessions import GameSessions
from backend.ingest.schemas import MessageError
from backend.server import create_app
from backend.settings import load_settings
from backend.sync.clock import server_now_ms
from helpers import recv_type
from test_game_sessions import context
from test_room_pose import enter, hello, observation, receive, send


@pytest.mark.parametrize('room',['room-1','room-2'])
def test_relay_pairs_only_the_current_registered_pose_and_normalizes_pixels(room):
    with TestClient(create_app(load_settings(access_key=''))) as client:
        with client.websocket_connect('/ws/single/signaling') as pc, client.websocket_connect('/ws/single/signaling') as phone:
            enter(pc, room=room, role='monitor', cid=None, device='pc')
            phone.send_json({'schema':'room.v1','type':'join','room_id':room,
                             'role':'camera','camera_id':'C0','device_id':'phone','transport':'server'})
            member=recv_type(phone,'joined')
            send(phone,hello(member),room); ack=receive(phone,'camera_ack')
            send(phone,observation(ack),room); receive(phone,'pose_received')
            video={'schema':'room.v1','type':'video_frame','room_id':room,'frame_id':1,
                   'data_url':'data:image/jpeg;base64,/9j/2Q==','pose_stream_id':ack['stream_id'],'pose_frame_id':0}
            phone.send_json(video)
            pose=recv_type(pc,'video_frame')['phone_pose']
            assert pose['frame_id']==0 and pose['stream_id']==ack['stream_id']
            assert pose['wrists']['left_wrist']['image_norm']==[600/1280,300/720]
            assert pose['wrists']['right_wrist']['valid'] is False
            assert pose['wrists']['right_wrist']['image_norm'] is None
            assert pose['capture_time_ms'] is None
            phone.send_json(video|{'pose_frame_id':1})
            assert recv_type(phone,'error')['code']=='pose_frame_mismatch'
            phone.send_json(video|{'pose_stream_id':'another-stream'})
            assert recv_type(phone,'error')['code']=='pose_frame_mismatch'


def setup_game(room='room-1'):
    pc,msg,members=context(room); members['C0'].transport='server'
    pair={'stream_id':'phone-stream','connection_id':members['C0'].connection_id,
          'received_ms':server_now_ms(),'frames':deque([(10,server_now_ms()),(11,server_now_ms())])}
    sessions=GameSessions(); msg['mode']='phone_2d'
    sessions.start(pc,msg,members,pair)
    event={'session_id':msg['session_id'],'event_id':'strike-1','room_id':room,'stream_id':'phone-stream',
           'source':'live','tracking_mode':'single_view_2d','accepted':True,'score_delta':100,
           'building_id':'knu-it1-v3','joint':'left_wrist','previous_frame_id':10,'frame_id':11}
    return sessions,pc,msg,members,pair,event


@pytest.mark.parametrize('room',['room-1','room-2'])
def test_scoring_is_bound_to_paired_frames_and_duplicate_events_score_once(room):
    sessions,pc,msg,members,pair,event=setup_game(room)
    assert sessions.hit(pc,{'entry':event},pair)['score']==100
    assert sessions.hit(pc,{'entry':event},pair)['score']==100
    with pytest.raises(MessageError,match='already_destroyed'):
        sessions.hit(pc,{'entry':event|{'event_id':'second'}},pair)
    result=sessions.stop(pc,{'session_id':msg['session_id']})
    assert result['state']=='ended' and result['score']==100


@pytest.mark.parametrize('change',[{'stream_id':'other'}, {'frame_id':99}, {'source':'synthetic'},
    {'session_id':'old'},{'score_delta':10000},{'room_id':'room-2'}])
def test_unmatched_or_unrelated_hits_cannot_change_the_score(change):
    sessions,pc,msg,members,pair,event=setup_game()
    with pytest.raises(MessageError):
        sessions.hit(pc,{'entry':event|change},pair)
    assert sessions.status('room-1')['score']==0


def test_camera_cannot_score_and_old_frames_cannot_score():
    sessions,pc,msg,members,pair,event=setup_game()
    with pytest.raises(MessageError,match='monitor_required'):
        sessions.hit(members['C0'],{'entry':event},pair)
    pair['frames']=deque([(10,server_now_ms()-2000),(11,server_now_ms()-2000)])
    with pytest.raises(MessageError,match='invalid_hit'):
        sessions.hit(pc,{'entry':event},pair)


def test_game_requires_current_c0_relay_and_fresh_pose_pair():
    sessions,pc,msg,members,pair,event=setup_game()
    for change in ({'received_ms':server_now_ms()-1000},{'connection_id':'old-camera'}):
        with pytest.raises(MessageError,match='paired_pose_not_ready'):
            sessions.start(pc,msg|{'session_id':'new'},members,pair|change)
    members['C0'].transport='webrtc'
    with pytest.raises(MessageError,match='paired_pose_not_ready'):
        sessions.start(pc,msg|{'session_id':'new'},members,pair)


def test_room_two_c0_cannot_replace_or_feed_room_one_3d_input():
    with TestClient(create_app(load_settings(access_key=''))) as client:
        with client.websocket_connect('/ws/single/signaling') as first:
            one=enter(first,device='room-one-phone')
            send(first,hello(one,'stream-one')); ack1=receive(first,'camera_ack')
            send(first,observation(ack1));receive(first,'pose_received')
            original=client.app.state.runtime.registry.current('C0')
            with client.websocket_connect('/ws/single/signaling') as second:
                two=enter(second,room='room-2',device='different-phone')
                send(second,hello(two,'stream-two'),'room-2');ack2=receive(second,'camera_ack')
                send(second,observation(ack2),'room-2');receive(second,'pose_received')
                isolated=client.app.state.rooms.pose_registries['room-2'].current('C0')
                assert isolated.device_id=='different-phone' and isolated.latest.pose.stream_id=='stream-two'
                assert client.app.state.runtime.registry.current('C0') is original
                send(second,observation(ack1,1),'room-2')
                assert receive(second,'error')['code'] in ('stream_mismatch','device_mismatch')
            assert client.app.state.runtime.registry.current('C0') is original
            assert not client.app.state.rooms.pose_registries['room-2'].streams


def test_both_rooms_can_run_same_named_session_without_sharing_score():
    sessions,pc,msg,members,pair,event=setup_game()
    _,pc2,msg2,members2,pair2,event2=setup_game('room-2')
    sessions.start(pc2,msg2,members2,pair2)
    assert sessions.hit(pc2,{'entry':event2},pair2)['score']==100
    assert sessions.status('room-1')['score']==0
    assert sessions.status('room-1')['state']=='playing'
    with pytest.raises(MessageError,match='invalid_hit'):
        sessions.hit(pc,{'entry':event2},pair)
