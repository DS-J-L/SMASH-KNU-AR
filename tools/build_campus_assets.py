"""Blender: improve source-ground contacts, then build a reusable fractured prop.

Run with Blender 5.2 on assets/source/knu-campus-v10.blend, then -- --stage terrain
or open knu-campus-v11.blend with --stage fracture. All units are metres.
"""
import argparse
import bmesh
import bpy
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path
from mathutils import Matrix, Vector, geometry
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'docs' / 'asset-validation'
REPORTS.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(Path.home() / '.codex/skills/blender-asset-qa/scripts'))
import qa_check
import review_shots


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def apply_world(obj):
    obj.data = obj.data.copy()
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


def clean(mesh):
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free(); mesh.update()


def mesh_object(name, vertices, faces, collection=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces); mesh.update(); clean(mesh)
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def export(path, objects=None):
    if objects is not None:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                              use_selection=objects is not None, use_active_scene=True, export_extras=True,
                              export_cameras=False, export_lights=False,
                              export_animations=False)
    assert path.stat().st_size > 0


def preview(filename, target, position, scale):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 1400; scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    data = bpy.data.cameras.new('PreviewCamera')
    cam = bpy.data.objects.new('PreviewCamera', data); scene.collection.objects.link(cam)
    cam.location = Vector(position)
    cam.rotation_euler = (Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type = 'ORTHO'; data.ortho_scale = scale; data.clip_end = 10000
    scene.camera = cam; scene.render.filepath = str(REPORTS / filename)
    bpy.ops.render.render(write_still=True)
    scene.camera = None
    bpy.data.objects.remove(cam, do_unlink=True); bpy.data.cameras.remove(data)


def terrain_wire_review(obj):
    # A campus-sized default wire grows to metres and spikes at narrow triangles.
    # Use a thin, non-even-offset overlay solely for the review render.
    overlay=obj.copy();overlay.data=obj.data.copy();overlay.name='QA_TerrainWire'
    bpy.context.scene.collection.objects.link(overlay)
    black=bpy.data.materials.new('QA_WireBlack');black.diffuse_color=(.005,.005,.005,1)
    overlay.data.materials.clear();overlay.data.materials.append(black)
    for face in overlay.data.polygons:face.material_index=0
    mod=overlay.modifiers.new('QA_ThinWire','WIREFRAME')
    mod.thickness=.8;mod.use_even_offset=False;mod.use_replace=True
    try:
        review_shots.run(objects=[obj.name,overlay.name],out=str(REPORTS/'terrain-wire.png'),mode='material',res=512)
    finally:
        mesh=overlay.data;bpy.data.objects.remove(overlay,do_unlink=True);bpy.data.meshes.remove(mesh)
        bpy.data.materials.remove(black)


def inside(x, y, points):
    hit = False
    for i, (a,b) in enumerate(points):
        c,d = points[(i+1) % len(points)]
        if (b>y) != (d>y) and x < (c-a)*(y-b)/(d-b)+a: hit = not hit
    return hit


def segment_distance(x, y, a, b):
    dx,dy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/max(dx*dx+dy*dy,1e-12)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)


