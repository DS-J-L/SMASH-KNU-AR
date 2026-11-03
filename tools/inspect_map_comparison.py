"""Capture actual model geometry for comparison with map/photo references."""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector
out=Path(__file__).resolve().parents[1]/'docs/asset-validation/map-review'
out.mkdir(parents=True,exist_ok=True)
rows=[]
for obj in bpy.context.scene.objects:
    if obj.type!='MESH':continue
    pts=[obj.matrix_world@v.co for v in obj.data.vertices]
    rows.append({'name':obj.name,'vertices':len(pts),'faces':len(obj.data.polygons),
        'bounds':[[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]],
        'props':dict(obj.items()),'materials':[m.name for m in obj.data.materials if m],
        'core':bool('osm_way' in obj or str(obj.get('source_id','')).startswith('vw/')),
        'faces_indices':[list(f.vertices) for f in obj.data.polygons] if 'osm_way' in obj or 'source_id' in obj else [],
        'points_xy':[[round(p.x,5),round(p.y,5)] for p in pts] if 'osm_way' in obj or 'source_id' in obj else []})
version=Path(bpy.data.filepath).stem.split('-')[-1]
(out/(version+'-inventory.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print('@@JSON@@'+json.dumps({'meshes':len(rows),'cores':sum(r['core'] for r in rows)}))
