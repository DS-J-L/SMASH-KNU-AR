import assert from 'node:assert/strict';
import test from 'node:test';
import {copyPersonMask,packPersonDepth,packFusedPersonDepth} from '../web/test/mono3d/person-depth.js';
test('mask copying thresholds foreground and limits transmitted resolution',()=>{
  assert.deepEqual([...copyPersonMask({width:2,height:2,getAsFloat32Array:()=>new Float32Array([0,.59,.61,1])}).alpha],[0,0,255,255]);
  const m=copyPersonMask({width:720,height:1280,getAsFloat32Array:()=>new Float32Array(720*1280).fill(1)});
  assert.equal(m.width,192);assert.equal(m.height,341);assert.equal(m.alpha.length,192*341);
});
function fixture(){
  const landmarks=[],joints={},points={nose:[.5,.15],left_shoulder:[.35,.3],right_shoulder:[.65,.3],
    left_elbow:[.25,.45],left_wrist:[.2,.55],right_elbow:[.75,.45],right_wrist:[.8,.55],
    left_hip:[.4,.6],right_hip:[.6,.6],left_knee:[.4,.75],right_knee:[.6,.75],left_ankle:[.4,.9],right_ankle:[.6,.9]};
  const ids={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
  for(const [name,[x,y]]of Object.entries(points)){landmarks[ids[name]]={x,y,visibility:.95};joints[name]={position_m:[0,0,2]};}
  const alpha=new Uint8Array(64*64);for(let y=8;y<59;y++)for(let x=10;x<54;x++)alpha[y*64+x]=255;
  return {mask:{width:64,height:64,alpha},landmarks,result:{valid:true,joints},pose:{R:[1,0,0,0,1,0,0,0,1],t:[0,0,0]}};
}
const depthAt=(p,x,y)=>p.data[(y*64+x)*4]*256+p.data[(y*64+x)*4+1];
test('packed depth preserves silhouette and camera depth without treating world Y as depth',()=>{
  const f=fixture(),p=packPersonDepth(f.mask,f.landmarks,f.result,f.pose);assert.ok(p);
  assert.equal(depthAt(p,32,30),1940);assert.equal(p.data[3],0);assert.equal(p.data[(30*64+32)*4+3],255);
  const shifted={...f.pose,t:[0,0,3]};
  assert.equal(depthAt(packPersonDepth(f.mask,f.landmarks,f.result,shifted),32,30),4940);
});
test('near arm receives its own depth and invalid or untracked inputs produce no mask',()=>{
  const f=fixture();f.result.joints.right_wrist.position_m[2]=1;
  const p=packPersonDepth(f.mask,f.landmarks,f.result,f.pose);assert.ok(depthAt(p,51,35)<1100);
  assert.equal(packPersonDepth(f.mask,f.landmarks,{...f.result,valid:false},f.pose),null);
  f.landmarks[11].visibility=.1;assert.equal(packPersonDepth(f.mask,f.landmarks,f.result,f.pose),null);
});

test('fused depth requires fresh geometrically matching torso and respects corrected left/right labels',()=>{
  const f=fixture(),K={width:640,height:480,fx:500,fy:500,cx:320,cy:240};
  const ids={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
  const joints=Object.fromEntries(Object.entries(ids).map(([n,id])=>{const l=f.landmarks[id];return [n,{p:[(l.x*640-320)*2/500,(l.y*480-240)*2/500,2]}];}));
  const fused={joints,swapped_left_right:[]},calib={K,pose:f.pose};
  assert.ok(packFusedPersonDepth(f.mask,f.landmarks,fused,calib,50,'C0'));
  assert.equal(packFusedPersonDepth(f.mask,f.landmarks,fused,calib,201,'C0'),null);
  assert.equal(packFusedPersonDepth(f.mask,f.landmarks,fused,calib,-1,'C0'),null);
  const moved={...fused,joints:{...joints,left_shoulder:{p:[4,0,2]}}};
  assert.equal(packFusedPersonDepth(f.mask,f.landmarks,moved,calib,50,'C0'),null);
  const swapped=[...f.landmarks];for(const [a,b]of [[11,12],[13,14],[15,16],[23,24],[25,26],[27,28]])[swapped[a],swapped[b]]=[swapped[b],swapped[a]];
  assert.ok(packFusedPersonDepth(f.mask,swapped,{...fused,swapped_left_right:['C1']},calib,50,'C1'));
});

test('blank or misplaced segmentation is detected and the skeleton silhouette still yields depth',async()=>{
  const {torsoMaskCoverage,skeletonMask,personDepthDiagnosis,MIN_TORSO_MASK_COVERAGE}=await import('../web/test/mono3d/person-depth.js');
  const f=fixture();
  assert.ok(torsoMaskCoverage(f.mask,f.landmarks)>=MIN_TORSO_MASK_COVERAGE);
  const blank={...f.mask,alpha:new Uint8Array(64*64)};
  assert.equal(torsoMaskCoverage(blank,f.landmarks),0);
  assert.equal(packPersonDepth(blank,f.landmarks,f.result,f.pose),null);
  const away={...f.mask,alpha:new Uint8Array(64*64)};for(let y=0;y<64;y++)for(let x=0;x<8;x++)away.alpha[y*64+x]=255;
  assert.ok(torsoMaskCoverage(away,f.landmarks)<MIN_TORSO_MASK_COVERAGE);
  const skeleton=skeletonMask(f.landmarks,64,64);assert.ok(skeleton);
  assert.ok(torsoMaskCoverage(skeleton,f.landmarks)>=.9);
  const px=(x,y)=>skeleton.alpha[y*64+x]>0;
  assert.ok(px(32,30)&&px(26,50)&&px(38,50));   // torso and both legs
  assert.ok(!px(2,30)&&!px(62,30)&&!px(32,0));  // background stays empty
  const depth=packPersonDepth(skeleton,f.landmarks,f.result,f.pose);assert.ok(depth&&depth.pixels>300);
  assert.equal(depth.data[(30*64+32)*4+3],255);
  assert.equal(skeletonMask(f.landmarks.map((l,i)=>i===23?{...l,visibility:.1}:l),64,64),null);
  assert.equal(torsoMaskCoverage(f.mask,[]),null);
  const weak=f.landmarks.map((l,i)=>i===24?{...l,visibility:.2}:l);
  assert.match(personDepthDiagnosis(f.mask,weak,f.result,f.pose),/오른골반 0\.20/);
  assert.equal(personDepthDiagnosis(blank,f.landmarks,f.result,f.pose),'윤곽 전경 0픽셀');
  assert.equal(personDepthDiagnosis(null,f.landmarks,f.result,f.pose),'윤곽 없음');
});
