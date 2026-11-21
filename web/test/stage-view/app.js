// Duo stage view-only phone (docs/DUO_STAGE_TEST.md): sees floor markers ID0 and ID1 together from the far side,
// solves its pose in the stage frame from all 8 corners, and streams its video as the PC main screen. It never
// judges hits; the two judging phones use /test/mono3d/?stage=duo. It finds the real person's outline in its own
// video and sends it with an approximate depth (view-person.js), so the PC shows the person in front of buildings.
import {createLink} from '../mono3d/link.js?v=20261120-b1';
import {detectMarker,refineMarker,StableMarker} from '../multi3d/auto-marker.js?v=20261118-s1';
import {solveViewPose,viewCalibrationMessage,viewLayoutMessage,layoutText,reasonText,project,VIEW_MARKER_IDS} from './view-calib.js?v=20261118-l1';
import {createPoseLandmarker} from '/camera/pose.js?v=20261112-2';
import {copyPersonMask,skeletonMask,torsoMaskCoverage,MIN_TORSO_MASK_COVERAGE,PERSON_DEPTH_ENCODING} from '../mono3d/person-depth.js?v=20261120-t1';
import {createRtcSender} from './rtc.js?v=20261120-r1';
import {viewPersonDepth,VIEW_MASK_MAX} from './view-person.js?v=20261118-v2';

const $=id=>document.getElementById(id);
const STORE_KEY='smash-duo-view-v1',SCAN_MS=300;
// Video is sent only once the previous frame has left the phone: a frame queued in the socket shows on the PC
// late (video lags behind the judging phones' joints), so a busy link skips the frame instead of queueing it.
const VIDEO_MAX_BUFFERED=16*1024;
const view=$('view'),ctx=view.getContext('2d'),video=document.createElement('video');
video.muted=true;video.playsInline=true;
const scanCanvas=document.createElement('canvas'),scanCtx=scanCanvas.getContext('2d',{willReadFrequently:true});
const jpegCanvas=document.createElement('canvas'),jpegCtx=jpegCanvas.getContext('2d');
const depthCanvas=document.createElement('canvas'),depthCtx=depthCanvas.getContext('2d');
let stream=null,wakeLock=null,scanTimer=null,stable={},seen={},corners=null,calib=null,stage=null,sent=false,lastJpegAt=0;
// Measured marker layout (spacing, turns): shown here and on the PC, which can apply the measured spacing.
let layout=null,layoutSent=false;
// Person outline: pose + segmentation on the JPEG frame itself, so outline and image always match.
let lastMaskAt=0,maskValid=false,stats={at:0,frames:0,masks:0,ms:0,bytes:0,busy:0};
let landmarker=null,landmarkerLoading=null,lastTs=0,judge=null,judgeAt=-Infinity,lastPerson=null,personStatus='사람 윤곽 대기';
const num=id=>Number($(id).value);
const duoMarkers=spacing=>Object.fromEntries(VIEW_MARKER_IDS.map(id=>[id,(id-.5)*spacing]));

function load(){try{return JSON.parse(localStorage.getItem(STORE_KEY))}catch{return null}}
function save(value){try{localStorage.setItem(STORE_KEY,JSON.stringify(value))}catch{/* optional */}}
const saved=load();
if(saved){for(const id of ['videoFps','maskFps','jpegWidth','transport'])if(saved[id])$(id).value=String(saved[id]);
  for(const id of ['cameraHeight','markerCm','fov'])if(Number.isFinite(saved[id]))$(id).value=saved[id];if(typeof saved.autoFov==='boolean')$('autoFov').checked=saved.autoFov;}

