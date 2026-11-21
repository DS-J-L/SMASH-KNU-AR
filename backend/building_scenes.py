"""Small test stages with a shared absolute scale and destructible packages."""
import copy
import json
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'web/public/assets/buildings'
MEAN_HEIGHT_M=.95
# Freeze the original 87-building scale; filtering the test list must never resize survivors.
ABSOLUTE_CAMPUS_SCALE=.0629757266484059
MIN_HEIGHT_M=.5


def compact_layout(sizes):
    """Two front buildings and a taller rear building, envelope centred on the marker."""
    gap=.25
    if len(sizes)==1:return [[0,0,0]],list(sizes[0])
    if len(sizes)==2:
        width=sizes[0][0]+gap+sizes[1][0]
        return [[-width/2+sizes[0][0]/2,0,0],[width/2-sizes[1][0]/2,0,0]], [width,max(s[1] for s in sizes),max(s[2] for s in sizes)]
    rear=max(range(3),key=lambda i:sizes[i][1]);front=[i for i in range(3) if i!=rear]
    a,b=(sizes[i] for i in front);r=sizes[rear]
    width=max(a[0]+gap+b[0],r[0]);depth=max(a[2],b[2])+gap+r[2]
    offsets=[[0,0,0] for _ in sizes]
    front_width=a[0]+gap+b[0]
    offsets[front[0]]=[-front_width/2+a[0]/2,0,depth/2-a[2]/2]
    offsets[front[1]]=[front_width/2-b[0]/2,0,depth/2-b[2]/2]
    offsets[rear]=[0,0,-depth/2+r[2]/2]
    return offsets,[width,max(s[1] for s in sizes),depth]


@lru_cache(maxsize=1)
def definitions():
    return json.loads((ROOT/'config/building_test_zones.json').read_text(encoding='utf-8'))['zones']


@lru_cache(maxsize=1)
def package_metadata():
    catalog=json.loads((ASSETS/'catalog.json').read_text(encoding='utf-8'))
    return {e['id']:(e,json.loads((ASSETS/e['folder']/'manifest.json').read_text(encoding='utf-8')))
            for e in catalog['buildings']}


@lru_cache(maxsize=1)
def small_zones():
    """Nearest neighbours within each parent; partition 4 as 2+2, never leave a singleton."""
    metadata=package_metadata();result=[]
    for zone in definitions():
        remaining=[id for id in zone['packages'] if fixed_height(id)>=MIN_HEIGHT_M];groups=[]
        if len(remaining)==1:raise ValueError('a district needs at least two eligible buildings')
        while remaining:
            seed=remaining.pop(0);origin=metadata[seed][1]['source_origin_campus_z_up_m']
            size=2 if len(remaining)+1 in (2,4) else 3
            nearest=sorted(remaining,key=lambda id:sum((metadata[id][1]['source_origin_campus_z_up_m'][k]-origin[k])**2 for k in (0,1)))[:size-1]
            groups.append([seed]+nearest)
            remaining=[id for id in remaining if id not in nearest]
        for index,ids in enumerate(groups,1):
            result.append({'id':f'{zone["id"]}-{index:02d}','label':f'{zone["label"]} · 소구역 {index}',
                           'parent_id':zone['id'],'parent_label':zone['label'],'packages':ids})
    return result


@lru_cache(maxsize=1)
def absolute_campus_scale():
    return ABSOLUTE_CAMPUS_SCALE


def fixed_height(package_id):
    m=package_metadata()[package_id][1]
    return m['dimensions_m'][1]*absolute_campus_scale()/m['scale_from_campus']


def scene_list():
    return [{'id':'it1','label':'IT1 단독 시험','building_count':1}]+[
        {'id':z['id'],'label':z['label'],'building_count':len(z['packages']),
         'parent_id':z['parent_id'],'parent_label':z['parent_label'],
         'fixed_size':True,'population_mean_height_m':MEAN_HEIGHT_M,
         'min_height_m':MIN_HEIGHT_M} for z in small_zones()]


SINGLE_PREFIX='single:'


