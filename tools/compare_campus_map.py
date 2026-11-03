"""Compare projected mesh footprints against the saved current OSM snapshot."""
import json,sys,math,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.cache/map-review-deps'))
from shapely.geometry import Polygon
from shapely.ops import unary_union
OUT=ROOT/'docs/asset-validation/map-review';REF=ROOT/'assets/reference/map-review-2026-11-02'
version=sys.argv[1] if len(sys.argv)>1 else 'v12'
rows=json.loads((OUT/(version+'-inventory.json')).read_text(encoding='utf-8'))
model={str(r['props'].get('osm_way',r['props'].get('source_id'))):r for r in rows if r['core']}
osm=json.loads((REF/'osm-buildings.json').read_text(encoding='utf-8'))
results=[]
def footprint(row):
 faces=[]
 for f in row['faces_indices']:
  if len(f)<3:continue
  poly=Polygon([row['points_xy'][v] for v in f])
  if not poly.is_valid:poly=poly.buffer(0)
  if poly.area>1e-6:faces.append(poly)
 shape=unary_union(faces)
 # Projection of tiny bevel triangles can leave microscopic interior seams.
 # The map comparison concerns outer footprints; report courtyard geometry separately.
 return unary_union([Polygon(g.exterior) for g in (shape.geoms if shape.geom_type=='MultiPolygon' else [shape])])
for building in osm:
 row=model.get(building['id']);poly=Polygon(building['polygon'])
 if row:
  actual=footprint(row);intersection=poly.intersection(actual).area
  results.append({'osm_id':building['id'],'name':row['name'],'osm_name':building['tags'].get('name'),
    'osm_area_m2':poly.area,'model_area_m2':actual.area,'intersection_over_union':intersection/poly.union(actual).area,
    'boundary_hausdorff_m':poly.hausdorff_distance(actual),'status':'matched'})
 else:results.append({'osm_id':building['id'],'name':building['tags'].get('name'),'status':'missing'})
extra=[{'id':k,'name':r['name'],'status':'existing VWorld-derived; no independent current footprint confirmation'} for k,r in model.items() if k.startswith('vw/')]
report={'snapshot':'2026-11-02','model':'knu-campus-'+version,'osm_buildings_within_campus':len(osm),'model_cores':len(model),
 'matched':sum(r['status']=='matched' for r in results),'missing_osm':sum(r['status']=='missing' for r in results),
 'minimum_iou':min(r['intersection_over_union'] for r in results if r['status']=='matched'),
 'maximum_boundary_hausdorff_m':max(r['boundary_hausdorff_m'] for r in results if r['status']=='matched'),
 'buildings':results,'additional_existing':extra,
 'limitations':'Map agreement is not a survey. OSM itself may omit buildings; 29 VWorld-derived extras retained. Heights, inner courtyards, roofs, dates not established by polygon agreement.'}
(OUT/('map-audit.json' if version=='v12' else 'map-audit-'+version+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
# Our own OSM-derived schematic, with no third-party raster basemap.
parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400" viewBox="-650 -720 1300 1460"><rect x="-650" y="-720" width="1300" height="1460" fill="#f5f4ee"/>']
for r in model.values():
 shape=footprint(r)
 for p in (shape.geoms if shape.geom_type=='MultiPolygon' else [shape]):
  pts=' '.join(f'{x:.2f},{-y:.2f}' for x,y in p.exterior.coords)
  parts.append(f'<polygon points="{pts}" fill="#bdd1cc" stroke="#375d60" stroke-width="1"/>')
for b in osm:
 pts=' '.join(f'{x:.2f},{-y:.2f}' for x,y in b['polygon'])
 parts.append(f'<polygon points="{pts}" fill="none" stroke="#cd643a" stroke-width="1.3"/>')
parts+=['<text x="-600" y="-660" font-family="sans-serif" font-size="24">Campus footprint comparison</text>',
 f'<text x="-600" y="-630" font-family="sans-serif" font-size="15">Blue: {version} model (123) / Orange: current OSM (94)</text>',
 '<text x="-600" y="700" font-family="sans-serif" font-size="14">OSM contributors / ODbL. Comparison 2026-11-02; heights and omissions unverified.</text></svg>']
(OUT/('footprint-overlay.svg' if version=='v12' else 'footprint-overlay-'+version+'.svg')).write_text(''.join(parts),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ('buildings','additional_existing')},ensure_ascii=False))
