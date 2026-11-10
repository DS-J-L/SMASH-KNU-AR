// web/shared/model-strike-3d.js against the shared cases (backend/model_strike.py runs the same file) and IT1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModelStrikeJudge, buildModelTarget, firstEntry, insideModel, loadModelTarget, placementToThree,
  packageToMarker } from '../web/shared/model-strike-3d.js';

const doc = JSON.parse(readFileSync(new URL('./fixtures/model_strike_cases.json', import.meta.url), 'utf8'));
const it1Path = new URL('../web/public/assets/buildings/knu-it1-v3/colliders.json', import.meta.url);
const it1Json = JSON.parse(readFileSync(it1Path, 'utf8'));
const close = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

function judgeFor(c) {
  let ids = 0;
  return new ModelStrikeJudge(buildModelTarget(doc.package, c.placement ?? {}), { config: c.config ?? {}, uuid: () => `event-${++ids}` });
}

for (const c of doc.cases) {
  test(`shared case: ${c.name}`, () => {
    const judge = judgeFor(c);
    for (const frame of c.frames) {
      if (frame.action === 'restore') judge.restore();
      const out = judge.update(frame.positions, frame.t_ms);
      const want = frame.expect;
      assert.deepEqual(out.decisions, want.decisions, `${frame.t_ms}`);
      for (const key of ['support', 'standing_in_building', 'destroyed']) assert.equal(out[key], want[key], `${frame.t_ms} ${key}`);
      if (want.event === null) { assert.equal(out.event, null, `${frame.t_ms}`); continue; }
      for (const key of ['joint', 'hit_by', 'fragment_id']) assert.equal(out.event[key], want.event[key], `${frame.t_ms} ${key}`);
      assert.ok(close(out.event.point_m, want.event.point_m), `${frame.t_ms} ${out.event.point_m}`);
    }
    assert.equal(judge.hits, c.hits);
  });
}

test('event fields match the Python twin', () => {
  const judge = judgeFor(doc.cases[0]);
  judge.update({ left_wrist: [-0.5, -0.6, 0.8] }, 0);
  const { event } = judge.update({ left_wrist: [-0.5, -0.1, 0.8] }, 33);
  assert.equal(event.schema, 'model_strike.v1-draft');
  assert.equal(event.event_id, 'event-1');
  assert.equal(event.building_id, 'test-l-block');
  assert.equal(event.speed_mps, Math.round((0.5 / 0.033) * 1000) / 1000);
  assert.deepEqual(event.placement, { x_m: 0, y_m: 0, yaw_deg: 0, scale: 1 });
});

test('placementToThree describes the same transform as packageToMarker', () => {
  const placement = { x_m: 2, y_m: 1, yaw_deg: 90, scale: 0.5 };
  const t = placementToThree(placement);
  // Apply inner rotationX, then scale, rotationZ, position by hand to the package point (1, 0.5, 0.25).
  const p = [1, 0.5, 0.25];
  const rx = [p[0], -p[2], p[1]];
  const s = rx.map((v) => v * t.scale);
  const c = Math.cos(t.rotationZ), n = Math.sin(t.rotationZ);
  const manual = [c * s[0] - n * s[1] + t.position[0], n * s[0] + c * s[1] + t.position[1], s[2] + t.position[2]];
  assert.ok(close(manual, packageToMarker(p, placement), 1e-9));
  assert.equal(t.innerRotationX, Math.PI / 2);
});

test('IT1: bounds match the manifest, hulls are closed, punch hits the facade', () => {
  const target = buildModelTarget(it1Json);
  assert.equal(target.fragments.length, 96);
  assert.ok(close(target.lo, [-1.405, -0.313, 0], 2e-3) && close(target.hi, [1.405, 0.313, 1.084], 2e-3));
  for (const f of target.fragments) {
    const centre = [0, 1, 2].map((k) => (f.lo[k] + f.hi[k]) / 2);
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      if (!dx && !dy && !dz) continue;
      const far = [centre[0] + 10 * dx, centre[1] + 10 * dy, centre[2] + 10 * dz];
      assert.ok(!f.planes.every(({ n, d }) => n[0] * far[0] + n[1] * far[1] + n[2] * far[2] - d <= 0), f.fragment_id);
    }
  }
  assert.notEqual(insideModel(target, [0, 0, 0.5]), null);
  assert.equal(insideModel(target, [0, 0.5, 0.5]), null);
  assert.equal(insideModel(target, [0, 0, 1.2]), null);
  const hit = firstEntry(target, [0, -0.8, 0.5], [0, -0.1, 0.5]);
  // The facade is not flat, so check the entry itself: just before it is air, just after it is building.
  assert.ok(hit.point[1] >= target.lo[1] - 1e-6 && hit.point[1] < 0);
  assert.equal(insideModel(target, [0, hit.point[1] - 0.005, 0.5]), null);
  assert.notEqual(insideModel(target, [0, hit.point[1] + 0.005, 0.5]), null);
});

test('loadModelTarget fetches colliders and rejects HTTP errors', async () => {
  const ok = await loadModelTarget('x', {}, async () => ({ ok: true, json: async () => it1Json }));
  assert.equal(ok.building_id, 'knu-it1-v3');
  await assert.rejects(loadModelTarget('x', {}, async () => ({ ok: false, status: 401 })), /colliders_http_401/);
  assert.throws(() => buildModelTarget(doc.package, { scale: 0 }), /invalid_placement/);
});
