import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { spawnFragmentBodies } from '../game/fragment-bodies.js';
import { TargetProvider } from './target-provider.js';
import {loadPackage} from '../fracture/package-loader.js';
import {makePackageRuntime,createIntactBody,presentPackage,restoreGroupNodes,restTransformsMatch,syncDynamicNodes} from '../game/package-runtime.js';
import {requestedSinglePackage,placementFor} from '../game/package-selection.js';
import {destroyTransaction,resetTransaction} from '../game/package-lifecycle.js';
import {disposeRoots} from '../game/dispose-roots.js';

export class FractureView {
  constructor(canvas,{params=new URLSearchParams()}={}) {
    this.canvas=canvas;this.params=params;this.buildingId=requestedSinglePackage(params);this.disposed=false;this.loadGeneration=0;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(38,1,.02,100);
    this.camera.position.set(3.8,2.6,4.7);this.camera.lookAt(0,.48,0);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor(0,0);this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#ffffff','#a0aabb',2.8));
    const light=new THREE.DirectionalLight('#fff3dc',3);light.position.set(-3,7,4);this.scene.add(light);
    this.dynamic=[];this.target=new TargetProvider(this.buildingId);this.raycaster=new THREE.Raycaster();this.accumulator=0;
  }
  async load() {
    if(this.disposed||this.world)throw new Error('view_load_state');
    const generation=++this.loadGeneration,isCurrent=()=>!this.disposed&&generation===this.loadGeneration;let loaded,world;
    try{await RAPIER.init();if(!isCurrent())throw new Error('stale_package_load');
      loaded=await loadPackage({id:this.buildingId,base:`/public/assets/buildings/${this.buildingId}/`,loader:new GLTFLoader(),isCurrent});
      const runtime=makePackageRuntime(loaded.meta,loaded.data,placementFor(this.buildingId,this.params));
      const presentation=presentPackage(THREE,runtime,loaded.intact,loaded.shards);
      if(!isCurrent())throw new Error('stale_package_load');
      world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/60;
      const gp=runtime.frame.toLocal([0,-.06,0]),ground=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...gp));world.createCollider(RAPIER.ColliderDesc.cuboid(20,.06,20).setFriction(.8),ground);
      const fixed=createIntactBody(RAPIER,world,runtime);
      if(!isCurrent())throw new Error('stale_package_load');
      this.meta=loaded.meta;this.data=loaded.data;this.runtime=runtime;this.intact=loaded.intact;this.shards=loaded.shards;this.presentation=presentation;this.world=world;this.fixed=fixed;world=null;loaded=null;
      this.scene.add(presentation);this.shards.visible=false;this.intact.visible=true;this.target.active=true;this.accumulator=0;
      const o=runtime.frame.origin;this.camera.position.fromArray([3.8,2.6,4.7].map((x,k)=>x+o[k]));this.camera.lookAt(...[0,.48,0].map((x,k)=>x+o[k]));
    }catch(error){world?.free();if(loaded)disposeRoots([loaded.intact,loaded.shards]);throw error;}
  }
  resize(width,height,transform,version) {
    if(this.disposed)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    if(this.intact)this.target.update(this.intact,this.camera,transform,version);
  }
  reset() {
    if(!this.world||this.disposed)return false;
    const fixed=resetTransaction({world:this.world,fixed:this.fixed,dynamic:this.dynamic,createIntact:()=>createIntactBody(RAPIER,this.world,this.runtime)});
    this.fixed=fixed;this.dynamic=[];restoreGroupNodes(this.shards,this.runtime);
    this.intact.visible=true;this.shards.visible=false;this.target.active=true;this.accumulator=0;return true;
  }
  impact(point,transform) {
    if(this.disposed||!this.target.contains(point))return null;
    const [x,y]=transform.toScreen(point);
    this.raycaster.setFromCamera(new THREE.Vector2(x/transform.width*2-1,1-y/transform.height*2),this.camera);
    return this.raycaster.intersectObject(this.intact,true)[0]??null;
  }
  destroy(event,transform) {
    if(this.disposed||!this.world||event.building_id!==this.buildingId)return false;
    const hit=this.impact(event.hit_point_image_norm,transform);if(!hit||this.dynamic.length)return false;
    const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const impactPoint=new THREE.Vector3(...this.runtime.frame.toLocal(hit.point.toArray())),impactNormal=new THREE.Vector3(...this.runtime.frame.direction(normal.toArray()));
    try{this.dynamic=destroyTransaction({world:this.world,fixed:this.fixed,spawn:()=>spawnFragmentBodies({world:this.world,shards:this.shards,data:this.data,runtime:this.runtime,impactPoint,impactNormal,radius:this.meta.gameplay?.impact_radius_m??.65})});}catch(error){this.lastError=error.message;return false;}
    this.fixed=null;this.intact.visible=false;this.shards.visible=true;this.target.active=false;return true;
  }
  render(delta) {
    if(this.disposed)return;
    if(this.world){this.accumulator+=Math.min(delta,.1);while(this.accumulator>=1/60){this.world.step();this.accumulator-=1/60;}
      syncDynamicNodes(this.dynamic);}
    this.renderer.render(this.scene,this.camera);
  }
  snapshot(){return {buildingId:this.buildingId,expectedFragmentCount:this.runtime?.groupCount??0,expectedColliderCount:this.runtime?.colliderCount??0,fragmentCount:this.dynamic.length,targetActive:this.target.active,targetTriangles:this.target.triangles.length,
    intactVisible:this.intact?.visible,bodyCount:this.world?.bodies.len(),colliderCount:this.world?.colliders.len(),physicsOrigin:this.runtime?.frame.origin,placement:this.runtime?.placement.name,restTransformsMatch:restTransformsMatch(this.shards,this.runtime),lastError:this.lastError??null,finiteBodies:this.dynamic.every(({body})=>Object.values(body.translation()).every(Number.isFinite))};}
  dispose(){if(this.disposed)return;this.disposed=true;this.loadGeneration++;this.world?.free();this.world=null;this.fixed=null;this.dynamic=[];this.target.active=false;this.target.triangles=[];disposeRoots([this.scene]);this.presentation?.removeFromParent();this.intact=this.shards=this.presentation=null;this.renderer.dispose();}
}
