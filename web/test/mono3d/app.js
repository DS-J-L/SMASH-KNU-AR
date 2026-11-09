// Single-camera approximate 3D test page. In the measure step it streams results to the PC viewer (test relay).
// UI: full-screen camera + a step sheet (camera → place → corners → body → measure).
// All maths run on the RAW (un-mirrored) frame; mirroring only flips what is drawn.
import { createPoseLandmarker } from '/camera/pose.js';
import { calibrateMarker, cameraHeightRange, fovForCameraHeight, markerCorners, orderMarkerCorners, project, transposeMul } from './geometry.js?v=20261109-4';
import { measureBody, finalizeBody, estimate, insideBox, segmentHitsBox, buildingBox, waistHeightM } from './mono3d.js?v=20261109-4';
import { createLink } from './link.js?v=20261109-4';

const $ = id => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d'), topView = $('top'), topCtx = topView.getContext('2d');
const sheet = $('sheet');
const video = document.createElement('video');
video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');

const STEPS = ['camera', 'place', 'corners', 'body', 'measure'];
const STORE_KEY = 'mono3d-test-calibration-v2';
const DEFAULT_FOV = 80;               // typical phone main camera, diagonal
const CORNER_NAMES = ['첫 번째', '두 번째', '세 번째', '마지막'];
const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];

let step = 'camera', facing = 'environment';
let stream = null, landmarker = null, landmarkerModel = null, lastTs = -1, wakeLock = null, audio = null;
let frozen = null, corners = [], dragPoint = null;
let calib = null, body = null, bodySamples = null, bodyStart = 0, countdownTimer = null, lastSampleT = null;
const BODY_REASONS = { no_person: '사람이 안 보임', feet_not_visible: '발이 화면에 안 나옴(발끝까지 보이게)',
  head_not_visible: '머리가 화면에 안 나옴(머리까지 보이게)', not_upright: '똑바로 서 있지 않음', nose_ray_failed: '계산 실패' };
let latest = null, result = null, hits = 0, wasInside = { left_wrist: false, right_wrist: false }, lastHitAt = -1e9;
let prevWrist = { left_wrist: null, right_wrist: null };
const SWING_MAX_GAP_MS = 250, SWING_MAX_JUMP_M = 1.5;   // longer gaps/jumps are tracking glitches, not swings
let recording = null, lastRecording = null, frames = 0, lastFpsAt = performance.now(), fps = 0, sizeWarned = false;

const num = id => Number($(id).value);
const fmt = p => p ? `(${p.map(v => v.toFixed(2)).join(', ')})` : '—';
const mirrored = () => $('mirror').checked;
const userHeightM = () => num('heightCm') > 0 ? num('heightCm') / 100 : null;
// The building stands on the floor at the marker (by default) and is waist high.
const buildingHeight = () => $('bldAutoH').checked ? waistHeightM(body, userHeightM()) : num('bldH');
const box = () => buildingBox(num('bldX'), num('bldY'), num('bldW'), num('bldD'), buildingHeight());
function syncBuildingHeight() {
  $('bldH').disabled = $('bldAutoH').checked;
  if ($('bldAutoH').checked) $('bldH').value = buildingHeight().toFixed(2);
}
const storeKey = () => `${STORE_KEY}:${facing}`;
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
  $('hud').hidden = step !== 'measure';
  sheet.classList.remove('collapsed', 'hidden');
  sheet.classList.toggle('at-top', step === 'corners' && !!frozen);
  view.classList.toggle('tapping', step === 'corners' && !!frozen);
  if (frozen) { view.width = frozen.width; view.height = frozen.height; }
  updateFit();                              // apply the tapping fit before the first touch
  if (step === 'place') showSaved();
  if (step === 'measure') sheet.classList.add('collapsed');
}
function goBack() {
  if (bodySamples || countdownTimer) cancelBody();
  if (step === 'corners' && frozen) { frozen = null; corners = []; }
  const index = STEPS.indexOf(step);
  if (index > 0) setStep(STEPS[index - 1] === 'corners' ? 'place' : STEPS[index - 1]);
}