const link=createLink('phone',renderLink,onMessage,{path:'/ws/test/duo3d',params:{camera:'V'}});
// WebRTC (2026-11-20): each PC gets this camera directly on the same Wi-Fi; the server relays only the signalling.
// While every connected PC has it, the JPEG relay and this phone's own person inference stop (the PC finds the
// outline in the video it receives). Any PC without it keeps the JPEG path.
let rtcState={connected:0,peers:0},rtcText='',rtcLast=null;
const rtc=createRtcSender({getTrack:()=>stream?.getVideoTracks()[0]??null,send:(to,data)=>link.send({type:'rtc_signal',to,data}),onChange:s=>{rtcState=s;}});
const rtcAll=()=>$('transport').value==='rtc'&&rtcState.connected>0&&rtcState.connected>=link.viewers;
link.setEnabled(true);
function renderLink(s){
  if(!s.open)rtc.closeAll();
  $('linkStatus').textContent=s.error==='access_key_required'?'접속 키가 필요합니다(주소에 ?key=)':s.error==='superseded'?'다른 화면 폰이 연결해서 끊겼습니다'
    :!s.open?'서버에 연결 중…':s.viewers?`✓ PC 화면 ${s.viewers}개 연결`:'서버 연결됨 · PC 화면을 여세요';
}
function onMessage(m){
  if(m.type==='link_open'){sent=false;layoutSent=false;sendLayout();return;}
  if(m.type==='mono3d_status'&&m.markers){
    const next={spacing:m.spacing_m,markers:m.markers};
    // Positions, not just the spacing label, decide whether the pose must be solved again.
    const changed=!stage||stage.spacing!==next.spacing||VIEW_MARKER_IDS.some(id=>stage.markers?.[id]!==next.markers?.[id]);stage=next;
    if(changed&&corners)solve();               // markers moved on the PC: same corners, new stage positions
    else if(calib&&m.view_calibrated===false)sent=false;
    sendCalib();
  }
  if(m.type==='rtc_signal'&&typeof m.from==='string')rtc.onSignal(m.from,m.data);
  // The judging phone's stage-frame joints: they give the outline its depth.
  if(m.type==='duo_person'&&m.joints){judge=m.joints;judgeAt=performance.now();}
  // The server's spacing differs from ours: solve again with ITS marker positions (duo marker n at (n - 0.5) * spacing),
  // never with our old positions under the new label. A later mono3d_status with the same spacing changes nothing.
  if(m.type==='error'&&m.code==='spacing_mismatch'&&Number.isFinite(m.spacing_m)){
    stage={spacing:m.spacing_m,markers:duoMarkers(m.spacing_m)};calib=null;sent=false;
    if(corners)solve();
  }
}

async function startCamera(){
  stream?.getTracks().forEach(t=>t.stop());
  try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});}
  catch(e){$('scanStatus').textContent=`카메라를 열 수 없습니다: ${e.name??e}`;return;}
  video.srcObject=stream;await video.play().catch(()=>{});
  rtc.replaceTrack(stream.getVideoTracks()[0]);
  try{wakeLock=await navigator.wakeLock?.request('screen');}catch{/* optional */}
  $('scan').disabled=false;$('start').textContent='카메라 다시 시작';
  loadLandmarker();
  // A saved calibration is reused only at the same resolution; it is re-solved for the current spacing.
  if(saved?.corners&&saved.width===video.videoWidth&&saved.height===video.videoHeight){corners=saved.corners;$('scanStatus').textContent='저장된 마커 인식을 사용합니다. 폰이 움직였다면 다시 인식하세요.';solve();}
  else $('scanStatus').textContent=video.videoWidth<video.videoHeight?'폰을 가로로 돌리세요.':'두 마커가 모두 보이게 고정하고 “두 마커 인식”을 누르세요.';
}

// Full resolution: at 3 m a 27 cm marker is only a few dozen pixels wide.
function scan(){
  clearInterval(scanTimer);corners=null;calib=null;sent=false;layout=null;$('layoutStatus').textContent='';stable={0:new StableMarker(1500),1:new StableMarker(1500)};seen={};
  let retries=0;$('scan').hidden=true;   // shown again once both markers are recognised
  const retryText=()=>retries?` · 보정 실패 ${retries}회, 계속 찾는 중`:'';
  $('scanStatus').textContent='ID0·ID1 마커를 찾는 중… 폰을 움직이지 마세요';
  // Keeps scanning until both markers are found AND the pose solves (a failed solve says why in calibStatus).
  scanTimer=setInterval(()=>{
    const W=video.videoWidth,H=video.videoHeight;if(video.readyState<2||!W)return;
    if(W<H){$('scanStatus').textContent='폰을 가로로 돌리세요.'+retryText();return;}
    scanCanvas.width=W;scanCanvas.height=H;scanCtx.drawImage(video,0,0);
    const image=scanCtx.getImageData(0,0,W,H).data,now=performance.now(),found={};
    for(const id of VIEW_MARKER_IDS){seen[id]=refineMarker(image,W,H,detectMarker(image,W,H,id),id);found[id]=stable[id].add(seen[id],now);}
    const missing=VIEW_MARKER_IDS.filter(id=>!seen[id]);
    $('scanStatus').textContent=(missing.length?`ID${missing.join('·ID')} 마커가 안 보입니다 · 전체가 보이게, 반사/가림을 확인하세요`:'두 마커 확인 · 약 1초간 움직이지 마세요')+retryText();
    if(VIEW_MARKER_IDS.every(id=>found[id])){
      corners={0:found[0],1:found[1]};solve();
      if(calib){clearInterval(scanTimer);scanTimer=null;$('scan').hidden=false;$('scanStatus').textContent='두 마커 인식 완료';return;}
      retries++;corners=null;for(const id of VIEW_MARKER_IDS)stable[id].reset();
      $('scanStatus').textContent=`두 마커를 찾았지만 보정에 실패했습니다${retryText()} · 아래 이유를 보고 간격/높이/방향을 확인하세요`;
    }
  },SCAN_MS);
}

