// 3-camera 3D test: phone page (one of C0/C1/C2). Same flow as /test/mono3d/ without the body step:
// marker calibration on this phone, then 2D landmarks + calibration go to the server, which
// triangulates all phones together. The fused 3D result comes back and is drawn on this view.
// All maths run on the RAW (un-mirrored) frame; mirroring only flips what is drawn.
import { createPoseLandmarker } from '/camera/pose.js';
import { calibrateMarker, cameraHeightRange, fovForCameraHeight, markerCorners, orderMarkerCorners, project } from '../mono3d/geometry.js?v=20261109-4';
import { orientMarkerCorners, graySampler } from './aruco.js?v=20261109-6';
import { createLink, geometryText } from './link.js?v=20261109-6';

const $ = id => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d'), sheet = $('sheet');
const video = document.createElement('video');
video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');

const STEPS = ['camera', 'place', 'corners', 'send'];
const STORE_KEY = 'multi3d-test-calibration-v1';
const DEFAULT_FOV = 80;
const CORNER_NAMES = ['첫 번째', '두 번째', '세 번째', '마지막'];
const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
const FRAME_MS = 33, JPEG_MS = 250, JPEG_WIDTH = 360, FUSED_STALE_MS = 600;
const WRIST_COLORS = { left_wrist: '#38bdf8', right_wrist: '#f97316' };

let step = 'camera', facing = 'environment', slot = 'C0';
let stream = null, landmarker = null, landmarkerModel = null, lastTs = -1, wakeLock = null, audio = null;
let frozen = null, frozenGray = null, corners = [], dragPoint = null, calib = null;
let latest = null, frames = 0, lastFpsAt = performance.now(), fps = 0, sizeWarned = false;
let link = null, linkState = {}, lastCalibSent = null, lastFrameAt = 0, lastJpegAt = 0;
let fused = null, fusedAt = 0, lastHits = 0, hitFlashAt = -1e9;
const jpegCanvas = document.createElement('canvas');

const num = id => Number($(id).value);
const fmt = p => p ? `(${p.map(v => v.toFixed(2)).join(', ')})` : '—';
const mirrored = () => $('mirror').checked;
const storeKey = () => `${STORE_KEY}:${slot}:${facing}`;
function load() { try { return JSON.parse(localStorage.getItem(storeKey())); } catch { return null; } }
function save(value) { try { value ? localStorage.setItem(storeKey(), JSON.stringify(value)) : localStorage.removeItem(storeKey()); } catch { /* blocked storage */ } }
function banner(text) { $('banner').textContent = text || ''; $('banner').hidden = !text; }

// ---------- step flow ----------
function setStep(next) {
  step = next;
  const index = STEPS.indexOf(step);
  document.querySelectorAll('#steps li').forEach((li, i) => { li.className = i < index ? 'done' : i === index ? 'now' : ''; });
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== step; });
  $('back').disabled = index === 0;
  $('hud').hidden = step !== 'send';
  sheet.classList.remove('collapsed', 'hidden');
  sheet.classList.toggle('at-top', step === 'corners' && !!frozen);
  view.classList.toggle('tapping', step === 'corners' && !!frozen);
  if (frozen) { view.width = frozen.width; view.height = frozen.height; }
  updateFit();
  if (step === 'place') showSaved();
  if (step === 'send') { $('slotLabel').textContent = slot; connect(); }
}
function goBack() {
  if (step === 'corners' && frozen) { frozen = null; corners = []; }
  const index = STEPS.indexOf(step);
  if (index > 0) setStep(STEPS[index - 1] === 'corners' ? 'place' : STEPS[index - 1]);
}

