import { watchServerStatus } from "/shared/status-socket.js";
import { createPoseLandmarker, extractWrists, RUNTIME } from "/camera/pose.js";
import { openPoseLink } from "/camera/pose-link.js";

const preview = document.querySelector("#preview");
const overlay = document.querySelector("#overlay");
const cameraId = document.querySelector("#camera-id");
const facing = document.querySelector("#facing");
const model = document.querySelector("#model");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const cameraStatus = document.querySelector("#camera-status");
const serverStatus = document.querySelector("#server-status");
const linkStatus = document.querySelector("#link-status");
const lastMessage = document.querySelector("#last-message");
const deviceInfo = document.querySelector("#device-info");
const stat = {
  fps: document.querySelector("#stat-fps"),
  infer: document.querySelector("#stat-infer"),
  sent: document.querySelector("#stat-sent"),
  time: document.querySelector("#stat-time"),
  errors: document.querySelector("#stat-errors"),
};

// ?replay=/public/... plays a recorded file instead of the camera; messages are marked source=replay.
const replayUrl = new URLSearchParams(location.search).get("replay");
// performance.now() restarts with every page load, so the clock is named per page.
const clockId = `perf-${randomId()}`;
const deviceId = loadDeviceId();

let stream = null;
let landmarker = null;
let landmarkerModel = null;
let delegate = null;
let link = null;
let running = false;
let session = null;
// Async permission/model work and queued frames belong to exactly one camera run.
let runId = 0;
let frameCallback = null;
let frameCallbackKind = null;

watchServerStatus((connected, message) => {
  serverStatus.textContent = connected ? "서버 상태 연결됨" : message;
});

restoreChoice(cameraId, "smash.camera_id");
restoreChoice(model, "smash.model");

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// device_id survives reloads so the server can map a reconnecting phone to the same calibration.
function loadDeviceId() {
  try {
    const saved = localStorage.getItem("smash.device_id");
    if (saved) return saved;
    const created = `phone-${randomId()}`;
    localStorage.setItem("smash.device_id", created);
    return created;
  } catch {
    return `phone-${randomId()}`;
  }
}

function restoreChoice(select, key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
    select.addEventListener("change", () => localStorage.setItem(key, select.value));
  } catch {
    // Storage blocked: the choice simply is not remembered.
  }
}

// A stream is one run of frame_ids under one image setting. Reconnects and size changes start a new one.
function newStream(width, height) {
  session.stream = { id: `stream-${randomId()}`, frameId: 0, width, height };
}

function makeHello() {
  newStream(preview.videoWidth, preview.videoHeight);
  return {
    schema_version: "0.1",
    type: "camera_hello",
    camera_id: cameraId.value,
    device_id: deviceId,
    stream_id: session.stream.id,
    clock_id: clockId,
    source: session.source,
    device_info: session.deviceInfo,
  };
}

function buildPose2d(timing, wrists) {
  const { stream: current } = session;
  return {
    schema_version: "0.1",
    type: "pose_2d",
    sample_only: false,
    source: session.source,
    camera_id: cameraId.value,
    device_id: deviceId,
    stream_id: current.id,
    frame_id: current.frameId,
    calibration_id: null,
    image: {
      width: current.width,
      height: current.height,
      rotation_deg: 0,
      mirrored: false,
      coordinate_space: "raw_distorted_pixels",
    },
    timing: { ...timing, clock_id: clockId },
    joints: wrists,
  };
}

