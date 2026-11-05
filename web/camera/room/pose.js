import { createPoseLandmarker, extractWrists } from '/camera/pose.js';
import { extractBody, extractHead, drawBody } from '/camera/body.js?v=20261104-head';

// One estimator uses the already-open camera; video transport never waits for model loading.
export function createRoomPose({ video, overlay, send, onStatus }) {
  let closed = false, landmarker = null, callback = null, callbackKind = null;
  let member = null, stream = null, registered = false, lastTimestamp = -1, calibrationId = null;
  let lastVideoTime = -1, lastFrameAt = -Infinity, sent = 0, received = -1, clockReady = false;
  let delegate = '', wrists = { left_wrist: null, right_wrist: null };
  let inferredAt = -Infinity;
  let body = null;
  let head = null;
  const clockId = `perf-${crypto.randomUUID()}`;
  function status() {
    const point = p => p ? `${p.u_px}, ${p.v_px}` : '미검출';
    const count=Object.values(body || {}).filter(p=>p && p.visibility>=0.5).length;
    const headCount=head ? 1 : 0;
    onStatus(`전신 ${count}/22개 · 머리 ${headCount}/1개 · ${delegate} · 왼손(${point(wrists.left_wrist)}) · 오른손(${point(wrists.right_wrist)}) · 전송 ${sent}개 · 서버 수신 ${received < 0 ? '대기' : `프레임 ${received}`} · 관절 시계 ${clockReady ? '동기화됨' : '동기화 대기'}`);
  }
  function register() {
    registered = false; received = -1; clockReady = false; calibrationId = null;
    stream = { id: crypto.randomUUID(), width: video.videoWidth, height: video.videoHeight, frame: 0 };
    send({ schema_version: '0.1', type: 'camera_hello', source: 'live',
      camera_id: member.camera_id, device_id: member.device_id, stream_id: stream.id, clock_id: clockId });
  }
  function draw() {
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    drawBody(overlay,body,video.videoWidth,video.videoHeight,head);
  }
  function schedule() {
    if (closed) return;
    if (video.requestVideoFrameCallback) {
      callbackKind = 'video'; callback = video.requestVideoFrameCallback(frame);
    } else {
      callbackKind = 'animation'; callback = requestAnimationFrame(now => frame(now, null));
    }
  }
  function frame(now, metadata) {
    callback = null;
    if (closed) return;
    try {
      if (!video.videoWidth || !video.videoHeight || now - lastFrameAt < 1000 / 15
          || (!metadata && video.currentTime === lastVideoTime)) { schedule(); return; }
      lastFrameAt = now; lastVideoTime = video.currentTime;
      if (video.videoWidth !== stream.width || video.videoHeight !== stream.height) register();
      lastTimestamp = Math.max(lastTimestamp + 1, performance.now());
      const result = landmarker.detectForVideo(video, lastTimestamp);
      wrists = extractWrists(result, video.videoWidth, video.videoHeight);
      body = extractBody(result,video.videoWidth,video.videoHeight);
      head = extractHead(result,video.videoWidth,video.videoHeight);
      for (const [name,point] of Object.entries(wrists)) body[name] = Number.isFinite(point?.visibility) ? point : null;
      inferredAt = performance.now();
      draw();
      const capture = Number.isFinite(metadata?.captureTime) ? metadata.captureTime : null;
      if (registered && send({ schema_version: '0.1', type: 'pose_2d', source: 'live', sample_only: false,
        camera_id: member.camera_id, device_id: member.device_id, stream_id: stream.id,
        frame_id: stream.frame, calibration_id: calibrationId,
        image: { width: stream.width, height: stream.height, rotation_deg: 0, mirrored: false,
          coordinate_space: 'raw_distorted_pixels' },
        timing: { clock_id: clockId, capture_time_ms: capture,
          timestamp_source: capture === null ? 'unknown' : 'rvfc_capture_time',
          presentation_time_ms: Number.isFinite(metadata?.presentationTime) ? metadata.presentationTime : null,
          inference_end_ms: performance.now() }, joints: wrists, body, head })) { stream.frame++; sent++; }
      status(); schedule();
    } catch (error) { close(); onStatus(`손목 인식 중단: ${error.message}. 퇴장 후 다시 입장하세요. 영상 송신은 유지됩니다.`); }
  }
  function close() {
    closed = true; registered = false;
    if (callback !== null) {
      if (callbackKind === 'video') video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
    }
    callback = null; landmarker?.close(); landmarker = null;
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  }
  return {
    drawOn(canvas) {
      if (closed || performance.now() - inferredAt > 200 || !stream
          || stream.width !== video.videoWidth || stream.height !== video.videoHeight) return;
      drawBody(canvas,body,stream.width,stream.height,head);
    },
    async start(value) {
      member = value; onStatus('폰에서 MediaPipe 손목 인식 모델을 불러오는 중…');
      try {
        const created = await createPoseLandmarker('lite');
        if (closed) { created.landmarker.close(); return; }
        landmarker = created.landmarker; delegate = created.delegate;
        register(); schedule();
      } catch (error) { close(); onStatus(`손목 인식 시작 실패: ${error.message}. 영상 송신은 유지됩니다.`); }
    },
    receive(message) {
      if (closed || !message) return;
      if (message.type === 'clock_ping') {
        send({ type: 'clock_pong', ping_id: message.ping_id, server_time_ms: message.server_time_ms,
          client_time_ms: performance.now(), clock_id: clockId });
      } else if (message.type === 'camera_ack' && message.stream_id === stream?.id) {
        const expected = message.expected;
        if (expected?.image?.width === stream.width && expected.image.height === stream.height
            && expected.image.rotation_deg === 0) calibrationId = expected.calibration_id;
        registered = true; clockReady = false; status();
      } else if (message.type === 'pose_received' && message.stream_id === stream?.id) {
        received = message.frame_id; clockReady = message.clock_ready; status();
      } else if (message.type === 'error') {
        close(); onStatus(`관절 전송 거부: ${message.code}. 퇴장 후 다시 입장하세요. 영상 송신은 유지됩니다.`);
      }
    },
    close,
  };
}
