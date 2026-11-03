"""Read-only fresh QA of the final campus source and contact geometry."""
import bpy
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT,REPORTS,qa_check,write

scene=bpy.context.scene
terrain=bpy.data.objects['SM_CampusTerrain_v11']
bvh=BVHTree.FromPolygons([terrain.matrix_world@v.co for v in terrain.data.vertices],
                        [list(f.vertices) for f in terrain.data.polygons])
def height(x,y):
    point,_,_,_=bvh.ray_cast(Vector((x,y,100)),Vector((0,0,-1)),500)
    return point.z if point is not None else None

selected=[terrain]
buildings=[]
for obj in scene.objects:
    if obj.type!='MESH':continue
    if 'osm_way' in obj or str(obj.get('source_id','')).startswith('vw/'):
        selected.append(obj);buildings.append(obj)
    elif obj.name.startswith(('road_','green','water','pitch')):selected.append(obj)
errors=[];warnings=Counter();triangle_count=0
for index,obj in enumerate(selected):
    qa=qa_check.run(objects=[obj.name],profile='game',uv=False)
    errors.extend({'object':obj.name,'error':message} for message in qa['errors'])
    triangle_count+=sum(m['tris'] for m in qa['objects'].values())
    for message in qa['warnings']:
        warnings['relative_ground' if 'lowest point' in message else 'ngons' if 'n-gons' in message else message]+=1
    if index%250==0:write(REPORTS/'retest-campus-progress.json',{'checked':index+1,'total':len(selected)})

contacts=[]
for obj in buildings:
    if 'v13_foundation_vertices_json' in obj:
        # Stepped roofs/canopies also have downward faces. Check the retained
        # actual foundation vertices instead of treating all undersides as ground.
        points=[Vector(p) for p in json.loads(obj['v13_foundation_vertices_json'])]
        actual=[obj.matrix_world@v.co for v in obj.data.vertices]
        for point in points:
            if min((point-p).length for p in actual)>.0002:errors.append({'object':obj.name,'error':'Original foundation vertex missing'})
    else:
        indices={i for face in obj.data.polygons if face.normal.z<-.2 for i in face.vertices}
        points=[obj.matrix_world@obj.data.vertices[i].co for i in indices]
    gaps=[]
    for point in points:
        z=height(point.x,point.y)
        if z is None:errors.append({'object':obj.name,'error':'Building contact outside terrain'});continue
        gaps.append(point.z-z)
    maximum=max((abs(gap+.03) for gap in gaps),default=float('inf'))
    contacts.append({'object':obj.name,'vertices':len(gaps),'max_contact_error_m':maximum})
    if maximum>.003:errors.append({'object':obj.name,'error':f'Building contact error {maximum} m'})

trunks=bpy.data.objects['v9 | 수목 | 줄기']
tree_contacts=[]
for index in range(len(trunks.data.vertices)//16):
    points=[trunks.matrix_world@v.co for v in list(trunks.data.vertices)[16*index:16*(index+1)]]
    center=sum(points,Vector())/16;z=height(center.x,center.y)
    gap=min(p.z for p in points)-z if z is not None else float('inf')
    tree_contacts.append({'index':index,'base_gap_m':gap})
    if abs(gap+.015)>.003:errors.append({'object':f'tree {index}','error':f'Tree contact gap {gap}'})

source_file=Path(bpy.data.filepath)
files={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in
       [source_file,ROOT/'web/public/assets/campus'/(source_file.stem+'.glb')]}
report={'checked_at_utc':datetime.now(timezone.utc).isoformat(),'source_sha256':files,
        'mesh_count':len(selected),'building_count':len(buildings),'triangles_checked':triangle_count,
        'errors':errors,'warning_counts':dict(warnings),'building_contacts':contacts,'tree_contacts':tree_contacts}
write(REPORTS/('map-review/v13-campus-audit.json' if source_file.stem.endswith('v13') else 'enhancement/campus-v12-audit.json' if source_file.stem.endswith('v12') else 'retest-campus.json'),report)
assert not errors,errors[:10]
print('@@JSON@@'+json.dumps({'checked_meshes':len(selected),'buildings':len(buildings),
                            'tree_contacts':len(tree_contacts),'errors':0,'triangles':triangle_count}))