// ---------- camera ----------
function pick(selector, attr, value) {
  document.querySelectorAll(selector).forEach(b => { const on = b.dataset[attr] === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}
function selectFacing(value) { facing = value; pick('.faceBtn', 'facing', value); $('mirror').checked = value === 'user'; }
function selectSlot(value) {
  slot = value; pick('.slotBtn', 'slot', value);
  try { localStorage.setItem('multi3d:slot', value); } catch { /* blocked storage */ }
  if (link) { link.setEnabled(false); link = null; }
}
async function openStream() {
  const [w, h] = $('resolution').value.split('x').map(Number);
  const size = { width: { ideal: w }, height: { ideal: h } };
  try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...size, facingMode: { exact: facing } } }); }
  catch { return navigator.mediaDevices.getUserMedia({ audio: false, video: { ...size, facingMode: { ideal: facing } } }); }
}
async function startCamera() {
  unlockAudio();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { banner('HTTPS 또는 localhost로 접속해야 카메라를 쓸 수 있습니다.'); return; }
  $('start').disabled = true; $('start').textContent = '카메라 여는 중…';
  stream?.getTracks().forEach(t => t.stop());
  try { stream = await openStream(); }
  catch (error) { banner(`카메라를 열 수 없습니다: ${error.message}`); $('start').disabled = false; $('start').textContent = '카메라 켜기'; return; }
  video.srcObject = stream; await video.play();
  calib = null; corners = []; frozen = null;
  if (!wakeLock) keepAwake();
  if (!landmarker || landmarkerModel !== $('model').value) {
    $('start').textContent = '자세 인식 모델 불러오는 중…';
    try { landmarker?.close(); landmarker = (await createPoseLandmarker($('model').value)).landmarker; landmarkerModel = $('model').value; }
    catch (error) { banner(`MediaPipe를 불러오지 못했습니다: ${error.message}`); }
  }
  $('start').disabled = false; $('start').textContent = '카메라 다시 켜기';
  banner('');
  setStep('place');
}

// ---------- marker calibration ----------
function showSaved() {
  const s = load(), fits = s && s.width === video.videoWidth && s.height === video.videoHeight;
  $('useSaved').hidden = !fits;
  $('savedCalib').hidden = !s;
  $('savedCalib').textContent = !s ? '' : fits ? `${slot}로 저장된 보정이 있습니다(높이 ${s.cameraHeight} m). 폰과 마커가 그때 그 자리라면 그대로 쓸 수 있습니다.`
    : `저장된 보정(${s.width}×${s.height})은 지금 영상(${video.videoWidth}×${video.videoHeight})과 달라 쓸 수 없습니다.`;
}
function useSaved() {
  const s = load();
  if (!s) return;
  $('markerCm').value = s.markerCm; $('fov').value = s.fov; $('cameraHeight').value = s.cameraHeight; $('autoFov').checked = s.autoFov;
  corners = s.corners;                     // already in marker order (read from the pattern when saved)
  if (solve(s.width, s.height)) setStep('send');
  else { setStep('corners'); $('tapPrompt').hidden = true; $('cornerDone').hidden = false; }
}

// Tapped corners (any order) → marker order read from the ArUco pattern → camera pose.
function calibrateFromTaps(W, H) {
  const ring = orderMarkerCorners(corners);
  const oriented = frozenGray ? orientMarkerCorners(frozenGray, ring) : null;
  if (!oriented) {
    calib = null;
    $('calibOut').textContent = '마커 무늬를 읽지 못했습니다. 세 폰이 같은 방향 기준을 쓰려면 무늬가 필요합니다.\n'
      + '· 모서리를 검은 사각형의 바깥 모서리에 정확히 찍었는지\n· 마커가 너무 작거나 흐리거나 반사되지 않는지\n· 인쇄한 마커가 ArUco 4x4 ID0인지 확인하세요.';
    $('toSend').disabled = true;
    return false;
  }
  corners = oriented.corners;
  return solve(W, H, oriented.errors);
}
function solve(W, H, bitErrors = 0) {
  const side = num('markerCm') / 100;
  calib = null;
  let warning = '';
  if ($('autoFov').checked) {
    const fov = fovForCameraHeight(W, H, corners, side, num('cameraHeight'));
    if (fov !== null) $('fov').value = fov.toFixed(1);
    else {
      const range = cameraHeightRange(W, H, corners, side);
      $('fov').value = DEFAULT_FOV;
      warning = `⚠ 폰 높이 ${num('cameraHeight').toFixed(2)} m로는 화각을 맞출 수 없어 기본 ${DEFAULT_FOV}°로 계산했습니다.`
        + (range ? ` 이 모서리로 가능한 높이 ${range.min.toFixed(2)}~${range.max.toFixed(2)} m.` : '') + ' 높이·마커 크기·모서리를 확인하세요.';
    }
  }
  const r = calibrateMarker(W, H, corners, side, num('fov'));
  if (!r.ok) {
    $('calibOut').textContent = r.reason === 'camera_below_floor_check_corner_order'
      ? '계산 결과 카메라가 바닥 아래로 나왔습니다. 모서리를 다시 찍어 보세요.' : `보정 실패: ${r.reason}`;
    $('toSend').disabled = true; return false;
  }
  calib = { ...r, width: W, height: H, corners: corners.map(p => [...p]), side };
  save({ width: W, height: H, corners: calib.corners, markerCm: num('markerCm'), fov: num('fov'), cameraHeight: num('cameraHeight'), autoFov: $('autoFov').checked });
  $('calibOut').textContent = [
    `${slot} 위치 ${fmt(r.pose.C)} m (마커 중심 기준)`,
    `높이 ${r.camera_height_m.toFixed(2)} m · 아래로 ${r.tilt_down_deg.toFixed(1)}° · 화각 ${num('fov').toFixed(1)}°`,
    `모서리 오차 ${r.reprojection_max_px.toFixed(1)} px · 마커 무늬 ${bitErrors ? `${bitErrors}칸 불일치(허용)` : '일치'}`,
    r.reprojection_max_px > 8 ? '⚠ 모서리 오차가 큽니다. 확대경으로 더 정확히 찍어 보세요.' : '',
    warning,
  ].filter(Boolean).join('\n');
  $('toSend').disabled = false;
  lastCalibSent = null;
  return true;
}

