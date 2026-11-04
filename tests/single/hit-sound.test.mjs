import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHitSound, hitGain } from '../../frontend/single/hit-sound.js';

// Minimal Web Audio stand-in: records nodes, scheduled starts and connections.
function fakeContext({ state = 'suspended', resumeFails = false, resume = null, connectThrows = false } = {}) {
  const log = { created: [], started: [], resumed: 0, closed: 0, buffers: 0, stopped: 0 };
  const param = () => ({ values: [], setValueAtTime(v) { this.values.push(v); }, exponentialRampToValueAtTime() {} });
  const node = (kind, extra = {}) => {
    const n = { kind, connected: [], connect(to) { if (connectThrows && kind === 'filter') throw new Error('connect failed'); this.connected.push(to); return undefined; }, disconnect() { this.disconnected = true; }, ...extra };
    log.created.push(n);
    return n;
  };
  const source = (kind, extra) => node(kind, { start(when, offset, duration) { log.started.push({ kind, when, offset, duration }); }, stop() { log.stopped++; }, ...extra });
  const ctx = {
    state, currentTime: 10, sampleRate: 8000, destination: { kind: 'destination' },
    async resume() { if (resumeFails) throw new Error('blocked'); if (resume) return resume(this); log.resumed++; this.state = 'running'; },
    async close() { log.closed++; this.state = 'closed'; },
    createGain: () => node('gain', { gain: param() }),
    createOscillator: () => source('oscillator', { frequency: param(), type: 'sine' }),
    createBiquadFilter: () => node('filter', { frequency: param(), type: 'lowpass' }),
    createBufferSource: () => source('buffer'),
    createBuffer: (channels, length) => { log.buffers++; const data = new Float32Array(length); return { length, getChannelData: () => data }; },
  };
  return { ctx, log };
}

test('speed maps to a bounded loudness, with bad speeds at the floor', () => {
  assert.equal(hitGain(0), 0.55);
  assert.ok(Math.abs(hitGain(1) - 0.7) < 1e-12);
  assert.equal(hitGain(10), 1);
  assert.equal(hitGain(NaN), 0.55);
  assert.equal(hitGain(-3), 0.55);
});

test('nothing plays and no context exists before a user gesture unlocks audio', () => {
  let made = 0;
  const sound = createHitSound({ createContext: () => { made++; return fakeContext().ctx; } });
  assert.equal(sound.play({ speed_norm_per_s: 1 }), false);
  assert.equal(made, 0);
  assert.deepEqual(sound.info(), { state: 'locked', voices: 0, played: 0, skipped: { locked: 1 } });
});

test('unlock resumes once; a hit then schedules thump, crumble and debris into the destination', async () => {
  const { ctx, log } = fakeContext();
  const sound = createHitSound({ createContext: () => ctx, random: () => 0.5 });
  assert.equal(await sound.unlock(), true);
  assert.equal(await sound.unlock(), true);
  assert.equal(log.resumed, 1);
  assert.equal(sound.play({ speed_norm_per_s: 1.2 }), true);
  assert.deepEqual(log.started.map((s) => s.kind), ['oscillator', 'buffer', 'buffer', 'buffer', 'buffer', 'buffer']);
  assert.ok(log.started.every((s) => s.when >= ctx.currentTime));
  // Bursts never read past the 2 s noise buffer: offset ≤ 0.5 s, duration ≤ 0.95 s.
  for (const s of log.started.filter((x) => x.kind === 'buffer')) assert.ok(s.offset + s.duration <= 2);
  const master = log.created.find((n) => n.kind === 'gain' && n.connected.includes(ctx.destination));
  assert.ok(master);
  assert.equal(log.buffers, 1);
  sound.play({});
  assert.equal(log.buffers, 1, 'noise buffer reused');
});

