import './style.css';
import { GameController, SINGLE_GATES } from '../game/controller.js';
import { DisplayTransform } from './display-transform.js';
import { FrameCoordinator } from './frame-coordinator.js';
import { VideoReceiver } from './video-receiver.js';
import { ControlLink } from './control-link.js';
import { FractureView } from './fracture-view.js';
import { LogBuffer } from './log-buffer.js';
import {RoomInputLink, PairedReceiver} from '../phone-game/input.js';
import {attachHitDetector} from './hit-detector.js';
import {createHitSound} from './hit-sound.js';

const $=id=>document.getElementById(id), canvas=$('background'), ctx=canvas.getContext('2d'), logs=new LogBuffer();
const landmarks=$('landmarks'),poseCtx=landmarks.getContext('2d');
const phoneInput=document.body.dataset.input==='phone-pose';
let source='live',processor=phoneInput?async(_resource,meta)=>({...meta,wrists:meta.phone_pose.wrists,inference:{delegate:'phone'}}):null,view,sceneReady=false,game,coordinator,transform,binding=null;
let runId=0,transformVersion=0,frameId=0,previewTimer=null,latest=null,videoState='disconnected',controlAlive=false,message=null;
let imageWidth=640,imageHeight=480,lastFrameAt=-Infinity,lastTick=performance.now(),lastUi=0,renderCount=0,renderFps=0,metricAt=lastTick;
let connectionState='disconnected',disposed=false,animationId;
let sessionFramePendingUntil=0;
const poseListeners=new Set();

function log(entry){const record={...entry,observed_at_pc_ms:performance.now(),config_version:'single-monitor-1',model_version:'knu-it1-v3'};logs.add(record);if(source==='live'){link.send({type:'log',entry:record});if(entry.type==='ended')link.send({type:'end',session_id:entry.session_id,reason:entry.reason});}}
function makeGame(){return new GameController({source,onLog:log,
  validateHit:e=>e.building_id==='knu-it1-v3'&&e.transform_version===transformVersion&&view.target.contains(e.hit_point_image_norm),
  onHit:e=>view.destroy(e,transform)});}
function context(){return {...binding,run_id:runId,transform_version:transformVersion};}
function invalidate(){runId++;latest=null;lastFrameAt=-Infinity;coordinator?.configure(context());if(binding)game.bind(context());else game.clearInput();}
function resize(width=imageWidth,height=imageHeight){
  imageWidth=width;imageHeight=height;
  const rect=$('stage').getBoundingClientRect();
  transform=new DisplayTransform({imageWidth,imageHeight,width:rect.width,height:rect.height,rotation:Number($('rotation').value),mirror:$('mirror').checked});
  canvas.width=Math.max(1,Math.round(rect.width));canvas.height=Math.max(1,Math.round(rect.height));
  landmarks.width=canvas.width;landmarks.height=canvas.height;
  transformVersion++;invalidate();view?.resize(rect.width,rect.height,transform,transformVersion);
}
function gates(){game.setGates({control_bound:Boolean(binding)&&connectionState==='connected',control_alive:source==='synthetic'?controlAlive:link.alive(),
  selected_stream_live:videoState==='live',model_ready:source==='synthetic'||Boolean(processor),transform_ready:Boolean(transform),scene_ready:sceneReady});}
