"""Read-only inventory of the source campus for the asset pipeline."""
import bpy
import json
import sys
from mathutils import Vector
from pathlib import Path

rows = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    if any(s in obj.name for s in ('본관', 'IT 1호관', 'IT1', 'v10 |')) or 'osm_way' in obj:
        points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
        rows.append({'name': obj.name, 'vertices': len(obj.data.vertices),
                     'polygons': len(obj.data.polygons),
                     'bounds': [[min(p[i] for p in points) for i in range(3)],
                                [max(p[i] for p in points) for i in range(3)]],
                     'scale': list(obj.scale), 'props': dict(obj.items()),
                     'materials': [m.name for m in obj.data.materials if m]})
out = Path(sys.argv[sys.argv.index('--') + 1])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(rows, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
print('INVENTORY', len(rows), str(out))
