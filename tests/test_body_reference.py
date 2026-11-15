import pytest
from backend.body_reference import BodyCapture
from backend.fragment_test import FragmentTest,apply_body_reference,model_command


def person(height=1.7):
    return {name:{'p':[x,0,z]} for name,x,z in [
        ('left_hip',-.1,height*.53),('right_hip',.1,height*.53),
        ('left_shoulder',-.2,height*.8),('right_shoulder',.2,height*.8),
        ('nose',0,height*.92),('left_ankle',-.1,.08),('right_ankle',.1,.08)]}


def test_explicit_three_view_stable_capture_locks_and_never_follows_motion():
    c=BodyCapture();assert not c.update(person(),0,3);c.start()
    for at in range(0,2700,50):c.update(person(),at,3)
    assert c.reference['waist_height_m']==pytest.approx(1.02)
    frozen=dict(c.reference)
    for at in range(2700,6000,50):c.update(person(1.1),at,3)
    assert c.reference==frozen
    c.invalidate();assert c.reference is None and not c.active


def test_missing_views_and_bad_standing_reset_capture_samples():
    c=BodyCapture();c.start();c.update(person(),0,2);assert not c.samples
    bad=person();bad['left_ankle']['p'][0]=1
    c.update(bad,3000,3);assert not c.samples and c.reference is None


def test_real_fusion_capture_and_moving_person_keeps_fixed_model(monkeypatch):
    import numpy as np
    from backend.test_multi3d import Multi3d,parse_calibration
    from test_multi3d_relay import CAMS,calib,landmarks
    hub=Multi3d();hub.fragment_test=FragmentTest();hub.body_required=True;hub.body_capture.start()
    for c in CAMS:hub.calibs[c]=parse_calibration(c,calib(c))
    clock=[1000]
    monkeypatch.setattr('backend.test_multi3d.now_ms',lambda:clock[0])
    for at in range(1000,3800,50):
        clock[0]=at
        points={n:np.array(v['p']) for n,v in person().items()}
        for c in CAMS:hub.frames[c]={'landmarks':landmarks(c,points),'at':at,'fps':20}
        out=hub.fuse()
    assert out['body_calibration']['state']=='locked'
    first=out['model_test']['placement']
    clock[0]+=50
    points={n:np.array(v['p'])+[.3,.4,-.1] for n,v in person(1.2).items()}
    for c in CAMS:hub.frames[c]={'landmarks':landmarks(c,points),'at':clock[0],'fps':20}
    after=hub.fuse()
    assert after['model_test']['placement']==first
    assert after['building']['half']==out['building']['half']


def test_model_reference_freezes_size_and_anchor_through_restore_and_scene_switch():
    m=FragmentTest()
    ref={'id':'capture','waist_height_m':1.02,'anchor_m':[0,0,0]}
    apply_body_reference(m,ref);assert m.target.hi[2]==pytest.approx(1.02*.7)
    before=m.snapshot()['placement'];model_command(m,{'type':'multi3d_model_reset'})
    assert m.snapshot()['placement']==before
    assert model_command(m,{'type':'multi3d_model_config','placement':{'x_m':2,'scale':.2}}) is m
    apply_body_reference(m,ref|{'waist_height_m':.6});assert m.snapshot()['placement']==before
    zone=model_command(m,{'type':'multi3d_model_scene','scene_id':'dormitories-01'})
    assert zone.body_reference==ref and zone.target.hi[2]==pytest.approx(1.02*.7)
    single=model_command(zone,{'type':'multi3d_model_scene','scene_id':'it1'})
    assert single.snapshot()['placement']==before


def test_all_zones_match_single_height_and_preserve_internal_proportions():
    from backend.building_scenes import scene_list
    from backend.model_strike import Placement
    from backend.fragment_test import target_for
    ref={'id':'height-test','waist_height_m':1.02}
    for choice in scene_list():
        m=FragmentTest(scene_id=choice['id']);apply_body_reference(m,ref)
        assert m.target.hi[2]==pytest.approx(.714)
        assert m.target.placement.x_m==m.target.placement.y_m==0
        base=target_for(Placement(scale=1),m.scene_id)
        assert m.target.placement.scale==pytest.approx(.714/base.hi[2])
        model_command(m,{'type':'multi3d_model_reset'})
        assert m.target.hi[2]==pytest.approx(.714)


def test_body_start_command_is_accepted_from_phone_and_blocks_hits_until_capture():
    from fastapi.testclient import TestClient
    from backend.server import create_app
    from backend.settings import load_settings
    from test_multi3d_relay import until
    with TestClient(create_app(load_settings(access_key='body-test'))) as client:
        with client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=body-test') as pc:
            with client.websocket_connect('/ws/test/multi3d?role=phone&camera=C0&key=body-test') as phone:
                phone.send_json({'type':'multi3d_body_start'})
                out=until(pc,lambda m:m['type']=='multi3d_fused' and m.get('body_calibration',{}).get('state')=='capturing')
                assert out['hit']=={} and out['model_test']['removed_ids']==[]
