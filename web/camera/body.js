// Preserve the 22-point body contract; transmit only one representative head position.
export const BODY_NAMES = [
  'left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist',
  'left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb',
  'left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle',
  'left_heel','right_heel','left_foot_index','right_foot_index',
];
const EDGES = [[0,1],[0,2],[2,4],[4,6],[4,8],[4,10],[6,8],
  [1,3],[3,5],[5,7],[5,9],[5,11],[7,9],[0,12],[1,13],[12,13],
  [12,14],[14,16],[16,18],[18,20],[16,20],[13,15],[15,17],[17,19],[19,21],[17,21]];

export function extractBody(result,width,height) {
  return extractPoints(result,width,height,BODY_NAMES,11);
}
export function extractHead(result,width,height) {
  const point=i=>extractPoints(result,width,height,['point'],i).point;
  for(const [a,b] of [[7,8],[2,5]]) {
    const p=point(a),q=point(b);
    if(p?.visibility>=0.5 && q?.visibility>=0.5) return {
      u_px:Math.round((p.u_px+q.u_px)*50)/100,
      v_px:Math.round((p.v_px+q.v_px)*50)/100,
      visibility:Math.min(p.visibility,q.visibility),
    };
  }
  const nose=point(0);return nose?.visibility>=0.5 ? nose : null;
}
function extractPoints(result,width,height,names,offset) {
  const landmarks=result?.landmarks?.[0];
  return Object.fromEntries(names.map((name,index)=>{
    const p=landmarks?.[index+offset],u=p?.x*width,v=p?.y*height;
    if(!p || !Number.isFinite(u) || !Number.isFinite(v) || u<0 || u>width || v<0 || v>height
      || !Number.isFinite(p.visibility))return [name,null];
    return [name,{u_px:Math.round(u*100)/100,v_px:Math.round(v*100)/100,
      visibility:Math.round(Math.min(1,Math.max(0,p.visibility))*1000)/1000}];
  }));
}

export function drawBody(canvas,body,width,height,head) {
  const ctx=canvas.getContext('2d'),sx=canvas.width/width,sy=canvas.height/height;
  const visible=name=>body?.[name] && body[name].visibility>=0.5;
  ctx.lineWidth=Math.max(2,canvas.width/250);
  for(const [a,b] of EDGES){
    const na=BODY_NAMES[a],nb=BODY_NAMES[b];if(!visible(na)||!visible(nb))continue;
    const p=body[na],q=body[nb];ctx.strokeStyle='#a8e5b2';ctx.beginPath();
    ctx.moveTo(p.u_px*sx,p.v_px*sy);ctx.lineTo(q.u_px*sx,q.v_px*sy);ctx.stroke();
  }
  for(const name of BODY_NAMES){
    if(!visible(name))continue;const p=body[name];ctx.fillStyle=name.startsWith('left_')?'#7fd6ff':'#ffb36b';
    ctx.beginPath();ctx.arc(p.u_px*sx,p.v_px*sy,Math.max(4,canvas.width/100),0,Math.PI*2);ctx.fill();
  }
  if(head && head.visibility>=0.5){
    ctx.fillStyle='#ffe08a';ctx.beginPath();
    ctx.arc(head.u_px*sx,head.v_px*sy,Math.max(6,canvas.width/80),0,Math.PI*2);ctx.fill();
  }
}
