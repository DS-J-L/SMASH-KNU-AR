import pytest
from backend.fragment_test import FragmentTest
from backend.model_strike import first_entry


def approach(judge):
    judge.blast_enabled=False
    # Scan for an actual facade contact in the shipped IT1 hulls.
    t = judge.target
    for fraction in (.3, .5, .7):
        z = t.hi[2] * fraction
        for i in [10, *range(1, 10), *range(11, 20)]:
            x = t.lo[0] + (t.hi[0] - t.lo[0]) * i / 20
            a, b = [x, t.lo[1] - .15, z], [x, t.hi[1] + .15, z]
            hit = first_entry(t, a, b)
            if hit:
                # Stop just inside the first fragment, not deep in the building.
                end = [x, hit['point'][1] + .003, z]
                return a, end, hit['fragment_id']
    raise AssertionError('no facade contact')


def test_only_contacted_fragment_removed_and_restore():
    j = FragmentTest()
    a, b, fid = approach(j)
    assert j.update({'right_wrist': {'p': a}}, 0)['removed_ids'] == []
    out = j.update({'right_wrist': {'p': b}}, 33)
    assert out['removed_ids'] == [fid]
    assert out['event']['fragment_id'] == fid
    assert out['fragment_count'] == 96
    assert out['score'] == out['event']['points'] == 1
    assert j.update({'right_wrist': {'p': b}}, 66)['event'] is None
    # Crossing exactly the destroyed piece again must never re-break that piece.
    j.update({'right_wrist': {'p': a}}, 100)
    again = j.update({'right_wrist': {'p': b}}, 133)
    assert again['event'] is None
    epoch = out['epoch']
    j.reset()
    assert j.snapshot()['removed_ids'] == [] and j.epoch != epoch
    assert j.snapshot()['score'] == 0
    assert j.update({'right_wrist': {'p': b}}, 166)['event'] is None


@pytest.mark.parametrize('gap,missing', [(300, False), (33, True)])
def test_missing_or_expired_input_does_not_sweep(gap, missing):
    j = FragmentTest()
    a, b, _ = approach(j)
    j.update({'right_wrist': {'p': a}}, 0)
    if missing:
        j.update({}, 16)
    assert j.update({'right_wrist': {'p': b}}, gap)['event'] is None


def test_initial_inside_is_baseline_and_two_wrists_remove_only_one_piece():
    j = FragmentTest()
    a, b, _ = approach(j)
    assert j.update({'right_wrist': {'p': b}}, 0)['event'] is None
    j.reset()
    j.update({n: {'p': a} for n in ('left_wrist', 'right_wrist')}, 0)
    out = j.update({n: {'p': b} for n in ('left_wrist', 'right_wrist')}, 33)
    assert len(out['removed_ids']) == 1


def browser_case():
    from test_multi3d_relay import CAMS, calib, landmarks, person, W, H, K
    a,b,fid=approach(FragmentTest())
    return {'calibs':{c:calib(c) for c in CAMS}, 'before':{c:landmarks(c,person(a)) for c in CAMS},
            'after':{c:landmarks(c,person(b)) for c in CAMS}, 'fragment_id':fid,
            'width':W,'height':H,'K':K}


def test_fragment_viewer_relay_and_bad_config():
    from fastapi.testclient import TestClient
    from backend.server import create_app
    from backend.settings import load_settings
    from test_multi3d_relay import until
    from contextlib import ExitStack
    case=browser_case()
    with TestClient(create_app(load_settings(access_key='fragment-test'))) as client, ExitStack() as stack:
        viewer=stack.enter_context(client.websocket_connect('/ws/test/multi3d?role=viewer&model=it1&key=fragment-test'))
        initial=until(viewer,lambda m:m['type']=='multi3d_model_state')['model_test']
        assert initial['fragment_count']==96 and initial['removed_ids']==[]
        assert initial['score']==0
        viewer.send_json({'type':'multi3d_model_blast_config','enabled':False,'radius':3,'strength':12})
        until(viewer,lambda m:m['type']=='multi3d_fused' and m['model_test']['blast_enabled'] is False)
        phones={c:stack.enter_context(client.websocket_connect('/ws/test/multi3d?role=phone&camera='+c+'&key=fragment-test')) for c in case['calibs']}
        for c,ws in phones.items(): ws.send_json(case['calibs'][c])
        for field in ('before','after'):
            for c,ws in phones.items():ws.send_json({'type':'multi3d_frame','landmarks':case[field][c]})
            out=until(viewer,lambda m:m['type']=='multi3d_fused' and m.get('model_test') is not None and
                      (bool(m['model_test']['removed_ids']) if field=='after' else len(m['cameras_used'])==3))
        assert out['model_test']['removed_ids']==[case['fragment_id']]
        assert out['model_test']['score']==out['model_test']['event']['points']==1
        viewer.send_json({'type':'multi3d_model_config','placement':{'scale':float('nan')}})
        assert until(viewer,lambda m:m['type']=='error')['code']=='bad_message'
        viewer.send_json({'type':'multi3d_model_reset'})
        reset=until(viewer,lambda m:m['type']=='multi3d_fused' and m['model_test']['epoch']!=initial['epoch'])
        assert reset['model_test']['removed_ids']==[]
        assert reset['model_test']['score']==0