// ---------- camera ----------
function selectFacing(value) {
  facing = value;
  document.querySelectorAll('.segBtn').forEach(b => { const on = b.dataset.facing === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('mirror').checked = value === 'user';
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
  calib = null; body = null; corners = []; frozen = null;
  if (!wakeLock) keepAwake();
  if (!landmarker || landmarkerModel !== $('model').value) {
    $('start').textContent = '자세 인식 모델 불러오는 중…';
    try {
      landmarker?.close();
      landmarker = (await createPoseLandmarker($('model').value)).landmarker; landmarkerModel = $('model').value;
    } catch (error) { banner(`MediaPipe를 불러오지 못했습니다: ${error.message}`); }
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
  $('savedCalib').textContent = !s ? '' : fits ? `이 카메라로 저장된 보정이 있습니다(높이 ${s.cameraHeight} m). 폰을 그때와 같은 자리에 두었다면 그대로 쓸 수 있습니다.`
    : `저장된 보정(${s.width}×${s.height})은 지금 영상(${video.videoWidth}×${video.videoHeight})과 달라 쓸 수 없습니다.`;
}
function useSaved() {
  const s = load();
  if (!s) return;
  $('markerCm').value = s.markerCm; $('fov').value = s.fov; $('cameraHeight').value = s.cameraHeight; $('autoFov').checked = s.autoFov;
  corners = s.corners; calibrate(s.width, s.height);
  if (calib) { setStep('body'); resetBodyPanel(); }
}

function calibrate(W, H) {
  corners = orderMarkerCorners(corners);     // tap order and mirrored display do not matter
  const side = num('markerCm') / 100;
  calib = null;
  let warning = '';
  if ($('autoFov').checked) {
    const fov = fovForCameraHeight(W, H, corners, side, num('cameraHeight'));
    if (fov !== null) $('fov').value = fov.toFixed(1);
    else {
      // Keep going with a typical phone FOV, and say which heights these corners could explain.
      const range = cameraHeightRange(W, H, corners, side);
      $('fov').value = DEFAULT_FOV;
      warning = [
        `⚠ 입력한 폰 높이 ${num('cameraHeight').toFixed(2)} m로는 화각을 맞출 수 없어 기본 화각 ${DEFAULT_FOV}°로 계산했습니다.`,
        range ? `   이 모서리로 나올 수 있는 높이: ${range.min.toFixed(2)}~${range.max.toFixed(2)} m` : '',
        '   확인할 것: ① 폰 높이(바닥~렌즈)를 다시 재기 ② 마커 검은 사각형이 정말 20cm인지 재기(인쇄 축소 여부) ③ 모서리를 정확히 찍었는지.',
      ].filter(Boolean).join('\n');
    }
  }
  const r = calibrateMarker(W, H, corners, side, num('fov'));
  if (!r.ok) {
    $('calibOut').textContent = r.reason === 'camera_below_floor_check_corner_order'
      ? '계산 결과 카메라가 바닥 아래로 나왔습니다. 모서리를 순서대로(먼 왼쪽부터 시계 방향) 찍었는지 확인하세요.' : `보정 실패: ${r.reason}`;
    $('toBody').disabled = true; return;
  }
  calib = { ...r, width: W, height: H, corners: corners.map(p => [...p]), side };
  save({ width: W, height: H, corners: calib.corners, markerCm: num('markerCm'), fov: num('fov'), cameraHeight: num('cameraHeight'), autoFov: $('autoFov').checked });
  $('calibOut').textContent = [
    `카메라 위치 ${fmt(r.pose.C)} m (마커 중심 기준)`,
    `높이 ${r.camera_height_m.toFixed(2)} m · 아래로 ${r.tilt_down_deg.toFixed(1)}° 기울어짐`,
    `화각 ${num('fov').toFixed(1)}°${$('autoFov').checked && !warning ? ' (높이로 계산)' : ''} · 모서리 오차 ${r.reprojection_max_px.toFixed(1)} px`,
    r.reprojection_max_px > 8 ? '⚠ 모서리 오차가 큽니다. 확대경으로 모서리를 더 정확히 찍어 보세요.' : '',
    warning,
  ].filter(Boolean).join('\n');
  $('toBody').disabled = false;
  body = null;
}

function beginTapping() {
  if (!video.videoWidth) return;
  frozen = document.createElement('canvas');
  frozen.width = video.videoWidth; frozen.height = video.videoHeight;
  frozen.getContext('2d').drawImage(video, 0, 0);
  corners = []; calib = null; body = null;
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
  calibrate(W, H);
  $('tapPrompt').hidden = true; $('cornerDone').hidden = false;
  setStep('corners');                      // re-layout: sheet back to the bottom, live video
  beep(calib ? 880 : 220);
}

// The camera fills the screen (cover) unless that would crop too much (e.g. portrait video on a
// landscape screen) or corners are being tapped: then the whole frame is shown (contain).
function updateFit() {
  const r = view.getBoundingClientRect(), cover = Math.max(r.width / view.width, r.height / view.height);
  const kept = Math.min(r.width / (view.width * cover), r.height / (view.height * cover));
  view.classList.toggle('contain', step === 'corners' && !!frozen || kept < 0.65);
}
// Screen point → raw frame pixel, for the current fit, possibly mirrored.
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

// Touch is handled with touch events (preventDefault stops browser gestures, which on some phone
// browsers cancel pointer events); mouse/pen use pointer events. Both feed the same three steps.
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

// ---------- body calibration ----------
function resetBodyPanel() { $('bodyOut').hidden = true; $('toMeasure').hidden = true; $('calibBody').hidden = false; $('calibBody').textContent = '시작'; }
function cancelBody() {
  clearInterval(countdownTimer); countdownTimer = null; bodySamples = null; $('countdown').hidden = true; resetBodyPanel();
}
function beginBody() {
  unlockAudio();
  let left = num('delay');
  sheet.classList.add('hidden'); body = null;
  $('countdown').hidden = false; $('countNum').textContent = left; $('countText').textContent = '마커 근처로 가서 똑바로 서세요';
  beep(520);
  countdownTimer = setInterval(() => {
    left--;
    if (left > 0) { $('countNum').textContent = left; beep(520); return; }
    clearInterval(countdownTimer); countdownTimer = null;
    $('countNum').textContent = '●'; $('countText').textContent = '그대로 3초 가만히';
    beep(990, 0.25);
    bodySamples = []; bodyStart = performance.now();
  }, 1000);
}
function finishBody() {
  const heightM = userHeightM();
  const counts = {};
  for (const s of bodySamples) if (!s.ok) counts[s.reason] = (counts[s.reason] ?? 0) + 1;
  const total = bodySamples.length, okCount = bodySamples.filter(s => s.ok).length;
  body = finalizeBody(bodySamples, heightM);
  bodySamples = null; $('countdown').hidden = true; sheet.classList.remove('hidden');
  const reasons = `\n성공 ${okCount}/${total}프레임` + Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `\n · ${BODY_REASONS[r] ?? r}: ${n}프레임`).join('');
  $('bodyOut').hidden = false;
  $('bodyOut').textContent = body ? [
    `추정 키 약 ${(body.estimated_height_m * 100).toFixed(0)} cm ← 실제 키와 비슷한지 보세요`,
    `크기 배율 ${body.scale.toFixed(3)} (${body.scale_source === 'user_height' ? '입력한 키' : '영상'} 기준, ${body.samples}프레임)`,
  ].join('\n') + reasons : `몸 보정 실패: 쓸 수 있는 프레임이 부족합니다.${reasons}\n머리부터 발끝까지 화면에 다 나오게 서서 다시 하세요. '준비 상태'가 ✓일 때 시작하면 됩니다.`;
  $('calibBody').textContent = '다시 하기'; $('toMeasure').hidden = !body;
  syncBuildingHeight();
  if (body) $('bodyOut').textContent += `
건물 높이 ${buildingHeight().toFixed(2)} m (허리 높이)`;
  beep(body ? 880 : 220, 0.3);
}

// ---------- per frame ----------
function infer() {
  if (!landmarker || !video.videoWidth || video.readyState < 2) return;
  const ts = Math.max(lastTs + 1, performance.now());
  lastTs = ts;
  const out = landmarker.detectForVideo(video, ts);
  latest = { landmarks: out.landmarks?.[0] ?? null, world: out.worldLandmarks?.[0] ?? null, t: ts };
  frames++;
  if (ts - lastFpsAt > 1000) { fps = frames * 1000 / (ts - lastFpsAt); frames = 0; lastFpsAt = ts; }
}

function update() {
  result = null;
  if (!calib?.K) return;
  const sizeChanged = calib.width !== video.videoWidth || calib.height !== video.videoHeight;
  if (sizeChanged !== sizeWarned) { sizeWarned = sizeChanged; banner(sizeChanged ? '화면 방향이나 해상도가 바뀌었습니다. 폰 방향을 되돌리거나 마커 보정을 다시 하세요.' : ''); }
  if (sizeChanged) return;
  if (step === 'body') {
    const sample = measureBody(calib.K, calib.pose, latest?.landmarks ?? null, latest?.world ?? null);
    const live = sample.ok ? '✓ 준비됨: 머리와 발이 잘 보입니다' : `✗ ${BODY_REASONS[sample.reason] ?? sample.reason}`;
    $('bodyLive').textContent = live; $('bodyLive').parentElement.classList.toggle('ready', sample.ok);
    if (countdownTimer) $('countText').textContent = `마커 근처에 똑바로 서세요\n${live}`;
    if (bodySamples) {
      if (!latest || latest.t !== lastSampleT) { bodySamples.push(sample); lastSampleT = latest?.t; }   // one sample per inference
      const elapsed = performance.now() - bodyStart, okCount = bodySamples.filter(s => s.ok).length;
      $('countText').textContent = `그대로 가만히 · 성공 ${okCount}프레임\n${live}`;
      // At least 3 s; keep going up to 6 s while too few frames succeeded.
      if ((elapsed >= 3000 && okCount >= 15) || elapsed >= 6000) finishBody();
    }
    return;
  }
  if (step !== 'measure') return;
  if (!latest?.landmarks) { sendToPc({}); return; }   // keep the PC view (video, calibration) alive
  result = estimate(calib.K, calib.pose, latest.landmarks, latest.world, body);
  const b = box(), margin = num('boxMargin'), hitNow = {};
  for (const name of ['left_wrist', 'right_wrist']) {
    const P = result.valid ? result.joints[name]?.position_m ?? null : null;
    const inside = insideBox(b, P, margin);
    // Fast swing: the wrist may jump over the building between two frames, so test the path too.
    const prev = prevWrist[name];
    const swept = !!(P && prev && latest.t - prev.t <= SWING_MAX_GAP_MS
      && Math.hypot(P[0] - prev.P[0], P[1] - prev.P[1], P[2] - prev.P[2]) <= SWING_MAX_JUMP_M
      && segmentHitsBox(b, prev.P, P, margin));
    const hit = (inside || swept) && !wasInside[name];
    if (hit) { hits++; $('hits').textContent = hits; beep(1200, 0.08); lastHitAt = performance.now(); }
    wasInside[name] = inside; prevWrist[name] = P ? { P, t: latest.t } : null;
    if (hit) hitNow[name] = inside ? 'inside' : 'swept';
    if (P) { result.joints[name].inside_box = inside; result.joints[name].hit = hit; result.joints[name].hit_by = hit ? (inside ? 'inside' : 'swept') : null; }
  }
  sendToPc(hitNow);
  if (recording && result.valid) {
    recording.frames.push({ t_ms: Math.round(latest.t), anchor_source: result.anchor_source, anchor_feet: result.anchor_feet,
      anchor_m: round(result.anchor_m), joints: Object.fromEntries(Object.entries(result.joints).map(([k, v]) => [k, v && {
        position_m: round(v.position_m), ray_residual_m: +v.ray_residual_m.toFixed(4), visibility: +v.visibility.toFixed(3), inside_box: v.inside_box, hit: v.hit, hit_by: v.hit_by }])) });
    if (recording.frames.length >= 20000) toggleRecord();
  }
}
const round = p => p.map(v => +v.toFixed(4));

// ---------- PC viewer link (test relay: /ws/test/mono3d) ----------
const PC_FRAME_MS = 33, PC_JPEG_MS = 200, PC_JPEG_WIDTH = 480;
const jpegCanvas = document.createElement('canvas');
let lastCalibSent = null, lastFrameSentAt = 0, lastJpegSentAt = 0, pendingHits = {};
const link = createLink('phone', renderLink, m => { if (m.type === 'link_open') lastCalibSent = null; });
function renderLink(s) {
  const text = !s.enabled ? '꺼짐'
    : s.error === 'access_key_required' ? '접속 키가 필요합니다(주소에 ?key=)'
    : s.error === 'superseded' ? '다른 폰이 연결해서 끊겼습니다'
    : !s.open ? '서버에 연결 중…'
    : s.viewers ? `✓ PC 화면 ${s.viewers}개가 보는 중` : '서버 연결됨 · PC 화면을 여세요';
  $('pcStatus').textContent = text;
  $('pcStatus').parentElement.classList.toggle('ready', !!(s.open && s.viewers));
}
function sendToPc(hitNow) {
  if (step !== 'measure' || !calib?.K || !link.open) return;
  const b = box();
  const calibMsg = { type: 'mono3d_calib', schema: 'mono3d_live.v1', facing, mirror: mirrored(),
    image: { width: calib.width, height: calib.height }, K: calib.K,
    camera: { R: calib.pose.R, t: calib.pose.t, C: calib.pose.C }, marker_side_m: calib.side,
    building: { center: round(b.center), half: round(b.half), margin: num('boxMargin') },
    body: body && { scale: body.scale, scale_source: body.scale_source, estimated_height_m: body.estimated_height_m } };
  const key = JSON.stringify(calibMsg);
  if (key !== lastCalibSent && link.send(calibMsg)) lastCalibSent = key;
  const now = performance.now();
  Object.assign(pendingHits, hitNow);
  if (now - lastFrameSentAt >= PC_FRAME_MS || Object.keys(hitNow).length) {
    const lm = latest?.landmarks;
    const sent = link.send({ type: 'mono3d_frame', t_ms: Math.round(now), fps: +fps.toFixed(1), hits,
      hit: pendingHits, valid: !!result?.valid, reason: result?.reason ?? null,
      anchor_m: result?.valid ? round(result.anchor_m) : null, anchor_source: result?.anchor_source ?? null,
      joints: result?.valid ? Object.fromEntries(Object.entries(result.joints).map(([k, v]) => [k, v && round(v.position_m)])) : null,
      landmarks: lm ? lm.map(l => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) : null });
    if (sent) { lastFrameSentAt = now; pendingHits = {}; }
  }
  if (now - lastJpegSentAt >= PC_JPEG_MS && video.videoWidth) {
    const k = PC_JPEG_WIDTH / video.videoWidth;
    jpegCanvas.width = PC_JPEG_WIDTH; jpegCanvas.height = Math.round(video.videoHeight * k);
    jpegCanvas.getContext('2d').drawImage(video, 0, 0, jpegCanvas.width, jpegCanvas.height);
    if (link.send({ type: 'mono3d_jpeg', t_ms: Math.round(now), width: calib.width, height: calib.height,
      data: jpegCanvas.toDataURL('image/jpeg', 0.6) })) lastJpegSentAt = now;
  }
}

// ---------- drawing (raw coordinates under an optional mirror transform) ----------
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
    drawEstimate(lw);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (step === 'measure' && !$('hud').classList.contains('nomap')) drawTop();
  renderText();
}
const screenX = x => mirrored() ? view.width - x : x;
function label(text, x, y, lw) {          // text is drawn un-mirrored
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
  // Loupe in the visible part of the (cover-cropped) canvas, away from the finger.
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
  line3([0, 0, 0], [0.2, 0, 0], '#ef4444', lw * 1.5);
  line3([0, 0, 0], [0, 0.2, 0], '#22c55e', lw * 1.5);
  line3([0, 0, 0], [0, 0, 0.2], '#3b82f6', lw * 1.5);
  if (step !== 'measure') return;
  const b = box(), [hx, hy, hz] = b.half, [cx, cy, cz] = b.center;
  const v = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [cx + x * hx, cy + y * hy, cz + z * hz])));
  const hit = performance.now() - lastHitAt < 250
    || (result?.valid && ['left_wrist', 'right_wrist'].some(n => result.joints[n]?.inside_box));
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    if ([0, 1, 2].filter(k => v[i][k] !== v[j][k]).length === 1) line3(v[i], v[j], hit ? '#ef4444' : '#facc15', lw * 1.2);
  }
  [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]].forEach((p, i, a) =>
    line3([...p, 0], [...a[(i + 1) % 4], 0], 'rgba(250,204,21,.45)', lw));
}
function drawSkeleton(W, H, lw) {
  const lm = latest?.landmarks;
  if (!lm || (step !== 'body' && step !== 'measure')) return;
  const ok = i => lm[i]?.visibility >= 0.5;
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = lw;
  for (const [a, b] of SKELETON) if (ok(a) && ok(b)) {
    ctx.beginPath(); ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke();
  }
}
function drawEstimate(lw) {
  if (!result?.valid) return;
  const anchor = project(calib.K, calib.pose, result.anchor_m);
  if (anchor) dot(anchor, '#a855f7', lw * 3);
  for (const [name, color] of [['left_wrist', '#38bdf8'], ['right_wrist', '#f97316']]) {
    const j = result.joints[name];
    if (!j) continue;
    const P = j.position_m, floor = [P[0], P[1], 0];
    line3(floor, P, color, lw);
    const s = project(calib.K, calib.pose, floor), p = project(calib.K, calib.pose, P);
    if (s) dot(s, color, lw * 2.5);
    if (p) { dot(p, color, lw * 3.5); label(`${name === 'left_wrist' ? 'L' : 'R'} ${P[2].toFixed(2)}m`, p[0] + lw * 5, p[1], lw); }
  }
}

