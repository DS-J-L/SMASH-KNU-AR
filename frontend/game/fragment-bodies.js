import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {createGroupColliders,quat} from './package-runtime.js';

// Existing keyboard-demo effect, shared without interpreting screen velocity as measured m/s.
// This is the only production formula; construction can now attach a compound per group.
export function spawnFragmentBodies({ world, shards, data, runtime, impactPoint, impactNormal, radius, collider, motion='synthetic', engine=RAPIER }) {
  if(!['synthetic','stationary'].includes(motion))throw new Error('unknown_release_motion');
  const groups=runtime?.groups??data.fragments,staged=[];
  try{groups.forEach((item,index)=>{
    const node=shards.getObjectByName(item.node),[x,y,z]=item.rest_position_m;
    if(!node)throw new Error('missing_fragment_node');
    const previous={position:node.position.toArray(),quaternion:node.quaternion.toArray()};
    const rotation=runtime?item.rest_quaternion_xyzw:[0,0,0,1];
    const body=world.createRigidBody(engine.RigidBodyDesc.dynamic().setTranslation(x,y,z).setRotation(quat(rotation)).setLinearDamping(.35).setAngularDamping(.6).setCcdEnabled(true));
    const record={id:item.id??item.fragment_id,node,body,previous};staged.push(record);
    if(runtime)record.colliders=createGroupColliders(engine,world,body,item,runtime);else record.colliders=[world.createCollider(collider(item),body)];
    if(motion==='synthetic'){
    const direction=new THREE.Vector3(x,y,z).sub(impactPoint),energy=4.4*Math.exp(-direction.lengthSq()/(radius*radius));
    direction.normalize().multiplyScalar(energy).addScaledVector(impactNormal,energy*.5);
    body.setLinvel({x:direction.x+Math.sin(index*2.4)*energy*.12,y:.15+Math.max(0,direction.y)+energy*.5,z:direction.z+Math.cos(index*3.1)*energy*.12},true);
    body.setAngvel({x:Math.sin(index)*energy,y:Math.cos(index)*energy*.6,z:Math.cos(index*1.7)*energy},true);
    }
    node.position.set(x,y,z);node.quaternion.fromArray(rotation);
  });return staged;}catch(error){for(const r of staged){world.removeRigidBody(r.body);r.node.position.fromArray(r.previous.position);r.node.quaternion.fromArray(r.previous.quaternion);}throw error;}
}
