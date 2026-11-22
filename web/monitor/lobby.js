import { watchServerStatus } from '/shared/status-socket.js';
// The lobby now only links the duo stage and the one-camera 3D test (2026-11-22); rooms and QR are reached by URL.
watchServerStatus((connected,message)=>{
  document.querySelector('#server-status').textContent=connected?'서버 연결됨 · 시험 화면을 선택하세요.':message;
});
