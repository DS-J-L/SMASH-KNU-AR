// web/shared/foot-strike-3d.js against the shared cases (backend/foot_strike.py runs the same file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FootStrikeJudge, FOOT_STRIKE_CONFIG } from '../web/shared/foot-strike-3d.js';

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/foot_strike_cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`shared case: ${c.name}`, () => {
    const judge = new FootStrikeJudge();
    for (const frame of c.frames) {
      const out = judge.update(frame.positions, c.box, frame.t_ms);
      for (const [key, want] of Object.entries(frame.expect)) assert.deepEqual(out[key], want, `${frame.t_ms} ${key}`);
    }
    assert.equal(judge.hits, c.hits);
  });
}

test('config overrides apply and the defaults stay frozen', () => {
  const box = { center: [1, 0, 0.475], half: [0.15, 0.15, 0.475] };
  const judge = new FootStrikeJudge({ min_lift_m: 0.05 });
  judge.update({ right_ankle: [0.6, 0, 0.08] }, box, 0);
  assert.deepEqual(judge.update({ right_ankle: [0.9, 0, 0.10] }, box, 33).hit, { right_ankle: 'inside' });
  assert.ok(Object.isFrozen(FOOT_STRIKE_CONFIG));
});
