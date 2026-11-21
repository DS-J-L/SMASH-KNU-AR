import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArHitEffect, EFFECT_LIFETIME_MS, MAX_EFFECT_BURSTS } from '../web/shared/ar-hit-effect.js';

const building = { center: [0, 0, .5], half: [.15, .15, .5] };
const effect = options => createArHitEffect({ now: () => 1000, random: () => .5, reducedMotion: false, ...options });

test('a 3D hit is anchored inside the accepted target without changing its geometry', () => {
  const fx = effect(), before = structuredClone(building);
  assert.equal(fx.trigger([2, -.3, .7], building), true);
  assert.deepEqual(fx.snapshot().lastOrigin, [.15, -.15, .7]);
  assert.deepEqual(building, before);
  assert.equal(fx.snapshot().particles, 24);
  assert.equal(fx.trigger(null, { center: [0, 0, 0], half: [0, 1, 1] }), false);
  assert.equal(fx.snapshot().total, 1);
});

test('particles expire completely and burst count stays bounded under repeated hits', () => {
  const fx = effect();
  for (let i = 0; i < 1000; i++) fx.trigger([0, 0, .5], building);
  assert.equal(fx.snapshot().active, MAX_EFFECT_BURSTS);
  assert.equal(fx.snapshot().particles, MAX_EFFECT_BURSTS * 24);
  assert.equal(fx.snapshot(1000 + EFFECT_LIFETIME_MS).active, 0);
  assert.equal(fx.snapshot(1000 + EFFECT_LIFETIME_MS).particles, 0);
});

test('flight and bounce use elapsed time rather than render frame count', () => {
  const direct = effect(), stepped = effect();
  direct.trigger([0, 0, .5], building); stepped.trigger([0, 0, .5], building);
  for (let t = 1000; t < 1800; t += 33) stepped.sample(t);
  assert.deepEqual(stepped.sample(1800), direct.sample(1800));
  assert.ok(direct.sample(2200)[0].particles.every(p => p.position.every(Number.isFinite) && p.position[2] >= 0));
});

test('a compositor timestamp slightly before the hit does not discard the new burst', () => {
  const fx = effect(); fx.trigger([0, 0, .5], building);
  assert.equal(fx.sample(998)[0].age, 0);
  assert.equal(fx.snapshot().active, 1);
});

test('recoil returns to the exact target and reduced motion avoids flying particles', () => {
  const fx = effect(); fx.trigger([0, 0, .5], building);
  assert.ok(fx.recoil(1080).some(value => value !== 0));
  assert.deepEqual(fx.recoil(1400), [0, 0, 0]);
  const reduced = effect({ reducedMotion: true }); reduced.trigger([0, 0, .5], building);
  assert.equal(reduced.snapshot().particles, 0);
  assert.deepEqual(reduced.recoil(1080), [0, 0, 0]);
  reduced.clear(); assert.equal(reduced.snapshot().active, 0);
});

test('a target behind the camera is skipped without drawing invalid canvas coordinates', () => {
  const fx = effect(); fx.trigger([0, 0, .5], building);
  assert.doesNotThrow(() => fx.draw({}, () => null));
  assert.equal(fx.snapshot().renderedFrames, 0);
});
