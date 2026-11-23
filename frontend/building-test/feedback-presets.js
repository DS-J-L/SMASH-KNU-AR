export const DEFAULT_FEEDBACK='chain_blast_v1';
export const FEEDBACK_VERSION=1;
export const FEEDBACK_PRESETS=Object.freeze({
  chain_blast_v1:Object.freeze({label:'연쇄 폭파',durationMs:2100,visualOnly:false}),
  swing_wave_v1:Object.freeze({label:'스윙 충격파',durationMs:1700,visualOnly:false}),
  crush_collapse_v1:Object.freeze({label:'압궤 붕괴',durationMs:2000,visualOnly:false}),
  gravity_compress_v1:Object.freeze({label:'중력 압축',durationMs:2100,visualOnly:true}),
});
export function feedbackId(event={}){
  return (event.feedback_version===undefined||event.feedback_version===FEEDBACK_VERSION)&&
    Object.hasOwn(FEEDBACK_PRESETS,event.feedback_preset)?event.feedback_preset:DEFAULT_FEEDBACK;
}
export function feedbackSeed(event={}){
  if(Number.isInteger(event.feedback_seed)&&event.feedback_seed>=0&&event.feedback_seed<=0xffffffff)return event.feedback_seed;
  return [...String(event.event_id??'preview')].reduce((v,c)=>Math.imul(v^c.charCodeAt(0),16777619)>>>0,2166136261);
}
export function feedbackRandom(event={}){
  let seed=feedbackSeed(event)||1;
  return ()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
}
export function unitDirection(value){
  const a=Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)?value:[1,0,0];
  const length=Math.hypot(...a);return length>1e-8?a.map(v=>v/length):[1,0,0];
}
