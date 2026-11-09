// PC viewer: shows what the phone page (/test/mono3d/) estimates, relayed by the server.
// Left: the phone's video with the projected marker/building/wrists. Middle: an orbitable 3D view.
// Nothing is recomputed here; values are the phone's `mono_approx` estimates.
import { add, sub, scale, cross, normalize, project } from './geometry.js?v=20261109-4';
import { createLink } from './link.js?v=20261109-4';

const $ = id => document.getElementById(id);
const videoCanvas = $('video'), vctx = videoCanvas.getContext('2d');
const scene = $('scene'), sctx = scene.getContext('2d');
const STALE_MS = 1500, TRAIL_MS = 600, GRAVITY = 9.8;
const LM_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32]];
const JOINT_EDGES = [['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'], ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']];
const WRIST_COLORS = { left_wrist: '#38bdf8', right_wrist: '#f97316' };

let calib = null, frame = null, frameAt = 0, jpeg = null, jpegAt = 0, phoneConnected = false, linkOpen = false;
let hits = 0, hitFlashAt = -1e9, debris = [], trails = { left_wrist: [], right_wrist: [] };
let audio = null;

// ---------- link ----------
const link = createLink('viewer', s => { linkOpen = s.open; phoneConnected = s.phone; renderStatus(); }, onMessage);
link.setEnabled(true);

function onMessage(m) {
  if (m.type === 'mono3d_calib') { const first = !calib; calib = m; if (first) resetView(); }
  else if (m.type === 'mono3d_frame') onFrame(m);
  else if (m.type === 'mono3d_jpeg') {
    const img = new Image();
    img.onload = () => { jpeg = img; jpegAt = performance.now(); };
    img.src = m.data;
  } else if (m.type === 'mono3d_phone_left') { frame = null; jpeg = null; }
}

function onFrame(m) {
  const now = performance.now(), firstSync = !frame;
  frame = m; frameAt = now;
  for (const [name, list] of Object.entries(trails)) {
    const P = m.joints?.[name];
    if (P) list.push({ P, t: now });
    while (list.length && now - list[0].t > TRAIL_MS) list.shift();
  }
  const hitNames = Object.keys(m.hit ?? {});
  if (m.hits !== hits) {
    if (!firstSync && (m.hits > hits || hitNames.length)) {
      onHit(hitNames.map(n => m.joints?.[n]).find(Boolean));
    }
    hits = m.hits; $('hits').textContent = hits;
  }
}

function onHit(at) {
  hitFlashAt = performance.now();
  const b = $('hits'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  const pop = $('hitPop'); pop.hidden = true; void pop.offsetWidth; pop.hidden = false;
  if (calib) {
    const { center, half } = calib.building;
    const origin = at ?? center;
    for (let i = 0; i < 40; i++) {
      const p = [center[0] + (Math.random() * 2 - 1) * half[0], center[1] + (Math.random() * 2 - 1) * half[1],
        Math.max(0.02, origin[2] + (Math.random() * 2 - 1) * 0.15)];
      const away = normalize([p[0] - origin[0] + 1e-3, p[1] - origin[1] + 1e-3, 0.2]);
      debris.push({ p, v: add(scale(away, 1 + Math.random() * 2), [0, 0, Math.random() * 2]), born: hitFlashAt,
        size: 0.02 + Math.random() * 0.04 });
    }
  }
  beep();
}

function renderStatus() {
  const el = $('status'), age = performance.now() - frameAt;
  let text, ok = false;
  if (!linkOpen) text = '서버에 연결 중…';
  else if (!phoneConnected) text = '폰 연결 대기 — 폰에서 측정 단계까지 진행하세요';
  else if (!calib || !frame) text = '폰 연결됨 — 측정 단계 대기';
  else if (age > STALE_MS) text = '폰 신호 끊김(화면 꺼짐·이동 확인)';
  else if (!frame.valid) text = `폰 연결됨 — ${({ no_person: '사람이 안 보임', body_not_calibrated: '몸 보정 필요',
    no_floor_or_torso_anchor: '발·몸통이 안 보임' })[frame.reason] ?? frame.reason ?? '사람이 안 보임'}`;
  else { text = `측정 중 · 폰 ${frame.fps ?? '?'} fps`; ok = true; }
  el.textContent = text; el.classList.toggle('ok', ok);
}

// ---------- left: phone video + projected overlay ----------
function drawVideo() {
  if (!calib) { clear(vctx, videoCanvas, '폰을 기다리는 중'); return; }
  const { width: W, height: H } = calib.image;
  if (videoCanvas.width !== W || videoCanvas.height !== H) { videoCanvas.width = W; videoCanvas.height = H; }
  const K = calib.K, pose = calib.camera, lw = Math.max(2, Math.min(W, H) / 250);
  vctx.setTransform(calib.mirror ? -1 : 1, 0, 0, 1, calib.mirror ? W : 0, 0);
  if (jpeg) vctx.drawImage(jpeg, 0, 0, W, H); else { vctx.fillStyle = '#000'; vctx.fillRect(0, 0, W, H); }
  const seg = (a, b, color, w = lw) => {
    const p = project(K, pose, a), q = project(K, pose, b);
    if (!p || !q) return;
    vctx.strokeStyle = color; vctx.lineWidth = w; vctx.beginPath(); vctx.moveTo(...p); vctx.lineTo(...q); vctx.stroke();
  };
  const s = calib.marker_side_m / 2, m = [[-s, s, 0], [s, s, 0], [s, -s, 0], [-s, -s, 0]];
  m.forEach((p, i) => seg(p, m[(i + 1) % 4], 'rgba(34,197,94,.6)', lw));
  const flashing = performance.now() - hitFlashAt < 300;
  for (const [a, b] of boxEdges(calib.building)) seg(a, b, flashing ? '#ef4444' : '#facc15', lw * 1.3);
  const lm = frame && performance.now() - frameAt < STALE_MS ? frame.landmarks : null;
  if (lm) {
    vctx.strokeStyle = 'rgba(255,255,255,.85)'; vctx.lineWidth = lw;
    for (const [a, b] of LM_EDGES) if (lm[a]?.[2] >= 0.5 && lm[b]?.[2] >= 0.5) {
      vctx.beginPath(); vctx.moveTo(lm[a][0] * W, lm[a][1] * H); vctx.lineTo(lm[b][0] * W, lm[b][1] * H); vctx.stroke();
    }
  }
  if (frame?.valid && performance.now() - frameAt < STALE_MS) {
    for (const [name, color] of Object.entries(WRIST_COLORS)) {
      const P = frame.joints?.[name];
      if (!P) continue;
      seg([P[0], P[1], 0], P, color, lw);
      const p = project(K, pose, P);
      if (p) { vctx.fillStyle = color; vctx.beginPath(); vctx.arc(p[0], p[1], lw * 3.5, 0, Math.PI * 2); vctx.fill(); }
    }
  }
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  $('videoInfo').textContent = jpeg ? `${W}×${H} · 영상 ${Math.round(performance.now() - jpegAt)}ms 전` : '';
}

function clear(c, canvas, text) {
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#9aa3ae'; c.font = '20px system-ui'; c.textAlign = 'center'; c.fillText(text, canvas.width / 2, canvas.height / 2);
  c.textAlign = 'left';
}

function boxCorners({ center, half }) {
  return [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [center[0] + x * half[0], center[1] + y * half[1], center[2] + z * half[2]])));
}
function boxEdges(box) {
  const v = boxCorners(box), edges = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if ([0, 1, 2].filter(k => v[i][k] !== v[j][k]).length === 1) edges.push([v[i], v[j]]);
  return edges;
}
function boxFaces(box) {
  const v = boxCorners(box);   // index = x*4 + y*2 + z, each 0/1
  return [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].map(f => f.map(i => v[i]));
}

