// Separate analytic compound schema; not accepted as legacy schema1.
const assert=(ok,message='invalid_analytic_contract')=>{if(!ok)throw new Error(message);};
assert.equal=(a,b)=>assert(Object.is(a,b));assert.deepEqual=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b));
export const SCHEMA='knu-analytic-compound-experimental-1.0';
const tuple=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
const rotation=q=>tuple(q,4)&&Math.abs(q.reduce((s,x)=>s+x*x,0)-1)<=1e-10;
export function validateCompoundMetadata(m){
 assert.equal(m.schema,SCHEMA);assert.equal(m.units,'m');assert.equal(m.coordinate_frame,'three_y_up');assert.equal(m.apply_additional_axis_rotation,false);assert.equal(m.origin,'bottom_center');assert.equal(m.scale_from_campus,0.03277537445925333);
 assert(tuple(m.dimensions_m,3)&&m.dimensions_m.every(x=>x>0));assert.equal(m.groups.length,64);assert.equal(m.children.length,164);assert.equal(m.counts.groups,64);assert.equal(m.counts.children,164);assert.equal(m.counts.analytic_boxes,164);assert.equal(m.counts.terrain_helpers,0);assert.equal(m.counts.maximum_children_per_group,13);assert.equal(m.limits.children_exact,164);assert.equal(m.limits.children_per_group_max,13);
 const groups=new Map(),children=new Map(),used=new Set(),renderNodes=new Set();
 for(const g of m.groups){assert(typeof g.id==='string'&&!groups.has(g.id));assert(typeof g.render_node==='string'&&g.render_node.length&&!renderNodes.has(g.render_node));renderNodes.add(g.render_node);assert(tuple(g.position_m,3)&&rotation(g.quaternion_xyzw));assert.deepEqual(g.quaternion_xyzw,[0,0,0,1]);assert(Array.isArray(g.children)&&g.children.length>0&&g.children.length<=13);groups.set(g.id,g);}
 for(const c of m.children){assert(typeof c.id==='string'&&!children.has(c.id));assert(groups.has(c.group_id));assert.equal(c.representation,'analytic_cuboid');assert(tuple(c.child_translation_m,3)&&rotation(c.child_quaternion_xyzw));assert(tuple(c.half_extents_m,3)&&c.half_extents_m.every(x=>x>0));assert(Number.isFinite(c.serialized_source_volume_m3)&&c.serialized_source_volume_m3>0);assert(Number.isFinite(c.ideal_volume_m3)&&c.ideal_volume_m3>0);assert(Array.isArray(c.source_bounds_uvw_m)&&c.source_bounds_uvw_m.length===2&&c.source_bounds_uvw_m.every(x=>tuple(x,3)));assert(c.source_bounds_uvw_m[0].every((v,k)=>v<c.source_bounds_uvw_m[1][k]));assert(c.source_vertex_words.length===24&&c.source_vertex_words.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=4294967295));assert(new Float32Array(new Uint32Array(c.source_vertex_words).buffer).every(Number.isFinite));assert(c.source_indices.length===36&&c.source_indices.every(x=>Number.isSafeInteger(x)&&x>=0&&x<8));assert(['core','feature','entrance'].includes(c.source_role));assert(typeof c.source_feature_id==='string'&&c.source_feature_id.length);children.set(c.id,c);}
 for(const g of m.groups)for(const id of g.children){assert(!used.has(id)&&children.get(id)?.group_id===g.id);used.add(id);}assert.equal(used.size,164);assert.equal(Math.max(...m.groups.map(g=>g.children.length)),13);
 return {groups,children};
}
export function descriptorForChild(R,c){const q=c.child_quaternion_xyzw;return R.ColliderDesc.cuboid(...c.half_extents_m).setTranslation(...c.child_translation_m).setRotation({x:q[0],y:q[1],z:q[2],w:q[3]}).setDensity(200).setFriction(.76).setRestitution(.08);}


