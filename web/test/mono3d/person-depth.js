// Person silhouette + approximate camera-space depth. No additional inference model.
import {matVec,add,project} from './geometry.js?v=20261111-1';
import {estimate} from './mono3d.js?v=20261120-t1';
const IDS={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,
  left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
const BONES=[[0,11],[0,12],[11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export const PERSON_DEPTH_ENCODING='camera_z_mm_rg16_alpha_v1';

// Visual-only torso fallback. Never return these coordinates to collision/tracking consumers.
export function visualPersonEstimate(K,pose,landmarks,world,body,tracking){
  if(tracking?.valid)return tracking;
  if(tracking?.reason!=='feet_required_for_depth'||!body?.scale||!landmarks||!world)return null;
  const visualLandmarks=[...landmarks];
  for(const id of [27,28,29,30,31,32])if(visualLandmarks[id])visualLandmarks[id]={...visualLandmarks[id],visibility:0};
  const visual=estimate(K,pose,visualLandmarks,world,{...body,depth_reference:null});
  return visual.valid?{...visual,source:'visual_torso_only',collision_usable:false}:null;
}

// Copy while the MediaPipe result is alive; its GPU/CPU masks are released by result.close().
export function copyPersonMask(mask,maxWidth=192,maxHeight=384){
  if(!mask)return null;
  const source=mask.getAsFloat32Array(),sw=mask.width,sh=mask.height;
  if(!(sw>0&&sh>0)||source.length!==sw*sh)return null;
  const ratio=Math.min(1,maxWidth/sw,maxHeight/sh),width=Math.max(1,Math.round(sw*ratio)),height=Math.max(1,Math.round(sh*ratio));
  const alpha=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const value=source[Math.min(sh-1,Math.floor((y+.5)*sh/height))*sw+Math.min(sw-1,Math.floor((x+.5)*sw/width))];
    alpha[y*width+x]=value>=.6?255:0;
  }
  return {width,height,alpha};
}

// Segmentation can come back empty or misplaced on some phones (GPU delegate). The skeleton gives a
// coarse body-shaped silhouette so occlusion still works; it is an approximation, not a measured outline.
const landmarkPoint=(landmarks,id,width,height,min=.3)=>{
  const l=landmarks?.[id];
  return l&&l.visibility>=min&&Number.isFinite(l.x)&&Number.isFinite(l.y)?{x:l.x*width,y:l.y*height}:null;
};

// Fraction of sample points inside the shoulder-hip quad that the mask marks as person; null = cannot judge.
export function torsoMaskCoverage(mask,landmarks){
  if(!mask||!landmarks)return null;
  const {width,height,alpha}=mask,p=id=>landmarkPoint(landmarks,id,width,height);
  const ls=p(11),rs=p(12),lh=p(23),rh=p(24);
  if(!ls||!rs||!lh||!rh)return null;
  let hit=0,total=0;
  for(const v of [.2,.4,.6,.8])for(const u of [.2,.4,.6,.8]){
    const top={x:ls.x+(rs.x-ls.x)*u,y:ls.y+(rs.y-ls.y)*u},bottom={x:lh.x+(rh.x-lh.x)*u,y:lh.y+(rh.y-lh.y)*u};
    const x=Math.floor(top.x+(bottom.x-top.x)*v),y=Math.floor(top.y+(bottom.y-top.y)*v);
    total++;if(x>=0&&x<width&&y>=0&&y<height&&alpha[y*width+x])hit++;
  }
  return hit/total;
}
export const MIN_TORSO_MASK_COVERAGE=.5;

export function skeletonMask(landmarks,width,height){
  const p=id=>landmarkPoint(landmarks,id,width,height);
  const ls=p(11),rs=p(12),lh=p(23),rh=p(24);
  if(!ls||!rs||!lh||!rh||!(width>0&&height>0))return null;
  const shoulder=Math.hypot(ls.x-rs.x,ls.y-rs.y),limb=Math.max(2,shoulder*.2);
  const alpha=new Uint8Array(width*height);
  const bounds=(pts,r)=>({x0:Math.max(0,Math.floor(Math.min(...pts.map(q=>q.x))-r)),x1:Math.min(width-1,Math.ceil(Math.max(...pts.map(q=>q.x))+r)),
    y0:Math.max(0,Math.floor(Math.min(...pts.map(q=>q.y))-r)),y1:Math.min(height-1,Math.ceil(Math.max(...pts.map(q=>q.y))+r))});
  const capsule=(a,b,r)=>{
    if(!a||!b)return;
    const {x0,x1,y0,y1}=bounds([a,b],r),dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const t=len?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/len)):0;
      if((x+.5-a.x-t*dx)**2+(y+.5-a.y-t*dy)**2<=r*r)alpha[y*width+x]=255;
    }
  };
  const triangle=(a,b,c)=>{
    const {x0,x1,y0,y1}=bounds([a,b,c],0),d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(d)<1e-6)return;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const u=((b.y-c.y)*(x+.5-c.x)+(c.x-b.x)*(y+.5-c.y))/d,v=((c.y-a.y)*(x+.5-c.x)+(a.x-c.x)*(y+.5-c.y))/d;
      if(u>=0&&v>=0&&u+v<=1)alpha[y*width+x]=255;
    }
  };
  triangle(ls,rs,lh);triangle(rs,rh,lh);
  capsule(ls,rs,limb*.9);capsule(lh,rh,limb*.9);capsule(ls,lh,limb*.9);capsule(rs,rh,limb*.9);
  for(const [a,b,r] of [[11,13,limb],[13,15,limb*.85],[12,14,limb],[14,16,limb*.85],
    [23,25,limb*1.15],[25,27,limb],[24,26,limb*1.15],[26,28,limb]])capsule(p(a),p(b),r);
  const neck={x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2},hipMid={x:(lh.x+rh.x)/2,y:(lh.y+rh.y)/2};
  const nose=p(0),headR=Math.max(3,shoulder*.38);
  const up=Math.hypot(neck.x-hipMid.x,neck.y-hipMid.y)||1;
  const head=nose??{x:neck.x+(neck.x-hipMid.x)/up*headR*1.4,y:neck.y+(neck.y-hipMid.y)/up*headR*1.4};
  capsule(neck,head,headR);
  return {width,height,alpha,source:'skeleton'};
}

