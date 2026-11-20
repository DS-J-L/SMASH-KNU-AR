// Duo stage WebRTC (2026-11-20, docs/DUO_STAGE_TEST.md): the view phone V sends its camera straight to each PC on
// the same Wi-Fi. The server only relays the few-kB signalling messages (rtc_signal {to, data}); the video never
// passes through it. No STUN/TURN: on one Wi-Fi the host candidates connect directly. If WebRTC does not connect,
// V keeps sending JPEG through the server (the old path), so the PC always has a picture.
//
// The PC offers (receive-only video), V answers with its camera track. Signals of one connection are handled
// strictly in order (an ICE candidate never races ahead of the offer/answer it belongs to).

const RTC_CONFIG = { iceServers: [] };
export const RTC_CONNECT_TIMEOUT_MS = 8000;
export const RTC_MAX_WIDTH = 1280;      // V's stream is scaled to at most this width (latency over detail)
export const RTC_MAX_BITRATE = 3_000_000;

function queue() {
  let chain = Promise.resolve();
  return task => (chain = chain.then(task).catch(() => {}));
}

// Prefer H.264 (hardware encoder on most phones) and keep VP8 etc. as fallbacks.
function preferH264(transceiver) {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.('video')?.codecs;
    if (!caps || !transceiver.setCodecPreferences) return;
    const rank = c => /h264/i.test(c.mimeType) ? 0 : /vp8/i.test(c.mimeType) ? 1 : 2;
    transceiver.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch { /* the browser's default order */ }
}

async function tuneSender(sender, track) {
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const width = track?.getSettings?.().width ?? RTC_MAX_WIDTH;
    params.encodings[0].maxBitrate = RTC_MAX_BITRATE;
    params.encodings[0].maxFramerate = 30;
    params.encodings[0].scaleResolutionDownBy = Math.max(1, width / RTC_MAX_WIDTH);
    params.degradationPreference = 'maintain-framerate';
    await sender.setParameters(params);
  } catch { /* defaults still work */ }
}