function solve(){
  if(!corners)return;
  if(!stage){$('calibStatus').textContent='서버에서 마커 간격을 받는 중…';return;}
  const W=video.videoWidth||saved?.width,H=video.videoHeight||saved?.height,sideM=num('markerCm')/100;
  const r=solveViewPose({width:W,height:H,corners,markers:stage.markers,sideM,cameraHeightM:num('cameraHeight'),fovDiagDeg:num('fov'),autoFov:$('autoFov').checked});
  showLayout(r.layout);
  if(!r.ok){calib=null;$('calibStatus').className='bad';$('calibStatus').textContent=reasonText(r.reason)+(r.reprojection_max_px?` (모서리 오차 ${r.reprojection_max_px.toFixed(1)}px)`:'');return;}
  calib={...r,spacing:stage.spacing,sideM};sent=false;
  if($('autoFov').checked)$('fov').value=r.fov_diag_deg.toFixed(1);
  save({width:W,height:H,corners,cameraHeight:num('cameraHeight'),markerCm:num('markerCm'),fov:num('fov'),autoFov:$('autoFov').checked,videoFps:num('videoFps'),maskFps:num('maskFps'),jpegWidth:num('jpegWidth'),transport:$('transport').value});
  $('calibStatus').className='ok';
  $('calibStatus').textContent=`보정 완료 · 마커 간격 ${stage.spacing}m · 높이 ${r.camera_height_m.toFixed(2)}m · 숙임 ${r.tilt_down_deg.toFixed(0)}° · 화각 ${r.fov_diag_deg.toFixed(1)}° · 모서리 오차 ${r.reprojection_max_px.toFixed(1)}px`;
  sendCalib();
}
async function loadLandmarker(){
  if(landmarker||landmarkerLoading||!$('personMask').checked)return;
  $('personStatus').textContent='사람 인식 모델 준비 중…';
  landmarkerLoading=createPoseLandmarker($('model').value,['GPU','CPU'],{segmentation:true})
    .then(r=>{landmarker=r.landmarker;$('personStatus').textContent=`사람 인식 준비 · ${r.delegate}`;})
    .catch(e=>{$('personStatus').textContent=`사람 인식 모델을 불러올 수 없습니다: ${e.message??e} · 건물이 사람 뒤로 가려지지 않습니다`;})
    .finally(()=>{landmarkerLoading=null;});
}

// One JPEG frame: the same pixels go to MediaPipe and to the PC, so the outline sits exactly on the person.
function personOcclusion(now){
  if(!landmarker||!$('personMask').checked)return {occlusion:null,valid:false,reason:$('personMask').checked?'사람 인식 모델 대기':'사람 윤곽 OFF'};
  let landmarks=null,mask=null,maskError=null,out=null;
  const ts=Math.max(lastTs+1,now);lastTs=ts;
  try{out=landmarker.detectForVideo(jpegCanvas,ts);landmarks=out.landmarks?.[0]??null;
    try{mask=copyPersonMask(out.segmentationMasks?.[0],...VIEW_MASK_MAX);}catch(e){maskError=e.message??'readback_failed';}
  }catch(e){return {occlusion:null,valid:false,reason:`사람 인식 실패: ${e.message??e}`};}
  finally{out?.close?.();}
  lastPerson=landmarks;
  let source='분할 윤곽';
  const coverage=torsoMaskCoverage(mask,landmarks);
  if(landmarks&&(!mask||(coverage!==null&&coverage<MIN_TORSO_MASK_COVERAGE))){
    const ratio=Math.min(1,VIEW_MASK_MAX[0]/jpegCanvas.width,VIEW_MASK_MAX[1]/jpegCanvas.height);
    const approx=skeletonMask(landmarks,Math.max(1,Math.round(jpegCanvas.width*ratio)),Math.max(1,Math.round(jpegCanvas.height*ratio)));
    if(approx){source='골격 근사 윤곽'+(maskError?' (분할 읽기 실패)':mask?' (분할 윤곽이 몸통과 불일치)':' (분할 윤곽 없음)');mask=approx;}
  }
  const r=viewPersonDepth(mask,landmarks,calib.K,calib.pose,judge&&{joints:judge,ageMs:now-judgeAt});
  if(!r.depth)return {occlusion:null,valid:false,reason:`가림 보류 · ${r.reason}`};
  depthCanvas.width=r.depth.width;depthCanvas.height=r.depth.height;depthCtx.putImageData(new ImageData(r.depth.data,r.depth.width,r.depth.height),0,0);
  const depthText=r.source==='judge'?`판정 폰 관절 깊이${r.swapped?' (좌우 맞춤)':''} · 어긋남 ${r.fit_px.toFixed(0)}/${r.limit_px.toFixed(0)}px`
    :`바닥 발목 기준 근사 깊이${r.judge_rejected?` (${r.judge_rejected})`:''}`;
  return {valid:true,reason:`실제 사람 가림 · ${r.depth.pixels}픽셀 · ${source} · ${depthText}`,
    occlusion:{encoding:PERSON_DEPTH_ENCODING,width:r.depth.width,height:r.depth.height,data:depthCanvas.toDataURL('image/png')}};
}

