"""Game-art upgrades derived from v11; preserves all previous delivered versions.

Blender 5.2: open knu-campus-v11.blend, then -- --building it1|main or --campus.
"""
import argparse
import bmesh
import bpy
import json
import math
import random
import sys
from pathlib import Path
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT, REPORTS, write, mesh_object, qa_check, review_shots
from gltf_tangents import add_tangents

OUT = REPORTS/'enhancement'
OUT.mkdir(parents=True,exist_ok=True)
BUILDER_STYLE='it1'
CONFIG = {
    'it1': {'id':'knu-it1-v2','label':'IT 1호관','osm':'468931895','prefix':'IT1V2','seeds':64,'floors':9,'span':2.8},
    'main': {'id':'knu-main-v1','label':'본관','osm':'468931858','prefix':'MainV1','seeds':52,'floors':5,'span':2.8},
}
DETAILED = {
    'it1': {'id':'knu-it1-v3','prefix':'IT1V3','seeds':96,'source_blend':'knu-it1-fracture-v3.blend','previous_id':'knu-it1-v2'},
    'main': {'id':'knu-main-v2','prefix':'MainV2','seeds':80,'source_blend':'knu-main-fracture-v2.blend','previous_id':'knu-main-v1'},
}


def clean_mesh(mesh, triangulate=True):
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1.1e-5)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1.1e-5)
    bm.normal_update()
    grouped={}
    for face in bm.faces:grouped.setdefault(frozenset(face.verts),[]).append(face)
    duplicate=[]
    for faces in grouped.values():
        if len(faces)>1:
            duplicate.extend(faces if faces[0].normal.dot(faces[1].normal)<-.99 else faces[1:])
    if duplicate:bmesh.ops.delete(bm,geom=duplicate,context='FACES_ONLY')
    if triangulate:
        flat=[edge for edge in bm.edges if BUILDER_STYLE=='main' and len(edge.link_faces)==2 and edge.link_faces[0].normal.dot(edge.link_faces[1].normal)>.999999]
        if flat:bmesh.ops.dissolve_limit(bm,angle_limit=1e-5,verts=[],edges=flat,use_dissolve_boundaries=False,delimit={'MATERIAL'})
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        flat=[edge for edge in bm.edges if BUILDER_STYLE=='main' and len(edge.link_faces)==2 and edge.link_faces[0].normal.dot(edge.link_faces[1].normal)>.999999]
        if flat:bmesh.ops.beautify_fill(bm,faces=list(bm.faces),edges=flat,method='AREA')
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1.1e-5)
        bm.normal_update();grouped={}
        for face in bm.faces:grouped.setdefault(frozenset(face.verts),[]).append(face)
        duplicate=[]
        for faces in grouped.values():
            if len(faces)>1:duplicate.extend(faces if faces[0].normal.dot(faces[1].normal)<-.99 else faces[1:])
        if duplicate:bmesh.ops.delete(bm,geom=duplicate,context='FACES_ONLY')
    wire=[edge for edge in bm.edges if not edge.link_faces]
    if wire:bmesh.ops.delete(bm,geom=wire,context='EDGES')
    loose=[vertex for vertex in bm.verts if not vertex.link_edges]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh);bm.free();mesh.update()


def volume(mesh):
    bm=bmesh.new();bm.from_mesh(mesh);v=abs(bm.calc_volume(signed=True));bm.free();return v


def bounds(obj):
    bpy.context.view_layer.update()
    p=[obj.matrix_world@Vector(v) for v in obj.bound_box]
    return Vector([min(v[i] for v in p) for i in range(3)]),Vector([max(v[i] for v in p) for i in range(3)])


def mapped(p):return [round(p[0],7),round(p[2],7),round(-p[1],7)]


def export(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,
        export_extras=True,export_tangents=False,export_cameras=False,export_lights=False,export_animations=False)
    # Use final exported triangles to avoid zero tangent vectors on bevels.
    tangent_report=add_tangents(path)
    if tangent_report['vertices']:write(OUT/(path.parent.name+'-'+path.stem+'-tangents.json'),tangent_report)