@lru_cache(maxsize=1)
def single_buildings():
    """Every building that is tall enough for a test stage, one per scene, in zone order."""
    seen=[];[seen.append(id) for z in small_zones() for id in z['packages'] if id not in seen]
    labels={z_id:z['label'] for z in definitions() for z_id in [z['id']]}
    parent={id:z for z in small_zones() for id in z['packages']}
    meta=package_metadata()
    return [{'id':SINGLE_PREFIX+id,'label':meta[id][0]['label'],'building_count':1,'kind':'single',
             'parent_id':parent[id]['parent_id'],'parent_label':parent[id]['parent_label'],
             'fixed_size':True,'population_mean_height_m':MEAN_HEIGHT_M,'min_height_m':MIN_HEIGHT_M,
             'height_m':round(fixed_height(id),3)} for id in seen]


def single_scene_list():
    """1-camera mode: IT1 first, then every eligible building on its own."""
    return [{'id':'it1','label':'IT1 단독 시험','building_count':1,'kind':'single'}]+single_buildings()


def is_single_scene(scene_id):
    return scene_id=='it1' or (isinstance(scene_id,str) and scene_id.startswith(SINGLE_PREFIX))


@lru_cache(maxsize=4)
def scene_spec(scene_id='it1'):
    metadata=package_metadata()
    zone=next((z for z in small_zones() if z['id']==scene_id),None)
    if scene_id.startswith(SINGLE_PREFIX):
        package=scene_id[len(SINGLE_PREFIX):]
        if package not in {b['id'][len(SINGLE_PREFIX):] for b in single_buildings()}:raise ValueError('unknown scene')
        zone={'id':scene_id,'label':metadata[package][0]['label'],'packages':[package]}
    if scene_id!='it1' and not zone:raise ValueError('unknown scene')
    ids=['knu-it1-v3'] if scene_id=='it1' else zone['packages']
    packages=[metadata[id] for id in ids]
    if scene_id=='it1':
        campus_scale=None;offsets=[[0,0,0]]
    else:
        campus_scale=absolute_campus_scale()
        # Compact test stage: preserve authored proportions, not campus distances.
        sizes=[[v*campus_scale/m['scale_from_campus'] for v in m['dimensions_m']] for _,m in packages]
        offsets,group_dimensions=compact_layout(sizes)
    data={'building_id':'knu-it1-v3' if scene_id=='it1' else 'zone-'+scene_id,
          'coordinate_frame':'three_y_up','fragments':[]}
    render=[];height=0
    for index,(entry,m) in enumerate(packages):
        factor=1 if campus_scale is None else campus_scale/m['scale_from_campus']
        offset=offsets[index]
        source=json.loads((ASSETS/entry['folder']/'colliders.json').read_text(encoding='utf-8'))
        nodes=[]
        for f in source['fragments']:
            id=f['fragment_id'] if scene_id=='it1' else len(data['fragments'])
            fragment=copy.deepcopy(f)
            fragment.update(fragment_id=id,node=f'{index}:{f["node"]}',building_id=entry['id'],
                vertices_m=[v*factor for v in f['vertices_m']],
                rest_position_m=[v*factor+offset[k] for k,v in enumerate(f['rest_position_m'])])
            if 'volume_m3' in fragment:fragment['volume_m3']*=factor**3
            data['fragments'].append(fragment);nodes.append({'id':id,'source_node':f['node'],'node':fragment['node']})
        render.append({'id':entry['id'],'label':entry['label'],'url':f'/public/assets/buildings/{entry["folder"]}/{m["assets"]["fragments"]}',
                       'scale':factor,'offset':offset,'height_m':m['dimensions_m'][1]*factor,'fragments':nodes})
        height=max(height,m['dimensions_m'][1]*factor)
    dimensions=packages[0][1]['dimensions_m'] if campus_scale is None else group_dimensions
    return {'id':scene_id,'label':'IT1 단독 시험' if zone is None else zone['label'],
            'fixed_size':zone is not None,'population_mean_height_m':MEAN_HEIGHT_M if zone else None,
            'min_height_m':MIN_HEIGHT_M if zone else None,
            'building_count':len(render),'dimensions_m':dimensions,'colliders':data,'render':render,
            'layout':'single' if campus_scale is None or len(render)==1 else 'marker_centered_two_front_one_rear'}