function drawTop() {
  const W = topView.width, H = topView.height, s = W / 3.2;      // X −1.6..1.6, Y −1.6..1.775 (m)
  const map = ([x, y]) => [W / 2 + (mirrored() ? -x : x) * s, H - (y + 1.6) * s];
  topCtx.clearRect(0, 0, W, H);
  topCtx.strokeStyle = 'rgba(255,255,255,.12)'; topCtx.lineWidth = 1;
  for (let g = -1.5; g <= 2.01; g += 0.5) { const [, y] = map([0, g]); topCtx.beginPath(); topCtx.moveTo(0, y); topCtx.lineTo(W, y); topCtx.stroke(); }
  for (let g = -1.5; g <= 1.51; g += 0.5) { const [x] = map([g, 0]); topCtx.beginPath(); topCtx.moveTo(x, 0); topCtx.lineTo(x, H); topCtx.stroke(); }
  topCtx.fillStyle = '#b6bcc5'; topCtx.font = '13px system-ui'; topCtx.fillText('위에서 본 모습 · 칸 0.5m', 6, 16);
  const rect = (cx, cy, hx, hy, color) => { const [a] = map([cx - hx, 0]), [b] = map([cx + hx, 0]), [, top] = map([0, cy + hy]);
    topCtx.strokeStyle = color; topCtx.lineWidth = 2; topCtx.strokeRect(Math.min(a, b), top, 2 * hx * s, 2 * hy * s); };
  const m = (calib?.side ?? 0.2) / 2; rect(0, 0, m, m, '#22c55e');
  const b = box(); rect(b.center[0], b.center[1], b.half[0], b.half[1], '#eab308');
  const pt = (p, color, r = 6) => { const [x, y] = map(p); topCtx.fillStyle = color; topCtx.beginPath(); topCtx.arc(x, y, r, 0, Math.PI * 2); topCtx.fill(); };
  if (calib?.pose) pt(calib.pose.C, '#94a3b8', 7);
  if (result?.valid) {
    pt(result.anchor_m, '#a855f7');
    if (result.joints.left_wrist) pt(result.joints.left_wrist.position_m, '#38bdf8');
    if (result.joints.right_wrist) pt(result.joints.right_wrist.position_m, '#f97316');
  }
}

