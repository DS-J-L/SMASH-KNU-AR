import { createSynchronizedVideo } from '/shared/synchronized-video.js?v=20261104-video-fix';
import { drawTimedFrame } from '/shared/video-clock.js?v=20261104-wrist-video-2';
import { createServerClock } from '/shared/server-clock.js?v=20261104-video-fix';
// Room membership: camera chooses direct WebRTC or JPEG frames relayed by the server.
function deviceId(role) {
  const key = role === 'camera' ? 'smash.device_id' : `smash.room.${role}.device`;
  try {
    const saved = localStorage.getItem(key) || (role === 'camera' ? localStorage.getItem('smash.room.camera.device') : null);
    if (saved) { localStorage.setItem(key, saved); return saved; }
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

export function openRoom({ role, roomId = 'room-1', cameraId = null, stream = null, sourceVideo = null, transport = 'webrtc', onState, onStatus, onVideo, onSendFrame, onSync, onGame, onGameError, onJoined, onPose, onFrame, drawOverlay }) {
  let joined = null, status = null, heartbeat = null, watchdog = null, closed = false;
  let lastMessage = Date.now();
  let awaitingStop = false;
  const peers = new Map();
  const synchronized = role === 'monitor' ? createSynchronizedVideo(onVideo, onSync, onFrame) : null;
  let frameTimer = null, frameId = 0, lastSourceTime = -1;
  let timedStream = null;
  const clock = createServerClock();
  const sendCanvas = document.createElement('canvas');
  const url = new URL('/ws/single/signaling', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  // Received frames stay observable even when the browser throttles a hidden video's decoder.
  const statsTimer = role === 'monitor' ? setInterval(() => {
    for (const [id, entry] of peers) {
      if (entry.readingStats) continue;
      entry.readingStats = true;
      entry.pc.getStats().then(report => {
        if (closed || peers.get(id) !== entry) return;
        report.forEach(stat => {
          const frames = stat.framesReceived ?? stat.framesDecoded;
          if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')
              && Number.isFinite(frames) && frames > (entry.receivedFrames || 0)) {
            entry.receivedFrames = frames; onFrame?.(entry.cameraId);
          }
        });
      }).catch(() => {}).finally(() => { entry.readingStats = false; });
    }
  }, 500) : null;
  const text = {
    slot_in_use: '이미 다른 기기가 사용 중인 자리입니다.',
    device_in_use: '이 기기가 이미 다른 카메라 자리로 입장했습니다.',
    superseded: '같은 기기의 다른 탭에서 입장해 연결이 종료됐습니다.',
    heartbeat_timeout: '서버 응답이 끊겼습니다. 다시 입장하세요.',
    access_key_required: 'PC 입장에는 접속 키가 필요합니다. 키로 모니터 페이지에 접속하세요.',
  };
  function send(type, extra = {}) {
    if (ws.readyState !== WebSocket.OPEN || (!joined && type !== 'join')) return false;
    ws.send(JSON.stringify({ schema: 'room.v1', type, room_id: roomId, ...extra }));
    return true;
  }
  function drop(id) {
    const entry = peers.get(id);
    if (!entry) return;
    peers.delete(id);
    entry.pc.close();
    onVideo?.(entry.cameraId, null, '영상 연결 대기');
  }
  function clear() {
    clearInterval(heartbeat); clearInterval(watchdog);
    clearInterval(frameTimer);
    clearInterval(statsTimer);
    timedStream?.getTracks().forEach(track => track.stop()); timedStream = null;
    for (const id of [...peers.keys()]) drop(id);
    synchronized?.close();
    joined = null;
  }
  function peer(id, cid) {
    if (peers.has(id)) return peers.get(id);
    // Same-network host candidates first; no external STUN/TURN dependency.
    const pc = new RTCPeerConnection({ iceServers: [] });
    const entry = { pc, cameraId: cid, queue: [], chain: Promise.resolve() };
    peers.set(id, entry);
    const current = () => !closed && peers.get(id) === entry;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && current()) send('ice', { target_connection_id: id, payload: candidate.toJSON() });
    };
    pc.ontrack = ({ track, streams }) => {
      entry.stream = streams[0] || new MediaStream([track]);
      if (current()) onVideo?.(cid, entry.stream, 'WebRTC 직접 · 독립 표시(동기화 제외)');
    };
    pc.onconnectionstatechange = () => {
      if (!current()) return;
      if (pc.connectionState === 'connected' && entry.stream) {
        onVideo?.(cid, entry.stream, 'WebRTC 직접 · 연결 복구됨');
      }
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        onVideo?.(cid, null, '영상 연결 끊김 · 퇴장 후 다시 입장하세요');
        onState?.('warning', '영상 연결이 끊겼습니다. 퇴장 후 다시 입장하세요.');
      }
    };
    return entry;
  }
  function syncPeers() {
    if (!joined || !status) return;
    const wanted = role === 'camera'
      ? [status.monitor_connection_id].filter(Boolean)
      : status.cameras.filter(c => c.connected && c.transport !== 'server').map(c => c.connection_id);
    for (const id of [...peers.keys()]) if (!wanted.includes(id)) drop(id);
    synchronized?.setCameras(status.cameras.filter(c => c.connected && c.transport === 'server'));
    if (role === 'camera' && transport === 'webrtc' && stream && wanted.length && !peers.has(wanted[0])) {
      const id = wanted[0], entry = peer(id, cameraId), pc = entry.pc;
      entry.chain = (async () => {
        const outgoing = timedStream || stream;
        for (const track of outgoing.getVideoTracks()) pc.addTrack(track, outgoing);
        const offer = await pc.createOffer();
        if (peers.get(id) !== entry) return;
        await pc.setLocalDescription(offer);
        if (peers.get(id) === entry) send('offer', { target_connection_id: id, payload: { type: 'offer', sdp: pc.localDescription.sdp } });
      })().catch(error => failPeer(id, entry, error));
    }
  }
  function startFrames() {
    if (role !== 'camera' || !sourceVideo?.videoWidth) return;
    const label = drawTimedFrame(sendCanvas, sourceVideo, cameraId, clock, drawOverlay);
    onSendFrame?.(label);
    lastSourceTime = sourceVideo.currentTime;
    if (transport === 'webrtc') timedStream = sendCanvas.captureStream(15);
    frameTimer = setInterval(() => {
      if (!joined || !status?.monitor_connected || !sourceVideo?.videoWidth) return;
      if (sourceVideo.currentTime === lastSourceTime) return;
      if (transport === 'server' && ws.bufferedAmount > 512 * 1024) return;
      lastSourceTime = sourceVideo.currentTime;
      const label = drawTimedFrame(sendCanvas, sourceVideo, cameraId, clock, drawOverlay);
      onSendFrame?.(label);
      if (transport === 'server') send('video_frame', {
        frame_id: frameId++, prepared_at_server_ms: clock.estimate()?.nowMs ?? null,
        data_url: sendCanvas.toDataURL('image/jpeg', 0.65),
      });
    }, 1000 / 15);
  }
  function receiveFrame(msg) {
    if (role !== 'monitor' || !joined || msg.target_connection_id !== joined.connection_id) return;
    const camera = status?.cameras.find(c => c.camera_id === msg.camera_id && c.connected && c.transport === 'server');
    if (!camera || camera.connection_id !== msg.from_connection_id) return;
    synchronized.push(msg);
  }
  function failPeer(id, entry, error) {
    if (peers.get(id) !== entry || closed) return;
    drop(id);
    onState?.('warning', `영상 연결 실패: ${error.message}. 퇴장 후 다시 입장하세요.`);
  }
  function signal(msg) {
    if (!joined || !status || msg.target_connection_id !== joined.connection_id) return;
    const id = msg.from_connection_id;
    const expected = role === 'camera' ? status.monitor_connection_id
      : status.cameras.find(c => c.camera_id === msg.camera_id && c.connected)?.connection_id;
    if (!id || id !== expected) return;
    if (role === 'camera' && !peers.has(id)) return;
    const entry = peer(id, msg.camera_id), pc = entry.pc;
    entry.chain = entry.chain.then(async () => {
      if (peers.get(id) !== entry) return;
      if (msg.type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.payload);
        else entry.queue.push(msg.payload);
      } else {
        if ((role === 'monitor' && msg.type !== 'offer') || (role === 'camera' && msg.type !== 'answer')) return;
        await pc.setRemoteDescription(msg.payload);
        for (const candidate of entry.queue.splice(0)) await pc.addIceCandidate(candidate);
        if (role === 'monitor') {
          const answer = await pc.createAnswer();
          if (peers.get(id) !== entry) return;
          await pc.setLocalDescription(answer);
          if (peers.get(id) === entry) send('answer', { target_connection_id: id, payload: { type: 'answer', sdp: pc.localDescription.sdp } });
        }
      }
    }).catch(error => failPeer(id, entry, error));
  }
  onState?.('connecting', `${roomId}에 연결 중…`);
  const handshake = setTimeout(() => {
    if (!joined) { onState?.('error', '입장 응답이 없습니다. 서버 버전을 확인하고 다시 입장하세요.'); close(); }
  }, 7000);
  ws.onopen = () => send('join', { role, camera_id: cameraId, device_id: deviceId(role === 'monitor' ? `${role}:${roomId}` : role), transport });
  ws.onmessage = event => {
    if (closed) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    lastMessage = Date.now();
    if (msg.type === 'joined') {
      clearTimeout(handshake); joined = msg;
      send('ping', { ping_id: clock.ping() });
      startFrames();
      const pulse = () => {
        send('ping', { ping_id: clock.ping() });
        if (role === 'monitor') send('get_game_status');
      };
      heartbeat = setInterval(pulse, Math.max(100, msg.heartbeat_interval_ms));
      if (role === 'monitor') send('get_game_status');
      watchdog = setInterval(() => {
        if (Date.now() - lastMessage > msg.heartbeat_timeout_ms * 1.5) {
          onState?.('error', '서버 응답이 끊겼습니다. 다시 입장하세요.'); close();
        }
      }, Math.max(100, msg.heartbeat_interval_ms));
      onState?.('joined', `${roomId} · ${role === 'monitor' ? 'PC' : cameraId} 입장 완료`);
      onJoined?.(msg);
    } else if (msg.type === 'pong') clock.receive(msg);
    else if (msg.type === 'room_status') {
      status = msg; onStatus?.(msg); syncPeers();
      if (role === 'monitor') onGame?.(msg.game);
    } else if (msg.type === 'pose') onPose?.(msg.payload);
    else if (msg.type === 'game_ack' || msg.type === 'game_status') {
      if (msg.game?.state === 'ended') awaitingStop = false;
      onGame?.(msg.game);
    }
    else if (msg.type === 'video_frame') receiveFrame(msg);
    else if (['offer', 'answer', 'ice'].includes(msg.type)) signal(msg);
    else if (msg.type === 'error') {
      if (awaitingStop && msg.code === 'unsupported_message') {
        awaitingStop = false; onGameError?.(msg.code, 'stop_game');
      } else if (msg.request_type === 'stop_game' || ['camera_not_ready','monitor_required','invalid_session_id','session_conflict','old_session','session_in_progress','session_limit','game_not_connected','session_mismatch','invalid_stop_reason'].includes(msg.code)) onGameError?.(msg.code, msg.request_type);
      else onState?.('error', text[msg.code] || `서버 오류: ${msg.code}`);
    }
  };
  ws.onerror = () => onState?.('error', '서버 연결 실패 · 접속 키와 서버 실행 상태를 확인하세요.');
  ws.onclose = event => {
    const expected = closed;
    closed = true; clearTimeout(handshake); clear();
    if (!expected) onState?.('closed', text[event.code === 4001 ? 'superseded' : ''] || '방 연결 종료 · 다시 입장하세요.');
  };
  function close() {
    if (closed) return;
    send('leave'); closed = true; clearTimeout(handshake); clear(); ws.close();
  }
  return { close, clock,
    sendPose: payload => (payload.type !== 'pose_2d' || ws.bufferedAmount <= 64 * 1024) && send('pose', { payload }),
    startGame: (sessionId, cameras) => send('start_game', { session_id: sessionId, mode: 'video_check', cameras }),
    stopGame: (sessionId, reason = 'manual_stop') => {
      awaitingStop = true;
      const sent = send('stop_game', { session_id: sessionId, reason });
      if (!sent) awaitingStop = false;
      return sent;
    },
  };
}