// captureTime is the sensor time in this page's performance clock when the browser exposes it.
// Without it the capture time stays unknown; playback/arrival times are reported separately.
function readTiming(metadata) {
  const capture = Number.isFinite(metadata?.captureTime) ? metadata.captureTime : null;
  return {
    capture_time_ms: capture === null ? null : round(capture),
    timestamp_source: capture === null ? "unknown" : "rvfc_capture_time",
    presentation_time_ms: Number.isFinite(metadata?.presentationTime) ? round(metadata.presentationTime) : null,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function drawWrists(wrists) {
  const width = preview.videoWidth;
  const height = preview.videoHeight;
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  const context = overlay.getContext("2d");
  context.clearRect(0, 0, width, height);
  const radius = Math.max(6, width / 80);
  context.font = `${Math.round(radius * 2.4)}px system-ui, sans-serif`;
  for (const [label, point, color] of [["L", wrists.left_wrist, "#7fd6ff"], ["R", wrists.right_wrist, "#ffb36b"]]) {
    if (!point) continue;
    context.globalAlpha = point.visibility === null ? 1 : 0.35 + 0.65 * point.visibility;
    context.fillStyle = color;
    context.beginPath();
    context.arc(point.u_px, point.v_px, radius, 0, Math.PI * 2);
    context.fill();
    context.fillText(label, point.u_px + radius * 1.4, point.v_px + radius);
  }
  context.globalAlpha = 1;
}

function onFrame(now, metadata) {
  frameCallback = null;
  frameCallbackKind = null;
  if (!running) return;
  try {
    processFrame(now, metadata);
  } catch (error) {
    stopCamera();
    // A failed GPU/MediaPipe instance must be recreated on the next start.
    landmarker?.close();
    landmarker = null;
    landmarkerModel = null;
    cameraStatus.textContent = `손목 추출이 중단됐습니다. 카메라를 다시 켜세요: ${error.message}`;
  }
}

function processFrame(now, metadata) {
  if (!running) return;
  const width = preview.videoWidth;
  const height = preview.videoHeight;
  if (width && height) {
    if (session.stream && (width !== session.stream.width || height !== session.stream.height)) {
      // Rotation or a new resolution: coordinates from the old stream must not continue this one.
      newStream(width, height);
    }
    const timing = readTiming(metadata);
    // detectForVideo needs strictly increasing timestamps.
    session.lastTimestamp = Math.max(session.lastTimestamp + 1, Math.round(performance.now()));
    const began = performance.now();
    const result = landmarker.detectForVideo(preview, session.lastTimestamp);
    const ended = performance.now();
    timing.inference_end_ms = round(ended);
    const wrists = extractWrists(result, width, height);
    drawWrists(wrists);
    if (session.stream) {
      const message = buildPose2d(timing, wrists);
      // frame_id advances only when a frame actually leaves, so a new stream always starts at 0
      // on the server even if its first frames had to be dropped.
      if (link.send(message)) {
        session.stream.frameId += 1;
        session.counts.sent += 1;
      } else {
        session.counts.unsent += 1;
      }
      session.lastMessage = message;
    }
    session.counts.frames += 1;
    session.counts.inferMs += ended - began;
    session.lastTimingSource = timing.timestamp_source;
  }
  scheduleFrame();
}

function scheduleFrame() {
  if (!running) return;
  const scheduledRun = runId;
  const callback = (now, metadata) => {
    if (scheduledRun === runId) onFrame(now, metadata);
  };
  if (preview.requestVideoFrameCallback) {
    frameCallbackKind = "video";
    frameCallback = preview.requestVideoFrameCallback(callback);
  } else {
    // Older browsers: no per-frame metadata, so the capture time stays unknown.
    frameCallbackKind = "animation";
    frameCallback = requestAnimationFrame((now) => callback(now, null));
  }
}

function updateStats() {
  if (!session) return;
  const { counts } = session;
  const elapsed = (performance.now() - counts.since) / 1000;
  stat.fps.textContent = (counts.frames / elapsed).toFixed(1);
  stat.infer.textContent = counts.frames ? `${(counts.inferMs / counts.frames).toFixed(1)} ms · ${delegate}` : "–";
  stat.sent.textContent = `${session.totals.sent + counts.sent} / ${session.totals.unsent + counts.unsent}`;
  stat.time.textContent = session.lastTimingSource ?? "–";
  stat.errors.textContent = session.frameErrors.total
    ? `${session.frameErrors.total} · ${session.frameErrors.lastCode}`
    : "0";
  if (session.lastMessage) lastMessage.textContent = JSON.stringify(session.lastMessage, null, 2);
  session.totals.sent += counts.sent;
  session.totals.unsent += counts.unsent;
  session.counts = { frames: 0, inferMs: 0, sent: 0, unsent: 0, since: performance.now() };
}

async function openSource(attempt) {
  if (replayUrl) {
    preview.srcObject = null;
    preview.src = replayUrl;
    preview.loop = true;
    await preview.play();
    return { source: "replay", settings: { replay_url: replayUrl } };
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("카메라를 사용하려면 HTTPS 또는 같은 PC의 localhost로 접속하세요.");
  }
  const acquired = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing.value }, width: { ideal: 640 }, height: { ideal: 480 } },
  });
  if (attempt !== runId) {
    acquired.getTracks().forEach((track) => track.stop());
    return null;
  }
  stream = acquired;
  preview.srcObject = acquired;
  await preview.play();
  if (attempt !== runId) return null;
  const [track] = acquired.getVideoTracks();
  track.addEventListener("ended", () => { if (attempt === runId) stopCamera(); });
  return { source: "live", settings: track.getSettings() };
}

