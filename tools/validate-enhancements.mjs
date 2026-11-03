import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import { Box3,Matrix4,Quaternion,Vector3 } from 'three';
import { validatePackageMetadata } from '../frontend/fracture/package-contract.js';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const catalog=await read('web/public/assets/buildings/catalog.json');
const reports=[];
function getBounds(gltf){
  const bounds=new Box3();
  const visit=(i,parent=new Matrix4())=>{
    const node=gltf.nodes[i],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1]))),world=parent.clone().multiply(local);
    for(const primitive of node.mesh===undefined?[]:gltf.meshes[node.mesh].primitives){const a=gltf.accessors[primitive.attributes.POSITION];bounds.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)).applyMatrix4(world));}
    for(const child of node.children??[])visit(child,world);
  };
  for(const i of gltf.scenes[gltf.scene??0].nodes)visit(i);return bounds;
}
async function glb(file){
  const bytes=await fs.readFile(file),checked=await validator.validateBytes(new Uint8Array(bytes),{uri:file});
  assert.equal(checked.issues.numErrors,0,JSON.stringify(checked.issues.messages));
  assert.equal(checked.issues.numWarnings,0,JSON.stringify(checked.issues.messages));
  const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const triangles=gltf.meshes.reduce((n,m)=>n+m.primitives.reduce((p,v)=>p+(gltf.accessors[v.indices??v.attributes.POSITION].count/3),0),0);
  reports.push({file,bytes:bytes.length,triangles,errors:0,warnings:0});return gltf;
}
for(const entry of catalog.buildings){
  const dir=`web/public/assets/buildings/${entry.folder}`,meta=await read(dir+'/manifest.json'),data=await read(dir+'/colliders.json');
  validatePackageMetadata(meta,data);assert.equal(meta.building_id,entry.id);
  const intact=await glb(dir+'/'+meta.assets.intact),fragments=await glb(dir+'/'+meta.assets.fragments);
  getBounds(intact).getSize(new Vector3()).toArray().forEach((v,i)=>assert(Math.abs(v-meta.dimensions_m[i])<1e-5));
  const before=getBounds(intact),after=getBounds(fragments);assert(before.min.distanceTo(after.min)<2e-5&&before.max.distanceTo(after.max)<2e-5);
  for(const piece of data.fragments){const node=fragments.nodes.find(n=>n.name===piece.node);assert(node);(node.translation??[0,0,0]).forEach((v,i)=>assert(Math.abs(v-piece.rest_position_m[i])<1e-5));}
  if(entry.id!=='knu-it1-v1'){
    const qa=await read(`docs/asset-validation/enhancement/${entry.id}-qa.json`);assert.equal(qa.errors.length,0);assert(qa.volume_relative_error<.0002);assert(qa.fragment_count>32&&qa.fragment_count<=128);
    assert(reports.at(-1).triangles<=30000);assert(reports.at(-2).triangles<=10000);assert(reports.at(-1).bytes<5000000);
    if(meta.previous_version){
      const previous=await read(`web/public/assets/buildings/${meta.previous_version}/manifest.json`);
      const oldQA=await read(`docs/asset-validation/enhancement/${meta.previous_version}-qa.json`);
      meta.dimensions_m.forEach((value,i)=>assert(Math.abs(value-previous.dimensions_m[i])<1e-6,'intact geometry size changed'));
      assert(Math.abs(qa.intact_volume_m3-oldQA.intact_volume_m3)/oldQA.intact_volume_m3<1e-7,'intact volume changed');
      assert(meta.fragment_count>previous.fragment_count,'refinement must add fragments');
      assert.equal(meta.fragment_count,entry.id==='knu-it1-v3'?96:85);
    }
  }
}
await glb('web'+catalog.campus);
const campus=await read('docs/asset-validation/enhancement/campus-v12-qa.json');assert.equal(campus.buildings,123);assert.equal(campus.errors.length,0);
const current=catalog.campus.includes('v13');
if(current){
  const changes=await read('docs/asset-validation/map-review/v13-model-qa.json');assert.equal(changes.length,6);
  for(const row of changes){assert(row.geometry.pass&&row.visual.pass);assert(row.after_bounds[1][2]<=row.before_group_bounds[1][2]+.001);}
  const audit=await read('docs/asset-validation/map-review/v13-campus-audit.json');assert.equal(audit.building_count,123);assert.equal(audit.errors.length,0);
  const roundtrip=await read('docs/asset-validation/map-review/v13-roundtrip.json');assert.equal(roundtrip.cores,123);assert.equal(roundtrip.errors,0);
}
const reportDir=catalog.default==='knu-it1-v3'?'fracture-refinement':current?'map-review':'enhancement';
await fs.writeFile(`docs/asset-validation/${reportDir}/gltf-validation.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
