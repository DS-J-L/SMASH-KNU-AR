import {orientMarkerCorners} from './aruco.js?v=20261116-w1';

const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function hull(points){
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const a=[],b=[];
  for(const p of points){while(a.length>1&&cross(a.at(-2),a.at(-1),p)<=0)a.pop();a.push(p);}
  for(let i=points.length-1;i>=0;i--){const p=points[i];while(b.length>1&&cross(b.at(-2),b.at(-1),p)<=0)b.pop();b.push(p);}
  return a.slice(0,-1).concat(b.slice(0,-1));
}
const area=pts=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
function quad(points){
  const poly=hull(points),original=area(poly);if(poly.length<4)return null;
  while(poly.length>4){let index=0,best=Infinity;for(let i=0;i<poly.length;i++){const cost=Math.abs(cross(poly[(i+poly.length-1)%poly.length],poly[i],poly[(i+1)%poly.length]));if(cost<best){best=cost;index=i;}}poly.splice(index,1);}
  return original>200&&area(poly)/original>.94?poly:null;
}
function threshold(gray){
  const hist=new Uint32Array(256);let sum=0;for(const v of gray){hist[v]++;sum+=v;}
  let count=0,partial=0,score=-1,split=0,contrast=0;
  for(let t=0;t<255;t++){count+=hist[t];partial+=t*hist[t];if(!count||count===gray.length)continue;
    const difference=(sum-partial)/(gray.length-count)-partial/count,value=count*(gray.length-count)*difference*difference;
    if(value>score){score=value;split=t;contrast=difference;}}
  return contrast>=50?split:null;
}

// Detect only the supplied ArUco floor marker (ID0 unless the wide stage asks for ID1/ID2); a plain black
// rectangle or another id is insufficient.
export function detectMarker(image,width,height,markerId=0){
  if(width<24||height<24||image.length!==width*height*4)return null;
  return detectMarkerGray(toGray(image,width,height),width,height,markerId);
}
function toGray(image,width,height,x0=0,y0=0,w=width,h=height){
  const gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=4*((y+y0)*width+x+x0);gray[y*w+x]=Math.round(.299*image[i]+.587*image[i+1]+.114*image[i+2]);}
  return gray;
}
function detectMarkerGray(gray,width,height,markerId){
  if(width<24||height<24)return null;
  const n=width*height,split=threshold(gray);if(split===null)return null;
  const seen=new Uint8Array(n),queue=new Int32Array(n),candidates=[];
  const sample=(x,y)=>{x=Math.round(x);y=Math.round(y);return x<0||y<0||x>=width||y>=height?NaN:gray[y*width+x];};
  for(let seed=0;seed<n;seed++){
    if(seen[seed]||gray[seed]>split)continue;
    let head=0,tail=1,touches=false,minX=width,maxX=0,minY=height,maxY=0;queue[0]=seed;seen[seed]=1;const boundary=[];
    while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(x===0||y===0||x===width-1||y===height-1)touches=true;
      let edge=false;for(const next of [x?at-1:-1,x<width-1?at+1:-1,y?at-width:-1,y<height-1?at+width:-1]){
        if(next<0||gray[next]>split){edge=true;continue;}if(!seen[next]){seen[next]=1;queue[tail++]=next;}}
      if(edge)boundary.push([x,y]);
    }
    if(touches||tail<80||maxX-minX<20||maxY-minY<20||tail>n*.65)continue;
    const corners=quad(boundary);if(!corners)continue;
    // Side lengths and convexity reject skinny line/letter components before decoding.
    if(corners.some((p,i)=>Math.hypot(p[0]-corners[(i+1)%4][0],p[1]-corners[(i+1)%4][1])<16))continue;
    const decoded=orientMarkerCorners(sample,corners,0,markerId);if(!decoded)continue;
    // The outer black border must also match, not merely the sixteen inner bits.
    const c=decoded.corners;
    let border=true;for(let i=0;i<4;i++)for(const t of [.15,.35,.5,.65,.85]){
      const a=c[i],b=c[(i+1)%4],center=[0,1].map(k=>c.reduce((s,p)=>s+p[k],0)/4);
      const p=[0,1].map(k=>(a[k]*(1-t)+b[k]*t)*.92+center[k]*.08);
      if(sample(...p)>split)border=false;
    }
    if(border)candidates.push(c);
  }
  return candidates.length===1?candidates[0]:null;
}