def test_support_graph_collapse_and_disable():
    j=FragmentTest()
    # Controlled three-block tower, tests the graph rule independently of hull meshing.
    j.neighbors={0:{1},1:{0,2},2:{1}}
    j.anchors={0}
    from dataclasses import replace
    j.target=replace(j.target,fragments=j.target.fragments[:3])
    event=j.release([1])
    assert event['released_ids']==[1,2] and event['unsupported_ids']==[2]
    assert event['points']==j.snapshot()['score']==2
    assert j.release([1,2,2]) is None
    assert j.snapshot()['score']==2
    j.reset();j.collapse=False
    assert j.release([1])['released_ids']==[1]
    j.collapse=True
    assert j.release([], 'support')['released_ids']==[2]


def test_actual_support_graph_stable_at_rest_and_all_drop():
    from backend.fragment_test import reachable
    j=FragmentTest();assert len(reachable(j.neighbors,j.anchors,set()))==96
    assert j.snapshot()['removed_ids']==[]
    event=j.release([f.fragment_id for f in j.target.fragments], 'synthetic_drop')
    assert len(event['released_ids'])==96
    assert event['points']==j.snapshot()['score']==96
    assert j.release([0]) is None
    j.reset()
    event=j.release(sorted(j.anchors))
    assert len(event['released_ids'])==96 and len(event['unsupported_ids'])==75


def test_mouse_ray_hit_miss_and_invalid_input():
    j=FragmentTest();j.collapse=False
    a,b,fid=approach(j)
    event=j.mouse_hit(a,[b[k]-a[k] for k in range(3)])
    assert event['fragment_id']==fid and event['input_mode']=='mouse_demo' and event['kind']=='mouse'
    assert j.snapshot()['removed_ids']==[fid]
    push=j.mouse_push(fid,event['point_m'],[1,0,0],3)
    assert push['points']==0 and j.snapshot()['score']==1
    assert push['kind']=='mouse_push' and push['released_ids']==[] and push['direction']==[1,0,0]
    with pytest.raises(ValueError):j.mouse_push(-1,[0,0,0],[1,0,0],3)
    assert j.mouse_hit([0,0,3],[0,0,1]) is None
    for origin,direction in [([0,0,0],[0,0,0]),([0,0,float('nan')],[1,0,0]),([0,0],[1,0,0])]:
        with pytest.raises(ValueError):j.mouse_hit(origin,direction)
    with pytest.raises(ValueError):j.mouse_hit(a,[1,0,0],float('inf'))


def test_fast_swing_blasts_building_but_slow_touch_does_not():
    for at,expected in [(33,96),(240,1)]:
        j=FragmentTest();a,b,_=approach(j);j.blast_enabled=True;j.collapse=False
        j.update({'right_wrist':{'p':a}},0)
        out=j.update({'right_wrist':{'p':b}},at)
        assert len(out['removed_ids'])==expected
        assert out['event']['blast']==(expected==96)
        assert out['event']['strength']>=7


def test_approximate_depth_reproduces_phone_miss_and_accepts_deliberate_swing_only():
    a,b=[0,.4527,.3339],[-.1155,.4527,.3339]
    strict=FragmentTest();strict.update({'right_wrist':{'p':a}},0)
    assert strict.update({'right_wrist':{'p':b}},100)['event'] is None
    j=FragmentTest();j.approximate=True;j.depth_margin=.3
    first=j.update({'right_wrist':{'p':a}},0);assert first['event'] is None
    assert first['diagnostics']['right_wrist']['depth_gap_m']>.26
    assert j.update({'right_wrist':{'p':a}},50)['event'] is None
    out=j.update({'right_wrist':{'p':b}},100)
    assert out['event'] is not None and out['event']['approx_depth_margin_m']==.3
    assert len(out['removed_ids'])==96
    j.reset();j.update({'right_wrist':{'p':a}},0);j.update({},50)
    assert j.update({'right_wrist':{'p':b}},100)['event'] is None


