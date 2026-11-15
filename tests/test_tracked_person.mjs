import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TrackedPerson} from '../frontend/building-test/tracked-person.js';

test('marker-space person has a head torso arms and legs only where joints were observed',()=>{
  const scene=new THREE.Scene(),person=new TrackedPerson(scene);
  const joints={nose:{p:[0,0,1.6]},left_shoulder:{p:[-.2,0,1.3]},right_shoulder:{p:[.2,0,1.3]},
    left_hip:{p:[-.1,0,.9]},right_hip:{p:[.1,0,.9]},left_elbow:{p:[-.3,0,1]},right_elbow:{p:[.3,0,1]},
    left_wrist:{p:[-.4,0,.8]},right_wrist:{p:[.4,0,.8]},left_knee:{p:[-.1,0,.5]},right_knee:{p:[.1,0,.5]},
    left_ankle:{p:[-.1,0,.08]},right_ankle:{p:[.1,0,.08]}};
  person.update(joints,true);assert.deepEqual(person.snapshot(),{visible:true,joints:13,bones:12,torso:true,head:true});
  assert.deepEqual(person.head.position.toArray(),[0,0,1.6]);
  assert.equal(person.neck.visible,true);
  delete joints.left_wrist;person.update(joints,true);assert.equal(person.snapshot().bones,11);
  joints.nose={p:[NaN,0,1]};person.update(joints,true);assert.equal(person.head.visible,false);
  person.update(joints,false);assert.equal(person.snapshot().visible,false);assert.equal(person.snapshot().joints,0);
  person.dispose();assert.equal(scene.children.length,0);
});
