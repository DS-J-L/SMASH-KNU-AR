import numpy as np
import cv2
import pytest
from backend.test_multi3d import Multi3d,parse_calibration
from backend.tracking.test_fusion import estimate
from backend.tracking.quality import estimate_joint
from backend.sync.test_inputs import InputFrames
from test_multi3d_relay import CAMS,K,W,H,calib,landmarks,person,look_at


def observations(point,cals):
    return {c:cal.normalize(cal.project(point),distorted=False)[0] for c,cal in cals.items()}


def test_weighted_reconstruction_reduces_noisy_low_confidence_view_error():
    cals={c:parse_calibration(c,calib(c)) for c in CAMS};rng=np.random.default_rng(63)
    improved=[];baseline=[]
    for _ in range(40):
        point=np.array([rng.uniform(-.4,.4),rng.uniform(0,.7),rng.uniform(.5,1.6)])
        obs=observations(point,cals)
        for c in obs:
            obs[c]+=rng.normal(0,8 if c=='C2' else .3,2)/900
        old=estimate_joint(obs,cals,2,30);new=estimate(obs,cals,{'C0':.99,'C1':.99,'C2':.51})
        if new.position_m is not None and old.position_m is not None:
            improved.append(np.linalg.norm(new.position_m-point));baseline.append(np.linalg.norm(old.position_m-point))
    assert len(improved)>=30
    print(f'noise trial median error: old={np.median(baseline):.6f}m new={np.median(improved):.6f}m')
    assert np.median(improved)<np.median(baseline)*.5


def test_nearly_parallel_views_are_rejected_instead_of_returning_unstable_depth():
    cals={}
    for c,eye in [('C0',[0,-3,1]),('C1',[.001,-3,1])]:
        R,t=look_at(eye);m=calib('C0');m.update(R=R.ravel().tolist(),t=t.tolist())
        cals[c]=parse_calibration(c,m)
    result=estimate(observations([0,.4,1.2],cals),cals,{'C0':1,'C1':1})
    assert result.position_m is None and result.reason=='poor_geometry'


def test_provided_lens_distortion_is_corrected_before_reconstruction():
    point=np.array([.65,.8,1.6]);cals={};obs={};wrong={}
    for c in CAMS:
        m=calib(c);m['dist']=[-.24,.06,.002,-.001,0];cal=parse_calibration(c,m);cals[c]=cal
        pixels,_=cv2.projectPoints(point.reshape(1,3),cv2.Rodrigues(cal.R)[0],cal.t,cal.K,cal.dist)
        obs[c]=cal.normalize(pixels.reshape(1,2),distorted=True)[0]
        wrong[c]=cal.normalize(pixels.reshape(1,2),distorted=False)[0]
    corrected=estimate(obs,cals,{c:1 for c in CAMS});assert corrected.position_m is not None
    assert np.linalg.norm(corrected.position_m-point)<1e-5
    legacy=estimate_joint(wrong,cals,2,30)
    assert legacy.position_m is None or np.linalg.norm(legacy.position_m-point)>.005


def set_clock(inputs,c,offset):
    for i in range(3):
        at=900+i*10;message=inputs.ping(c,str(i),at)
        inputs.pong(c,{'nonce':message['nonce'],'clock_id':c,'device_time_ms':at+2+offset},at+4)


def test_aligned_history_recovers_same_pose_despite_network_and_inference_delay(monkeypatch):
    hub=Multi3d();offsets={'C0':1000,'C1':-500,'C2':50}
    for c in CAMS:
        hub.calibs[c]=parse_calibration(c,calib(c));set_clock(hub.inputs,c,offsets[c])
        times=[1000,1033,1066] if c=='C0' else [1000]
        for stamp in times:
            wrist=[.3+(stamp-1000)*.003,.5,1.]
            at=stamp+({'C0':4,'C1':120,'C2':130}[c])
            f={'at':at,'landmarks':landmarks(c,person(wrist)),'fps':30}
            assert hub.inputs.add(c,f,{'clock_id':c,'input_at_ms':stamp+offsets[c]})
            hub.frames[c]=f
    monkeypatch.setattr('backend.test_multi3d.now_ms',lambda:1150)
    result=hub.fuse()
    assert result['timing']=='inference_input_aligned' and result['spread_ms']==0
    assert result['cameras_used']==['C0','C1','C2']
    assert np.linalg.norm(np.array(result['joints']['right_wrist']['p'])-[.3,.5,1])<1e-4


def test_unknown_clock_mixed_modes_duplicates_and_stale_frames_are_not_fused():
    inputs=InputFrames();f={'at':1000,'landmarks':None}
    assert inputs.add('C0',f,{'clock_id':'C0','input_at_ms':2000})
    selected,mode,_,excluded=inputs.select({'C0':f})
    assert selected=={} and mode=='inference_input_aligned' and excluded['C0']=='clock_uncertain'
    set_clock(inputs,'C0',1000)
    a={'at':1005,'landmarks':None};assert inputs.add('C0',a,{'clock_id':'C0','input_at_ms':2000})
    assert inputs.add('C0',dict(a),{'clock_id':'C0','input_at_ms':2000}) is False
    with pytest.raises(ValueError):inputs.add('C0',dict(a),{'clock_id':'C0','input_at_ms':3000})
    legacy={'at':1005,'landmarks':None};inputs.add('C1',legacy,{})
    _,_,_,excluded=inputs.select({'C0':a,'C1':legacy});assert excluded['C1']=='timestamp_mode'
    inputs.reset('C0');assert 'C0' not in inputs.clocks and 'C0' not in inputs.buffers