def image(name,array,folder,noncolor=False):
    height,width=array.shape[:2]
    data=np.ones((height,width,4),dtype=np.float32);data[:,:,:3]=np.clip(array,0,1)
    im=bpy.data.images.new(name,width=width,height=height,alpha=False)
    im.colorspace_settings.name='Non-Color' if noncolor else 'sRGB'
    im.pixels.foreach_set(data.ravel());im.filepath_raw=str(folder/(name+'.png'));im.file_format='PNG'
    im.save();im.pack();return im


def textured_material(name,kind,folder,warm=False):
    """Deterministic game facade/aggregate maps, no photographic lighting baked in."""
    n=512 if kind=='facade' else 256
    rng=np.random.default_rng(80241 if warm else 71831)
    y,x=np.mgrid[0:n,0:n];noise=rng.normal(0,.012,(n,n))
    base=np.array([.72,.66,.55] if warm else [.70,.73,.70])
    color=np.clip(base[None,None,:]+noise[:,:,None],0,1)
    rough=np.clip(.79+noise*3,0,1);height=noise*.06
    if kind=='facade':
        if warm:
            row=y//32;brick=((x+((row%2)*64))%128<3)|(y%32<3)
            color[brick]=[.56,.54,.47];height[brick]-=.04
            window=(x>143)&(x<369)&(y>114)&(y<430)
        else:
            joints=(x<3)|(y<16)
            color[joints]=[.56,.60,.57];height[joints]-=.08
            window=(x>105)&(x<410)&(y>128)&(y<408)
        frame=((x>96)&(x<419)&(y>119)&(y<417)) if not warm else ((x>134)&(x<378)&(y>105)&(y<439))
        color[frame]=[.56,.58,.53] if not warm else [.80,.77,.67]
        height[frame]+=.12;rough[frame]=.48
        color[window]=np.array([.16,.29,.35])+noise[window,None]*.6
        rough[window]=np.clip(.18+noise[window]*2,.08,.28);height[window]-=.35
        mullions=window&((np.abs(x-256)<4)|(np.abs(y-267)<3))
        color[mullions]=[.55,.59,.57];rough[mullions]=.4;height[mullions]+=.37
    else:
        color=np.clip(np.array([.56,.52,.45])+noise[:,:,None]*1.6,0,1)
        for _ in range(260):
            cx,cy=rng.integers(0,n,2);radius=float(rng.uniform(1.5,6))
            mask=((x-cx)**2+(y-cy)**2)<radius**2
            color[mask]=np.clip(np.array([.67,.65,.59])+rng.uniform(-.16,.1),0,1)
            height[mask]+=rng.uniform(-.18,.18)
        rough=np.clip(.84+noise*4,.65,1)
    height=(height+np.roll(height,1,0)+np.roll(height,-1,0)+np.roll(height,1,1)+np.roll(height,-1,1))/5
    dy,dx=np.gradient(height);normal=np.stack((-dx*3,-dy*3,np.ones_like(dx)),axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    orm=np.stack((np.ones_like(rough),rough,np.zeros_like(rough)),axis=-1)
    maps=[image(name+'_BC',color,folder),image(name+'_ORM',orm,folder,True),image(name+'_N',normal*.5+.5,folder,True)]
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*base,1)
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    textures=[]
    for im in maps:
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='REPEAT';textures.append(tex)
    mat.node_tree.links.new(textures[0].outputs['Color'],bsdf.inputs['Base Color'])
    split=mat.node_tree.nodes.new('ShaderNodeSeparateColor');split.mode='RGB'
    mat.node_tree.links.new(textures[1].outputs['Color'],split.inputs['Color'])
    mat.node_tree.links.new(split.outputs['Green'],bsdf.inputs['Roughness'])
    mat.node_tree.links.new(split.outputs['Blue'],bsdf.inputs['Metallic'])
    nm=mat.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.55
    mat.node_tree.links.new(textures[2].outputs['Color'],nm.inputs['Color'])
    mat.node_tree.links.new(nm.outputs['Normal'],bsdf.inputs['Normal'])
    return mat


def solid_material(name,color,roughness):
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1)
    node=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=roughness
    node.inputs['Metallic'].default_value=0;return mat


def set_materials(mesh,mats):
    mesh.materials.clear()
    for mat in mats:mesh.materials.append(mat)


def uv_project(mesh,scale,story):
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        normal=face.normal;axis=max(range(3),key=lambda i:abs(normal[i]))
        axes=(1,2) if axis==0 else (0,2) if axis==1 else (0,1)
        size=(2.8*scale,story*scale) if face.material_index==0 else (.065,.065) if face.material_index==3 else (.15,.15)
        for loop in face.loop_indices:
            p=mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=(p[axes[0]]/size[0],p[axes[1]]/size[1])