// ---------- middle: orbit 3D view ----------
const view = { yaw: 0, pitch: 25, dist: 4.2, target: [0, 0.4, 0.5] };
function resetView() {
  if (calib) {
    const C = calib.camera.C;                       // start behind-and-beside the phone, looking at the building
    view.yaw = Math.atan2(C[0], C[1]) * 180 / Math.PI + 35;
    view.target = [0, 0.3, Math.max(0.4, calib.building.center[2])];
  }
  view.pitch = 25; view.dist = 4.2;
}
function virtualCamera(W, H) {
  const y = view.yaw * Math.PI / 180, p = view.pitch * Math.PI / 180;
  const eye = add(view.target, scale([Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)], view.dist));
  const f = normalize(sub(view.target, eye)), r = normalize(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [...r, ...d, ...f];
  const t = [0, 1, 2].map(i => -(R[3 * i] * eye[0] + R[3 * i + 1] * eye[1] + R[3 * i + 2] * eye[2]));
  const focal = 0.5 * H / Math.tan(25 * Math.PI / 180);
  return { K: { fx: focal, fy: focal, cx: W / 2, cy: H / 2 }, pose: { R, t, C: eye } };
}

function drawScene(now) {
  const rect = scene.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
  if (scene.width !== W || scene.height !== H) { scene.width = W; scene.height = H; }
  sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.fillStyle = '#05070a'; sctx.fillRect(0, 0, W, H);
  const cam = virtualCamera(W, H), lw = Math.max(1.5, H / 400);
  const P = p => project(cam.K, cam.pose, p);
  const seg = (a, b, color, w = lw) => {
    const p = P(a), q = P(b);
    if (!p || !q) return;
    sctx.strokeStyle = color; sctx.lineWidth = w; sctx.beginPath(); sctx.moveTo(...p); sctx.lineTo(...q); sctx.stroke();
  };
  const dot = (p3, color, r) => { const p = P(p3); if (p) { sctx.fillStyle = color; sctx.beginPath(); sctx.arc(p[0], p[1], r, 0, Math.PI * 2); sctx.fill(); } };
  for (let g = -2; g <= 2.001; g += 0.5) {            // floor grid, 0.5 m
    const major = Math.abs(g) < 1e-6;
    seg([g, -2, 0], [g, 2, 0], major ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.09)');
    seg([-2, g, 0], [2, g, 0], major ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.09)');
  }
  seg([0, 0, 0], [0.3, 0, 0], '#ef4444', lw * 1.5); seg([0, 0, 0], [0, 0.3, 0], '#22c55e', lw * 1.5);
  if (!calib) { label('폰 보정 정보를 기다리는 중', W / 2, H / 2, lw, 'center'); return; }

  const s = calib.marker_side_m / 2, m = [[-s, s, 0], [s, s, 0], [s, -s, 0], [-s, -s, 0]];
  m.forEach((p, i) => seg(p, m[(i + 1) % 4], 'rgba(34,197,94,.7)', lw));

  // Phone: position + viewing direction.
  const C = calib.camera.C, Rt = calib.camera.R, fwd = [Rt[6], Rt[7], Rt[8]];
  seg([C[0], C[1], 0], C, 'rgba(148,163,184,.5)', lw);
  seg(C, add(C, scale(fwd, 0.4)), '#94a3b8', lw * 1.5);
  dot(C, '#cbd5e1', lw * 4); labelAt(P(C), `폰 ${C[2].toFixed(2)}m`, lw);

  // Building: filled faces, far ones first; shakes and turns red when hit.
  const since = now - hitFlashAt, flashing = since < 400;
  const shake = flashing ? [(Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, 0] : [0, 0, 0];
  const b = { center: add(calib.building.center, shake), half: calib.building.half };
  const faces = boxFaces(b).map(f => ({ f, depth: f.reduce((acc, p) => acc + depthOf(cam.pose, p), 0) / 4 }))
    .sort((a, c) => c.depth - a.depth);
  for (const { f } of faces) {
    const pts = f.map(P);
    if (pts.some(x => !x)) continue;
    sctx.fillStyle = flashing ? 'rgba(239,68,68,.55)' : 'rgba(250,204,21,.22)';
    sctx.beginPath(); pts.forEach((p, i) => i ? sctx.lineTo(...p) : sctx.moveTo(...p)); sctx.closePath(); sctx.fill();
  }
  for (const [a, c] of boxEdges(b)) seg(a, c, flashing ? '#ef4444' : '#facc15', lw * 1.4);
  const top = P([b.center[0], b.center[1], b.center[2] + b.half[2]]);
  labelAt(top, `건물 ${(b.half[2] * 2).toFixed(2)}m`, lw);

  // Debris after a hit.
  debris = debris.filter(d => now - d.born < 1800);
  const dt = 1 / 60;
  for (const d of debris) {
    d.v[2] -= GRAVITY * dt; d.p = add(d.p, scale(d.v, dt));
    if (d.p[2] < 0) { d.p[2] = 0; d.v = [d.v[0] * 0.5, d.v[1] * 0.5, -d.v[2] * 0.3]; }
    const p = P(d.p); if (!p) continue;
    const r = Math.max(2, d.size * cam.K.fx / Math.max(0.3, depthOf(cam.pose, d.p)));
    sctx.fillStyle = `rgba(250,${150 + Math.round(Math.random() * 60)},21,${1 - (now - d.born) / 1800})`;
    sctx.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
  }

  const fresh = frame && now - frameAt < STALE_MS;
  if (fresh && frame.valid && frame.joints) {
    const J = frame.joints;
    if (frame.anchor_m) dot(frame.anchor_m, '#a855f7', lw * 3);
    for (const [a, c] of JOINT_EDGES) if (J[a] && J[c]) seg(J[a], J[c], 'rgba(255,255,255,.85)', lw * 1.4);
    if (J.nose) dot(J.nose, '#ffffff', lw * 3);
    for (const [name, color] of Object.entries(WRIST_COLORS)) {
      const list = trails[name];
      for (let i = 1; i < list.length; i++) seg(list[i - 1].P, list[i].P, color, lw * (1 + 2 * i / list.length));
      if (!J[name]) continue;
      seg([J[name][0], J[name][1], 0], J[name], color + '88', lw);
      dot([J[name][0], J[name][1], 0], color + '88', lw * 2);
      dot(J[name], color, lw * 4.5);
    }
  }
}
const depthOf = (pose, p) => pose.R[6] * p[0] + pose.R[7] * p[1] + pose.R[8] * p[2] + pose.t[2];
function label(text, x, y, lw, align = 'left') {
  sctx.font = `${Math.round(lw * 9)}px system-ui`; sctx.textAlign = align;
  sctx.fillStyle = '#9aa3ae'; sctx.fillText(text, x, y); sctx.textAlign = 'left';
}
function labelAt(p, text, lw) {
  if (!p) return;
  sctx.font = `${Math.round(lw * 8)}px system-ui`; sctx.lineWidth = 3; sctx.strokeStyle = 'rgba(0,0,0,.8)';
  sctx.strokeText(text, p[0] + lw * 5, p[1] - lw * 3); sctx.fillStyle = '#e5e7eb'; sctx.fillText(text, p[0] + lw * 5, p[1] - lw * 3);
}

// ---------- right: numbers ----------
function renderInfo() {
  const f = frame && performance.now() - frameAt < STALE_MS ? frame : null;
  const fmt = p => p ? p.map(v => v.toFixed(2)).join(', ') : '—';
  const rows = [
    ['폰 위치', calib ? fmt(calib.camera.C) : '—'],
    ['건물', calib ? `중심 ${fmt(calib.building.center.slice(0, 2))} · 높이 ${(calib.building.half[2] * 2).toFixed(2)}m` : '—'],
    ['몸 배율', calib?.body ? `${calib.body.scale.toFixed(3)} (${calib.body.scale_source === 'user_height' ? '입력 키' : '영상'})` : '—'],
    ['기준', f?.valid ? (f.anchor_source === 'floor' ? '발-바닥' : '몸통 길이(덜 정확)') : '—'],
    ['왼손목', f?.valid ? fmt(f.joints?.left_wrist) : '—'],
    ['오른손목', f?.valid ? fmt(f.joints?.right_wrist) : '—'],
  ];
  $('info').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; return [dt, dd];
  }));
}