def terrain_stage():
    data = json.loads((ROOT/'assets/reference/campus-elevation-v10.json').read_text(encoding='utf-8'))
    base = json.loads((ROOT/'assets/reference/campus-map-v9.json').read_text(encoding='utf-8'))
    grid, step, nx, ny = data['grid'], data['step'], data['nx'], data['ny']
    def raw(x,y):
        ix=max(0,min(nx-1.00001,(x-data['x0'])/step)); iy=max(0,min(ny-1.00001,(y-data['y0'])/step))
        a,b=int(ix),int(iy); u,v=ix-a,iy-b
        return (1-v)*((1-u)*grid[b][a]+u*grid[b][a+1])+v*((1-u)*grid[b+1][a]+u*grid[b+1][a+1])
    pads=[]
    for idx in [1,2,6,7,8,25,26,27,38]:
        p=base['areas'][idx]['points']; x=sum(t[0] for t in p)/len(p); y=sum(t[1] for t in p)/len(p)
        pads.append({'id':idx,'p':p,'z':raw(x,y)})
    def old_ground(x,y):
        return next((p['z'] for p in pads if inside(x,y,p['p'])),raw(x,y))
    def improved_ground(x,y):
        for p in pads:
            if inside(x,y,p['p']): return p['z']
        distances=[(min(segment_distance(x,y,a,p['p'][(i+1)%len(p['p'])]) for i,a in enumerate(p['p'])),p) for p in pads]
        distance,p=min(distances,key=lambda v:v[0])
        t=min(1,distance/12.0); blend=t*t*(3-2*t)
        return p['z']*(1-blend)+raw(x,y)*blend if distance<12 else raw(x,y)

    original=next(o for o in bpy.context.scene.objects if o.name.startswith('v10 |'))
    material=original.data.materials[0]
    # Constrained triangles respect pad boundaries, avoiding triangles that cut
    # diagonally through a level sports field. This adds mesh samples, not DEM detail.
    vertices=[]; lookup={}; edges=[]
    def add(x,y):
        key=(round(x,4),round(y,4))
        if key not in lookup: lookup[key]=len(vertices); vertices.append(Vector(key))
        return lookup[key]
    for x,y,_ in data['vertices']: add(x,y)
    for poly in [base['boundary']]+[p['p'] for p in pads]:
        ring=[]
        for i,a in enumerate(poly):
            b=poly[(i+1)%len(poly)]; count=max(1,math.ceil(math.dist(a,b)/4))
            ring.extend(add(a[0]+(b[0]-a[0])*t/count,a[1]+(b[1]-a[1])*t/count) for t in range(count))
        edges.extend((a,ring[(i+1)%len(ring)]) for i,a in enumerate(ring))
    positions,_,triangles,*_=geometry.delaunay_2d_cdt(vertices,edges,[],0,1e-5)
    tops=[(p.x,p.y,improved_ground(p.x,p.y)) for p in positions]
    triangles=[f for f in triangles if inside(sum(tops[v][0] for v in f)/3,sum(tops[v][1] for v in f)/3,base['boundary'])]
    n=len(tops); bottom=min(p[2] for p in tops)-2; faces=[]; boundary=Counter()
    for tri in triangles:
        a,b,c=tri
        if (tops[b][0]-tops[a][0])*(tops[c][1]-tops[a][1])-(tops[b][1]-tops[a][1])*(tops[c][0]-tops[a][0])<0:b,c=c,b
        faces.extend([(a,b,c),(n+c,n+b,n+a)])
        for u,v in ((a,b),(b,c),(c,a)):boundary[tuple(sorted((u,v)))]+=1
    for (a,b),count in boundary.items():
        if count==1:faces.append((a,n+a,n+b,b))
    terrain=mesh_object('SM_CampusTerrain_v11',tops+[(x,y,bottom) for x,y,z in tops],faces)
    terrain.data.materials.append(material)
    terrain['source_resolution_m']=30; terrain['pad_transition_width_m']=12
    terrain['accuracy']='Existing FABDEM samples; no survey accuracy improvement.'
    bpy.data.objects.remove(original,do_unlink=True)
    surface=BVHTree.FromPolygons([Vector(p) for p in tops],triangles,all_triangles=True)
    def height(x,y):
        loc,_,_,_=surface.ray_cast(Vector((x,y,100)),Vector((0,0,-1)),500)
        return loc.z if loc is not None else improved_ground(x,y)

    result={'source':'v10 / FABDEM V1-2 ~30 m', 'new_survey_data':False,
            'pad_transition_width_m':12,'terrain_top_vertices':n,'building_contacts':[],
            'surface_objects':0,'qa_errors':[],'qa_warning_counts':{}}
    warnings=Counter()
    def qa(obj):
        r=qa_check.run(objects=[obj.name],profile='game',uv=False)
        result['qa_errors'].extend({'object':obj.name,'error':v} for v in r['errors'])
        for w in r['warnings']:
            warnings['relative_ground' if 'lowest point' in w else w]+=1
        return r
    qa(terrain)
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH' or obj==terrain:continue
        if 'osm_way' in obj or str(obj.get('source_id','')).startswith('vw/'):
            apply_world(obj)
            anchor=float(obj.get('v10 지반 추정_m',min(v.co.z for v in obj.data.vertices)))
            changed=0; shifts=[]
            for v in obj.data.vertices:
                if v.co.z<=anchor+.05:
                    z=height(v.co.x,v.co.y)-.03
                    shifts.append(z-v.co.z);v.co.z=z;changed+=1
            clean(obj.data);obj['v11_contact']='Bottom perimeter to rendered terrain minus 0.03 m; unsurveyed foundation.'
            result['building_contacts'].append({'name':obj.name,'id':str(obj.get('osm_way',obj.get('source_id'))),
                                                'bottom_vertices':changed,'max_shift_m':max(map(abs,shifts),default=0)})
            qa(obj)
        elif obj.name.startswith(('road_','green','water','pitch')):
            apply_world(obj)
            bm=bmesh.new();bm.from_mesh(obj.data);offset=bm.verts.layers.float.new('source_surface_offset')
            for v in bm.verts:v[offset]=v.co.z-old_ground(v.co.x,v.co.y)
            for _ in range(7):
                long=[e for e in bm.edges if e.calc_length()>5]
                if not long:break
                bmesh.ops.subdivide_edges(bm,edges=long,cuts=1,use_grid_fill=True)
            for v in bm.verts:v.co.z=height(v.co.x,v.co.y)+v[offset]
            bm.to_mesh(obj.data);bm.free();clean(obj.data)
            obj['v11_contact']='Draped on actual rendered triangles, preserving original layer thickness.'
            result['surface_objects']+=1
            qa(obj)
    result['qa_warning_counts']=dict(warnings)
    write(REPORTS/'terrain-v11.json',result)
    scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['v11_limitations']='No new building dimensions or high-resolution DEM. Contact geometry only.'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-campus-v11.blend'),compress=True)
    export(ROOT/'web/public/assets/campus/knu-campus-v11.glb')
    preview('campus-v11.png',(0,0,-2),(1150,-1500,1200),1550)
    preview('terrain-sports-v11.png',(-410,-255,-7),(-330,-500,160),360)
    preview('terrain-building-v11.png',(220,-315,0),(310,-440,80),160)
    review_shots.run(objects=[terrain.name],out=str(REPORTS/'terrain-material.png'),mode='material',res=512)
    terrain_wire_review(terrain)
    print('@@JSON@@'+json.dumps({'stage':'terrain','buildings':len(result['building_contacts']),
                               'surfaces':result['surface_objects'],'qa_errors':len(result['qa_errors'])}))