function beginTapping() {
  if (!video.videoWidth) return;
  frozen = document.createElement('canvas');
  frozen.width = video.videoWidth; frozen.height = video.videoHeight;
  frozen.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0);
  frozenGray = graySampler(frozen);
  corners = []; calib = null;
  $('tapPrompt').hidden = false; $('cornerDone').hidden = true;
  setStep('corners'); updateCornerPrompt();
}
function updateCornerPrompt() {
  const n = corners.length;
  $('cornerNo').textContent = `${Math.min(n + 1, 4)}/4`; $('cornerName').textContent = CORNER_NAMES[Math.min(n, 3)];
  for (let i = 0; i < 4; i++) $(`c${i}`).setAttribute('class', i < n ? 'done' : i === n ? 'now' : '');
  $('undoCorner').disabled = n === 0;
}
function finishTapping() {
  const W = frozen.width, H = frozen.height;
  frozen = null;
  const ok = calibrateFromTaps(W, H);
  frozenGray = null;
  $('tapPrompt').hidden = true; $('cornerDone').hidden = false;
  setStep('corners');
  beep(ok ? 880 : 220);
}

function updateFit() {
  const r = view.getBoundingClientRect(), cover = Math.max(r.width / view.width, r.height / view.height);
  const kept = Math.min(r.width / (view.width * cover), r.height / (view.height * cover));
  view.classList.toggle('contain', step === 'corners' && !!frozen || kept < 0.65);
}
function coverScale() {
  const r = view.getBoundingClientRect(), fit = view.classList.contains('contain') ? Math.min : Math.max;
  const k = fit(r.width / view.width, r.height / view.height);
  return { r, k, ox: (r.width - view.width * k) / 2, oy: (r.height - view.height * k) / 2 };
}
function toPixel(point) {
  const { r, k, ox, oy } = coverScale();
  const x = (point.clientX - r.left - ox) / k, y = (point.clientY - r.top - oy) / k;
  return [mirrored() ? view.width - x : x, y];
}
const tappingNow = () => step === 'corners' && frozen && corners.length < 4;
const insideFrame = ([x, y]) => x >= 0 && y >= 0 && x <= view.width && y <= view.height;
function tapStart(point) { if (tappingNow()) { dragPoint = toPixel(point); banner(''); } }
function tapMove(point) { if (tappingNow() && dragPoint) dragPoint = toPixel(point); }
function tapEnd(point) {
  if (!tappingNow() || !dragPoint) return;
  const p = point ? toPixel(point) : dragPoint;
  dragPoint = null;
  if (!insideFrame(p)) { banner('영상 바깥을 눌렀습니다. 마커 모서리를 다시 누르세요.'); return; }
  corners.push(p); beep(660, 0.05);
  if (corners.length === 4) finishTapping(); else updateCornerPrompt();
}
const firstTouch = e => e.changedTouches?.[0] ?? e.touches?.[0];
view.addEventListener('touchstart', e => { if (!tappingNow()) return; e.preventDefault(); tapStart(firstTouch(e)); }, { passive: false });
view.addEventListener('touchmove', e => { if (!tappingNow()) return; e.preventDefault(); tapMove(firstTouch(e)); }, { passive: false });
view.addEventListener('touchend', e => { if (!tappingNow()) return; e.preventDefault(); tapEnd(firstTouch(e)); }, { passive: false });
view.addEventListener('touchcancel', () => { if (dragPoint) { dragPoint = null; banner('터치가 취소되었습니다. 모서리를 다시 누르세요.'); } });
view.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || !tappingNow()) return;
  e.preventDefault(); try { view.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
  tapStart(e);
});
view.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') tapMove(e); });
view.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') tapEnd(e); });
view.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') dragPoint = null; });

