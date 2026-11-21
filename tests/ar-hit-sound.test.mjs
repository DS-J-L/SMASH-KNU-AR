import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArHitSound } from '../web/shared/ar-hit-sound.js';

function fixture() {
  const emitter = () => ({
    handlers: new Map(),
    addEventListener(type, handler) { this.handlers.set(type, handler); },
    removeEventListener(type, handler) { if (this.handlers.get(type) === handler) this.handlers.delete(type); },
    emit(type) { this.handlers.get(type)?.(); },
    setAttribute(name, value) { this[name] = value; },
  });
  const target = emitter(), page = emitter(), button = emitter(), gains = [];
  const parameter = () => ({ values: [], setValueAtTime(value) { this.values.push(value); }, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {} });
  const context = {
    state: 'suspended', currentTime: 0, sampleRate: 8000, destination: {},
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; },
    createGain() { const gain = { ...node(), gain: parameter() }; gains.push(gain); return gain; },
    createOscillator() { return { ...node(), frequency: parameter() }; },
    createBiquadFilter() { return { ...node(), frequency: parameter() }; },
    createBufferSource: node,
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
  const sound = createArHitSound({ target, page, button, createContext: () => context });
  const frame = (hits, valid = true, hit = { left_wrist: 'swept' }) => ({ hits, valid, hit });
  return { sound, target, page, button, gains, context, frame };
}

test('AR frames sound once for a new accepted 3D hit, with silent initial/reset/invalid/duplicate snapshots', async () => {
  const { sound, frame } = fixture();
  await sound.unlock();
  assert.equal(sound.observeFrame(frame(4)), false);
  assert.equal(sound.observeFrame(frame(5)), true);
  assert.equal(sound.observeFrame(frame(5)), false);
  assert.equal(sound.observeFrame(frame(6, false)), false);
  assert.equal(sound.observeFrame(frame(6)), false);
  assert.equal(sound.observeFrame(frame(7, true, {})), false);
  assert.equal(sound.observeFrame(frame(0, true, {})), false);
  assert.equal(sound.observeFrame(frame(1)), true);
  sound.reset();
  assert.equal(sound.observeFrame(frame(10)), false);
  assert.equal(sound.observeFrame(frame(11)), true);
  assert.equal(sound.info().played, 3);
  sound.dispose();
});

test('AR mute cuts the output bus and muted hit counts are not replayed when enabled again', async () => {
  const { sound, button, gains, frame } = fixture();
  await sound.unlock();
  sound.observeFrame(frame(0)); sound.observeFrame(frame(1));
  assert.equal(sound.info().played, 1);
  button.emit('click');
  assert.equal(button['aria-pressed'], 'false');
  assert.equal(button.textContent, '소리 켜기');
  assert.ok(gains.some(gain => gain.gain.values.at(-1) === 0));
  assert.equal(sound.observeFrame(frame(2)), true);
  assert.equal(sound.info().played, 1);
  button.emit('click');
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(sound.observeFrame(frame(2)), false);
  assert.equal(sound.observeFrame(frame(3)), true);
  assert.equal(sound.info().played, 2);
  sound.dispose();
});

test('the local AR producer plays without any screen-2D event, and pagehide frees its audio', async () => {
  const { sound, context, page, target, button } = fixture();
  target.emit('keydown');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sound.hit(), true);
  assert.equal(sound.info().played, 1);
  page.emit('pagehide');
  assert.equal(context.state, 'closed');
  assert.equal(sound.hit(), false);
  assert.equal(target.handlers.size, 0);
  assert.equal(button.handlers.size, 0);
});

test('muting while browser resume is pending cancels the sound without blocking the accepted hit', async () => {
  const { sound, context, target } = fixture();
  let finish;
  context.resume = () => new Promise(resolve => { finish = () => { context.state = 'running'; resolve(); }; });
  target.emit('keydown');
  assert.equal(sound.hit(), true);
  sound.setEnabled(false);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sound.info().played, 0);
  sound.setEnabled(true);
  assert.equal(sound.hit(), true);
  assert.equal(sound.info().played, 1);
  sound.dispose();
});

test('reconnect discards a previously accepted hit still waiting for the browser audio resume', async () => {
  const { sound, context, target, frame } = fixture();
  let finish;
  context.resume = () => new Promise(resolve => { finish = () => { context.state = 'running'; resolve(); }; });
  target.emit('keydown');
  sound.observeFrame(frame(0)); sound.observeFrame(frame(1));
  sound.reset();
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sound.info().played, 0);
  sound.dispose();
});

test('a back/forward-cache restore reloads disposed AR resources', () => {
  const { sound, page } = fixture();
  let reloads = 0;
  page.location = { reload() { reloads++; } };
  page.emit('pagehide');
  page.handlers.get('pageshow')({ persisted: true });
  assert.equal(reloads, 1);
  sound.dispose();
});

test('unsupported Web Audio cannot throw into the AR hit/measurement loop', () => {
  const sound = createArHitSound({ target: null, page: null, createContext: () => { throw new Error('no audio'); } });
  assert.doesNotThrow(() => { sound.hit(); sound.beep(); sound.dispose(); });
  assert.equal(sound.info().played, 0);
});