def boolean(body,cutter,operation):
    mod=body.modifiers.new('Construct','BOOLEAN');mod.operation=operation;mod.object=cutter
    mod.solver='MANIFOLD' if BUILDER_STYLE=='main' else 'EXACT';mod.material_mode='TRANSFER'
    with bpy.context.temp_override(object=body,active_object=body,selected_objects=[body],selected_editable_objects=[body]):
        assert bpy.ops.object.modifier_apply(modifier=mod.name)=={'FINISHED'}


def box(name,center,size,mats,index=2,angle=0):
    x,y,z=[v/2 for v in size];verts=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    c,s=math.cos(angle),math.sin(angle)
    verts=[(center[0]+c*a-s*b,center[1]+s*a+c*b,center[2]+d) for a,b,d in verts]
    obj=mesh_object(name,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    set_materials(obj.data,mats)
    for face in obj.data.polygons:face.material_index=index
    return obj


def remove(obj):
    mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
    if mesh.users==0:bpy.data.meshes.remove(mesh)


def bevel(obj,width):
    mod=obj.modifiers.new('EdgeFinish','BEVEL');mod.width=width;mod.segments=2
    mod.limit_method='ANGLE';mod.angle_limit=math.radians(35);mod.use_clamp_overlap=True
    mod.harden_normals=True;mod.miter_outer='MITER_ARC'
    with bpy.context.temp_override(object=obj,active_object=obj,selected_objects=[obj],selected_editable_objects=[obj]):
        assert bpy.ops.object.modifier_apply(modifier=mod.name)=={'FINISHED'}
    clean_mesh(obj.data)


def inside(bvh,p):
    direction=Vector((.873,.467,.153)).normalized();point=p.copy();count=0
    for _ in range(24):
        hit,_,_,_=bvh.ray_cast(point,direction,20)
        if hit is None:break
        count+=1;point=hit+direction*1e-6
    return count%2==1


def seeds_in(mesh,count):
    coords=[v.co.copy() for v in mesh.vertices]
    low=Vector([min(p[i] for p in coords) for i in range(3)]);high=Vector([max(p[i] for p in coords) for i in range(3)])
    bvh=BVHTree.FromPolygons(coords,[list(f.vertices) for f in mesh.polygons])
    rng=random.Random(20261102);seeds=[]
    def candidate():
        for _ in range(10000):
            p=Vector([rng.uniform(low[i]+1e-5,high[i]-1e-5) for i in range(3)])
            if inside(bvh,p):return p
        raise RuntimeError('Cannot find interior seed')
    for _ in range(count):
        options=[candidate() for _ in range(22)]
        seeds.append(max(options,key=lambda p:min(((p-q).length_squared for q in seeds),default=1)))
    return seeds,low,high


def voronoi_cutter(seed,others,low,high,mats):
    cutter=box('VoronoiCell',(low+high)/2,(high-low)+Vector((.04,.04,.04)),mats,3)
    bm=bmesh.new();bm.from_mesh(cutter.data)
    for point in sorted(others,key=lambda p:(p-seed).length_squared):
        normal=(point-seed).normalized()
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=(point+seed)/2,
                              plane_no=normal,dist=1e-7,clear_outer=True)
        edges=[edge for edge in bm.edges if edge.is_boundary]
        if edges:
            for face in bmesh.ops.holes_fill(bm,edges=edges,sides=0)['faces']:face.material_index=3
        if not bm.faces:break
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(cutter.data);bm.free();cutter.data.update();return cutter


def separate_islands(mesh,mats):
    bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table();bm.verts.index_update()
    pending=set(bm.verts);groups=[]
    while pending:
        todo=[pending.pop()];group=set(todo)
        while todo:
            for edge in todo.pop().link_edges:
                for v in edge.verts:
                    if v in pending:pending.remove(v);group.add(v);todo.append(v)
        groups.append(group)
    result=[]
    for group in groups:
        vertices=sorted(group,key=lambda v:v.index);indices={v:i for i,v in enumerate(vertices)}
        faces=[face for face in bm.faces if all(v in group for v in face.verts)]
        if not faces:continue
        part=bpy.data.meshes.new('ClosedShard')
        part.from_pydata([tuple(v.co) for v in vertices],[],[[indices[v] for v in face.verts] for face in faces]);part.update()
        set_materials(part,mats)
        for target,source in zip(part.polygons,faces):target.material_index=source.material_index;target.use_smooth=source.smooth
        clean_mesh(part);result.append(part)
    bm.free();return result