test('prepare builds a suspended context without resuming; the gesture then only resumes it', async () => {
  let made = 0;
  const { ctx, log } = fakeContext();
  const sound = createHitSound({ createContext: () => { made++; return ctx; } });
  assert.equal(sound.prepare(), 'suspended');
  assert.equal(sound.prepare(), 'suspended');
  assert.equal(made, 1);
  assert.equal(log.resumed, 0);
  assert.equal(sound.play(), false);
  assert.equal(await sound.unlock(), true);
  assert.equal(made, 1);
  assert.equal(sound.play(), true);
  assert.equal(createHitSound({ createContext: () => { throw new Error('no audio'); } }).prepare(), 'unsupported');
});

test('voices are capped and released when every source of a hit has ended', async () => {
  const { ctx, log } = fakeContext({ state: 'running' });
  const sound = createHitSound({ createContext: () => ctx, random: () => 0.1 });
  await sound.unlock();
  assert.equal(sound.play(), true);
  assert.equal(sound.play(), true);
  assert.equal(sound.play(), true);
  assert.equal(sound.play(), false);
  assert.deepEqual(sound.info().skipped, { busy: 1 });
  const firstHit = log.created.filter((n) => n.onended).slice(0, 6);
  for (const n of firstHit) n.onended();
  assert.equal(sound.info().voices, 2);
  assert.equal(sound.play(), true);
});

test('a blocked resume or a suspended context reports false instead of throwing', async () => {
  const blocked = createHitSound({ createContext: () => fakeContext({ resumeFails: true }).ctx });
  assert.equal(await blocked.unlock(), false);
  assert.equal(blocked.play(), false);
  assert.deepEqual(blocked.info().skipped, { suspended: 1 });
  const unsupported = createHitSound({ createContext: () => { throw new Error('no audio'); } });
  assert.equal(await unsupported.unlock(), false);
  assert.equal(unsupported.play(), false);
});

test('master gain leaves headroom for three overlapping hits', async () => {
  const { ctx, log } = fakeContext({ state: 'running' });
  const sound = createHitSound({ createContext: () => ctx });
  await sound.unlock();
  sound.play({ speed_norm_per_s: 100 });
  const master = log.created.find((n) => n.kind === 'gain' && n.connected.includes(ctx.destination));
  assert.ok(Math.abs(master.gain.values[0] - 0.45) < 1e-12);
});

test('dispose while resume() is pending resolves unlock to false instead of throwing', async () => {
  let finish;
  const { ctx } = fakeContext({ resume: (c) => new Promise((r) => { finish = () => { c.state = 'running'; r(); }; }) });
  const sound = createHitSound({ createContext: () => ctx });
  const pending = sound.unlock();
  sound.dispose();
  finish();
  assert.equal(await pending, false);
});

test('an interrupted context (Safari) is resumed by the next unlock', async () => {
  const { ctx, log } = fakeContext({ state: 'interrupted' });
  const sound = createHitSound({ createContext: () => ctx });
  assert.equal(sound.play(), false);
  assert.equal(await sound.unlock(), true);
  assert.equal(log.resumed, 1);
  assert.deepEqual(sound.info().skipped, { locked: 1 });
});

test('a failing graph build is reported, stops what started and does not hold a voice', async () => {
  const { ctx, log } = fakeContext({ state: 'running', connectThrows: true });
  const sound = createHitSound({ createContext: () => ctx });
  await sound.unlock();
  assert.doesNotThrow(() => sound.play());
  assert.equal(sound.play(), false);
  assert.deepEqual(sound.info().skipped, { error: 2 });
  assert.equal(sound.info().voices, 0);
  assert.ok(log.stopped >= 1);
});

test('dispose closes the context and later calls do nothing', async () => {
  const { ctx, log } = fakeContext({ state: 'running' });
  const sound = createHitSound({ createContext: () => ctx });
  await sound.unlock();
  sound.dispose();
  assert.equal(log.closed, 1);
  assert.equal(sound.play(), false);
  assert.equal(await sound.unlock(), false);
  assert.deepEqual(sound.info().skipped, { disposed: 1 });
});
