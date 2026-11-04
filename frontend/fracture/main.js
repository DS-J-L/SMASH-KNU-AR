import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { validatePackageMetadata, validatePackageModels } from './package-contract.js';
import './style.css';
import { GameController } from '../game/controller.js';
import { spawnFragmentBodies } from '../game/fragment-bodies.js';

const $=id=>document.getElementById(id),canvas=$('scene'),stage=canvas.parentElement;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e7eadf');
const camera=new THREE.PerspectiveCamera(38,1,.02,6000),loader=new GLTFLoader(),raycaster=new THREE.Raycaster();
let renderer,controls,world,intact,shards,campus,studioEnvironment,manifest,colliderData,catalog,fixedBuilding,activeId=null;
let dynamic=[],helpers=[],loading=true,view='building',inspection=0;
let campusFocus='all';
let phase='ready',destroyed=false,score=0,sessionId=null,endsAt=0,errorMessage=null;
let accumulator=0,lastFrame=performance.now(),lastUiUpdate=-Infinity,pointerDown=null;
const game=new GameController({trackingMode:'keyboard_demo',source:'synthetic'});
let seenEvents=game.seenEvents;
const impactPoint=new THREE.Vector3(),impactNormal=new THREE.Vector3(0,0,1);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:'#e2e6d8',roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.002;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(12,24,'#c1cbb6','#d1d9c7');grid.position.y=-.001;scene.add(grid);
scene.add(new THREE.HemisphereLight('#fffdf0','#9eaf90',2.2));
const sun=new THREE.DirectionalLight('#fff5de',3.2);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun);
const marker=new THREE.Group();marker.add(
  new THREE.Mesh(new THREE.SphereGeometry(.016,12,8),new THREE.MeshBasicMaterial({color:'#d35d32'})),
  new THREE.Mesh(new THREE.RingGeometry(.035,.041,32),new THREE.MeshBasicMaterial({color:'#dc7748',side:THREE.DoubleSide})));
marker.visible=false;scene.add(marker);

// Dust buffers and texture are allocated once and reused through all resets.
const dustCount=180,dustPositions=new Float32Array(dustCount*3),dustVelocity=new Float32Array(dustCount*3);
const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
const dot=document.createElement('canvas');dot.width=dot.height=32;
const context=dot.getContext('2d'),gradient=context.createRadialGradient(16,16,0,16,16,16);
gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(1,'rgba(255,255,255,0)');context.fillStyle=gradient;context.fillRect(0,0,32,32);
const dustMaterial=new THREE.PointsMaterial({map:new THREE.CanvasTexture(dot),color:'#b9ab90',size:.1,transparent:true,opacity:0,depthWrite:false});
const dust=new THREE.Points(dustGeometry,dustMaterial);dust.frustumCulled=false;dust.visible=false;scene.add(dust);let dustStart=0;

