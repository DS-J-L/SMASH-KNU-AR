// Cosmetic screen layers only. Tracking, camera projection and scores keep running.
export function drawScreenVariation(ctx,a,{p,t,w,h,glow}){
  const L=a.spanFraction*Math.min(w,h),fade=Math.max(0,1-t/(a.durationMs/1000));
  const ground=a.groundUV?[a.groundUV[0]*w,a.groundUV[1]*h]:[p[0],Math.min(h,p[1]+L*.3)];
  const line=(points,color,width,alpha)=>{if(alpha<=0)return;ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.stroke();ctx.globalAlpha=1;};
  const ring=(point,rx,ry,color,width,alpha)=>{if(rx<=0||ry<=0||alpha<=0)return;ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.translate(...point);ctx.scale(1,ry/rx);ctx.beginPath();ctx.arc(0,0,rx,0,Math.PI*2);ctx.stroke();ctx.restore();};
  const color=a.preset==='gravity_compress_v1'?'#ba99ff':a.preset==='swing_wave_v1'?'#a9e9ff':'#ffd0a0';
  if(t<.16)glow(...p,L*(.035+t*.35),[[0,'#ffffff'],[.35,color],[1,'rgba(255,255,255,0)']],1-t/.16);
  if(a.preset==='swing_wave_v1'&&t<.7){
    const d=a.directionUV?[a.directionUV[0]*w,a.directionUV[1]*h]:[0,0],length=Math.hypot(...d),alpha=Math.max(0,1-t/.7);
    if(length<8){
      for(let i=0;i<3;i++)ring(p,L*(.06+t*(1.2+i*.25)),L*(.06+t*(1.2+i*.25)),color,Math.max(1,6-i*2),alpha*(1-i*.22));
    }else{
      const dx=d[0]/length,dy=d[1]/length,nx=-dy,ny=dx,reach=L*Math.min(1.6,t*6),width=L*.14*alpha;
      ctx.globalAlpha=.22*alpha;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(p[0]-nx*width,p[1]-ny*width);ctx.lineTo(p[0]+dx*reach,p[1]+dy*reach);ctx.lineTo(p[0]+nx*width,p[1]+ny*width);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
      line([p,[p[0]+dx*reach,p[1]+dy*reach]],color,4*alpha+1,alpha);
      for(let i=-2;i<=2;i++)line([[p[0]+nx*i*L*.06,p[1]+ny*i*L*.06],[p[0]+dx*reach*.8+nx*i*L*.06,p[1]+dy*reach*.8+ny*i*L*.06]],color,1,alpha*.5);
    }
  }
  if(a.preset==='crush_collapse_v1'){
    if(t<.85){
      for(let i=-2;i<=2;i++){const x=p[0]+i*L*.2,y=p[1]-L*.38+Math.min(1,t/.5)*L*.35;
        line([[x,y-L*.17],[x,y]],color,Math.max(1,L*.008),.8*(1-t/.85));}
      ring(ground,L*(.08+t*.9),L*(.025+t*.24),color,3,.8*(1-t/.85));
    }
    if(t>.12)for(let i=0;i<12;i++){
      const age=t-.12,c=a.clouds[i],x=ground[0]+Math.cos(c.angle)*L*age*.45;
      glow(x,ground[1]-L*.035*age,L*(.025+age*.11)*c.size,[[0,'rgba(120,108,94,.65)'],[1,'rgba(90,83,78,0)']],fade*.65);
    }
  }
  if(a.preset==='gravity_compress_v1'&&t<1.35){
    const q=Math.min(1,t/1.15),radius=L*(.03+Math.sin(q*Math.PI)*.48),alpha=Math.sin(q*Math.PI);
    glow(...p,radius,[[0,'rgba(19,7,43,.9)'],[.32,'rgba(88,42,143,.65)'],[.7,'rgba(173,117,255,.3)'],[1,'rgba(157,97,255,0)']],Math.max(0,alpha));
    for(let arm=0;arm<3;arm++){
      const points=[];for(let i=0;i<56;i++){const f=i/55,angle=f*12+t*6+arm*Math.PI*2/3;points.push([p[0]+Math.cos(angle)*radius*f,p[1]+Math.sin(angle)*radius*f*.7]);}
      line(points,color,2,Math.max(0,alpha)*.8);
    }
    ring(p,radius*.28,radius*.21,color,3,Math.max(0,alpha));
  }
}
