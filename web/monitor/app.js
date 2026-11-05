import { watchServerStatus } from "/shared/status-socket.js";
import { openRoom } from "/shared/room-link.js?v=20261104-game-stop";
import { serverClockLabel } from "/shared/video-clock.js";
import "/monitor/qr-sheet.js";

const status = document.querySelector("#server-status");

watchServerStatus((connected, message) => {
  status.textContent = connected
    ? "서버 연결됨 · 방에 입장해 카메라 영상을 확인하세요."
    : message;
  status.dataset.connected = String(connected);
});

const join = document.querySelector('#room-join'), leave = document.querySelector('#room-leave');
const roomStatus = document.querySelector('#room-status'), grid = document.querySelector('#camera-grid');
const syncStatus = document.querySelector('#sync-status');
const presence = document.querySelector('#camera-presence'), empty = document.querySelector('#room-empty');
const tiles = new Map();
const viewerClock = document.querySelector('#viewer-clock');
let room = null;
const pageRoomId = location.pathname.match(/^\/monitor\/(room-[12])\/$/)?.[1];
const phoneGameLink=document.querySelector('#phone-game-link');
if(phoneGameLink){phoneGameLink.hidden=!pageRoomId;phoneGameLink.href=`/monitor/phone-game/?room=${pageRoomId}`;}
document.querySelector('#page-room-title').textContent = `${pageRoomId || '방 선택 필요'} · ${pageRoomId === 'room-2' ? '단일 카메라' : '다중 카메라'} 테스트`;
document.querySelector('#room-empty').textContent = pageRoomId === 'room-2' ? 'C0 카메라 한 대가 입장하면 영상이 표시됩니다.' : 'C0 · C1 · C2가 입장하면 영상이 한 줄에 표시됩니다.';
document.title = `${pageRoomId || '방 선택'} · PC 모니터`;
document.querySelector('#phone-link').href = `/camera/room/?room=${pageRoomId || 'room-1'}`;
document.querySelector('#game-start').dataset.start = pageRoomId || '';
const gameStatus = document.querySelector('#game-status'), gameTimer = document.querySelector('#game-timer');
const gameResult = document.querySelector('#game-result'), gameChecks = document.querySelector('#game-checks');
const startButton = document.querySelector('#game-start'), startNote = document.querySelector('#game-start-note');
const hud = document.querySelector('#game-hud'), playTimer = document.querySelector('#play-timer');
const playScore = document.querySelector('#play-score'), scoreNote = document.querySelector('#play-score-note');
const cameraChoices = document.querySelector('#play-cameras'), expandButton = document.querySelector('#game-expand');
const collapseButton = document.querySelector('#play-collapse');
const stopButtons = [document.querySelector('#game-stop'), document.querySelector('#play-stop')];
const playStatus = document.querySelector('#play-status');
let stopping = false, stopTimeout = null, resumedAt = -Infinity, stopSupported = true;
const endReasons = {manual_stop:'사용자 중지',camera_disconnected:'카메라 연결 끊김으로 자동 중지',camera_stalled:'카메라 영상 중단으로 자동 중지',time_up:'시간 종료'};
let selectedCamera = 'C0';
let currentRoomId = null, roomData = null, game = null, deadline = null, starting = false, startTimeout = null;
let pendingSessionId = null;
let dismissedSession = null;
const backToTest = document.querySelector('#game-back');
function setTimer(text) { gameTimer.textContent = playTimer.textContent = text; }
function updateStopButtons() {
  for (const button of stopButtons) {
    button.hidden = game?.state !== 'playing'; button.disabled = stopping || !stopSupported;
    button.textContent = stopping ? '중지 요청 중…' : '중지';
  }
}
function stopMessage(message) {
  gameStatus.textContent = playStatus.textContent = message; playStatus.hidden = false;
}
function stopGame(reason = 'manual_stop') {
  if (game?.state !== 'playing' || stopping || !stopSupported) return;
  stopping = true; updateStopButtons();
  stopMessage(reason === 'camera_stalled' ? '필수 카메라 영상이 중단됐습니다. 서버 중지 확인 중…' : '서버 중지 확인 중…');
  if (!room?.stopGame(game.session_id, reason)) {
    stopping = false; updateStopButtons(); stopMessage('중지 요청을 보내지 못했습니다. 서버 연결을 확인하세요.'); return;
  }
  stopTimeout = setTimeout(() => {
    stopping = false; updateStopButtons(); stopMessage('중지 응답이 없습니다. 다시 중지를 누르거나 서버 연결을 확인하세요.');
  },7000);
}
for (const button of stopButtons) button.addEventListener('click', () => stopGame());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumedAt = performance.now(); });
function setExpanded(expanded) {
  const active = expanded && game?.state === 'playing';
  const wasActive = document.body.classList.contains('game-expanded');
  document.body.classList.toggle('game-expanded', active);
  hud.hidden = !active;
  if (active && !wasActive) collapseButton.focus({preventScroll:true});
  if (!active && wasActive && game?.state === 'playing') expandButton.focus({preventScroll:true});
}
function selectCamera(id) {
  selectedCamera = id;
  for (const [cid, tile] of tiles) tile.root.dataset.selected = String(cid === id);
  for (const button of cameraChoices.children) button.setAttribute('aria-pressed', String(button.dataset.camera === id));
}
function updateCameraChoices() {
  const ids = [...tiles.keys()].sort();
  if (!tiles.has(selectedCamera)) selectedCamera = tiles.has('C0') ? 'C0' : ids[0] || 'C0';
  if ([...cameraChoices.children].map(button => button.dataset.camera).join() !== ids.join()) {
    cameraChoices.replaceChildren(...ids.map(id => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = id;
      button.dataset.camera = id; button.addEventListener('click', () => selectCamera(id)); return button;
    }));
  }
  selectCamera(selectedCamera);
}
collapseButton.addEventListener('click', () => setExpanded(false));
expandButton.addEventListener('click', () => setExpanded(true));
window.addEventListener('keydown', event => { if (event.key === 'Escape') setExpanded(false); });
const updateClock = () => { viewerClock.textContent = `서버 기준 현재 시각: ${serverClockLabel(room?.clock)}`; };
updateClock();
const clockTimer = setInterval(updateClock, 50);
window.addEventListener('pagehide', () => clearInterval(clockTimer));
function reset() {
  startButton.disabled = true;
  roomData = null; game = null; deadline = null; starting = false; pendingSessionId = null; clearTimeout(startTimeout);
  stopping = false; stopSupported = true; clearTimeout(stopTimeout); updateStopButtons(); playStatus.hidden = true;
  setExpanded(false); expandButton.hidden = true; selectedCamera = 'C0';
  gameResult.hidden = true; gameChecks.replaceChildren(); setTimer('60.0초');
  playScore.textContent = '—'; scoreNote.hidden = false;
  backToTest.hidden = true; dismissedSession = null;
  syncStatus.textContent = '서버 중계 영상 동기화 대기 · WebRTC 직접은 독립 표시';
  for (const tile of tiles.values()) tile.video.srcObject = null;
  tiles.clear(); grid.replaceChildren(); grid.dataset.count = '0'; empty.hidden = false;
  updateCameraChoices();
  presence.replaceChildren(...(pageRoomId === 'room-2' ? ['C0'] : ['C0', 'C1', 'C2']).map(id => {
    const item = document.createElement('li'); item.textContent = `${id} · 대기`; return item;
  }));
}
function stop() { room?.close(); room = null; currentRoomId = null; reset(); join.disabled = false; leave.disabled = true; }
function render(value) {
  roomData = value;
  const connected = value.cameras.filter(c => c.connected);
  const ids = new Set(connected.map(c => c.camera_id));
  for (const [id, tile] of tiles) if (!ids.has(id)) {
    tile.video.srcObject = null; tile.root.remove(); tiles.delete(id);
  }
  presence.replaceChildren(...value.cameras.map(camera => {
    const item = document.createElement('li');
    item.textContent = `${camera.camera_id} · ${camera.connected ? '접속' : '대기'}`;
    item.dataset.connected = String(camera.connected); return item;
  }));
  for (const camera of connected) {
    const id = camera.camera_id;
    if (tiles.has(id)) continue;
    const root = document.createElement('article'); root.className = 'camera-tile'; root.dataset.camera = id;
    const title = document.createElement('h3'); title.textContent = `${id} · ${camera.transport === 'server' ? '서버 중계' : 'WebRTC 직접'}`;
    const video = document.createElement('video'); video.autoplay = video.muted = video.playsInline = true;
    video.setAttribute('aria-label', `${id} 실시간 영상`);
    const note = document.createElement('p'); note.textContent = '카메라 접속됨 · 영상 연결 대기'; note.className = 'muted';
    root.append(title, video, note); tiles.set(id, { root, video, note, lastFrame: -Infinity, lastTime: -1, watching: false });
  }
  // Moving an existing video ancestor can pause MediaStream playback in browsers.
  // Session broadcasts must leave correctly positioned camera nodes attached.
  connected.forEach((camera, index) => {
    const root = tiles.get(camera.camera_id).root;
    if (grid.children[index] !== root) grid.insertBefore(root, grid.children[index] || null);
  });
  grid.dataset.count = String(connected.length); empty.hidden = connected.length > 0;
  updateCameraChoices();
}
join.addEventListener('click', () => {
  if (game?.state === 'playing') { gameStatus.textContent = '진행 중인 세션이 끝난 뒤 방을 바꿔주세요.'; return; }
  const selected = pageRoomId;
  if (!selected) { roomStatus.textContent = '방 목록에서 PC 입장 버튼을 눌러주세요.'; return; }
  stop(); currentRoomId = selected; join.disabled = true; leave.disabled = false;
  room = openRoom({ role: 'monitor', roomId: selected,
    onGame: updateGame,
    onGameError(code, requestType) {
      if (requestType === 'stop_game') {
        if (code === 'unsupported_message') stopSupported = false;
        stopping = false; clearTimeout(stopTimeout); updateStopButtons();
        stopMessage(code === 'unsupported_message'
          ? '실행 중인 서버가 중지 기능을 지원하지 않습니다. 서버를 종료 후 다시 실행하고 페이지를 새로고침하세요.'
          : `중지 실패: ${code}. 서버 상태를 확인하고 다시 시도하세요.`); return;
      }
      starting = false; clearTimeout(startTimeout); pendingSessionId = null;
      gameStatus.textContent = `시작 승인 실패: ${code}. 준비 상태를 확인하고 다시 시도하세요.`;
    },
    onSync(message) { syncStatus.textContent = message; },
    onState(state, message) {
      roomStatus.textContent = message;
      if (state === 'closed' || state === 'error') stop();
    },
    onStatus: render,
    onFrame(id) { const tile = tiles.get(id); if (tile) tile.lastFrame = performance.now(); },
    onVideo(id, stream, message) {
      const tile = tiles.get(id); if (!tile) return;
      if (stream !== undefined) { tile.video.srcObject = stream; if (game?.state !== 'playing') tile.lastFrame = -Infinity; }
      tile.note.textContent = message;
      if (stream) {
        tile.video.play().catch(() => { tile.note.textContent = '영상 재생을 허용해주세요.'; tile.video.controls = true; });
        watchFrames(id, tile);
      }
    },
  });
});
leave.addEventListener('click', () => { stop(); location.assign('/monitor/'); });
window.addEventListener('pagehide', stop);