export function validateAnalyticAppMetadata(meta,data){
 const maps=validateCompoundMetadata(data);
 assert.equal(meta.schema_version,'knu-analytic-app-1.0');assert.equal(meta.building_id,'knu-it1-analytic-164-v1');assert.equal(meta.profile,'it1-64g-164c-13max-v1');
 for(const k of['units','coordinate_frame','origin','scale_from_campus','apply_additional_axis_rotation'])assert.equal(meta[k],data[k]);
 assert.deepEqual(meta.dimensions_m,data.dimensions_m);assert.deepEqual(meta.assets,data.assets);assert.deepEqual(meta.source_asset_sha256,data.source_files);assert.equal(meta.fragment_count,64);assert.equal(meta.collider_count,164);assert.equal(meta.maximum_children_per_group,13);assert.equal(meta.terrain_helper_count,0);
 assert.deepEqual(meta.render_triangle_budget,{intact:28452,fragments:67688});assert.deepEqual(meta.gameplay,{density_kg_m3:200,gravity_m_s2:9.81,physics_timestep_s:1/60,impact_radius_m:.65});
 return maps;
}
// Canonical validation is read-only: inspect stored matrices before presentation.
// GLTFLoader 0.187.0 updates parsed scene matrices before returning them. Never repair
// stale/manual matrices here, even when an auto-update flag would later overwrite them.
const exactNumbers=(a,b)=>a.length===b.length&&a.every((x,i)=>Number.isFinite(x)&&x===b[i]);
const identityMatrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function assertCanonicalMatrices(root){
 assert(root&&root.parent===null,'canonical_root_must_be_unparented');
 assert(exactNumbers(root.position.toArray(),[0,0,0])&&exactNumbers(root.quaternion.toArray(),[0,0,0,1])&&exactNumbers(root.scale.toArray(),[1,1,1]),'canonical_root_trs_identity');
 assert(exactNumbers(root.matrix.elements,identityMatrix)&&exactNumbers(root.matrixWorld.elements,identityMatrix),'canonical_root_actual_matrix_identity');
 const visit=(node,parentMatrix)=>{
  assert(node.matrixAutoUpdate===true&&node.matrixWorldAutoUpdate===true,'canonical_automatic_updates_required:'+node.name);
  const local=node.matrix.clone().compose(node.position,node.quaternion,node.scale);
  assert(exactNumbers(node.matrix.elements,local.elements),'canonical_local_matrix_trs_mismatch:'+node.name);
  const world=parentMatrix?parentMatrix.clone().multiply(local):local;
  assert(exactNumbers(node.matrixWorld.elements,world.elements),'canonical_world_matrix_hierarchy_mismatch:'+node.name);
  for(const child of node.children){assert(child.parent===node,'canonical_parent_link');visit(child,world);}
 };visit(root,null);
}
function assertCanonicalOwnership(data,intact,fragments,colliderRoot){
 // These six intact branches and the one material-split branch are declared by
 // the hash-pinned intact asset, not arbitrary presentation ancestors.
 const intactBranches=new Map([
  ['IT_1호관',['IT_1호관002','IT_1호관002_1']],
  ['PhotoDetail_|_IT_1호관_|_PhotoDetail_aluminum',[]],
  ['PhotoDetail_|_IT_1호관_|_PhotoDetail_concrete',[]],
  ['PhotoDetail_|_IT_1호관_|_PhotoDetail_dark_glazing',[]],
  ['PhotoDetail_|_IT_1호관_|_PhotoDetail_pale_ceramic',[]],
  ['v7_|_창_근사_|_IT_1호관_468931895',[]],
 ]);
 assert.equal(intact.children.length,intactBranches.size);
 for(const n of intact.children){const names=intactBranches.get(n.name);assert(names,'undeclared_intact_ancestor');assert.equal(n.children.length,names.length);if(!names.length)assert(n.isMesh,'intact_primitive_required');else{assert(n.isGroup,'intact_material_branch_required');for(const c of n.children)assert(names.includes(c.name)&&c.isMesh&&c.children.length===0,'undeclared_intact_primitive_ancestor');}}
 assert.equal(fragments.children.length,data.groups.length);assert.equal(colliderRoot.children.length,data.groups.length);
 const declared=new Set(data.groups.map(g=>g.id));for(const root of[fragments,colliderRoot])for(const n of root.children)assert(declared.has(n.name),'undeclared_group_ancestor');
 for(const g of data.groups){const n=fragments.getObjectByName(g.id),render=fragments.getObjectByName(g.render_node),cn=colliderRoot.getObjectByName(g.id);assert(n?.parent===fragments&&cn?.parent===colliderRoot,'direct_canonical_group_ownership');assert(n.children.length===1&&render?.parent===n,'direct_render_node_ownership');if(render.isMesh)assert(render.children.length===0,'render_primitive_has_children');else{assert(render.isGroup&&render.children.length>0,'render_material_branch_required');for(const c of render.children)assert(c.isMesh&&c.children.length===0,'undeclared_render_primitive_ancestor');}assert.equal(cn.children.length,g.children.length);for(const c of cn.children)assert(g.children.includes(c.name)&&c.isMesh&&c.children.length===0,'undeclared_collider_ancestor');}
}

