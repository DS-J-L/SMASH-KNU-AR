import {validateAnalyticAppMetadata,validateAnalyticAppModels} from './analytic-compound-contract.js';
const tolerance = 1e-5;
const identity = [0,0,0,1];
const isTuple = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const near = (a,b) => a.length === b.length && a.every((value,i) => Math.abs(value-b[i]) <= tolerance);

function requireValue(condition, message) {
  if (!condition) throw new Error(`패키지 불일치: ${message}`);
}

function validateLegacyPackageMetadata(manifest, colliders) {
  requireValue(manifest?.schema_version === '1.0' && colliders?.schema_version === '1.0', '지원하지 않는 버전');
  requireValue(manifest.units === 'm' && colliders.units === 'm', 'm 단위가 필요합니다');
  requireValue(manifest.coordinate_frame === 'three_y_up' && colliders.coordinate_frame === 'three_y_up', 'Y-up 좌표가 필요합니다');
  requireValue(manifest.apply_additional_axis_rotation === false, '축 변환을 이미 적용한 모델이 필요합니다');
  requireValue(Number.isInteger(manifest.fragment_count) && manifest.fragment_count > 0 && manifest.fragment_count <= 128, '파편 수 범위');
  requireValue(isTuple(manifest.dimensions_m,3) && manifest.dimensions_m.every(v=>v>0), '건물 크기');
  requireValue(typeof manifest.assets?.intact === 'string' && typeof manifest.assets?.fragments === 'string', '모델 경로');
  requireValue(Array.isArray(colliders.fragments) && colliders.fragments.length === manifest.fragment_count, '파편 수와 충돌체 수가 다릅니다');
  const ids = new Set(), nodes = new Set();
  for (const item of colliders.fragments) {
    requireValue(Number.isInteger(item.fragment_id) && !ids.has(item.fragment_id), '파편 ID 중복 또는 누락');
    requireValue(typeof item.node === 'string' && item.node.length > 0 && !nodes.has(item.node), '파편 노드 중복 또는 누락');
    ids.add(item.fragment_id);nodes.add(item.node);
    requireValue(item.type === 'convex_hull', `${item.node} 충돌체 종류`);
    requireValue(isTuple(item.rest_position_m,3), `${item.node} 복원 위치`);
    requireValue(isTuple(item.rest_quaternion_xyzw,4) && near(item.rest_quaternion_xyzw,identity), `${item.node} 회전은 모델에 적용해야 합니다`);
    requireValue(Array.isArray(item.vertices_m) && item.vertices_m.length >= 12 && item.vertices_m.length <= 64*3 && item.vertices_m.length%3 === 0 && item.vertices_m.every(Number.isFinite), `${item.node} 충돌체 정점`);
    requireValue(Number.isFinite(item.density_kg_m3) && item.density_kg_m3 > 0 && Number.isFinite(item.friction) && item.friction >= 0 && Number.isFinite(item.restitution) && item.restitution >= 0 && item.restitution <= 1, `${item.node} 물리 설정`);
  }
}

function renderedBounds(root, origin=[0,0,0]) {
  const low=[Infinity,Infinity,Infinity], high=[-Infinity,-Infinity,-Infinity];
  const point=root.position.clone();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions=mesh.geometry.getAttribute('position');
    for (let i=0;i<positions.count;i++) {
      const p=point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray();
      p.forEach((value,axis)=>{low[axis]=Math.min(low[axis],value-origin[axis]);high[axis]=Math.max(high[axis],value-origin[axis]);});
    }
  });
  return [low,high];
}

function validateLegacyPackageModels(manifest, colliders, intact, fragments) {
  intact.updateWorldMatrix(true,true);fragments.updateWorldMatrix(true,true);
  const bounds=renderedBounds(intact);
  requireValue(near(bounds[1].map((v,i)=>v-bounds[0][i]),manifest.dimensions_m), '정상 모델 크기와 manifest가 다릅니다');
  for (const item of colliders.fragments) {
    const node=fragments.getObjectByName(item.node);
    requireValue(Boolean(node), `파편 노드 없음: ${item.node}`);
    const position=node.getWorldPosition(node.position.clone()).toArray();
    requireValue(near(position,item.rest_position_m) && near(node.position.toArray(),item.rest_position_m), `${item.node} 피벗/복원 위치`);
    requireValue(near(node.getWorldQuaternion(node.quaternion.clone()).toArray(),identity) && near(node.scale.toArray(),[1,1,1]), `${item.node} 회전/배율`);
    const visual=renderedBounds(node,position);
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    item.vertices_m.forEach((v,i)=>{const axis=i%3;low[axis]=Math.min(low[axis],v);high[axis]=Math.max(high[axis],v);});
    requireValue(near(visual[0],low) && near(visual[1],high), `${item.node} 렌더 메시와 충돌체 크기`);
  }
}

export function validatePackageMetadata(meta,data){if(meta?.schema_version==='knu-analytic-app-1.0')return validateAnalyticAppMetadata(meta,data);return validateLegacyPackageMetadata(meta,data);}
export function validatePackageModels(meta,data,intact,fragments,colliderRoot){if(meta?.schema_version==='knu-analytic-app-1.0')return validateAnalyticAppModels(meta,data,intact,fragments,colliderRoot);return validateLegacyPackageModels(meta,data,intact,fragments);}
