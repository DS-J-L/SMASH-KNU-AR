import {createScreenImpact} from './screen-impact.js';
import {createImpactAudio} from './impact-audio.js';
import {DEFAULT_FEEDBACK,FEEDBACK_PRESETS,feedbackId,feedbackSeed,unitDirection} from './feedback-presets.js';

export function createSuperFeedback({canvas,reduced=()=>false,project=()=>null,now=()=>performance.now(),audio=createImpactAudio(),onCancel=()=>{}}){
  const screen=createScreenImpact(canvas,{reduced,now});let instance=null,revision=-1,epoch=null,latest=null;
  const seen=new Set(),retired=new Set(),logs=[];let eventCount=0;
  function cancel(reason='cancel'){screen.cancel();audio.cancel();onCancel(reason);if(logs.length){logs.at(-1).cancel=reason;logs.at(-1).endedAt??=now();}}
  function presentation(event,bounds,originPx=project(event.point_m)){
    const point=event.point_m,d=unitDirection(event.direction),span=bounds?Math.hypot(...bounds.hi.map((v,i)=>v-bounds.lo[i])):1;
    const end=point?project(point.map((v,i)=>v+d[i]*Math.max(.1,span*.25)),{unclipped:true}):null;
    const corners=bounds?Array.from({length:8},(_,n)=>project(bounds.lo.map((v,i)=>n&(1<<i)?bounds.hi[i]:v),{unclipped:true})).filter(Boolean):[];
    const spanPx=corners.length?Math.max(...[0,1].map(i=>Math.max(...corners.map(p=>p[i]))-Math.min(...corners.map(p=>p[i])))):null;
    return {originPx,directionPx:originPx&&end?end.map((v,i)=>v-originPx[i]):null,spanPx,
      groundPx:point?project([point[0],point[1],0],{unclipped:true}):null};
  }
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
    if(!presentable||!['live','synthetic','replay','mouse_demo'].includes(e.input_mode))return {accepted:true,event:null};
    const t0=now(),played={...e,feedback_preset:feedbackId(e),feedback_version:1,feedback_seed:feedbackSeed(e),presentation_t0:t0,presentation_reduced:Boolean(reduced())};
    screen.start({event:played,...presentation(played,m.bounds),t0});audio.play(played);eventCount++;
    logs.push({event_id:e.event_id,epoch,received:t0,firstDraw:null,scene_id:m.scene_id,input_mode:e.input_mode,
      point_m:e.point_m,originPx:screen.info().originPx,requestedPreset:e.feedback_preset??DEFAULT_FEEDBACK,
      preset:played.feedback_preset,seed:played.feedback_seed,releasedCount:e.released_ids?.length??0,quality:e.quality??null,serverFuseMs:e.server_fuse_ms??null});if(logs.length>128)logs.shift();
    return {accepted:true,event:played};
  }
  let previewIndex=0;
  return {accept,cancel,unlock:()=>audio.unlock(),mute:on=>audio.mute(on),preview({originPx,preset=latest?.feedback_selection??DEFAULT_FEEDBACK}={}){
    cancel('preview');const b=latest?.bounds,point=b?b.lo.map((v,i)=>(v+b.hi[i])/2):null;
    const selection=preset==='shuffle'?Object.keys(FEEDBACK_PRESETS)[previewIndex++%4]:preset;
    const event={event_id:'preview:'+previewIndex,point_m:point,direction:[1,0,0],feedback_preset:selection,feedback_version:1};
    screen.start({event,...presentation(event,b,originPx??project(point)),t0:now(),preview:true});audio.play(event);},
    draw(at){const before=screen.info(),result=screen.draw(at),info=screen.info();
      if(before.active&&before.firstDraw===null&&!info.active)cancel('draw_deadline');
      else if(before.active&&!info.active&&logs.length)logs.at(-1).endedAt??=at;
      if(logs.length&&info.firstDraw!==null&&logs.at(-1).firstDraw===null)logs.at(-1).firstDraw=info.firstDraw;return result;},
    dispose(){screen.dispose();audio.dispose();},info:()=>({screen:screen.info(),audio:audio.info(),eventCount,revision,epoch,latest,logs:logs.map(x=>({...x}))})};
}
