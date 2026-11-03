import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Existing keyboard-demo effect, shared without interpreting screen velocity as measured m/s.
export function spawnFragmentBodies({ world, shards, data, impactPoint, impactNormal, radius, collider }) {
  return data.fragments.map((item,index)=>{
    const node=shards.getObjectByName(item.node),[x,y,z]=item.rest_position_m;
    node.position.set(x,y,z);node.quaternion.identity();
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z).setLinearDamping(.35).setAngularDamping(.6).setCcdEnabled(true));
    world.createCollider(collider(item),body);
    const direction=new THREE.Vector3(x,y,z).sub(impactPoint),energy=4.4*Math.exp(-direction.lengthSq()/(radius*radius));
    direction.normalize().multiplyScalar(energy).addScaledVector(impactNormal,energy*.5);
    body.setLinvel({x:direction.x+Math.sin(index*2.4)*energy*.12,y:.15+Math.max(0,direction.y)+energy*.5,z:direction.z+Math.cos(index*3.1)*energy*.12},true);
    body.setAngvel({x:Math.sin(index)*energy,y:Math.cos(index)*energy*.6,z:Math.cos(index*1.7)*energy},true);
    return {node,body};
  });
}