function showLayout(next){
  layout=next?.ok?next:null;layoutSent=false;
  $('layoutStatus').className=!layout?'hint':layout.warn.length?'warn':'ok';
  $('layoutStatus').textContent=next?layoutText(next):'';
  sendLayout();
}
function sendLayout(){if(layout&&!layoutSent&&link.open)layoutSent=link.send(viewLayoutMessage(layout));}
function sendCalib(){if(calib&&!sent&&link.open&&stage&&calib.spacing===stage.spacing)sent=link.send(viewCalibrationMessage(calib,{spacing:calib.spacing,sideM:calib.sideM}));}

function draw(){
  requestAnimationFrame(draw);
  const W=video.videoWidth,H=video.videoHeight;if(!W)return;
  if(view.width!==W||view.height!==H){view.width=W;view.height=H;}
  ctx.drawImage(video,0,0);
  const line=Math.max(2,W/480);ctx.lineWidth=line;
  for(const id of VIEW_MARKER_IDS){const c=scanTimer?seen[id]:corners?.[id];if(!c)continue;
    ctx.strokeStyle=scanTimer?'#facc15':'#22c55e';ctx.beginPath();c.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}
  if(calib){
    // The stage x axis through both markers and 1 m posts at each marker: they must sit on the real floor.
    const P=p=>project(calib.K,calib.pose,p),xs=VIEW_MARKER_IDS.map(id=>stage?.markers?.[id]??0);
    ctx.strokeStyle='#38bdf8';ctx.beginPath();const a=P([xs[0]-.5,0,0]),b=P([xs[1]+.5,0,0]);if(a&&b){ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    ctx.strokeStyle='#f472b6';for(const x of xs){const f=P([x,0,0]),t=P([x,0,1]);if(f&&t){ctx.beginPath();ctx.moveTo(...f);ctx.lineTo(...t);ctx.stroke();}}
  }
  if(lastPerson&&calib&&$('personMask').checked){
    ctx.fillStyle='#facc15';for(const id of [0,11,12,15,16,23,24,27,28]){const l=lastPerson[id];if(l&&(l.visibility??1)>=.5){ctx.beginPath();ctx.arc(l.x*W,l.y*H,line*2.5,0,7);ctx.fill();}}
  }
  const now=performance.now();
  // Video often, outline less often: person inference (the heavy part) runs only on outline frames; video-only
  // frames say occlusion_keep and the server re-attaches the last outline, so the PC keeps it until the next one.
  const videoMs=1000/num('videoFps'),maskMs=1000/Math.min(num('maskFps'),num('videoFps'));
  const due=calib&&sent&&link.open&&now-lastJpegAt>=videoMs-4&&!rtcAll();
  // Previous frame still leaving the phone: skip (no encoding, no inference) so the next one is fresh.
  if(due&&link.buffered>VIDEO_MAX_BUFFERED)stats.busy++;
  else if(due){
    const t0=performance.now(),jw=Math.min(W,num('jpegWidth'));
    jpegCanvas.width=jw;jpegCanvas.height=Math.round(jw*H/W);jpegCtx.drawImage(video,0,0,jpegCanvas.width,jpegCanvas.height);
    let outline;
    if(now-lastMaskAt>=maskMs-4){
      const person=personOcclusion(now);lastMaskAt=now;maskValid=person.valid;stats.masks++;
      if(person.reason!==personStatus){personStatus=person.reason;$('personStatus').textContent=personStatus;}
      outline={occlusion:person.occlusion,occlusion_valid:person.valid,occlusion_reason:person.reason};
    }else outline={occlusion_keep:maskValid,occlusion_valid:maskValid,occlusion_reason:personStatus};
    const packet=JSON.stringify({type:'mono3d_jpeg',data:jpegCanvas.toDataURL('image/jpeg',.7),t_ms:Math.round(now),...outline});
    stats.ms+=performance.now()-t0;
    if(link.sendText(packet,VIDEO_MAX_BUFFERED)){lastJpegAt=now;stats.frames++;stats.bytes+=packet.length;}
  }
  if(now-stats.at>=1000&&rtcState.connected){
    // WebRTC: the encoder's own numbers (sent frames/s, size, bitrate, why it lowered quality).
    const at=now;rtc.stats().then(list=>{
      const fps=list.reduce((a,r)=>a+(r.framesPerSecond??0),0)/Math.max(1,list.length),bytes=list.reduce((a,r)=>a+(r.bytesSent??0),0);
      const r=list[0],kbps=rtcLast&&at>rtcLast.at?(bytes-rtcLast.bytes)*8/(at-rtcLast.at):0;rtcLast={at,bytes};
      const limit={cpu:'폰 처리 한계',bandwidth:'와이파이 한계',other:'기타'}[r?.qualityLimitationReason];
      rtcText=r?`WebRTC 직접 · PC ${rtcState.connected}/${link.viewers}대 · ${fps.toFixed(0)}장/초 · ${r.frameWidth}×${r.frameHeight} · ${(kbps/1000).toFixed(1)}Mbps${limit?` · 화질 낮춤: ${limit}`:''}`:`WebRTC 직접 · PC ${rtcState.connected}/${link.viewers}대 연결`;
    });
  }else if(!rtcState.connected){rtcText='';rtcLast=null;}
  if(now-stats.at>=1000){
    const s=(now-stats.at)/1000;
    $('perfStatus').textContent=rtcAll()?rtcText||'WebRTC 연결됨 · 통계 대기':(rtcText?rtcText+' · 나머지 PC는 JPEG · ':'')+(stats.frames?`실제 영상 ${(stats.frames/s).toFixed(1)}장/초 · 윤곽 ${(stats.masks/s).toFixed(1)}장/초 · 한 장 처리 ${(stats.ms/stats.frames).toFixed(0)}ms · 전송 ${(stats.bytes*8/s/1e6).toFixed(1)}Mbps · 한 장 ${(stats.bytes/stats.frames/1024).toFixed(0)}KB${stats.busy?` · 전송 밀림 ${(stats.busy/s).toFixed(1)}회/초(해상도·장/초를 낮추세요)`:''}`:stats.busy?`전송 밀림 ${(stats.busy/s).toFixed(1)}회/초 · 영상이 나가지 못함(해상도를 낮추세요)`:'전송 대기(보정·서버 연결 후 시작)');
    stats={at:now,frames:0,masks:0,ms:0,bytes:0,busy:0};
  }
}
requestAnimationFrame(draw);

$('start').onclick=startCamera;$('scan').onclick=scan;
$('fold').onclick=()=>{const f=$('panel').classList.toggle('folded');$('fold').textContent=f?'+':'–';};
$('personMask').onchange=()=>{if($('personMask').checked)loadLandmarker();else lastPerson=null;};
$('model').onchange=()=>{landmarker?.close?.();landmarker=null;loadLandmarker();};
for(const id of ['videoFps','maskFps','jpegWidth','transport'])$(id).addEventListener('change',()=>{const s=load();if(s)save({...s,videoFps:num('videoFps'),maskFps:num('maskFps'),jpegWidth:num('jpegWidth'),transport:$('transport').value});});
$('transport').addEventListener('change',()=>rtc.setEnabled($('transport').value==='rtc'));
rtc.setEnabled($('transport').value==='rtc');
for(const id of ['cameraHeight','markerCm','fov','autoFov'])$(id).addEventListener('change',()=>{if(corners)solve();});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&stream&&!wakeLock)try{wakeLock=await navigator.wakeLock?.request('screen');}catch{/* optional */}});
window.stageView={snapshot:()=>({calibrated:!!calib,sent,stage,corners,personStatus,rtc:{...rtcState,all:rtcAll(),transport:$('transport').value},perf:$('perfStatus').textContent,judgeAgeMs:judge?performance.now()-judgeAt:null,calib:calib&&{height:calib.camera_height_m,fov:calib.fov_diag_deg,error:calib.reprojection_max_px},layout})};