function matched(resource,meta,pose){
  if(disposed)return false;
  if(!game.setPose(pose)) {game.clearInput();return false;}
  sessionFramePendingUntil=0;
  latest={resource,meta,pose};lastFrameAt=meta.observed_at_pc_ms;
  if(message==='손목 추적을 준비하지 못했습니다. 다시 연결하세요.')message=null;draw();gates();
  for(const listener of poseListeners)try{listener(structuredClone(pose));}catch{game.clearInput();message='타격 입력 연결을 확인하세요.';}
  return true;
}
function draw(){
  ctx.resetTransform();ctx.fillStyle='#233028';ctx.fillRect(0,0,canvas.width,canvas.height);
  poseCtx.clearRect(0,0,landmarks.width,landmarks.height);
  if(!latest)return;
  transform.draw(ctx,latest.resource);
  for(const [joint,wrist] of Object.entries(latest.pose.wrists??{}))if(wrist?.valid&&wrist.visibility>=.5&&Array.isArray(wrist.image_norm)&&wrist.image_norm.length===2&&wrist.image_norm.every(v=>Number.isFinite(v)&&v>=0&&v<=1)){
    const [x,y]=transform.toScreen(wrist.image_norm);poseCtx.beginPath();poseCtx.arc(x,y,7,0,Math.PI*2);poseCtx.fillStyle=joint==='left_wrist'?'#f5bb73':'#94ddf3';poseCtx.fill();
  }
}
function makeCoordinator(){return new FrameCoordinator({process:async(resource,meta)=>{
  if(source==='synthetic')return {...meta,wrists:{left_wrist:{valid:true,image_norm:[.32,.42],visibility:1},right_wrist:{valid:true,image_norm:[.68,.42],visibility:1}}};
  if(!processor)return {...meta,tracking_state:'loading',wrists:{left_wrist:{valid:false,image_norm:null,visibility:0,reason:'pose_adapter_missing'},right_wrist:{valid:false,image_norm:null,visibility:0,reason:'pose_adapter_missing'}}};
  return processor(resource,meta);
},onMatched:matched,onInvalid:()=>{game.clearInput();message='손목 추적을 준비하지 못했습니다. 다시 연결하세요.';}});}
function receiveFrame(resource,meta){
  if(disposed||!binding||meta.room_id!==binding.room_id||meta.stream_id!==binding.stream_id){resource.close?.();return;}
  if(meta.image_width!==imageWidth||meta.image_height!==imageHeight)resize(meta.image_width,meta.image_height);
  coordinator.submit(resource,{...meta,...context(),schema:'single_camera.v1-draft',session_id:game.sessionId,tracking_mode:'single_view_2d',source,task_type:'pilot'});
}
const receiver=new (phoneInput?PairedReceiver:VideoReceiver)({video:$('remote-video'),onFrame:receiveFrame,
  onState:s=>{videoState=s.state;if(s.reason)message=s.reason;if(s.state!=='live'&&game)invalidate();},
  sendSignal:m=>link.send(m,'signaling')});
const link=new (phoneInput?RoomInputLink:ControlLink)({receiver,onStatus:s=>{
  const wasAlive=controlAlive;
  connectionState=s.state;controlAlive=s.alive;
  if(s.message)message=s.message;
  else if(phoneInput&&s.alive&&!wasAlive)message=null;
  if(!s.alive&&game)invalidate();
  $('join').hidden=!s.join_url;
  if(s.join_url)$('join').textContent='휴대폰에서 열 주소: '+s.join_url;
},onMessage:m=>{
  if(m.type==='stream_bound'){binding={room_id:m.room_id,stream_id:m.stream_id,server_epoch:m.server_epoch};invalidate();}
  if(m.type==='session_lost')game.abort(m.reason);
  if(phoneInput&&m.type==='server_game'&&m.game.session_id===game.sessionId){
    if(Number.isFinite(m.game.score))game.score=m.game.score;
    if(m.game.state==='playing')game.endsAt=Math.min(game.endsAt,performance.now()+m.game.remaining_ms);
  }
}});
game=makeGame();coordinator=makeCoordinator();

