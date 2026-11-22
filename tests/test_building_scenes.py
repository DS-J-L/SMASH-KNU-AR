import math
import pytest
from backend.building_scenes import (single_scene_list,small_zones,scene_list,scene_spec,definitions,MEAN_HEIGHT_M,
                                    MIN_HEIGHT_M,absolute_campus_scale,package_metadata)
from backend.fragment_test import FragmentTest,model_command
from backend.model_strike import first_entry


def test_all_districts_have_distinct_packages_and_fragment_ids():
    choices=scene_list();assert len(choices)==24
    buildings=[];heights=[]
    for choice in choices:
        spec=scene_spec(choice['id']);data=spec['colliders'];ids=[f['fragment_id'] for f in data['fragments']]
        assert len(ids)==len(set(ids)) and len({f['node'] for f in data['fragments']})==len(ids)
        assert spec['building_count']==len(spec['render'])==choice['building_count']
        assert all(math.isfinite(v) and v>0 for v in spec['dimensions_m'])
        assert sum(len(e['fragments']) for e in spec['render'])==len(ids)
        if choice['id']!='it1':
            assert spec['building_count'] in (2,3) and spec['fixed_size']
            buildings.extend(e['id'] for e in spec['render']);heights.extend(e['height_m'] for e in spec['render'])
            # Marker-centred two-front/one-rear footprints must not overlap.
            from itertools import combinations
            for a,b in combinations(spec['render'],2):
                sa=package_metadata()[a['id']][1]['dimensions_m'];sb=package_metadata()[b['id']][1]['dimensions_m']
                assert any(abs(a['offset'][k]-b['offset'][k]) >= (sa[k]*a['scale']+sb[k]*b['scale'])/2+.249 for k in (0,2))
            for k in (0,2):
                lo=min(a['offset'][k]-package_metadata()[a['id']][1]['dimensions_m'][k]*a['scale']/2 for a in spec['render'])
                hi=max(a['offset'][k]+package_metadata()[a['id']][1]['dimensions_m'][k]*a['scale']/2 for a in spec['render'])
                assert lo+hi==pytest.approx(0,abs=1e-12)
    metadata=package_metadata()
    original={id for z in definitions() for id in z['packages']}
    # Original scale before filtering: changing the population cannot shrink survivors.
    scale=.0629757266484059
    expected={id:metadata[id][1]['dimensions_m'][1]*scale/metadata[id][1]['scale_from_campus'] for id in original}
    assert absolute_campus_scale()==pytest.approx(scale,abs=1e-15)
    assert sum(expected.values())/len(expected)==pytest.approx(MEAN_HEIGHT_M)
    assert len(buildings)==len(set(buildings))==61
    assert set(buildings)=={id for id,height in expected.items() if height>=MIN_HEIGHT_M}
    assert len(original-set(buildings))==26
    assert all(height>=.5 for height in heights)
    for id,height in zip(buildings,heights):assert height==pytest.approx(expected[id],abs=1e-12)


def test_scene_command_only_three_camera_and_resize_preserves_scene():
    # 1 camera (approximate): one building at a time (IT1 or a single building); zones are refused.
    mono=FragmentTest();mono.approximate=True
    with pytest.raises(ValueError):model_command(mono,{'type':'multi3d_model_scene','scene_id':'museum-social-01'})
    assert model_command(mono,{'type':'multi3d_model_config','placement':{'scale':.5}}).scene_id=='it1'
    single=model_command(mono,{'type':'multi3d_model_scene','scene_id':single_scene_list()[1]['id']})
    assert single.approximate and single.scene_id==single_scene_list()[1]['id'] and single.target.placement.scale==1
    assert len(scene_spec(single.scene_id)['render'])==1
    with pytest.raises(ValueError):model_command(single,{'type':'multi3d_model_scene','scene_id':'single:nope'})
    # 3 cameras: zones with several buildings.
    model=FragmentTest();model.depth_margin=.3
    zone=model_command(model,{'type':'multi3d_model_scene','scene_id':'museum-social-01'})
    count=len(scene_spec(zone.scene_id)['colliders']['fragments'])
    assert zone.scene_id=='museum-social-01' and not zone.approximate and zone.target.placement.scale==1
    assert zone.depth_margin==.3 and not zone.removed
    # Support never bridges separate buildings.
    sources={f['fragment_id']:f['building_id'] for f in scene_spec(zone.scene_id)['colliders']['fragments']}
    assert all(sources[a]==sources[b] for a,neighbors in zone.neighbors.items() for b in neighbors)
    for bid in set(sources.values()):
        f=next(f for f in zone.target.fragments if sources[f.fragment_id]==bid)
        middle=[(a+b)/2 for a,b in zip(f.lo,f.hi)]
        assert first_entry(zone.target,[middle[0],zone.target.lo[1]-.2,middle[2]],middle) is not None
    model_command(zone,{'type':'multi3d_model_drop_all'});assert len(zone.removed)==count
    resized=model_command(zone,{'type':'multi3d_model_config','placement':{'scale':.3}})
    assert resized.scene_id==zone.scene_id and resized.removed==set()
    assert resized.target.placement.scale==1
    assert resized.target.hi[2]==pytest.approx(zone.target.hi[2])
    second=model_command(resized,{'type':'multi3d_model_scene','scene_id':'museum-social-02'})
    again=model_command(second,{'type':'multi3d_model_scene','scene_id':zone.scene_id})
    assert again.target.hi==zone.target.hi and again.target.lo==zone.target.lo
    single=model_command(again,{'type':'multi3d_model_scene','scene_id':'it1'})
    assert single.target.placement.scale==.6
    with pytest.raises(ValueError):scene_spec('../../.env')


def test_scene_catalog_routes_are_protected_and_unknown_ids_are_refused():
    from fastapi.testclient import TestClient
    from backend.server import create_app
    from backend.settings import load_settings
    with TestClient(create_app(load_settings(access_key='scene-test'))) as c:
        assert c.get('/api/test/building-scenes').status_code==401
        assert len(c.get('/api/test/building-scenes?key=scene-test').json())==24
        assert c.get('/api/test/building-scenes/not-a-zone').status_code==404


def test_single_building_list_is_the_fixed_size_stage_buildings_then_the_it1_test_entry():
    # 2026-11-22: the duo stage buildings at 0.6~0.7 m tall within 1.0 m x 0.75 m (lower than 0.36 m left out),
    # IT1 first; the old resizable IT1 is the last, test-only entry.
    from backend.building_scenes import stage_buildings
    singles=single_scene_list()
    ids=[s['id'] for s in singles]
    assert ids[0]=='single:knu-it1-v3' and ids[-1]=='it1' and len(ids)==len(set(ids))==50
    assert {i[len('single:'):] for i in ids[:-1]}<=set(stage_buildings())
    for item in singles[:-1]:
        spec=scene_spec(item['id'])
        w,h,d=spec['dimensions_m']
        assert spec['building_count']==1 and spec['fixed_size'] and spec['colliders']['fragments']
        assert spec['colliders']['fragments'][0]['fragment_id']==0
        assert w<=1.0+1e-6 and d<=.75+1e-6 and .36-1e-6<=h<=.7+1e-6
        assert abs(h-item['height_m'])<.01 and abs(w-item['width_m'])<.01
