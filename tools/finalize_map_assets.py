"""Finalize v13, QA the six edited solids, export and round-trip their bounds."""
import bpy,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT,REPORTS,write,qa_check
from enhance_buildings import bounds,export,wire_review
OUT=REPORTS/'map-review'
records=json.loads((OUT/'v13-model-qa.json').read_text(encoding='utf-8'))
expected={}
for row in records:
    obj=next(o for o in bpy.context.scene.objects if str(o.get('osm_way',''))==row['osm_id'])
    if row['key'] in ('library','it2'):
        limit=row['before_group_bounds'][1][2]
        # Correct the first union's 2 cm overlap extension on the exposed cap.
        for vertex in obj.data.vertices:
            if vertex.co.z>limit:vertex.co.z=limit
        obj.data.update()
    row['geometry']=qa_check.run(objects=[obj.name],profile='print',uv=False)
    row['visual']=qa_check.run(objects=[obj.name],profile='game',uv=True)
    row['after_bounds']=[list(p) for p in bounds(obj)]
    assert row['geometry']['pass'] and row['visual']['pass'],row['key']
    assert row['after_bounds'][1][2]<=row['before_group_bounds'][1][2]+.001,(row['key'],'height envelope')
    expected[row['osm_id']]=row['after_bounds']
write(OUT/'v13-model-qa.json',records)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v13.blend'),compress=True)
glb=ROOT/'web/public/assets/campus/knu-campus-v13.glb'
export(glb,[o for o in bpy.context.scene.objects if o.type=='MESH'])
for row in records:
    obj=next(o for o in bpy.context.scene.objects if str(o.get('osm_way',''))==row['osm_id'])
    lo,hi=bounds(obj)
    wire_review([obj],OUT/(row['key']+'-after-wire.png'),max(hi-lo)*.0008)
check=bpy.data.scenes.new('v13_RoundTrip');bpy.context.window.scene=check
bpy.ops.import_scene.gltf(filepath=str(glb));bpy.context.view_layer.update()
cores=[o for o in check.objects if 'osm_way' in o or str(o.get('source_id','')).startswith('vw/')]
assert len(cores)==123,len(cores)
rows=[]
for identity,before in expected.items():
    obj=next(o for o in cores if str(o.get('osm_way',''))==identity)
    after=[list(p) for p in bounds(obj)]
    error=max(abs(a-b) for p,q in zip(before,after) for a,b in zip(p,q))
    assert error<.0002,(identity,error)
    rows.append({'osm_id':identity,'max_bound_error_m':error,'bounds':after})
write(OUT/'v13-roundtrip.json',{'cores':len(cores),'objects':rows,'errors':0,'glb_sha256':hashlib.sha256(glb.read_bytes()).hexdigest()})
print('@@JSON@@'+json.dumps({'refined':len(records),'cores':len(cores),'errors':0,'roundtrip_max_m':max(r['max_bound_error_m'] for r in rows)}))
