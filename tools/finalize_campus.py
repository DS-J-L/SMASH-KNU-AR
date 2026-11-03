"""Match tree bases to the improved ground and verify the complete campus GLB."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT,REPORTS,qa_check,export,preview,write,mesh_object

scene=bpy.context.scene
terrain=bpy.data.objects['SM_CampusTerrain_v11']
terrain['surface_only']=True
bvh=BVHTree.FromPolygons([v.co for v in terrain.data.vertices],[list(f.vertices) for f in terrain.data.polygons])
trunks=bpy.data.objects['v9 | 수목 | 줄기'];crowns=bpy.data.objects['v9 | 수목 | 수관']
assert len(trunks.data.vertices)//16==170 and len(crowns.data.vertices)//12==170
trees=[]
for index in range(170):
    trunk=list(trunks.data.vertices)[index*16:(index+1)*16]
    center=sum((v.co for v in trunk),Vector())/16
    hit,_,_,_=bvh.ray_cast(Vector((center.x,center.y,100)),Vector((0,0,-1)),500)
    assert hit is not None, index
    old=min(v.co.z for v in trunk);delta=hit.z-.015-old
    qa_objects=[]
    for obj,count in [(trunks,16),(crowns,12)]:
        start=index*count;end=start+count
        for v in list(obj.data.vertices)[start:end]:v.co.z+=delta
        faces=[tuple(v-start for v in f.vertices) for f in obj.data.polygons if all(start<=v<end for v in f.vertices)]
        temp=mesh_object(f'QA_Tree_{index}_{count}',[tuple(v.co) for v in list(obj.data.vertices)[start:end]],faces)
        for mat in obj.data.materials:temp.data.materials.append(mat)
        qa_objects.append(temp)
    r=qa_check.run(objects=[o.name for o in qa_objects],profile='game',uv=False)
    trees.append({'index':index,'old_base_m':old,'ground_m':hit.z,'delta_m':delta,'qa_errors':r['errors']})
    for obj in qa_objects:
        mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
for obj in (trunks,crowns):obj.data.update()
assert not any(t['qa_errors'] for t in trees)
scene['v11_tree_contacts']='170 tree bases at improved rendered terrain minus 0.015m; no new survey.'
write(REPORTS/'tree-contacts.json',{'trees':trees,'errors':0,'count':170,'max_shift_m':max(abs(t['delta_m']) for t in trees)})

def buildings(sc):
    result={}
    for obj in sc.objects:
        if obj.type=='MESH' and ('osm_way' in obj or str(obj.get('source_id','')).startswith('vw/')):
            p=[obj.matrix_world@Vector(v) for v in obj.bound_box]
            key=str(obj.get('osm_way',obj.get('source_id')))
            result[key]=[[min(v[i] for v in p) for i in range(3)],[max(v[i] for v in p) for i in range(3)]]
    return result

bpy.context.view_layer.update();expected=buildings(scene)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v11.blend'),compress=True)
export(ROOT/'web/public/assets/campus/knu-campus-v11.glb')
preview('campus-v11.png',(0,0,-2),(1150,-1500,1200),1550)
preview('terrain-sports-v11.png',(-410,-255,-7),(-330,-500,160),360)
preview('terrain-building-v11.png',(220,-315,0),(310,-440,80),160)
check=bpy.data.scenes.new('CampusRoundTrip');bpy.context.window.scene=check
bpy.ops.import_scene.gltf(filepath=str(ROOT/'web/public/assets/campus/knu-campus-v11.glb'))
bpy.context.view_layer.update();actual=buildings(check)
assert len(expected)==len(actual)==123,(len(expected),len(actual))
assert expected.keys()==actual.keys()
max_error=max(abs(a-b) for key in expected for aa,bb in zip(expected[key],actual[key]) for a,b in zip(aa,bb))
assert max_error<.0005,max_error
write(REPORTS/'campus-roundtrip.json',{'building_count':len(actual),'max_bound_error_m':max_error,
                                     'trees':170,'mesh_count':sum(o.type=='MESH' for o in check.objects)})
print('@@JSON@@'+json.dumps({'tree_count':170,'tree_qa_errors':0,'max_tree_shift_m':max(abs(t['delta_m']) for t in trees),
                            'roundtrip_buildings':len(actual),'max_bound_error_m':max_error}))
