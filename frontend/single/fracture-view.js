import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validatePackageMetadata, validatePackageModels } from '../fracture/package-contract.js';
import { spawnFragmentBodies } from '../game/fragment-bodies.js';
import { TargetProvider } from './target-provider.js';

export class FractureView {
  constructor(canvas) {
    this.canvas=canvas;this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(38,1,.02,100);
    this.camera.position.set(3.8,2.6,4.7);this.camera.lookAt(0,.48,0);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor(0,0);this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#ffffff','#a0aabb',2.8));
    const light=new THREE.DirectionalLight('#fff3dc',3);light.position.set(-3,7,4);this.scene.add(light);
    this.dynamic=[];this.target=new TargetProvider('knu-it1-v3');this.raycaster=new THREE.Raycaster();this.accumulator=0;
  }
  async load() {
    await RAPIER.init();const base='/public/assets/buildings/knu-it1-v3/';
    const json=async name=>{const r=await fetch(base+name);if(!r.ok)throw new Error('건물 패키지를 불러오지 못했습니다.');return r.json();};
    [this.meta,this.data]=await Promise.all([json('manifest.json'),json('colliders.json')]);validatePackageMetadata(this.meta,this.data);
    const loader=new GLTFLoader();const loaded=await Promise.all([loader.loadAsync(base+this.meta.assets.intact),loader.loadAsync(base+this.meta.assets.fragments)]);
    this.intact=loaded[0].scene;this.shards=loaded[1].scene;validatePackageModels(this.meta,this.data,this.intact,this.shards);
    this.scene.add(this.intact,this.shards);this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.world.timestep=1/60;
    const ground=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.06,0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(20,.06,20).setFriction(.8),ground);this.reset();
  }
  collider(item) {const c=RAPIER.ColliderDesc.convexHull(new Float32Array(item.vertices_m));if(!c)throw new Error('invalid_collider');return c.setDensity(item.density_kg_m3).setFriction(item.friction).setRestitution(item.restitution);}
  resize(width,height,transform,version) {
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    if(this.intact) this.target.update(this.intact,this.camera,transform,version);
  }
  reset() {
    if(!this.world)return;
    for(const {body} of this.dynamic)this.world.removeRigidBody(body);this.dynamic=[];
    if(this.fixed)this.world.removeRigidBody(this.fixed);
    this.fixed=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for(const item of this.data.fragments){
      this.world.createCollider(this.collider(item).setTranslation(...item.rest_position_m),this.fixed);
      const node=this.shards.getObjectByName(item.node);node.position.fromArray(item.rest_position_m);node.quaternion.identity();
    }
    this.intact.visible=true;this.shards.visible=false;this.target.active=true;this.accumulator=0;
  }
  impact(point,transform) {
    if(!this.target.contains(point))return null;
    const [x,y]=transform.toScreen(point);
    this.raycaster.setFromCamera(new THREE.Vector2(x/transform.width*2-1,1-y/transform.height*2),this.camera);
    return this.raycaster.intersectObject(this.intact,true)[0]??null;
  }
  destroy(event,transform) {
    const hit=this.impact(event.hit_point_image_norm,transform);if(!hit||this.dynamic.length)return false;
    const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    this.world.removeRigidBody(this.fixed);this.fixed=null;
    this.dynamic=spawnFragmentBodies({world:this.world,shards:this.shards,data:this.data,impactPoint:hit.point,impactNormal:normal,
      radius:this.meta.gameplay?.impact_radius_m??.65,collider:item=>this.collider(item)});
    this.intact.visible=false;this.shards.visible=true;this.target.active=false;return true;
  }
  render(delta) {
    if(this.world){this.accumulator+=Math.min(delta,.1);while(this.accumulator>=1/60){this.world.step();this.accumulator-=1/60;}
      for(const {node,body} of this.dynamic){node.position.copy(body.translation());node.quaternion.copy(body.rotation());}}
    this.renderer.render(this.scene,this.camera);
  }
  snapshot(){return {fragmentCount:this.dynamic.length,targetActive:this.target.active,targetTriangles:this.target.triangles.length,
    intactVisible:this.intact?.visible,bodyCount:this.world?.bodies.len(),finiteBodies:this.dynamic.every(({body})=>Object.values(body.translation()).every(Number.isFinite))};}
  dispose(){this.world?.free();this.world=null;const geo=new Set(),mats=new Set(),textures=new Set();this.scene.traverse(n=>{if(n.geometry)geo.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:n.material?[n.material]:[])mats.add(m);});for(const m of mats)for(const v of Object.values(m))if(v?.isTexture)textures.add(v);for(const t of textures){t.image?.close?.();t.dispose();}for(const m of mats)m.dispose();for(const g of geo)g.dispose();this.renderer.dispose();}
}
