import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {disposeRoots} from '../game/dispose-roots.js';

export async function fetchScene(id){
  const response=await fetch('/api/test/building-scenes/'+encodeURIComponent(id));
  if(!response.ok)throw new Error(`구역 데이터 HTTP ${response.status}`);
  return response.json();
}

export async function loadModels(spec){
  const results=new Array(spec.render.length);let next=0;
  const loader=new GLTFLoader();
  // Limit concurrent GLB decodes instead of loading twenty packages at once.
  const jobs=await Promise.allSettled(Array.from({length:Math.min(3,spec.render.length)},async()=>{
    while(next<spec.render.length){const index=next++;results[index]=await loader.loadAsync(spec.render[index].url);}
  }));
  const error=jobs.find(r=>r.status==='rejected');
  if(error){disposeRoots(results.filter(Boolean).map(g=>g.scene));throw error.reason;}
  return results;
}

export function assembleScene(spec,models){
  const root=new THREE.Group();root.rotation.x=Math.PI/2;
  const nodes=new Map();
  spec.render.forEach((entry,index)=>{
    const source=models[index].scene;source.updateMatrixWorld(true);
    const [sx,sy,sz]=Array.isArray(entry.scale)?entry.scale:[entry.scale,entry.scale,entry.scale];   // stages may squeeze the footprint per axis
    const transform=new THREE.Matrix4().makeScale(sx,sy,sz);transform.setPosition(...entry.offset);
    for(const f of entry.fragments){
      const original=source.getObjectByName(f.source_node);if(!original)throw new Error('모델 파편 없음: '+f.source_node);
      const node=original.clone(true);node.name=f.node;
      new THREE.Matrix4().multiplyMatrices(transform,original.matrixWorld).decompose(node.position,node.quaternion,node.scale);
      node.traverse(child=>{child.userData.fragmentId=f.id;});
      node.userData.restPosition=node.position.clone();node.userData.restQuaternion=node.quaternion.clone();
      root.add(node);nodes.set(f.id,node);
    }
  });
  return {root,nodes};
}