// ---------- server link ----------
function connect() {
  if (!link) {
    link = createLink('/ws/test/multi3d', { role: 'phone', camera: slot }, s => { linkState = s; renderLink(); }, onMessage);
    lastCalibSent = null;
  }
  link.setEnabled(true);
}
function onMessage(m) {
  if (m.type === 'link_open') lastCalibSent = null;
  if (m.type === 'multi3d_fused') {
    fused = m; fusedAt = performance.now();
    if (m.hits > lastHits || Object.keys(m.hit ?? {}).length) { hitFlashAt = fusedAt; beep(1200, 0.08); }
    lastHits = m.hits; $('hits').textContent = m.hits;
    if (m.cameras) { linkState = { ...linkState, cameras: m.cameras }; renderLink(); }
  }
}
function renderLink() {
  const s = linkState;
  $('linkStatus').textContent = s.error === 'access_key_required' ? '접속 키가 필요합니다(주소에 ?key=)'
    : s.error === 'superseded' ? `다른 폰이 ${slot}로 연결해서 끊겼습니다. 번호를 확인하세요.`
    : !s.open ? '서버에 연결 중…' : `✓ 서버 연결됨 · PC 화면 ${s.viewers ?? 0}개`;
  $('linkStatus').parentElement.classList.toggle('ready', !!s.open);
  const cams = s.cameras ?? {};
  $('cams').replaceChildren(...['C0', 'C1', 'C2'].map(c => {
    const st = cams[c], el = document.createElement('span');
    el.textContent = `${c} ${!st?.connected ? '없음' : !st.calibrated ? '보정 전' : st.person ? '사람 보임' : '사람 없음'}`;
    el.className = `${st?.calibrated && st.person ? 'ok' : st?.connected ? 'warn' : ''}${c === slot ? ' me' : ''}`;
    return el;
  }));
}
function send() {
  if (step !== 'send' || !calib?.K || !link?.open) return;
  const calibMsg = { type: 'multi3d_calib', schema: 'multi3d_live.v1', facing, mirror: mirrored(),
    image: { width: calib.width, height: calib.height },
    K: { fx: calib.K.fx, fy: calib.K.fy, cx: calib.K.cx, cy: calib.K.cy }, R: calib.pose.R, t: calib.pose.t, C: calib.pose.C,
    marker_side_m: calib.side, camera_height_m: calib.camera_height_m, fov_diag_deg: num('fov') };
  const key = JSON.stringify(calibMsg);
  if (key !== lastCalibSent && link.send(calibMsg)) lastCalibSent = key;
  const now = performance.now();
  if (now - lastFrameAt >= FRAME_MS) {
    const lm = latest?.landmarks;
    if (link.send({ type: 'multi3d_frame', fps: +fps.toFixed(1),
      landmarks: lm ? lm.map(l => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) : null })) lastFrameAt = now;
  }
  if (now - lastJpegAt >= JPEG_MS && video.videoWidth) {
    const k = JPEG_WIDTH / video.videoWidth;
    jpegCanvas.width = JPEG_WIDTH; jpegCanvas.height = Math.round(video.videoHeight * k);
    jpegCanvas.getContext('2d').drawImage(video, 0, 0, jpegCanvas.width, jpegCanvas.height);
    if (link.send({ type: 'multi3d_jpeg', data: jpegCanvas.toDataURL('image/jpeg', 0.6) })) lastJpegAt = now;
  }
}

// ---------- per frame ----------
function infer() {
  if (!landmarker || !video.videoWidth || video.readyState < 2) return;
  const ts = Math.max(lastTs + 1, performance.now());
  lastTs = ts;
  const out = landmarker.detectForVideo(video, ts);
  latest = { landmarks: out.landmarks?.[0] ?? null, t: ts };
  frames++;
  if (ts - lastFpsAt > 1000) { fps = frames * 1000 / (ts - lastFpsAt); frames = 0; lastFpsAt = ts; }
}
function update() {
  if (!calib?.K) return;
  const sizeChanged = calib.width !== video.videoWidth || calib.height !== video.videoHeight;
  if (sizeChanged !== sizeWarned) { sizeWarned = sizeChanged; banner(sizeChanged ? '화면 방향이나 해상도가 바뀌었습니다. 폰 방향을 되돌리거나 마커 보정을 다시 하세요.' : ''); }
  if (!sizeChanged) send();
}

