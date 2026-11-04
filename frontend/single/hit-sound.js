// K-SC-05: synthesized impact and collapse sound for hits the game accepted. Web Audio only, no sound files.
// Browsers keep an AudioContext suspended until a user gesture: prepare() early, unlock() from a click or key press.
const MAX_VOICES = 3;

// Swing speed in image diagonals/s → loudness. A screen-effect mapping only, not a measured force.
export function hitGain(speedNormPerS) {
  const speed = Number.isFinite(speedNormPerS) && speedNormPerS > 0 ? speedNormPerS : 0;
  return Math.min(1, 0.55 + speed * 0.15);
}

export function createHitSound({
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
  random = Math.random,
} = {}) {
  let context = null;
  let noise = null;
  let voices = 0;
  let disposed = false;
  const stats = { played: 0, skipped: {} };

  const skip = (reason) => {
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
    return false;
  };

  // Two seconds of white noise, made once per context and reused for every collapse. Bursts start at a
  // random offset up to 0.5 s and last under 1.5 s, so they never run off the end.
  function noiseBuffer() {
    if (noise) return noise;
    noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    return noise;
  }

  function envelope(start, peak, attack, release) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    return gain;
  }

  function burst(output, start, peak, duration, filterType, frequency) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer();
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    const gain = envelope(start, peak, 0.005, duration);
    source.connect(filter).connect(gain).connect(output);
    source.start(start, random() * 0.5, duration + 0.05);
    return source;
  }

  return {
    // Create the (suspended) context ahead of time. Creating one blocked the page for 280 ms under headless
    // Chrome; doing that inside the start click let the wrist pose expire before the start check.
    prepare() {
      if (disposed) return 'disposed';
      try {
        context ??= createContext();
      } catch {
        return 'unsupported';
      }
      return context.state;
    },

    // Call from a user gesture. Safe to call repeatedly; returns whether audio can play now.
    async unlock() {
      if (disposed) return false;
      try {
        context ??= createContext();
        if (context.state === 'suspended') await context.resume();
      } catch {
        return false;
      }
      return context.state === 'running';
    },

    // Thump + crumble + a few debris clicks. Returns false (and counts why) when nothing was played.
    play(event = {}) {
      if (disposed) return skip('disposed');
      if (!context) return skip('locked');
      if (context.state !== 'running') return skip(context.state);
      if (voices >= MAX_VOICES) return skip('busy');
      const start = context.currentTime + 0.01;
      const master = context.createGain();
      master.gain.setValueAtTime(hitGain(event.speed_norm_per_s), start);
      master.connect(context.destination);

      const thump = context.createOscillator();
      thump.type = 'triangle';
      thump.frequency.setValueAtTime(150, start);
      thump.frequency.exponentialRampToValueAtTime(45, start + 0.25);
      thump.connect(envelope(start, 0.9, 0.004, 0.3)).connect(master);
      thump.start(start);
      thump.stop(start + 0.35);

      const sources = [thump, burst(master, start, 0.6, 0.9, 'lowpass', 900)];
      for (let i = 0; i < 4; i++) sources.push(burst(master, start + 0.08 + random() * 0.35, 0.25, 0.06, 'bandpass', 1800 + random() * 2200));

      voices += 1;
      let open = sources.length;
      for (const source of sources) {
        source.onended = () => {
          open -= 1;
          if (open === 0) {
            voices -= 1;
            master.disconnect();
          }
        };
      }
      stats.played += 1;
      return true;
    },

    info: () => ({ state: context?.state ?? 'locked', voices, played: stats.played, skipped: { ...stats.skipped } }),

    dispose() {
      disposed = true;
      const closing = context?.close?.();
      closing?.catch?.(() => {});
      context = null;
      noise = null;
    },
  };
}
