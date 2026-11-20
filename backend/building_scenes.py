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


# Wide stage (docs/WIDE_STAGE_TEST.md): three markers in a row; `duo:` is the same row for two judging phones
# (markers at -/+spacing/2, docs/DUO_STAGE_TEST.md). Stages do not use the district zones.
# 2026-11-20 (user decision): ONE building per stage set, as big as the stage allows, for a stronger hit.
# Each building is 1.0~1.2 m TALL (taller on campus -> nearer 1.2 m). Its footprint follows its own proportions but
# must fit 2.0 m wide x 1.5 m deep: only the axis that is too long is squeezed, by at most half (the proportions
# may change that much); beyond that the whole building shrinks. One that still ends lower than 0.6 m (a very low,
# long building) is left out. A stage narrower than the building shrinks it as a whole (fit_scale).
# The id carries the set and the spacing, so the server colliders and the PC render are built from the same numbers:
# wide:<set id>:<spacing mm>:<height mm, kept for compatibility and ignored>.
WIDE_PREFIX='wide:'
DUO_PREFIX='duo:'
STAGE_SECTIONS={WIDE_PREFIX:3,DUO_PREFIX:2}
WIDE_SPACING_RANGE_M=(.5,3.0)
WIDE_GAP_M=.25
STAGE_HEIGHT_BAND_M=(1.0,1.2)
STAGE_MAX_WIDTH_M=2.0
STAGE_MAX_DEPTH_M=1.5
STAGE_MIN_SQUEEZE=.5        # a footprint axis keeps at least half of the height's scale
STAGE_MIN_HEIGHT_M=.6


def stage_prefix(scene_id):
    return next((p for p in STAGE_SECTIONS if scene_id.startswith(p)),None)


def wide_scene_id(zone_id,spacing_m,height_m=None,prefix=WIDE_PREFIX):
    return f'{prefix}{zone_id}:{round(spacing_m*1000)}:{round((height_m or 0)*1000)}'


def parse_wide_scene(scene_id):
    prefix=stage_prefix(scene_id)
    if prefix is None:raise ValueError('unknown scene')
    try:
        zone_id,spacing,height=scene_id[len(prefix):].rsplit(':',2)
        spacing_m,height_m=int(spacing)/1000,int(height)/1000
    except ValueError as exc:raise ValueError('unknown scene') from exc
    if (not WIDE_SPACING_RANGE_M[0]<=spacing_m<=WIDE_SPACING_RANGE_M[1] or not 0<=height_m<=2
            or stage_set(STAGE_SECTIONS[prefix],spacing_m,zone_id) is None):raise ValueError('unknown scene')
    return zone_id,spacing_m,height_m


def campus_size(package_id):
    m=package_metadata()[package_id][1]
    return [v*absolute_campus_scale()/m['scale_from_campus'] for v in m['dimensions_m']]


@lru_cache(maxsize=1)
def stage_axes():
    """Per-axis scale [x width, y height, z depth] from each eligible building's campus size to its stage size."""
    ids=[b['id'][len(SINGLE_PREFIX):] for b in single_buildings()]
    real={id:campus_size(id) for id in ids};hs=[v[1] for v in real.values()];lo,hi=min(hs),max(hs)
    a,b=STAGE_HEIGHT_BAND_M;out={}
    for id,(w,h,d) in real.items():
        k=(a+(b-a)*((h-lo)/(hi-lo) if hi>lo else 1))/h
        need=max(w*k/STAGE_MAX_WIDTH_M,d*k/STAGE_MAX_DEPTH_M,1)
        if need>1/STAGE_MIN_SQUEEZE:k*=1/(STAGE_MIN_SQUEEZE*need)   # squeezing alone is not enough: shrink it all
        out[id]=(min(k,STAGE_MAX_WIDTH_M/w),k,min(k,STAGE_MAX_DEPTH_M/d))
    return out


def stage_factor(package_id):
    """[x, y, z] scale from the campus size to the stage size."""
    return list(stage_axes()[package_id])


@lru_cache(maxsize=1)
def stage_buildings():
    """Campus-ordered buildings used on stages: very low, long ones (under 0.6 m even when squeezed) are left out."""
    return [id for id in stage_axes() if stage_size(id)[1]>=STAGE_MIN_HEIGHT_M-1e-9]


def stage_size(package_id):
    """[width, height, depth] in metres on the stage."""
    return [v*k for v,k in zip(campus_size(package_id),stage_axes()[package_id])]


def _fits(ids,spacing_m,sections):
    return wide_layout([stage_size(i) for i in ids],spacing_m,sections)[3]>=1-1e-9


@lru_cache(maxsize=16)
def stage_sets(sections,spacing_m):
    """One building per set, in campus order (2026-11-20). `fits`: the stage is wide enough without shrinking it."""
    parents={b['id'][len(SINGLE_PREFIX):]:b for b in single_buildings()}
    meta=package_metadata();groups=[[id] for id in stage_buildings()]
    return [{'id':f's{n:02d}','label':f'{n}. '+' · '.join(meta[id][0]['label'].split(' · ')[0] for id in g),'packages':g,
             'parent_id':parents[g[0]]['parent_id'],'parent_label':parents[g[0]]['parent_label'],
             'building_count':len(g),'heights_m':[round(stage_size(id)[1],3) for id in g],
             'widths_m':[round(stage_size(id)[0],3) for id in g],'fits':_fits(g,spacing_m,sections)}
            for n,g in enumerate(groups,1)]


def stage_set(sections,spacing_m,set_id):
    return next((g for g in stage_sets(sections,round(spacing_m,3)) if g['id']==set_id),None)


