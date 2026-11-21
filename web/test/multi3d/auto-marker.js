import {orientMarkerCorners} from './aruco.js?v=20261109-6';

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

// Detect only the supplied ArUco ID0 floor marker; a plain black rectangle is insufficient.
export function detectMarker(image,width,height){
  if(width<24||height<24||image.length!==width*height*4)return null;
  const n=width*height,gray=new Uint8Array(n);for(let i=0;i<n;i++)gray[i]=Math.round(.299*image[4*i]+.587*image[4*i+1]+.114*image[4*i+2]);
  const split=threshold(gray);if(split===null)return null;
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
    const decoded=orientMarkerCorners(sample,corners,0);if(!decoded)continue;
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

export class StableMarker {
  constructor(){this.reset();}
  reset(){this.samples=[];this.started=null;}
  add(corners,at){
    if(!corners){this.reset();return null;}
    const prev=this.samples.at(-1),first=this.samples[0],size=Math.hypot(corners[0][0]-corners[2][0],corners[0][1]-corners[2][1]);
    if(prev&&(at-prev.at>350||corners.some((p,i)=>Math.hypot(p[0]-first.corners[i][0],p[1]-first.corners[i][1])>Math.max(2,size*.015))))this.reset();
    if(this.started===null)this.started=at;
    this.samples.push({corners,at});if(this.samples.length>8)this.samples.shift();
    if(this.samples.length<6||at-this.started<900)return null;
    return [0,1,2,3].map(i=>[0,1].map(k=>{const a=this.samples.map(s=>s.corners[i][k]).sort((a,b)=>a-b);return a[Math.floor(a.length/2)];}));
  }
}

export function createMarkerScanner(video,onFound,onStatus){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),stable=new StableMarker();
  let timer=null,lastVideoTime=-1;
  return {
    start(){this.stop();stable.reset();onStatus('흑백 ID0 마커를 찾는 중… 폰을 고정하세요');
      timer=setInterval(()=>{
        if(video.readyState<2||!video.videoWidth||video.currentTime===lastVideoTime)return;lastVideoTime=video.currentTime;
        const W=video.videoWidth,H=video.videoHeight,k=Math.min(1,720/Math.max(W,H));canvas.width=Math.round(W*k);canvas.height=Math.round(H*k);
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const corners=detectMarker(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
        const accepted=stable.add(corners,performance.now());
        onStatus(corners?'마커 확인 · 폰과 마커를 약 1초간 움직이지 마세요':'ID0 마커 전체가 보이게 하세요 · 반사/가림/잘림을 확인하세요');
        if(accepted){this.stop();const frozen=document.createElement('canvas');frozen.width=W;frozen.height=H;frozen.getContext('2d').drawImage(video,0,0);
          onFound(frozen,accepted.map(p=>[p[0]*W/canvas.width,p[1]*H/canvas.height]));}
      },180);
    },
    stop(){clearInterval(timer);timer=null;lastVideoTime=-1;stable.reset();},
  };
}
