// Duo stage view phone: the real person's outline in V's own video, with an approximate camera-space depth, so the
// PC shows the actual person in front of the buildings and hides the building parts behind them
// (docs/DUO_STAGE_TEST.md). Pure functions (no DOM) so Node tests run the same code as the phone.
//
// Outline: V's own segmentation (or a skeleton-shaped fallback) — always aligned with V's image.
// Depth, in order of preference:
//   judge  — the judging phone's stage-frame joints (relayed by the server), placed at V's own 2D landmarks.
//            Left/right are matched by reprojection because V sees the person from the other side.
//   floor  — V's own ankles on the floor: one vertical plane through the feet, facing V. Coarse (no body depth).
import {add,sub,dot,normalize,pixelRay,intersectZ,intersectPlane,project} from '../mono3d/geometry.js?v=20261117-d1';
import {packPersonDepth} from '../mono3d/person-depth.js?v=20261118-v1';

export const JUDGE_MAX_AGE_MS=250;
export const VIEW_MASK_MAX=[384,384];
// Judge joints are used only if their mean miss in V is within half V's torso length (at least 12 px).
export const JUDGE_FIT_TORSO_RATIO=.5,JUDGE_FIT_MIN_PX=12;
const IDS={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,
  left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
const TORSO=['left_shoulder','right_shoulder','left_hip','right_hip'];
const FLOOR_ANKLE_M=.08;
const swapName=n=>n.startsWith('left_')?'right_'+n.slice(5):n.startsWith('right_')?'left_'+n.slice(6):n;
const finite3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const seen=(l,min=.5)=>l&&(l.visibility??1)>=min&&Number.isFinite(l.x)&&Number.isFinite(l.y);

// Mean pixel distance between the judge joints projected into V and V's landmarks, with or without left/right swapped.
export function judgeFit(K,pose,landmarks,joints,swapped){
  let total=0,count=0;
  for(const [name,id] of Object.entries(IDS)){
    const p=joints?.[swapped?swapName(name):name],l=landmarks?.[id];
    if(!finite3(p)||!seen(l))continue;
    const px=project(K,pose,p);if(!px)continue;
    total+=Math.hypot(px[0]-l.x*K.width,px[1]-l.y*K.height);count++;
  }
  return count?total/count:null;
}

// V's own shoulder-centre to hip-centre length in pixels: the scale for how far the judge joints may miss.
export function torsoLengthPx(K,landmarks){
  const l=TORSO.map(n=>landmarks?.[IDS[n]]);
  if(!l.every(p=>seen(p)))return null;
  const mid=(a,b)=>[(a.x+b.x)/2*K.width,(a.y+b.y)/2*K.height],s=mid(l[0],l[1]),h=mid(l[2],l[3]);
  return Math.hypot(s[0]-h[0],s[1]-h[1]);
}

function judgeJoints(K,pose,landmarks,judge){
  const joints=judge?.joints;
  if(!joints||!TORSO.every(n=>finite3(joints[n])))return null;
  const direct=judgeFit(K,pose,landmarks,joints,false),crossed=judgeFit(K,pose,landmarks,joints,true);
  if(direct===null&&crossed===null)return {rejected:'judge_no_overlap'};
  const swapped=crossed!==null&&(direct===null||crossed<direct),fit=swapped?crossed:direct;
  // A judge estimate far from V's own person (bad mono depth, another person, a moved marker) must not set the depth.
  const torso=torsoLengthPx(K,landmarks),limit=Math.max(JUDGE_FIT_MIN_PX,JUDGE_FIT_TORSO_RATIO*(torso??0));
  if(!(fit<=limit))return {rejected:'judge_fit_too_large',fit_px:fit,limit_px:limit};
  const out={};
  for(const name of Object.keys(IDS)){const p=joints[swapped?swapName(name):name];if(finite3(p))out[name]={position_m:p};}
  return {joints:out,swapped,fit_px:fit,limit_px:limit};
}

// Every visible landmark on one vertical plane through the feet, facing V.
export function floorJoints(K,pose,landmarks){
  const feet=[27,28].map(id=>landmarks?.[id]).filter(l=>seen(l)).map(l=>intersectZ(pixelRay(K,pose,l.x*K.width,l.y*K.height),FLOOR_ANKLE_M)).filter(Boolean);
  if(!feet.length)return null;
  const foot=feet.length===2?add(feet[0],sub(feet[1],feet[0]).map(v=>v/2)):feet[0];
  const toCamera=sub(pose.C,foot),n=normalize([toCamera[0],toCamera[1],0]);
  if(!n.every(Number.isFinite))return null;
  const out={};
  for(const [name,id] of Object.entries(IDS)){
    const l=landmarks[id];if(!seen(l))continue;
    const p=intersectPlane(pixelRay(K,pose,l.x*K.width,l.y*K.height),foot,n);
    if(p&&dot(sub(p,pose.C),sub(foot,pose.C))>0)out[name]={position_m:p};
  }
  return {joints:out,foot};
}

// mask: {width,height,alpha} at V's image aspect; K/pose: V's stage-frame calibration; judge: {joints, ageMs}.
export function viewPersonDepth(mask,landmarks,K,pose,judge){
  if(!mask||!landmarks||!K||!pose)return {depth:null,source:null,reason:!landmarks?'사람 미검출':'윤곽 없음'};
  let rejected=null;
  if(judge&&judge.ageMs>=0&&judge.ageMs<=JUDGE_MAX_AGE_MS){
    const j=judgeJoints(K,pose,landmarks,judge);
    if(j?.rejected)rejected=j;
    else if(j){const depth=packPersonDepth(mask,landmarks,{valid:true,joints:j.joints},pose);
      if(depth)return {depth,source:'judge',swapped:j.swapped,fit_px:j.fit_px,limit_px:j.limit_px};}
  }
  const why=rejected?.rejected==='judge_fit_too_large'?`판정 관절 어긋남 ${rejected.fit_px.toFixed(0)}px > ${rejected.limit_px.toFixed(0)}px`:rejected?'판정 관절이 화면 폰 관절과 겹치지 않음':null;
  const f=floorJoints(K,pose,landmarks);
  if(f){const depth=packPersonDepth(mask,landmarks,{valid:true,joints:f.joints},pose);if(depth)return {depth,source:'floor',foot:f.foot,judge_rejected:why};}
  return {depth:null,source:null,judge_rejected:why,reason:(why?why+' · ':'')+(f?'몸통 관절 부족':'판정 폰 관절 없음 · 발목 미검출')};
}
