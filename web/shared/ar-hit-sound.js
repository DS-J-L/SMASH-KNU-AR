import { attachHitSound, createHitSound } from './hit-sound.js?v=20261121-ar-sound-1';

// Audio for the AR phone and viewer pages. Hit detection and m/s stay with their 3D producers;
// this module only consumes accepted hits and does not turn them into screen-2D events.
export function createArHitSound({
  target = globalThis.document, page = globalThis.window, button = null,
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
} = {}) {
  let context = null, bus = null, lastHits = null, enabled = true, disposed = false, generation = 0;
  const voice = createHitSound({
    createContext: () => context ??= createContext(),
    getOutput(ctx) {
      if (!bus) { bus = ctx.createGain(); bus.gain.setValueAtTime(enabled ? 1 : 0, ctx.currentTime); bus.connect(ctx.destination); }
      return bus;
    },
  });
  const output = attachHitSound({ target, sound: voice });

  function hit() {
    if (disposed || !enabled) return false;
    const currentGeneration = generation;
    void output.play(undefined, () => enabled && !disposed && currentGeneration === generation);
    return true;
  }
  function observeFrame(frame) {
    if (!Number.isSafeInteger(frame?.hits) || frame.hits < 0) return false;
    const previous = lastHits;
    lastHits = frame.hits;
    // First/reconnected snapshots, resets, duplicate counts and invalid tracking are silent.
    if (previous === null || frame.hits <= previous || frame.valid !== true || !Object.keys(frame.hit ?? {}).length) return false;
    hit();
    return true; // Recognition also drives visual feedback, independently of mute/audio support.
  }
  function setEnabled(value) {
    if (enabled !== Boolean(value)) generation++;
    enabled = Boolean(value);
    bus?.gain.setValueAtTime(enabled ? 1 : 0, context.currentTime);
    if (button) {
      button.textContent = enabled ? '소리 끄기' : '소리 켜기';
      button.setAttribute('aria-pressed', String(enabled));
      button.title = '화면을 한 번 클릭하면 AR 타격음이 활성화됩니다.';
    }
  }
  function toggle() { setEnabled(!enabled); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    button?.removeEventListener('click', toggle);
    page?.removeEventListener('pagehide', dispose);
    output.dispose();
  }
  setEnabled(true);
  button?.addEventListener('click', toggle);
  page?.addEventListener('pagehide', dispose, { once: true });
  // A page restored from the browser's back/forward cache needs fresh audio and camera resources.
  page?.addEventListener('pageshow', event => { if (event.persisted && disposed) page.location?.reload(); });
  return {
    hit, observeFrame, setEnabled, dispose,
    reset() { lastHits = null; generation++; },
    unlock: () => voice.unlock(),
    info: () => ({ ...voice.info(), enabled }),
    // Calibration/countdown cues retain their short tones and share the same audio context.
    beep(frequency = 660, seconds = 0.12) {
      if (disposed || !context || context.state !== 'running') return;
      try {
        const source = context.createOscillator(), gain = context.createGain(), start = context.currentTime;
        source.frequency.value = frequency;
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
        source.connect(gain); gain.connect(context.destination);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start(start); source.stop(start + seconds);
      } catch { /* Calibration audio must not block camera/measurement. */ }
    },
  };
}
