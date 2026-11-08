import copy
import cv2
import numpy as np
import pytest

from backend.calibration.solve import intrinsics, marker_pose, triangular_prism
from backend.calibration.storage import CalibrationError, calibration_dict, parse_calibration
from backend.tracking.triangulation import triangulate_dlt
from synthetic import synthetic_rig


def request(cal, obj):
    lens = calibration_dict(cal)
    rv, _ = cv2.Rodrigues(cal.R)
    uv, _ = cv2.projectPoints(obj, rv, cal.t, cal.K, cal.dist)
    return {'source': 'synthetic', 'camera_id': cal.camera_id, 'device_id': cal.device_id,
            'world': lens['world'], 'intrinsics': lens,
            'object_points_m': obj.tolist(), 'image_points_px': uv.reshape(-1, 2).tolist()}


def test_marker_poses_feed_existing_three_view_triangulation():
    obj = np.array([[x, y, z] for x in (-.2, .2) for y in (-.2, .2) for z in (0., .3)])
    restored = []
    for cid, cal in synthetic_rig().items():
        data = marker_pose(request(cal, obj))
        result = parse_calibration(data, cid)
        assert result.source == 'synthetic'
        assert np.allclose(result.Rt, cal.Rt, atol=1e-7)
        restored.append(result)
    known = np.array([.1, .15, .7])
    uv = [c.normalize(c.project(known[None]), True)[0] for c in restored]
    assert np.allclose(triangulate_dlt(uv, [c.Rt for c in restored]), known, atol=1e-7)


def test_bad_correspondences_and_synthetic_promotion_are_rejected():
    obj = np.array([[x,y,z] for x in (-.2,.2) for y in (-.2,.2) for z in (0.,.3)])
    data = request(synthetic_rig()['C0'], obj)
    bad = copy.deepcopy(data);bad['source']='measured'
    with pytest.raises(CalibrationError, match='source'):marker_pose(bad)
    bad = copy.deepcopy(data);bad['image_points_px'][0][0]+=200
    with pytest.raises(CalibrationError):marker_pose(bad)
    bad = copy.deepcopy(data);bad['object_points_m']=[[0,0,0]]*8
    with pytest.raises(CalibrationError):marker_pose(bad)


def test_planar_ambiguity_is_not_silently_accepted():
    cal = synthetic_rig()['C0']
    obj = np.array([[x,y,0.] for x in (-.075,.075) for y in (-.06,.06)])
    data = request(cal,obj)
    uv,_=cv2.projectPoints(obj,np.array([.02,0.,0.]),np.array([0.,0.,1.]),cal.K,cal.dist)
    data['image_points_px']=uv.reshape(-1,2).tolist()
    with pytest.raises(CalibrationError,match='ambiguous'):marker_pose(data)


def test_lens_calibration_from_diverse_synthetic_board_views():
    K=np.array([[900.,0.,640.],[0.,920.,360.],[0.,0.,1.]])
    obj=np.array([[x*.025,y*.025,0.] for x in range(8) for y in range(6)])
    rng=np.random.default_rng(10);views=[]
    for _ in range(12):
        rv=rng.uniform(-.5,.5,3);t=np.array([-.08,-.07,rng.uniform(.5,1.1)])
        uv,_=cv2.projectPoints(obj,rv,t,K,np.zeros(5))
        views.append({'object_points_m':obj.tolist(),'image_points_px':uv.reshape(-1,2).tolist()})
    result=intrinsics({'source':'synthetic','image':{'width':1280,'height':720,'rotation_deg':0},'views':views})
    assert result['rms_px']<.001
    assert np.allclose(result['K'],K,atol=.02)


def test_prism_geometry_uses_supplied_dimensions_and_common_origin():
    model=triangular_prism({'side_m':.3,'height_m':.5})
    vertices=np.array(model['vertices'])
    assert model['source']=='reference_geometry'
    assert np.allclose(vertices[:3].mean(0),[0,0,0])
    for a,b in [(0,1),(1,2),(2,0)]:assert np.isclose(np.linalg.norm(vertices[a]-vertices[b]),.3)
    assert np.allclose(vertices[3:,2],.5)
    assert len(set(model['faces']['A']+model['faces']['B']))==6


@pytest.mark.parametrize('value',[0,-1,float('nan')])
def test_invalid_prism_dimensions_are_rejected(value):
    with pytest.raises(CalibrationError):triangular_prism({'side_m':value,'height_m':.5})
