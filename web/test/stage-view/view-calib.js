// View-only phone of the duo stage (docs/DUO_STAGE_TEST.md): its pose from both floor markers at once.
// Pure functions (no DOM) so Node tests run the same code as the phone.
import {solvePlanePoints,fovForPlanePointsHeight,stageMarkerPlane,project,intrinsicsFromFov,homographyLS,planePose,
  markerCorners,solveLinear,transposeMul,scale} from '../mono3d/geometry.js?v=20261117-d1';

export const VIEW_MARKER_IDS=[0,1];
// A measured layout this far from the entered one moves the judging phones' coordinates visibly (2° at 1.5 m ≈ 5 cm).
export const LAYOUT_WARN={spacing_m:.03,yaw_deg:2};

// corners: {0:[4 px], 1:[4 px]} oriented by each marker's pattern; markers: {0:x_m, 1:x_m} from the server.
// Every result after markers_missing carries `layout`: the markers' real placement measured from these corners.
export function solveViewPose({width,height,corners,markers,sideM,cameraHeightM,fovDiagDeg,autoFov=true}){
  if(!VIEW_MARKER_IDS.every(id=>corners?.[id]?.length===4&&Number.isFinite(markers?.[id])))return {ok:false,reason:'markers_missing'};
  const layout=measureMarkerLayout({width,height,corners,markers,sideM,cameraHeightM,fovDiagDeg,autoFov});
  const plane=stageMarkerPlane(VIEW_MARKER_IDS.map(id=>markers[id]),sideM),pixels=VIEW_MARKER_IDS.flatMap(id=>corners[id]);
  let fov=fovDiagDeg;
  if(autoFov){fov=fovForPlanePointsHeight(width,height,plane,pixels,cameraHeightM);if(fov===null)return {ok:false,reason:'no_fov_for_height',layout};}
  const r=solvePlanePoints(width,height,plane,pixels,fov);
  if(!r.ok)return {...r,layout};
  // Same practical limit as the single-marker calibration, per 720 px of the short side.
  const limit=3*Math.min(width,height)/720;
  if(!(r.reprojection_max_px<=limit))return {ok:false,reason:'marker_reprojection_error',reprojection_max_px:r.reprojection_max_px,limit,layout};
  return {...r,fov_diag_deg:fov,plane,pixels,layout};
}

// ----- measured marker layout -----
// The rigid solve assumes ID1 sits exactly `spacing` right of ID0 with the same orientation. Here ID1's floor offset
// (dx, dy) and turn (yaw) are unknowns too, solved with V's pose from all 8 corners (marker size is known, so both
// spacing and turn are observable). The result is reported against the line through both marker centres, which is
// the stage x axis a corrected layout would use: spacing, and each marker's turn from that line.
function rodrigues([x,y,z]){
  const th=Math.hypot(x,y,z);if(th<1e-12)return [1,-z,y,z,1,-x,-y,x,1];
  const k=[x/th,y/th,z/th],c=Math.cos(th),s=Math.sin(th),v=1-c;
  return [c+k[0]*k[0]*v,k[0]*k[1]*v-k[2]*s,k[0]*k[2]*v+k[1]*s,k[1]*k[0]*v+k[2]*s,c+k[1]*k[1]*v,k[1]*k[2]*v-k[0]*s,
    k[2]*k[0]*v-k[1]*s,k[2]*k[1]*v+k[0]*s,c+k[2]*k[2]*v];
}
const mul3=(A,B)=>[0,1,2].flatMap(r=>[0,1,2].map(c=>A[3*r]*B[c]+A[3*r+1]*B[3+c]+A[3*r+2]*B[6+c]));
const withC=(R,t)=>({R,t,C:scale(transposeMul(R,t),-1)});