// V side. getTrack() returns the live camera track (or null before the camera starts);
// send(viewerId, data) relays a signal; onChange({connected, peers}) reports the state.
export function createRtcSender({ getTrack, send, onChange = () => {} }) {
  const peers = new Map();   // viewer id -> {pc, sender, run}
  let enabled = true;
  const state = () => ({ connected: [...peers.values()].filter(p => p.pc.connectionState === 'connected').length, peers: peers.size });
  const report = () => onChange(state());
  function close(id) {
    const p = peers.get(id); if (!p) return;
    peers.delete(id); try { p.pc.close(); } catch { /* closed */ }
    report();
  }
  async function answer(from, data) {
    close(from);
    const track = getTrack();
    if (!enabled) { send(from, { type: 'disabled' }); return; }
    if (!track) { send(from, { type: 'not_ready' }); return; }
    const pc = new RTCPeerConnection(RTC_CONFIG), entry = { pc, sender: null, run: queue() };
    peers.set(from, entry);
    pc.onicecandidate = e => { if (e.candidate) send(from, { type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) close(from); else report(); };
    await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    const transceiver = pc.getTransceivers().find(t => t.receiver.track?.kind === 'video');
    track.contentHint = 'motion';
    if (transceiver) { transceiver.direction = 'sendonly'; await transceiver.sender.replaceTrack(track); entry.sender = transceiver.sender; }
    else entry.sender = pc.addTrack(track);
    await pc.setLocalDescription(await pc.createAnswer());
    await tuneSender(entry.sender, track);
    send(from, { type: 'answer', sdp: pc.localDescription.sdp });
    report();
  }
  const pending = new Map();   // viewer id -> ordered signal queue
  return {
    onSignal(from, data) {
      if (!pending.has(from)) pending.set(from, queue());
      pending.get(from)(async () => {
        if (data?.type === 'bye') close(from);
        else if (data?.type === 'offer' && typeof data.sdp === 'string') await answer(from, data);
        else if (data?.type === 'ice' && data.candidate) await peers.get(from)?.pc.addIceCandidate(data.candidate).catch(() => {});
      });
    },
    // A restarted camera: the open connections switch to the new track without renegotiating.
    replaceTrack(track) { for (const p of peers.values()) p.sender?.replaceTrack(track).then(() => tuneSender(p.sender, track)).catch(() => {}); },
    setEnabled(on) { enabled = on; if (!on) for (const id of [...peers.keys()]) { send(id, { type: 'disabled' }); close(id); } },
    closeAll() { for (const id of [...peers.keys()]) close(id); },
    get state() { return state(); },
    // Outbound video statistics summed over the connected PCs (for the phone's performance line).
    async stats() {
      const out = [];
      for (const p of peers.values()) {
        if (p.pc.connectionState !== 'connected') continue;
        const report = await p.pc.getStats(p.sender?.track ?? null).catch(() => null);
        report?.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') out.push(r); });
      }
      return out;
    },
  };
}

// PC side. send(data) relays a signal to V; onStream(MediaStream) gives the video; onChange(state, detail).
// States: idle, connecting, connected, phone_not_ready, disabled, failed.
export function createRtcReceiver({ send, onStream, onChange = () => {} }) {
  let pc = null, run = queue(), timer = null, retry = null, status = 'idle', wanted = false;
  const set = (next, detail = '') => { if (next !== status || detail) { status = next; onChange(status, detail); } };
  function teardown() {
    clearTimeout(timer); timer = null;
    if (pc) { pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null; try { pc.close(); } catch { /* closed */ } }
    pc = null;
  }
  function later(ms) { clearTimeout(retry); retry = wanted ? setTimeout(() => { if (wanted && status !== 'connected') start(); }, ms) : null; }
  async function start() {
    teardown(); run = queue();
    if (!wanted) return;
    set('connecting');
    const conn = pc = new RTCPeerConnection(RTC_CONFIG);
    preferH264(conn.addTransceiver('video', { direction: 'recvonly' }));
    conn.ontrack = e => onStream(e.streams?.[0] ?? new MediaStream([e.track]));
    conn.onicecandidate = e => { if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() }); };
    conn.onconnectionstatechange = () => {
      if (conn !== pc) return;
      if (conn.connectionState === 'connected') { clearTimeout(timer); set('connected'); }
      else if (['failed', 'disconnected', 'closed'].includes(conn.connectionState)) { teardown(); set('failed', conn.connectionState); later(3000); }
    };
    await conn.setLocalDescription(await conn.createOffer());
    if (conn !== pc) return;
    send({ type: 'offer', sdp: conn.localDescription.sdp });
    timer = setTimeout(() => { if (conn === pc && status !== 'connected') { teardown(); set('failed', 'timeout'); later(5000); } }, RTC_CONNECT_TIMEOUT_MS);
  }
  return {
    // Want a connection while V is connected; stop when it leaves.
    setWanted(on) {
      if (on === wanted) return;
      wanted = on; clearTimeout(retry);
      if (on) start().catch(e => { teardown(); set('failed', String(e?.message ?? e)); later(5000); });
      else { teardown(); set('idle'); }
    },
    restart() { if (wanted) start().catch(() => later(5000)); },
    onSignal(data) {
      run(async () => {
        if (!pc) return;
        if (data?.type === 'answer' && typeof data.sdp === 'string') await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        else if (data?.type === 'ice' && data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
        else if (data?.type === 'not_ready') { teardown(); set('phone_not_ready'); later(3000); }
        else if (data?.type === 'disabled') { teardown(); set('disabled'); later(5000); }
      });
    },
    // The server could not reach V (not connected): try again later.
    failed(reason) { teardown(); set('failed', reason); later(5000); },
    get status() { return status; },
    async stats() {
      if (!pc || status !== 'connected') return null;
      const report = await pc.getStats().catch(() => null); let video = null;
      report?.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') video = r; });
      return video;
    },
  };
}