def collider_points(mesh):
    coords=np.array([tuple(v.co) for v in mesh.vertices])
    chosen=set()
    for axis in range(3):chosen.add(int(np.argmin(coords[:,axis])));chosen.add(int(np.argmax(coords[:,axis])))
    for i in range(56):
        z=1-2*(i+.5)/56;r=math.sqrt(1-z*z);theta=i*math.pi*(3-math.sqrt(5))
        chosen.add(int(np.argmax(coords@np.array((r*math.cos(theta),r*math.sin(theta),z)))))
    return [value for i in sorted(chosen) for value in mapped(coords[i])]


def close_parallel_pairs(obj):
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.verts.index_update()
    vertices=[v.co.copy() for v in bm.verts];faces=list(bm.faces)
    polygons=[[v.index for v in face.verts] for face in faces];bvh=BVHTree.FromPolygons(vertices,polygons,all_triangles=True)
    result=[];seen=set()
    for i,face in enumerate(faces):
        a,b,c=[v.co for v in face.verts];center=(a+b+c)/3;n=face.normal
        for point in (center,center.lerp(a,.6),center.lerp(b,.6),center.lerp(c,.6)):
            for _,_,j,_ in bvh.find_nearest_range(point,.0001):
                if j==i or (min(i,j),max(i,j)) in seen or set(polygons[i])&set(polygons[j]):continue
                other=faces[j];n2=other.normal
                if n.dot(n2)<.999:continue
                aa,bb,cc=[v.co for v in other.verts];distance=n2.dot(point-aa);q=point-n2*distance
                if qa_check._point_in_tri(q,aa,bb,cc,n2):
                    seen.add((min(i,j),max(i,j)));result.append({'plane_distance_m':abs(distance),'triangle_a':[list(v.co) for v in face.verts],'triangle_b':[list(v.co) for v in other.verts]})
    bm.free();return result


def wire_review(objects,path,thickness=.0007):
    # Even-offset wire miters spike on thin fracture triangles. Constant-width
    # wires without miters show the actual topology at game scale.
    grey=solid_material('QA_Grey',(.65,.65,.65),1)
    black=solid_material('QA_Black',(.015,.015,.015),1)
    copies=[]
    try:
        for obj in objects:
            copy=obj.copy();copy.data=obj.data.copy();bpy.context.scene.collection.objects.link(copy)
            copy.data.materials.clear();copy.data.materials.append(grey);copy.data.materials.append(black)
            for face in copy.data.polygons:face.material_index=0
            mod=copy.modifiers.new('TopologyLines','WIREFRAME');mod.thickness=thickness
            mod.use_even_offset=False;mod.use_replace=False;mod.material_offset=1
            copies.append(copy)
        review_shots.run(objects=[o.name for o in copies],out=str(path),mode='material',res=512)
    finally:
        for obj in copies:remove(obj)


