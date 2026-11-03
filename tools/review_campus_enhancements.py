"""Multi-angle review of the v12 building cores, without modifying the source."""
import bpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import review_shots,REPORTS
names=[o.name for o in bpy.context.scene.objects if o.type=='MESH' and
    ('osm_way' in o or str(o.get('source_id','')).startswith('vw/'))]
assert len(names)==123
result=review_shots.run(objects=names,out=str(REPORTS/'enhancement/campus-v12-building-angles.png'),
    mode='material',views=['top','three_quarter','front','right'],res=800)
print('@@JSON@@'+__import__('json').dumps(result))
