import * as THREE from 'three';
import {createComboHud} from './combo-hud.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLink } from '/test/multi3d/link.js?v=20261109-6';
import { placementToThree } from '/shared/model-strike-3d.js';
import './style.css';
import './physics-style.css';
import { FragmentPhysics, initPhysics, DEFAULT_PHYSICS } from './fragment-physics.js';
import {fetchScene,loadModels,assembleScene} from './scene-loader.js';
import {disposeRoots} from '../game/dispose-roots.js';
import {TrackedPerson} from './tracked-person.js';
import {PersonOcclusion,loadOcclusionTexture} from './person-occlusion.js';
import {createRtcReceiver} from '/test/stage-view/rtc.js?v=20261120-r1';
import {createPcOutline} from '/test/stage-view/pc-outline.js?v=20261120-r1';
import {createSuperFeedback} from './super-smash-feedback.js';
import {DEFAULT_FEEDBACK,FEEDBACK_PRESETS} from './feedback-presets.js';
import {createArHitEffect} from '/shared/ar-hit-effect.js?v=20261121-ar-feedback-2';
import {createArHitSound} from '/shared/ar-hit-sound.js?v=20261121-ar-sound-1';
const STRIKE_JOINTS=['left_wrist','right_wrist','left_ankle','right_ankle'],JOINT_LABELS={left_wrist:'왼손',right_wrist:'오른손',left_ankle:'왼발',right_ankle:'오른발'};

const $ = id => document.getElementById(id);
const mode=new URLSearchParams(location.search).get('mode');
// wide: three single-camera phones side by side on markers ID0/ID1/ID2 (docs/WIDE_STAGE_TEST.md).
// duo: two judging phones on ID0/ID1 plus a view-only phone V on the far side; V's video is the main screen
// (docs/DUO_STAGE_TEST.md). `wide` covers both stages; `duo` only what differs.
const mono=mode==='mono',duo=mode==='duo',wide=mode==='wide'||duo,approx=mono||wide;
$('superPanel').hidden=approx;
$('sourceMode').textContent=mono?'카메라 1대 · 근사 3D · source=mono_approx':duo?'판정 폰 2대 + 화면 폰 · 2대 무대 · 폰별 근사 3D · source=mono_approx':wide?'카메라 3대 가로 · 넓은 무대 · 폰별 근사 3D · source=mono_approx':'카메라 3대 · 삼각측량 · source=multi_view_test';
$('occlusionControl').hidden=false;
if(mono){document.body.classList.add('mono-mode');$('legacyLink').href='/test/mono3d/view.html';$('legacyLink').textContent='기존 1대 상자 시험';
  $('depthControl').hidden=false;$('trackingDiagnosis').hidden=false;
  $('occlusionControl').hidden=false;
  $('phoneHelp').innerHTML='폰에서 <a href="/test/mono3d/">1대 근사 3D 시험</a>을 열고 마커 보정 → 몸 보정 → 측정까지 진행하세요. PC 화면으로 보내기를 켜면 됩니다. 깊이는 근사값입니다.';}
if(wide){document.body.classList.add('wide-mode');$('legacyLink').hidden=true;
  $('depthControl').hidden=false;$('trackingDiagnosis').hidden=false;$('stageControl').hidden=false;$('autoNextControl').hidden=false;
  $('placement').hidden=true;$('buildingSize').hidden=true;
  // Stage defaults (2026-11-20, user): next building after a break; pieces do not collide with the standing building.
  // (Whole-building blast and support collapse are off on the server for stages; the checkboxes follow its state.)
  $('autoNext').checked=true;
  if(duo){document.body.classList.add('duo-mode');$('stageSpacing').value=2;$('stageTitle').textContent='2대 무대 · A3 마커 2장 + 반대편 화면 폰';
    $('stageHint').textContent='ID0(C0)·ID1(C1) 마커를 같은 방향(무늬 위쪽=판정 폰에서 먼 쪽)으로 왼쪽부터 일직선에 놓으세요. 간격은 정해져 있지 않습니다(0.5~3m): 자동 적용이 켜져 있으면 화면 폰이 두 마커로 잰 간격을 그대로 씁니다. 끄면 줄자로 잰 간격을 넣으세요. 판정 폰은 각자 자기 마커 앞(높이 두고 내려다봐도 됨), 화면 폰은 반대편에서 두 마커가 모두 보이게 가로로 둡니다.';
    $('autoSpacingRow').hidden=false;$('autoRotationRow').hidden=false;$('viewTransport').hidden=false;$('duoSuperRow').hidden=false;
    $('captureBody').textContent='판정 폰 몸 보정 시작 · 허리 기준 고정';}
  $('phoneHelp').innerHTML=duo?'판정 폰 2대에서 <a href="/test/mono3d/?stage=duo&camera=C0">C0</a>·<a href="/test/mono3d/?stage=duo&camera=C1">C1</a> 2대 무대 페이지를 열고 각자 자기 번호 A3 마커(ID0 왼쪽·ID1 오른쪽)로 마커 보정 → 몸 보정 → 측정까지 진행하세요. 반대편 폰은 <a href="/test/stage-view/">화면 폰</a> 페이지를 가로로 열어 두 마커를 한 번에 인식합니다. 그 영상이 위쪽 메인 화면입니다.':'폰 3대에서 <a href="/test/mono3d/?stage=wide&camera=C0">C0</a>·<a href="/test/mono3d/?stage=wide&camera=C1">C1</a>·<a href="/test/mono3d/?stage=wide&camera=C2">C2</a> 넓은 무대 페이지를 열고, 각자 자기 번호 마커(ID0·ID1·ID2)로 마커 보정 → 몸 보정 → 측정까지 진행하세요. 사람이 있는 구간의 폰이 판정합니다. 깊이는 폰별 근사값입니다.';}
// Duo PC side panel (2026-11-24, user: settings were duplicated/mixed): the same controls, regrouped into
// building/score, how hits break, stage/phones, and a closed physics/test group. Ids and handlers are unchanged.
if(duo)(function organizeDuoPanel(){
  const aside=$('sceneTitle').parentElement,labelOf=id=>$(id).closest('label');
  const group=(title,open,...nodes)=>{const d=document.createElement('details');d.className='duo-group';d.open=open;
    d.innerHTML=`<summary>${title}</summary>`;for(const n of nodes)if(n)d.append(n);return d;};
  const sub=text=>Object.assign(document.createElement('h4'),{textContent:text});
  const normalNote=Object.assign(document.createElement('small'),{id:'duoNormalNote'});
  $('depthControl').firstChild.textContent='판정 앞뒤 오차 허용 (m)';
  // Look everything up while it is still in the document (getElementById misses detached nodes).
  $('sceneControl').append($('autoNextControl'));
  const building=group('건물 · 점수',true,$('sceneControl'),$('dimensions'),$('count'),$('score'),$('restore'));
  const hits=group('타격 방식',true,sub('슈퍼 연출'),$('duoSuperRow'),sub('일반 타격 (슈퍼 연출을 끄면 적용)'),normalNote,
    labelOf('blastMode'),labelOf('blastRadius'),labelOf('collapse'),labelOf('impactBreak'),labelOf('pushStrength'),
    sub('판정'),$('depthControl'),$('trackingDiagnosis'),$('contact'));
  const stage=group('무대 · 폰 배치',true,$('stageControl'),$('personStatus'),$('occlusionControl'),$('phoneHelp'));
  const notes=[...aside.querySelectorAll(':scope>p:not([id])')];
  const physicsGroup=group('물리 · 시험 (개발용)',false,labelOf('interactionDistance'),$('physics'),notes.at(-1));
  $('bodyReference').hidden=true;for(const p of notes.slice(0,-1))p.hidden=true;   // 3-camera text / repeated height
  $('sceneTitle').after(building,hits,stage,physicsGroup);
})();
// 1 camera: one building at a time, chosen from a list (IT1 or any single building). 3 cameras: zones of several
// buildings; ?scene=it1 keeps the single IT1 building there.
const keepSingleBuilding=!wide&&new URLSearchParams(location.search).get('scene')==='it1';let zoneRequested=mono||wide||keepSingleBuilding,zonesReady=false;
$('sceneControl').hidden=!mono&&keepSingleBuilding;
if(mono){$('sceneLabel').textContent='건물 선택';$('autoNextControl').hidden=false;
  // 1-camera defaults (2026-11-22, user): next building on, pieces do not collide with the standing building,
  // no extra breaks from piece impacts. Whole-building blast and support collapse are off on the server.
  $('autoNext').checked=true;$('impactBreak').checked=false;}
