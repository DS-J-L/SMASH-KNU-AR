import { openRoom } from '/shared/room-link.js?v=20261104-wrist-video-2';
import { createRoomPose } from '/camera/room/pose.js?v=20261104-head';
const join = document.querySelector('#join'), leave = document.querySelector('#leave');
const camera = document.querySelector('#camera-id'), facing = document.querySelector('#facing');
const status = document.querySelector('#room-status'), peer = document.querySelector('#peer-status');
const preview = document.querySelector('#preview');
const transport = document.querySelector('#transport');
const roomId = document.querySelector('#room-id');
const preferredRoom = new URLSearchParams(location.search).get('room');
if (['room-1','room-2'].includes(preferredRoom)) roomId.value = preferredRoom;
const sendClock = document.querySelector('#send-clock');
let room = null, stream = null, run = 0, pose = null;
const poseStatus = document.querySelector('#pose-status'), overlay = document.querySelector('#pose-overlay');
const preferred = new URLSearchParams(location.search).get('camera');
if (['C0', 'C1', 'C2'].includes(preferred)) camera.value = preferred;
function applyRoomConstraints() {
  const single = roomId.value === 'room-2';
  for (const option of camera.options) option.disabled = single && option.value !== 'C0';
  if (single) camera.value = 'C0';
  camera.disabled = single || join.disabled;
  if (!join.disabled) poseStatus.textContent = single ? '단일 모드 · 폰은 영상만 송신합니다.' : '다중 모드 · 전신 22개와 머리 위치 1개를 서버로 보냅니다.';
}
roomId.addEventListener('change', applyRoomConstraints);
applyRoomConstraints();
if (preferredRoom && !['room-1','room-2'].includes(preferredRoom)) {
  status.textContent = 'QR의 방은 더 이상 제공하지 않습니다. room-1 또는 room-2를 선택해 입장하세요.';
}
function controls(active) {
  join.disabled = camera.disabled = facing.disabled = active;
  transport.disabled = active;
  roomId.disabled = active;
  applyRoomConstraints();
  leave.disabled = !active;
}
function stop() {
  pose?.close(); pose = null;
  run++; room?.close(); room = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  preview.srcObject = null; controls(false); peer.textContent = 'PC 연결 대기';
  sendClock.textContent = '전송 준비 시각: 대기';
}
join.addEventListener('click', async () => {
  const attempt = ++run;
  controls(true); status.textContent = '카메라 권한 확인 중…';
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS 또는 localhost로 접속하세요.');
    if (transport.value === 'webrtc' && !window.RTCPeerConnection) throw new Error('이 브라우저는 영상 직접 연결을 지원하지 않습니다. 서버 중계를 선택하세요.');
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing.value }, width: { ideal: 640 }, height: { ideal: 480 } } });
    if (attempt !== run) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; preview.srcObject = stream; await preview.play();
    if (attempt !== run) return;
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (attempt === run) { stop(); status.textContent = '카메라가 종료됐습니다. 다시 입장하세요.'; }
    }));
    room = openRoom({ role: 'camera', roomId: roomId.value, cameraId: camera.value, stream, sourceVideo: preview, transport: transport.value,
      drawOverlay(canvas) { if (attempt === run) pose?.drawOn(canvas); },
      onJoined(member) {
        if (attempt !== run || member.room_id !== 'room-1') return;
        pose = createRoomPose({ video: preview, overlay, send: message => room?.sendPose(message),
          onStatus: message => { if (attempt === run) poseStatus.textContent = message; } });
        void pose.start(member);
      },
      onPose(message) { if (attempt === run) pose?.receive(message); },
      onSendFrame(label) { if (attempt === run) sendClock.textContent = label; },
      onState(state, message) {
        if (attempt !== run) return;
        status.textContent = message;
        if (state === 'closed' || state === 'error') stop();
      },
      onStatus(value) { peer.textContent = value.monitor_connected ? 'PC 연결됨 · 영상 연결 준비' : 'PC가 입장하면 영상을 보냅니다.'; },
    });
  } catch (error) { if (attempt === run) { stop(); status.textContent = `입장 실패: ${error.message}`; } }
});
leave.addEventListener('click', () => { stop(); status.textContent = '퇴장했습니다.'; });
window.addEventListener('pagehide', stop);
