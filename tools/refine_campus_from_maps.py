"""v13: reference-observed massing and facade corrections, with explicit estimates.

Open v12. OSM outer outlines and existing overall group heights are retained.
Photo/aerial ratios guide details; these are not new surveyed dimensions.
"""
import bpy,bmesh,json,sys,math
from pathlib import Path
from mathutils import Vector
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT,REPORTS,write,qa_check
from enhance_buildings import box,boolean,remove,clean_mesh,bounds,export,solid_material,image,wire_review

OUT=REPORTS/'map-review';OUT.mkdir(exist_ok=True)
TEXTURES=ROOT/'web/public/assets/campus/v13-textures';TEXTURES.mkdir(exist_ok=True)
BASE=json.loads((ROOT/'assets/reference/campus-map-v9.json').read_text(encoding='utf-8'))
POLYGONS={b['id']:b['polygon'] for b in BASE['buildings']}
CONFIG=[('global','468931850','글로벌플라자'),('library','468931852','중앙도서관'),
 ('auditorium','468931841','대강당'),('museum','468931898','박물관'),
 ('gym2','468931925','제2체육관'),('it2','468931876','IT 2호관')]

def texture(name,style):
    n=256;y,x=np.mgrid[0:n,0:n];rng=np.random.default_rng(1307)
    colors={'glass':(.20,.34,.40),'panel':(.055,.105,.14),'library':(.75,.76,.69),'it2':(.72,.73,.68)}
    rgb=np.clip(np.array(colors[style])+rng.normal(0,.004,(n,n,1)),0,1)
    if style in ('glass','panel'):rgb[(x<5)|(y<3)]=(.36,.43,.43) if style=='glass' else (.20,.25,.27)
    else:
        windows=(x>20)&(x<234)&(y>40)&(y<201)
        rgb[windows]=(.15,.24,.27)
        rgb[(abs(x-128)<3)&windows]=(.59,.63,.60)
        if style=='library':rgb[(x<17)|(y<17)]=(.89,.88,.80)
    im=image(name,rgb,TEXTURES)
    mat=solid_material(name,colors[style],.24 if style=='glass' else .64)
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    return mat

glass=solid_material('M_v13_Glazing',(.10,.19,.23),.19)
white=solid_material('M_v13_Stone',(.76,.75,.68),.73)
brick=solid_material('M_v13_Brick',(.42,.22,.15),.84)
roof=solid_material('M_v13_Roof',(.25,.34,.29),.66)
dark=solid_material('M_v13_Recess',(.045,.075,.083),.55)
panel=texture('M_v13_Photovoltaic','panel')
grey=solid_material('M_v13_LowerRoof',(.43,.46,.43),.8)
wall_mats={'global':texture('M_v13_GlobalPanels','glass'),
 'library':texture('M_v13_LibraryWindows','library'),'it2':texture('M_v13_IT2Windows','it2'),
 'auditorium':brick,'museum':brick,'gym2':white}

def slots(obj,wall):
    cap=max((face for face in obj.data.polygons if face.normal.z>.8),key=lambda face:face.area)
    original_roof=obj.data.materials[cap.material_index]
    obj.data.materials.clear()
    for mat in (wall,original_roof,white,glass,dark,panel,grey):obj.data.materials.append(mat)
    for face in obj.data.polygons:face.material_index=1 if face.normal.z>.65 else 0

def construct(body,name,center,size,index=2,angle=0,op='UNION'):
    cutter=box(name,center,size,list(body.data.materials),index,angle)
    boolean(body,cutter,op);remove(cutter)

def cut(body,name,lo,hi):construct(body,name,(Vector(lo)+Vector(hi))/2,Vector(hi)-Vector(lo),6,op='DIFFERENCE')

def UV(obj,style):
    obj.data.update();uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
    width,story=(1.7,3.6) if style=='global' else (3.8,4.35) if style=='library' else (3.4,3.1)
    for face in obj.data.polygons:
        normal=face.normal;axis=max(range(3),key=lambda i:abs(normal[i]))
        axes=(1,2) if axis==0 else (0,2) if axis==1 else (0,1)
        for loop in face.loop_indices:
            p=obj.matrix_world@obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv=(p[axes[0]]/width,p[axes[1]]/story)