let loadedScene=null,loadingScene=null,loadGeneration=0,scenePending=false,ownedRoots=[];
let failedScene=null,sceneBuildings=[];
let sceneDimensions=[2.810118,1.0844383,.6256438],buildingCount=1,fixedSize=false;
let ready = false, connected = false, fatal = null, state = null, epoch = null;
let viewerId=null,controlPending=null,controlSeq=0,pauseWanted=false,localStopped=false,lastPresentationAt=-Infinity,lastPresentationKey='';
let comboHud=null,comboNextEpoch=null,comboReadyEpoch=null;
let duoPreload=null;
function discardDuoPreload(){
  const old=duoPreload;duoPreload=null;if(!old)return;
  old.discarded=true;if(old.data)disposeRoots(old.data.models.map(g=>g.scene));
}
function prewarmDuoScene(id){
  if(!duo||!id||id===loadedScene||duoPreload?.id===id)return;
  discardDuoPreload();
  const pending={id,data:null,discarded:false};duoPreload=pending;
  pending.promise=fetchScene(id).then(async spec=>{
    const models=await loadModels(spec);
    if(pending.discarded){disposeRoots(models.map(g=>g.scene));return null;}
    return pending.data={spec,models};
  }).catch(error=>{if(!pending.discarded)console.warn('Next scene preload deferred',error);return null;});
}
let frameAt = 0, lastJoints = {}, physics = null, colliderData = null;
let personJoints={},personAt=-Infinity;
let previousNow=0, reportAt=0, frameCount=0, reportFrames=0, fps=0, renderMs=0;
let stageOwner=null,stageSpacing=null,stageBorrowed={};
let impactQueue=new Set(),impactSentAt=0;
let sizeDirty=false;
const toggleDrafts=new Map();
function sendToggle(id,message){
  toggleDrafts.set(id,{value:$(id).checked,at:performance.now()});
  if(!link.send(message))toggleDrafts.delete(id);
}
function syncToggle(id,value){
  const draft=toggleDrafts.get(id);
  if(draft&&draft.value!==value&&performance.now()-draft.at<2000)value=draft.value;
  else toggleDrafts.delete(id);
  $(id).checked=value;
}
// AR hit feedback (PR #22 module): only the server's accepted strikes (joint or mouse demo) play it, once per event_id.
// The effect is drawn on each view in stage coordinates; it never changes judging, score or fragments.
const HIT_EFFECT_KINDS=new Set(['wrist','ankle','mouse']);
const hitEffect=createArHitEffect(),hitSound=createArHitSound({button:$('sound')});
let lastEventId=null,eventsArmed=false,outerBase=null;
window.__arHitEffect=Object.freeze({snapshot:()=>hitEffect.snapshot()});
function effectOverlay(container){
  const canvas=Object.assign(document.createElement('canvas'),{className:'hit-effect'});
  canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  container.append(canvas);return {canvas,ctx:canvas.getContext('2d')};
}
function observeHit(m){
  const e=m.event,id=e?.event_id??null;
  // The first state after (re)connecting may repeat an old event: it only sets the baseline.
  if(!eventsArmed){eventsArmed=true;lastEventId=id;return;}
  if(!id||id===lastEventId)return;lastEventId=id;
  // Chain-explosion mode (3 cameras) has its own full-screen effect and sound; do not stack this one on top.
  if(m.smash_mode==='super_smash'||!HIT_EFFECT_KINDS.has(e.kind)||!m.bounds)return;
  // Duo sweep: the server breaks a swing's path frame by frame; only its first hit (swing_start) plays.
  if(e.swing_start===false)return;
  const {lo,hi}=m.bounds,building={center:lo.map((v,i)=>(v+hi[i])/2),half:lo.map((v,i)=>(hi[i]-v)/2)};
  if(hitEffect.trigger(e.point_m,building))hitSound.hit();
}
function drawHitEffect(s,camera,container,now){
  const o=s.effect,w=container.clientWidth,h=container.clientHeight,r=devicePixelRatio||1;
  if(o.canvas.width!==Math.round(w*r)||o.canvas.height!==Math.round(h*r)){o.canvas.width=Math.round(w*r);o.canvas.height=Math.round(h*r);}
  o.ctx.setTransform(1,0,0,1,0,0);o.ctx.clearRect(0,0,o.canvas.width,o.canvas.height);
  if(!s.outer.visible||!w||!h)return;
  o.ctx.setTransform(r,0,0,r,0,0);
  const v=new THREE.Vector3();
  hitEffect.draw(o.ctx,p=>{
    if(v.fromArray(p).applyMatrix4(camera.matrixWorldInverse).z>=-.01)return null; // behind the camera
    v.fromArray(p).project(camera);return [(v.x+1)/2*w,(1-v.y)/2*h];
  },now);
}
// 1-camera fixed buildings (2026-11-22): 0.6~0.7 m tall, within 1.0 m x 0.75 m; body capture does not resize them.
const MONO_FIXED_TEXT='1대 고정 크기 · 높이 0.6~0.7m · 가로 1m·깊이 0.75m 이내 · 몸 보정과 무관';
const monoFixed=()=>mono&&typeof loadedScene==='string'&&loadedScene.startsWith('single:');
function previewSize(){
  const scale=Number($('scale').value);
  if(monoFixed()){$('sizePreview').textContent=MONO_FIXED_TEXT;return;}
  if(wide){$('sizePreview').textContent='무대 세트 크기 · 몸 보정과 무관 · 마커 간격에 맞춰 배치';return;}
  if(state?.body_reference){$('sizePreview').textContent=`최고 높이 ${state.display_height_m.toFixed(2)}m · 최초 허리의 70% · 구역 내 비율 유지`;return;}
  if(fixedSize){$('sizePreview').textContent='몸 보정 후 최고 높이를 허리의 70%로 고정 · 구역 내 비율 유지';return;}
  if(!Number.isFinite(scale)||scale<.1||scale>2){$('sizePreview').textContent='배율을 0.1~2 사이로 입력하세요.';return;}
  $('sizeRange').value=scale;
  $('sizePreview').textContent=`적용 예정 · 높이 약 ${(sceneDimensions[1]*scale).toFixed(2)}m · 폭 ${(sceneDimensions[0]*scale).toFixed(2)}m · 깊이 ${(sceneDimensions[2]*scale).toFixed(2)}m`;
}
const physicsOptions={...DEFAULT_PHYSICS};
if(wide||mono){physicsOptions.building=false;document.querySelector('[data-physics="building"]').checked=false;}   // stage default (2026-11-20), 1-camera (2026-11-22)
// Pieces on the floor disappear after 2 s (2026-11-24, user): 1 camera and the stages; 3 cameras keep them.
// 2-camera super smash (2026-11-25, user): pieces fly at about a third of the speed so the collapse stays on V.
if(duo)physicsOptions.superSpeed=.35;
if(wide||mono){physicsOptions.vanish=true;document.querySelector('[data-physics="vanish"]').checked=true;}
const scenes = [], pieces = new Map(), cameras = new Map();
const status = text => { $('status').textContent = text; };
function scene() {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.5));
  const l = new THREE.DirectionalLight(0xffffff, 2); l.position.set(1,-2,4); s.add(l);
  const outer = new THREE.Group(); outer.scale.setScalar(.6); s.add(outer);
  // Wrists (blue/orange) and ankles (green/purple): the four joints that can strike the building.
  const wrists = STRIKE_JOINTS.map((_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.025,12,8),new THREE.MeshBasicMaterial({color:[0x38bdf8,0xfb923c,0x4ade80,0xc084fc][i]}));
    m.visible=false; s.add(m); return m;
  });
  const item = { scene:s, outer, wrists, nodes:new Map() }; scenes.push(item); return item;
}
function renderer(container, alpha=false) {
  const r = new THREE.WebGLRenderer({ antialias:true, alpha }); r.setPixelRatio(Math.min(devicePixelRatio,2));
  r.setClearColor(0x080c14,alpha?0:1); container.append(r.domElement); return r;
}
const orbit = scene(); const trackedPerson=new TrackedPerson(orbit.scene);orbit.renderer = renderer($('orbit'));
orbit.camera = new THREE.PerspectiveCamera(45,1,.01,50); orbit.camera.up.set(0,0,1); orbit.camera.position.set(2,-3,2);
$('orbit').style.position='relative';orbit.effect=effectOverlay($('orbit'));
const controls = new OrbitControls(orbit.camera,orbit.renderer.domElement); controls.target.set(0,0,.35); controls.update();
let pointerDown=null;
orbit.renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0)pointerDown={x:e.clientX,y:e.clientY,id:e.pointerId};});
orbit.renderer.domElement.addEventListener('pointercancel',()=>{pointerDown=null;});
orbit.renderer.domElement.addEventListener('pointermove',e=>{if(pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>5)pointerDown=null;});
orbit.renderer.domElement.addEventListener('pointerup',e=>{
  const down=pointerDown;pointerDown=null;
  if(!down||down.id!==e.pointerId||e.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5||!ready||!connected||scenePending||!state||!$('mouseMode').checked)return;
  const box=orbit.renderer.domElement.getBoundingClientRect(),raycaster=new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2((e.clientX-box.left)/box.width*2-1,1-(e.clientY-box.top)/box.height*2),orbit.camera);
  orbit.scene.updateMatrixWorld(true);
  const hit=raycaster.intersectObjects([...orbit.nodes.values()],true)[0];
  if(!hit){$('contact').textContent='빗나감 · 파편을 클릭하세요';return;}
  const id=hit.object.userData.fragmentId,strength=Number($('pushStrength').value),direction=raycaster.ray.direction.toArray();
  if(state.removed_ids.includes(id))link.send({type:'multi3d_model_push',fragment_id:id,point_m:hit.point.toArray(),direction,strength});
  else link.send({type:'multi3d_model_mouse',origin:raycaster.ray.origin.toArray(),direction,strength});
});
const grid = new THREE.GridHelper(6,12,0x475569,0x253046); grid.rotation.x=Math.PI/2; orbit.scene.add(grid);
// Actual marker square: identical z=0, side .20m reference as the phone calibration.
const markerGeometry=new THREE.BufferGeometry().setFromPoints([[-.1,.1,0],[.1,.1,0],[.1,-.1,0],[-.1,-.1,0]].map(p=>new THREE.Vector3(...p)));
const markers=new THREE.Group();orbit.scene.add(markers);orbit.scene.add(new THREE.AxesHelper(.3));
// Wide stage: marker n (ID n, camera Cn) lies at x = (n - 1) * spacing.
function placeMarkers(spacing){
  markers.clear();for(const x of duo?[-spacing/2,spacing/2]:wide?[-spacing,0,spacing]:[0]){const m=new THREE.LineLoop(markerGeometry,new THREE.LineBasicMaterial({color:0x22c55e}));m.position.x=x;if(duo)m.scale.setScalar(1.35);markers.add(m);}   // duo: A3 sheets, 0.27 m square
}
placeMarkers(duo?2:1.5);
for (const id of (mono?['C0']:duo?['V','C0','C1']:['C0','C1','C2'])) {
  const div=document.createElement('div');div.className='camera';div.dataset.camera=id;
  const img=document.createElement('img');img.alt=`${id} 영상`;img.hidden=true;
  const label=document.createElement('span');label.textContent=`${id} 대기`;
  div.append(img);$('cameras').append(div);
  const s=scene();s.renderer=renderer(div,true);div.append(label);s.camera=new THREE.Camera();s.calibrated=false;
  Object.assign(s,{div,img,label,lastImage:0,jpegVersion:0});cameras.set(id,s);
  s.occlusion=new PersonOcclusion(s.scene);s.occlusionInputValid=false;s.effect=effectOverlay(div);
  // Duo main screen: V sends the real person's outline with a depth (its own segmentation); the judging phones'
  // joint bars hide what is behind the person only while that outline is missing.
  if(id==='V'){div.classList.add('main-view');s.isView=true;s.personProxy=new TrackedPerson(s.scene,{occluder:true});
    // WebRTC (2026-11-20): V's camera arrives directly; each new frame is drawn here and given to MediaPipe on the PC.
    s.rtcVideo=Object.assign(document.createElement('video'),{muted:true,playsInline:true,autoplay:true});
    s.rtcVideo.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    s.frame=document.createElement('canvas');s.frame.className='rtc-frame';s.frame.hidden=true;s.frameCtx=s.frame.getContext('2d');
    div.insertBefore(s.frame,s.renderer.domElement);div.append(s.rtcVideo);
    Object.assign(s,{rtcFrameAt:-Infinity,rtcFrames:0,rtcFps:0,outlineMs:null,viewCalib:null});
    // Full screen (2026-11-24, user): only this matched view, with the building's collapse and elapsed time on top.
    const full=Object.assign(document.createElement('button'),{type:'button',id:'viewFullscreen',className:'view-full-button',textContent:'전체화면'});
    const hud=Object.assign(document.createElement('div'),{id:'viewHud',className:'view-hud'});
    hud.innerHTML='<div class="hud-stats"><div><small>무너짐</small><b id="hudCollapse">0%</b></div><div><small>걸린 시간</small><b id="hudTime">0:00.0</b></div></div><div id="comboHud"></div><p id="hudNote"></p>';
    div.append(hud,full);full.onclick=toggleViewFull;
    comboHud=createComboHud($('comboHud'));
    const retry=Object.assign(document.createElement('button'),{type:'button',className:'combo-retry',textContent:'점수 초기화 · 다시 세우기'});
    div.append(retry);retry.onclick=()=>$('restore').click();}
}
// Duo full screen: the page (not the panel) goes full screen so the view keeps its own aspect ratio, centred.
function setViewFull(on){document.body.classList.toggle('view-full',on);const b=$('viewFullscreen');if(b)b.textContent=on?'전체화면 끝내기':'전체화면';}
function toggleViewFull(){
  if(document.body.classList.contains('view-full')){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});setViewFull(false);return;}
  setViewFull(true);document.documentElement.requestFullscreen?.().catch(()=>{});   // no Fullscreen API: still a page-filling view
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setViewFull(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('view-full'))setViewFull(false);});
// Time to break the current building: from its appearance (server age_ms, survives reloads) until the
// auto-next share of pieces is gone; then it stops. A new building or a restore starts it again.
const buildingTimer={key:null,startAt:0,doneAt:null};
const autoNextNeed=total=>Math.ceil(total*Math.min(100,Math.max(10,Number($('autoNextPercent').value)||80))/100);
function trackBuildingTimer(m){
  const key=`${m.scene_id}:${m.epoch}`,now=performance.now();
  if(buildingTimer.key!==key)Object.assign(buildingTimer,{key,startAt:now-(m.age_ms??0),doneAt:null});
  const total=m.fragment_count||0,removed=m.removed_ids?.length??0;
  if(buildingTimer.doneAt===null&&total>0&&removed>=autoNextNeed(total))buildingTimer.doneAt=now;
}
const clockText=ms=>{const t=Math.max(0,ms)/1000;return `${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;};
function viewHudText(now){
  const total=state?.fragment_count||0,removed=state?.removed_ids?.length??0;
  const percent=total?Math.round(removed/total*100):0,done=buildingTimer.doneAt!==null;
  const guard=state?.spawn_guard_ms>0?`새 건물 무적 ${(state.spawn_guard_ms/1000).toFixed(1)}초`:'';
  return {collapse:`${percent}%`,time:buildingTimer.key?clockText((done?buildingTimer.doneAt:now)-buildingTimer.startAt):'—',
    note:done?(autoNextTimer!==null?'무너뜨림 · 곧 다음 건물':'무너뜨림'):guard||`파편 ${removed}/${total}개`,done};
}
function updateViewHud(now){
  if(!duo)return;
  const t=viewHudText(now);$('hudCollapse').textContent=t.collapse;$('hudTime').textContent=t.time;$('hudNote').textContent=t.note;
  $('viewHud').classList.toggle('done',t.done);
  $('comboHud').hidden=state?.smash_mode==='super_smash';comboHud?.draw();
}
let previewRequest=0;
// Super feedback: the 3-camera mode on C0, and the duo stage (2026-11-24, user: on/off there too) on V's main view.
const FEEDBACK_CAMERA=duo?'V':'C0';
const feedback=approx&&!duo?null:createSuperFeedback({canvas:$('screenImpact'),
  onCancel:()=>{previewRequest++;physics?.stopSuper();},
  // 2-camera stage (2026-11-25, user): only its checkbox; the OS setting (Windows animations off) hid every piece.
  reduced:()=>duo?$('duoReduceMotion').checked:$('reduceMotion').checked||matchMedia('(prefers-reduced-motion: reduce)').matches,
  project:(point,{unclipped=false}={})=>{
    const c=cameras.get(FEEDBACK_CAMERA),onView=c?.calibrated&&(!duo||viewFresh());
    // Duo: no live V video -> draw on the 3D view instead, so the click demo works without phones.
    if((!onView&&!duo)||!point)return null;
    const cam=onView?c.camera:orbit.camera,el=onView?c.div:orbit.renderer.domElement;
    const p=new THREE.Vector3(...point).project(cam),box=el.getBoundingClientRect();
    return p.z>=-1&&p.z<=1&&(unclipped||(Math.abs(p.x)<=1&&Math.abs(p.y)<=1))?[box.left+(p.x+1)*box.width/2,box.top+(1-p.y)*box.height/2]:null;
  }});
$('effectPreview').onclick=async()=>{const request=++previewRequest;await feedback?.unlock();if(request!==previewRequest||document.hidden||localStopped||$('effectPreview').disabled)return;feedback?.preview();$('superResult').textContent='화면·소리 미리보기 · 무득점';};
$('feedbackStyle').onchange=()=>control('set_feedback',{feedback_selection:$('feedbackStyle').value});
$('playView').onclick=()=>{feedback?.cancel('view_change');document.body.classList.toggle('play-view');$('playView').textContent=document.body.classList.contains('play-view')?'운영 화면':'C0 플레이 화면';};
$('reduceMotion').onchange=()=>feedback?.cancel('motion_setting');
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>feedback?.cancel('motion_setting'));
$('superMute').onclick=()=>{const muted=$('superMute').getAttribute('aria-pressed')!=='true';$('superMute').setAttribute('aria-pressed',String(muted));feedback?.mute(muted);};
const unlockSuper=()=>feedback?.unlock();document.addEventListener('pointerdown',unlockSuper,{capture:true});
function viewFresh(){const c=cameras.get(FEEDBACK_CAMERA);return !!c?.calibrated&&performance.now()-c.lastImage<=500;}
function presentable(){if(duo)return ready&&connected&&!scenePending&&!loadingScene&&!document.hidden;const c=cameras.get(FEEDBACK_CAMERA);return ready&&connected&&!scenePending&&!loadingScene&&!localStopped&&!document.hidden&&c?.calibrated&&performance.now()-c.lastImage<=500;}
function control(action,extra={}){
  if(!state?.server_instance_id||!connected||controlPending)return false;
  const request_id=`${viewerId}:${++controlSeq}`;
  if(!link.send({type:'multi3d_model_control',request_id,server_instance_id:state.server_instance_id,
    expected_epoch:state.epoch,expected_control_revision:state.control_revision,action,...extra}))return false;
  controlPending={request_id,at:performance.now(),ack:null};return true;
}
function completeControl(){
  if(controlPending?.ack&&state?.model_revision>=controlPending.ack.model_revision){
    const ack=controlPending.ack;controlPending=null;
    if(!ack.accepted)$('superStatus').textContent=`요청 거부: ${ack.code}`;
    if(pauseWanted&&state.controller_viewer_id===viewerId){pauseWanted=false;control('pause');}
  }
}
function updateSuperUi(now){
  if(duo){updateDuoSuperUi();return;}
  if(!feedback||!state?.server_instance_id)return;
  const owner=state.controller_viewer_id===viewerId,superMode=state.smash_mode==='super_smash';
  $('smashMode').value=state.smash_mode;$('smashMode').disabled=!owner||!!controlPending;
  $('feedbackStyle').value=state.feedback_selection??DEFAULT_FEEDBACK;
  $('feedbackStyle').disabled=!owner||!!controlPending||(superMode&&state.phase==='cleared'&&(feedback.info().screen.active||physics?.superAt!==null));
  $('effectPreview').disabled=!!controlPending||(superMode&&state.phase==='cleared'&&physics?.superAt!==null);
  const armed=state.feedback_armed_selection,selection=state.feedback_selection;
  $('feedbackHint').textContent=armed&&armed!==selection?'준비된 이번 타격은 기존 연출 유지 · 변경은 다음 준비부터':selection==='shuffle'?'네 연출을 중복 없이 섞어서 재생':'한 번의 타격에 장면 전체 파괴';
  $('claimControl').disabled=!!controlPending||!!state.controller_viewer_id;
  $('superRestore').disabled=!owner||!!controlPending||!ready;
  $('superIt1').disabled=!owner||!!controlPending||!!loadingScene;
  $('superStop').disabled=!owner;
  $('superStop').textContent=state.phase==='paused'||localStopped?'재개':'중지';
  const reasons={normal:'일반 파괴',ready:'한 번 쳐 보세요',cleared:'전체 파괴 · 다시 세우기를 누르세요',paused:'중지됨',pc_not_ready:'C0 영상·운영 PC 준비 대기',three_cameras_required:'세 카메라 연결·보정·최신 입력 필요',clock_not_ready:'세 카메라 시계 교환 대기',input_not_aligned:'관절 시각 정렬 대기',move_outside_to_prepare:'손/발을 건물 밖으로 빼고 준비하세요',body_not_ready:'몸 보정 완료 대기',input_source_unknown:'입력 출처 확인 필요'};
  $('superStatus').textContent=controlPending?(now-controlPending.at>2000?'응답 확인 중…':'요청 처리 중…'):
    localStopped&&state.phase!=='paused'?'이 PC 중지 · 서버 상태 확인 필요':`${owner?'운영 PC':'관찰 PC'} · ${$('sceneTitle').textContent} · ${reasons[state.readiness?.reason]??state.phase} · ${state.readiness?.input_mode??'unknown'}`;
  if(superMode)$('superResult').textContent=state.phase==='cleared'?`${physics?.superQueue.length||physics?.superVisual.size||feedback.info().screen.active?(FEEDBACK_PRESETS[physics?.superPreset]?.label??'파괴 연출')+' 중':'전체 파괴'} · +${state.score}점`:state.phase==='paused'?`중지 · ${state.score}점`:'';
  for(const id of ['mouseMode','blastMode','blastRadius','pushStrength','collapse','stress','impactBreak','applySize'])if(superMode)$(id).disabled=true;
  if(superMode){for(const b of $('placement').querySelectorAll('input,button'))b.disabled=true;$('restore').disabled=!owner||!!controlPending;$('sceneSelect').disabled||=!owner||!!controlPending;}
  if(controlPending&&now-controlPending.at>2000&&!controlPending.queried){controlPending.queried=true;link.send({type:'multi3d_model_snapshot'});}
  const okay=presentable(),key=`${state.epoch}:${okay}`;
  if(owner&&(key!==lastPresentationKey||now-lastPresentationAt>1000)){
    const age=Math.max(0,now-(cameras.get('C0')?.lastImage??0));
    if(link.send({type:'multi3d_presentation',server_instance_id:state.server_instance_id,epoch:state.epoch,
      presentation_ready:okay,c0_frame_age_ms:age,visible:!document.hidden,assets_ready:ready&&!loadingScene,
      feedback_version:1,feedback_presets:Object.keys(FEEDBACK_PRESETS)})){
      lastPresentationAt=now;lastPresentationKey=key;
    }
  }
}
// Duo super smash: a plain on/off and preset choice (no operator lease, no 3-camera readiness gates).
function updateDuoSuperUi(){
  if(!state)return;
  const on=state.smash_mode==='super_smash',busy=on&&(feedback.info().screen.active||physics?.superAt!=null);
  if(document.activeElement!==$('duoSuper'))$('duoSuper').checked=on;
  if(document.activeElement!==$('duoFeedback'))$('duoFeedback').value=state.feedback_selection??DEFAULT_FEEDBACK;
  $('duoSuper').disabled=$('duoFeedback').disabled=!connected;$('duoSuperPreview').disabled=busy;
  // Normal-hit options do nothing while every hit breaks the whole set (drop_all is refused by the server).
  for(const id of ['blastMode','blastRadius','collapse','impactBreak','stress'])if(on)$(id).disabled=true;
  $('duoNormalNote').textContent=on?'슈퍼 연출 중에는 아래 일반 타격 설정을 쓰지 않습니다':'';
  const label=FEEDBACK_PRESETS[physics?.superPreset]?.label??'파괴 연출';
  $('duoSuperStatus').textContent=!on?'끔 · 일반 타격(부순 곳만)':
    state.phase==='cleared'?`${busy?label+' 중':'전체 파괴'} · +${state.score}점`:
    !viewFresh()?'켬 · V 영상 없음: 연출은 아래 3D 화면에 · 3D 화면 클릭(데모)도 전체 파괴':
    state.spawn_guard_ms>0?`켬 · 새 건물 무적 ${(state.spawn_guard_ms/1000).toFixed(1)}초`:'켬 · 한 번 쳐 보세요';
}
if(duo){
  $('duoSuper').onchange=()=>{feedback.cancel('mode_change');physics?.stopSuper();link.send({type:'duo_super',enabled:$('duoSuper').checked});};
  $('duoReduceMotion').onchange=()=>feedback.cancel('motion_setting');
  const osReduce=matchMedia('(prefers-reduced-motion: reduce)'),showOsReduce=()=>{$('duoReduceHint').textContent=osReduce.matches?'Windows 애니메이션 효과가 꺼져 있지만 이 무대는 체크한 경우에만 동작을 줄입니다':'';};
  showOsReduce();osReduce.addEventListener('change',showOsReduce);
  $('duoFeedback').onchange=()=>link.send({type:'duo_super_feedback',feedback_selection:$('duoFeedback').value});
  // The header sound button (aria-pressed = sound on) also mutes the super feedback sound.
  $('sound').addEventListener('click',()=>feedback.mute($('sound').getAttribute('aria-pressed')!=='true'));
  $('duoSuperPreview').onclick=async()=>{const request=++previewRequest;await feedback.unlock();if(request!==previewRequest||document.hidden)return;feedback.preview({preset:$('duoFeedback').value});};
}
$('claimControl').onclick=()=>control('claim_controller');
$('superIt1').onclick=()=>{feedback?.cancel('scene_request');physics?.stopSuper();control('set_scene',{scene_id:'it1'});};
$('smashMode').onchange=()=>control('set_mode',{mode:$('smashMode').value});
$('superRestore').onclick=()=>{feedback?.cancel('reset_request');physics?.stopSuper();control('reset');};
$('superStop').onclick=()=>{
  if(state?.phase==='paused'||localStopped){localStopped=false;control('resume');}
  else{localStopped=true;feedback?.cancel('pause_request');physics?.stopSuper();pauseWanted=!control('pause');}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden){feedback?.cancel('hidden');physics?.stopSuper();}lastPresentationKey='';updateSuperUi(performance.now());});
function applyCalibration(c,m) {
  personJoints={};personAt=-Infinity;
  c.visualDepthValid=false;c.depthAt=-Infinity;
  c.jpegVersion++;c.occlusion?.clear();c.lastImage=0;c.img.hidden=true;
  const W=m.image.width,H=m.image.height,{fx,fy,cx,cy}=m.K,R=m.R,t=m.t,near=.01,far=50;
  if(c.isView)c.viewCalib={K:{fx,fy,cx,cy,width:W,height:H},pose:{R,t,C:m.C}};
  c.div.style.aspectRatio=`${W}/${H}`;
  c.div.style.setProperty('--camera-aspect',String(W/H));
  c.camera.projectionMatrix.set(2*fx/W,0,1-2*cx/W,0, 0,2*fy/H,2*cy/H-1,0,
    0,0,-(far+near)/(far-near),-2*far*near/(far-near), 0,0,-1,0);
  c.camera.projectionMatrixInverse.copy(c.camera.projectionMatrix).invert();
  // OpenCV camera x-right/y-down/z-forward -> Three x-right/y-up/z-backward.
  c.camera.matrixWorldInverse.set(R[0],R[1],R[2],t[0], -R[3],-R[4],-R[5],-t[1], -R[6],-R[7],-R[8],-t[2], 0,0,0,1);
  c.camera.matrixWorld.copy(c.camera.matrixWorldInverse).invert();c.camera.matrixAutoUpdate=false;c.camera.matrixWorldAutoUpdate=false;c.calibrated=true;
}
function syncState(m) {
  if(!m)return;
  if(m!==state&&duo&&m.combo&&!comboHud?.accept(m.combo))return;
  let superEvent=null;const isIncoming=m!==state;
  if(m!==state&&feedback){const result=feedback.accept(m,{presentable:presentable()&&loadedScene===m.scene_id});if(!result.accepted)return;superEvent=result.event;}
  state=m;
  if(duo&&m.combo&&isIncoming)comboHud?.update(m.combo,m.event);
  if(duo&&!m.combo)discardDuoPreload();
  completeControl();
  if(feedback&&m.smash_mode==='normal')for(const id of ['mouseMode','blastMode','blastRadius','pushStrength','collapse','impactBreak'])$(id).disabled=false;
  if(wide&&m.stage){stageOwner=m.stage.owner;if(stageSpacing!==m.stage.spacing_m){stageSpacing=m.stage.spacing_m;placeMarkers(stageSpacing);if(document.activeElement!==$('stageSpacing'))$('stageSpacing').value=stageSpacing;}
    if(stageListSpacing!==m.stage.spacing_m)loadStageList(m.stage.spacing_m).catch(showLoadError);}
  $('bodyReference').textContent=monoFixed()?(m.body_reference?'몸 보정 완료 · 깊이 추정에만 사용 · 건물 크기 고정':'건물 크기 고정 · 몸 보정은 깊이 추정에 사용'):wide?`무대 세트 크기 · 몸 보정과 무관 · 이 세트 최고 높이 ${(m.stage?.height_m??0).toFixed(2)}m`:m.body_calibration?.state==='capturing'?`몸 보정 중 · 마커 위 직립 유지 (${m.body_calibration.samples}프레임)`:m.body_reference?`건물 최고 ${m.display_height_m.toFixed(2)}m · 처음 허리 ${m.body_reference.waist_height_m.toFixed(2)}m의 70% · 위치 고정`:mono?'사람 보정 대기 · 먼저 폰에서 보정하세요':'3대: 몸 보정 생략 · 현재 고정 크기 사용';
  for(const id of ['x','y','yaw'])$(id).disabled=!!m.body_reference;
  $('scale').disabled=$('sizeRange').disabled=fixedSize||!!m.body_reference;
  const desired=m.scene_id??'it1';
  if(!mono&&!zoneRequested&&desired==='it1'&&zonesReady){zoneRequested=true;$('sceneSelect').selectedIndex=0;$('sceneSelect').onchange();return;}
  if(desired!==loadedScene){
    if(failedScene===desired)return;
    if(loadingScene!==desired)loadScene(desired).catch(showLoadError);
    return;
  }
  // Wide stage scene ids carry spacing and height; the list shows the zone it was built from.
  const selected=wide?m.stage?.zone_id:desired;
  if(scenePending&&selected===$('sceneSelect').value){scenePending=false;status('구역 준비 완료 · 손목/마우스로 타격하세요');}
  checkAutoNext(m);if(duo)trackBuildingTimer(m);
  const reset=epoch!==m.epoch;
  if(reset)hitEffect.clear();
  observeHit(m);
  if(reset)sizeDirty=false;
  epoch=m.epoch;
  if(!ready)return;
  const place=placementToThree(m.placement),removed=new Set(m.removed_ids);
  if(reset||!physics){
    physics?.dispose();physics=new FragmentPhysics(colliderData,m.placement,physicsOptions);impactQueue.clear();
    physics.setInteractionDistance(Number($('interactionDistance').value));
    physics.onImpact=(id,force)=>{if(state.smash_mode!=='super_smash'&&$('impactBreak').checked&&force>=8&&!state.removed_ids.includes(id))impactQueue.add(id);};
  }
  if(duo&&m.combo?.awaiting_ready&&comboReadyEpoch!==m.epoch){
    if(link.send({type:'duo_combo_ready',epoch:m.epoch}))comboReadyEpoch=m.epoch;
  }
  if(duo&&m.combo?.next_collision_ready)prewarmDuoScene(m.combo.next_scene_id);
  if(m.smash_mode==='super_smash'){
    if(m.delivery==='snapshot'&&isIncoming)physics.stopSuper();
    physics.queueSuper(m.removed_ids,superEvent);impactQueue.clear();
    if(m.phase==='paused')physics.stopSuper();
  }else physics.release(m.removed_ids,m.event);
  if(m.event?.blast)physics.blast(m.event);
  else if(m.event&&['mouse','mouse_push'].includes(m.event.kind))physics.push(m.event);
  syncToggle('blastMode',m.blast_enabled??true);
  if(approx){
    if(document.activeElement!==$('depthMargin'))$('depthMargin').value=m.depth_margin??0;
    const reasons={invalid:'미검출',too_low:'발을 더 높이 드세요',too_slow:'더 빠르게 차세요',baseline:'기준점 확보 · 다음 유효 관측 대기',gap:'추적 끊김 · 기준점 재확보',standing:'건물과 겹쳐 있음 · 손/발을 빠르게 움직이면 부숴짐',inside_slow:'건물과 겹침 · 빠르게 움직이세요',cooldown:'잠시 대기',outside:'충돌체 밖',contact:'접촉'};
    $('trackingDiagnosis').textContent=STRIKE_JOINTS.map(n=>{
      const d=m.diagnostics?.[n];return `${JOINT_LABELS[n]}: ${reasons[d?.reason]??'관측 대기'}${d?.depth_gap_m!=null?` · 깊이 차이 ${d.depth_gap_m.toFixed(2)}m`:''}`;
    }).join(' / ');
  }
  if(document.activeElement!==$('blastRadius'))$('blastRadius').value=m.blast_radius??3;
  if(document.activeElement!==$('pushStrength'))$('pushStrength').value=m.blast_strength??12;
  syncToggle('collapse',m.collapse??true);
  for(const s of scenes){
    outerBase=place.position;s.outer.position.fromArray(place.position);s.outer.rotation.z=place.rotationZ;s.outer.scale.setScalar(place.scale);
    for(const [id,node] of s.nodes){
      if(reset){node.position.copy(node.userData.restPosition);node.quaternion.copy(node.userData.restQuaternion);node.scale.copy(node.userData.restScale);}
      node.visible=!physics.superHidden.has(id)&&!physics.vanished.has(id);
    }
  }
  $('count').textContent=`${removed.size} / ${m.fragment_count}개 파괴`;
    $('score').textContent=`${m.score}점 · 파편 1개당 1점`;
  if(!scenePending)$('sceneSelect').value=selected;
  for(const [id,key] of [['x','x_m'],['y','y_m'],['yaw','yaw_deg'],['scale','scale']]) {
    if(id==='scale'&&sizeDirty)continue;
    if(document.activeElement?.closest('form')!==$('placement'))$(id).value=m.placement[key];
  }
  previewSize();
  const size=m.bounds.hi.map((v,i)=>(v-m.bounds.lo[i]).toFixed(2));
  $('dimensions').textContent=`폭 ${size[0]}m · 깊이 ${size[1]}m · 고정 높이 ${size[2]}m`;
  if(m.event){
    const who=['mouse','mouse_push'].includes(m.event.kind)?'마우스 합성 타격 · 화면 안쪽으로 밀기':m.event.kind==='synthetic_drop'?'합성 전체 낙하':m.event.kind==='debris'?'파편 충격':m.event.kind==='support'?'지지 상실':(JOINT_LABELS[m.event.joint]??'손');
    $('contact').textContent=`${who} → 파편 ${m.event.fragment_id} · 추가 붕괴 ${m.event.unsupported_ids?.length??0}개`;
  }
}
function onMessage(m){
  if(m.type==='multi3d_viewer'){viewerId=m.viewer_id;return;}
  if(m.type==='multi3d_model_control_ack'){
    if(controlPending?.request_id===m.request_id){controlPending.ack=m;completeControl();}return;
  }
  if(m.body_calibration&&m.model_test)m.model_test.body_calibration=m.body_calibration;
  if(mono){
    if(m.type==='mono3d_calib'&&m.camera&&m.K&&m.image)m={...m,type:'multi3d_calib',camera_id:'C0',...m.camera};
    else if(m.type==='mono3d_jpeg')m={...m,type:'multi3d_jpeg',camera_id:'C0'};
    else if(m.type==='mono3d_phone_left')m={type:'multi3d_phone_left',camera_id:'C0'};
    else if(m.type==='mono3d_model_state'){syncState(m.model_test);return;}
    else if(m.type==='mono3d_frame'){
      frameAt=performance.now();lastJoints={};
      const c=cameras.get('C0');c.occlusionInputValid=m.valid===true;
      if(!c.occlusionInputValid&&!c.visualDepthValid)c.occlusion.clear();
      if(m.valid&&m.joints)for(const [name,p]of Object.entries(m.joints))if(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))lastJoints[name]={p};
      personJoints=lastJoints;personAt=frameAt;
      if(!fatal)status(m.valid?'1대 근사 손목 · 휘두름/마우스로 타격하세요':m.reason==='feet_required_for_depth'?'발목 미검출 · 깊이 판정/손목 타격 중지':'1대 폰의 유효 손목 대기 · 마우스 시험 가능');return;
    }else if(m.type==='mono3d_status'&&!m.phone_connected){frameAt=0;lastJoints={};personJoints={};personAt=-Infinity;const c=cameras.get('C0');c.calibrated=false;c.img.hidden=true;c.occlusionInputValid=false;c.occlusion.clear();c.jpegVersion++;return;}
  }
  if(duo){
    if(m.type==='rtc_signal'&&m.from==='V'){rtcReceiver.onSignal(m.data);return;}
    if(m.type==='rtc_signal_failed'){rtcReceiver.failed(m.reason??'not_connected');return;}
    if(m.type==='rtc_hello')return;
    if(m.type==='wide3d_status'){rtcReceiver.setWanted(!!m.view?.connected);
      if(typeof m.view?.auto_spacing==='boolean'&&document.activeElement!==$('autoSpacing'))$('autoSpacing').checked=m.view.auto_spacing;
      if(typeof m.view?.auto_rotation==='boolean'&&document.activeElement!==$('autoRotation'))$('autoRotation').checked=m.view.auto_rotation;}
  }
  if(wide){
    if(m.type==='wide3d_status'){showStage(m);return;}
    if(m.type==='wide3d_frame'){
      const c=cameras.get(m.camera_id);if(!c)return;
      c.occlusionInputValid=m.valid===true;if(!c.occlusionInputValid&&!c.visualDepthValid)c.occlusion.clear();
      stageOwner=m.owner;if(!m.owner)stageBorrowed={};
      // Only the judging phone moves the 3D person/joints, as on the server.
      if(m.camera_id===m.owner){
        frameAt=performance.now();lastJoints={};
        for(const [name,p] of Object.entries(m.joints??{}))if(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))lastJoints[name]={p};
        personJoints=lastJoints;personAt=frameAt;stageBorrowed=m.borrowed??{};
      }
      const names={left_wrist:'왼손',right_wrist:'오른손',left_ankle:'왼발',right_ankle:'오른발'};
      const borrowed=Object.entries(stageBorrowed).map(([n,c])=>`${names[n]??n}←${c}`).join(', ');
      if(!fatal)status(m.owner?`${m.owner} 구간 폰이 판정 중${borrowed?` · 가려진 관절은 옆 폰 값 사용(${borrowed})`:''} · 휘두름/마우스로 타격하세요`:'유효한 폰 입력 대기 · 마우스 시험 가능 · 폰마다 마커/몸 보정 필요');
      return;
    }
  }
  const c=cameras.get(m.camera_id);
  if(m.type==='multi3d_calib'&&c)applyCalibration(c,m);
  else if(m.type==='multi3d_jpeg'&&c&&c.isView&&performance.now()-c.rtcFrameAt<1000){/* WebRTC video is live: the JPEG relay is the fallback only */}
  else if(m.type==='multi3d_jpeg'&&c){
    c.visualDepthValid=m.occlusion_valid===true;c.occlusionReason=m.occlusion_reason??null;
    // V sends video more often than its outline: a video-only frame carries the last outline again (occlusion_keep),
    // which is kept as is when already shown, so its age (depthAt) still counts from the outline frame.
    const maskId=m.occlusion_t_ms??m.t_ms,reuse=m.occlusion_keep===true&&!!c.occlusion?.texture&&c.occlusion.frameId===maskId;
    const version=++c.jpegVersion,img=new Image();img.src=m.data;
    Promise.all([img.decode().then(()=>true,()=>false),reuse?null:loadOcclusionTexture(m.occlusion)]).then(([decoded,texture])=>{
      if(!decoded||version!==c.jpegVersion){texture?.dispose();return;}
      c.img.src=m.data;c.img.hidden=false;c.lastImage=performance.now();
      if(c.occlusion){if((c.occlusionInputValid||c.visualDepthValid)&&c.calibrated){if(!reuse){c.occlusion.setFrame(texture,maskId);c.depthAt=performance.now();}}else{texture?.dispose();c.occlusion.clear();}}
    }).catch(()=>{if(version===c.jpegVersion)c.occlusion?.clear();});
  }else if(m.type==='multi3d_phone_left'&&c){c.calibrated=false;c.img.hidden=true;c.jpegVersion++;c.occlusion?.clear();}
  else if(m.type==='multi3d_fused'){
    $('sourceMode').textContent=`카메라 3대 · 삼각측량 · source=multi_view_test · ${m.timing==='inference_input_aligned'?'입력시각 정렬':'도착시각 호환'}`;
    frameAt=performance.now();lastJoints=m.joints??{};syncState(m.model_test);
    if(m.cameras_used.length>=2){personJoints=lastJoints;personAt=frameAt;}
    for(const c of cameras.values()){
      if(m.cameras_used.length>=2){c.occlusionInputValid=['left_shoulder','right_shoulder','left_hip','right_hip'].every(n=>m.joints?.[n]);if(c.occlusionInputValid)c.poseValidAt=frameAt;}
      else if(frameAt-(c.poseValidAt??-Infinity)>200)c.occlusionInputValid=false;
      if(!c.occlusionInputValid)c.occlusion.clear();
    }
    const count=m.cameras_used.length;
    if(!fatal)status(!ready?'모델 준비 중…':count>=2?`${count}대 입력 · 손목 또는 마우스로 타격하세요`:'마우스 합성 타격 가능 · 폰 입력은 2대 이상 필요');
  }else if(m.type==='multi3d_model_state')syncState(m.model_test);
  else if(m.type==='error'){scenePending=false;status(`서버 오류: ${m.detail??m.code}`);}
}
function showStage(m){
  const parts=(duo?['C0','C1']:['C0','C1','C2']).map(id=>{const c=m.cameras?.[id];if(!c)return `${id} —`;
    return `${id}${m.owner===id?' ★판정':''} · ID${c.marker_id} x=${c.marker_x_m.toFixed(2)}m · ${!c.connected?'연결 대기':!c.calibrated?'마커 보정 대기':!c.body?'몸 보정 대기':c.valid?'사람 ✓':'사람 대기'}`;});
  const v=m.view;
  if(v)parts.unshift(`V 화면 · ${!v.connected?'연결 대기':!v.calibrated?'두 마커 인식 대기':`보정됨 · 높이 ${v.camera_height_m?.toFixed(2)}m · 오차 ${v.reprojection_max_px?.toFixed(1)??'—'}px`}`);
  // V's measured marker placement. Without the correction a turned marker turns its phone's coordinates: about
  // tan(turn) x distance sideways (shown at 1.5 m in front of the marker). With it (2026-11-22, default on) the server
  // turns/moves each judging phone's coordinates by its marker's floor pose measured in V's frame.
  const L=v?.connected?v.layout:null;measuredSpacing=L?.spacing_m??null;
  if(L){const turn=Math.max(...L.yaw_deg.map(Math.abs)),side=Math.round(150*Math.tan(turn*Math.PI/180));
    const advice=[L.warn.includes('yaw')?'마커를 두 마커 중심선에 맞게 돌려 놓고 화면 폰에서 다시 인식':null,L.warn.includes('spacing')?'실측 간격 적용 권장':null].filter(Boolean);
    parts.splice(1,0,`V 실측 · 간격 ${L.spacing_m.toFixed(3)}m(입력 ${m.spacing_m.toFixed(3)}m) · 회전 ${L.yaw_deg.map((y,i)=>`ID${i} ${y>=0?'+':''}${y.toFixed(1)}°`).join(' ')} · 1.5m 앞 옆 어긋남 약 ${side}cm${advice.length?` ⚠ ${advice.join(' / ')}`:''}`);}
  $('applyMeasuredSpacing').hidden=!(duo&&L&&Math.abs(L.spacing_m-m.spacing_m)>=.005);
  if(L)$('applyMeasuredSpacing').textContent=`화면 폰 실측 간격 ${L.spacing_m.toFixed(3)}m 적용`;
  if(duo&&v?.connected){
    const fixes=['C0','C1'].map(id=>{const k=m.cameras?.[id]?.correction;if(!k)return null;
      return k.applied?`${id} 회전 ${k.yaw_deg>=0?'+':''}${k.yaw_deg.toFixed(1)}° · 위치 (${k.x_m.toFixed(3)}, ${k.y_m.toFixed(3)})m`
        :`${id} ${k.measured?'측정값 범위 밖 · 간격만 적용':'보정 없음 · 간격만 적용'}`;}).filter(Boolean);
    parts.splice(v.layout?2:1,0,`판정 좌표 보정 ${v.auto_rotation?'켜짐':'꺼짐'} · ${fixes.join(' / ')}`);}
  $('stageStatus').textContent=parts.join('\n');
}
let measuredSpacing=null;
$('applyMeasuredSpacing').onclick=()=>{if(!Number.isFinite(measuredSpacing))return;
  $('stageSpacing').value=String(Math.round(measuredSpacing*1000)/1000);$('applySpacing').onclick();};
$('autoSpacing').onchange=()=>link.send({type:'duo_auto_spacing',enabled:$('autoSpacing').checked});
$('autoRotation').onchange=()=>link.send({type:'duo_auto_rotation',enabled:$('autoRotation').checked});
// ----- duo: V's video over WebRTC, outline computed on this PC -----
const pcOutline=createPcOutline();
function depthTexture(d){
  const cv=document.createElement('canvas');cv.width=d.width;cv.height=d.height;
  cv.getContext('2d').putImageData(new ImageData(d.data,d.width,d.height),0,0);
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.NoColorSpace;t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;
  return t;
}
function onRtcFrame(){
  const c=cameras.get('V'),v=c?.rtcVideo;if(!v?.srcObject)return;
  v.requestVideoFrameCallback(onRtcFrame);
  const w=v.videoWidth,h=v.videoHeight;if(!w||!h)return;
  if(c.frame.width!==w||c.frame.height!==h){c.frame.width=w;c.frame.height=h;}
  // One frame: drawn on screen and given to MediaPipe, so the outline matches the picture exactly.
  c.frameCtx.drawImage(v,0,0,w,h);
  const at=performance.now();c.rtcFrameAt=at;c.lastImage=at;c.rtcFrames++;c.img.hidden=true;c.frame.hidden=false;
  if(!$('personOcclusion').checked||!c.calibrated||!c.viewCalib){c.visualDepthValid=false;return;}
  pcOutline.load();
  const judge=personAt>-Infinity?{joints:Object.fromEntries(Object.entries(personJoints).map(([n,j])=>[n,j.p])),ageMs:at-personAt}:null;
  const r=pcOutline.run(c.frame,at,c.viewCalib,judge);c.outlineMs=r.ms??null;c.occlusionReason=r.reason;
  if(r.depth){c.occlusion.setFrame(depthTexture(r.depth),c.rtcFrames);c.depthAt=performance.now();c.visualDepthValid=true;}
  else c.visualDepthValid=false;
}
const rtcReceiver=createRtcReceiver({
  send:data=>link.send({type:'rtc_signal',to:'V',data}),
  onStream:stream=>{const c=cameras.get('V');c.rtcVideo.srcObject=stream;c.rtcVideo.play().catch(()=>{});c.rtcVideo.requestVideoFrameCallback(onRtcFrame);},
  onChange:()=>{},
});
let rtcFpsAt=0,rtcFpsFrames=0,rtcStats=null;
const RTC_TEXT={idle:'화면 폰 연결 대기',connecting:'연결 중',phone_not_ready:'화면 폰 카메라 시작 대기',disabled:'화면 폰이 JPEG 방식 선택',failed:'연결 실패 · 다시 시도 중'};
function showViewTransport(now){
  const c=cameras.get('V');if(!c)return;
  if(now-rtcFpsAt>=1000){c.rtcFps=(c.rtcFrames-rtcFpsFrames)*1000/Math.max(1,now-rtcFpsAt);rtcFpsAt=now;rtcFpsFrames=c.rtcFrames;
    rtcReceiver.stats().then(s=>{rtcStats=s;});}
  const live=now-c.rtcFrameAt<1000;
  if(!live&&!c.frame.hidden){c.frame.hidden=true;}
  const s=rtcStats,jitter=s?.jitterBufferDelay&&s?.jitterBufferEmittedCount?` · 수신 대기 ${(1000*s.jitterBufferDelay/s.jitterBufferEmittedCount).toFixed(0)}ms`:'';
  $('viewTransport').textContent=live?`V 영상: WebRTC 직접 · ${c.frame.width}×${c.frame.height} · ${c.rtcFps.toFixed(0)}장/초${jitter}${c.outlineMs!==null?` · 윤곽 PC 계산 ${c.outlineMs.toFixed(0)}ms`:''}`
    :`V 영상: JPEG 서버 중계 · WebRTC ${RTC_TEXT[rtcReceiver.status]??rtcReceiver.status}`;
}
$('applySpacing').onclick=()=>{if(!$('stageSpacing').reportValidity())return;
  scenePending=link.send({type:'wide3d_stage_config',spacing_m:Number($('stageSpacing').value)});if(scenePending)status('마커 간격 적용 중… 구역을 다시 배치합니다.');};
const link=createLink(duo?'/ws/test/duo3d':wide?'/ws/test/wide3d':mono?'/ws/test/mono3d':'/ws/test/multi3d',{role:'viewer',model:'it1'},s=>{
  connected=s.open;
  if(!s.open){eventsArmed=false;hitEffect.clear();hitSound.reset();}
  if(!s.open){comboReadyEpoch=null;comboNextEpoch=null;feedback?.cancel('disconnect');physics?.stopSuper();controlPending=null;viewerId=null;lastPresentationKey='';frameAt=0;personJoints={};personAt=-Infinity;for(const c of cameras.values()){c.calibrated=false;c.img.hidden=true;c.jpegVersion++;c.occlusion?.clear();c.occlusionInputValid=false;}}
  if(!fatal)status(s.open?'마우스 합성 타격 가능 · 건물을 클릭하세요':'서버 연결 대기');
},onMessage);
// The 2-camera stage has no 3-camera control channel: restore and scene change stay plain messages there.
$('restore').onclick=()=>{if(!duo&&state?.smash_mode==='super_smash')$('superRestore').click();else if(duo&&state?.smash_mode==='super_smash'){feedback?.cancel('reset_request');physics?.stopSuper();link.send({type:'multi3d_model_reset'});}else link.send({type:'multi3d_model_reset'});};
$('captureBody').hidden=true;
$('captureBody').onclick=()=>link.send({type:'multi3d_body_start'});
$('stress').onclick=()=>link.send({type:'multi3d_model_drop_all'});
$('collapse').onchange=()=>sendToggle('collapse',{type:'multi3d_model_collapse',enabled:$('collapse').checked});
for(const input of document.querySelectorAll('[data-physics]'))input.onchange=()=>{
  physicsOptions[input.dataset.physics]=input.checked;physics?.configure(physicsOptions);
};
$('impactBreak').onchange=()=>impactQueue.clear();
const sendBlastConfig=()=>sendToggle('blastMode',{type:'multi3d_model_blast_config',enabled:$('blastMode').checked,
  radius:Number($('blastRadius').value),strength:Number($('pushStrength').value)});
for(const id of ['blastMode','blastRadius','pushStrength'])$(id).addEventListener('change',sendBlastConfig);
$('interactionDistance').onchange=()=>{try{physics?.setInteractionDistance(Number($('interactionDistance').value));}catch(e){status(e.message);}};
$('depthMargin').onchange=()=>link.send({type:'multi3d_model_depth_config',margin:Number($('depthMargin').value)});
// 1 camera: after a building is broken (enough pieces gone) move on to the next one in the list after a few seconds.
let autoNextTimer=null,autoNextFor=null;
function cancelAutoNext(){clearTimeout(autoNextTimer);autoNextTimer=null;autoNextFor=null;}
function advanceBuilding(){
  const select=$('sceneSelect'),options=[...select.options];if(options.length<2||scenePending)return;
  const at=options.findIndex(o=>o.value===select.value);select.selectedIndex=(at+1)%options.length;select.onchange();
}
function checkAutoNext(m){
  if(!approx)return;
  const comboMode=duo&&!!m.combo&&m.smash_mode!=='super_smash';
  if(duo){$('autoNextPercent').disabled=$('autoNextDelay').disabled=comboMode;$('autoNextDelay').closest('label').hidden=comboMode;if(comboMode)$('autoNextPercent').value=80;}
  if(!$('autoNext').checked){cancelAutoNext();$('autoNextStatus').textContent='';return;}
  const total=m.fragment_count||0,removed=m.removed_ids?.length??0;
  const need=autoNextNeed(total);
  if(comboMode){
    cancelAutoNext();
    if(m.combo.awaiting_ready){$('autoNextStatus').textContent='다음 건물 준비 중 · 준비 후 2초 무적';return;}
    $('autoNextStatus').textContent=removed>=need?'80% 철거 완료 · 다음 건물 준비':`파괴 ${removed}/${total}개 · ${need}개(80%)부터 다음 건물 · 준비 후 2초 무적`;
    if(total>0&&removed>=need&&comboNextEpoch!==m.epoch){
      if(link.send({type:'duo_combo_next',epoch:m.epoch}))comboNextEpoch=m.epoch;
    }
    return;
  }
  // The server ignores body hits for ~2 s after a new building appears (spawn_guard_ms).
  const guard=m.spawn_guard_ms>0?`새 건물 무적 ${(m.spawn_guard_ms/1000).toFixed(1)}초 · `:'';
  if(!(total>0&&removed>=need)){cancelAutoNext();$('autoNextStatus').textContent=`${guard}부서진 파편 ${removed}/${total}개 · ${need}개 이상이면 다음 건물`;return;}
  const key=`${m.scene_id}:${m.epoch}`;if(autoNextFor===key)return;
  cancelAutoNext();autoNextFor=key;
  const delay=Math.min(30,Math.max(1,Number($('autoNextDelay').value)||3));
  $('autoNextStatus').textContent=`건물이 부서졌습니다 · ${delay}초 뒤 다음 건물로 넘어갑니다`;
  autoNextTimer=setTimeout(()=>{autoNextTimer=null;advanceBuilding();},delay*1000);
}
for(const id of ['autoNext','autoNextDelay','autoNextPercent'])$(id).addEventListener('change',()=>{if(id==='autoNext'||id==='autoNextDelay')cancelAutoNext();if(state)checkAutoNext(state);});
$('sceneSelect').onchange=()=>{cancelAutoNext();
  failedScene=null;
  scenePending=!duo&&state?.smash_mode==='super_smash'?control('set_scene',{scene_id:$('sceneSelect').value}):link.send({type:'multi3d_model_scene',scene_id:$('sceneSelect').value});
  if(scenePending)status('구역 준비 중… 모델과 충돌체를 불러옵니다.');
};
function applyPlacement(){if(!$('placement').reportValidity())return;link.send({type:'multi3d_model_config',placement:{x_m:Number($('x').value),y_m:Number($('y').value),yaw_deg:Number($('yaw').value),scale:Number($('scale').value)}});}
$('placement').onsubmit=e=>{e.preventDefault();applyPlacement();};
$('sizeRange').oninput=()=>{sizeDirty=true;$('scale').value=$('sizeRange').value;previewSize();};
$('scale').oninput=()=>{sizeDirty=true;previewSize();};
$('applySize').onclick=applyPlacement;
previewSize();

function showLoadError(error){failedScene=loadingScene;ready=false;loadingScene=null;scenePending=false;fatal=String(error);$('status').dataset.error='true';status('구역 준비 실패: '+error.message+' · 다른 구역을 선택하거나 새로고침하세요.');}
async function loadScene(id){
  const generation=++loadGeneration;loadingScene=id;ready=false;fatal=null;
  failedScene=null;delete $('status').dataset.error;
  status('구역 모델 준비 중…');
  physics?.dispose();physics=null;
  disposeRoots([...ownedRoots,...scenes.flatMap(s=>[...s.outer.children])]);ownedRoots=[];
  for(const s of scenes){s.outer.clear();s.nodes.clear();}pieces.clear();
  const pending=duoPreload?.id===id?duoPreload:null;
  if(pending)duoPreload=null;else if(duo)discardDuoPreload();
  const cached=pending?await pending.promise:null;
  const spec=cached?.spec??await fetchScene(id);
  sceneBuildings=spec.render.map(b=>({id:b.id,x:b.offset[0],height:b.height_m}));
  const [models]=await Promise.all([cached?.models??loadModels(spec),initPhysics()]);
  if(generation!==loadGeneration){disposeRoots(models.map(g=>g.scene));return;}
  ownedRoots=models.map(g=>g.scene);colliderData=spec.colliders;sceneDimensions=spec.dimensions_m;buildingCount=spec.building_count;
  fixedSize=spec.fixed_size;
  for(const key of ['sizeRange','scale'])$(key).disabled=fixedSize;
  $('buildingSize').querySelector('h3').textContent=fixedSize?'건물 크기 · 고정':'건물 크기';
  $('buildingSize').querySelector('small').textContent=mono&&id.startsWith('single:')?MONO_FIXED_TEXT:wide?'무대 세트에 정한 크기를 사용합니다. 마커 간격이 좁으면 건물 전체가 축소됩니다.':fixedSize?'몸 보정 후 각 구역의 최고 높이를 같은 기준으로 맞춥니다. 구역 안 건물의 비율은 유지합니다.':'폭·깊이·높이를 같은 비율로 바꿉니다. 적용하면 파편을 복원합니다.';
  for(const f of colliderData.fragments)pieces.set(f.fragment_id,f.node);
  for(const s of scenes){const assembled=assembleScene(spec,models);s.outer.add(assembled.root);s.nodes=assembled.nodes;}
  loadedScene=id;loadingScene=null;scenePending=false;ready=true;epoch=null;
  if(spec.wide){placeMarkers(spec.wide.spacing_m);stageSpacing=spec.wide.spacing_m;}
  $('sceneTitle').textContent=spec.label;$('sceneInfo').textContent=spec.wide?`${duo?'2대 무대':'넓은 무대'} · 마커 간격 ${spec.wide.spacing_m}m · 건물 ${buildingCount}개 · 파편 ${pieces.size}개 · 일렬 배치${spec.wide.fit_scale<1?` · 무대 폭(간격×${spec.wide.sections??3})에 맞춰 ${Math.round(spec.wide.fit_scale*100)}%로 축소`:''}`:fixedSize?`건물 ${buildingCount}개 · 파편 ${pieces.size}개 · 높이 0.5m 이상 · 기존 절대 크기 유지 · 이 구역 평균 ${(spec.render.reduce((v,b)=>v+b.height_m,0)/buildingCount).toFixed(2)}m`:'IT1 단독 · 배율 조절 가능';
  $('stress').textContent=`${pieces.size}개 전체 낙하 · 합성 부하 시험`;
  syncState(state);previewSize();status(connected?'구역 준비 완료 · 손목/마우스로 타격하세요':'모델 준비 완료 · 서버 연결 대기');
  if(fixedSize){
    const bounds=new THREE.Box3().setFromObject(orbit.outer),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const distance=Math.max(size.x,size.y,size.z,1)*1.7;
    controls.target.copy(center);orbit.camera.position.copy(center).add(new THREE.Vector3(.5,-1,.7).normalize().multiplyScalar(distance));
    orbit.camera.far=Math.max(50,distance*10);orbit.camera.updateProjectionMatrix();controls.update();
  }
}
// Wide/duo stage sets contain one big building, fitted to the marker spacing.
let stageListSpacing=null;
async function loadStageList(spacing){
  if(!wide||stageListSpacing===spacing)return;stageListSpacing=spacing;
  const r=await fetch(`/api/test/building-scenes?kind=stage&layout=${duo?'duo':'wide'}&spacing=${spacing}`);if(!r.ok)throw new Error('무대 세트 목록을 불러올 수 없습니다.');
  const items=await r.json();if(stageListSpacing!==spacing)return;
  const select=$('sceneSelect'),keep=select.value;select.replaceChildren();
  for(const item of items){const option=document.createElement('option');option.value=item.id;
    const range=v=>Math.min(...v)===Math.max(...v)?`${v[0].toFixed(2)}m`:`${Math.min(...v).toFixed(2)}~${Math.max(...v).toFixed(2)}m`;
    option.textContent=`${item.label} · 가로 ${range(item.widths_m)} · 높이 ${range(item.heights_m)}`;select.append(option);}
  if(items.some(i=>i.id===keep))select.value=keep;
  zonesReady=true;
}
async function load(){
  if(wide){$('sceneLabel').textContent='무대 세트';await loadStageList(duo?2:1.5);status(`${duo?'2대 무대':'넓은 무대'} 세트를 서버에서 받는 중…`);return;}
  if(mono||!keepSingleBuilding){const r=await fetch('/api/test/building-scenes?kind='+(mono?'single':'zone'));if(!r.ok)throw new Error('구역 목록을 불러올 수 없습니다.');
    const groups=new Map();$('sceneSelect').replaceChildren();let it1Item=null;
    for(const item of await r.json()){
      if(item.id==='it1'){it1Item=item;continue;}
      if(!groups.has(item.parent_id)){const group=document.createElement('optgroup');group.label=item.parent_label;groups.set(item.parent_id,group);$('sceneSelect').append(group);}
      const option=document.createElement('option');option.value=item.id;option.textContent=mono?`${item.label} · 가로 ${item.width_m}m · 높이 ${item.height_m}m`:`${item.label} · ${item.building_count}개`;groups.get(item.parent_id).append(option);
    }
    // 1 camera: the old resizable IT1 stays last as a test entry (the 3-camera zone list never listed it).
    if(mono)$('sceneSelect').append(Object.assign(document.createElement('option'),{value:'it1',textContent:it1Item?.label??'IT1 단독 시험'}));
    zonesReady=true;}
  // The wide stage server already holds a zone; its first model state picks the scene to load.
  // 1 camera: the server holds the building (default: the fixed-size IT1); its first state picks it.
  if(!wide&&!mono)await loadScene('it1');else if(mono)status('1대 건물을 서버에서 받는 중…');else status(`${duo?'2대 무대':'넓은 무대'} 구역을 서버에서 받는 중…`);
}
function draw(now){
  feedback?.draw(now);
  physics?.processSuper(now);
  const start=performance.now(),dt=previousNow?(now-previousNow)/1000:0;previousNow=now;frameCount++;
  const disabled=!ready||!connected||scenePending;
  $('restore').disabled=disabled;$('stress').disabled=disabled;$('applySpacing').disabled=disabled;$('applyMeasuredSpacing').disabled=disabled;$('applySize').disabled=disabled||fixedSize||!!state?.body_reference;$('sceneSelect').disabled=!connected||!!loadingScene||scenePending;for(const b of $('placement').querySelectorAll('button'))b.disabled=disabled||!!state?.body_reference;
  physics?.updateWrists(connected&&state?.smash_mode!=='super_smash'?lastJoints:{},frameAt,now);
  physics?.step(dt);
  if(physics){
    for(const id of [...physics.dynamic,...physics.superVisual.keys()]){const {position,quaternion,scale}=physics.localTransform(id);for(const s of scenes){const n=s.nodes.get(id);n.visible=true;n.position.copy(position);n.quaternion.copy(quaternion);n.scale.copy(n.userData.restScale).multiplyScalar(scale);}}
    for(const id of physics.vanished)for(const s of scenes)s.nodes.get(id).visible=false;
    if(connected&&state?.smash_mode!=='super_smash'&&now-impactSentAt>150&&impactQueue.size){
      const ids=[...impactQueue].filter(id=>!state.removed_ids.includes(id)).slice(0,8);
      if(ids.length&&link.send({type:'multi3d_model_release',ids})){impactSentAt=now;ids.forEach(id=>impactQueue.delete(id));}
      if(!ids.length)impactQueue.clear();
    }
  }
  const live=connected&&now-frameAt<500;
  updateSuperUi(now);updateViewHud(now);
  if(state?.smash_mode==='super_smash'&&!presentable()&&feedback?.info().screen.active&&!feedback.info().screen.preview){feedback.cancel('presentation_lost');physics?.stopSuper();}
  if(physics&&state?.smash_mode==='super_smash')for(const s of scenes)for(const [id,n] of s.nodes)if(physics.superHidden.has(id))n.visible=false;
  const personLive=connected&&now-personAt<500;
  trackedPerson.update(personJoints,personLive);$('personStatus').textContent=personLive&&trackedPerson.count?('사람 3D · '+trackedPerson.count+'관절 · '+(mono?'1대 근사':wide?`${stageOwner??'판정 폰 없음'} 폰 근사`:'다중 시점')):'사람 3D 관측 대기';
  const recoil=hitEffect.recoil(now);
  for(const s of scenes){
    if(outerBase)s.outer.position.set(outerBase[0]+recoil[0],outerBase[1]+recoil[1],outerBase[2]+recoil[2]);
    STRIKE_JOINTS.forEach((n,i)=>{s.wrists[i].visible=live&&Boolean(lastJoints[n])&&(s===orbit||(s.calibrated&&now-s.lastImage<1500));if(s.wrists[i].visible)s.wrists[i].position.fromArray(lastJoints[n].p);});
    const box=s===orbit?$('orbit'):s.div,w=box.clientWidth,h=box.clientHeight;
    if(w<=0||h<=0)continue;
    const canvas=s.renderer.domElement;if(canvas.clientWidth!==w||canvas.clientHeight!==h||canvas.width!==Math.floor(w*s.renderer.getPixelRatio())||canvas.height!==Math.floor(h*s.renderer.getPixelRatio()))s.renderer.setSize(w,h,false);
    if(s===orbit){s.camera.aspect=w/Math.max(1,h);s.camera.updateProjectionMatrix();}
    else {const id=[...cameras].find(([,v])=>v===s)[0];s.label.textContent=id==='V'?`V 메인 화면 · ${s.calibrated?'두 마커 보정됨':'화면 폰 보정 대기'}`:`${id} ${s.calibrated?'보정됨':'대기'}`;}
    if(s.isView)showViewTransport(now);
    s.outer.visible=s===orbit||(connected&&s.calibrated&&now-s.lastImage<1500);
    if(s.occlusion){
      // V's outline carries its own depth (judging joints or its own feet), so it does not wait for a judging frame.
      const inputOk=s.isView?s.visualDepthValid:(s.occlusionInputValid||s.visualDepthValid)&&live;
      const fresh=connected&&s.calibrated&&now-s.lastImage<1500&&now-(s.depthAt??-Infinity)<500&&inputOk;
      if(!fresh)s.occlusion.clear();
      s.occlusion.update(fresh&&$('personOcclusion').checked);
      if(!duo||s.isView)$('occlusionStatus').textContent=!$('personOcclusion').checked?'사람 뒤 가림 OFF':s.occlusion.mesh.visible?(s.isView?'V 실제 사람 윤곽 가림 · 근사 깊이':'사람 뒤 가림 적용 · 근사 깊이'):(s.isView&&personLive&&s.calibrated?'V 윤곽 없음 · 판정 관절 막대로 대신 가림':s.occlusionReason??'사람 뒤 가림 대기 · 유효한 깊이/윤곽 필요');
    }
    s.personProxy?.update(personJoints,personLive&&s.calibrated&&$('personOcclusion').checked&&!s.occlusion?.mesh.visible);
    s.renderer.render(s.scene,s.camera);
    if(s.effect)drawHitEffect(s,s.camera,box,now);
  }
  renderMs+=(performance.now()-start-renderMs)*.1;
  if(now-reportAt>=500){fps=(frameCount-reportFrames)*1000/(now-reportAt);reportAt=now;reportFrames=frameCount;
    const m=physics?.snapshot();if(m)$('performance').textContent=`${fps.toFixed(0)} FPS · 물리 p95 ${m.stepP95Ms.toFixed(2)}ms · 프레임 CPU ${renderMs.toFixed(2)}ms · 동적 ${m.dynamic} / sleep ${m.sleeping}`;
  }
}
load().then(()=>link.setEnabled(true)).catch(showLoadError);
orbit.renderer.setAnimationLoop(draw);
window.buildingFragmentTest=Object.freeze({previewImpact:originPx=>feedback?.preview({originPx}),cameraPickPoints:()=>{
  const c=cameras.get('C0');if(!c?.calibrated)return [];
  c.scene.updateMatrixWorld(true);
  return [...c.nodes].map(([id,n])=>{const p=n.getWorldPosition(new THREE.Vector3()).project(c.camera);return {id,u:(p.x+1)/2,v:(1-p.y)/2};})
    .filter(p=>p.u>0&&p.u<1&&p.v>0&&p.v<1);
},cameraPixels:points=>{
  const c=cameras.get('C0');c.renderer.render(c.scene,c.camera);const gl=c.renderer.getContext(),value=new Uint8Array(4);
  return points.map(p=>{gl.readPixels(Math.min(gl.drawingBufferWidth-1,Math.floor(p.u*gl.drawingBufferWidth)),Math.min(gl.drawingBufferHeight-1,Math.floor((1-p.v)*gl.drawingBufferHeight)),1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);return Array.from(value);});
},pickPoints:()=>{
  orbit.scene.updateMatrixWorld(true);
  return [...orbit.nodes].filter(([id])=>!state?.removed_ids.includes(id)).map(([id,n])=>{
    const v=n.getWorldPosition(new THREE.Vector3()).project(orbit.camera);
    return {id,x:v.x,y:v.y,z:v.z,buildingId:colliderData.fragments.find(f=>f.fragment_id===id)?.building_id};
  }).filter(p=>Math.abs(p.x)<.98&&Math.abs(p.y)<.98&&p.z>0&&p.z<1).sort((a,b)=>a.z-b.z);
},snapshot:()=>({ready,connected,removed:state?.removed_ids??[],score:state?.score??0,epoch,
  nextPreload:duoPreload?{sceneId:duoPreload.id,ready:!!duoPreload.data}:null,
  placement:state?.placement,super:feedback?.info()??null,modelState:state,viewerId,controlPending,
  sceneId:loadedScene,buildingCount,loadingScene,fixedSize,buildings:sceneBuildings,
  removedBuildings:colliderData?[...new Set(colliderData.fragments.filter(f=>state?.removed_ids.includes(f.fragment_id)).map(f=>f.building_id))]:[],
  physics:physics?.snapshot()??null,fps,frameCpuMs:renderMs,collapse:state?.collapse,
  blastEnabled:state?.blast_enabled,autoNextPending:autoNextTimer!==null,
  viewFull:duo?{on:document.body.classList.contains('view-full'),hud:viewHudText(performance.now())}:null,
  stage:state?.stage??null,owner:stageOwner,borrowed:stageBorrowed,markerX:markers.children.map(m=>m.position.x),
  cameraPanels:[...cameras].map(([id,c])=>{const r=c.div.getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height,visible:!c.img.hidden};}),
  occlusion:cameras.get('C0').occlusion.snapshot(),person:trackedPerson.snapshot(),
  view:cameras.get('V')?{calibrated:cameras.get('V').calibrated,imageVisible:!cameras.get('V').img.hidden,proxy:cameras.get('V').personProxy.snapshot(),occlusion:cameras.get('V').occlusion.snapshot(),depthAgeMs:performance.now()-(cameras.get('V').depthAt??-Infinity),occlusionReason:cameras.get('V').occlusionReason,
    rtc:{status:rtcReceiver.status,frames:cameras.get('V').rtcFrames,live:performance.now()-cameras.get('V').rtcFrameAt<1000,width:cameras.get('V').frame.width,height:cameras.get('V').frame.height,frameVisible:!cameras.get('V').frame.hidden,outlineReady:pcOutline.ready},
    autoSpacing:$('autoSpacing').checked}:null,
  visible:[...orbit.nodes].filter(([,n])=>n.visible).map(([id])=>id),
  worldBounds:ready?(()=>{const b=new THREE.Box3().setFromObject(orbit.outer);return {lo:b.min.toArray(),hi:b.max.toArray()};})():null,
  projection:[...cameras].filter(([,c])=>c.calibrated).map(([id,c])=>({id,
    point:new THREE.Vector3(.1,.1,.3).project(c.camera).toArray()}))})});
window.addEventListener('pagehide',()=>{feedback?.dispose();document.removeEventListener('pointerdown',unlockSuper,{capture:true});rtcReceiver.setWanted(false);link.setEnabled(false);orbit.renderer.setAnimationLoop(null);physics?.dispose();physics=null;trackedPerson.dispose();controls.dispose();for(const s of scenes){s.occlusion?.dispose();s.personProxy?.dispose();s.renderer.dispose();}});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
