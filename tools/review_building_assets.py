"""Re-export a saved enhancement source and refresh readable topology sheets."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from enhance_buildings import ROOT,OUT,export,wire_review,write

body=next(o for o in bpy.context.scene.objects if o.name.endswith('_Intact'))
fragments=[o for o in bpy.context.scene.objects if 'fragment_id' in o]
identity=fragments[0]['building_id']
package=ROOT/'web/public/assets/buildings'/identity
export(package/'intact.glb',[body]);export(package/'fragments.glb',fragments)
meta=json.loads((package/'manifest.json').read_text(encoding='utf-8'))
if identity=='knu-main-v1':
    meta['enhancements'][-1]='existing dome, portico and columns; redundant trim/curved steps excluded from game solid'
write(package/'manifest.json',meta)
wire_review([body],OUT/(identity+'-wire.png'))
center=Vector((0,0,max(v.co.z for v in body.data.vertices)/2))
for obj in fragments:obj.location=center+(obj.location-center)*1.25
wire_review(fragments,OUT/(identity+'-shards-wire.png'))
print('@@JSON@@'+json.dumps({'building_id':identity,'fragments':len(fragments),'tangents':'final GLB positions and UVs','wire':'constant thickness, no miters'}))
