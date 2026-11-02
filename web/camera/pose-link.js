// Phone → server pose link over /ws/pose (docs/DATA_CONTRACT.md).
const MAX_BUFFERED_BYTES = 64 * 1024;
const RETRY_MS = 3000;
// Close codes after which reconnecting cannot help; the user has to act first.
const FINAL_CLOSES = {
  4001: "같은 기기의 다른 탭·창이 이 번호로 다시 등록했습니다. 이 탭에서 쓰려면 카메라를 껐다 켜세요",
  4401: "접속 키가 필요합니다. 주소 끝에 ?key=접속키 를 붙여 다시 여세요",
  4403: "서버 설정에서 이 번호는 다른 기기 전용입니다",
};

export function openPoseLink({ makeHello, clockId, onState, onFrameError }) {
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
    let rejection = null;

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
        // Before the ack an error rejects the registration; after it, it concerns one message
        // and the server keeps the stream, so keep sending.
        if (registered && message.code !== "superseded") {
          onFrameError(message.code ?? "unknown");
        } else {
          registered = false;
          rejection = message.code ?? "unknown";
          onState("rejected", `서버 거부: ${rejection}${message.detail ? ` · ${message.detail}` : ""}`);
        }
      }
    });
    socket.addEventListener("close", (event) => {
      registered = false;
      if (disposed) return;
      const final = FINAL_CLOSES[event.code];
      if (final) {
        onState("stopped", `${final} (code ${event.code})`);
        return;
      }
      let text;
      if (!opened) text = "서버에 /ws/pose 수신이 없거나 서버가 꺼져 있습니다 · 로컬 표시만 합니다";
      else if (rejection) text = `서버 거부: ${rejection} (code ${event.code}) · 3초 뒤 다시 등록합니다`;
      else text = `연결 끊김 (code ${event.code}) · 새 스트림으로 다시 연결합니다`;
      onState("disconnected", text);
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
