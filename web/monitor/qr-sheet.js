const sheet = document.querySelector('#qr-sheet');
const base = document.querySelector('#qr-base');
const grid = document.querySelector('#qr-grid');
const message = document.querySelector('#qr-message');
base.value = location.origin;
try { base.value = localStorage.getItem('smash.qr.public-origin') || location.origin; } catch {}

function render() {
  let origin;
  try {
    const url = new URL(base.value.trim());
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error();
    origin = url.origin;
  } catch { message.textContent = '접속 키·경로 없이 서버 주소만 입력하세요. 예: https://서버주소:8443'; return; }
  base.value = origin;
  try { localStorage.setItem('smash.qr.public-origin',origin); } catch {}
  grid.replaceChildren();
  const pageRoom = location.pathname.match(/^\/monitor\/(room-[12])\/$/)?.[1];
  const roomIds = pageRoom ? [pageRoom] : ['room-1','room-2'];
  for (const room of roomIds) for (const camera of room === 'room-2' ? ['C0'] : ['C0','C1','C2']) {
    const target = new URL('/camera/room/',origin);
    target.searchParams.set('room',room); target.searchParams.set('camera',camera);
    const card = document.createElement('article'); card.className='qr-card';
    const title = document.createElement('h3'); title.textContent=`${room} · ${camera}`;
    const image = document.createElement('img');
    image.alt=`${room} ${camera} 카메라 입장 QR`; image.width=200; image.height=200;
    image.src=`/api/single/rooms/${room}/qr/${camera}.svg?base_url=${encodeURIComponent(origin)}`;
    image.onerror=()=>{message.textContent='QR 생성 실패 · 서버 재시작과 접속 키 인증 상태를 확인하세요.';};
    const link=document.createElement('a');link.href=target.href;link.textContent=target.href;
    card.append(title,image,link);grid.append(card);
  }
  const hostname=new URL(origin).hostname;
  message.textContent=['localhost','127.0.0.1','[::1]'].includes(hostname)
    ? '현재 주소는 PC 내부 주소입니다. 출력 전에 휴대폰이 접근할 수 있는 HTTPS 서버 주소로 바꿔주세요.'
    : '이 주소가 유지되는 동안 QR을 계속 사용할 수 있습니다. 카메라 입장에는 키·토큰이 필요하지 않습니다.';
}
document.querySelector('#qr-update').addEventListener('click',render);
document.querySelector('#qr-print').addEventListener('click',()=>{sheet.open=true;window.print();});
window.addEventListener('beforeprint',()=>{sheet.open=true;});
render();
