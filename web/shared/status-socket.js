// Status-only socket. It is not camera registration or a media transport.
export function watchServerStatus(onState) {
  let socket;
  let retry;
  let poll;
  let disposed = false;
  let lastResponse = 0;

  function connect() {
    if (disposed) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws/status`);

    socket.addEventListener("open", () => {
      lastResponse = Date.now();
      poll = window.setInterval(() => {
        if (Date.now() - lastResponse > 6000) {
          onState(false, "서버 응답이 지연되고 있습니다. 다시 연결합니다…");
          socket.close();
          return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "get_status" }));
      }, 2000);
    });
    socket.addEventListener("message", (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === "system_status") {
          lastResponse = Date.now();
          onState(true, value.message);
        }
      } catch {
        onState(false, "서버 응답 형식을 확인해주세요.");
      }
    });
    socket.addEventListener("close", () => {
      window.clearInterval(poll);
      if (!disposed) {
        onState(false, "서버 연결 끊김 · 2초 뒤 다시 연결합니다.");
        retry = window.setTimeout(connect, 2000);
      }
    });
    socket.addEventListener("error", () => {
      onState(false, "서버에 연결할 수 없습니다. 서버 주소와 실행 상태를 확인하세요.");
    });
  }

  const dispose = () => {
    disposed = true;
    window.clearTimeout(retry);
    window.clearInterval(poll);
    socket?.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  connect();
  return dispose;
}
