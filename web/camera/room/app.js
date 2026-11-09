import { openRoom } from '/shared/room-link.js?v=phone-game-2';
import { createRoomPose } from '/camera/room/pose.js?v=phone-game-2';
const join = document.querySelector('#join'), leave = document.querySelector('#leave');
const camera = document.querySelector('#camera-id'), facing = document.querySelector('#facing');
const status = document.querySelector('#room-status'), peer = document.querySelector('#peer-status');
const preview = document.querySelector('#preview');
const markerGuide = document.querySelector('#marker-guide');
document.querySelector('#marker-guide-toggle').addEventListener('change', event => {
  markerGuide.hidden = !event.target.checked;
});
function updateMarkerGuide() {
  const width=preview.videoWidth||640, height=preview.videoHeight||480;
  // Approximate pinhole camera: diagonal FOV 85 degrees, level optical axis,
  // 1 m above the floor, 20 cm square centred 2.5 m forward. Not calibration.
  const focal=Math.hypot(width,height)/(2*Math.tan(85*Math.PI/360));
  const project=(x,z)=>[width/2+focal*x/z,height/2+focal*1/z];
  const corners=[project(-.1,2.6),project(.1,2.6),project(.1,2.4),project(-.1,2.4)];
  const [cx,cy]=project(0,2.5);
  document.querySelector('#marker-guide-projection').setAttribute('viewBox',`0 0 ${width} ${height}`);
  document.querySelector('#marker-guide-outline').setAttribute('points',corners.map(p=>p.join(',')).join(' '));
  document.querySelector('#marker-guide-cross').setAttribute('d',`M ${cx-5} ${cy} h 10 M ${cx} ${cy-5} v 10`);
  const label=document.querySelector('#marker-guide-label');
  label.setAttribute('x',cx);label.setAttribute('y',corners[0][1]-12);
  // Align the SVG with the actual object-fit:contain video area, including portrait streams.
  const box=preview.getBoundingClientRect();
  const scale=Math.min(preview.clientWidth/width,preview.clientHeight/height);
  const drawnWidth=width*scale,drawnHeight=height*scale;
  const stage=preview.parentElement.getBoundingClientRect();
  Object.assign(markerGuide.style,{left:`${box.left-stage.left+preview.clientLeft+(preview.clientWidth-drawnWidth)/2}px`,
    top:`${box.top-stage.top+preview.clientTop+(preview.clientHeight-drawnHeight)/2}px`,
    width:`${drawnWidth}px`,height:`${drawnHeight}px`});
}
preview.addEventListener('loadedmetadata',updateMarkerGuide);
new ResizeObserver(updateMarkerGuide).observe(preview);
updateMarkerGuide();
const previewStage=document.querySelector('#preview-stage');
const fullscreenButton=document.querySelector('#preview-fullscreen');
let nativeFullscreen=false,previewScrollY=0;
function setPreviewExpanded(expanded) {
  if(expanded)previewScrollY=window.scrollY;
  previewStage.classList.toggle('preview-expanded',expanded);
  document.body.classList.toggle('camera-expanded',expanded);
  fullscreenButton.textContent=expanded?'전체화면 닫기':'카메라 전체화면';
  fullscreenButton.setAttribute('aria-pressed',String(expanded));
  if(!expanded){window.scrollTo(0,previewScrollY);fullscreenButton.focus({preventScroll:true});}
  updateMarkerGuide();
}
async function closePreviewFullscreen() {
  fullscreenButton.disabled=true;
  try {
    if(document.fullscreenElement===previewStage){
      nativeFullscreen=false;
      try {await document.exitFullscreen();} catch {nativeFullscreen=true;return;}
    }
    nativeFullscreen=false;setPreviewExpanded(false);
  } finally {fullscreenButton.disabled=false;}
}
fullscreenButton.addEventListener('click',async()=>{
  if(previewStage.classList.contains('preview-expanded')){await closePreviewFullscreen();return;}
  setPreviewExpanded(true);
  if(previewStage.requestFullscreen){
    fullscreenButton.disabled=true;
    try {await previewStage.requestFullscreen();nativeFullscreen=document.fullscreenElement===previewStage;}
    catch { /* Keep the viewport-sized preview when native fullscreen is unavailable. */ }
    finally {fullscreenButton.disabled=false;}
  }
});
document.addEventListener('fullscreenchange',()=>{
  if(document.fullscreenElement===previewStage)nativeFullscreen=true;
  else if(nativeFullscreen){nativeFullscreen=false;setPreviewExpanded(false);}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&previewStage.classList.contains('preview-expanded'))void closePreviewFullscreen();
});
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
  if (!join.disabled) poseStatus.textContent = single ? '단일 모드 · C0 영상과 폰 관절 좌표를 게임으로 보냅니다.' : '다중 모드 · 전신 22개와 머리 위치 1개를 서버로 보냅니다.';
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
        if (attempt !== run || !['room-1','room-2'].includes(member.room_id)) return;
        pose = createRoomPose({ video: preview, overlay, send: (message,image) => room?.sendPose(message,image),
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
