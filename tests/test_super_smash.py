"""Synthetic three-view policy tests using shipped hulls and deterministic times."""
from types import SimpleNamespace
import pytest

from backend.super_smash import SuperSmash
from backend.fragment_test import FragmentTest
from test_fragment_test import approach


def setup():
    model=FragmentTest();a,b,fid=approach(model)
    status={c:dict(connected=True,calibrated=True,age_ms=0,clock_ready=True,clock_uncertainty_ms=1) for c in ('C0','C1','C2')}
    hub=SimpleNamespace(fragment_test=model,viewer_ids={'peer':'pc'},status=lambda:{'cameras':status})
    s=SuperSmash();hub.smash=s
    def command(action,**args):
        return s.control(dict(type='multi3d_model_control',request_id=str(s.control_revision)+action,
            server_instance_id=s.instance,expected_epoch=hub.fragment_test.epoch,expected_control_revision=s.control_revision,action=action,**args),'pc',hub,0)
    command('claim_controller');command('set_mode',mode='super_smash')
    s.presentation(dict(server_instance_id=s.instance,epoch=model.epoch,c0_frame_age_ms=0,presentation_ready=True,visible=True,assets_ready=True),'pc',model,0)
    s.input_modes={c:'synthetic' for c in status}
    return hub,s,a,b,fid,status,command


def step(hub,s,p,at,*,cams=('C0','C1'),timing='inference_input_aligned',now=None):
    joints={'right_wrist':{'p':p,'cams':list(cams)}} if p is not None else {}
    eligible=s.gate(hub,joints,at,at if now is None else now,timing,dict.fromkeys(('C0','C1','C2')),True)
    state=hub.fragment_test.snapshot() if eligible is None else hub.fragment_test.update(eligible,at,super_smash=True)
    return s.decorate(state)


def arm(hub,s,a):
    for at in (0,100,200,310):result=step(hub,s,a,at)
    assert result['phase']=='armed'


def test_valid_two_view_joint_with_three_healthy_devices_releases_all_once():
    h,s,a,b,fid,_,_=setup();arm(h,s,a)
    m=step(h,s,b,350)
    assert len(m['removed_ids'])==m['fragment_count']==m['score']==96
    assert m['event']['points']==96 and m['event']['fragment_id']==fid
    assert m['event']['joint_cameras']==['C0','C1'] and m['event']['input_mode']=='synthetic'
    assert m['event']['effect_style']=='screen_impact_v1' and m['phase']=='cleared'
    assert step(h,s,b,390)['event'] is None


@pytest.mark.parametrize('field,value,reason',[
    ('connected',False,'three_cameras_required'),('calibrated',False,'three_cameras_required'),
    ('age_ms',401,'three_cameras_required'),('clock_ready',False,'clock_not_ready'),
    ('clock_uncertainty_ms',11,'clock_not_ready')])
def test_third_device_failure_stops_a_good_two_view_joint(field,value,reason):
    h,s,a,b,_,status,_=setup();arm(h,s,a);status['C2'][field]=value
    out=step(h,s,b,350);assert not out['event'] and out['readiness']['reason']==reason
    assert out['score']==0


@pytest.mark.parametrize('case',['inside_first','missing','gap','jump','legacy','one_view','stale_pc','unknown_source'])
def test_no_false_sweep_after_bad_or_unprepared_input(case):
    h,s,a,b,_,_,_=setup()
    if case=='inside_first':out=step(h,s,b,0)
    else:
        arm(h,s,a)
        if case=='missing':step(h,s,None,330);out=step(h,s,b,350)
        elif case=='gap':out=step(h,s,b,600)
        elif case=='jump':out=step(h,s,[a[0]+2,a[1],a[2]],350)
        elif case=='legacy':out=step(h,s,b,350,timing='server_arrival')
        elif case=='one_view':out=step(h,s,b,350,cams=('C0',))
        elif case=='stale_pc':out=step(h,s,b,350,now=3001)
        else:s.input_modes={};out=step(h,s,b,350)
    assert out['event'] is None and out['score']==0


def test_all_remaining_ids_score_and_mouse_is_not_promoted():
    h,s,a,b,_,_,_=setup();h.fragment_test.removed=set(range(20))
    # Fixture already has missing pieces: pick a contact among remaining hulls.
    from dataclasses import replace
    from backend.model_strike import first_entry
    t=replace(h.fragment_test.target,fragments=[f for f in h.fragment_test.target.fragments if f.fragment_id not in h.fragment_test.removed])
    a=[0,t.lo[1]-.2,t.hi[2]*.7];b=[0,t.hi[1]+.2,t.hi[2]*.7]
    contact=first_entry(t,a,b)
    assert contact
    arm(h,s,a);m=step(h,s,b,350)
    assert m['event']['points']==76 and m['score']==96
    j=FragmentTest();a,b,_=approach(j)
    event=j.mouse_hit(a,[b[i]-a[i] for i in range(3)])
    assert event.get('effect_style') is None and event['input_mode']=='mouse_demo'