// ---------- drawing ----------
function draw() {
  const src = frozen ?? video, W = frozen ? frozen.width : video.videoWidth, H = frozen ? frozen.height : video.videoHeight;
  if (!W) return;
  if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
  updateFit();
  const lw = Math.max(2, Math.min(W, H) / 250);
  ctx.setTransform(mirrored() ? -1 : 1, 0, 0, 1, mirrored() ? W : 0, 0);
  ctx.drawImage(src, 0, 0, W, H);
  if (frozen) drawTapping(W, H, lw);
  else {
    if (calib?.K && step !== 'place') drawCalibration(lw);
    drawSkeleton(W, H, lw);
    drawFused(lw);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  renderText();
}
const screenX = x => mirrored() ? view.width - x : x;
function label(text, x, y, lw) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 ${Math.round(lw * 7)}px system-ui`; ctx.lineWidth = lw * 1.5; ctx.strokeStyle = '#000';
  ctx.strokeText(text, screenX(x), y); ctx.fillStyle = '#fff'; ctx.fillText(text, screenX(x), y); ctx.restore();
}
function dot(p, color, r) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); }
function drawTapping(W, H, lw) {
  const pts = dragPoint ? [...corners, dragPoint] : corners;
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = lw; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
  if (pts.length === 4) ctx.closePath();
  ctx.stroke();
  pts.forEach((p, i) => { dot(p, i < corners.length ? '#22c55e' : '#f59e0b', lw * 2.5); label(String(i + 1), p[0] + lw * 4, p[1] - lw * 4, lw); });
  if (!dragPoint) return;
  const { r, k } = coverScale(), visW = r.width / k, visH = r.height / k, x0 = (W - visW) / 2, y0 = (H - visH) / 2;
  const size = Math.min(visW, visH) * 0.4, zoom = 4, srcSize = size / zoom, fingerX = screenX(dragPoint[0]);
  const x = fingerX < W / 2 ? x0 + visW - size - 12 / k : x0 + 12 / k;
  const y = dragPoint[1] - y0 < visH / 2 ? y0 + visH - size - 200 / k : y0 + 70 / k;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.translate(x + (mirrored() ? size : 0), y); ctx.scale(mirrored() ? -1 : 1, 1);
  ctx.drawImage(frozen, dragPoint[0] - srcSize / 2, dragPoint[1] - srcSize / 2, srcSize, srcSize, 0, 0, size, size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.strokeRect(x, y, size, size);
  ctx.strokeStyle = '#ef4444'; ctx.beginPath();
  ctx.moveTo(x + size / 2, y); ctx.lineTo(x + size / 2, y + size); ctx.moveTo(x, y + size / 2); ctx.lineTo(x + size, y + size / 2); ctx.stroke();
  ctx.restore();
}
function line3(a, b, color, lw) {
  const p = project(calib.K, calib.pose, a), q = project(calib.K, calib.pose, b);
  if (!p || !q) return;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
}
function drawCalibration(lw) {
  const c = markerCorners(calib.side).map(([x, y]) => [x, y, 0]);
  c.forEach((p, i) => line3(p, c[(i + 1) % 4], '#22c55e', lw * 1.5));
  line3([0, 0, 0], [0.25, 0, 0], '#ef4444', lw * 2);
  line3([0, 0, 0], [0, 0.25, 0], '#22c55e', lw * 2);
  line3([0, 0, 0], [0, 0, 0.25], '#3b82f6', lw * 2);
  const b = fused?.building;
  if (step !== 'send' || !b) return;
  const [hx, hy, hz] = b.half, [cx, cy, cz] = b.center, hit = performance.now() - hitFlashAt < 300;
  const v = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [cx + x * hx, cy + y * hy, cz + z * hz])));
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    if ([0, 1, 2].filter(k => v[i][k] !== v[j][k]).length === 1) line3(v[i], v[j], hit ? '#ef4444' : '#facc15', lw * 1.2);
  }
}
function drawSkeleton(W, H, lw) {
  const lm = latest?.landmarks;
  if (!lm || step !== 'send') return;
  const ok = i => lm[i]?.visibility >= 0.5;
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = lw;
  for (const [a, b] of SKELETON) if (ok(a) && ok(b)) {
    ctx.beginPath(); ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke();
  }
}
// Server's fused 3D wrists projected into THIS camera: if they sit on the 2D wrists, the views agree.
function drawFused(lw) {
  if (!fused || performance.now() - fusedAt > FUSED_STALE_MS) return;
  for (const [name, color] of Object.entries(WRIST_COLORS)) {
    const j = fused.joints?.[name];
    if (!j) continue;
    const P = j.p, floor = [P[0], P[1], 0];
    line3(floor, P, color, lw);
    const p = project(calib.K, calib.pose, P);
    if (p) { ctx.strokeStyle = color; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], lw * 6, 0, Math.PI * 2); ctx.stroke();
      label(`${name === 'left_wrist' ? 'L' : 'R'} ${P[2].toFixed(2)}m · ${j.cams.length}대`, p[0] + lw * 7, p[1], lw); }
  }
}
function renderText() {
  if (step !== 'send') return;
  const f = fused && performance.now() - fusedAt < FUSED_STALE_MS ? fused : null;
  const why = { insufficient_views: '2대 이상에서 안 보임', reprojection_error: '화면끼리 안 맞음', behind_camera: '계산 실패' };
  const line = (label, n) => {
    const j = f?.joints?.[n];
    return `${label} ${j ? `${fmt(j.p)} · ${j.cams.join('+')} · 오차 ${j.err_px}px` : `— ${why[f?.reasons?.[n]] ?? ''}`}`;
  };
  $('result').textContent = !f ? '서버 결과 대기' : [
    `합친 카메라 ${f.cameras_used.join('+') || '없음'}${f.spread_ms != null ? ` · 도착 차 ${f.spread_ms}ms` : ''}`,
    line('왼손목', 'left_wrist'), line('오른손목', 'right_wrist'), `${slot} ${fps.toFixed(0)} fps`,
    ...geometryText(f.geometry_warnings).map(t => `⚠ ${t}`),
    f.standing_in_building ? '⚠ 건물 자리에 서 있음 — 옆으로 비켜 서세요' : '',
  ].filter(Boolean).join('\n');
}

// ---------- sound / misc ----------
function unlockAudio() { try { audio ??= new AudioContext(); audio.resume?.(); } catch { audio = null; } }
function beep(freq = 660, seconds = 0.12) {
  if (!audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.frequency.value = freq; g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + seconds);
  } catch { /* sound is optional */ }
}
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); wakeLock?.addEventListener('release', () => { wakeLock = null; }); } catch { /* optional */ }
}
function loop() {
  try { if (!frozen) { infer(); update(); } draw(); }
  catch (error) { banner(`오류: ${error.message}`); console.error(error); }
  requestAnimationFrame(loop);
}

// ---------- wiring ----------
document.querySelectorAll('.faceBtn').forEach(b => b.addEventListener('click', () => { selectFacing(b.dataset.facing); if (stream) startCamera(); }));
document.querySelectorAll('.slotBtn').forEach(b => b.addEventListener('click', () => selectSlot(b.dataset.slot)));
$('start').addEventListener('click', startCamera);
$('back').addEventListener('click', goBack);
$('settingsBtn').addEventListener('click', () => $('settings').showModal());
$('sheetHandle').addEventListener('click', () => sheet.classList.toggle('collapsed'));
$('tapCorners').addEventListener('click', () => { unlockAudio(); beginTapping(); });
$('useSaved').addEventListener('click', useSaved);
$('undoCorner').addEventListener('click', () => { corners.pop(); updateCornerPrompt(); });
$('cancelCorners').addEventListener('click', () => { frozen = null; corners = []; setStep('place'); });
$('retryCorners').addEventListener('click', beginTapping);
$('toSend').addEventListener('click', () => { setStep('send'); sheet.classList.add('collapsed'); });
$('redoCorners').addEventListener('click', () => setStep('place'));
for (const id of ['fov', 'autoFov', 'cameraHeight', 'markerCm']) $(id).addEventListener('change', () => {
  if (calib && corners.length === 4) solve(calib.width, calib.height);
});
$('clearAll').addEventListener('click', () => { save(null); calib = null; corners = []; frozen = null; $('settings').close(); setStep(stream ? 'place' : 'camera'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stream && !wakeLock) keepAwake(); });
let savedSlot = null;
try { savedSlot = localStorage.getItem('multi3d:slot'); } catch { /* blocked storage */ }
const askedSlot = new URLSearchParams(location.search).get('camera');
selectSlot(['C0', 'C1', 'C2'].find(c => c === askedSlot || (!askedSlot && c === savedSlot)) ?? 'C0');
selectFacing('environment');
setStep('camera');
requestAnimationFrame(loop);
window.__multi3dReady = true;
