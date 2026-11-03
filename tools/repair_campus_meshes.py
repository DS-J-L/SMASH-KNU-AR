"""Repair narrow CDT boundary slivers and two existing overlapping green meshes."""
import bmesh
import bpy
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import clean, export, preview, qa_check, review_shots, terrain_wire_review, ROOT, REPORTS, write

report=json.loads((REPORTS/'terrain-v11.json').read_text(encoding='utf-8'))
details=[]
for name in ['SM_CampusTerrain_v11','green.005','green.013']:
    obj=bpy.data.objects[name]
    bm=bmesh.new();bm.from_mesh(obj.data)
    before={'vertices':len(bm.verts),'faces':len(bm.faces)}
    if name=='SM_CampusTerrain_v11':
        # The campus is an open static terrain surface, not a printable solid.
        # Remove the redundant flat underside and overlapping outer side strips.
        # The displayed top triangles and all sampled elevations stay unchanged.
        bottom=min(v.co.z for v in bm.verts)
        has_flat_underside=sum(abs(v.co.z-bottom)<1e-4 for v in bm.verts)>len(bm.verts)/4
        shell=[f for f in bm.faces if any(v.co.z<bottom+.1 for v in f.verts)] if has_flat_underside else []
        bmesh.ops.delete(bm,geom=shell,context='FACES_ONLY')
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.001)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.001)
    degenerate=[f for f in bm.faces if f.calc_area()<1e-9]
    bmesh.ops.delete(bm,geom=degenerate,context='FACES_ONLY')
    # Remove exact duplicate triangles, keeping one face per topological set.
    seen=set();duplicate=[]
    for face in bm.faces:
        key=frozenset(face.verts)
        if key in seen:duplicate.append(face)
        seen.add(key)
    bmesh.ops.delete(bm,geom=duplicate,context='FACES_ONLY')
    # In a surface-only green cover, an extra overlapping flap is redundant.
    removed=[]
    if name.startswith('green'):
        for edge in list(bm.edges):
            if edge.is_valid and len(edge.link_faces)>2:
                face=min(edge.link_faces,key=lambda f:f.calc_area())
                removed.append(face.calc_area());bmesh.ops.delete(bm,geom=[face],context='FACES_ONLY')
    wire=[e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm,geom=wire,context='EDGES')
    loose=[v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    if name=='SM_CampusTerrain_v11':
        issues=[]
        for edge in bm.edges:
            if len(edge.link_faces)>2 or (len(edge.link_faces)==2 and not edge.is_contiguous):
                issues.append({'edge':[list(v.co) for v in edge.verts],
                               'faces':[[list(v.co) for v in f.verts] for f in edge.link_faces]})
        write(REPORTS/'terrain-bad-edges.json',issues)
    after={'vertices':len(bm.verts),'faces':len(bm.faces)}
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    qa=qa_check.run(objects=[name],profile='game',uv=False)
    details.append({'name':name,'before':before,'after':after,'overlap_flap_area_removed_m2':removed,'qa':qa})
write(REPORTS/'terrain-repair.json',details)
report['qa_errors']=[e for e in report['qa_errors'] if e['object'] not in [d['name'] for d in details]]
report['qa_errors'].extend({'object':d['name'],'error':e} for d in details for e in d['qa']['errors'])
report['repair_report']='terrain-repair.json'
report['qa_warning_counts']={k:v for k,v in report['qa_warning_counts'].items()
    if not any(k.startswith(d['name']+':') for d in details)}
for d in details:
    for warning in d['qa']['warnings']:
        if 'lowest point' not in warning:
            report['qa_warning_counts'][warning]=report['qa_warning_counts'].get(warning,0)+1
report['terrain_top_vertices']=details[0]['after']['vertices']
report['terrain_final_triangle_count']=next(iter(details[0]['qa']['objects'].values()))['tris']
write(REPORTS/'terrain-v11.json',report)
assert not report['qa_errors'],report['qa_errors']
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v11.blend'),compress=True)
export(ROOT/'web/public/assets/campus/knu-campus-v11.glb')
preview('campus-v11.png',(0,0,-2),(1150,-1500,1200),1550)
preview('terrain-sports-v11.png',(-410,-255,-7),(-330,-500,160),360)
preview('terrain-building-v11.png',(220,-315,0),(310,-440,80),160)
terrain=bpy.data.objects['SM_CampusTerrain_v11']
review_shots.run(objects=[terrain.name],out=str(REPORTS/'terrain-material.png'),mode='material',res=512)
terrain_wire_review(terrain)
print('@@JSON@@'+json.dumps({'stage':'repair','errors':len(report['qa_errors']),'details':[{k:v for k,v in d.items() if k!='qa'} for d in details]}))
