// web/shared/model-strike-3d.js against the shared cases (backend/model_strike.py runs the same file) and IT1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BuildingDamage, ModelStrikeJudge, blocksToBreak, buildModelTarget, faceContact, firstEntry, hullPlanes, insideModel,
  loadModelTarget, markerToPackage, placementToThree, packageToMarker, unsupported } from '../web/shared/model-strike-3d.js';

const doc = JSON.parse(readFileSync(new URL('./fixtures/model_strike_cases.json', import.meta.url), 'utf8'));
const it1Path = new URL('../web/public/assets/buildings/knu-it1-v3/colliders.json', import.meta.url);
const it1Json = JSON.parse(readFileSync(it1Path, 'utf8'));
const close = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const packageOf = (c) => (c.package === 'wall' ? doc.wall_package : doc.package);
const buildingsDir = new URL('../web/public/assets/buildings/', import.meta.url);
const REAL = ['knu-it1-v3', 'knu-main-v2', 'knu-it5-practice-v1', 'knu-library-practice-v1', 'knu-global-practice-v1'];

function judgeFor(c) {
  let ids = 0;
  return new ModelStrikeJudge(buildModelTarget(packageOf(c), c.placement ?? {}), { config: c.config ?? {}, uuid: () => `event-${++ids}` });
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
      if ('remaining_fragments' in want) assert.equal(out.remaining_fragments, want.remaining_fragments, `${frame.t_ms}`);
      if (want.event === null) { assert.equal(out.event, null, `${frame.t_ms}`); continue; }
      for (const key of ['joint', 'hit_by', 'fragment_id']) assert.equal(out.event[key], want.event[key], `${frame.t_ms} ${key}`);
      for (const key of ['broken_fragment_ids', 'fallen_fragment_ids']) {
        if (key in want.event) assert.deepEqual(out.event[key], want.event[key], `${frame.t_ms} ${key}`);
      }
      assert.ok(close(out.event.point_m, want.event.point_m), `${frame.t_ms} ${out.event.point_m}`);
    }
    assert.equal(judge.hits, c.hits);
  });
}

test('event fields match the Python twin', () => {
  const judge = judgeFor(doc.cases[0]);
  judge.update({ left_wrist: [-0.5, -0.6, 0.8] }, 0);
  const { event } = judge.update({ left_wrist: [-0.5, -0.1, 0.8] }, 33);
  assert.equal(event.schema, 'model_strike.v2-draft');
  assert.equal(event.points, 1);
  assert.equal(event.remaining_fragments, 0);
  assert.equal(event.config_version, 'model-3d-2');
  assert.equal(event.event_id, 'event-1');
  assert.equal(event.building_id, 'test-l-block');
  assert.equal(event.speed_mps, Math.round((0.5 / 0.033) * 1000) / 1000);
  assert.deepEqual(event.placement, { x_m: 0, y_m: 0, yaw_deg: 0, scale: 1 });
});

test('wall support structure matches the hand-worked one', () => {
  const t = buildModelTarget(doc.wall_package);
  const ids = t.fragments.map((f) => f.fragment_id);
  assert.deepEqual(t.grounded.map((i) => ids[i]).sort(), ['G1', 'G2', 'G3', 'S']);
  assert.deepEqual(Object.fromEntries(ids.map((id, i) => [id, t.links[i].map((j) => ids[j]).sort()])), {
    G1: ['G2', 'M1', 'S'], G2: ['G1', 'G3', 'M2'], G3: ['G2', 'M3'], M1: ['G1', 'M2', 'T1'], M2: ['G2', 'M1', 'M3', 'T1'],
    M3: ['G3', 'H', 'M2', 'T2'], T1: ['M1', 'M2', 'T2'], T2: ['M3', 'T1'], H: ['M3'], S: ['G1'] });
  const small = buildModelTarget(doc.wall_package, { x_m: 1, y_m: -2, yaw_deg: 33, scale: 0.5 });
  assert.deepEqual([small.grounded, small.links], [t.grounded, t.links]);
});

test('faceContact needs a shared face', () => {
  const cube = (x, z) => [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [x + a, b, z + c])));
  const [a, b, c, far] = [cube(0, 0), cube(1, 0), cube(1, 1), cube(1.01, 0)];
  assert.ok(close(faceContact(a, hullPlanes(a), b, hullPlanes(b), 0.002), [1, 0, 0], 1e-9));
  assert.ok(close(faceContact(b, hullPlanes(b), c, hullPlanes(c), 0.002), [0, 0, 1], 1e-9));
  assert.equal(faceContact(a, hullPlanes(a), c, hullPlanes(c), 0.002), null);
  assert.equal(faceContact(a, hullPlanes(a), far, hullPlanes(far), 0.002), null);
  assert.throws(() => new ModelStrikeJudge(buildModelTarget(doc.package), { config: { damage_mode: 'half' } }), /invalid_damage_mode/);
});