def test_depth_allowance_never_expands_x_or_height():
    j=FragmentTest();j.approximate=True;j.depth_margin=.3
    for a,b in [([1,.45,.2],[1,.4,.4]),([0,.45,1],[.2,.4,1])]:
        j.reset();j.update({'right_wrist':{'p':a}},0)
        assert j.update({'right_wrist':{'p':b}},100)['event'] is None


def test_resize_resets_pieces_but_preserves_user_collision_and_blast_settings():
    from backend.fragment_test import model_command
    j=FragmentTest();j.approximate=True;j.depth_margin=.25;j.blast_enabled=False;j.blast_strength=5;j.blast_radius=1;j.collapse=False
    j.release([0]);before=j.epoch
    resized=model_command(j,{'type':'multi3d_model_config','placement':{'scale':1}})
    assert resized.epoch!=before and resized.removed==set()
    assert resized.approximate and resized.depth_margin==.25 and not resized.blast_enabled and not resized.collapse
    assert resized.blast_radius==1 and resized.blast_strength==5
    assert resized.target.hi[2]==pytest.approx(1.0844383,abs=1e-5)


def kick_path(judge, z):
    """A straight path at height z that enters the first facade fragment, ending just inside it."""
    t = judge.target
    for i in [10, *range(1, 10), *range(11, 20)]:
        x = t.lo[0] + (t.hi[0] - t.lo[0]) * i / 20
        a, b = [x, t.lo[1] - .15, z], [x, t.hi[1] + .15, z]
        hit = first_entry(t, a, b)
        if hit:
            return a, [x, hit['point'][1] + .003, z], hit['fragment_id']
    raise AssertionError('no facade contact at z=%s' % z)


@pytest.mark.parametrize('name', ['left_ankle', 'right_ankle'])
def test_lifted_fast_ankle_kick_breaks_a_fragment_like_a_wrist(name):
    j = FragmentTest()
    j.blast_enabled = False
    a, b, fid = kick_path(j, .4)
    assert j.update({name: {'p': a}}, 0)['removed_ids'] == []
    out = j.update({name: {'p': b}}, 33)
    assert out['removed_ids'] == [fid]
    assert out['event']['kind'] == 'ankle' and out['event']['joint'] == name
    assert out['diagnostics'][name]['reason'] == 'contact'


def test_ankle_on_the_floor_or_moving_slowly_does_not_break_anything():
    j = FragmentTest()
    j.blast_enabled = False
    a, b, _ = kick_path(j, .05)                             # foot at floor level: a step, not a kick
    j.update({'left_ankle': {'p': a}}, 0)
    out = j.update({'left_ankle': {'p': b}}, 33)
    assert out['event'] is None and out['removed_ids'] == []
    j.reset()
    a, b, _ = kick_path(j, .4)
    near = [b[0], b[1] - .1, b[2]]
    j.update({'right_ankle': {'p': near}}, 0)
    out = j.update({'right_ankle': {'p': b}}, 100)          # 1 m/s: lifted but slow
    assert out['event'] is None and out['removed_ids'] == [] and out['diagnostics']['right_ankle']['reason'] == 'too_slow'


def overlapping_wrist():
    j = FragmentTest()
    j.blast_enabled = False
    _, b, fid = kick_path(j, .4)
    return j, b, [b[0], b[1], b[2] + .12], fid


def test_hand_already_inside_the_building_breaks_a_piece_when_it_moves_fast():
    j, inside, moved, _ = overlapping_wrist()
    j.update({'right_wrist': {'p': inside}}, 0)                      # baseline, already overlapping
    out = j.update({'right_wrist': {'p': moved}}, 33)                # 0.12 m in 33 ms = 3.6 m/s
    assert out['event'] is not None and out['event']['joint'] == 'right_wrist' and out['event']['overlap'] is True
    assert out['removed_ids'] and out['diagnostics']['right_wrist']['overlap'] is True


def test_overlapping_hand_that_is_slow_or_only_jitters_breaks_nothing():
    j, inside, moved, _ = overlapping_wrist()
    j.update({'right_wrist': {'p': inside}}, 0)
    assert j.update({'right_wrist': {'p': moved}}, 200)['event'] is None                     # 0.6 m/s: slow
    j.reset()
    j.update({'right_wrist': {'p': inside}}, 1000)
    out = j.update({'right_wrist': {'p': [inside[0], inside[1], inside[2] + .03]}}, 1033)    # 3 cm jitter
    assert out['event'] is None and out['removed_ids'] == []
    assert out['diagnostics']['right_wrist']['reason'] == 'inside_slow'


