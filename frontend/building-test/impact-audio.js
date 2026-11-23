// Single cancellable voice group: explosion -> collapsing structure -> scattered clatter.
import {feedbackId,feedbackSeed,feedbackRandom} from './feedback-presets.js';
export function createImpactAudio({createContext=()=>new (globalThis.AudioContext??globalThis.webkitAudioContext)()}={}){
  let ctx=null,noise=null,muted=false,played=0,current=null,preset=null,seed=null;const sources=new Set();let cues=[];
  function prepare(){try{ctx??=createContext();
    if(!noise){noise=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*2),ctx.sampleRate);const a=noise.getChannelData(0),random=feedbackRandom({event_id:'super-audio-noise-v1'});for(let i=0;i<a.length;i++)a[i]=random()*2-1;}
  }catch{/* Unsupported audio never blocks visuals. */}}
  function cancel(){for(const source of sources)try{source.stop();}catch{}sources.clear();current?.disconnect();current=null;}
  function play(event={}){
    if(!ctx||ctx.state!=='running'||muted)return false;
    cancel();const t=ctx.currentTime;let bus;
    try{bus=ctx.createGain();bus.gain.setValueAtTime(.25,t);bus.connect(ctx.destination);}catch{return false;}
    current=bus;cues=[];preset=feedbackId(event);seed=feedbackSeed(event);let remaining=0;
    function cue(kind,delay,duration,peak,frequency){
      const source=kind==='boom'||kind==='thud'?ctx.createOscillator():ctx.createBufferSource();
      const filter=ctx.createBiquadFilter(),gain=ctx.createGain(),at=t+delay;
      if(kind==='boom'||kind==='thud'){
        source.type='triangle';source.frequency.setValueAtTime(frequency,at);source.frequency.exponentialRampToValueAtTime(Math.max(24,frequency*.3),at+duration);
      }else source.buffer=noise;
      filter.type=kind==='clatter'?'highpass':'lowpass';filter.frequency.setValueAtTime(kind==='clatter'?1800:kind==='collapse'?650:kind==='suction'?1200:2200,at);
      if(kind==='suction')filter.frequency.exponentialRampToValueAtTime(100,at+duration);
      gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(peak,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
      source.connect(filter);filter.connect(gain);gain.connect(bus);sources.add(source);remaining++;
      source.onended=()=>{sources.delete(source);source.disconnect();filter.disconnect();gain.disconnect();
        if(--remaining===0){bus.disconnect();if(current===bus)current=null;}};
      source.start(at);source.stop(at+duration+.015);cues.push({kind,delay,duration});
    }
    try{
      if(preset==='swing_wave_v1'){
        cue('boom',0,.16,.8,145);cue('whoosh',.015,.35,.3,0);
        [.12,.3,.5].forEach((d,i)=>cue('thud',d,.17,.4-i*.07,110-i*15));
        [.25,.48,.7,.9].forEach(d=>cue('clatter',d,.08,.1,0));
      }else if(preset==='crush_collapse_v1'){
        cue('boom',0,.24,.85,75);
        [.1,.24,.4].forEach((d,i)=>{cue('thud',d,.22,.5-i*.08,80-i*10);cue('collapse',d,.45,.3-i*.04,0);});
        [.6,.8,1.05].forEach(d=>cue('clatter',d,.08,.1,0));
      }else if(preset==='gravity_compress_v1'){
        cue('boom',0,.18,.7,90);cue('suction',.025,.8,.3,0);cue('boom',.78,.2,.5,58);cue('clatter',.92,.06,.08,0);
      }else{
      cue('boom',0,.42,.85,120);cue('blast',0,.4,.6,0);
      for(const [delay,duration,peak] of [[.14,.65,.35],[.43,.7,.3],[.76,.65,.22]])cue('collapse',delay,duration,peak,0);
      [.31,.49,.7,.96,1.25].forEach((delay,i)=>cue('thud',delay,.17,.34-i*.04,95+i*13));
      [.55,.79,1.07,1.43].forEach((delay,i)=>cue('clatter',delay,.07,.12-i*.02,0));
      }
      played++;return true;
    }catch{cancel();return false;}
  }
  prepare();
  return {play,cancel,unlock(){prepare();return ctx?.resume().catch(()=>{});},mute(on){muted=on;if(on)cancel();},
    dispose(){cancel();void ctx?.close().catch(()=>{});ctx=null;noise=null;},
    info:()=>({muted,played,preset,seed,active:sources.size,state:ctx?.state??'unsupported',cues:cues.map(c=>({...c}))})};
}
