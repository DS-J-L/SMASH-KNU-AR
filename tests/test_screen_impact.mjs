import test from 'node:test';
import assert from 'node:assert/strict';
import {createScreenImpact,IMPACT_DURATION_MS} from '../frontend/building-test/screen-impact.js';

function setup(reduced=false){
  globalThis.innerWidth=1440;globalThis.innerHeight=1000;globalThis.devicePixelRatio=1;
  const gradients=[],texts=[];
  const ctx=new Proxy({createRadialGradient(...args){gradients.push(args);return {addColorStop(){}};},
    fillText(t){texts.push(t);},strokeText(t){texts.push(t);}},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  const canvas={hidden:true,width:1,height:1,getContext:()=>ctx};
  return {effect:createScreenImpact(canvas,{now:()=>0,reduced:()=>reduced}),canvas,gradients,texts};
}
test('first explosion is anchored at the given contact, has no effect-name text and clears completely',()=>{
  const {effect,canvas,gradients,texts}=setup();effect.start({originPx:[300,650],event:{event_id:'first'}});effect.draw(16);
  assert.deepEqual(effect.info().originPx,[300,650]);assert.ok(gradients.some(g=>g[0]===300&&g[1]===650));
  assert.deepEqual(texts,[]);assert.equal(effect.info().particles,48);
  effect.draw(IMPACT_DURATION_MS+1);assert.equal(canvas.hidden,true);assert.equal(effect.info().active,false);
});
test('reduced motion keeps a local glow without particles drawn; origins scale with viewport resize',()=>{
  const {effect,gradients}=setup(true);effect.start({originPx:[300,650]});effect.draw(50);assert.equal(gradients.length,1);
  innerWidth=720;innerHeight=500;effect.draw(100);assert.deepEqual(effect.info().originPx,[150,325]);effect.cancel();
});
