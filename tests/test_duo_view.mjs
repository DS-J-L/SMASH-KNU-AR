import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pixelRay,intersectZ,project,intrinsicsFromFov,markerCorners,stageMarkerPlane,solvePlanePoints,calibrateMarker,norm,sub,cross,normalize} from '../web/test/mono3d/geometry.js';
import {MARKER_BITS} from '../web/test/multi3d/aruco.js';
import {detectMarker,refineMarker} from '../web/test/multi3d/auto-marker.js';
import {solveViewPose,viewCalibrationMessage,measureMarkerLayout,viewLayoutMessage,layoutText,LAYOUT_WARN} from '../web/test/stage-view/view-calib.js';

// Duo stage (docs/DUO_STAGE_TEST.md): markers ID0/ID1 at x = -/+1 m (spacing 2 m), A3 side 0.27 m. The view phone
// stands on the far side (+Y), 1.6 m high, landscape, looking back at both markers.
const SIDE=.27,MARKERS={0:-1,1:1};
function lookAt(C,target){
  const f=normalize(sub(target,C)),x=normalize(cross(f,[0,0,1])),y=cross(f,x);
  const R=[...x,...y,...f];return {R,t:[0,1,2].map(r=>-(R[3*r]*C[0]+R[3*r+1]*C[1]+R[3*r+2]*C[2])),C};
}
const W=1280,H=720,FOV=75,K=intrinsicsFromFov(W,H,FOV),pose=lookAt([.15,3.3,1.6],[0,0,.25]);
const truth=Object.fromEntries(Object.entries(MARKERS).map(([id,x])=>[id,markerCorners(SIDE).map(([X,Y])=>project(K,pose,[X+x,Y,0]))]));

// Ray-cast every pixel to the floor; cells follow the printed artwork (row 0 = canonical top = +Y).
// ss > 1 supersamples each pixel (anti-aliased edges, as a real camera sees them).
function render(ss=1){
  const data=new Uint8ClampedArray(W*H*4),a=SIDE/2,cell=SIDE/6;
  for(let v=0;v<H;v++)for(let u=0;u<W;u++){
    let sum=0;
    for(let j=0;j<ss;j++)for(let k=0;k<ss;k++){
      let value=215;const P=intersectZ(pixelRay(K,pose,u+(k+.5)/ss,v+(j+.5)/ss),0);
      if(P)for(const [id,x] of Object.entries(MARKERS)){
        const c=Math.floor((P[0]-x+a)/cell),r=Math.floor((a-P[1])/cell);
        if(c>=0&&c<6&&r>=0&&r<6){value=c>0&&c<5&&r>0&&r<5&&MARKER_BITS[id][r-1][c-1]?225:30;break;}
      }
      sum+=value;
    }
    const i=(v*W+u)*4;data[i]=data[i+1]=data[i+2]=sum/ss/ss;data[i+3]=255;
  }
  return data;
}

test('8 corners of two markers recover the far-side view pose; one marker alone is far less certain',()=>{
  const noisy=id=>truth[id].map((p,i)=>[p[0]+.4*Math.sin(i*7+id),p[1]+.4*Math.cos(i*5+id)]);
  const r=solvePlanePoints(W,H,stageMarkerPlane([-1,1],SIDE),[...noisy(0),...noisy(1)],FOV);
  assert.ok(r.ok);assert.ok(norm(sub(r.pose.C,pose.C))<.05,`C ${r.pose.C}`);assert.ok(r.reprojection_max_px<1.5);
  // Seen from +Y the camera is behind the markers' "top" edge: the pose must say so.
  assert.ok(r.pose.C[1]>3);
  const one=calibrateMarker(W,H,noisy(0),SIDE,FOV);
  if(one.ok)assert.ok(norm(sub(one.pose.C,[pose.C[0]+1,pose.C[1],pose.C[2]]))>norm(sub(r.pose.C,pose.C)));
});

test('height picks the field of view; spacing that disagrees with the floor is refused',()=>{
  const corners={0:truth[0],1:truth[1]};
  const r=solveViewPose({width:W,height:H,corners,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:60,autoFov:true});
  assert.ok(r.ok,r.reason);assert.ok(Math.abs(r.fov_diag_deg-FOV)<1,`fov ${r.fov_diag_deg}`);assert.ok(norm(sub(r.pose.C,pose.C))<.03);
  const message=viewCalibrationMessage(r,{spacing:2,sideM:SIDE});
  assert.equal(message.type,'wide3d_view_calib');assert.deepEqual(message.marker_ids,[0,1]);assert.equal(message.image.width,W);
  const wrong=solveViewPose({width:W,height:H,corners,markers:{0:-.75,1:.75},sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV,autoFov:false});
  assert.equal(wrong.ok,false);assert.equal(wrong.reason,'marker_reprojection_error');
  assert.equal(solveViewPose({width:W,height:H,corners:{0:truth[0]},markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV}).reason,'markers_missing');
});

