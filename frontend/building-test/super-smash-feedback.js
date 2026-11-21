import {createScreenImpact} from './screen-impact.js';
import {createImpactAudio} from './impact-audio.js';

export function createSuperFeedback({canvas,reduced=()=>false,project=()=>null,now=()=>performance.now(),audio=createImpactAudio()}){
  const screen=createScreenImpact(canvas,{reduced,now});let instance=null,revision=-1,epoch=null,latest=null;
  const seen=new Set(),retired=new Set(),logs=[];let eventCount=0;
  function cancel(reason='cancel'){screen.cancel();audio.cancel();if(logs.length){logs.at(-1).cancel=reason;logs.at(-1).endedAt??=now();}}
  function accept(m,{presentable=true}={}){
    if(!m?.server_instance_id)return {accepted:true,event:null}; // existing non-multi consumers
    if(!Number.isSafeInteger(m.model_revision)||m.model_revision<0)return {accepted:false,event:null};
    if(instance!==m.server_instance_id){
      if(retired.has(m.server_instance_id)||m.delivery!=='snapshot')return {accepted:false,event:null};
      if(instance)retired.add(instance);if(retired.size>32)retired.delete(retired.values().next().value);
      cancel('instance');instance=m.server_instance_id;revision=-1;epoch=null;seen.clear();
    }
    if(m.model_revision<revision)return {accepted:false,event:null};
    if(m.model_revision===revision)return {accepted:false,event:null};
    revision=m.model_revision;latest=m;
    if(epoch!==m.epoch){cancel('epoch');epoch=m.epoch;}
    if(m.delivery==='snapshot'||m.phase==='paused')cancel('snapshot_or_pause');
    const e=m.event;
    if(!e||m.delivery!=='event'||m.smash_mode!=='super_smash'||e.effect_style!=='screen_impact_v1'||
      e.epoch!==epoch||e.server_instance_id!==instance||e.model_revision!==revision||seen.has(e.event_id))return {accepted:true,event:null};
    seen.add(e.event_id);if(seen.size>256)seen.delete(seen.values().next().value);
    if(!presentable||!['live','synthetic','replay'].includes(e.input_mode))return {accepted:true,event:null};
    const t0=now(),originPx=project(e.point_m);screen.start({event:e,originPx,t0});audio.play();eventCount++;
    logs.push({event_id:e.event_id,epoch,received:t0,firstDraw:null,scene_id:m.scene_id,input_mode:e.input_mode,
      point_m:e.point_m,originPx:screen.info().originPx,releasedCount:e.released_ids?.length??0,quality:e.quality??null,serverFuseMs:e.server_fuse_ms??null});if(logs.length>128)logs.shift();
    return {accepted:true,event:e};
  }
  return {accept,cancel,unlock:()=>audio.unlock(),mute:on=>audio.mute(on),preview({originPx}={}){
    cancel('preview');const b=latest?.bounds,point=b?b.lo.map((v,i)=>(v+b.hi[i])/2):null;
    screen.start({event:{},originPx:originPx??project(point),t0:now(),preview:true});audio.play();},
    draw(at){const before=screen.info(),result=screen.draw(at),info=screen.info();
      if(before.active&&before.firstDraw===null&&!info.active)cancel('draw_deadline');
      else if(before.active&&!info.active&&logs.length)logs.at(-1).endedAt??=at;
      if(logs.length&&info.firstDraw!==null&&logs.at(-1).firstDraw===null)logs.at(-1).firstDraw=info.firstDraw;return result;},
    dispose(){screen.dispose();audio.dispose();},info:()=>({screen:screen.info(),audio:audio.info(),eventCount,revision,epoch,latest,logs:logs.map(x=>({...x}))})};
}
