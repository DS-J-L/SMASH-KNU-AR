export const scoreText=units=>Number.isInteger(units/10)?String(units/10):(units/10).toFixed(1);

// Snapshot interpolation is display-only. All awards, expiry and the pause are owned by the server.
export function comboView(snapshot,elapsed=0){
  const s=snapshot??{},dt=Math.max(0,elapsed),pause=Math.max(0,(s.combo_pause_remaining_ms??0)-dt);
  const remaining=Math.max(0,(s.combo_remaining_ms??0)-Math.max(0,dt-(s.combo_pause_remaining_ms??0)));
  const active=(s.combo_count??0)>0&&dt<=(s.combo_remaining_ms??0)+(s.combo_pause_remaining_ms??0);
  const count=active?s.combo_count:0;
  return {remaining,pause,count,multiplier:active?(s.multiplier_tenths/10).toFixed(1):'1.0',
    label:count>1?`${count} COMBO`:count===1?'1 HIT':(s.max_combo??0)>0?'콤보 종료':'타격 대기',
    status:pause>0?'콤보 잠시 정지':s.awaiting_ready?'다음 건물 준비 중':count?'4초 안에 추가 파괴':'새 파편을 부숴 보세요',
    score:scoreText(s.game_score_units??0),cleared:s.cleared_count??0};
}

export function createComboHud(root,{now=()=>performance.now()}={}){
  root.className='combo-hud';
  root.innerHTML='<div class="combo-total"><span>총점</span><b data-total>0</b><small data-source></small></div><div class="combo-line"><b data-count>타격 대기</b><b data-multiplier>×1.0</b><span data-award aria-live="polite"></span></div><div class="combo-track" role="progressbar" aria-label="콤보 남은 시간" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"><div data-fill></div></div><div class="combo-caption"><span data-status>새 파편을 부숴 보세요</span><span data-remaining>0.0초</span></div><div class="combo-cleared" data-cleared>철거 0개 · 목표 80%</div>';
  const el=name=>root.querySelector(`[data-${name}]`);
  let snapshot=null,received=0,lastEvent=null,popupUntil=0,popup='';
  function accept(s){
    if(!s)return true;
    if(snapshot?.instance_id===s.instance_id){
      if(s.revision<snapshot.revision)return false;
      if(s.revision===snapshot.revision&&s.server_now_ms<snapshot.server_now_ms)return false;
    }
    return true;
  }
  function update(s,event){
    if(!s||!accept(s))return;
    const first=!snapshot||snapshot.session_id!==s.session_id;
    snapshot=s;received=now();
    if(first){popup='';popupUntil=0;lastEvent=event?.event_id??null;}
    else if(event?.combo_award&&event.event_id!==lastEvent){
      lastEvent=event.event_id;popup=`+${scoreText(event.combo_award.action_score_units)}점`;popupUntil=now()+900;
    }
    draw();
  }
  function draw(){
    const v=comboView(snapshot,now()-received);
    el('total').textContent=v.score;el('count').textContent=v.label;el('multiplier').textContent=`×${v.multiplier}`;
    el('source').textContent=({synthetic:'합성 시험',replay:'재생 시험',unknown:'입력 미확인'})[snapshot?.input_mode]??'';
    el('status').textContent=v.status;el('remaining').textContent=`${(v.remaining/1000).toFixed(1)}초`;
    el('fill').style.width=`${v.remaining/40}%`;root.querySelector('[role=progressbar]').setAttribute('aria-valuenow',(v.remaining/1000).toFixed(1));
    root.classList.toggle('paused',v.pause>0);root.classList.toggle('urgent',v.count>0&&v.remaining<1000);
    el('award').textContent=now()<popupUntil?popup:'';el('cleared').textContent=`철거 ${v.cleared}개 · 목표 80%`;
    return v;
  }
  return {accept,update,draw,snapshot:()=>snapshot};
}