test('both markers are found in one landscape frame from the far side, each with its own pattern order',()=>{
  const image=render();
  for(const id of [0,1]){
    const found=detectMarker(image,W,H,id);
    assert.ok(found,`ID${id} not found`);
    // Pattern order, not screen order: from the far side the marker's top edge is the one nearest the camera.
    found.forEach((p,i)=>assert.ok(Math.hypot(p[0]-truth[id][i][0],p[1]-truth[id][i][1])<2,`ID${id} corner ${i} ${p} vs ${truth[id][i]}`));
  }
  const corners={0:detectMarker(image,W,H,0),1:detectMarker(image,W,H,1)};
  const r=solveViewPose({width:W,height:H,corners,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV,autoFov:true});
  assert.ok(r.ok,r.reason);
  // Focal length and distance trade off a little from one view (about 0.1 m along the line of sight here); what the
  // main screen needs is that stage points land where they should in this image.
  assert.ok(norm(sub(r.pose.C,pose.C))<.2,`C ${r.pose.C}`);
  for(const P of [[0,0,1],[-1.5,-.5,.8],[1.5,.5,1.2],[0,-.6,1.8],[-2,0,0],[2,0,.5]]){
    const a=project(K,pose,P),b=project(r.K,r.pose,P);
    assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.01*W,`${P}: ${a} vs ${b}`);
  }
});

// ID1 placed 5 cm too far, 3 cm forward and turned 3°: the rigid check still passes at 1280 x 720, so only the
// measured layout shows it. Corners carry ±0.5 px noise.
function placed(dx,dy,yawDeg,noise=.5){
  const y=yawDeg*Math.PI/180,c=Math.cos(y),s=Math.sin(y);
  const px=(id,P)=>{const q=project(K,pose,P);return [q[0]+noise*Math.sin(id*13+P[0]*97),q[1]+noise*Math.cos(id*7+P[1]*89)];};
  return {0:markerCorners(SIDE).map(([X,Y])=>px(0,[X-1,Y,0])),1:markerCorners(SIDE).map(([X,Y])=>px(1,[c*X-s*Y+1+dx,s*X+c*Y+dy,0]))};
}

test('the view phone measures the real marker spacing and turns, even where the rigid check passes',()=>{
  const corners=placed(.05,.03,3),args={width:W,height:H,corners,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,autoFov:true};
  const rigid=solveViewPose(args);
  assert.ok(rigid.ok,'the rigid 8-point check does not catch this placement');
  const L=rigid.layout,line=Math.atan2(.03,2.05)*180/Math.PI;
  assert.ok(L.ok);assert.ok(Math.abs(L.spacing_m-Math.hypot(2.05,.03))<.015,`spacing ${L.spacing_m}`);
  assert.ok(Math.abs(L.relative_yaw_deg-3)<1,`relative ${L.relative_yaw_deg}`);
  assert.ok(Math.abs(L.yaw_deg[0]+line)<1&&Math.abs(L.yaw_deg[1]-(3-line))<1,`yaw ${L.yaw_deg}`);
  assert.deepEqual(L.warn,['spacing','yaw']);assert.match(layoutText(L),/⚠/);
  const message=viewLayoutMessage(L);assert.equal(message.type,'wide3d_view_layout');assert.equal(message.yaw_deg.length,2);

  // Placed as entered: no warning.
  const good=measureMarkerLayout({...args,corners:placed(0,0,0)});
  assert.ok(Math.abs(good.spacing_m-2)<.015);assert.ok(good.yaw_deg.every(v=>Math.abs(v)<1));assert.deepEqual(good.warn,[]);
  assert.ok(LAYOUT_WARN.yaw_deg===2&&LAYOUT_WARN.spacing_m===.03);
});

test('a placement the rigid check refuses still reports the measured layout, independent of the entered spacing',()=>{
  const corners=placed(.25,0,0);
  const refused=solveViewPose({width:W,height:H,corners,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV,autoFov:false});
  assert.equal(refused.ok,false);assert.ok(refused.layout.ok);
  assert.ok(Math.abs(refused.layout.spacing_m-2.25)<.02,`spacing ${refused.layout.spacing_m}`);
  // Entered 2.25 m now: the same corners give the same measurement, and the rigid solve accepts.
  const fixed=solveViewPose({width:W,height:H,corners,markers:{0:-1.125,1:1.125},sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV,autoFov:false});
  assert.ok(fixed.ok,fixed.reason);assert.ok(Math.abs(fixed.layout.spacing_m-refused.layout.spacing_m)<.005);
});

test('sub-pixel corners: the far-side view measures spacing and turns from real (anti-aliased) edges far better',()=>{
  const image=render(3),raw={},fine={};
  for(const id of [0,1]){raw[id]=detectMarker(image,W,H,id);assert.ok(raw[id],`ID${id}`);fine[id]=refineMarker(image,W,H,raw[id],id);}
  const err=c=>Math.max(...[0,1].flatMap(id=>c[id].map((p,i)=>Math.hypot(p[0]-truth[id][i][0],p[1]-truth[id][i][1]))));
  assert.ok(err(raw)>.8,`raw ${err(raw)}`);assert.ok(err(fine)<.3,`refined ${err(fine)}`);
  const measure=corners=>measureMarkerLayout({width:W,height:H,corners,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,autoFov:true});
  const before=measure(raw),after=measure(fine);
  assert.ok(Math.abs(after.spacing_m-2)<.01,`spacing ${after.spacing_m}`);assert.ok(after.yaw_deg.every(v=>Math.abs(v)<.3),`yaw ${after.yaw_deg}`);
  assert.ok(Math.abs(after.spacing_m-2)<Math.abs(before.spacing_m-2),`before ${before.spacing_m} after ${after.spacing_m}`);
  assert.deepEqual(after.warn,[]);
  const r=solveViewPose({width:W,height:H,corners:fine,markers:MARKERS,sideM:SIDE,cameraHeightM:1.6,fovDiagDeg:FOV,autoFov:true});
  assert.ok(r.ok,r.reason);assert.ok(Math.abs(r.fov_diag_deg-FOV)<1,`fov ${r.fov_diag_deg}`);
});