def material(name, color):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1)
    node=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=.78
    return m


def assign_uv(mesh, unit):
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        normal=face.normal
        axes=(0,2) if abs(normal.y)>.65 else (1,2) if abs(normal.x)>.65 else (0,1)
        for loop in face.loop_indices:
            p=mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=(p[axes[0]]/(2.8*unit),p[axes[1]]/(3.5*unit))


def split_mesh(mesh, point, normal, interior_index):
    pieces=[]
    for keep in (False,True):
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                              plane_co=point,plane_no=normal,dist=1e-7,
                              clear_inner=keep,clear_outer=not keep)
        boundary=[e for e in bm.edges if e.is_boundary]
        filled=bmesh.ops.holes_fill(bm,edges=boundary,sides=0)['faces'] if boundary else []
        for face in filled:face.material_index=interior_index
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        if any(not e.is_manifold for e in bm.edges):bm.free();return None
        volume=abs(bm.calc_volume(signed=True))
        if volume<.0003:bm.free();return None
        out=bpy.data.meshes.new('FractureCell');bm.to_mesh(out);bm.free()
        for mat in mesh.materials:out.materials.append(mat)
        pieces.append((out,volume))
    return pieces


def mapped(p):return [round(p[0],7),round(p[2],7),round(-p[1],7)]