// ----- sub-pixel corners -----
// detectMarker's corners are whole pixels from the blob outline (about 0.5-1 px off each). refineMarker re-detects
// in a crop around the marker (brightness split from the marker and its paper only), then finds each black edge to a
// fraction of a pixel along many short cross-sections, fits a straight line per side and intersects neighbouring
// sides. Corner order (the pattern's orientation) is kept. Falls back to the input when an edge is unclear.
function bilinear(gray,w,h,x,y){
  if(!(x>=0&&y>=0&&x<=w-1&&y<=h-1))return NaN;
  const x0=Math.min(Math.floor(x),w-2),y0=Math.min(Math.floor(y),h-2),fx=x-x0,fy=y-y0,i=y0*w+x0;
  return (gray[i]*(1-fx)+gray[i+1]*fx)*(1-fy)+(gray[i+w]*(1-fx)+gray[i+w+1]*fx)*fy;
}
function fitLine(points){
  const m=[0,1].map(k=>points.reduce((s,p)=>s+p[k],0)/points.length);
  let xx=0,xy=0,yy=0;for(const [x,y] of points){const a=x-m[0],b=y-m[1];xx+=a*a;xy+=a*b;yy+=b*b;}
  const th=.5*Math.atan2(2*xy,xx-yy);return {m,d:[Math.cos(th),Math.sin(th)]};
}
// One side a→b: the edge between the black border (inside) and the paper (outside).
function edgeLine(gray,w,h,a,b,center,reach){
  const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<12)return null;
  const d=[(b[0]-a[0])/L,(b[1]-a[1])/L];let n=[-d[1],d[0]];
  if(n[0]*((a[0]+b[0])/2-center[0])+n[1]*((a[1]+b[1])/2-center[1])<0)n=[-n[0],-n[1]];
  // reach (in cells): the final pass stays inside the 1-cell black border and the A3 sheet's side margin (~0.3 cell).
  const r=Math.max(reach>.3?2.5:1.5,Math.min(reach>.3?14:10,L/6*reach)),step=.25,count=Math.max(8,Math.min(80,Math.round(L/2))),points=[];
  for(let k=0;k<count;k++){
    const t=.12+.76*k/(count-1),p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],v=[];
    for(let s=-r;s<=r+1e-9;s+=step)v.push(bilinear(gray,w,h,p[0]+s*n[0],p[1]+s*n[1]));
    if(v.some(x=>!Number.isFinite(x)))continue;
    const q=Math.max(1,Math.round(v.length*.2)),inner=v.slice(0,q).reduce((s,x)=>s+x,0)/q,outer=v.slice(-q).reduce((s,x)=>s+x,0)/q;
    if(outer-inner<20)continue;
    const mid=(inner+outer)/2;let best=null;
    for(let j=0;j+1<v.length;j++)if(v[j]<mid&&v[j+1]>=mid){const s=-r+step*(j+(mid-v[j])/(v[j+1]-v[j]));if(best===null||Math.abs(s)<Math.abs(best))best=s;}
    if(best!==null)points.push([p[0]+best*n[0],p[1]+best*n[1]]);
  }
  if(points.length<6)return null;
  const line=fitLine(points);
  const dist=p=>Math.abs((p[0]-line.m[0])*line.d[1]-(p[1]-line.m[1])*line.d[0]);
  const rms=Math.sqrt(points.reduce((s,p)=>s+dist(p)**2,0)/points.length),kept=points.filter(p=>dist(p)<=Math.max(.3,2.5*rms));
  return kept.length<6?null:fitLine(kept);
}
// Two passes: a wide one pulls whole-pixel corners (blurred edges shift them 1-3 px) close, a tight one finishes.
function refineEdges(gray,w,h,corners){
  const first=refinePass(gray,w,h,corners,corners,.45);
  return first&&refinePass(gray,w,h,first,corners,.28);
}
function refinePass(gray,w,h,corners,start,reach){
  const center=[0,1].map(k=>corners.reduce((s,p)=>s+p[k],0)/4);
  const lines=corners.map((a,i)=>edgeLine(gray,w,h,a,corners[(i+1)%4],center,reach));
  if(lines.some(l=>!l))return null;
  const out=[];
  for(let i=0;i<4;i++){
    const A=lines[(i+3)%4],B=lines[i],det=A.d[0]*B.d[1]-A.d[1]*B.d[0];if(Math.abs(det)<1e-6)return null;
    const t=((B.m[0]-A.m[0])*B.d[1]-(B.m[1]-A.m[1])*B.d[0])/det,p=[A.m[0]+t*A.d[0],A.m[1]+t*A.d[1]];
    const side=Math.hypot(start[i][0]-start[(i+1)%4][0],start[i][1]-start[(i+1)%4][1]);
    if(Math.hypot(p[0]-start[i][0],p[1]-start[i][1])>Math.max(3,side*.08))return null;
    out.push(p);
  }
  return out;
}
// image: RGBA of a frame (or of a full-resolution crop) and corners in its pixels, as detectMarker returns them.
export function refineMarker(image,width,height,corners,markerId=0){
  if(!corners||image.length!==width*height*4)return corners;
  const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
  const size=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)),m=Math.max(8,size*.35);
  const x0=Math.max(0,Math.floor(Math.min(...xs)-m)),y0=Math.max(0,Math.floor(Math.min(...ys)-m));
  const w=Math.min(width,Math.ceil(Math.max(...xs)+m))-x0,h=Math.min(height,Math.ceil(Math.max(...ys)+m))-y0;
  if(w<24||h<24)return corners;
  // Samples sit at pixel centres (index i = coordinate i+0.5, as the projection and canvas use).
  const gray=toGray(image,width,height,x0,y0,w,h),local=corners.map(([x,y])=>[x-x0-.5,y-y0-.5]);
  const again=detectMarkerGray(gray,w,h,markerId);
  const rough=again&&again.every((p,i)=>Math.hypot(p[0]-local[i][0],p[1]-local[i][1])<Math.max(3,size*.06))?again:local;
  const fine=refineEdges(gray,w,h,rough);
  return fine?fine.map(([x,y])=>[x+x0+.5,y+y0+.5]):corners;
}