function watchFrames(id, tile) {
  if (tile.watching || !tile.video.requestVideoFrameCallback) return;
  tile.watching = true;
  const frame = () => {
    if (tiles.get(id) !== tile || !tile.video.srcObject) { tile.watching = false; return; }
    tile.lastFrame = performance.now(); tile.video.requestVideoFrameCallback(frame);
  };
  tile.video.requestVideoFrameCallback(frame);
}
function updateGame(value) {
  if (!value) return;
  if (pendingSessionId && value.session_id !== pendingSessionId) return;
  const same = game?.session_id === value.session_id;
  game = value; starting = false; clearTimeout(startTimeout); pendingSessionId = null;
  if (game.state === 'playing') {
    playScore.textContent = Number.isFinite(game.score) ? `${game.score}점` : '—';
    scoreNote.hidden = Number.isFinite(game.score);
    expandButton.hidden = false;
    if (!same) { playStatus.hidden = true; selectCamera(tiles.has('C0') ? 'C0' : [...tiles.keys()][0]); setTimer(`${(game.remaining_ms / 1000).toFixed(1)}초`); setExpanded(true); }
    dismissedSession = null; backToTest.hidden = true;
    const next = performance.now() + game.remaining_ms;
    deadline = same && deadline !== null ? Math.min(deadline, next) : next;
    gameResult.hidden = true;
    if (!stopping) gameStatus.textContent = `${game.room_id} · 60초 영상 확인 진행 중 · 타격/점수 연결 전`;
  } else {
    stopping = false; clearTimeout(stopTimeout); playStatus.hidden = true;
    setExpanded(false); expandButton.hidden = true;
    if (dismissedSession === game.session_id) return;
    deadline = null; setTimer('0.0초'); gameResult.hidden = false;
    backToTest.hidden = false;
    const reason = endReasons[game.reason] || '세션 종료';
    gameResult.textContent = `결과 · ${reason} · ${game.room_id} · 진행 ${(game.elapsed_ms / 1000).toFixed(1)}초 · 시작 카메라 ${game.camera_ids.join(', ')} · 점수: ${Number.isFinite(game.score) ? `${game.score}점` : '타격 연결 전'} · 세션 ${game.session_id}`;
    gameStatus.textContent = `${reason}. 결과 확인 후 카메라 테스트로 돌아갈 수 있습니다.`;
  }
  updateStopButtons();
}
function preparation(roomId) {
  const now = performance.now();
  const cameras = (roomData?.cameras || []).filter(c => c.connected);
  const report = cameras.map(camera => {
    const tile = tiles.get(camera.camera_id);
    return {camera_id:camera.camera_id, connection_id:camera.connection_id,
      video_ready:!!tile && tile.video.readyState >= 2 && tile.video.videoWidth > 0 && now - tile.lastFrame < 1500};
  });
  const checks = [
    [room !== null && currentRoomId === roomId, `${roomId} PC 입장`],
    [document.visibilityState === 'visible', '현재 탭 표시'],
    [(roomData?.required_cameras || (pageRoomId === 'room-1' ? ['C0','C1','C2'] : ['C0'])).every(id => cameras.some(camera=>camera.camera_id===id)),
      pageRoomId === 'room-1' ? 'C0 · C1 · C2 모두 연결' : 'C0 카메라 연결'],
    [report.length > 0 && report.every(c => c.video_ready), '연결된 모든 카메라의 최신 영상 수신'],
  ];
  return { checks, report };
}
function showChecks(checks) {
  const content=checks.map(([ok,label])=>`${ok?'✓':'✕'} ${label}`);
  if([...gameChecks.children].map(node=>node.textContent).join('|')===content.join('|'))return;
  gameChecks.replaceChildren(...checks.map(([ok,label]) => {const item=document.createElement('li');item.textContent=`${ok?'✓':'✕'} ${label}`;return item;}));
}
function startGame(roomId) {
  if (starting || game?.state === 'playing') { gameStatus.textContent = '이미 시작 승인 대기 또는 세션 진행 중입니다.'; return; }
  const {checks,report}=preparation(roomId);
  showChecks(checks);
  if (checks.some(([ok]) => !ok)) { gameStatus.textContent = '준비되지 않은 항목을 확인해주세요. 영상이 나온 후 다시 시작할 수 있습니다.'; return; }
  pendingSessionId ||= crypto.randomUUID(); starting = true;
  gameStatus.textContent = '준비 점검 통과 · 서버 시작 승인 대기…';
  if (!room.startGame(pendingSessionId, report)) { starting=false; gameStatus.textContent='제어 연결이 없습니다. 다시 입장하세요.'; return; }
  startTimeout = setTimeout(() => { starting=false; gameStatus.textContent='시작 승인 응답이 없습니다. 같은 요청으로 다시 시도할 수 있습니다.'; },7000);
}
startButton.addEventListener('click', () => startGame(pageRoomId));
const gameTick = setInterval(() => {
  for (const tile of tiles.values()) if (!tile.video.requestVideoFrameCallback && tile.video.currentTime !== tile.lastTime) {
    tile.lastTime=tile.video.currentTime; tile.lastFrame=performance.now();
  }
  const {checks}=preparation(pageRoomId);
  const missing=checks.filter(([ok])=>!ok);
  startButton.disabled=starting || game?.state==='playing' || missing.length>0;
  startNote.textContent=starting ? '서버 시작 승인 대기 중' : game?.state==='playing' ? '60초 세션 진행 중' : missing.length ? `준비 필요: ${missing.map(([,label])=>label).join(', ')}` : '모든 필수 카메라의 영상이 준비됐습니다.';
  if(!starting && game?.state!=='playing')showChecks(checks);
  if (game?.state==='playing' && deadline!==null) {
    setTimer(`${(Math.max(0,deadline-performance.now())/1000).toFixed(1)}초`);
    const now = performance.now();
    if(now>=deadline)gameStatus.textContent='시간 종료 · 서버 결과 확인 중…';
    else if (!stopping && document.visibilityState === 'visible' && now - resumedAt >= 1500
      && game.camera_ids.some(id => !tiles.has(id) || now - tiles.get(id).lastFrame > 1500)) stopGame('camera_stalled');
  }
},100);
window.addEventListener('pagehide',()=>clearInterval(gameTick));
backToTest.addEventListener('click', () => {
  dismissedSession = game?.session_id || null;
  gameResult.hidden = backToTest.hidden = true; gameChecks.replaceChildren();
  setTimer('60.0초');
  gameStatus.textContent = '카메라 테스트 중 · 영상과 방 연결을 유지합니다. 게임 시작을 누르면 준비 상태를 다시 검사합니다.';
  if (preparation(pageRoomId).checks.some(([ok]) => !ok)) join.click();
});
if (pageRoomId) join.click();
else { roomStatus.textContent = '방 목록에서 입장해주세요.'; join.disabled = true; }
