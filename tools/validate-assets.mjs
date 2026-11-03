import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import { validatePackageMetadata } from '../frontend/fracture/package-contract.js';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const packageDir = 'web/public/assets/buildings/knu-it1-v1';
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const manifest = await read(`${packageDir}/manifest.json`);
const colliders = await read(`${packageDir}/colliders.json`);
validatePackageMetadata(manifest,colliders);
assert.equal(manifest.fragment_count, 32);
assert.equal(colliders.fragments.length, 32);
assert.equal(colliders.coordinate_frame, 'three_y_up');
assert.equal(manifest.apply_additional_axis_rotation, false);
const reports = [];
for (const file of [`${packageDir}/intact.glb`, `${packageDir}/fragments.glb`, 'web/public/assets/campus/knu-campus-v11.glb']) {
  const bytes = await fs.readFile(file);
  const result = await validator.validateBytes(new Uint8Array(bytes), {uri: path.basename(file)});
  reports.push({ file, bytes: bytes.length, issues: result.issues, info: result.info });
  assert.equal(result.issues.numErrors, 0, `${file}: ${JSON.stringify(result.issues.messages)}`);
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8',20,20+jsonSize));
  if (file.endsWith('/intact.glb')) {
    const bounds = new Box3();
    const visit = (index,parent=new Matrix4()) => {
      const node = gltf.nodes[index];
      const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
        new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1])));
      const world = parent.clone().multiply(local);
      for (const primitive of node.mesh === undefined ? [] : gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        bounds.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world));
      }
      for (const child of node.children??[]) visit(child,world);
    };
    for (const node of gltf.scenes[gltf.scene??0].nodes) visit(node);
    const dimensions = bounds.getSize(new Vector3()).toArray();
    dimensions.forEach((value,i)=>assert(Math.abs(value-manifest.dimensions_m[i])<1e-5,'Manifest dimensions must match the scaled GLB'));
  }
  if (file.endsWith('/fragments.glb')) {
    for (const collider of colliders.fragments) {
      assert(collider.vertices_m.length >= 12 && collider.vertices_m.length % 3 === 0);
      assert(collider.vertices_m.length / 3 <= 64, `Collider budget: ${collider.node}`);
      assert(collider.vertices_m.every(Number.isFinite));
      const node = gltf.nodes.find(n => n.name === collider.node);
      assert(node, `GLB node ${collider.node} missing`);
      const translation = node.translation ?? [0,0,0];
      translation.forEach((p,i) => assert(Math.abs(p-collider.rest_position_m[i]) < 1e-5, `Axis/pivot mismatch ${collider.node}`));
      assert(collider.volume_m3 > 0);
    }
  }
}
const fractureQA = await read('docs/asset-validation/fracture-it1.json');
assert.equal(fractureQA.errors.length,0);
assert(fractureQA.volume_relative_error < .0001);
const terrainQA = await read('docs/asset-validation/terrain-v11.json');
assert.equal(terrainQA.qa_errors.length,0,JSON.stringify(terrainQA.qa_errors.slice(0,5)));
const uvQA = await read('docs/asset-validation/fracture-uv.json');
assert.equal(uvQA.errors.length,0);
assert.equal(Object.keys(uvQA.objects).length,33);
const treeQA = await read('docs/asset-validation/tree-contacts.json');
assert.equal(treeQA.errors,0); assert.equal(treeQA.count,170);
const campusRoundTrip = await read('docs/asset-validation/campus-roundtrip.json');
assert.equal(campusRoundTrip.building_count,123);
assert(campusRoundTrip.max_bound_error_m < .0005);
await fs.writeFile('docs/asset-validation/gltf-validation.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(r=>({file:r.file,bytes:r.bytes,errors:r.issues.numErrors,warnings:r.issues.numWarnings})),null,2));
