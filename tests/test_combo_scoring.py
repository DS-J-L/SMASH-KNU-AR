"""Contract checks: extra break within four seconds, fixed swing multiplier, transition pause."""
import pytest
from backend.combo_scoring import ComboScoring


def event(eid, ids, swing=None, kind='wrist'):
    return {'event_id': eid, 'kind': kind, 'released_ids': list(ids), 'swing_id': swing or eid}


@pytest.fixture
def setup():
    clock = [0]
    combo = ComboScoring(clock=lambda: clock[0])
    combo.reset('a')
    return combo, clock


def test_linear_multiplier_and_integer_tenths(setup):
    combo, clock = setup
    for i in range(3):
        clock[0] = i * 600
        combo.accept('a', event(str(i), range(i * 10, i * 10 + 10)), 'synthetic')
    s = combo.snapshot()
    assert (s['game_score_units'], s['combo_count'], s['multiplier_tenths']) == (330, 3, 12)
    clock[0] += 600
    award = combo.accept('a', event('four', range(30, 42)), 'synthetic')
    assert award['awarded_score_units'] == 156  # 12 * 1.3 = 15.6
    assert combo.snapshot()['game_score_units'] == 486


@pytest.mark.parametrize('gap,count', [(3999, 2), (4000, 2), (4001, 1)])
def test_four_second_boundary_is_inclusive(setup, gap, count):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    clock[0] = gap
    combo.accept('a', event('next', [1]), 'live')
    assert combo.snapshot()['combo_count'] == count


def test_one_swing_has_one_multiplier_and_last_real_break_refreshes_time(setup):
    combo, clock = setup
    combo.accept('a', event('first', [0, 1], 'one'), 'live')
    clock[0] = 300
    combo.accept('a', event('part', [1, 2, 3], 'one'), 'live')
    assert combo.snapshot()['combo_count'] == 1
    assert combo.snapshot()['game_score_units'] == 40
    clock[0] = 4300
    combo.accept('a', event('second', [4]), 'live')
    assert combo.snapshot()['combo_count'] == 2
    assert combo.snapshot()['game_score_units'] == 51


@pytest.mark.parametrize('bad', [None, event('empty', []), event('mouse', [1], kind='mouse'),
                                event('old', [1], kind='mouse_push'), event('fall', [1], kind='debris')])
def test_no_break_no_combo_or_time_refresh(setup, bad):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    clock[0] = 1000
    assert combo.accept('a', bad, 'live') is None
    assert combo.snapshot()['game_score_units'] == 10
    assert combo.snapshot()['combo_remaining_ms'] == 3000


def test_duplicate_event_fragment_and_old_epoch_are_ignored(setup):
    combo, clock = setup
    e = event('first', [0, 1])
    combo.accept('a', e, 'live')
    clock[0] = 1000
    for epoch, item in [('a', e), ('a', event('repeat', [0, 1])), ('old', event('late', [2]))]:
        assert combo.accept(epoch, item, 'live') is None
    assert combo.snapshot()['game_score_units'] == 20
    assert combo.snapshot()['combo_remaining_ms'] == 3000


def test_pause_is_one_second_then_gauge_drains_during_second_guard_second(setup):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    combo.transition('b')
    assert combo.snapshot()['awaiting_ready']
    assert combo.accept('b', event('too_early', [0]), 'live') is None
    assert combo.ready('b') is True
    for t, remaining, paused in [(0, 4000, True), (500, 4000, True), (1000, 4000, False), (2000, 3000, False)]:
        clock[0] = t
        s = combo.snapshot()
        assert (s['combo_remaining_ms'], s['combo_paused']) == (remaining, paused)
    assert combo.ready('b') is False
    combo.accept('b', event('second', [0]), 'live')  # same fragment id, new target
    assert combo.snapshot()['combo_count'] == 2
    assert combo.snapshot()['game_score_units'] == 21


def test_loading_time_is_not_forgiven_and_expired_combo_does_not_revive(setup):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    combo.transition('b')
    clock[0] = 4500
    combo.ready('b')
    assert combo.snapshot()['combo_count'] == 0
    assert not combo.snapshot()['combo_paused']
    combo.accept('b', event('new', [0]), 'live')
    assert combo.snapshot()['combo_count'] == 1


def test_short_remaining_time_is_preserved_not_refilled(setup):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    clock[0] = 3500
    combo.transition('b'); combo.ready('b')
    clock[0] = 4000
    assert combo.snapshot()['combo_remaining_ms'] == 500
    clock[0] = 5001
    assert combo.snapshot()['combo_count'] == 0


def test_reset_clears_record_but_revision_never_goes_backwards(setup):
    combo, clock = setup
    combo.accept('a', event('first', [0]), 'live')
    old = combo.snapshot()
    combo.reset('b')
    new = combo.snapshot()
    assert new['session_id'] != old['session_id'] and new['revision'] > old['revision']
    assert (new['game_score_units'], new['max_combo'], new['cleared_count']) == (0, 0, 0)


def test_live_and_test_sources_have_separate_records(setup):
    combo, clock = setup
    combo.accept('a', event('live', [0]), 'live')
    combo.accept('a', event('fixture', [1]), 'synthetic')
    assert combo.snapshot()['input_mode'] == 'synthetic'
    assert combo.snapshot()['game_score_units'] == 10
    assert combo.snapshot()['combo_count'] == 1
