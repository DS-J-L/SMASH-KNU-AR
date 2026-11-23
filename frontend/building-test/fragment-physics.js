import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import {feedbackId,feedbackSeed,unitDirection} from './feedback-presets.js';

let initializing;
export const initPhysics = () => initializing ??= RAPIER.init();
export const DEFAULT_PHYSICS = Object.freeze({gravity:true, floor:true, building:true, debris:true, rotation:true, sleep:true, hand:true});
const groups = (member, mask) => (member << 16) | mask;

// One simulation in marker coordinates, shared by the orbit view and all camera overlays.
export class FragmentPhysics {
  constructor(data, placement, options={}) {
    this.options={...DEFAULT_PHYSICS,...options}; this.data=data; this.placement=placement;
    this.world=new RAPIER.World({x:0,y:0,z:-9.81});this.world.timestep=1/60;
    this.queue=new RAPIER.EventQueue(true);this.records=new Map();this.byCollider=new Map();
    this.times=[];this.steps=0;this.droppedTime=0;this.accumulator=0;this.dynamic=new Set();
    this.onImpact=()=>{};
    this.superQueue=[];this.superHidden=new Set();this.superRemoved=new Set();this.superEventId=null;this.superAt=null;
    this.superVisual=new Map();this.superGroups=new Map();this.superPreset=null;
    this.appliedPushes=new Set();
    this.appliedBlasts=new Set();this.interactionDistance=.75;this.filteredPairs=0;this.hookPositions=new Map();
    this.hooks={filterContactPair:(a,b)=>{
      const ia=this.byCollider.get(a),ib=this.byCollider.get(b);
      if(this.dynamic.has(ia)&&this.dynamic.has(ib)){
        const pa=this.hookPositions.get(ia),pb=this.hookPositions.get(ib);
        if(!pa||!pb)return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        if(Math.hypot(pa.x-pb.x,pa.y-pb.y,pa.z-pb.z)>this.interactionDistance){this.filteredPairs++;return null;}
      }
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },filterIntersectionPair:()=>true};
    this.wrists=new Map();
    const p=placement, yaw=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),p.yaw_deg*Math.PI/180);
    this.frameRotation=yaw.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2));
    this.frameInverse=this.frameRotation.clone().invert();
    const floorBody=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,0,-.05));
    this.floor=this.world.createCollider(RAPIER.ColliderDesc.cuboid(128,128,.05).setFriction(.8).setRestitution(.08),floorBody);
    try {
      for(const f of data.fragments){
        const pos=new Vector3(...f.rest_position_m).multiplyScalar(p.scale).applyQuaternion(this.frameRotation).add(new Vector3(p.x_m,p.y_m,0));
        const rot=this.frameRotation.clone().multiply(new Quaternion(...(f.rest_quaternion_xyzw??[0,0,0,1])));
        const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x,pos.y,pos.z).setRotation(rot)
          .setLinearDamping(.4).setAngularDamping(.6).setCcdEnabled(true).setCanSleep(true));
        const vertices=new Float32Array(f.vertices_m.map(v=>v*p.scale));
        const desc=RAPIER.ColliderDesc.convexHull(vertices);
        if(!desc)throw new Error(`convex hull failed: ${f.node}`);
        const collider=this.world.createCollider(desc.setDensity(f.density_kg_m3??200).setFriction(f.friction??.76)
          .setRestitution(f.restitution??.08).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
          .setContactForceEventThreshold(8),body);
        const buildingId=f.building_id??'scene';
        const bounds=this.superGroups.get(buildingId)??{lo:Infinity,hi:-Infinity};
        for(let i=0;i<vertices.length;i+=3){const v=new Vector3(vertices[i],vertices[i+1],vertices[i+2]).applyQuaternion(rot);bounds.lo=Math.min(bounds.lo,pos.z+v.z);bounds.hi=Math.max(bounds.hi,pos.z+v.z);}
        this.superGroups.set(buildingId,bounds);
        this.records.set(f.fragment_id,{body,collider,id:f.fragment_id,vertices,buildingId});this.byCollider.set(collider.handle,f.fragment_id);
      }
      this.configure(this.options);
    }catch(e){this.dispose();throw e;}
  }
  configure(options){
    const changed=Object.keys(options).some(k=>this.options[k]!==options[k]);
    Object.assign(this.options,options);const o=this.options;
    this.floor.setCollisionGroups(groups(1,o.floor?4:0));
    for(const r of this.records.values()){
      const moving=this.dynamic.has(r.id);
      r.collider.setCollisionGroups(moving?groups(4,(o.floor?1:0)|(o.building?2:0)|(o.debris?4:0)|(o.hand?8:0)):groups(2,o.building?4:0));
      r.body.setGravityScale(o.gravity?1:0,false);r.body.lockRotations(!o.rotation,false);
      if(changed&&moving)r.body.wakeUp();
      if(!o.sleep&&moving)r.body.wakeUp();
    }
    if(!o.hand)for(const h of this.wrists.values()){h.collider.setEnabled(false);h.active=false;h.previous=null;}
  }
  updateWrists(joints,at,now){
    for(const name of ['left_wrist','right_wrist']){
      const p=joints[name]?.p;
      let h=this.wrists.get(name);
      if(!this.options.hand||!p||p.length!==3||!p.every(Number.isFinite)||now-at>250){
        if(h){h.collider.setEnabled(false);h.active=false;h.previous=null;}continue;
      }
      const target={x:p[0],y:p[1],z:p[2]};
      if(!h){const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...p));
        const shape=new RAPIER.Ball(.05),collider=this.world.createCollider(RAPIER.ColliderDesc.ball(.05).setCollisionGroups(groups(8,4)).setFriction(.6),body);
        collider.setEnabled(false);h={body,collider,shape,previous:null,active:false,target};this.wrists.set(name,h);}
      if(h.previous?.at===at)continue;
      const linked=h.previous&&at>h.previous.at&&at-h.previous.at<=250&&Math.hypot(...p.map((v,i)=>v-h.previous.p[i]))<=1.5;
      if(!linked){h.active=false;h.collider.setEnabled(false);h.body.setTranslation(target,false);h.body.setNextKinematicTranslation(target);}
      // Recovered tracking must first be outside all dynamic pieces; don't spawn a hand inside one.
      else if(!h.active){
        const overlapping=[...this.dynamic].some(id=>this.records.get(id).collider.intersectsShape(h.shape,target,{x:0,y:0,z:0,w:1}));
        h.body.setTranslation(target,false);h.body.setNextKinematicTranslation(target);
        if(!overlapping){h.active=true;h.collider.setEnabled(true);}
      }
      h.previous={p:[...p],at};h.target=target;
    }
  }
  release(ids,event=null){
    let changed=false;
    for(const id of ids){const r=this.records.get(id);if(!r||this.dynamic.has(id))continue;
      changed=true;
      this.dynamic.add(id);r.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
      // Synthetic release speed, NOT a measurement of the person's physical impact energy.
      if(event?.fragment_id===id&&(event.kind==='wrist'||event.kind==='ankle')&&!event.blast){
        const d=new Vector3(...event.direction).normalize(),mass=r.body.mass(),centre=r.body.translation();
        const at=event.point_m??[centre.x,centre.y,centre.z+.02];
        r.body.applyImpulseAtPoint({x:d.x*1.2*mass,y:d.y*1.2*mass,z:(d.z*1.2+.3)*mass},
          {x:at[0],y:at[1],z:at[2]},true);
      }
    }
    if(changed)this.configure({});
  }
  queueSuper(ids,event=null){
    // Atomic logical removal, bounded visual physics. Snapshots restore silently as hidden debris.
    for(const id of ids)if(!this.superRemoved.has(id)){
      this.superRemoved.add(id);this.superHidden.add(id);this.records.get(id)?.collider.setEnabled(false);
    }
    if(!event||this.superEventId===event.event_id)return;
    this.superEventId=event.event_id;this.superAt=Number.isFinite(event.presentation_t0)?event.presentation_t0:performance.now();
    this.superPreset=feedbackId(event);
    if(event.presentation_reduced===true){this.stopSuper();return;}
    const distances=new Map([...ids].filter(id=>this.records.has(id)).map(id=>{
      const p=this.records.get(id).body.translation();
      return [id,id===event.fragment_id?0:Math.hypot(p.x-event.point_m[0],p.y-event.point_m[1],p.z-event.point_m[2])];
    }));
    const distance=id=>distances.get(id);
    const ordered=[...distances.keys()].sort((a,b)=>distance(a)-distance(b)||(a===event.fragment_id?-1:b===event.fragment_id?1:a-b));
    const near=ordered.length?distance(ordered[0]):0,far=ordered.length?distance(ordered.at(-1)):0;
    // The authoritative IDs are already removed; show intact visual pieces until the blast reaches them.
    for(const id of ordered)this.superHidden.delete(id);
    const direction=unitDirection(event.direction),dots=ordered.map(id=>{const p=this.records.get(id).body.translation();return p.x*direction[0]+p.y*direction[1]+p.z*direction[2];});
    const minDot=Math.min(...dots),maxDot=Math.max(...dots);
    this.superQueue=ordered.map((id,i)=>{
      const r=this.records.get(id),p=r.body.translation(),group=this.superGroups.get(r.buildingId),height=Math.max(.05,group.hi-group.lo);
      const fraction=(distance(id)-near)/Math.max(.01,far-near);let delay=650*fraction;
      if(this.superPreset==='swing_wave_v1')delay=40+300*(dots[i]-minDot)/Math.max(.01,maxDot-minDot);
      else if(this.superPreset==='crush_collapse_v1')delay=60+90*Math.min(3,Math.floor(4*Math.max(0,p.z-group.lo)/height));
      else if(this.superPreset==='gravity_compress_v1')delay=140*fraction;
      if(i===0)delay=0;
      const visual=this.superPreset==='gravity_compress_v1';
      return {id,event,height,dynamic:!visual&&i<128,visual:visual&&i<64,due:this.superAt+delay,priority:i};
    }).sort((a,b)=>a.due-b.due||a.priority-b.priority);
  }
  processSuper(now){
    if(this.superAt!==null&&now-this.superAt>4000){this.stopSuper();return;}
    const start=performance.now();let count=0;
    while(this.superQueue.length&&this.superQueue[0].due<=now&&count<16&&performance.now()-start<3){
      const {id,event,height,dynamic,visual,due}=this.superQueue.shift(),r=this.records.get(id);count++;
      if(visual){
        const p=r.body.translation(),q=r.body.rotation();r.body.setBodyType(RAPIER.RigidBodyType.Fixed,false);r.collider.setEnabled(false);this.dynamic.delete(id);
        this.superVisual.set(id,{start:due,origin:new Vector3(p.x,p.y,p.z),rotation:new Quaternion(q.x,q.y,q.z,q.w),event,position:new Vector3(p.x,p.y,p.z),quaternion:new Quaternion(q.x,q.y,q.z,q.w),scale:1});continue;
      }
      if(!dynamic){this.superHidden.add(id);continue;}
      this.release([id]);r.collider.setEnabled(true);this.superHidden.delete(id);
      const p=r.body.translation(),radial=new Vector3(p.x-event.point_m[0],p.y-event.point_m[1],p.z-event.point_m[2]).normalize();
      const direction=new Vector3(...unitDirection(event.direction));
      if(this.superPreset==='swing_wave_v1')direction.multiplyScalar(Math.min(10,Math.max(1.5,height*3))).add(new Vector3(0,0,height*.35));
      else if(this.superPreset==='crush_collapse_v1')direction.set(-radial.x*height*.3,-radial.y*height*.3,-Math.max(.1,height*.4));
      else{direction.multiplyScalar(4.5).add(radial.multiplyScalar(4));direction.z=Math.max(2.3,direction.z);}
      if(direction.length()>24)direction.setLength(24);
      r.body.setLinvel({x:direction.x,y:direction.y,z:direction.z},true);
      // Stable decorative spin; independent of the authoritative point/score.
      const seed=(feedbackSeed(event)^Math.imul(id+1,2654435761))>>>0;
      r.body.setAngvel({x:(seed%11)-5,y:((seed>>>4)%11)-5,z:((seed>>>8)%11)-5},true);
    }
    for(const [id,v] of this.superVisual){
      const t=Math.max(0,Math.min(1,(now-v.start)/820)),q=t*t*(3-2*t),angle=q*Math.PI*1.5;
      const delta=v.origin.clone().sub(new Vector3(...v.event.point_m)),x=delta.x,y=delta.y;
      delta.set((x*Math.cos(angle)-y*Math.sin(angle))*(1-q),(x*Math.sin(angle)+y*Math.cos(angle))*(1-q),delta.z*(1-q));
      v.position.copy(delta).add(new Vector3(...v.event.point_m));v.scale=1-q*.94;
      v.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle)).multiply(v.rotation);
      if(t>=1){this.superVisual.delete(id);this.superHidden.add(id);}
    }
  }
  stopSuper(){
    this.superQueue=[];this.superAt=null;this.superVisual.clear();
    for(const id of this.superRemoved){const r=this.records.get(id);if(!r)continue;
      r.body.setBodyType(RAPIER.RigidBodyType.Fixed,false);r.collider.setEnabled(false);this.dynamic.delete(id);this.superHidden.add(id);
    }
  }
  push(event){
    const r=this.records.get(event.fragment_id);
    if(!r||!this.dynamic.has(event.fragment_id)||this.appliedPushes.has(event.event_id))return;
    this.appliedPushes.add(event.event_id);
    if(this.appliedPushes.size>256)this.appliedPushes.delete(this.appliedPushes.values().next().value);
    const d=new Vector3(...event.direction).normalize(),mass=r.body.mass(),at=event.point_m;
    const strength=Number.isFinite(event.strength)?event.strength:3;
    // Camera ray points away from the clicked screen position: no artificial upward kick.
    r.body.applyImpulseAtPoint({x:d.x*strength*mass,y:d.y*strength*mass,z:d.z*strength*mass},
      {x:at[0],y:at[1],z:at[2]},true);
    const v=r.body.linvel(),speed=Math.hypot(v.x,v.y,v.z);
    if(speed>24)r.body.setLinvel({x:v.x*24/speed,y:v.y*24/speed,z:v.z*24/speed},true);
    const w=r.body.angvel(),spin=Math.hypot(w.x,w.y,w.z);
    if(spin>25)r.body.setAngvel({x:w.x*25/spin,y:w.y*25/spin,z:w.z*25/spin},true);
  }
  blast(event){
    if(!event?.blast||this.appliedBlasts.has(event.event_id))return;
    this.appliedBlasts.add(event.event_id);if(this.appliedBlasts.size>256)this.appliedBlasts.delete(this.appliedBlasts.values().next().value);
    const direction=new Vector3(...event.direction).normalize(),point=new Vector3(...event.point_m);
    for(const id of this.dynamic){const r=this.records.get(id),p=r.body.translation(),offset=new Vector3(p.x,p.y,p.z).sub(point),distance=offset.length();
      if(distance>event.blast_radius)continue;
      const strength=event.strength*(.65+.35*Math.max(0,1-distance/event.blast_radius));
      const impulse=direction.clone().multiplyScalar(strength).add(offset.clone().normalize().multiplyScalar(strength*.15));
      impulse.z=Math.max(impulse.z,strength*.35); // arcade lift so a horizontal swing can launch the building
      const mass=r.body.mass(),at=offset.clone().normalize().multiplyScalar(-.03).add(new Vector3(p.x,p.y,p.z));
      r.body.applyImpulseAtPoint({x:impulse.x*mass,y:impulse.y*mass,z:impulse.z*mass},{x:at.x,y:at.y,z:at.z},true);
      const v=r.body.linvel(),speed=Math.hypot(v.x,v.y,v.z),w=r.body.angvel(),spin=Math.hypot(w.x,w.y,w.z);
      if(speed>24)r.body.setLinvel({x:v.x*24/speed,y:v.y*24/speed,z:v.z*24/speed},true);
      if(spin>25)r.body.setAngvel({x:w.x*25/spin,y:w.y*25/spin,z:w.z*25/spin},true);
    }
  }
  setInteractionDistance(value){
    if(!Number.isFinite(value)||value<.05||value>5)throw new Error('invalid interaction distance');
    this.interactionDistance=value;
    for(const id of this.dynamic)this.records.get(id).body.wakeUp();
  }
  step(dt){
    if(!(dt>0))return;
    this.accumulator+=Math.min(dt,.1);
    if(dt>.1)this.droppedTime+=dt-.1;
    let count=0;
    while(this.accumulator>=1/60&&count<4){
      const start=performance.now();
      if(!this.options.sleep)for(const id of this.dynamic)this.records.get(id).body.wakeUp();
      for(const h of this.wrists.values())if(h.active){
        const p=h.body.translation(),d=new Vector3(h.target.x-p.x,h.target.y-p.y,h.target.z-p.z);
        // Limit tracked-hand displacement to 12cm per physics step (~7.2m/s).
        if(d.length()>.12)d.setLength(.12);
        h.body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});
      }
      // Hooks run while Rapier owns the world; cache poses BEFORE step to avoid WASM reentrancy.
      for(const id of this.dynamic)this.hookPositions.set(id,this.records.get(id).body.translation());
      this.world.step(this.queue,this.hooks);this.steps++;count++;this.accumulator-=1/60;
      this.times.push(performance.now()-start);if(this.times.length>240)this.times.shift();
      this.queue.drainContactForceEvents(e=>{
        const a=this.byCollider.get(e.collider1()),b=this.byCollider.get(e.collider2());
        if(a===undefined||b===undefined)return;
        if(this.dynamic.has(a)&&!this.dynamic.has(b))this.onImpact(b,e.totalForceMagnitude());
        if(this.dynamic.has(b)&&!this.dynamic.has(a))this.onImpact(a,e.totalForceMagnitude());
      });
    }
    if(this.accumulator>=1/60){this.droppedTime+=this.accumulator;this.accumulator=0;}
  }
  localTransform(id){
    const r=this.records.get(id),visual=this.superVisual.get(id),p=visual?.position??r.body.translation(),q=visual?.quaternion??r.body.rotation();
    const position=new Vector3(p.x-this.placement.x_m,p.y-this.placement.y_m,p.z).applyQuaternion(this.frameInverse).divideScalar(this.placement.scale);
    const quaternion=this.frameInverse.clone().multiply(new Quaternion(q.x,q.y,q.z,q.w));
    return {position,quaternion,scale:visual?.scale??1};
  }
  snapshot(){
    let sleeping=0,minZ=Infinity,finite=true;
    for(const v of this.superVisual.values())finite&&=[v.position.x,v.position.y,v.position.z,v.quaternion.x,v.quaternion.y,v.quaternion.z,v.quaternion.w,v.scale].every(Number.isFinite);
    for(const id of this.dynamic){const r=this.records.get(id),p=r.body.translation(),q=r.body.rotation();if(r.body.isSleeping())sleeping++;
      const qv=new Quaternion(q.x,q.y,q.z,q.w);
      for(let i=0;i<r.vertices.length;i+=3){const v=new Vector3(r.vertices[i],r.vertices[i+1],r.vertices[i+2]).applyQuaternion(qv);minZ=Math.min(minZ,p.z+v.z);}
      finite&&=[p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite);}
    const sorted=[...this.times].sort((a,b)=>a-b);
    return {dynamic:this.dynamic.size,superVisual:this.superVisual.size,superPreset:this.superPreset,superPending:this.superQueue.length,superHidden:this.superHidden.size,sleeping,awake:this.dynamic.size-sleeping,mousePushes:this.appliedPushes.size,
      handBodies:this.wrists.size,activeHands:[...this.wrists.values()].filter(h=>h.active).length,bodies:this.world.bodies.len(),colliders:this.world.colliders.len(),
      blasts:this.appliedBlasts.size,interactionDistance:this.interactionDistance,filteredPairs:this.filteredPairs,
      steps:this.steps,stepMeanMs:this.times.reduce((a,b)=>a+b,0)/(this.times.length||1),stepP95Ms:sorted[Math.floor(sorted.length*.95)]??0,
      droppedSeconds:this.droppedTime,minZ:Number.isFinite(minZ)?minZ:null,finite,options:{...this.options}};
  }
  dispose(){this.queue?.free();this.world?.free();this.world=null;}
}