function stop(){
  if(phoneInput)game.abort('manual_stop');
  clearInterval(previewTimer);previewTimer=null;link.stop();binding=null;
  controlAlive=false;connectionState='disconnected';videoState='disconnected';invalidate();gates();draw();
}
function syntheticFrame(){
  if(source!=='synthetic'||!binding||disposed)return;
  const image=document.createElement('canvas');image.width=640;image.height=480;
  const c=image.getContext('2d');c.fillStyle='#dce6dd';c.fillRect(0,0,640,480);
  c.strokeStyle='#a3b8a7';for(let x=0;x<=640;x+=80){c.beginPath();c.moveTo(x,0);c.lineTo(x,480);c.stroke();}for(let y=0;y<=480;y+=80){c.beginPath();c.moveTo(0,y);c.lineTo(640,y);c.stroke();}
  c.fillStyle='#304d39';c.font='22px sans-serif';c.fillText('SYNTHETIC / NOT CAMERA INPUT',24,440);
  image.close=()=>{image.width=image.height=0;};
  receiveFrame(image,{...binding,frame_id:++frameId,image_width:640,image_height:480,observed_at_pc_ms:performance.now(),media_time_s:frameId*.08,capture_time:null});
}
function setMode(next){
  endGame('mode_change');
  game.abort('mode_change');stop();coordinator.dispose();source=next;message=null;frameId=0;
  game=makeGame();coordinator=makeCoordinator();view?.reset();
  $('sample-hit').hidden=source!=='synthetic';$('connect').disabled=$('stop').disabled=source!=='live';
  if(source==='synthetic'){
    binding={room_id:'synthetic-local',stream_id:crypto.randomUUID(),server_epoch:'local-test'};
    connectionState='connected';controlAlive=true;videoState='live';invalidate();resize(640,480);gates();syntheticFrame();
    previewTimer=setInterval(syntheticFrame,80);
  }else{resize(640,480);gates();}
}
async function start(){
  gates();message=null;
  const ok=await game.start(request=>source==='synthetic'?{...request,type:'start_ack'}:link.requestStart(request));
  if(ok){sessionFramePendingUntil=performance.now()+game.ttlMs;invalidate();}else if(game.reason)message=({start_timeout:'시작 승인 시간이 초과됐습니다. 다시 시도하세요.',ack_mismatch:'시작 승인 정보가 맞지 않습니다.',readiness_lost:'입력이 끊겨 시작하지 않았습니다.'})[game.reason]??'시작하지 못했습니다. 연결을 확인하세요.';
}
function endGame(reason){
  if(source!=='live')return;
  const sessionId=game.sessionId??game.pendingRequest?.session_id;
  if(sessionId)link.send({type:'end',session_id:sessionId,reason});
  if(game.pendingRequest)link.cancelStart(game.pendingRequest.request_id);
}
function reset(){endGame('reset');game.reset();view?.reset();message=null;invalidate();gates();}
function sampleHit(){
  if(source!=='synthetic'||!game.pose||!game.pairs.left_wrist)return;
  const area=t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]));
  const triangle=view.target.triangles.reduce((best,t)=>!best||area(t)>area(best)?t:best,null);if(!triangle)return;
  const point=[0,1].map(i=>(triangle[0][i]+triangle[1][i]+triangle[2][i])/3);
  return acceptHit({...context(),schema:'single_camera.v1-draft',type:'hit',session_id:game.sessionId,event_id:crypto.randomUUID(),
    tracking_mode:'single_view_2d',source:'synthetic',task_type:'pilot',building_id:'knu-it1-v3',joint:'left_wrist',
    previous_frame_id:game.pairs.left_wrist[0],frame_id:game.pose.frame_id,hit_point_image_norm:point,speed_norm_per_s:1.2,hit_point_m:null,speed_mps:null});
}
function acceptHit(event){gates();return game.acceptHit(event,{visible:!document.hidden});}
function updateUi(now){
  gates();const s=game.snapshot(),fresh=now-lastFrameAt<200;
  if(!fresh)poseCtx.clearRect(0,0,landmarks.width,landmarks.height);
  $('source-badge').textContent=source==='synthetic'?'합성 입력 시험 · 실제 촬영 아님':'실제 입력 · '+(videoState==='live'?'영상 수신 중':'연결 대기');
  $('video-state').textContent=({live:'수신 중',connecting:'연결 중',stalled:'영상 끊김',failed:'연결 실패',disconnected:binding?'연결 끊김':'연결 전'})[videoState]??'대기';
  $('pose-state').textContent=source==='live'&&!processor?'추적 모듈 연결 대기':game.fresh()?'손목 수신 중':'손목 대기/만료';
  $('scene-state').textContent=sceneReady?'IT1 · 준비됨':'준비 중';$('time').textContent=Math.ceil(s.remainingMs/1000)+'s';$('score').textContent=s.score;
  $('fragments').textContent=(view?.dynamic.length??0)+' / 96';
  $('start').disabled=!s.ready||!['idle','ready'].includes(s.phase);$('reset').disabled=!sceneReady;
  $('sample-hit').disabled=s.phase!=='playing'||!s.ready||!game.pairs.left_wrist||view?.target.active===false;
  $('mirror').disabled=$('rotation').disabled=['playing','starting'].includes(s.phase);
  $('overlay-label').textContent=source==='synthetic'?'합성 입력 · 화면 2D 시험':fresh?'1대 · 화면 2D 판정':'휴대폰 영상·손목 대기';
  $('scope').textContent=source==='synthetic'?'합성 손목/이벤트로 PC 화면과 게임을 검사합니다. 실제 손동작 충돌을 검증한 결과가 아닙니다.':phoneInput?`${link.roomId==='room-2'?'방 2':'방 1'} C0 폰 좌표 · 동일 프레임의 서버 중계 영상으로 2D 타격합니다. PC 재추론과 실제 깊이 계산은 하지 않습니다.`:'화면상 2D 판정입니다. 실제 깊이를 측정하지 않습니다. 폰 송신·신호 서버·추적 모듈 연결이 필요합니다.';
  const awaitingSessionFrame=now<sessionFramePendingUntil&&SINGLE_GATES.every(key=>game.gates[key]===true);
  $('status').textContent=message||(s.phase==='ended'?'플레이가 끝났습니다. 복원 후 새로 시작하세요.':s.phase==='starting'?'시작 승인을 기다립니다.':s.phase==='playing'?!s.ready?awaitingSessionFrame?'게임 시작 후 첫 손목 입력을 기다립니다.':'입력이 끊겼습니다. 타격은 중단되고 시간은 계속 흐릅니다.':s.score?'건물이 부서졌습니다. 복원하면 새 게임을 시작합니다.':'손목 타격 이벤트를 기다립니다.':s.ready?'준비됐습니다. 시작하세요.':source==='live'&&!processor?'휴대폰 연결과 손목 추적 모듈을 준비하세요.':'영상·손목·건물을 준비하고 있습니다.');
  $('performance').textContent=`화면 ${renderFps.toFixed(0)} fps · 정합 프레임 ${coordinator.stats.processed} · 폐기 ${coordinator.stats.dropped} · 로그 손실 ${logs.dropped}`;
}
function frame(now){
  if(disposed)return;view?.render((now-lastTick)/1000);lastTick=now;renderCount++;
  if(now-metricAt>=1000){renderFps=renderCount*1000/(now-metricAt);renderCount=0;metricAt=now;}
  if(now-lastUi>=100){lastUi=now;updateUi(now);}animationId=requestAnimationFrame(frame);
}
$('mode').addEventListener('change',e=>setMode(e.target.value));$('connect').addEventListener('click',()=>{message=null;void link.connect();});
$('stop').addEventListener('click',stop);$('start').addEventListener('click',start);$('reset').addEventListener('click',reset);$('sample-hit').addEventListener('click',sampleHit);
for(const id of ['mirror','rotation'])$(id).addEventListener('change',()=>{resize();draw();});
$('download').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({...logs.export(),source,tracking_mode:'single_view_2d',frames:coordinator.stats},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='single-camera-log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.addEventListener('visibilitychange',()=>{invalidate();});
window.addEventListener('pagehide',()=>{endGame('pagehide');game.abort('pagehide');disposed=true;cancelAnimationFrame(animationId);stop();coordinator.dispose();observer.disconnect();view?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted&&disposed)location.reload();else $('mode').value=source;});
const observer=new ResizeObserver(()=>{resize();draw();});observer.observe($('stage'));
// Public handoff surface for the separate pose/hit modules; no test-only live bypass.
window.singleCameraMonitor=Object.freeze({
  attachPoseProcessor(fn){if(typeof fn!=='function')throw new Error('invalid_processor');processor=fn;invalidate();return ()=>{if(processor===fn){processor=null;invalidate();}};},
  onPoseFrame(listener){if(typeof listener!=='function')throw new Error('invalid_listener');poseListeners.add(listener);return ()=>poseListeners.delete(listener);},
  acceptHit,
  receiveSignal:m=>receiver.receive(m),
  getContext:()=>({...context(),session_id:game.sessionId,tracking_mode:'single_view_2d',source,task_type:'pilot'}),
  getTarget:()=>view?structuredClone(view.target.snapshot()):null,
  snapshot:()=>({...game.snapshot(),sceneReady,videoState,frameStats:{...coordinator.stats},runId,transformVersion,...view?.snapshot()}),
});
async function init(){try{view=new FractureView($('scene'));await view.load();sceneReady=true;resize();gates();}catch(error){message='건물 준비 실패: '+error.message;console.error(error);view?.dispose();view=null;}requestAnimationFrame(frame);}
if(phoneInput){
  const back=$('room-back');back.href=`/monitor/${link.roomId}/`;back.textContent=`${link.roomId==='room-2'?'방 2':'방 1'} 카메라 테스트`;
  $('room-intro').textContent=link.roomId==='room-2'?'방 2는 C0 한 대만 서버 중계로 연결하세요. 폰에서 계산한 손목으로 영상 위 IT 1호관을 타격합니다.':'방 1의 C0·C1·C2를 연결하고 C0는 서버 중계를 선택하세요. C0 폰에서 계산한 손목으로 영상 위 IT 1호관을 타격합니다.';
  $('connect').disabled=false;
  const sound=createHitSound();sound.prepare();
  const hit=attachHitDetector(window.singleCameraMonitor,{onResult:(event,result)=>{if(result.accepted)sound.play(event);}});
  const unlock=()=>{void sound.unlock().catch(()=>{});};document.addEventListener('pointerdown',unlock,true);
  window.addEventListener('pagehide',()=>{hit.dispose();sound.dispose();document.removeEventListener('pointerdown',unlock,true);},{once:true});
}
void init();