def lookdev(objects,path,explode=0):
    """Neutral, soft-light render; temporary helpers never enter the exported asset."""
    scene=bpy.context.scene
    for obj in scene.objects:obj.hide_render=obj not in objects
    lo=Vector([min(bounds(o)[0][i] for o in objects) for i in range(3)])
    hi=Vector([max(bounds(o)[1][i] for o in objects) for i in range(3)])
    center=(lo+hi)/2
    original=[o.location.copy() for o in objects]
    if explode:
        for obj,p in zip(objects,original):obj.location=center+(p-center)*(1+explode)
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=device.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:scene.cycles.device='CPU'
    scene.world=bpy.data.worlds.new('NeutralStudio');scene.world.use_nodes=True
    bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs['Color'].default_value=(.55,.6,.65,1);bg.inputs['Strength'].default_value=.35
    floor=box('ReviewFloor',(0,0,-.065),(10,10,.1),[solid_material('ReviewFloorMat',(.38,.42,.37),.88)],0)
    helpers=[floor]
    for name,position,power,size in [('Key',(-3,-4,6),500,4),('Fill',(4,-1,3),180,3),('Rim',(1,4,5),400,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position
        obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler();helpers.append(obj)
    data=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',data);scene.collection.objects.link(cam)
    cam.location=center+Vector((4.6,-6.4,3.5));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=4.8 if not explode else 5.6;scene.camera=cam;helpers.append(cam)
    scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    for obj,p in zip(objects,original):obj.location=p
    for obj in helpers:
        if obj.type=='MESH':remove(obj)
        else:bpy.data.objects.remove(obj,do_unlink=True)
    scene.camera=None


def building_stage(key,detailed=False):
    global BUILDER_STYLE
    BUILDER_STYLE=key
    config=dict(CONFIG[key])
    if detailed:config.update(DETAILED[key])
    package=ROOT/'web/public/assets/buildings'/config['id']
    texture_dir=package/'textures';texture_dir.mkdir(parents=True,exist_ok=True)
    primary=next(o for o in bpy.context.scene.objects if str(o.get('osm_way',''))==config['osm'])
    sources=[primary]
    if key=='main':sources += [o for o in bpy.context.scene.objects if o.type=='MESH' and '본관' in o.name and
        (o.name.startswith('v5 |') or 'dome approximate' in o.name or ('v7 |' in o.name and '테두리' in o.name))
        and '정면 석재 박공' not in o.name and '테두리' not in o.name and '계단' not in o.name]
    all_points=[obj.matrix_world@v.co for obj in sources for v in obj.data.vertices]
    low=Vector([min(p[i] for p in all_points) for i in range(3)]);high=Vector([max(p[i] for p in all_points) for i in range(3)])
    anchor=float(primary.get('v10 지반 추정_m',low.z));origin=Vector(((low.x+high.x)/2,(low.y+high.y)/2,anchor))
    scale=config['span']/max(high.x-low.x,high.y-low.y)
    body_roof=max((primary.matrix_world@v.co).z for v in primary.data.vertices)
    story=(body_roof-anchor)/config['floors']
    old_scene=bpy.context.scene;scene=bpy.data.scenes.new('ASSET_'+config['prefix']);bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    mats=[textured_material('M_'+config['prefix']+'_Facade','facade',texture_dir,key=='main'),
          solid_material('M_'+config['prefix']+'_Roof',(.11,.25,.19) if key=='main' else (.22,.29,.26),.5),
          solid_material('M_'+config['prefix']+'_Stone',(.68,.66,.57),.72),
          textured_material('M_'+config['prefix']+'_Fracture','aggregate',texture_dir,key=='main')]
    parts=[];roof_edges=[]
    component_checks=[]
    for source in sources:
        mesh=source.data.copy();mesh.transform(source.matrix_world)
        for vertex in mesh.vertices:
            vertex.co=(vertex.co-origin)*scale
            if vertex.co.z<.002:vertex.co.z=0
        clean_mesh(mesh);set_materials(mesh,mats)
        for face in mesh.polygons:
            if source==primary:face.material_index=1 if face.normal.z>.6 else 2 if face.normal.z<-.6 else 0
            elif 'dome' in source.name or '테두리' in source.name:face.material_index=1
            elif '박공' in source.name:face.material_index=1 if face.normal.z>.25 else 2
            else:face.material_index=2
        obj=bpy.data.objects.new('Construction_'+str(len(parts)),mesh);scene.collection.objects.link(obj);parts.append(obj)
        if source==primary:
            if key=='it1':
                # Capture the architectural perimeter before the bevel replaces
                # its roof/wall adjacency with an intermediate chamfer face.
                top=max(v.co.z for v in mesh.vertices)
                bm=bmesh.new();bm.from_mesh(mesh)
                roof_edges=[(e.verts[0].co.copy(),e.verts[1].co.copy()) for e in bm.edges if len(e.link_faces)==2 and
                    min(v.co.z for v in e.verts)>top-.002 and any(f.normal.z>.9 for f in e.link_faces) and any(abs(f.normal.z)<.2 for f in e.link_faces)]
                bm.free()
                assert len(roof_edges)>=4,'Missing roof parapet perimeter'
            bevel(obj,.001)
        checked=qa_check.run(objects=[obj.name],profile='print',uv=False)
        component_checks.append({'source':source.name,'qa':checked})
    write(OUT/(config['id']+'-components.json'),component_checks)
    body=parts[0]
    if key=='it1':
        top=max(v.co.z for v in body.data.vertices)
        for a,b in roof_edges:
            delta=b-a;parts.append(box('Parapet',(a+b)/2+Vector((0,0,.006)),(delta.length+.01,.008,.016),mats,2,math.atan2(delta.y,delta.x)))
        for x in (-.65,.65):parts.append(box('RoofUtility',(x,.015,top+.025),(.24,.16,.054),mats,2))
    for part in parts[1:]:boolean(body,part,'UNION');remove(part)
    body.name='SM_'+config['prefix']+'_Intact'
    clean_mesh(body.data)
    write(OUT/(config['id']+'-prebevel.json'),qa_check.run(objects=[body.name],profile='print',uv=False))
    # Finish the simple primary before union. Beveling the combined parapets
    # creates sub-pixel sliver faces at their intersections.
    uv_project(body.data,scale,story)
    initial_qa=qa_check.run(objects=[body.name],profile='print',uv=False,eps=.0001)
    write(OUT/(config['id']+'-construction.json'),initial_qa)
    if not initial_qa['pass']:
        bm=bmesh.new();bm.from_mesh(body.data)
        write(OUT/(config['id']+'-bad-edges.json'),[{'points':[list(v.co) for v in e.verts],
            'faces':[[list(v.co) for v in f.verts] for f in e.link_faces]} for e in bm.edges if len(e.link_faces)>2])
        bm.free()
    assert initial_qa['pass'],initial_qa['errors']
    original_volume=volume(body.data)
    seeds,lo,hi=seeds_in(body.data,config['seeds']);fragments=[];discarded_volume=0
    for index,seed in enumerate(seeds):
        cutter=voronoi_cutter(seed,[p for j,p in enumerate(seeds) if j!=index],lo,hi,mats)
        cell=bpy.data.objects.new('IntersectCell',body.data.copy());scene.collection.objects.link(cell)
        boolean(cell,cutter,'INTERSECT');remove(cutter)
        for mesh in separate_islands(cell.data,mats):
            mass=volume(mesh)
            if mass<1e-8:discarded_volume+=mass;bpy.data.meshes.remove(mesh);continue
            uv_project(mesh,scale,story)
            obj=bpy.data.objects.new(f'SM_{config["prefix"]}_Fragment_{len(fragments):03}',mesh)
            scene.collection.objects.link(obj);fragments.append((obj,mass))
        remove(cell)
        if index%8==0:write(OUT/(config['id']+'-progress.json'),{'cells':index+1,'total':len(seeds),'fragments':len(fragments)})
    assert 32<len(fragments)<=128,len(fragments)
    colliders=[];qa_results={body.name:qa_check.run(objects=[body.name],profile='game',uv=True,eps=.0001)}
    for index,(obj,mass) in enumerate(fragments):
        points=[v.co.copy() for v in obj.data.vertices]
        pivot=Vector([(min(p[i] for p in points)+max(p[i] for p in points))/2 for i in range(3)])
        for vertex in obj.data.vertices:vertex.co-=pivot
        obj.location=pivot;obj.data.update();obj['fragment_id']=index;obj['building_id']=config['id']
        closed=qa_check.run(objects=[obj.name],profile='print',uv=False,eps=.0001)
        visual=qa_check.run(objects=[obj.name],profile='game',uv=True,eps=.0001)
        qa_results[obj.name]={'closed':closed,'visual':visual}
        colliders.append({'fragment_id':index,'node':obj.name,'type':'convex_hull','rest_position_m':mapped(pivot),
            'rest_quaternion_xyzw':[0,0,0,1],'vertices_m':collider_points(obj.data),'volume_m3':round(mass,10),
            'density_kg_m3':200,'friction':.76,'restitution':.08})
    errors=[]
    for name,record in qa_results.items():
        for label,r in (record.items() if 'closed' in record else [('visual',record)]):
            errors.extend({'object':name,'check':label,'error':e} for e in r['errors'])
    relative_error=abs(sum(mass for _,mass in fragments)-original_volume)/original_volume
    report={'building_id':config['id'],'seed_count':len(seeds),'fragment_count':len(fragments),'intact_volume_m3':original_volume,
        'volume_relative_error':relative_error,'discarded_volume_m3':discarded_volume,'errors':errors,'objects':qa_results}
    write(OUT/(config['id']+'-qa.json'),report)
    if errors:
        flagged={row['object'] for row in errors}
        write(OUT/(config['id']+'-close-planes.json'),{obj.name:close_parallel_pairs(obj) for obj,_ in fragments if obj.name in flagged})
    assert not errors,errors[:8]
    assert relative_error<.0002,relative_error
    export(package/'intact.glb',[body]);export(package/'fragments.glb',[o for o,_ in fragments])
    write(package/'colliders.json',{'schema_version':'1.0','building_id':config['id'],'coordinate_frame':'three_y_up','units':'m',
        'intact_collider':'compound_of_fragment_convex_hulls','approximation':'Convex support hull; <=62 points with all axis extrema retained','fragments':colliders})
    a,b=bounds(body);dims=b-a
    manifest={'schema_version':'1.0','building_id':config['id'],'display_name':config['label'],'source_osm_way':config['osm'],
        'source_campus':'knu-campus-v11','source_origin_campus_z_up_m':list(origin),'scale_from_campus':scale,
        'source_dimensions_campus_z_up_m':[high.x-low.x,high.y-low.y,high.z-anchor],
        'units':'m','coordinate_frame':'three_y_up','world_coordinate_frame':'room_z_up','apply_additional_axis_rotation':False,
        'coordinate_conversion':'(X,Y,Z) -> (X,Z,-Y); baked into GLB and colliders',
        'origin':'bottom_center','dimensions_m':[dims.x,dims.z,dims.y],'fragment_count':len(fragments),
        'assets':{'intact':'intact.glb','fragments':'fragments.glb','colliders':'colliders.json'},
        'gameplay':{'density_kg_m3':200,'gravity_mps2':9.81,'fixed_timestep_s':1/60,'impact_radius_m':.65},
        'enhancements':['PBR facade and aggregate normal/roughness maps','bevelled edges','3D Voronoi capped fracture',
            'game-art parapet and rooftop utilities' if key=='it1' else 'existing dome, portico and columns; redundant trim/curved steps excluded from game solid'],
        'accuracy':'Existing footprint/height assumptions. Facades, edge finish and utility details are game art; no new survey.',
        'fragment_method':'Seeded 3D Voronoi intersections; disconnected islands separated; concrete caps',
        'source':'synthetic','input_mode':'keyboard_demo','tracking_mode':'keyboard_demo'}
    write(package/'manifest.json',manifest)
    if detailed:
        manifest['previous_version']=config['previous_id']
        manifest['fracture_seed_count']=config['seeds']
        write(package/'manifest.json',manifest)
    for obj,_ in fragments:obj.hide_render=True
    bpy.data.scenes.remove(old_scene);bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version=0
    blend_name=config.get('source_blend','knu-it1-fracture-v2.blend' if key=='it1' else 'knu-main-fracture-v1.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source'/blend_name),compress=True)
    review_shots.run(objects=[body.name],out=str(OUT/(config['id']+'-material.png')),mode='material',res=512)
    wire_review([body],OUT/(config['id']+'-wire.png'))
    lookdev([body],OUT/(config['id']+'-hero.png'))
    lookdev([o for o,_ in fragments],OUT/(config['id']+'-exploded.png'),.3)
    for obj,_ in fragments:obj.hide_render=False
    body.hide_render=True
    center=Vector((0,0,dims.z/2));rest=[obj.location.copy() for obj,_ in fragments]
    for (obj,_),p in zip(fragments,rest):obj.location=center+(p-center)*1.25
    wire_review([o for o,_ in fragments],OUT/(config['id']+'-shards-wire.png'))
    # Read the actual exported files back in a clean scene.
    check=bpy.data.scenes.new('RoundTrip');bpy.context.window.scene=check;rounds=[]
    for file in ('intact.glb','fragments.glb'):
        for obj in list(check.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(package/file));bpy.context.view_layer.update()
        meshes=[o for o in check.objects if o.type=='MESH'];points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
        rounds.append({'file':file,'meshes':len(meshes),'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]})
    for key in ('min','max'):assert max(abs(x-y) for x,y in zip(rounds[0][key],rounds[1][key]))<2e-5,rounds
    write(OUT/(config['id']+'-roundtrip.json'),rounds)
    print('@@JSON@@'+json.dumps({'id':config['id'],'fragments':len(fragments),'volume_error':relative_error,'errors':0}))


def campus_stage():
    changed=[];errors=[]
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH' or not ('osm_way' in obj or str(obj.get('source_id','')).startswith('vw/')):continue
        before=bounds(obj);obj.data=obj.data.copy();bm=bmesh.new();bm.from_mesh(obj.data);bm.edges.ensure_lookup_table();bm.edges.index_update()
        weights=bm.edges.layers.float.get('bevel_weight_edge') or bm.edges.layers.float.new('bevel_weight_edge')
        count=0
        for edge in bm.edges:
            roof=len(edge.link_faces)==2 and any(f.normal.z>.95 for f in edge.link_faces) and any(abs(f.normal.z)<.5 for f in edge.link_faces)
            edge[weights]=1 if roof else 0;count+=int(roof)
        bm.to_mesh(obj.data);bm.free()
        if count:
            mod=obj.modifiers.new('RoofEdgeFinish','BEVEL');mod.width=.06;mod.segments=2;mod.limit_method='WEIGHT';mod.use_clamp_overlap=True;mod.harden_normals=True
            with bpy.context.temp_override(object=obj,active_object=obj,selected_objects=[obj],selected_editable_objects=[obj]):
                assert bpy.ops.object.modifier_apply(modifier=mod.name)=={'FINISHED'}
        obj.data.update();qa=qa_check.run(objects=[obj.name],profile='game',uv=False)
        errors.extend({'object':obj.name,'error':message} for message in qa['errors'])
        after=bounds(obj);changed.append({'name':obj.name,'roof_edges':count,'triangles':sum(m['tris'] for m in qa['objects'].values()),
            'bounds_max_change_m':max(abs(a-b) for left,right in zip(before,after) for a,b in zip(left,right)),'qa':qa})
    for mat in bpy.data.materials:
        if not mat.node_tree:continue
        shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if not shader:continue
        name=mat.name.lower();glass=any(key in name for key in ('glazing','glass','창유리','반복 창','창 근사')) and '창틀' not in name
        roof=any(key in name for key in ('roof','지붕','옥상','돔'))
        shader.inputs['Metallic'].default_value=0
        shader.inputs['Roughness'].default_value=.2 if glass else .5 if roof else .78
        shader.inputs['Coat Weight'].default_value=.12 if glass else 0
    write(OUT/'campus-v12-qa.json',{'buildings':len(changed),'errors':errors,'objects':changed,
        'accuracy':'Roof-edge game-art finish and PBR only; footprint, height and terrain not remeasured.'})
    assert len(changed)==123 and not errors,errors[:5]
    scene=bpy.context.scene;scene['v12_art']='Roof edges 0.06m; dielectric PBR materials. No new survey.'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v12.blend'),compress=True)
    export(ROOT/'web/public/assets/campus/knu-campus-v12.glb',[o for o in scene.objects if o.type=='MESH'])
    # A consistent overview with real material response and model-scale shadows.
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=device.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:scene.cycles.device='CPU'
    scene.world=bpy.data.worlds.new('CampusSky');scene.world.use_nodes=True
    bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.55,.65,.8,1);bg.inputs['Strength'].default_value=.5
    sun_data=bpy.data.lights.new('Sun','SUN');sun_data.energy=2.4;sun_data.angle=.06
    sun=bpy.data.objects.new('Sun',sun_data);scene.collection.objects.link(sun);sun.rotation_euler=(.5,-.45,-.6)
    cd=bpy.data.cameras.new('CampusCamera');cam=bpy.data.objects.new('CampusCamera',cd);scene.collection.objects.link(cam)
    cam.location=(1150,-1500,1200);cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cd.type='ORTHO';cd.ortho_scale=1550;cd.clip_end=10000;scene.camera=cam
    scene.render.resolution_x=1500;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'campus-v12.png')
    bpy.ops.render.render(write_still=True)
    print('@@JSON@@'+json.dumps({'stage':'campus','buildings':len(changed),'errors':0,'triangles':sum(r['triangles'] for r in changed)}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--building',choices=list(CONFIG));parser.add_argument('--campus',action='store_true')
    parser.add_argument('--detailed',action='store_true',help='new preserved versions: IT1 96 / Main 80 Voronoi seeds')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    campus_stage() if args.campus else building_stage(args.building or 'it1',args.detailed)
