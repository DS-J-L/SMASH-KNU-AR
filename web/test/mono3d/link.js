// Test-only WebSocket link: phone page -> server relay -> PC viewer (/test/mono3d/view.html).
// Reconnects with backoff. `send` drops messages while disconnected or while the socket is backed up,
// so a slow network never builds up lag (pose frames are replaced by the next ones anyway).
const MAX_BUFFERED = 256 * 1024;

// The wide stage reuses this phone page with path '/ws/test/wide3d' and params {camera}.
export function createLink(role, onStatus = () => {}, onMessage = () => {}, { path = '/ws/test/mono3d', params = {} } = {}) {
  let ws = null, enabled = false, retry = 500, timer = null;
  const state = { open: false, viewers: 0, phone: false, error: null };
  const emit = () => onStatus({ ...state, enabled });

  function url() {
    const u = new URL(path, location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '?' + new URLSearchParams({ role, ...params });
    const key = new URLSearchParams(location.search).get('key');   // cookie normally covers this
    if (key) u.searchParams.set('key', key);
    return u.href;
  }
  function connect() {
    clearTimeout(timer);
    if (!enabled || ws) return;
    try { ws = new WebSocket(url()); } catch (e) { state.error = String(e); emit(); schedule(); return; }
    ws.onopen = () => { state.open = true; state.error = null; retry = 500; emit(); onMessage({ type: 'link_open' }); };
    ws.onmessage = event => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'mono3d_status') { state.viewers = m.viewers; state.phone = m.phone_connected; emit(); }
      if (m.type === 'error') { state.error = m.code; emit(); }
      onMessage(m);
    };
    ws.onclose = event => {
      ws = null; state.open = false;
      if (event.code === 4401) state.error = 'access_key_required';
      else if (event.code === 4001) state.error = 'superseded';
      emit(); schedule();
    };
    ws.onerror = () => { /* close follows */ };
  }
  function schedule() {
    if (!enabled) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 8000);
  }
  return {
    setEnabled(on) {
      enabled = on;
      if (on) connect();
      else { clearTimeout(timer); ws?.close(); ws = null; state.open = false; emit(); }
    },
    get open() { return state.open; },
    get viewers() { return state.viewers; },
    send(message) {
      if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    // Bytes still waiting in the socket (video senders skip a frame instead of queueing behind it).
    get buffered() { return ws && ws.readyState === WebSocket.OPEN ? ws.bufferedAmount : 0; },
    // Already-serialised message (the caller measured its size).
    sendText(text, maxBuffered = MAX_BUFFERED) {
      if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > maxBuffered) return false;
      ws.send(text);
      return true;
    },
  };
}