def test_standing_in_the_building_blocks_slow_hands_but_not_fast_ones():
    j, inside, moved, _ = overlapping_wrist()
    feet = {'left_ankle': {'p': [inside[0], inside[1], .05]}}
    j.update({'right_wrist': {'p': inside}, **feet}, 0)
    slow = j.update({'right_wrist': {'p': moved}, **feet}, 200)
    assert slow['event'] is None and slow['diagnostics']['right_wrist']['reason'] == 'standing'
    j.update({'right_wrist': {'p': inside}, **feet}, 400)
    fast = j.update({'right_wrist': {'p': moved}, **feet}, 433)
    assert fast['event'] is not None and fast['event']['overlap'] is True


def test_overlap_hits_are_rate_limited_per_joint():
    j, inside, moved, _ = overlapping_wrist()
    j.overlap_hit_at['right_wrist'] = 50                              # this joint just hit while overlapping
    j.update({'right_wrist': {'p': inside}}, 66)
    out = j.update({'right_wrist': {'p': moved}}, 99)                 # still inside the 300 ms cooldown
    assert out['event'] is None and out['removed_ids'] == [] and out['diagnostics']['right_wrist']['reason'] == 'cooldown'
    j.update({'right_wrist': {'p': inside}}, 400)
    assert j.update({'right_wrist': {'p': moved}}, 433)['event'] is not None


def through_path(judge, fraction):
    """A straight path through the whole depth of IT1 at one height, starting and ending outside."""
    t = judge.target
    x, z = (t.lo[0] + t.hi[0]) / 2, t.hi[2] * fraction
    return [x, t.lo[1] - .15, z], [x, t.hi[1] + .15, z]


def test_default_judge_breaks_only_the_first_piece_of_a_path():
    j = FragmentTest(); j.blast_enabled = False; j.collapse = False
    a, b = through_path(j, .4)
    j.update({'right_wrist': {'p': a}}, 0)
    out = j.update({'right_wrist': {'p': b}}, 33)
    assert len(out['removed_ids']) == 1 and 'swing_id' not in out['event']


def test_sweep_breaks_every_crossed_piece_and_marks_one_effect_per_swing():
    from backend.fragment_test import crossed_ids
    j = FragmentTest(); j.blast_enabled = False; j.collapse = False; j.sweep = True
    a, b = through_path(j, .4)
    expected = crossed_ids(j.target, a, b)
    assert len(expected) > 1
    j.update({'right_wrist': {'p': a}}, 0)
    first = j.update({'right_wrist': {'p': b}}, 33)
    assert sorted(first['removed_ids']) == sorted(expected)
    assert first['score'] == first['event']['points'] == len(expected)
    assert first['event']['swing_start'] is True
    # Same swing coming back at another height: more pieces, same swing, no second effect.
    c = [b[0], a[1], j.target.hi[2] * .6]
    again = j.update({'right_wrist': {'p': c}}, 66)
    assert again['event'] is not None and len(again['removed_ids']) > len(expected)
    assert again['event']['swing_start'] is False and again['event']['swing_id'] == first['event']['swing_id']
    # After a pause it is a new swing.
    j.update({'right_wrist': {'p': b}}, 600)
    d = [b[0], b[1], j.target.hi[2] * .2]
    j.update({'right_wrist': {'p': d}}, 633)
    late = j.update({'right_wrist': {'p': [b[0], a[1], d[2]]}}, 666)
    assert late['event'] is not None and late['event']['swing_start'] is True
    assert late['event']['swing_id'] != first['event']['swing_id']


def test_new_building_ignores_body_hits_during_spawn_guard(monkeypatch):
    # 1-camera / duo stage (2026-11-24): a building that just appeared cannot be broken for SPAWN_GUARD_MS.
    import backend.fragment_test as ft
    clock = [1000.0]
    monkeypatch.setattr(ft.time, 'perf_counter', lambda: clock[0] / 1000)
    j = FragmentTest()
    a, b, fid = approach(j)
    assert j.snapshot()['spawn_guard_ms'] == 0
    j.guard_spawn()
    assert j.snapshot()['spawn_guard_ms'] == ft.SPAWN_GUARD_MS
    j.update({'right_wrist': {'p': a}}, 0)
    out = j.update({'right_wrist': {'p': b}}, 33)
    assert out['event'] is None and out['removed_ids'] == []
    assert out['diagnostics']['right_wrist']['reason'] == 'spawn_guard'
    clock[0] += ft.SPAWN_GUARD_MS
    assert j.snapshot()['spawn_guard_ms'] == 0
    # Still tracked during the guard: the next move is judged from the last position, as usual.
    j.update({'right_wrist': {'p': a}}, 66)
    assert j.update({'right_wrist': {'p': b}}, 99)['removed_ids'] == [fid]
