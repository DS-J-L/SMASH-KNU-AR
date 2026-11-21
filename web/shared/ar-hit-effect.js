// Cosmetic feedback in marker coordinates (z-up, metres). It never changes tracking or damage.
export const EFFECT_LIFETIME_MS = 1400;
export const MAX_EFFECT_BURSTS = 3;
const CHUNKS = 18, DUST = 6, G = 5.5;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function createArHitEffect({ now = () => performance.now(), random = Math.random,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false } = {}) {
  let bursts = [], total = 0, renderedFrames = 0;
  const prune = time => { bursts = bursts.filter(burst => time - burst.born < EFFECT_LIFETIME_MS); };
  function trigger(point, building) {
    if (!vector(building?.center) || !vector(building?.half) || building.half.some(value => value <= 0)) return false;
    const { center, half } = building, at = vector(point) ? point : center;
    const origin = at.map((value, axis) => clamp(value, center[axis] - half[axis], center[axis] + half[axis]));
    origin[2] = Math.max(0, origin[2]);
    const size = clamp(Math.min(...half) * 2, .18, .8), born = now();
    prune(born);
    const particles = Array.from({ length: reducedMotion ? 0 : CHUNKS + DUST }, (_, i) => {
      const angle = i * 2.399963 + random() * .4, speed = size * (.7 + random() * 2);
      return { dust: i >= CHUNKS, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        vz: .5 + random() * 1.2, radius: size * (.025 + random() * .045), spin: (random() - .5) * 14, angle };
    });
    bursts.push({ id: ++total, origin, born, size, particles });
    bursts = bursts.slice(-MAX_EFFECT_BURSTS);
    return true;
  }
  function sample(time = now()) {
    prune(time);
    return bursts.map(burst => {
      const age = Math.max(0, time - burst.born) / 1000, fade = Math.max(0, 1 - age / 1.4);
      return { id: burst.id, origin: [...burst.origin], size: burst.size, age, fade,
        particles: burst.particles.map(particle => {
          const { origin } = burst;
          let z = origin[2] + particle.vz * age - .5 * G * age * age;
          const land = (particle.vz + Math.sqrt(particle.vz ** 2 + 2 * G * origin[2])) / G;
          if (age > land) { const t = age - land; z = .22 * (G * land - particle.vz) * t - .5 * G * t * t; }
          return { dust: particle.dust, radius: particle.radius, angle: particle.angle + particle.spin * age,
            position: [origin[0] + particle.vx * age, origin[1] + particle.vy * age,
              particle.dust ? origin[2] + age * .12 : Math.max(.008, z)] };
        }) };
    });
  }
  function recoil(time = now()) {
    if (reducedMotion) return [0, 0, 0];
    prune(time);
    const burst = bursts.at(-1), age = burst ? Math.max(0, time - burst.born) / 1000 : 1;
    if (age > .32) return [0, 0, 0];
    const amount = burst.size * .06 * Math.exp(-age * 13);
    return [Math.sin(age * 67) * amount, Math.sin(age * 43) * amount, 0];
  }
  function draw(context, project, time = now()) {
    let visible = false;
    for (const burst of sample(time)) {
      const center = project(burst.origin);
      if (!center?.every(Number.isFinite)) continue;
      visible = true;
      const edge = project([burst.origin[0] + burst.size, burst.origin[1], burst.origin[2]]);
      const scale = edge ? Math.hypot(edge[0] - center[0], edge[1] - center[1]) / burst.size : 60;
      context.save();
      // Dust billows, projected at the hit point rather than fixed to the viewport.
      for (const particle of burst.particles.filter(particle => particle.dust)) {
        const p = project(particle.position);
        if (!p) continue;
        const radius = clamp(particle.radius * scale * (3 + burst.age * 8), 3, 65);
        const gradient = context.createRadialGradient(p[0], p[1], 0, p[0], p[1], radius);
        gradient.addColorStop(0, `rgba(194,166,130,${burst.fade * .3})`);
        gradient.addColorStop(1, 'rgba(194,166,130,0)');
        context.fillStyle = gradient; context.beginPath(); context.arc(p[0], p[1], radius, 0, Math.PI * 2); context.fill();
      }
      if (burst.age < .55) {
        context.strokeStyle = `rgba(255,192,82,${(1 - burst.age / .55) * .9})`;
        context.lineWidth = Math.max(1.5, scale * .012);
        context.beginPath();
        const radius = burst.size * (.12 + burst.age * 2.1);
        let pen = false;
        for (let i = 0; i <= 40; i++) {
          const angle = i * Math.PI / 20;
          const p = project([burst.origin[0] + Math.cos(angle) * radius, burst.origin[1] + Math.sin(angle) * radius, burst.origin[2]]);
          if (!p) { pen = false; continue; }
          if (pen) context.lineTo(p[0], p[1]); else context.moveTo(p[0], p[1]);
          pen = true;
        }
        context.stroke();
      }
      for (const particle of burst.particles.filter(particle => !particle.dust)) {
        const p = project(particle.position);
        if (!p) continue;
        const radius = clamp(particle.radius * scale, 2, 16);
        context.save(); context.translate(p[0], p[1]); context.rotate(particle.angle);
        context.globalAlpha = burst.fade;
        context.fillStyle = '#e8b66d'; context.strokeStyle = '#775036'; context.lineWidth = 1;
        context.fillRect(-radius, -radius, radius * 2, radius * 1.5);
        context.strokeRect(-radius, -radius, radius * 2, radius * 1.5); context.restore();
      }
      if (burst.age < .16 && !reducedMotion) {
        const radius = clamp(burst.size * scale * .45, 10, 100);
        const glow = context.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
        glow.addColorStop(0, `rgba(255,251,228,${1 - burst.age / .16})`);
        glow.addColorStop(.3, 'rgba(255,204,105,.65)'); glow.addColorStop(1, 'rgba(255,173,55,0)');
        context.fillStyle = glow; context.beginPath(); context.arc(center[0], center[1], radius, 0, Math.PI * 2); context.fill();
      }
      context.restore();
    }
    if (visible) renderedFrames++;
  }
  return { trigger, sample, recoil, draw,
    clear() { bursts = []; },
    snapshot(time = now()) { prune(time); return { total, active: bursts.length, particles: bursts.reduce((sum, burst) => sum + burst.particles.length, 0),
      renderedFrames, lastOrigin: bursts.length ? [...bursts.at(-1).origin] : null, reducedMotion }; },
  };
}
