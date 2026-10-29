// Phone → server pose link over /ws/pose. The handshake is a proposal (docs/DATA_CONTRACT.md)
// until the server side of T01 lands; without it the page keeps showing pose locally.
const MAX_BUFFERED_BYTES = 64 * 1024;
const RETRY_MS = 3000;

export function openPoseLink({ makeHello, clockId, onState }) {
  let socket = null;
  let retry = null;
  let registered = false;
  let disposed = false;

  function connect() {
    if (disposed) return;
    registered = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws/pose`);
    let opened = false;

    socket.addEventListener("open", () => {
      opened = true;
      onState("waiting_ack", "서버 연결됨 · 등록 응답을 기다립니다");
      socket.send(JSON.stringify(makeHello()));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "camera_ack") {
        registered = true;
        onState("registered", `등록됨 · ${message.camera_id ?? ""}`);
      } else if (message.type === "clock_ping") {
        // Reply at once so the server can estimate this page's clock offset and RTT.
        socket.send(JSON.stringify({
          type: "clock_pong",
          ping_id: message.ping_id,
          server_time_ms: message.server_time_ms,
          client_time_ms: performance.now(),
          clock_id: clockId,
        }));
      } else if (message.type === "error") {
        registered = false;
        onState("rejected", `서버 거부: ${message.code ?? "unknown"}${message.detail ? ` · ${message.detail}` : ""}`);
      }
    });
    socket.addEventListener("close", (event) => {
      registered = false;
      if (disposed) return;
      onState(
        "disconnected",
        opened
          ? `연결 끊김 (code ${event.code}) · 새 스트림으로 다시 연결합니다`
          : "서버에 /ws/pose 수신이 아직 없거나 서버가 꺼져 있습니다 · 로컬 표시만 합니다",
      );
      retry = window.setTimeout(connect, RETRY_MS);
    });
  }

  connect();

  return {
    // true: handed to the socket. false: not registered or the socket is backed up, so drop it.
    send(message) {
      if (!registered || socket?.readyState !== WebSocket.OPEN) return false;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      disposed = true;
      window.clearTimeout(retry);
      socket?.close(1000, "camera stopped");
    },
  };
}
