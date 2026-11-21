import {test} from 'node:test';
import assert from 'node:assert/strict';
import {project,intrinsicsFromFov,sub,cross,normalize,matVec,add} from '../web/test/mono3d/geometry.js';
import {viewPersonDepth,judgeFit,JUDGE_MAX_AGE_MS} from '../web/test/stage-view/view-person.js';

// Duo stage view phone V on the far side (+Y), 1.6 m high, looking back at the markers; the person stands at
// stage x 0.8 m (marker ID1 section), y 0.3 m, facing the judging phones (-Y): V sees their back.
function lookAt(C,target){
  const f=normalize(sub(target,C)),x=normalize(cross(f,[0,0,1])),y=cross(f,x);
  const R=[...x,...y,...f];return {R,t:[0,1,2].map(r=>-(R[3*r]*C[0]+R[3*r+1]*C[1]+R[3*r+2]*C[2])),C};
}
const W=960,H=540,K=intrinsicsFromFov(W,H,75),pose=lookAt([0,3.3,1.6],[0,0,.5]);
const X=.8,Y=.3;
// Facing -Y, the person's left is +X.
const PERSON={nose:[X,Y-.08,1.62],left_shoulder:[X+.19,Y,1.42],right_shoulder:[X-.19,Y,1.42],left_elbow:[X+.25,Y,1.15],right_elbow:[X-.25,Y,1.15],
  left_wrist:[X+.28,Y-.05,.9],right_wrist:[X-.28,Y-.05,.9],left_hip:[X+.11,Y,.92],right_hip:[X-.11,Y,.92],
  left_knee:[X+.11,Y,.5],right_knee:[X-.11,Y,.5],left_ankle:[X+.11,Y,.08],right_ankle:[X-.11,Y,.08]};
const IDS={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,
  left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
const swap=n=>n.startsWith('left_')?'right_'+n.slice(5):n.startsWith('right_')?'left_'+n.slice(6):n;
// MediaPipe labels a back view as if the person faced the camera: left and right come out crossed.
function landmarks({crossed=true}={}){
  const out=Array.from({length:33},()=>null);
  for(const [name,id] of Object.entries(IDS)){const p=project(K,pose,PERSON[crossed?swap(name):name]);out[id]={x:p[0]/W,y:p[1]/H,visibility:.95};}
  return out;
}
// Whole-person box mask at 384 x 216.
function mask(lm){
  const w=384,h=216,alpha=new Uint8Array(w*h),xs=lm.filter(Boolean).map(l=>l.x*w),ys=lm.filter(Boolean).map(l=>l.y*h);
  for(let y=Math.floor(Math.min(...ys))-3;y<=Math.ceil(Math.max(...ys))+3;y++)for(let x=Math.floor(Math.min(...xs))-6;x<=Math.ceil(Math.max(...xs))+6;x++)alpha[y*w+x]=255;
  return {width:w,height:h,alpha};
}
const camZ=p=>add(matVec(pose.R,p),pose.t)[2];
const depthAt=(depth,l)=>{const i=Math.floor(l.y*depth.height)*depth.width+Math.floor(l.x*depth.width);
  return depth.data[i*4+3]?(depth.data[i*4]*256+depth.data[i*4+1])/1000:null;};

test('judging joints give the real outline its depth; left/right are matched to the back view',()=>{
  const lm=landmarks(),r=viewPersonDepth(mask(lm),lm,K,pose,{joints:PERSON,ageMs:80});
  assert.equal(r.source,'judge');assert.equal(r.swapped,true);assert.ok(r.fit_px<1,`fit ${r.fit_px}`);
  assert.ok(r.depth.pixels>500);
  // Depth at a joint is that joint's camera depth minus the 6 cm surface offset, within the 1 mm encoding.
  for(const name of ['left_shoulder','right_hip','nose']){
    const z=depthAt(r.depth,lm[IDS[name]]),truth=camZ(PERSON[swap(name)])-.06;
    assert.ok(Math.abs(z-truth)<.02,`${name} ${z} vs ${truth}`);
  }
  const straight=landmarks({crossed:false}),s=viewPersonDepth(mask(straight),straight,K,pose,{joints:PERSON,ageMs:80});
  assert.equal(s.source,'judge');assert.equal(s.swapped,false);
  assert.ok(judgeFit(K,pose,lm,PERSON,false)>20,'crossed labels must not fit without the swap');
});

test('without fresh judging joints the outline uses V\'s own feet on the floor',()=>{
  const lm=landmarks();
  for(const judge of [null,{joints:PERSON,ageMs:JUDGE_MAX_AGE_MS+50},{joints:{left_hip:PERSON.left_hip},ageMs:10}]){
    const r=viewPersonDepth(mask(lm),lm,K,pose,judge);
    assert.equal(r.source,'floor');
    assert.ok(Math.abs(r.foot[0]-X)<.03&&Math.abs(r.foot[1]-Y)<.03,`foot ${r.foot}`);
    // The person here is a flat plane at y = 0.3, so the floor plane is nearly exact.
    const z=depthAt(r.depth,lm[IDS.left_hip]),truth=camZ(PERSON.right_hip)-.06;
    assert.ok(Math.abs(z-truth)<.05,`hip ${z} vs ${truth}`);
  }
});

test('no ankles and no judging joints: no depth, with a reason',()=>{
  const lm=landmarks();lm[27]=lm[28]=null;
  const r=viewPersonDepth(mask(lm),lm,K,pose,null);
  assert.equal(r.depth,null);assert.match(r.reason,/발목/);
  assert.equal(viewPersonDepth(null,lm,K,pose,null).depth,null);
  assert.equal(viewPersonDepth(mask(lm),null,K,pose,null).reason,'사람 미검출');
});

test('judging joints far from V\'s own person are rejected: the floor depth is used, with the reason',()=>{
  const lm=landmarks(),shift=(dx)=>Object.fromEntries(Object.entries(PERSON).map(([n,p])=>[n,[p[0]+dx,p[1],p[2]]]));
  // 5 cm sideways (a normal mono error) still fits; 60 cm (another section, a wrong marker) does not.
  const near=viewPersonDepth(mask(lm),lm,K,pose,{joints:shift(.05),ageMs:30});
  assert.equal(near.source,'judge');assert.ok(near.fit_px<=near.limit_px,`${near.fit_px} > ${near.limit_px}`);
  const far=viewPersonDepth(mask(lm),lm,K,pose,{joints:shift(.6),ageMs:30});
  assert.equal(far.source,'floor');assert.match(far.judge_rejected,/어긋남 \d+px > \d+px/);
  const lost=(()=>{const l=landmarks();l[27]=l[28]=null;return viewPersonDepth(mask(l),l,K,pose,{joints:shift(.6),ageMs:30});})();
  assert.equal(lost.depth,null);assert.match(lost.reason,/어긋남/);
});