// maxGapMs: a slower scanner (the duo view phone reads full-resolution frames) may allow longer gaps.
export class StableMarker {
  constructor(maxGapMs=350){this.maxGapMs=maxGapMs;this.reset();}
  reset(){this.samples=[];this.started=null;}
  add(corners,at){
    if(!corners){this.reset();return null;}
    const prev=this.samples.at(-1),first=this.samples[0],size=Math.hypot(corners[0][0]-corners[2][0],corners[0][1]-corners[2][1]);
    if(prev&&(at-prev.at>this.maxGapMs||corners.some((p,i)=>Math.hypot(p[0]-first.corners[i][0],p[1]-first.corners[i][1])>Math.max(2,size*.015))))this.reset();
    if(this.started===null)this.started=at;
    this.samples.push({corners,at});if(this.samples.length>8)this.samples.shift();
    if(this.samples.length<6||at-this.started<900)return null;
    return [0,1,2,3].map(i=>[0,1].map(k=>{const a=this.samples.map(s=>s.corners[i][k]).sort((a,b)=>a-b);return a[Math.floor(a.length/2)];}));
  }
}

// Scans until the marker is found AND onFound accepts it: onFound returning a string means the corners were found
// but calibration failed (the string says why); scanning then continues by itself until it succeeds or stop().
// The search runs on a 720 px copy; corners found there are refined on a full-resolution crop around the marker.
// button (optional) is hidden while the search runs and shown again when it stops.
export function createMarkerScanner(video,onFound,onStatus,markerId=0,{button=null}={}){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),stable=new StableMarker();
  const crop=document.createElement('canvas'),cropCtx=crop.getContext('2d',{willReadFrequently:true});
  const fullRes=(rough,W,H)=>{
    const k=W/canvas.width,p=rough.map(q=>[q[0]*k,q[1]*H/canvas.height]),xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);
    const m=Math.max(12,.4*Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)))+2*k;
    const x0=Math.max(0,Math.floor(Math.min(...xs)-m)),y0=Math.max(0,Math.floor(Math.min(...ys)-m));
    const w=Math.min(W,Math.ceil(Math.max(...xs)+m))-x0,h=Math.min(H,Math.ceil(Math.max(...ys)+m))-y0;
    if(w<24||h<24)return p;
    crop.width=w;crop.height=h;cropCtx.drawImage(video,x0,y0,w,h,0,0,w,h);
    return refineMarker(cropCtx.getImageData(0,0,w,h).data,w,h,p.map(([x,y])=>[x-x0,y-y0]),markerId).map(([x,y])=>[x+x0,y+y0]);
  };
  let timer=null,lastVideoTime=-1,retries=0,lastFailure='';
  const retryText=()=>retries?` · 보정 실패 ${retries}회, 계속 찾는 중${lastFailure?` (${lastFailure})`:''}`:'';
  return {
    get retries(){return retries;},
    start(){this.stop();if(button)button.hidden=true;stable.reset();retries=0;lastFailure='';onStatus(`흑백 ID${markerId} 마커를 찾는 중… 폰을 고정하세요`);
      timer=setInterval(()=>{
        if(video.readyState<2||!video.videoWidth||video.currentTime===lastVideoTime)return;lastVideoTime=video.currentTime;
        const W=video.videoWidth,H=video.videoHeight,k=Math.min(1,720/Math.max(W,H));canvas.width=Math.round(W*k);canvas.height=Math.round(H*k);
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const rough=detectMarker(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,markerId);
        const corners=rough&&fullRes(rough,W,H);
        const accepted=stable.add(corners,performance.now());
        onStatus((corners?'마커 확인 · 폰과 마커를 약 1초간 움직이지 마세요':`ID${markerId} 마커 전체가 보이게 하세요 · 반사/가림/잘림을 확인하세요`)+retryText());
        if(accepted){const frozen=document.createElement('canvas');frozen.width=W;frozen.height=H;frozen.getContext('2d').drawImage(video,0,0);
          const result=onFound(frozen,accepted);
          if(typeof result==='string'&&timer){retries++;lastFailure=result;stable.reset();onStatus(`모서리를 찾았지만 보정 품질이 부족합니다${retryText()} · 거리/각도/높이를 조절하세요`);}
          else this.stop();}
      },180);
    },
    get running(){return timer!==null;},
    stop(){clearInterval(timer);timer=null;lastVideoTime=-1;stable.reset();if(button)button.hidden=false;},
  };
}
