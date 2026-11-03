import * as THREE from 'three';

function clip(vertices, distance) {
  const out = [];
  for (let i=0; i<vertices.length; i++) {
    const a=vertices[i], b=vertices[(i+1)%vertices.length], da=distance(a), db=distance(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da/(da-db)));
  }
  return out;
}
function inside(p, a, b, c) {
  const cross=(x,y,z)=>(y[0]-x[0])*(z[1]-x[1])-(y[1]-x[1])*(z[0]-x[0]);
  const d=[cross(a,b,p),cross(b,c,p),cross(c,a,p)];
  return !(d.some(x=>x < -1e-9) && d.some(x=>x > 1e-9));
}

// Union of projected intact triangles preserves gaps. Fragments are never registered here.
export class TargetProvider {
  constructor(buildingId) { this.buildingId=buildingId; this.triangles=[]; this.active=true; this.version=0; }
  update(root, camera, transform, version) {
    this.triangles=[]; this.version=version;
    root.updateWorldMatrix(true,true); camera.updateMatrixWorld();
    const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const planes=[v=>v.w+v.x,v=>v.w-v.x,v=>v.w+v.y,v=>v.w-v.y,v=>v.w+v.z,v=>v.w-v.z];
    root.traverse(mesh=>{
      if (!mesh.isMesh || !mesh.visible) return;
      const pos=mesh.geometry.getAttribute('position'), index=mesh.geometry.index;
      const matrix=new THREE.Matrix4().multiplyMatrices(vp,mesh.matrixWorld);
      for (let i=0; i<(index?.count??pos.count); i+=3) {
        let poly=[0,1,2].map(j=>new THREE.Vector4().fromArray([pos.getX(index?index.getX(i+j):i+j),pos.getY(index?index.getX(i+j):i+j),pos.getZ(index?index.getX(i+j):i+j),1]).applyMatrix4(matrix));
        for (const plane of planes) poly=clip(poly,plane);
        let image=poly.filter(v=>v.w>0).map(v=>new THREE.Vector2(...transform.toImage([(v.x/v.w+1)*transform.width/2,(1-v.y/v.w)*transform.height/2])));
        for (const plane of [v=>v.x,v=>1-v.x,v=>v.y,v=>1-v.y]) image=clip(image,plane);
        for (let j=1; j+1<image.length; j++) {
          const tri=[image[0],image[j],image[j+1]].map(v=>v.toArray());
          const [a,b,c]=tri;
          if (Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-12) this.triangles.push(tri);
        }
      }
    });
    return this.snapshot();
  }
  contains(point) { return this.active && Array.isArray(point) && point.length===2 && point.every(v=>Number.isFinite(v)&&v>=0&&v<=1) && this.triangles.some(t=>inside(point,...t)); }
  snapshot() { return { building_id:this.buildingId, transform_version:this.version, active:this.active, triangles:this.triangles }; }
}
