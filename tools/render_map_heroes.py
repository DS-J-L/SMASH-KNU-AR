"""Neutral Cycles presentations of the reviewed models, with their real UVs."""
import bpy,sys,json
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from enhance_buildings import lookdev,bounds
from build_campus_assets import REPORTS
source=bpy.context.scene
for identity,key in [('468931850','global'),('468931852','library'),('468931876','it2')]:
    if '--' in sys.argv and sys.argv[sys.argv.index('--')+1:] and key not in sys.argv[sys.argv.index('--')+1:]:continue
    original=next(o for o in source.objects if str(o.get('osm_way',''))==identity)
    lo,hi=bounds(original);origin=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    scale=2.8/max(hi.x-lo.x,hi.y-lo.y)
    scene=bpy.data.scenes.new('Review_'+key);bpy.context.window.scene=scene
    mesh=original.data.copy();mesh.transform(original.matrix_world)
    for v in mesh.vertices:v.co=(v.co-origin)*scale
    obj=bpy.data.objects.new('Review_'+key,mesh);scene.collection.objects.link(obj)
    lookdev([obj],REPORTS/'map-review'/(key+'-hero.png'))
    bpy.context.window.scene=source;bpy.data.scenes.remove(scene)
    print('@@JSON@@'+json.dumps({'rendered':key}))
