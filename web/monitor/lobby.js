import { watchServerStatus } from '/shared/status-socket.js';
import '/monitor/qr-sheet.js';
watchServerStatus((connected,message)=>{
  document.querySelector('#server-status').textContent=connected?'서버 연결됨 · 입장할 방을 선택하세요.':message;
});
let closed=false;
async function refresh(){
  try{
    const response=await fetch('/api/single/rooms');
    if(!response.ok)throw new Error('방 상태 조회 실패');
    const data=await response.json(); if(closed)return;
    for(const room of data.rooms){
      const item=document.querySelector(`[data-room-summary="${room.room_id}"]`);
      if(item)item.textContent=`PC ${room.monitor_connected?'접속 중':'대기'} · 카메라 ${room.camera_count}/${room.max_cameras} · ${room.game?.state==='playing'?'60초 세션 진행 중':'카메라 테스트/준비'}`;
    }
  }catch{if(!closed)document.querySelector('#server-status').textContent='방 상태를 확인하지 못했습니다. 서버·접속 키를 확인하세요.';}
}
void refresh(); const timer=setInterval(refresh,5000);
window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);});