def wall_edges(identity):
    points=POLYGONS[identity];signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1]))
    edges=[]
    for a,b in zip(points,points[1:]+points[:1]):
        a=Vector((*a,0));b=Vector((*b,0));delta=b-a;d=delta.normalized()
        normal=Vector((d.y,-d.x,0))*(1 if signed>0 else -1)
        edges.append((a,b,d,normal,delta.length,math.atan2(d.y,d.x)))
    return edges

def solar(body,name,center,size):construct(body,name,center,size,5)

results=[]
for key,identity,label in CONFIG:
    body=next(o for o in bpy.context.scene.objects if str(o.get('osm_way',''))==identity)
    group=[o for o in bpy.context.scene.objects if o.type=='MESH' and label in o.name]
    old_lo=Vector([min(bounds(o)[0][i] for o in group) for i in range(3)])
    old_hi=Vector([max(bounds(o)[1][i] for o in group) for i in range(3)])
    lo,hi=bounds(body);ground=float(body.get('v10 지반 추정_m',lo.z));top=hi.z;H=top-ground
    # Keep the original downward foundation vertices for the contact audit.
    foundation={i for face in body.data.polygons if face.normal.z<-.2 for i in face.vertices}
    body['v13_foundation_vertices_json']=json.dumps([list(body.matrix_world@body.data.vertices[i].co) for i in foundation])
    preserved=[]
    for obj in group:
        if key in ('museum','auditorium') and ('태양광' in obj.name or (key=='auditorium' and '다각 지붕' in obj.name)):
            preserved.append((obj.name,obj.data.copy(),obj.matrix_world.copy()))
        if obj!=body:remove(obj)
    slots(body,wall_mats[key])
    features=[]
    if key=='global':
        # Two glass volumes, a recessed central spine and upper transverse cap.
        # Overall height and the base outer footprint come from the v12 group.
        z0=top-.04;zmax=old_hi.z
        construct(body,'TowerWest',(74.5,179.0,(z0+zmax-2.1)/2),(19,26,zmax-2.1-z0),0)
        construct(body,'TowerEast',(100,178.0,(z0+zmax-7.0)/2),(20,24,zmax-7-z0),0)
        construct(body,'CentralSpine',(87,184,(z0+zmax)/2),(7,16,zmax-z0),4)
        construct(body,'TransverseCap',(87.5,178,zmax-4.2),(45,11,2.2),0)
        # Keep base portal visibly recessed under the upper curtain wall.
        cut(body,'PodiumPortal',(82,131,ground+.1),(94,134.2,ground+4.1))
        construct(body,'PodiumGlazing',(88,134.17,ground+2.1),(11.8,.15,3.9),3)
        features=['twin glass volumes and full-height dark central recess','transverse crown and recessed podium portal']
    elif key=='library':
        low_roof=ground+H*.79
        cut(body,'EastWingStep',(191,167,low_roof),(227,220,top+3))
        construct(body,'CentralRoofVolume',(158.5,166.5,(top+old_hi.z)/2-.02),(39,17,max(.02,old_hi.z-top)+.04),6)
        solar(body,'SouthArray',(161,133,top+.035),(55,5,.13))
        solar(body,'NorthArray',(164,211,top+.035),(50,6,.13))
        solar(body,'EastArray',(207,185,low_roof+.035),(20,9,.13))
        features=['lower east wing instead of a uniform-height block','raised central roof volume and separated roof solar fields']
    elif key=='it2':
        lower=top-3.2
        cut(body,'RecessedRoof',(101,-325,lower),(135,-289,top+1))
        construct(body,'CentralSkylight',(118,-306,lower+.17),(5.2,5.2,.40),3)
        for name,center,size in [('South',(117,-335,top+.035),(50,6,.13)),('North',(117,-279,top+.035),(50,5,.13)),
                                 ('West',(91,-306,top+.035),(5,38,.13)),('East',(143,-306,top+.035),(5,36,.13))]:solar(body,'RoofArray'+name,center,size)
        features=['lower central roof well and small skylight; not an assumed through-building courtyard','four perimeter solar fields and facade bands']
    elif key=='gym2':
        cut(body,'WestLowerHall',(-540,-95,ground+H*.57),(-493,-28,top+1))
        cut(body,'NorthWestAnnex',(-494,-59,ground+H*.73),(-472,-10,top+1))
        for face in body.data.polygons:
            if face.normal.z>.6:
                face.material_index=6 if face.center.x<-473 else 1
        # A raised longitudinal roof vent stays inside the previous group height.
        construct(body,'RoofVent',(-512,-73,ground+H*.60),(29,2,H*.08),6)
        for a,b,d,n,length,angle in wall_edges(identity):
            if length<15:continue
            z=ground+H*(.82 if (a.x+b.x)/2>-473 else .40)
            construct(body,'Clerestory',(a+b)/2+n*.02+Vector((0,0,z)),(length*.72,.14,H*.10),3,angle)
        features=['separate main hall and lower west/northwest annex roofs','roof vent; unverified absolute height retained']
    elif key=='auditorium':
        edges=wall_edges(identity)
        entry=next(e for e in edges if e[0].x>40 and e[1].x>70)
        a,b,d,n,length,angle=entry;middle=(a+b)/2;entry_z=ground+H*.23
        construct(body,'EntryPocket',middle-n*1.0+Vector((0,0,entry_z)),(length*.6,3.4,H*.44),4,angle,'DIFFERENCE')
        construct(body,'EntryGlass',middle-n*2.66+Vector((0,0,entry_z)),(length*.59,.14,H*.43),3,angle)
        for a,b,d,n,length,angle in edges:
            if length<14:continue
            count=max(2,int(length/4.6))
            for i in range(count):
                center=a+d*((i+.5)*length/count)+n*.015+Vector((0,0,top-H*.24))
                construct(body,'UpperSlit',center,(.85,.12,H*.34),3,angle)
        # Preserve the existing two-level roof silhouette, without the old full-floor window grid.
        features=['deep glazed entrance under the projecting upper wall','narrow upper windows instead of a regular three-storey window grid']
    elif key=='museum':
        # Photographs show broad brick fields framed by light vertical piers.
        edges=wall_edges(identity)
        for a,b,d,n,length,angle in edges:
            if length<7 or length>24:continue
            for distance in (.65,length-.65):
                construct(body,'LightPier',a+d*distance+n*.015+Vector((0,0,(ground+top)/2)),(.42,.14,H-.05),2,angle)
            for level in range(1,4):
                construct(body,'LightBand',(a+b)/2+n*.025+Vector((0,0,ground+H*level/4)),(length-.9,.16,.20),2,angle)
        features=['broad brick wall fields and light piers/floor edges','removed unsupported continuous glass-and-white infill strips']
    # Earlier references already established these roof pieces/panels. Unknown
    # dates in the new photographs are not evidence that they were removed.
    for name,mesh,matrix in preserved:
        mesh.transform(matrix);mesh.materials.clear()
        for mat in body.data.materials:mesh.materials.append(mat)
        for face in mesh.polygons:face.material_index=5 if '태양광' in name else 1
        part=bpy.data.objects.new('RetainedRoof',mesh);bpy.context.scene.collection.objects.link(part)
        boolean(body,part,'UNION');remove(part)
    if preserved:features.append('previously referenced rooftop panels/roof forms retained despite uncertain photo dates')
    clean_mesh(body.data);UV(body,key)
    body['v13_reference_review']='2026-11-02 / official KNU map + KNU photo previews + OSM snapshot + Esri visual inspection'
    body['v13_accuracy']='Observed features; component dimensions and occluded sides estimated. No new survey. Outer footprint and previous overall height retained.'
    body['v13_changes']='; '.join(features)
    checked=qa_check.run(objects=[body.name],profile='print',uv=False)
    visual=qa_check.run(objects=[body.name],profile='game',uv=True)
    record={'key':key,'osm_id':identity,'name':label,'features':features,'before_group_bounds':[list(old_lo),list(old_hi)],
        'after_bounds':[list(p) for p in bounds(body)],'geometry':checked,'visual':visual}
    results.append(record);write(OUT/'v13-model-qa.json',results)
    assert checked['pass'] and visual['pass'],(key,checked['errors'],visual['errors'])
    print('@@JSON@@'+json.dumps({'building':key,'errors':0,'triangles':checked['objects'][body.name]['tris']}))

scene=bpy.context.scene;scene['v13']='Map/photo-reviewed six buildings; source and uncertainty in docs/CAMPUS_MAP_REVIEW.md'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v13.blend'),compress=True)
export(ROOT/'web/public/assets/campus/knu-campus-v13.glb',[o for o in scene.objects if o.type=='MESH'])
write(OUT/'v13-build.json',{'buildings_refined':len(results),'core_count':sum('osm_way' in o or str(o.get('source_id','')).startswith('vw/') for o in scene.objects),'errors':0})
print('@@JSON@@'+json.dumps({'saved':'knu-campus-v13','refined':len(results)}))