// ---------- input / sound ----------
let drag = null;
scene.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; scene.setPointerCapture?.(e.pointerId); });
scene.addEventListener('pointermove', e => {
  if (!drag) return;
  view.yaw -= (e.clientX - drag.x) * 0.4;
  view.pitch = Math.max(3, Math.min(85, view.pitch + (e.clientY - drag.y) * 0.3));
  drag = { x: e.clientX, y: e.clientY };
});
scene.addEventListener('pointerup', () => { drag = null; });
scene.addEventListener('pointercancel', () => { drag = null; });
scene.addEventListener('wheel', e => { e.preventDefault(); view.dist = Math.max(1, Math.min(12, view.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
scene.addEventListener('dblclick', resetView);
$('sound').addEventListener('click', () => {
  if (audio) { audio.close(); audio = null; $('sound').textContent = '소리 켜기'; return; }
  try { audio = new AudioContext(); $('sound').textContent = '소리 끄기'; } catch { audio = null; }
});
function beep() {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'square'; o.frequency.value = 180; g.gain.setValueAtTime(0.25, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
  o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.35);
}

function loop(now) {
  try { drawVideo(); drawScene(now); renderInfo(); renderStatus(); }
  catch (error) { $('status').textContent = `오류: ${error.message}`; console.error(error); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__mono3dViewReady = true;
