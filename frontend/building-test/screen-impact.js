// Contact-centred explosion. No title card; live video remains visible around the blast.
export const IMPACT_DURATION_MS=2100;
function randomFor(id='preview'){
  let seed=[...id].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,2166136261);
  return ()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createScreenImpact(canvas,{now=()=>performance.now(),reduced=()=>false}={}){
  const ctx=canvas.getContext('2d');let active=null,firstDraw=null,played=0,disposed=false;
  function cancel(){active=null;canvas.hidden=true;ctx.clearRect(0,0,canvas.width,canvas.height);}
  function start({event={},originPx,t0=now(),preview=false}){
    if(disposed)return;
    const w=globalThis.innerWidth||1440,h=globalThis.innerHeight||1000;
    const point=Array.isArray(originPx)&&originPx.length===2&&originPx.every(Number.isFinite)?originPx:[w/2,h/2];
    const random=randomFor(event.event_id),particles=Array.from({length:48},(_,i)=>({
      angle:random()*Math.PI*2,speed:100+random()*650,size:2+random()*9,spin:random()*12-6,
      delay:i<32?0:.1+random()*.3,stretch:.6+random()*.8,
    }));
    const clouds=Array.from({length:16},()=>({angle:random()*Math.PI*2,spread:random(),size:.6+random()*.8}));
    active={t0,preview,reduced:reduced(),uv:[clamp(point[0]/w,0,1),clamp(point[1]/h,0,1)],particles,clouds};
    firstDraw=null;played++;canvas.hidden=false;
  }
  function glow(x,y,r,colors,alpha=1){
    if(r<=0||alpha<=0)return;
    const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
    colors.forEach(([stop,color])=>gradient.addColorStop(stop,color));
    ctx.globalAlpha=alpha;ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  }
  function draw(at=now()){
    if(!active)return false;
    const ms=at-active.t0;
    if(ms>IMPACT_DURATION_MS||(firstDraw===null&&ms>100)){cancel();return false;}
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.5,1920/Math.max(w,h));
    const W=Math.max(1,Math.round(w*dpr)),H=Math.max(1,Math.round(h*dpr));
    if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const p=[active.uv[0]*w,active.uv[1]*h],t=Math.max(0,ms)/1000,scale=Math.min(w,h)/800;
    if(active.reduced){
      // A quiet, local amber glow; no full-screen flashes, flying shards or shake.
      glow(...p,90*scale,[[0,'rgba(255,215,125,.8)'],[.4,'rgba(255,135,40,.45)'],[1,'rgba(255,90,10,0)']],Math.max(0,1-t/2.1));
      firstDraw??=at;return true;
    }
    // Rolling smoke rises from the same point instead of covering the video immediately.
    if(t>.12)for(const c of active.clouds){
      const age=t-.12,cx=p[0]+Math.cos(c.angle)*(35+age*155)*c.spread*scale;
      const cy=p[1]+Math.sin(c.angle)*age*85*scale-age*110*scale;
      const radius=(18+age*80)*c.size*scale,alpha=Math.min(.62,age*2)*Math.max(0,1-(t-.8)/1.3);
      glow(cx,cy,radius,[[0,'rgba(43,34,29,.78)'],[.6,'rgba(98,77,57,.6)'],[1,'rgba(117,96,71,0)']],alpha);
    }
    // Irregular tongues of flame grow only around the impact, then die into smoke.
    if(t<.7){
      const bloom=1-Math.exp(-t*13),fade=Math.max(0,1-t/.7);
      for(let i=0;i<12;i++){
        const c=active.clouds[i],distance=(10+bloom*105)*c.spread*scale;
        glow(p[0]+Math.cos(c.angle)*distance,p[1]+Math.sin(c.angle)*distance-t*40*scale,
          (5+bloom*105)*c.size*scale,
          [[0,'#fffbd7'],[.2,'#ffeb8d'],[.44,'#ffad27'],[.67,'rgba(255,68,8,.8)'],[1,'rgba(124,22,0,0)']],fade);
      }
      // White-hot contact core is immediately readable even on the first frame.
      glow(...p,(8+bloom*63)*scale,[[0,'#ffffff'],[.3,'#fff5b7'],[.65,'rgba(255,163,20,.7)'],[1,'rgba(255,97,0,0)']],Math.max(0,1-t/.42));
    }
    if(t>.025&&t<.95){
      const radius=(t-.025)*Math.hypot(w,h)*.85;
      ctx.save();ctx.translate(...p);ctx.scale(1,.55);ctx.strokeStyle=`rgba(255,215,135,${Math.max(0,.8-t)})`;
      ctx.lineWidth=Math.max(1,9*(1-t));ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    // Sparks and concrete chips: their gravity and trails sell the subsequent clatter.
    for(let i=0;i<active.particles.length;i++){
      const a=active.particles[i],age=t-a.delay;if(age<0)continue;
      const life=i<32?.85:1.8;if(age>life)continue;
      const vx=Math.cos(a.angle)*a.speed*scale,vy=(Math.sin(a.angle)*a.speed-160)*scale;
      const x=p[0]+vx*age,y=p[1]+vy*age+300*age*age*scale;
      ctx.globalAlpha=Math.max(0,1-age/life);
      if(i<32){
        ctx.strokeStyle=i%3?'#ffbc48':'#fff8d2';ctx.lineWidth=a.size*.3*scale;
        ctx.beginPath();ctx.moveTo(x-vx*.025,y-(vy+600*age*scale)*.025);ctx.lineTo(x,y);ctx.stroke();
      }else{
        ctx.save();ctx.translate(x,y);ctx.rotate(age*a.spin);ctx.fillStyle=i%2?'#6c6254':'#aaa18b';
        ctx.fillRect(-a.size*scale,-a.size*scale,a.size*2*scale,a.size*a.stretch*scale);ctx.restore();
      }
    }
    ctx.globalAlpha=1;firstDraw??=at;return true;
  }
  return {start,draw,cancel,dispose(){cancel();disposed=true;},info:()=>({active:!!active,preview:active?.preview??false,played,firstDraw,
    t0:active?.t0??null,durationMs:IMPACT_DURATION_MS,originPx:active?[active.uv[0]*(globalThis.innerWidth||1440),active.uv[1]*(globalThis.innerHeight||1000)]:null,
    particles:active?.particles.length??0,clouds:active?.clouds.length??0})};
}