def stage_scene_list(prefix,spacing_m):
    return [{k:v for k,v in g.items() if k!='packages'} for g in stage_sets(STAGE_SECTIONS[prefix],round(spacing_m,3))]


def wide_layout(sizes,spacing,sections=3):
    """Buildings in one front row along +X, centred on the stage; never overlapping.

    With three sections, three buildings stand on the three markers when they fit; with two sections (duo), two
    stand on the two markers and a third between them. The row may use at most the stage width (sections x
    spacing: each marker covers one section); a longer row is shrunk as a whole and `fit` says by how much.
    """
    n=len(sizes)
    pitch=0 if n==1 else (sections-1)*spacing/(n-1) if n>=sections else spacing
    pitch=max([pitch]+[(sizes[i][0]+sizes[i+1][0])/2+WIDE_GAP_M for i in range(n-1)])
    width=(n-1)*pitch+(sizes[0][0]+sizes[-1][0])/2
    fit=min(1,sections*spacing/width)
    pitch*=fit
    offsets=[[(i-(n-1)/2)*pitch,0,0] for i in range(n)]
    return offsets,[width*fit,max(s[1] for s in sizes)*fit,max(s[2] for s in sizes)*fit],pitch,fit


@lru_cache(maxsize=4)
def scene_spec(scene_id='it1'):
    metadata=package_metadata()
    zone=next((z for z in small_zones() if z['id']==scene_id),None)
    wide=None
    if stage_prefix(scene_id):
        zone_id,spacing_m,height_m=parse_wide_scene(scene_id)
        sections=STAGE_SECTIONS[stage_prefix(scene_id)]
        zone=dict(stage_set(sections,spacing_m,zone_id),id=scene_id)
        wide={'zone_id':zone_id,'spacing_m':spacing_m,'height_band_m':list(STAGE_HEIGHT_BAND_M),
              'max_footprint_m':[STAGE_MAX_WIDTH_M,STAGE_MAX_DEPTH_M],'sections':sections}
    if scene_id.startswith(SINGLE_PREFIX):
        package=scene_id[len(SINGLE_PREFIX):]
        if package not in {b['id'][len(SINGLE_PREFIX):] for b in single_buildings()}:raise ValueError('unknown scene')
        zone={'id':scene_id,'label':metadata[package][0]['label'],'packages':[package]}
    if scene_id!='it1' and not zone:raise ValueError('unknown scene')
    ids=['knu-it1-v3'] if scene_id=='it1' else zone['packages']
    packages=[metadata[id] for id in ids]
    if scene_id=='it1':
        campus_scale=None;offsets=[[0,0,0]];factors=[1]
    else:
        campus_scale=absolute_campus_scale()
        # Compact test stage: preserve authored proportions, not campus distances.
        factors=[campus_scale/m['scale_from_campus'] for _,m in packages]
        if wide:
            # Per-axis stage size (footprint may be squeezed); a stage narrower than the building shrinks it as a whole.
            sizes=[stage_size(id) for id in ids]
            offsets,group_dimensions,wide['pitch_m'],wide['fit_scale']=wide_layout(sizes,wide['spacing_m'],wide['sections'])
            factors=[[f*k*wide['fit_scale'] for k in stage_factor(id)] for f,id in zip(factors,ids)]
            wide['height_m']=round(group_dimensions[1],3)
        else:
            sizes=[[v*f for v in m['dimensions_m']] for (_,m),f in zip(packages,factors)]
            offsets,group_dimensions=compact_layout(sizes)
    data={'building_id':'knu-it1-v3' if scene_id=='it1' else 'zone-'+scene_id,
          'coordinate_frame':'three_y_up','fragments':[]}
    render=[];height=0
    for index,(entry,m) in enumerate(packages):
        factor=factors[index]
        axes=factor if isinstance(factor,list) else [factor]*3   # [x, y, z] in the model's three_y_up frame
        offset=offsets[index]
        source=json.loads((ASSETS/entry['folder']/'colliders.json').read_text(encoding='utf-8'))
        nodes=[]
        for f in source['fragments']:
            id=f['fragment_id'] if scene_id=='it1' else len(data['fragments'])
            fragment=copy.deepcopy(f)
            fragment.update(fragment_id=id,node=f'{index}:{f["node"]}',building_id=entry['id'],
                vertices_m=[v*axes[k%3] for k,v in enumerate(f['vertices_m'])],
                rest_position_m=[v*axes[k]+offset[k] for k,v in enumerate(f['rest_position_m'])])
            if 'volume_m3' in fragment:fragment['volume_m3']*=axes[0]*axes[1]*axes[2]
            data['fragments'].append(fragment);nodes.append({'id':id,'source_node':f['node'],'node':fragment['node']})
        render.append({'id':entry['id'],'label':entry['label'],'url':f'/public/assets/buildings/{entry["folder"]}/{m["assets"]["fragments"]}',
                       'scale':factor,'offset':offset,'height_m':m['dimensions_m'][1]*axes[1],'fragments':nodes})
        height=max(height,m['dimensions_m'][1]*axes[1])
    dimensions=packages[0][1]['dimensions_m'] if campus_scale is None else group_dimensions
    return {'id':scene_id,'label':'IT1 단독 시험' if zone is None else zone['label'],
            'fixed_size':zone is not None,'population_mean_height_m':MEAN_HEIGHT_M if zone else None,
            'min_height_m':MIN_HEIGHT_M if zone else None,
            'building_count':len(render),'dimensions_m':dimensions,'colliders':data,'render':render,
            'layout':'wide_row' if wide else 'single' if campus_scale is None or len(render)==1 else 'marker_centered_two_front_one_rear',
            **({'wide':wide,'label':zone['label']+(' · 넓은 무대' if wide['sections']==3 else ' · 2대 무대')} if wide else {})}
