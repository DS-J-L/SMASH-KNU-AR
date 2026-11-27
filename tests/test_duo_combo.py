import math
import asyncio
import time
import pytest
from fastapi.testclient import TestClient
from backend.server import create_app
from backend.settings import load_settings
from backend.fragment_test import target_for
from backend.model_strike import Placement
from tests.test_wide3d import KEY, calib, frame, receive_until, building_at


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key=KEY))) as c:
        yield c


def pc(client):
    return client.websocket_connect(f'/ws/test/duo3d?role=viewer&key={KEY}')


def state(ws, check=lambda s: True):
    return receive_until(ws, 'multi3d_model_state', lambda m: check(m['model_test']), limit=80)['model_test']


def remove_to(ws, s, amount):
    ids = [f.fragment_id for f in target_for(Placement(scale=1.0), s['scene_id']).fragments]
    missing = [i for i in ids if i not in s['removed_ids']][:amount-len(s['removed_ids'])]
    for offset in range(0, len(missing), 8):
        ws.send_json({'type': 'multi3d_model_release', 'ids': missing[offset:offset+8]})
    return state(ws, lambda v: len(v['removed_ids']) == amount)


def test_server_validates_80_percent_then_one_transition_and_one_second_pause(client):
    with pc(client) as one:
        initial = state(one)
        epoch = initial['epoch']
        one.send_json({'type': 'duo_combo_next', 'epoch': epoch})
        assert state(one)['epoch'] == epoch  # not enough damage
        need = math.ceil(initial['fragment_count'] * .8)
        below = remove_to(one, initial, need - 1)
        one.send_json({'type': 'duo_combo_next', 'epoch': epoch})
        assert state(one)['epoch'] == epoch
        hit = remove_to(one, below, need)
        one.send_json({'type': 'duo_combo_next', 'epoch': epoch})
        loading = state(one, lambda s: s['epoch'] != epoch)
        assert loading['combo']['awaiting_ready'] and loading['removed_ids'] == []
        assert loading['combo']['cleared_count'] == 1
        assert loading['spawn_guard_ms'] == 0  # starts after the PC model is ready
        with pc(client) as two:
            assert state(two)['combo']['session_id'] == hit['combo']['session_id']
            two.send_json({'type': 'duo_combo_next', 'epoch': epoch})
            assert state(two)['epoch'] == loading['epoch']
            one.send_json({'type': 'duo_combo_ready', 'epoch': 'old'})
            assert state(one, lambda s: s['epoch'] == loading['epoch'])['combo']['awaiting_ready']
            one.send_json({'type': 'duo_combo_ready', 'epoch': loading['epoch']})
            ready = state(one, lambda s: not s['combo']['awaiting_ready'])
            assert 0 < ready['spawn_guard_ms'] <= 2000
            # Repeated ACKs do not add another guard or another clear.
            two.send_json({'type': 'duo_combo_ready', 'epoch': loading['epoch']})
            repeated = state(two, lambda s: not s['combo']['awaiting_ready'])
            assert repeated['spawn_guard_ms'] <= ready['spawn_guard_ms']
            assert repeated['combo']['cleared_count'] == 1


def test_actual_judge_awards_body_break_and_carries_score_over_transition_and_reconnect(client):
    url = f'/ws/test/duo3d?role=phone&camera=C1&input_mode=synthetic&key={KEY}'
    with pc(client) as monitor, client.websocket_connect(url) as phone:
        initial = state(monitor)
        phone.send_json(calib('C1'))
        receive_until(monitor, 'multi3d_calib')
        lo, hi = initial['bounds']['lo'], initial['bounds']['hi']
        x, height = building_at(initial['scene_id'], 1.5)
        for y in (lo[1]-.5, lo[1]-.25, (lo[1]+hi[1])/2):
            phone.send_json(frame(0, wrist=[x-1, y, min(.2, height/2)]))
            time.sleep(.05)
        hit = state(monitor, lambda s: bool((s.get('event') or {}).get('combo_award')))
        award = hit['event']['combo_award']
        assert hit['combo']['input_mode'] == 'synthetic'
        assert hit['combo']['combo_count'] == 1
        assert award['awarded_score_units'] == award['new_fragment_count'] * 10
        score = hit['combo']['game_score_units']
        full = remove_to(monitor, hit, math.ceil(hit['fragment_count']*.8))
        assert full['combo']['game_score_units'] == score  # test debris never invents a body break
        monitor.send_json({'type': 'duo_combo_next', 'epoch': hit['epoch']})
        loading = state(monitor, lambda s: s['epoch'] != hit['epoch'])
        monitor.send_json({'type': 'duo_combo_ready', 'epoch': loading['epoch']})
        ready = state(monitor, lambda s: not s['combo']['awaiting_ready'])
        assert ready['combo']['game_score_units'] == score
        assert ready['combo']['combo_paused']
        assert 0 < ready['combo']['combo_pause_remaining_ms'] <= 1000
        # Same body motion during the full two-second protection must not destroy the next model.
        for y in (lo[1]-.5, lo[1]-.25, (lo[1]+hi[1])/2):
            phone.send_json(frame(0, wrist=[x-1, y, min(.2, height/2)]))
            time.sleep(.02)
        protected = state(monitor, lambda s: bool(s.get('diagnostics')))
        assert protected['removed_ids'] == []
        assert protected['combo']['game_score_units'] == score
        with pc(client) as reconnect:
            s = state(reconnect)
            assert s['combo']['game_score_units'] == score and s.get('event') is None
            assert s['combo']['session_id'] == ready['combo']['session_id']
        monitor.send_json({'type': 'multi3d_model_reset'})
        reset = state(monitor, lambda s: s['epoch'] != loading['epoch'])
        assert reset['combo']['game_score_units'] == 0 and reset['combo']['max_combo'] == 0
        assert reset['combo']['session_id'] != ready['combo']['session_id']


def test_prewarming_next_collision_model_does_not_change_the_live_target_or_score():
    from backend.test_wide3d import WideStage

    async def run():
        hub = WideStage('duo')
        await hub.rebuild()
        current = hub.model
        fid = current.target.fragments[0].fragment_id
        current.release([fid])
        hub.combo.accept(current.epoch, {'event_id': 'hit', 'kind': 'wrist', 'released_ids': [fid]}, 'synthetic')
        before = hub.combo.snapshot()
        await hub.preload_task
        zone, scene = hub.next_scene()
        cached = target_for(Placement(scale=1), scene)
        assert hub.model is current and hub.model.removed == {fid}
        assert hub.combo.snapshot()['game_score_units'] == before['game_score_units']
        assert hub.combo.snapshot()['session_id'] == before['session_id']
        hub.zone_id = zone
        await hub.rebuild(keep_combo=True)
        assert hub.model.target is cached
        assert hub.combo.snapshot()['game_score_units'] == before['game_score_units']
        if hub.preload_task and not hub.preload_task.done():
            hub.preload_task.cancel()

    asyncio.run(run())