function setControlsRunning(isRunning) {
  start.disabled = isRunning;
  stop.disabled = !isRunning;
  for (const select of [cameraId, facing, model]) select.disabled = isRunning;
}

function stopCamera() {
  runId += 1;
  running = false;
  if (frameCallback !== null) {
    if (frameCallbackKind === "video") preview.cancelVideoFrameCallback?.(frameCallback);
    else window.cancelAnimationFrame(frameCallback);
    frameCallback = null;
    frameCallbackKind = null;
  }
  link?.close();
  link = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  preview.pause();
  preview.srcObject = null;
  preview.removeAttribute("src");
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  window.clearInterval(session?.statsTimer);
  session = null;
  setControlsRunning(false);
  cameraStatus.textContent = "카메라 꺼짐";
  linkStatus.textContent = "전송 꺼짐";
}

start.addEventListener("click", async () => {
  const attempt = ++runId;
  setControlsRunning(true);
  cameraStatus.textContent = "카메라 권한을 확인하고 있습니다…";
  try {
    const opened = await openSource(attempt);
    if (attempt !== runId) return;
    cameraStatus.textContent = `MediaPipe ${model.value} 모델을 불러오는 중…`;
    if (!landmarker || landmarkerModel !== model.value) {
      landmarker?.close();
      landmarker = null;
      const created = await createPoseLandmarker(model.value);
      if (attempt !== runId) {
        created.landmarker.close();
        return;
      }
      landmarker = created.landmarker;
      landmarkerModel = model.value;
      delegate = created.delegate;
    }
    session = {
      source: opened.source,
      stream: null,
      lastTimestamp: 0,
      lastMessage: null,
      lastTimingSource: null,
      counts: { frames: 0, inferMs: 0, sent: 0, unsent: 0, since: performance.now() },
      totals: { sent: 0, unsent: 0 },
      frameErrors: { total: 0, lastCode: null },
      deviceInfo: {
        user_agent: navigator.userAgent,
        video: { width: preview.videoWidth, height: preview.videoHeight, ...opened.settings },
        pose_runtime: { ...RUNTIME, model: `pose_landmarker_${model.value}`, delegate },
        request_video_frame_callback: Boolean(preview.requestVideoFrameCallback),
      },
    };
    newStream(preview.videoWidth, preview.videoHeight);
    deviceInfo.textContent = JSON.stringify(session.deviceInfo, null, 2);
    session.statsTimer = window.setInterval(updateStats, 1000);
    link = openPoseLink({
      makeHello,
      clockId,
      onState: (_, text) => { linkStatus.textContent = text; },
      onFrameError: (code) => {
        if (!session) return;
        session.frameErrors.total += 1;
        session.frameErrors.lastCode = code;
      },
    });
    running = true;
    scheduleFrame();
    cameraStatus.textContent = `${cameraId.value} · ${opened.source === "replay" ? "녹화 재생" : "실시간"} · 손목 추출 중 (${delegate})`;
  } catch (error) {
    if (attempt !== runId) return;
    stopCamera();
    cameraStatus.textContent = `시작하지 못했습니다: ${error.message}`;
  }
});

stop.addEventListener("click", stopCamera);
window.addEventListener("pagehide", stopCamera);
