"""Identical per-building camera framing for v12/v13 visual comparison."""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import review_shots,REPORTS
stage='after' if bpy.data.filepath.endswith('v13.blend') else 'before'
out=REPORTS/'map-review';out.mkdir(exist_ok=True)
words={'global':'글로벌플라자','library':'중앙도서관','auditorium':'대강당','museum':'박물관','gym2':'제2체육관','it2':'IT 2호관'}
if '--' in sys.argv:
    keys=sys.argv[sys.argv.index('--')+1:]
    if keys:words={k:v for k,v in words.items() if k in keys}
for key,word in words.items():
    obs=[o for o in bpy.context.scene.objects if o.type=='MESH' and word in o.name]
    if not obs:continue
    review_shots.run(objects=[o.name for o in obs],out=str(out/(key+'-'+stage+'.png')),
        views=['three_quarter','top','front','right'],mode='material',res=600)
    print('@@JSON@@'+json.dumps({'key':key,'stage':stage,'objects':len(obs)}))
