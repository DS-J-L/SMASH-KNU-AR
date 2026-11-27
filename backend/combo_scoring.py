"""Server-owned duo partial-break scoring. Scores are integer tenths of a point."""
import time
import uuid

WINDOW_MS = 4000
TRANSITION_PAUSE_MS = 1000
CLEAR_PERCENT = 80


class ComboScoring:
    def __init__(self, clock=None):
        self.clock = clock or (lambda: time.perf_counter() * 1000)
        self.instance_id = uuid.uuid4().hex
        self.revision = 0
        self.reset(None)

    def reset(self, epoch):
        self.session_id = uuid.uuid4().hex
        self.epoch = epoch
        self.input_mode = None
        self.score_units = self.combo = self.max_combo = self.cleared_count = 0
        self.deadline = self.pause_until = -1.0
        self.awaiting_ready = False
        self.transition_id = None
        self.seen_events, self.removed, self.actions = set(), set(), {}
        self.revision += 1

    def accept(self, epoch, event, input_mode):
        if (epoch != self.epoch or self.awaiting_ready or not event
                or event.get('kind') not in ('wrist', 'ankle')
                or input_mode not in ('live', 'synthetic', 'replay')):
            return None
        eid = event.get('event_id')
        ids = set(event.get('released_ids') or ()) - self.removed
        if not eid or eid in self.seen_events or not ids:
            return None
        # A different input source starts a separate record; demo data never adds to live points.
        if self.input_mode is not None and self.input_mode != input_mode:
            self.reset(epoch)
        self.input_mode = input_mode
        self.seen_events.add(eid)
        self.removed.update(ids)
        now = self.clock()
        action = event.get('swing_id') or eid
        expired = now > self.deadline
        fresh = action not in self.actions or expired
        if fresh:
            self.combo = self.combo + 1 if not expired else 1
            self.max_combo = max(self.max_combo, self.combo)
            self.actions[action] = {'multiplier_tenths': 10 + self.combo - 1, 'score_units': 0,
                                    'combo_count': self.combo}
        entry = self.actions[action]
        points = len(ids) * entry['multiplier_tenths']
        entry['score_units'] += points
        self.score_units += points
        self.deadline = now + WINDOW_MS
        self.pause_until = -1.0
        self.revision += 1
        award = {'event_id': eid, 'action_id': action, 'action_start': fresh,
                 'combo_count': entry['combo_count'], 'multiplier_tenths': entry['multiplier_tenths'],
                 'awarded_score_units': points, 'action_score_units': entry['score_units'],
                 'new_fragment_count': len(ids), 'input_mode': input_mode}
        event['combo_award'] = award
        return award

    def transition(self, epoch):
        """Only called after the hub validates 80% and atomically replaces the target."""
        self.epoch = epoch
        self.cleared_count += 1
        self.transition_id = uuid.uuid4().hex
        self.awaiting_ready = True
        self.seen_events, self.removed, self.actions = set(), set(), {}
        self.revision += 1

    def ready(self, epoch):
        if not self.awaiting_ready or epoch != self.epoch:
            return False
        self.awaiting_ready = False
        now = self.clock()
        # No revival, no saved time credit: only this transition's first actual second freezes.
        if self.combo and now <= self.deadline:
            self.deadline += TRANSITION_PAUSE_MS
            self.pause_until = now + TRANSITION_PAUSE_MS
        self.revision += 1
        return True

    def snapshot(self):
        now = self.clock()
        active = self.combo if self.combo and now <= self.deadline else 0
        paused = active > 0 and now < self.pause_until
        remaining = max(0, self.deadline - max(now, self.pause_until)) if active else 0
        return {'instance_id': self.instance_id, 'session_id': self.session_id, 'revision': self.revision,
                'epoch': self.epoch, 'server_now_ms': now, 'game_score_units': self.score_units,
                'combo_count': active, 'max_combo': self.max_combo,
                'multiplier_tenths': 10 + active - 1 if active else 10,
                'combo_remaining_ms': min(WINDOW_MS, remaining), 'combo_paused': paused,
                'combo_pause_remaining_ms': max(0, self.pause_until - now) if paused else 0,
                'awaiting_ready': self.awaiting_ready, 'transition_id': self.transition_id,
                'cleared_count': self.cleared_count, 'clear_percent': CLEAR_PERCENT,
                'input_mode': self.input_mode or 'none', 'window_ms': WINDOW_MS}
