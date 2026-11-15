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

            mask={'encoding':'camera_z_mm_rg16_alpha_v1','width':2,'height':2,'data':'data:image/png;base64,paired-test'}
            phone.send_json({'type':'mono3d_jpeg','t_ms':123,'data':'data:image/jpeg;base64,paired-test','occlusion':mask})
            image=receive_until(viewer,'mono3d_jpeg')
            assert image['t_ms']==123 and image['occlusion']==mask

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


def test_mono_model_blast_is_independent_from_multi_and_invalid_frames_do_not_hit(client):
    from test_fragment_test import approach
    from test_multi3d_relay import until
    from backend.fragment_test import FragmentTest
    a,b,_=approach(FragmentTest())
    with client.websocket_connect('/ws/test/mono3d?role=viewer&model=it1&key=s3cret') as viewer, \
         client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=s3cret') as multi:
        initial=until(viewer,lambda m:m['type']=='mono3d_model_state')
        other=until(multi,lambda m:m['type']=='multi3d_model_state')
        assert initial['source']=='mono_approx' and initial['model_test']['epoch']!=other['model_test']['epoch']
        assert initial['model_test']['depth_margin']==0 and other['model_test']['depth_margin']==0
        with client.websocket_connect('/ws/test/mono3d?role=phone&key=s3cret') as phone:
            for p in (a,b):phone.send_json({'type':'mono3d_frame','valid':True,'joints':{'right_wrist':p},'source':'multi_view'})
            hit=until(viewer,lambda m:m['type']=='mono3d_model_state' and len(m['model_test']['removed_ids'])==96)
            assert hit['source']=='mono_approx' and hit['model_test']['event']['blast']
            # Unknown/invalid observation cannot be promoted to a valid wrist by the viewer.
            viewer.send_json({'type':'multi3d_model_reset'})
            reset=until(viewer,lambda m:m['type']=='mono3d_model_state' and m['model_test']['epoch']!=initial['model_test']['epoch'])
            assert reset['model_test']['removed_ids']==[]
            for p in (a,b):phone.send_json({'type':'mono3d_frame','valid':False,'joints':{'right_wrist':p}})
            frame=until(viewer,lambda m:m['type']=='mono3d_model_state')
            assert frame['model_test']['removed_ids']==[]
            viewer.send_json({'type':'multi3d_model_blast_config','enabled':True,'radius':float('nan'),'strength':12})
            assert until(viewer,lambda m:m['type']=='error')['code']=='bad_message'
        multi.send_json({'type':'multi3d_model_blast_config','enabled':True,'radius':3,'strength':12})
        assert until(multi,lambda m:m['type']=='multi3d_fused')['model_test']['removed_ids']==[]


def test_body_depth_recalibration_resets_the_old_wrist_path(client):
    from backend.fragment_test import FragmentTest
    from test_fragment_test import approach
    from test_multi3d_relay import until
    a,b,_=approach(FragmentTest())
    with client.websocket_connect('/ws/test/mono3d?role=viewer&model=it1&key=s3cret') as viewer, \
         client.websocket_connect('/ws/test/mono3d?role=phone&key=s3cret') as phone:
        initial=until(viewer,lambda m:m['type']=='mono3d_model_state')['model_test']
        assert initial['depth_margin']==0
        phone.send_json({'type':'mono3d_calib','body':{'scale':1,'depth_reference':{'ankle_height_m':.08}}})
        phone.send_json({'type':'mono3d_frame','valid':True,'joints':{'right_wrist':a}})
        until(viewer,lambda m:m['type']=='mono3d_model_state' and m['model_test']['diagnostics'].get('right_wrist',{}).get('reason')=='baseline')
        phone.send_json({'type':'mono3d_calib','body':{'scale':1.1,'depth_reference':{'ankle_height_m':.09}}})
        phone.send_json({'type':'mono3d_frame','valid':True,'joints':{'right_wrist':b}})
        result=until(viewer,lambda m:m['type']=='mono3d_model_state')['model_test']
        assert result['removed_ids']==[]
        assert result['diagnostics']['right_wrist']['reason']=='baseline'


def test_mono_lifted_fast_ankle_hits_but_a_foot_on_the_floor_does_not(client):
    from test_fragment_test import kick_path
    from test_multi3d_relay import until
    from backend.fragment_test import FragmentTest
    a,b,_=kick_path(FragmentTest(),.4)
    low_a,low_b=[a[0],a[1],.05],[b[0],b[1],.05]
    with client.websocket_connect('/ws/test/mono3d?role=viewer&model=it1&key=s3cret') as viewer, \
         client.websocket_connect('/ws/test/mono3d?role=phone&key=s3cret') as phone:
        until(viewer,lambda m:m['type']=='mono3d_model_state')
        for p in (low_a,low_b):phone.send_json({'type':'mono3d_frame','valid':True,'joints':{'left_ankle':p}})
        flat=until(viewer,lambda m:m['type']=='mono3d_model_state' and m['model_test']['diagnostics'].get('left_ankle',{}).get('position_m')==low_b)
        assert flat['model_test']['removed_ids']==[] and flat['model_test']['event'] is None
        for p in (a,b):phone.send_json({'type':'mono3d_frame','valid':True,'joints':{'right_ankle':p}})
        hit=until(viewer,lambda m:m['type']=='mono3d_model_state' and m['model_test']['event'])
        assert hit['model_test']['event']['kind']=='ankle' and hit['model_test']['event']['joint']=='right_ankle'
        assert hit['model_test']['removed_ids']


def test_mono_selects_single_buildings_refuses_zones_and_multi_takes_zones(client):
    from test_multi3d_relay import until
    from backend.building_scenes import single_scene_list
    single=single_scene_list()[1]['id']
    with client.websocket_connect('/ws/test/mono3d?role=viewer&model=it1&key=s3cret') as mono,          client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=s3cret') as multi:
        until(mono,lambda m:m['type']=='mono3d_model_state');until(multi,lambda m:m['type']=='multi3d_model_state')
        mono.send_json({'type':'multi3d_model_scene','scene_id':'museum-social-01'})
        assert until(mono,lambda m:m['type']=='error')['code']=='bad_message'
        mono.send_json({'type':'multi3d_model_scene','scene_id':single})
        state=until(mono,lambda m:m['type']=='mono3d_model_state' and m['model_test']['scene_id']==single)
        assert state['model_test']['fragment_count']>0
        multi.send_json({'type':'multi3d_model_scene','scene_id':'museum-social-01'})
        state=until(multi,lambda m:(m.get('model_test') or {}).get('scene_id')=='museum-social-01')
        assert state['model_test']['fragment_count']>96


def test_building_scene_list_kinds(client):
    zones=client.get('/api/test/building-scenes?key=s3cret').json()
    singles=client.get('/api/test/building-scenes?kind=single&key=s3cret').json()
    assert len(zones)==24 and len(singles)==62 and singles[0]['id']=='it1'
    assert client.get('/api/test/building-scenes?kind=x&key=s3cret').status_code==400
