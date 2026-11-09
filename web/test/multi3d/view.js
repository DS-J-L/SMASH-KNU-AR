// PC viewer for the 3-camera test: each phone's video + the server's triangulated 3D result.
// Nothing is recomputed here except drawing; the server does the fusion and the hit test.
import { add, sub, scale, cross, normalize, project } from '../mono3d/geometry.js?v=20261109-4';
import { createLink, geometryText } from './link.js?v=20261109-6';

const $ = id => document.getElementById(id);
const scene = $('scene'), sctx = scene.getContext('2d');
const CAMERAS = ['C0', 'C1', 'C2'];
const CAM_COLORS = { C0: '#a78bfa', C1: '#34d399', C2: '#f472b6' };
const STALE_MS = 1000, TRAIL_MS = 600, GRAVITY = 9.8;
const LM_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32]];
const JOINT_EDGES = [['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'], ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']];
const WRIST_COLORS = { left_wrist: '#38bdf8', right_wrist: '#f97316' };

const cams = Object.fromEntries(CAMERAS.map(c => [c, { calib: null, K: null, pose: null, frame: null, frameAt: 0, jpeg: null }]));
let fused = null, fusedAt = 0, status = null, linkOpen = false;
let hits = null, hitFlashAt = -1e9, debris = [], trails = { left_wrist: [], right_wrist: [] }, audio = null;

// ---------- camera tiles ----------
for (const c of CAMERAS) {
  const box = document.createElement('div');
  box.className = 'cam';
  box.innerHTML = `<canvas width="360" height="640" aria-label="${c} 영상"></canvas><span class="tag off">${c} 없음</span>`;
  $('camList').append(box);
  cams[c].canvas = box.querySelector('canvas'); cams[c].ctx = cams[c].canvas.getContext('2d'); cams[c].tag = box.querySelector('.tag');
}

// ---------- link ----------
const link = createLink('/ws/test/multi3d', { role: 'viewer' }, s => { linkOpen = s.open; if (s.open) sendConfig(); }, onMessage);
link.setEnabled(true);

function onMessage(m) {
  const cam = cams[m.camera_id];
  if (m.type === 'multi3d_status') status = m;
  else if (m.type === 'multi3d_calib' && cam) {
    const k = m.K;
    cam.calib = m; cam.K = { fx: k.fx, fy: k.fy, cx: k.cx, cy: k.cy };
    cam.pose = { R: m.R, t: m.t, C: m.C };
    if (!cams.C0.calib || m.camera_id === 'C0') resetView();
  } else if (m.type === 'multi3d_frame' && cam) { cam.frame = m; cam.frameAt = performance.now(); }
  else if (m.type === 'multi3d_jpeg' && cam) {
    const img = new Image();
    img.onload = () => { cam.jpeg = img; };
    img.src = m.data;
  } else if (m.type === 'multi3d_phone_left' && cam) { Object.assign(cam, { calib: null, K: null, pose: null, frame: null, jpeg: null }); }
  else if (m.type === 'multi3d_fused') onFused(m);
}

function onFused(m) {
  const now = performance.now();
  fused = m; fusedAt = now;
  for (const [name, list] of Object.entries(trails)) {
    const P = m.joints?.[name]?.p;
    if (P) list.push({ P, t: now });
    while (list.length && now - list[0].t > TRAIL_MS) list.shift();
  }
  const hitNames = Object.keys(m.hit ?? {});
  if (hits !== null && hitNames.length) onHit(hitNames.map(n => m.joints?.[n]?.p).find(Boolean), m.building);
  hits = m.hits; $('hits').textContent = hits;
  if ($('bldAuto').checked && m.building) $('bldH').value = (m.building.half[2] * 2).toFixed(2);
}

function onHit(at, building) {
  hitFlashAt = performance.now();
  const b = $('hits'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  const pop = $('hitPop'); pop.hidden = true; void pop.offsetWidth; pop.hidden = false;
  const { center, half } = building, origin = at ?? center;
  for (let i = 0; i < 40; i++) {
    const p = [center[0] + (Math.random() * 2 - 1) * half[0], center[1] + (Math.random() * 2 - 1) * half[1],
      Math.max(0.02, Math.min(center[2] + half[2], origin[2]) + (Math.random() * 2 - 1) * 0.15)];
    const away = normalize([p[0] - origin[0] + 1e-3, p[1] - origin[1] + 1e-3, 0.2]);
    debris.push({ p, v: add(scale(away, 1 + Math.random() * 2), [0, 0, Math.random() * 2]), born: hitFlashAt, size: 0.02 + Math.random() * 0.04 });
  }
  beep();
}

// ---------- building config (sent to the server, which owns the hit test) ----------
function sendConfig() {
  $('bldH').disabled = $('bldAuto').checked;
  link.send({ type: 'multi3d_config', building: {
    x: Number($('bldX').value), y: Number($('bldY').value), width: Number($('bldW').value), depth: Number($('bldD').value),
    margin: Number($('bldM').value), height: $('bldAuto').checked ? null : Number($('bldH').value) } });
}
$('bld').addEventListener('change', sendConfig);
$('bld').addEventListener('submit', e => e.preventDefault());
$('resetHits').addEventListener('click', () => link.send({ type: 'multi3d_reset_hits' }));

// Fused results carry fresh per-camera fps/person state; status messages only come on (dis)connects.
const liveCameras = () => (fused && performance.now() - fusedAt < STALE_MS ? fused.cameras : status?.cameras);

function renderStatus() {
  const el = $('status');
  let text, ok = false;
  const st = liveCameras() ?? {};
  const calibrated = CAMERAS.filter(c => st[c]?.calibrated);
  if (!linkOpen) text = '서버에 연결 중…';
  else if (!calibrated.length) text = '폰 연결 대기 — 폰에서 C0·C1·C2를 골라 보내기 단계까지 진행하세요';
  else if (calibrated.length < 2) text = `${calibrated.join('')}만 보정됨 — 3D에는 2대 이상 필요`;
  else if (!fused || performance.now() - fusedAt > STALE_MS) text = '보정된 폰의 신호 없음';
  else if (fused.geometry_warnings?.length) text = `⚠ ${geometryText(fused.geometry_warnings).join(' · ')}`;
  else if (fused.standing_in_building) text = '⚠ 건물 자리에 서 있습니다 — 옆으로 비켜 서야 타격을 셉니다';
  else if (!fused.valid) text = `카메라 ${fused.cameras_used.join('+') || '없음'} · 손목이 2대 이상에서 안 보임`;
  else { text = `3D 측정 중 · ${fused.cameras_used.join('+')} · 도착 차 ${fused.spread_ms ?? '?'}ms`; ok = true; }
  el.textContent = text; el.classList.toggle('ok', ok);
}

// ---------- camera tiles: video + 2D skeleton + fused 3D projected back ----------
function drawCam(c) {
  const cam = cams[c], cv = cam.canvas, g = cam.ctx, st = liveCameras()?.[c];
  cam.tag.textContent = `${c} ${!st?.connected ? '없음' : !st.calibrated ? '보정 전' : `${st.fps ?? '?'} fps${st.person ? '' : ' · 사람 없음'}`}`;
  cam.tag.className = `tag ${!st?.connected ? 'off' : st.calibrated && st.person ? 'ok' : 'warn'}`;
  cam.tag.style.borderLeft = `4px solid ${CAM_COLORS[c]}`;
  if (!cam.calib) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); return; }
  const { width: W, height: H } = cam.calib.image;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const lw = Math.max(2, Math.min(W, H) / 220);
  g.setTransform(cam.calib.mirror ? -1 : 1, 0, 0, 1, cam.calib.mirror ? W : 0, 0);
  if (cam.jpeg) g.drawImage(cam.jpeg, 0, 0, W, H); else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  const seg = (a, b, color, w = lw) => {
    const p = project(cam.K, cam.pose, a), q = project(cam.K, cam.pose, b);
    if (!p || !q) return;
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.stroke();
  };
  const s = (cam.calib.marker_side_m ?? 0.2) / 2, m = [[-s, s, 0], [s, s, 0], [s, -s, 0], [-s, -s, 0]];
  m.forEach((p, i) => seg(p, m[(i + 1) % 4], 'rgba(34,197,94,.7)'));
  seg([0, 0, 0], [0.25, 0, 0], '#ef4444', lw * 1.5); seg([0, 0, 0], [0, 0.25, 0], '#22c55e', lw * 1.5);
  if (fused?.building) for (const [a, b] of boxEdges(fused.building)) seg(a, b, performance.now() - hitFlashAt < 300 ? '#ef4444' : '#facc15', lw);
  const lm = cam.frame && performance.now() - cam.frameAt < STALE_MS ? cam.frame.landmarks : null;
  if (lm) {
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = lw;
    for (const [a, b] of LM_EDGES) if (lm[a]?.[2] >= 0.5 && lm[b]?.[2] >= 0.5) {
      g.beginPath(); g.moveTo(lm[a][0] * W, lm[a][1] * H); g.lineTo(lm[b][0] * W, lm[b][1] * H); g.stroke();
    }
  }
  if (fused && performance.now() - fusedAt < STALE_MS) for (const [name, color] of Object.entries(WRIST_COLORS)) {
    const j = fused.joints?.[name];
    if (!j) continue;
    const p = project(cam.K, cam.pose, j.p);
    if (p) { g.strokeStyle = color; g.lineWidth = lw * 1.5; g.beginPath(); g.arc(p[0], p[1], lw * 6, 0, Math.PI * 2); g.stroke(); }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
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
  const v = boxCorners(box);
  return [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].map(f => f.map(i => v[i]));
}

// ---------- 3D view ----------
const view = { yaw: 30, pitch: 28, dist: 4.5, target: [0, 0.2, 0.6] };
function resetView() {
  const C = cams.C0.pose?.C;
  view.yaw = C ? Math.atan2(C[0], C[1]) * 180 / Math.PI + 30 : 30;
  view.pitch = 28; view.dist = 4.5; view.target = [0, 0.2, 0.6];
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
const depthOf = (pose, p) => pose.R[6] * p[0] + pose.R[7] * p[1] + pose.R[8] * p[2] + pose.t[2];

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
  const labelAt = (p, text) => {
    if (!p) return;
    sctx.font = `${Math.round(lw * 8)}px system-ui`; sctx.lineWidth = 3; sctx.strokeStyle = 'rgba(0,0,0,.8)';
    sctx.strokeText(text, p[0] + lw * 5, p[1] - lw * 3); sctx.fillStyle = '#e5e7eb'; sctx.fillText(text, p[0] + lw * 5, p[1] - lw * 3);
  };
  for (let g = -2.5; g <= 2.501; g += 0.5) {
    const major = Math.abs(g) < 1e-6, color = major ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.08)';
    seg([g, -2.5, 0], [g, 2.5, 0], color); seg([-2.5, g, 0], [2.5, g, 0], color);
  }
  seg([0, 0, 0], [0.3, 0, 0], '#ef4444', lw * 1.5); seg([0, 0, 0], [0, 0.3, 0], '#22c55e', lw * 1.5);

  // Phones: position, viewing direction, rays to the fused wrists from the cameras that saw them.
  for (const c of CAMERAS) {
    const pose = cams[c].pose;
    if (!pose) continue;
    const C = pose.C, fwd = [pose.R[6], pose.R[7], pose.R[8]];
    seg([C[0], C[1], 0], C, 'rgba(148,163,184,.4)');
    seg(C, add(C, scale(fwd, 0.45)), CAM_COLORS[c], lw * 1.8);
    dot(C, CAM_COLORS[c], lw * 4.5); labelAt(P(C), `${c} ${C[2].toFixed(2)}m`);
  }
  const fresh = fused && now - fusedAt < STALE_MS;
  if (fresh) for (const name of Object.keys(WRIST_COLORS)) {
    const j = fused.joints?.[name];
    if (j) for (const c of j.cams) if (cams[c].pose) seg(cams[c].pose.C, j.p, `${CAM_COLORS[c]}55`, lw * 0.8);
  }

  const b0 = fused?.building;
  if (b0) {
    const flashing = now - hitFlashAt < 400;
    const shake = flashing ? [(Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, 0] : [0, 0, 0];
    const b = { center: add(b0.center, shake), half: b0.half };
    const faces = boxFaces(b).map(f => ({ f, depth: f.reduce((acc, p) => acc + depthOf(cam.pose, p), 0) / 4 })).sort((a, c) => c.depth - a.depth);
    for (const { f } of faces) {
      const pts = f.map(P);
      if (pts.some(x => !x)) continue;
      sctx.fillStyle = flashing ? 'rgba(239,68,68,.55)' : 'rgba(250,204,21,.22)';
      sctx.beginPath(); pts.forEach((p, i) => i ? sctx.lineTo(...p) : sctx.moveTo(...p)); sctx.closePath(); sctx.fill();
    }
    for (const [a, c] of boxEdges(b)) seg(a, c, flashing ? '#ef4444' : '#facc15', lw * 1.4);
    labelAt(P([b.center[0], b.center[1], b.center[2] + b.half[2]]), `건물 ${(b.half[2] * 2).toFixed(2)}m`);
  }

  debris = debris.filter(d => now - d.born < 1800);
  for (const d of debris) {
    d.v[2] -= GRAVITY / 60; d.p = add(d.p, scale(d.v, 1 / 60));
    if (d.p[2] < 0) { d.p[2] = 0; d.v = [d.v[0] * 0.5, d.v[1] * 0.5, -d.v[2] * 0.3]; }
    const p = P(d.p); if (!p) continue;
    const r = Math.max(2, d.size * cam.K.fx / Math.max(0.3, depthOf(cam.pose, d.p)));
    sctx.fillStyle = `rgba(250,180,21,${1 - (now - d.born) / 1800})`;
    sctx.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
  }

  if (fresh && fused.joints) {
    const J = Object.fromEntries(Object.entries(fused.joints).map(([k, v]) => [k, v?.p]));
    for (const [a, c] of JOINT_EDGES) if (J[a] && J[c]) seg(J[a], J[c], 'rgba(255,255,255,.85)', lw * 1.4);
    if (J.nose) dot(J.nose, '#ffffff', lw * 3);
    for (const [name, color] of Object.entries(WRIST_COLORS)) {
      const list = trails[name];
      for (let i = 1; i < list.length; i++) seg(list[i - 1].P, list[i].P, color, lw * (1 + 2 * i / list.length));
      if (!J[name]) continue;
      seg([J[name][0], J[name][1], 0], J[name], `${color}88`, lw);
      dot(J[name], color, lw * 4.5);
    }
  }
}

function renderInfo() {
  const f = fused && performance.now() - fusedAt < STALE_MS ? fused : null;
  const fmt = p => p ? p.map(v => v.toFixed(2)).join(', ') : '—';
  const why = { insufficient_views: '2대 이상에서 안 보임', reprojection_error: '화면끼리 안 맞음', behind_camera: '계산 실패' };
  const wrist = n => { const j = f?.joints?.[n]; return j ? `${fmt(j.p)}\n${j.cams.join('+')} · 오차 ${j.err_px}px` : (why[f?.reasons?.[n]] ?? '—'); };
  const b = fused?.building;
  const rows = [
    ['합친 카메라', f ? `${f.cameras_used.join('+') || '없음'} · 도착 차 ${f.spread_ms ?? '—'}ms` : '—'],
    ['왼손목', wrist('left_wrist')], ['오른손목', wrist('right_wrist')],
    ['좌우 바꿈', f?.swapped_left_right?.length ? `${f.swapped_left_right.join(', ')} (뒷모습 등으로 왼/오른쪽이 반대)` : '없음'],
    ['추정 키', b?.estimated_height_m ? `${(b.estimated_height_m * 100).toFixed(0)} cm` : '측정 중(서 있으면 자동)'],
    ['건물', b ? `높이 ${(b.half[2] * 2).toFixed(2)}m${b.auto_height ? ' (허리 자동)' : ''}` : '—'],
    ...CAMERAS.filter(c => cams[c].pose).map(c => [`${c} 위치`, fmt(cams[c].pose.C)]),
  ];
  $('info').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; dd.style.whiteSpace = 'pre-line'; return [dt, dd];
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
  try { CAMERAS.forEach(drawCam); drawScene(now); renderInfo(); renderStatus(); }
  catch (error) { $('status').textContent = `오류: ${error.message}`; console.error(error); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__multi3dViewReady = true;
