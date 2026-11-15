import * as THREE from 'three';

export const PERSON_BONES=[['left_shoulder','right_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
  ['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['left_shoulder','left_hip'],['right_shoulder','right_hip'],
  ['left_hip','right_hip'],['left_hip','left_knee'],['left_knee','left_ankle'],['right_hip','right_knee'],['right_knee','right_ankle']];
const Y=new THREE.Vector3(0,1,0);
const position=j=>{const p=j?.p;return Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=100)?new THREE.Vector3(...p):null;};

// A marker-space person illustration from measured joints, never extrapolated missing joints.
export class TrackedPerson {
  constructor(scene){
    this.root=new THREE.Group();this.root.name='TRACKED_PERSON';scene.add(this.root);
    this.material=new THREE.MeshStandardMaterial({color:0x60a5fa,roughness:.85});
    this.skin=new THREE.MeshStandardMaterial({color:0xfed7aa,roughness:.9});
    this.geometry=new THREE.CylinderGeometry(1,1,1,10);
    this.limbs=PERSON_BONES.map((_,i)=>{const mesh=new THREE.Mesh(this.geometry,this.material);mesh.visible=false;this.root.add(mesh);return mesh;});
    this.head=new THREE.Mesh(new THREE.SphereGeometry(.09,16,12),this.skin);this.root.add(this.head);
    this.neck=new THREE.Mesh(this.geometry,this.skin);this.root.add(this.neck);
    this.torso=new THREE.Mesh(new THREE.CylinderGeometry(1,.85,1,12),this.material);this.root.add(this.torso);
    this.root.visible=false;this.count=0;
  }
  segment(mesh,a,b,radius){
    mesh.visible=!!a&&!!b&&a.distanceTo(b)>.005;if(!mesh.visible)return;
    const delta=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(Y,delta.clone().normalize());mesh.scale.set(radius,delta.length(),radius);
  }
  update(joints,active){
    const points=Object.fromEntries(Object.entries(joints??{}).map(([n,j])=>[n,position(j)]));
    this.count=active?Object.values(points).filter(Boolean).length:0;this.root.visible=active&&this.count>0;
    PERSON_BONES.forEach(([a,b],i)=>this.segment(this.limbs[i],active?points[a]:null,active?points[b]:null,(a.includes('hip')||a.includes('knee'))?.045:.03));
    this.head.visible=active&&!!points.nose;if(this.head.visible)this.head.position.copy(points.nose);
    const ls=points.left_shoulder,rs=points.right_shoulder,lh=points.left_hip,rh=points.right_hip;
    this.segment(this.neck,active&&ls&&rs?ls.clone().add(rs).multiplyScalar(.5):null,active?points.nose:null,.035);
    this.segment(this.torso,active&&lh&&rh?lh.clone().add(rh).multiplyScalar(.5):null,active&&ls&&rs?ls.clone().add(rs).multiplyScalar(.5):null,ls&&rs?ls.distanceTo(rs)*.43:.1);
  }
  snapshot(){return {visible:this.root.visible,joints:this.count,bones:this.limbs.filter(m=>m.visible).length,torso:this.torso.visible,head:this.head.visible};}
  dispose(){this.root.removeFromParent();this.geometry.dispose();this.head.geometry.dispose();this.torso.geometry.dispose();this.material.dispose();this.skin.dispose();}
}