export function validateAnalyticAppModels(meta,data,intact,fragments,colliderRoot){
 const maps=validateAnalyticAppMetadata(meta,data),near=(a,b)=>a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<=1e-10),identity=n=>near(n.position.toArray(),[0,0,0])&&near(n.quaternion.toArray(),[0,0,0,1])&&near(n.scale.toArray(),[1,1,1]);
 for(const root of[intact,fragments,colliderRoot]){assertCanonicalMatrices(root);const names=new Set();root.traverse(n=>{if(n.name){assert(!names.has(n.name),'duplicate_model_node');names.add(n.name);}assert(n.userData?.campus_terrain_interface_only!==true,'terrain_helper_forbidden');assert(near(n.scale.toArray(),[1,1,1]),'nonunit_scale');});}
 assertCanonicalOwnership(data,intact,fragments,colliderRoot);
 const point=intact.position.clone(),lo=[Infinity,Infinity,Infinity],hi=lo.map(x=>-x);let intactTriangles=0,shardTriangles=0,ownedMeshes=0;
 intact.traverse(n=>{if(!n.isMesh)return;const p=n.geometry.attributes.position;intactTriangles+=(n.geometry.index?.count??p.count)/3;for(let i=0;i<p.count;i++){const v=point.fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld).toArray();v.forEach((x,k)=>{lo[k]=Math.min(lo[k],x);hi[k]=Math.max(hi[k],x);});}});
 assert(near(hi.map((x,i)=>x-lo[i]),meta.dimensions_m),'canonical_dimensions');assert.equal(intactTriangles,28452);
 for(const g of data.groups){const n=fragments.getObjectByName(g.id),mesh=fragments.getObjectByName(g.render_node),cn=colliderRoot.getObjectByName(g.id);assert(n&&cn&&mesh?.parent===n,'group_render_ownership');assert(near(n.position.toArray(),g.position_m)&&near(n.quaternion.toArray(),g.quaternion_xyzw));assert(near(cn.position.toArray(),g.position_m)&&near(cn.quaternion.toArray(),g.quaternion_xyzw));assert(identity(mesh));for(const id of g.children){const spec=maps.children.get(id),c=colliderRoot.getObjectByName(id);assert(c?.parent===cn&&c.isMesh,'child_ownership');assert(near(c.position.toArray(),spec.source_child_translation_m));assert(near(c.quaternion.toArray(),spec.source_child_quaternion_xyzw));const pos=c.geometry.attributes.position;assert.equal(pos.count,8);const words=Array.from(new Uint32Array(pos.array.buffer,pos.array.byteOffset,pos.array.length));assert.deepEqual(words,spec.source_vertex_words);assert.deepEqual(Array.from(c.geometry.index.array),spec.source_indices);}}
 fragments.traverse(n=>{if(!n.isMesh)return;let owner=n;while(owner&&!maps.groups.has(owner.name))owner=owner.parent;assert(owner,'unowned_render_mesh');const declared=fragments.getObjectByName(maps.groups.get(owner.name).render_node);let branch=n;while(branch&&branch!==declared)branch=branch.parent;assert(branch===declared,'render_outside_declared_subtree');assert(identity(n));ownedMeshes++;shardTriangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});assert.equal(ownedMeshes,338);assert.equal(shardTriangles,67688);
 let colliderMeshes=0;colliderRoot.traverse(n=>{if(n.isMesh){assert(maps.children.has(n.name),'extra_collider_mesh');colliderMeshes++;}});assert.equal(colliderMeshes,164);
}