function layoutPoints(markers,sideM,[dx,dy,yaw]){
  const c=Math.cos(yaw),s=Math.sin(yaw),corner=markerCorners(sideM);
  return [...corner.map(([X,Y])=>[X+markers[0],Y,0]),...corner.map(([X,Y])=>[c*X-s*Y+markers[1]+dx,s*X+c*Y+dy,0])];
}

// Levenberg-Marquardt over V's pose (6) and ID1's offset (3), numeric Jacobian.
function fitLayout(K,markers,sideM,pixels,start){
  const model=p=>({pose:withC(mul3(rodrigues(p.slice(0,3)),start.R),[0,1,2].map(i=>start.t[i]+p[3+i])),layout:p.slice(6)});
  const residual=p=>{const {pose,layout}=model(p);
    return layoutPoints(markers,sideM,layout).flatMap((P,i)=>{const q=project(K,pose,P);return q?[q[0]-pixels[i][0],q[1]-pixels[i][1]]:[1e6,1e6];});};
  const cost=r=>r.reduce((s,v)=>s+v*v,0),N=9;
  let p=new Array(N).fill(0),r=residual(p),c=cost(r),lambda=1e-3;
  for(let it=0;it<60;it++){
    const J=[...Array(N).keys()].map(k=>{const q=[...p];q[k]+=1e-6;return residual(q).map((v,i)=>(v-r[i])/1e-6);});
    const A=J.map(a=>J.map(b=>a.reduce((s,v,n)=>s+v*b[n],0))),g=J.map(a=>-a.reduce((s,v,n)=>s+v*r[n],0));
    let improved=false;
    for(let tries=0;tries<8&&!improved;tries++){
      const step=solveLinear(A.map((row,i)=>row.map((v,j)=>v+(i===j?lambda*(A[i][i]+1e-9):0))),g);
      if(!step){lambda*=10;continue;}
      const q=p.map((v,i)=>v+step[i]),rq=residual(q),cq=cost(rq);
      if(cq<c){p=q;r=rq;c=cq;improved=true;lambda=Math.max(lambda/10,1e-9);}else lambda*=10;
    }
    if(!improved||c<1e-18)break;
  }
  const {pose,layout}=model(p);
  let worst=0;for(let i=0;i<r.length;i+=2)worst=Math.max(worst,Math.hypot(r[i],r[i+1]));
  return {pose,offset:layout,reprojection_max_px:worst};
}

function layoutAtFov(width,height,markers,sideM,pixels,fov){
  const K=intrinsicsFromFov(width,height,fov),plane=layoutPoints(markers,sideM,[0,0,0]).map(([X,Y])=>[X,Y]);
  const H=homographyLS(plane,pixels);if(!H)return null;
  const start=planePose(K,H);if(!(start.C[2]>0))return null;
  const f=fitLayout(K,markers,sideM,pixels,start);
  return f.pose.C[2]>0?{...f,K}:null;
}

// The FOV whose free-layout solve puts V at the entered height (same scan + bisection as the rigid solve).
function layoutFovForHeight(width,height,markers,sideM,pixels,targetM,lo=30,hi=130){
  const h=fov=>{const r=layoutAtFov(width,height,markers,sideM,pixels,fov);return r?r.pose.C[2]-targetM:NaN;};
  let prev=null;
  for(let fov=lo;fov<=hi+1e-9;fov+=4){
    const value=h(fov);if(!Number.isFinite(value)){prev=null;continue;}
    if(prev&&prev.value*value<=0){
      let a=prev.fov,b=fov,fa=prev.value;
      for(let i=0;i<30;i++){const m=(a+b)/2,fm=h(m);if(!Number.isFinite(fm))return null;if(fa*fm<=0)b=m;else{a=m;fa=fm;}}
      return (a+b)/2;
    }
    prev={fov,value};
  }
  return null;
}

