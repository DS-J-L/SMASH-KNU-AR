"""Local-only basemap inspection. No imagery is packed into game assets."""
import requests,math,json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'assets/reference/map-review-2026-11-02/raw';out.mkdir(parents=True,exist_ok=True)
z=19 if '--detail' in sys.argv else 17;n=2**z
def tile(lon,lat):return (int((lon+180)/360*n),int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n))
name='aerial-z17'
if '--detail' in sys.argv:
 key=sys.argv[sys.argv.index('--detail')+1]
 locations={'it2':(128.6115851,35.8876029),'library':(128.6123,35.8919),'gym2':(128.6050,35.8899),'greenhouses':(128.6132,35.89475)}
 x,y=tile(*locations[key]);left,right,top,bottom=x-1,x+1,y-1,y+1;name=key+'-detail'
else:left,bottom=tile(128.6034,35.8845);right,top=tile(128.6173,35.8963)
def fetch(pair):
 x,y=pair;url=f'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
 path=out/f'tile-{z}-{x}-{y}.jpg'
 if not path.exists():
  response=requests.get(url,timeout=20);response.raise_for_status();path.write_bytes(response.content)
 return x,y,path,url
tiles=list(ThreadPoolExecutor(8).map(fetch,[(x,y) for y in range(top,bottom+1) for x in range(left,right+1)]))
canvas=Image.new('RGB',((right-left+1)*256,(bottom-top+1)*256))
for x,y,p,url in tiles:canvas.paste(Image.open(p),((x-left)*256,(y-top)*256))
canvas.save(out/(name+'.png'))
(out.parent/(name+'-grid.json')).write_text(json.dumps({'zoom':z,'left':left,'top':top,'right':right,'bottom':bottom,
 'urls':[t[3] for t in tiles],'attribution':'Esri World Imagery; provider/capture date not confirmed. Visual reference only.',
 'usage':'Local inspection only. No textures or traced vectors derived from this imagery in deliverables.'},indent=2),encoding='utf-8')
print(json.dumps({'tiles':len(tiles),'size':canvas.size,'path':str(out/(name+'.png'))}))