def fracture_stage():
    source=next(o for o in bpy.context.scene.objects if str(o.get('osm_way',''))=='468931895')
    source_name=source.name
    points=[source.matrix_world@v.co for v in source.data.vertices]
    lo=Vector([min(p[i] for p in points) for i in range(3)])
    hi=Vector([max(p[i] for p in points) for i in range(3)])
    anchor=float(source.get('v10 지반 추정_m',lo.z));origin=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,anchor))
    scale=2.8/(hi.x-lo.x)
    package=ROOT/'web/public/assets/buildings/knu-it1-v1';package.mkdir(parents=True,exist_ok=True)
    mesh=source.data.copy();mesh.transform(source.matrix_world)
    for v in mesh.vertices:
        v.co=(v.co-origin)*scale
        if v.co.z<.004:v.co.z=0
    # Keep the source footprint and height estimate. The repeat-window treatment
    # is a lightweight game material, not a claim about the surveyed facade.
    mesh.materials.clear()
    wall=material('M_IT1_Wall',(0.64,.64,.59));roof=material('M_IT1_Roof',(.25,.31,.29))
    interior=material('M_Fracture_Concrete',(.61,.56,.48))
    image=bpy.data.images.new('IT1_RepeatingWindow',width=64,height=64,alpha=False)
    pixels=[]
    for y in range(64):
        for x in range(64):
            is_window=12<=x<53 and 16<=y<52
            color=(.20,.32,.38) if is_window else (.64,.64,.59)
            if is_window and (x==32 or y in (32,33)):color=(.49,.52,.49)
            pixels.extend((*color,1))
    image.pixels.foreach_set(pixels);image.pack()
    tex=wall.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.extension='REPEAT'
    bsdf=next(n for n in wall.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    wall.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    for mat in (wall,roof,interior):mesh.materials.append(mat)
    clean(mesh)
    for f in mesh.polygons:f.material_index=1 if f.normal.z>.5 else 0
    assign_uv(mesh,scale)
    # Detach the new prop scene; v10/v11 source files remain untouched.
    old_scene=bpy.context.scene
    scene=bpy.data.scenes.new('IT1_FracturePackage');bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    intact_collection=bpy.data.collections.new('ASSET_IT1_Intact');scene.collection.children.link(intact_collection)
    fractured_collection=bpy.data.collections.new('ASSET_IT1_Fragments');scene.collection.children.link(fractured_collection)
    intact=bpy.data.objects.new('SM_IT1_Intact',mesh);intact_collection.objects.link(intact)
    intact['building_id']='knu-it1-v1';intact['source_osm_way']='468931895'
    bm=bmesh.new();bm.from_mesh(mesh);original_volume=abs(bm.calc_volume(signed=True));bm.free()
    cells=[(mesh.copy(),original_volume)];rng=random.Random(71831)
    attempts=0
    while len(cells)<32 and attempts<100:
        attempts+=1;index=max(range(len(cells)),key=lambda i:cells[i][1]);cell,volume=cells[index]
        coords=[v.co.copy() for v in cell.vertices]
        low=Vector([min(p[i] for p in coords) for i in range(3)]);high=Vector([max(p[i] for p in coords) for i in range(3)])
        axis=max(range(3),key=lambda i:(high[i]-low[i])*rng.uniform(.85,1.15))
        normal=Vector([rng.uniform(-.18,.18) for _ in range(3)]);normal[axis]=1;normal.normalize()
        center=(low+high)/2;center[axis]+=rng.uniform(-.12,.12)*(high[axis]-low[axis])
        divided=split_mesh(cell,center,normal,2)
        if divided:
            cells.pop(index);cells.extend(divided);bpy.data.meshes.remove(cell)
    assert len(cells)==32,'Could not reach requested fracture count'
    fragments=[];qa_results={};colliders=[]
    for i,(cell,volume) in enumerate(cells):
        name=f'SM_IT1_Fragment_{i:03}'
        coords=[v.co.copy() for v in cell.vertices]
        pivot=Vector([(min(p[k] for p in coords)+max(p[k] for p in coords))/2 for k in range(3)])
        assign_uv(cell,scale)
        for v in cell.vertices:v.co-=pivot
        clean(cell)
        obj=bpy.data.objects.new(name,cell);fractured_collection.objects.link(obj);obj.location=pivot
        obj['fragment_id']=i;obj['building_id']='knu-it1-v1';fragments.append(obj)
        hull=[p for v in cell.vertices for p in mapped(v.co)]
        colliders.append({'fragment_id':i,'node':name,'type':'convex_hull','rest_position_m':mapped(pivot),
                          'rest_quaternion_xyzw':[0,0,0,1], 'vertices_m':hull,
                          'volume_m3':round(volume,9),'density_kg_m3':200,
                          'friction':.72,'restitution':.12})
        qa_results[name]=qa_check.run(objects=[name],profile='print',uv=False)
    qa_results[intact.name]=qa_check.run(objects=[intact.name],profile='print',uv=False)
    errors=[(name,r['errors']) for name,r in qa_results.items() if not r['pass']]
    volume_error=abs(sum(v for _,v in cells)-original_volume)/original_volume
    result={'building_id':'knu-it1-v1','source_name':source_name,'fragment_count':len(fragments),
            'volume_relative_error':volume_error,'intact_volume_m3':original_volume,
            'errors':errors,'objects':qa_results}
    write(REPORTS/'fracture-it1.json',result)
    assert not errors,errors
    assert volume_error<.0001,volume_error
    export(package/'intact.glb',[intact]);export(package/'fragments.glb',fragments)
    write(package/'colliders.json',{'schema_version':'1.0','coordinate_frame':'three_y_up','units':'m',
                                    'intact_collider':'compound_of_fragment_convex_hulls','fragments':colliders})
    manifest={'schema_version':'1.0','building_id':'knu-it1-v1','display_name':'IT 1호관',
              'source_osm_way':'468931895','source_campus':'knu-campus-v11',
              'source_origin_campus_z_up_m':list(origin),'scale_from_campus':scale,
              'units':'m','coordinate_frame':'three_y_up','world_coordinate_frame':'room_z_up',
              'coordinate_conversion':'(X,Y,Z) -> (X,Z,-Y); already baked into GLB and colliders',
              'apply_additional_axis_rotation':False,'origin':'bottom_center','fragment_count':len(fragments),
              'dimensions_m':mapped(((hi.x-lo.x)*scale, -(hi.y-lo.y)*scale,(hi.z-anchor)*scale)),
              'source_dimensions_campus_z_up_m':[hi.x-lo.x,hi.y-lo.y,hi.z-anchor],
              'assets':{'intact':'intact.glb','fragments':'fragments.glb','colliders':'colliders.json'},
              'gameplay':{'density_kg_m3':200,'gravity_mps2':9.81,'fixed_timestep_s':1/60,
                          'note':'Game density, fracture seed and scale are design values.'},
              'accuracy':'OSM footprint and assumed 2019 9 floors x 3.5 m; facade repeat is game art, not surveyed.',
              'fragment_method':'Seeded closed half-space cuts, capped concrete interiors; no inter-fragment gap.',
              'source':'synthetic','input_mode':'keyboard_demo','tracking_mode':'keyboard_demo'}
    write(package/'manifest.json',manifest)
    for obj in fragments:obj.hide_render=True
    review_shots.run(objects=[intact.name],out=str(REPORTS/'it1-intact-material.png'),mode='material',res=512)
    review_shots.run(objects=[intact.name],out=str(REPORTS/'it1-intact-wire.png'),mode='wire',res=512)
    intact.hide_render=True
    for obj in fragments:obj.hide_render=False
    # An exploded view is for inspection only; exported transforms stay assembled.
    rest=[obj.location.copy() for obj in fragments]
    center=Vector((0,0,(hi.z-anchor)*scale/2))
    for obj,p in zip(fragments,rest):obj.location=center+(p-center)*1.32
    review_shots.run(objects=[o.name for o in fragments],out=str(REPORTS/'it1-fragments-random.png'),mode='random',res=512)
    review_shots.run(objects=[o.name for o in fragments],out=str(REPORTS/'it1-fragments-wire.png'),mode='wire',res=512)
    for obj,p in zip(fragments,rest):obj.location=p;obj.hide_render=True
    intact.hide_render=False
    bpy.data.scenes.remove(old_scene)
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/source/knu-it1-fracture-v1.blend'),compress=True)
    # Re-import each export independently and compare bounds and node count.
    check=bpy.data.scenes.new('RoundTrip');bpy.context.window.scene=check
    rounds=[]
    for filename in ('intact.glb','fragments.glb'):
        for obj in list(check.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(package/filename))
        meshes=[o for o in check.objects if o.type=='MESH']
        pts=[o.matrix_world@Vector(p) for o in meshes for p in o.bound_box]
        rounds.append({'file':filename,'meshes':len(meshes),'min':[min(p[i] for p in pts) for i in range(3)],
                       'max':[max(p[i] for p in pts) for i in range(3)]})
    assert rounds[0]['meshes']==1 and rounds[1]['meshes']==32,rounds
    for k in ('min','max'):
        assert max(abs(a-b) for a,b in zip(rounds[0][k],rounds[1][k]))<1e-5,rounds
    write(REPORTS/'fracture-roundtrip.json',rounds)
    print('@@JSON@@'+json.dumps({'stage':'fracture','fragment_count':len(fragments),'volume_error':volume_error,'qa_errors':len(errors)}))


def fracture_uv_stage():
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    results={o.name:qa_check.run(objects=[o.name],profile='game',uv=True) for o in objects}
    errors=[(name,r['errors']) for name,r in results.items() if r['errors']]
    write(REPORTS/'fracture-uv.json',{'errors':errors,'objects':results})
    assert not errors,errors
    print('@@JSON@@'+json.dumps({'stage':'fracture_uv','objects':len(objects),'errors':0}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['terrain','fracture','qa-fracture'],required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    {'terrain':terrain_stage,'fracture':fracture_stage,'qa-fracture':fracture_uv_stage}[args.stage]()