function renderText() {
  if (step !== 'measure') return;
  if (!result) { $('result').textContent = latest?.landmarks ? '계산 대기' : '사람이 보이지 않음'; return; }
  if (!result.valid) {
    const why = { body_not_calibrated: '몸 보정이 필요합니다', no_person: '사람이 보이지 않음', no_floor_or_torso_anchor: '발이나 몸통이 보이지 않음' };
    $('result').textContent = `무효: ${why[result.reason] ?? result.reason}`; return;
  }
  const j = n => result.joints[n];
  const line = (name, n) => `${name} ${fmt(j(n)?.position_m)}${j(n) ? ` ±광선 ${(j(n).ray_residual_m * 100).toFixed(0)}cm` : ''}`;
  $('result').textContent = [
    `기준 ${result.anchor_source === 'floor' ? `바닥(${result.anchor_feet.map(f => f === 'left' ? '왼발' : '오른발').join('+')})` : '몸통 길이(덜 정확)'}`,
    line('왼손목', 'left_wrist'), line('오른손목', 'right_wrist'),
    `${fps.toFixed(0)} fps${recording ? ` · 기록 ${recording.frames.length}` : ''}`,
  ].join('\n');
}

// ---------- recording / sound ----------
function toggleRecord() {
  if (recording) { lastRecording = recording; recording = null; $('record').textContent = '기록 시작'; }
  else {
    recording = { schema: 'mono3d_test.v1', source: 'mono_approx', note: '카메라 1대 근사 추정. 다중 시점 3D가 아님.',
      started_at: new Date().toISOString(), facing, image: { width: calib.width, height: calib.height },
      intrinsics: calib.K, camera: { R: calib.pose.R, t: calib.pose.t, C: calib.pose.C }, marker_side_m: calib.side,
      marker_corners_px: calib.corners, body, building: { ...box(), margin: num('boxMargin'), auto_waist_height: $('bldAutoH').checked }, frames: [] };
    $('record').textContent = '기록 멈춤';
  }
  $('download').disabled = !(recording ?? lastRecording);
}
function download() {
  const data = recording ?? lastRecording;
  if (!data) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `mono3d-${data.started_at.replace(/[:.]/g, '-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function unlockAudio() { try { audio ??= new AudioContext(); audio.resume?.(); } catch { audio = null; } }
function beep(freq = 660, seconds = 0.12) {
  if (!audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.frequency.value = freq; g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + seconds);
  } catch { /* sound is optional */ }
}

function loop() {
  try { if (!frozen) { infer(); update(); } draw(); }
  catch (error) { banner(`오류: ${error.message}`); console.error(error); }
  requestAnimationFrame(loop);
}

// ---------- wiring ----------
document.querySelectorAll('.segBtn').forEach(b => b.addEventListener('click', () => {
  selectFacing(b.dataset.facing);
  if (stream) startCamera();
}));
$('start').addEventListener('click', startCamera);
$('back').addEventListener('click', goBack);
$('settingsBtn').addEventListener('click', () => $('settings').showModal());
$('sheetHandle').addEventListener('click', () => sheet.classList.toggle('collapsed'));
$('tapCorners').addEventListener('click', () => { unlockAudio(); beginTapping(); });
$('useSaved').addEventListener('click', useSaved);
$('undoCorner').addEventListener('click', () => { corners.pop(); updateCornerPrompt(); });
$('cancelCorners').addEventListener('click', () => { frozen = null; corners = []; setStep('place'); });
$('retryCorners').addEventListener('click', beginTapping);
$('toBody').addEventListener('click', () => { resetBodyPanel(); setStep('body'); });
$('calibBody').addEventListener('click', beginBody);
$('toMeasure').addEventListener('click', () => setStep('measure'));
$('redoBody').addEventListener('click', () => { resetBodyPanel(); setStep('body'); });
$('redoCorners').addEventListener('click', () => setStep('place'));
$('resetHits').addEventListener('click', () => { hits = 0; $('hits').textContent = '0'; });
for (const id of ['bldAutoH', 'heightCm']) $(id).addEventListener('change', syncBuildingHeight);
$('settingsBtn').addEventListener('click', syncBuildingHeight);
syncBuildingHeight();
try { $('sendPc').checked = localStorage.getItem('mono3d:sendPc') !== '0'; } catch { /* blocked storage */ }
$('sendPc').addEventListener('change', () => {
  try { localStorage.setItem('mono3d:sendPc', $('sendPc').checked ? '1' : '0'); } catch { /* blocked storage */ }
  link.setEnabled($('sendPc').checked && location.protocol !== 'file:');
});
link.setEnabled($('sendPc').checked && location.protocol !== 'file:');
$('record').addEventListener('click', toggleRecord);
$('download').addEventListener('click', download);
$('toggleMap').addEventListener('click', () => {
  const hidden = $('hud').classList.toggle('nomap'); $('toggleMap').textContent = hidden ? '지도 보기' : '지도 숨기기';
});
for (const id of ['fov', 'autoFov', 'cameraHeight', 'markerCm']) $(id).addEventListener('change', () => {
  if (calib && corners.length === 4) { calibrate(calib.width, calib.height); if (step === 'body' || step === 'measure') banner('보정 값이 바뀌었습니다. 몸 보정을 다시 하세요.'); }
});
$('clearAll').addEventListener('click', () => {
  save(null); calib = null; body = null; corners = []; frozen = null; $('settings').close(); setStep(stream ? 'place' : 'camera');
});
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); wakeLock?.addEventListener('release', () => { wakeLock = null; }); } catch { /* optional */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stream && !wakeLock) keepAwake(); });
selectFacing('environment');
setStep('camera');
requestAnimationFrame(loop);
window.__mono3dReady = true;