function setLighting(campusView) {
  sun.position.set(...(campusView?[500,1200,700]:[-3,7,4]));
  Object.assign(sun.shadow.camera,campusView?{left:-760,right:760,top:760,bottom:-760,near:10,far:3000}:{left:-6,right:6,top:6,bottom:-6,near:.1,far:20});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=campusView?0.15:0.012;
  scene.environment=campusView?null:studioEnvironment;scene.fog=campusView?new THREE.FogExp2('#e7eadf',.00015):null;
}
function configureCamera() {
  camera.position.set(4.4,2.9,4.4);controls.target.set(0,(manifest?.dimensions_m[1]??1)*.45,0);
  controls.minDistance=1.5;controls.maxDistance=15;controls.maxPolarAngle=Math.PI/2-.02;controls.update();
}
function collider(item) {
  const descriptor=RAPIER.ColliderDesc.convexHull(new Float32Array(item.vertices_m));
  if(!descriptor)throw new Error(`충돌체 생성 실패: ${item.node}`);
  return descriptor.setDensity(item.density_kg_m3).setFriction(item.friction).setRestitution(item.restitution);
}
function createIntactBody() {
  fixedBuilding=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for(const item of colliderData.fragments)world.createCollider(collider(item).setTranslation(...item.rest_position_m),fixedBuilding);
}
function newHelpers(data) {
  return data.fragments.map(item=>{
    const points=[];for(let i=0;i<item.vertices_m.length;i+=3)points.push(new THREE.Vector3(...item.vertices_m.slice(i,i+3)));
    const hull=new ConvexGeometry(points),geometry=new THREE.EdgesGeometry(hull);hull.dispose();
    const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#c75532',depthTest:false,transparent:true,opacity:.6}));
    line.position.fromArray(item.rest_position_m);line.visible=false;line.renderOrder=5;return line;
  });
}
function disposeRoots(roots) {
  const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set();
  for(const root of roots.filter(Boolean))root.traverse(node=>{
    if(node.geometry)geometries.add(node.geometry);
    for(const mat of Array.isArray(node.material)?node.material:node.material?[node.material]:[])materials.add(mat);
  });
  for(const mat of materials)for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);
  for(const texture of textures){if(texture.image)images.add(texture.image);texture.dispose();}
  for(const image of images)image.close?.();for(const mat of materials)mat.dispose();for(const geometry of geometries)geometry.dispose();
}
function clearBuilding() {
  for(const item of dynamic)world.removeRigidBody(item.body);dynamic=[];
  if(fixedBuilding)world.removeRigidBody(fixedBuilding);fixedBuilding=null;
  for(const root of [intact,shards,...helpers].filter(Boolean))scene.remove(root);
  disposeRoots([intact,shards,...helpers]);helpers=[];intact=shards=null;renderer.renderLists.dispose();
}
async function fetchJson(url) {
  const response=await fetch(url);if(!response.ok)throw new Error(`${url.split('/').pop()}: HTTP ${response.status}`);return response.json();
}
async function loadBuilding(id) {
  if(id===activeId)return;
  const entry=catalog.buildings.find(item=>item.id===id);if(!entry)throw new Error('등록되지 않은 건물입니다.');
  loading=true;errorMessage=null;updateUI();let pending=[],pendingHelpers=[],committing=false;
  try {
    const base=`/public/assets/buildings/${entry.folder}/`;
    const [meta,data]=await Promise.all([fetchJson(base+'manifest.json'),fetchJson(base+'colliders.json')]);validatePackageMetadata(meta,data);
    const loaded=await Promise.allSettled([loader.loadAsync(base+meta.assets.intact),loader.loadAsync(base+meta.assets.fragments)]);
    pending=loaded.filter(item=>item.status==='fulfilled').map(item=>item.value.scene);
    const failure=loaded.find(item=>item.status==='rejected');if(failure)throw failure.reason;
    const [nextIntact,nextShards]=pending;validatePackageModels(meta,data,nextIntact,nextShards);
    for(const item of data.fragments)collider(item);pendingHelpers=newHelpers(data);
    committing=true;clearBuilding();manifest=meta;colliderData=data;intact=nextIntact;shards=nextShards;helpers=pendingHelpers;
    pending=[];pendingHelpers=[];activeId=id;scene.add(intact,shards,...helpers);shards.visible=false;
    for(const root of [intact,shards])root.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    createIntactBody();game.reset();seenEvents=game.seenEvents;phase=game.phase;destroyed=false;score=game.score;sessionId=game.sessionId;endsAt=game.endsAt;seenEvents.clear();inspection=0;accumulator=0;dust.visible=false;
    $('separation').value='0';$('building-select').value=id;$('manifest-link').href=base+'manifest.json';
    const url=new URL(location.href);url.searchParams.set('building',id);history.replaceState(null,'',url);
    loading=false;configureCamera();setLighting(false);chooseDefaultImpact();updateUI();
  } catch(error) {
    disposeRoots([...pending,...pendingHelpers]);if(!activeId||committing)throw error;
    loading=false;errorMessage=`새 건물을 불러오지 못했습니다. 기존 모델을 유지합니다: ${error.message}`;$('building-select').value=activeId;updateUI();
  }
}
function updateUI(now=performance.now()) {
  lastUiUpdate=now;const buildingView=view==='building',count=manifest?.fragment_count??0,name=manifest?.display_name??'건물';
  const seconds=phase==='playing'?Math.max(0,Math.ceil((endsAt-now)/1000)):phase==='ended'?0:60;
  $('time').innerHTML=`${seconds}<span>s</span>`;$('score').textContent=score;$('fragments').innerHTML=`${dynamic.length}<span> / ${count||'—'}</span>`;
  $('start').disabled=loading||!buildingView||phase!=='ready'||inspection>0;$('destroy').disabled=loading||!buildingView||destroyed||phase==='ended'||inspection>0;
  $('reset').disabled=loading||!buildingView;$('colliders').disabled=loading||!buildingView;$('building-select').disabled=loading||!buildingView;
  $('separation').disabled=loading||!buildingView||phase!=='ready';$('separation-value').textContent=`${Math.round(inspection*100)}%`;
  $('campus-focus-wrap').hidden=buildingView;$('campus-focus').disabled=loading;
  $('building-view').setAttribute('aria-pressed',String(buildingView));$('campus-view').setAttribute('aria-pressed',String(!buildingView));
  const focusLabel=catalog?.campus_focus?.find(item=>item.id===campusFocus)?.label;
  $('ready-state').textContent=errorMessage?'불러오기 실패':loading?'준비 중':buildingView?inspection>0?'분리 미리보기':'키보드 데모':'캠퍼스 v13';
  $('view-label').textContent=buildingView?`${name} / ${inspection>0?'분리 미리보기':destroyed?'파괴 상태':'조립 상태'}`:`${focusLabel??'캠퍼스'} / 지도·사진 대조 v13`;
  $('asset-name').textContent=buildingView?name:focusLabel??'경북대 캠퍼스 v13';$('asset-detail').textContent=buildingView?`사전 분할 ${count||'—'}개 · 볼록 충돌체 · m 단위`:'건물 123개 · 주요 6개 건물 외형 보완';
  $('caption').textContent=buildingView?`폭 ${(manifest?.dimensions_m[0]??0).toFixed(2)}m 게임용 모델 · 클릭으로 타격점 선택`:'공식 지도·건물 사진 대조 · 구성 치수는 근사';
  $('status').textContent=errorMessage||(loading?'모델과 물리 엔진을 준비하고 있습니다.':!buildingView?'그림자와 재질을 적용한 캠퍼스를 둘러보세요.':inspection>0?'파편 구조를 확인하세요. 슬라이더를 0으로 돌리거나 R 키로 복원하면 플레이할 수 있습니다.':phase==='ended'?'테스트 종료. R 키로 복원하고 다시 시작하세요.':destroyed?`${count}개 파편이 타격점 주변에서 퍼지고 무너집니다. R 키로 복원하세요.`:phase==='playing'?'Space로 파괴하세요. 주황색 표시는 타격 위치입니다.':'건물을 클릭해 타격점을 고른 뒤 Space를 누르세요.');
  marker.visible=!loading&&buildingView&&!destroyed&&inspection===0;
}
function expireSession(now){game.tick();if(phase!==game.phase){phase=game.phase;updateUI(now);}}
function start(){if(loading||view!=='building'||phase!=='ready'||inspection>0)return false;if(!game.startKeyboard())return false;sessionId=game.sessionId;phase=game.phase;endsAt=game.endsAt;updateUI();return true;}
function setImpact(hit){impactPoint.copy(hit.point);impactNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();marker.position.copy(impactPoint).addScaledVector(impactNormal,.006);marker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),impactNormal);}
function chooseDefaultImpact(){raycaster.set(camera.position,controls.target.clone().sub(camera.position).normalize());const hit=raycaster.intersectObject(intact,true)[0];if(hit)setImpact(hit);}
function emitDust(now){
  dustStart=now;dust.visible=true;dustMaterial.opacity=.5;
  for(let i=0;i<dustCount;i++){dustPositions.set(impactPoint.toArray(),i*3);const angle=i*2.399963,spread=(i%17)/17;dustVelocity.set([Math.cos(angle)*spread*.8+impactNormal.x*.5,.3+spread*.9,Math.sin(angle)*spread*.8+impactNormal.z*.5],i*3);}
  dustGeometry.attributes.position.needsUpdate=true;
}
function destroy(eventId=crypto.randomUUID()){
  expireSession(performance.now());if(loading||view!=='building'||destroyed||phase==='ended'||inspection>0)return false;if(phase==='ready')start();
  if(performance.now()>=endsAt||seenEvents.has(eventId))return false;
  if(!game.acceptKeyboard(eventId,activeId))return false;seenEvents.add(eventId);world.removeRigidBody(fixedBuilding);fixedBuilding=null;intact.visible=false;shards.visible=true;
  const radius=manifest.gameplay?.impact_radius_m??.65;
  dynamic=spawnFragmentBodies({world,shards,data:colliderData,impactPoint,impactNormal,radius,collider});
  destroyed=true;score=game.score;emitDust(performance.now());updateUI();return true;
}
function restoreNodes(){
  const center=new THREE.Vector3(0,manifest.dimensions_m[1]/2,0);
  colliderData.fragments.forEach((item,i)=>{const position=new THREE.Vector3(...item.rest_position_m);if(inspection>0)position.sub(center).multiplyScalar(1+inspection).add(center);const node=shards.getObjectByName(item.node);node.position.copy(position);node.quaternion.identity();helpers[i].position.copy(position);helpers[i].quaternion.identity();});
}
function reset(){
  if(loading||!manifest)return;for(const item of dynamic)world.removeRigidBody(item.body);dynamic=[];if(fixedBuilding)world.removeRigidBody(fixedBuilding);createIntactBody();
  inspection=0;$('separation').value='0';restoreNodes();shards.visible=false;intact.visible=view==='building';game.reset();seenEvents=game.seenEvents;phase=game.phase;destroyed=false;score=game.score;sessionId=game.sessionId;endsAt=game.endsAt;errorMessage=null;seenEvents.clear();accumulator=0;dust.visible=false;updateUI();
}
function previewSeparation(){if(loading||phase!=='ready'||view!=='building')return;inspection=Number($('separation').value);restoreNodes();intact.visible=inspection===0;shards.visible=inspection>0;updateUI();}
function showHelpers(){for(const helper of helpers)helper.visible=$('colliders').checked&&view==='building';}
function focusCampus(id='all'){
  if(view!=='campus'||loading)return;
  const focus=catalog.campus_focus?.find(item=>item.id===id);campusFocus=focus?id:'all';$('campus-focus').value=campusFocus;
  if(focus){controls.target.fromArray(focus.target_y_up_m);camera.position.copy(controls.target).add(new THREE.Vector3(.9,.7,1).multiplyScalar(focus.distance_m));controls.minDistance=20;controls.maxDistance=1800;}
  else{camera.position.set(1100,1000,1300);controls.target.set(0,-4,0);controls.minDistance=80;controls.maxDistance=3000;}
  controls.update();updateUI();
}
async function changeView(next){
  if(loading||next===view)return;
  if(next==='campus'){
    reset();loading=true;updateUI();
    try{
      if(!campus){campus=(await loader.loadAsync(catalog.campus)).scene;campus.traverse(node=>{if(node.isMesh){node.receiveShadow=true;node.castShadow=Boolean(node.userData.osm_way||String(node.userData.source_id??'').startsWith('vw/'));}});scene.add(campus);}
      view='campus';intact.visible=shards.visible=false;campus.visible=true;floor.visible=grid.visible=false;camera.position.set(1100,1000,1300);controls.target.set(0,-4,0);controls.minDistance=80;controls.maxDistance=3000;controls.update();setLighting(true);
    }catch(error){errorMessage=`지형을 불러오지 못했습니다: ${error.message}`;}finally{loading=false;if(view==='campus')focusCampus();showHelpers();updateUI();}
  }else{view='building';errorMessage=null;campus.visible=false;intact.visible=true;floor.visible=grid.visible=true;configureCamera();setLighting(false);showHelpers();updateUI();}
}
function resize(){const {width,height}=stage.getBoundingClientRect();camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);}
function frame(){
  const now=performance.now(),delta=Math.min((now-lastFrame)/1000,.1);requestAnimationFrame(frame);
  if(world&&view==='building'&&!loading){
    if(inspection===0){accumulator+=delta;while(accumulator>=1/60){world.step();accumulator-=1/60;}}
    dynamic.forEach(({node,body},i)=>{node.position.copy(body.translation());node.quaternion.copy(body.rotation());helpers[i].position.copy(node.position);helpers[i].quaternion.copy(node.quaternion);});expireSession(now);
    if(dust.visible){const age=(now-dustStart)/1000;if(age>1.25)dust.visible=false;else{for(let i=0;i<dustCount;i++)for(let axis=0;axis<3;axis++)dustPositions[i*3+axis]+=dustVelocity[i*3+axis]*delta;dustMaterial.opacity=.5*(1-age/1.25);dustGeometry.attributes.position.needsUpdate=true;}}
  }
  lastFrame=now;controls.update();renderer.render(scene,camera);if(now-lastUiUpdate>=200)updateUI(now);
}
$('start').addEventListener('click',start);$('destroy').addEventListener('click',()=>destroy());$('reset').addEventListener('click',reset);$('colliders').addEventListener('change',showHelpers);$('separation').addEventListener('input',previewSeparation);
$('building-view').addEventListener('click',()=>changeView('building'));$('campus-view').addEventListener('click',()=>changeView('campus'));
$('campus-focus').addEventListener('change',event=>focusCampus(event.target.value));
$('building-select').addEventListener('change',async event=>{if(loading||view!=='building')return;try{await loadBuilding(event.target.value);showHelpers();}catch(error){loading=true;errorMessage=`준비 실패: ${error.message}`;updateUI();}});
canvas.addEventListener('pointerdown',event=>{pointerDown={x:event.clientX,y:event.clientY};canvas.focus({preventScroll:true});});
canvas.addEventListener('pointerup',event=>{const down=pointerDown;pointerDown=null;if(!down||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5||loading||view!=='building'||destroyed||inspection>0)return;const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObject(intact,true)[0];if(hit)setImpact(hit);});
window.addEventListener('keydown',event=>{
  const target=event.target instanceof Element?event.target:null;
  if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||target?.isContentEditable||target?.closest('textarea,select,input:not([type="range"]):not([type="checkbox"])'))return;
  if(view!=='building'||loading)return;
  if(event.code==='Space'){if(target?.closest('button,a,input,[role="button"]'))return;event.preventDefault();destroy();}
  if(event.code==='KeyR'){event.preventDefault();reset();}if(event.code==='KeyG'){$('colliders').checked=!$('colliders').checked;showHelpers();}
});
window.__fractureDemo=Object.freeze({snapshot:()=>({loading,errorMessage,view,campusFocus,cameraPosition:camera.position.toArray(),cameraTarget:controls?.target.toArray(),phase,destroyed,score,sessionId,buildingId:activeId,expectedFragmentCount:manifest?.fragment_count,inspection,impactPoint:impactPoint.toArray(),dustVisible:dust.visible,fragmentCount:dynamic.length,bodyCount:world?.bodies.len(),colliderCount:world?.colliders.len(),seenEvents:seenEvents.size,intactVisible:intact?.visible,shardsVisible:shards?.visible,geometryCount:renderer?.info.memory.geometries,textureCount:renderer?.info.memory.textures,finiteBodies:dynamic.every(({body})=>Object.values(body.translation()).every(Number.isFinite)),minFragmentY:dynamic.length?Math.min(...dynamic.map(({body})=>body.translation().y)):null,restTransformsMatch:Boolean(shards&&colliderData?.fragments.every(item=>shards.getObjectByName(item.node).position.distanceTo(new THREE.Vector3(...item.rest_position_m))<1e-5))})});
async function init(){
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);studioEnvironment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
    controls=new OrbitControls(camera,canvas);controls.enableDamping=true;configureCamera();setLighting(false);new ResizeObserver(resize).observe(stage);resize();
    [catalog]=await Promise.all([fetchJson('/public/assets/buildings/catalog.json'),RAPIER.init()]);$('building-select').replaceChildren(...catalog.buildings.map(entry=>new Option(entry.label,entry.id)));
    $('campus-focus').append(...(catalog.campus_focus??[]).map(entry=>new Option(entry.label,entry.id)));
    world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/60;const ground=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.06,0));world.createCollider(RAPIER.ColliderDesc.cuboid(20,.06,20).setFriction(.8),ground);
    const requested=new URL(location.href).searchParams.get('building');await loadBuilding(catalog.buildings.some(entry=>entry.id===requested)?requested:catalog.default);lastFrame=performance.now();requestAnimationFrame(frame);
  }catch(error){if(world){world.free();world=null;}loading=true;errorMessage=`준비 실패: ${error.message}. 서버 실행과 패키지 파일을 확인한 뒤 새로고침하세요.`;console.error(error);updateUI();}
}
init();