// Why packPersonDepth would return null — shown on the phone so failures are not a guess.
export function personDepthDiagnosis(mask,landmarks,result,pose){
  if(!landmarks)return '사람 미검출';
  if(!result?.valid)return '깊이 추정 불가';
  if(!pose)return '카메라 보정 없음';
  const names={11:'왼어깨',12:'오른어깨',23:'왼골반',24:'오른골반'},bad=[];
  for(const id of [11,12,23,24]){
    const l=landmarks[id],joint=result.joints?.[{11:'left_shoulder',12:'right_shoulder',23:'left_hip',24:'right_hip'}[id]];
    const vis=Number.isFinite(l?.visibility)?l.visibility.toFixed(2):'없음';
    if(!l||l.visibility<.5||!joint?.position_m)bad.push(names[id]+' '+vis);
  }
  if(bad.length)return '몸통 관절 부족: '+bad.join(', ');
  if(!mask)return '윤곽 없음';
  return '윤곽 전경 0픽셀';
}

function triangleDepth(x,y,a,b,c){
  if(!a||!b||!c)return null;
  const d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<1e-6)return null;
  const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d;
  const v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d,w=1-u-v;
  return Math.min(u,v,w)>=-1e-6?1/(u/a.z+v/b.z+w/c.z):null;
}

export function packPersonDepth(mask,landmarks,result,pose){
  if(!mask||!result?.valid||!landmarks||!pose)return null;
  const {width,height,alpha}=mask,points={};
  for(const [name,id]of Object.entries(IDS)){
    const p=result.joints?.[name]?.position_m,l=landmarks[id];
    if(!p||!p.every(Number.isFinite)||!l||l.visibility<.5||![l.x,l.y].every(Number.isFinite))continue;
    const z=add(matVec(pose.R,p),pose.t)[2];
    if(z>.05&&z<60)points[id]={x:l.x*width,y:l.y*height,z};
  }
  if(!points[11]||!points[12]||!points[23]||!points[24])return null;
  const bones=BONES.filter(([a,b])=>points[a]&&points[b]).map(([ia,ib])=>{
    const a=points[ia],b=points[ib],dx=b.x-a.x,dy=b.y-a.y;
    return {x:a.x,y:a.y,dx,dy,len:dx*dx+dy*dy,invZ:1/a.z,invDelta:1/b.z-1/a.z};
  });
  const radius=Math.max(2,Math.hypot(points[11].x-points[12].x,points[11].y-points[12].y)*.22);
  const data=new Uint8ClampedArray(width*height*4);let pixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!alpha[i])continue;
    const px=x+.5,py=y+.5;
    const torso=triangleDepth(px,py,points[11],points[12],points[23])??triangleDepth(px,py,points[12],points[24],points[23]);
    let z=torso,nearest=Infinity;
    for(let b=0;b<bones.length;b++){
      const bone=bones[b],dx=px-bone.x,dy=py-bone.y;
      const t=bone.len?Math.max(0,Math.min(1,(dx*bone.dx+dy*bone.dy)/bone.len)):0;
      const distance=(dx-t*bone.dx)**2+(dy-t*bone.dy)**2;
      if(torso!==null){if(distance<radius*radius)z=Math.min(z,1/(bone.invZ+t*bone.invDelta));}
      else if(distance<nearest){nearest=distance;z=1/(bone.invZ+t*bone.invDelta);}
    }
    if(!(z>0))continue;
    // Joints approximate body centres; 6cm is a visual surface estimate, not measured anatomy.
    const mm=Math.max(1,Math.min(60000,Math.round((z-.06)*1000)));
    data[i*4]=mm>>8;data[i*4+1]=mm&255;data[i*4+3]=255;pixels++;
  }
  return pixels?{width,height,data,pixels}:null;
}

// Reproject the recent fused torso into the exact JPEG/mask frame before borrowing its depth.
export function packFusedPersonDepth(mask,landmarks,fused,calib,ageMs,cameraId){
  if(!calib?.K||!calib.pose||!fused?.joints||!landmarks||ageMs<0||ageMs>200)return null;
  let lm=landmarks;
  if(fused.swapped_left_right?.includes(cameraId)){
    lm=[...landmarks];for(const [a,b] of [[11,12],[13,14],[15,16],[23,24],[25,26],[27,28]])[lm[a],lm[b]]=[lm[b],lm[a]];
  }
  const joints=Object.fromEntries(Object.entries(fused.joints).map(([n,j])=>[n,j?.p?{position_m:j.p}:null]));
  const {K,pose}=calib;
  for(const name of Object.keys(IDS)){
    const p=joints[name]?.position_m,l=lm[IDS[name]],pixel=p&&project(K,pose,p);
    const required=['left_shoulder','right_shoulder','left_hip','right_hip'].includes(name);
    if(!required&&(!pixel||!l||l.visibility<.5))continue;
    if(!pixel||!l||l.visibility<.5||Math.hypot(pixel[0]-l.x*K.width,pixel[1]-l.y*K.height)>Math.max(12,Math.hypot(K.width,K.height)*.025))return null;
  }
  return packPersonDepth(mask,lm,{valid:true,joints},pose);
}
