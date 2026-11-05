import pytest
from backend.ingest.schemas import BODY_NAMES, MessageError, parse_pose_2d
from helpers import pose_2d

def message():
    data=pose_2d({'camera_id':'C0','device_id':'phone','stream_id':'s'},0)
    data['body']={n:None for n in BODY_NAMES}
    data['body']['left_shoulder']={'u_px':100,'v_px':200,'visibility':0.9}
    return data

def test_optional_body_preserves_wrists_and_keeps_non_face_2d_points():
    data=message();pose=parse_pose_2d(data,('C0','C1','C2'))
    assert len(pose.body)==22 and pose.body['left_shoulder'].u_px==100
    assert pose.wrists['left_wrist'].u_px==600
    del data['body'];assert parse_pose_2d(data,('C0',)).body is None

@pytest.mark.parametrize('change',[{'nose':None},{'left_shoulder':{'u_px':1,'v_px':2,'visibility':2}}, {'left_shoulder':{'u_px':float('nan'),'v_px':2,'visibility':0.5}}])
def test_body_rejects_face_and_invalid_numbers(change):
    data=message();data['body'].update(change)
    with pytest.raises(MessageError):parse_pose_2d(data,('C0',))

def test_head_is_one_optional_point_preserving_body_and_wrists():
    data=message();assert parse_pose_2d(data,('C0',)).head is None
    data['head']={'u_px':320,'v_px':100,'visibility':0.9}
    pose=parse_pose_2d(data,('C0',))
    assert pose.head.u_px==320 and len(pose.body)==22
    assert pose.wrists['left_wrist'].u_px==600
    data['head']['nose']=None
    with pytest.raises(MessageError):parse_pose_2d(data,('C0',))

@pytest.mark.parametrize('point',[{'u_px':1,'v_px':2,'visibility':2},{'u_px':float('nan'),'v_px':2,'visibility':0.9}])
def test_head_rejects_invalid_numbers(point):
    data=message();data['head']=point
    with pytest.raises(MessageError):parse_pose_2d(data,('C0',))