export function measureMarkerLayout({width,height,corners,markers,sideM,cameraHeightM,fovDiagDeg,autoFov=true}){
  const pixels=VIEW_MARKER_IDS.flatMap(id=>corners[id]);
  const fov=autoFov?layoutFovForHeight(width,height,markers,sideM,pixels,cameraHeightM):fovDiagDeg;
  if(!Number.isFinite(fov))return {ok:false,reason:'no_fov_for_height'};
  const f=layoutAtFov(width,height,markers,sideM,pixels,fov);
  if(!f)return {ok:false,reason:'layout_solve_failed'};
  const [dx,dy,yaw]=f.offset,ex=markers[1]+dx-markers[0],line=Math.atan2(dy,ex),deg=v=>v*180/Math.PI;
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const spacing=Math.hypot(ex,dy),entered=markers[1]-markers[0];
  const yawDeg=[deg(wrap(-line)),deg(wrap(yaw-line))];
  const warn=[];
  if(Math.abs(spacing-entered)>LAYOUT_WARN.spacing_m)warn.push('spacing');
  if(yawDeg.some(v=>Math.abs(v)>LAYOUT_WARN.yaw_deg))warn.push('yaw');
  return {ok:true,spacing_m:spacing,entered_spacing_m:entered,yaw_deg:yawDeg,relative_yaw_deg:deg(wrap(yaw)),
    fov_diag_deg:fov,reprojection_max_px:f.reprojection_max_px,warn};
}

export function layoutText(layout){
  if(!layout?.ok)return '마커 배치 측정 실패';
  const yaw=layout.yaw_deg.map((v,i)=>`ID${i} ${v>=0?'+':''}${v.toFixed(1)}°`).join(' · ');
  return `실측 간격 ${layout.spacing_m.toFixed(3)}m(입력 ${layout.entered_spacing_m.toFixed(3)}m) · 두 마커 중심선 기준 회전 ${yaw}`
    +(layout.warn.length?` · ⚠ ${[layout.warn.includes('spacing')?`간격 차이 ${LAYOUT_WARN.spacing_m*100}cm 초과`:null,layout.warn.includes('yaw')?`회전 ${LAYOUT_WARN.yaw_deg}° 초과`:null].filter(Boolean).join(', ')}`:'');
}

// Sent whenever V measured the layout, even if its rigid calibration failed: the PC can show it and apply the spacing.
export function viewLayoutMessage(layout){
  return {type:'wide3d_view_layout',spacing_m:layout.spacing_m,entered_spacing_m:layout.entered_spacing_m,yaw_deg:layout.yaw_deg,
    relative_yaw_deg:layout.relative_yaw_deg,reprojection_max_px:layout.reprojection_max_px,warn:layout.warn};
}

export function viewCalibrationMessage(calib,{spacing,sideM}){
  const {K,pose}=calib;
  return {type:'wide3d_view_calib',schema:'duo_view.v1',image:{width:K.width,height:K.height},
    K:{fx:K.fx,fy:K.fy,cx:K.cx,cy:K.cy},camera:{R:pose.R,t:pose.t,C:pose.C},marker_ids:VIEW_MARKER_IDS,
    spacing_m:spacing,marker_side_m:sideM,reprojection_max_px:calib.reprojection_max_px,fov_diag_deg:calib.fov_diag_deg};
}

export function reasonText(reason){
  return {markers_missing:'두 마커(ID0·ID1)가 모두 보여야 합니다.',
    no_fov_for_height:'입력한 폰 높이와 맞는 화각이 없습니다. 높이를 다시 재거나, 화각 자동을 끄고 직접 입력하세요.',
    marker_reprojection_error:'두 마커 위치가 입력한 간격과 맞지 않습니다. 아래 실측 간격·회전을 보고 마커를 바로 놓거나, PC에서 실측 간격을 적용하세요.',
    camera_below_floor_check_corner_order:'카메라가 바닥 아래로 계산됐습니다. 마커가 뒤집히지 않았는지 확인하세요.',
    degenerate_corners:'마커 모서리를 읽지 못했습니다.'}[reason]??`보정 실패: ${reason}`;
}

export {project};