def test_controls_duplicate_stale_pause_reset_and_normal_restore():
    h,s,a,b,_,_,command=setup();arm(h,s,a)
    old_epoch=h.fragment_test.epoch
    message=dict(request_id='reset-id',server_instance_id=s.instance,expected_epoch=old_epoch,expected_control_revision=s.control_revision,action='reset')
    ack,state=s.control(message,'pc',h,400);new_epoch=h.fragment_test.epoch
    assert ack['accepted'] and new_epoch!=old_epoch
    again,snapshot=s.control(message,'pc',h,401)
    assert again==ack and snapshot is None and h.fragment_test.epoch==new_epoch
    rejected,_=s.control(message|{'request_id':'new-id'},'pc',h,402)
    assert rejected['code']=='stale_epoch'
    command('pause');assert step(h,s,b,430)['phase']=='paused'
    command('resume');assert step(h,s,b,450)['event'] is None
    command('set_mode',mode='normal');assert s.mode=='normal' and not h.fragment_test.removed
    assert h.fragment_test.blast_enabled is False  # approach fixture option was preserved


def test_calibration_invalidates_prepared_trajectory_and_lease_owner():
    h,s,a,b,_,_,_=setup();arm(h,s,a);s.invalidate(h.fragment_test)
    assert step(h,s,b,350)['event'] is None
    old=s.control_revision;s.disconnect('pc');assert s.controller is None and s.control_revision>old


def test_three_building_scene_over_128_keeps_full_logical_removal_and_score():
    h,s,_,_,_,_,_=setup();h.fragment_test=FragmentTest(scene_id='dormitories-01')
    s.presentation(dict(server_instance_id=s.instance,epoch=h.fragment_test.epoch,c0_frame_age_ms=0,presentation_ready=True,visible=True,assets_ready=True),'pc',h.fragment_test,0)
    a,b,_=approach(h.fragment_test);assert len(h.fragment_test.target.fragments)>128
    arm(h,s,a);result=step(h,s,b,350)
    assert result['score']==len(h.fragment_test.target.fragments)
    assert result['event']['points']==len(result['removed_ids'])
    assert len(result['event']['released_ids'])>128


def test_new_model_epoch_cannot_inherit_old_pc_readiness():
    h,s,a,b,_,_,_=setup();arm(h,s,a);h.fragment_test.reset()
    out=step(h,s,b,350)
    assert out['readiness']['reason']=='pc_not_ready' and out['score']==0


def test_unknown_control_fields_do_not_partially_change_mode():
    h,s,_,_,_,_,_=setup()
    message=dict(request_id='bad-fields',server_instance_id=s.instance,expected_epoch=h.fragment_test.epoch,
                 expected_control_revision=s.control_revision,action='set_mode',mode='normal',unrelated=True)
    ack,_=s.control(message,'pc',h,0)
    assert not ack['accepted'] and s.mode=='super_smash'


def test_websocket_controller_ownership_legacy_bypass_and_other_hub_rejection():
    from fastapi.testclient import TestClient
    from backend.server import create_app
    from backend.settings import load_settings
    from test_multi3d_relay import until
    with TestClient(create_app(load_settings(access_key='super-test'))) as client:
        with client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=super-test') as ws:
            identity=until(ws,lambda m:m['type']=='multi3d_viewer')['viewer_id']
            state=until(ws,lambda m:m['type']=='multi3d_model_state')['model_test']
            def command(action,**args):
                nonlocal state
                ws.send_json(dict(type='multi3d_model_control',request_id=action,action=action,
                    server_instance_id=state['server_instance_id'],expected_epoch=state['epoch'],
                    expected_control_revision=state['control_revision'],**args))
                ack=until(ws,lambda m:m['type']=='multi3d_model_control_ack')
                state=until(ws,lambda m:m['type']=='multi3d_model_state' and m['model_test']['model_revision']>=ack['model_revision'])['model_test']
                assert ack['accepted']
            command('claim_controller');assert state['controller_viewer_id']==identity
            command('set_mode',mode='super_smash')
            ws.send_json({'type':'multi3d_model_drop_all'})
            assert until(ws,lambda m:m['type']=='error')['code']=='bad_message'
            with client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=super-test') as other:
                other.send_json(dict(type='multi3d_model_control',request_id='steal',action='claim_controller',
                    server_instance_id=state['server_instance_id'],expected_epoch=state['epoch'],expected_control_revision=state['control_revision']))
                ack=until(other,lambda m:m['type']=='multi3d_model_control_ack')
                assert not ack['accepted'] and ack['code']=='not_controller'
            command('reset');assert state['score']==0 and state['event'] is None
        with client.websocket_connect('/ws/test/mono3d?role=viewer&model=it1&key=super-test') as mono:
            mono.send_json({'type':'multi3d_model_control','action':'set_mode','mode':'super_smash'})
            assert until(mono,lambda m:m['type']=='error')['code']=='bad_message'


def test_critical_queue_overflow_disconnects_instead_of_silently_losing_game_state():
    import asyncio
    from backend.connections import Peer
    class Socket:
        code=None
        async def close(self,code,reason):self.code=code
    async def scenario():
        socket=Socket();peer=Peer(socket,'test',queue_size=1)
        peer.send_critical({'type':'state','revision':1})
        peer.send_critical({'type':'event','revision':2})
        await asyncio.sleep(0)
        assert socket.code==1013
    asyncio.run(scenario())