for (const name of REAL) {
  test(`${name}: stands intact, falls without its base, every hit breaks three`, () => {
    const t = buildModelTarget(JSON.parse(readFileSync(new URL(`${name}/colliders.json`, buildingsDir), 'utf8')));
    const manifest = JSON.parse(readFileSync(new URL(`${name}/manifest.json`, buildingsDir), 'utf8'));
    assert.equal(t.fragments.length, manifest.fragment_count);
    assert.deepEqual(unsupported(t, new Set()), []);
    const base = new Set(t.grounded);
    assert.equal(unsupported(t, base).length + base.size, t.fragments.length);
    t.fragments.forEach((f, i) => {
      const hit = blocksToBreak(t, i, f.centroid, new Set(), 3);
      assert.ok(hit[0] === i && new Set(hit).size === 3);
    });
  });
}

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

// BuildingDamage: screens that already know the hit point on the drawn model (the 2D game's ray).
test('markerToPackage undoes packageToMarker', () => {
  const placement = { x_m: 0.4, y_m: -1.2, yaw_deg: 37, scale: 0.8 };
  for (const p of [[0, 0, 0], [0.3, 0.5, -0.2], [-1.4, 1.08, 0.31]]) {
    assert.ok(close(markerToPackage(packageToMarker(p, placement), placement), p, 1e-12));
    assert.ok(close(markerToPackage(packageToMarker(p)), p, 1e-12));
  }
});

test('BuildingDamage breaks what the judge breaks for every hit of the shared cases', () => {
  let checked = 0;
  for (const c of doc.cases) {
    const judge = judgeFor(c);
    const damage = new BuildingDamage(judge.target, { damage_mode: judge.config.damage_mode, break_count: judge.config.break_count });
    for (const frame of c.frames) {
      if (frame.action === 'restore') { judge.restore(); damage.restore(); }
      const out = judge.update(frame.positions, frame.t_ms);
      if (!out.event) continue;
      const got = damage.hitAt(markerToPackage(out.event.point_m, judge.target.placement));
      assert.ok(got, `${c.name} ${frame.t_ms}`);
      assert.equal(got.fragment_id, out.event.fragment_id, `${c.name} ${frame.t_ms}`);
      assert.deepEqual(got.broken_fragment_ids, out.event.broken_fragment_ids, `${c.name} ${frame.t_ms}`);
      assert.deepEqual(got.fallen_fragment_ids, out.event.fallen_fragment_ids, `${c.name} ${frame.t_ms}`);
      assert.equal(got.remaining_fragments, out.remaining_fragments, `${c.name} ${frame.t_ms}`);
      assert.equal(got.destroyed, out.destroyed);
      assert.equal(got.points, 1);
      checked++;
    }
  }
  assert.ok(checked >= 8, `${checked}`);
});

test('BuildingDamage on the wall: nodes to release, broken spots are air, far points miss', () => {
  const damage = new BuildingDamage(buildModelTarget(doc.wall_package));
  const front = markerToPackage([0.92, -0.1, 0.7]);  // the first punch of the wall cases, on M2's front face
  assert.equal(damage.hitAt(markerToPackage([0.92, -0.6, 0.7])), null);  // 50 cm in front of the wall
  assert.equal(damage.remaining, 10);
  const got = damage.hitAt(front);
  assert.deepEqual(got.broken_nodes, ['M2', 'M3', 'T2']);
  assert.deepEqual(got.fallen_nodes, ['H']);
  assert.equal(got.remaining_fragments, 6);
  assert.equal(damage.hitAt(front), null);  // the same spot is a hole now: no block, no point
  assert.equal(damage.hits, 1);
  damage.restore();
  assert.equal(damage.remaining, 10);
  assert.deepEqual(damage.hitAt(front).broken_nodes, ['M2', 'M3', 'T2']);
  assert.throws(() => new BuildingDamage(damage.target, { damage_mode: 'some' }), /invalid_damage_mode/);
  assert.throws(() => new BuildingDamage(damage.target, { break_count: 0 }), /invalid_break_count/);
});

test('BuildingDamage on IT1: a facade point breaks 3 scene nodes and repeated hits bring it down', () => {
  const target = buildModelTarget(it1Json);
  const hit = firstEntry(target, [0, -0.8, 0.5], [0, -0.1, 0.5]);
  const damage = new BuildingDamage(target);
  const got = damage.hitAt(markerToPackage(hit.point));
  assert.equal(got.fragment_id, hit.fragment_id);
  assert.equal(got.broken_nodes.length, 3);
  assert.ok(got.broken_nodes.every((n) => /^SM_IT1V3_Fragment_\d{3}$/.test(n)));
  assert.equal(got.remaining_fragments, 96 - 3 - got.fallen_fragment_ids.length);
  // Keep hitting whatever block is left first in the package, at its centre, until nothing is left.
  let hits = 1;
  while (!damage.destroyed && hits < 200) {
    const i = target.fragments.findIndex((_, k) => !damage.broken.has(k));
    assert.ok(damage.hitAt(markerToPackage(target.fragments[i].centroid)));
    hits++;
  }
  assert.ok(damage.destroyed && hits > 10 && hits < 40, `${hits}`);
});
