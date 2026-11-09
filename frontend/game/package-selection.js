// Explicit isolated QA profile. Existing catalog/default bytes are never changed.
export const ANALYTIC_ID='knu-it1-analytic-164-v1';
export const APP_SCHEMA='knu-analytic-app-1.0';
export const PROFILE='it1-64g-164c-13max-v1';
export const FILE_HASHES=Object.freeze({
  "manifest.json": "5a5fa1164494396e61f4d99a24a3f796441c085fbb10409ab15ea39120ed515c",
  "it1-418-intact-standalone.glb": "e9b96d772c3c8bd59235b7d8aa2f19cb7dd590cd5849f1d32e67a95d8a83b768",
  "it1-418-analytic-colliders.glb": "4fcefe358c64a449c653e08321ba4b9d932b8f857dadc6c060cd646c00a57f55",
  "colliders.json": "ad8e6ca943de6bb42eb09b7a063d58099a9e6fa54c6f83ba5c1d1d3770b6906a",
  "it1-418-fractured-render.glb": "b0e7a966a41fcba450b48fc0af21df21d10f2ee36c14ae993fb692d479b104d2"
});
export const QA_CASES=Object.freeze(['original','display_translated','local_rotated90Y','display_translated_local_rotated90Y']);
export function catalogForSelection(catalog,params){return params.get('qa_compound')==='1'?{...catalog,buildings:[...catalog.buildings,{id:ANALYTIC_ID,folder:ANALYTIC_ID,label:'IT1 64그룹 · 미승인 QA 후보'}]}:catalog;}
export function requestedSinglePackage(params){return params.get('qa_compound')==='1'&&params.get('building')===ANALYTIC_ID?ANALYTIC_ID:'knu-it1-v3';}
export function placementFor(id,params){const name=id===ANALYTIC_ID&&params.get('qa_compound')==='1'?(params.get('qa_frame')??'original'):'original';if(!QA_CASES.includes(name))throw new Error('invalid_qa_frame');const rotated=name.includes('rotated90Y'),translated=name.includes('display_translated');return Object.freeze({name,origin_world_m:Object.freeze(translated?[1,2,3]:[0,0,0]),local_placement:Object.freeze({name:rotated?'rotated90Y':'original',translation_m:Object.freeze([0,0,0]),rotation_matrix_row_major:Object.freeze(rotated?[0,0,1,0,1,0,-1,0,0]:[1,0,0,0,1,0,0,0,1]),global_quaternion_xyzw:Object.freeze(rotated?[0,Math.SQRT1_2,0,Math.SQRT1_2]:[0,0,0,1])})});}
