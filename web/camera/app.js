import { watchServerStatus } from "/shared/status-socket.js";

const preview = document.querySelector("#preview");
const cameraId = document.querySelector("#camera-id");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const cameraStatus = document.querySelector("#camera-status");
const serverStatus = document.querySelector("#server-status");
let stream = null;

watchServerStatus((connected, message) => {
  serverStatus.textContent = connected
    ? "서버 연결 확인됨 · 영상·관절 전송은 미구현"
    : message;
});

function stopCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  preview.srcObject = null;
  start.disabled = false;
  stop.disabled = true;
  cameraId.disabled = false;
  cameraStatus.textContent = "카메라 꺼짐";
}

start.addEventListener("click", async () => {
  start.disabled = true;
  cameraId.disabled = true;
  cameraStatus.textContent = "카메라 권한을 확인하고 있습니다…";
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("카메라를 사용하려면 HTTPS 또는 같은 PC의 localhost로 접속하세요.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    preview.srcObject = stream;
    await preview.play();
    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", stopCamera));
    stop.disabled = false;
    cameraStatus.textContent = `${cameraId.value} · 로컬 미리보기 중 · 서버 전송 안 함`;
  } catch (error) {
    stopCamera();
    cameraStatus.textContent = `카메라를 열지 못했습니다: ${error.message}`;
  }
});

stop.addEventListener("click", stopCamera);
window.addEventListener("pagehide", stopCamera);
