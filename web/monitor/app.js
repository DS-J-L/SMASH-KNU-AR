import { watchServerStatus } from "/shared/status-socket.js";

const status = document.querySelector("#server-status");

watchServerStatus((connected, message) => {
  status.textContent = connected
    ? "서버 연결됨 · 카메라와 게임 기능은 아직 연결하지 않았습니다."
    : message;
  status.dataset.connected = String(connected);
});

// T03/T09: connect real readiness, renderer and game state here.
// Server connectivity alone must never enable the start button.
