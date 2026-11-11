"""Build individual practice props from the closed bodies in the v71 campus.

Open knu-campus-v71-123-group2-r1.blend in Blender 5.2, then run this script
with -- --building global|it5|library. The campus and old packages are untouched.
"""
import argparse
import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_campus_assets import ROOT, REPORTS, qa_check, review_shots, split_mesh
from enhance_buildings import bounds, clean_mesh, collider_points, export, mapped, solid_material, volume, wire_review

SOURCE = 'knu-campus-v71-123-group2-r1.blend'
CONFIG = {
    'global': ('knu-global-practice-v1', '글로벌플라자', '468931850'),
    'it5': ('knu-it5-practice-v1', 'IT5호관', '468931897'),
    'library': ('knu-library-practice-v1', '중앙도서관', '468931852'),
}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')


def aabb(mesh):
    return tuple(Vector([fn(v.co[i] for v in mesh.vertices) for i in range(3)]) for fn in (min, max))


def cut_pieces(mesh, interior, count=64):
    """Split the largest remaining solid with bounded, deterministic plane cuts."""
    rng = random.Random(468931)
    pieces = [(mesh.copy(), volume(mesh))]
    while len(pieces) < count:
        success = False
        for index in sorted(range(len(pieces)), key=lambda i: -pieces[i][1]):
            part, _ = pieces[index]
            lo, hi = aabb(part)
            size = hi - lo
            for axis in sorted(range(3), key=lambda i: -size[i]):
                point = (lo + hi) / 2
                point[axis] += size[axis] * rng.uniform(-.13, .13)
                normal = Vector([rng.uniform(-.12, .12) for _ in range(3)])
                normal[axis] = 1
                halves = split_mesh(part, point, normal.normalized(), interior)
                if not halves:
                    continue
                for half, _ in halves:
                    clean_mesh(half)
                # Prefer cuts with enough solid volume on either side.
                measured = [(half, volume(half)) for half, _ in halves]
                if min(v for _, v in measured) < .0003:
                    for half, _ in measured:
                        bpy.data.meshes.remove(half)
                    continue
                pieces[index:index + 1] = measured
                bpy.data.meshes.remove(part)
                success = True
                break
            if success:
                break
        if not success:
            raise RuntimeError(f'Could only split {len(pieces)} closed pieces')
    return pieces


def roundtrip(path, expected_count, expected_bounds):
    previous = bpy.context.scene
    scene = bpy.data.scenes.new('Roundtrip')
    bpy.context.window.scene = scene
    try:
        assert bpy.ops.import_scene.gltf(filepath=str(path)) == {'FINISHED'}
        meshes = [o for o in scene.objects if o.type == 'MESH']
        boxes = [bounds(o) for o in meshes]
        lo, hi = (Vector([fn(box[k][i] for box in boxes) for i in range(3)])
                  for k, fn in enumerate((min, max)))
        assert len(meshes) == expected_count, (path.name, len(meshes))
        assert max((lo - expected_bounds[0]).length, (hi - expected_bounds[1]).length) < 2e-5
        return {'objects': len(meshes), 'dimensions_m': mapped(Vector((hi.x-lo.x, lo.y-hi.y, hi.z-lo.z)))}
    finally:
        bpy.context.window.scene = previous
        for obj in list(scene.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(scene)


def build(key):
    package_id, label, osm = CONFIG[key]
    source_path = Path(bpy.data.filepath)
    assert source_path.name == SOURCE, source_path
    old_scene = bpy.context.scene
    source = next(o for o in old_scene.objects if str(o.get('osm_way', '')) == osm)
    mesh = source.data.copy()
    mesh.transform(source.matrix_world)
    lo, hi = aabb(mesh)
    source_dimensions = hi - lo
    origin = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
    scale = 2.8 / max(source_dimensions)
    mesh.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(-origin))
    clean_mesh(mesh)
    scene = bpy.data.scenes.new('Single_Building_Practice')
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    body = bpy.data.objects.new('Practice_Intact', mesh)
    scene.collection.objects.link(body)
    base_qa = qa_check.run(objects=[body.name], profile='print', uv=False, eps=1e-5)
    assert not base_qa['errors'], base_qa['errors']
    mesh.materials.append(solid_material('M_Practice_Interior', (.42, .39, .34), .92))
    intact_volume = volume(mesh)
    pieces = cut_pieces(mesh, len(mesh.materials)-1)
    error = abs(sum(v for _, v in pieces)-intact_volume)/intact_volume
    assert error < .0002, error

    fragments, colliders = [], []
    qa = {body.name: base_qa}
    for i, (cell, mass) in enumerate(pieces):
        pivot = sum(aabb(cell), Vector()) / 2
        cell.transform(Matrix.Translation(-pivot))
        obj = bpy.data.objects.new(f'Practice_Fragment_{i:03d}', cell)
        scene.collection.objects.link(obj)
        obj.location = pivot
        obj['fragment_id'] = i
        checked = qa_check.run(objects=[obj.name], profile='print', uv=False, eps=1e-5)
        assert not checked['errors'], (obj.name, checked['errors'])
        qa[obj.name] = checked
        fragments.append(obj)
        colliders.append({'fragment_id': i, 'node': obj.name, 'type': 'convex_hull',
            'rest_position_m': mapped(pivot), 'rest_quaternion_xyzw': [0, 0, 0, 1],
            'vertices_m': collider_points(cell), 'volume_m3': round(mass, 10),
            'density_kg_m3': 200, 'friction': .76, 'restitution': .08})

    out = ROOT/'web/public/assets/buildings'/package_id
    out.mkdir(parents=True, exist_ok=True)
    review = REPORTS/'practice-packages'/key
    review.mkdir(parents=True, exist_ok=True)
    temp = ROOT/'data/local/practice-packages'/key
    temp.mkdir(parents=True, exist_ok=True)
    review_shots.run(objects=[body.name], out=str(temp/'intact.png'), mode='material', res=384)
    center = sum(bounds(body), Vector())/2
    rest = [obj.location.copy() for obj in fragments]
    for obj, pivot in zip(fragments, rest):
        obj.location = center + (pivot-center)*1.35
    wire_review(fragments, temp/'fragments.png')
    for obj, pivot in zip(fragments, rest):
        obj.location = pivot
    for name in ['intact.png', 'fragments.png']:
        shutil.copyfile(temp/name, review/name)

    export(out/'intact.glb', [body])
    export(out/'fragments.glb', fragments)
    box = bounds(body)
    roundtrips = {name: roundtrip(out/name, n, box) for name, n in [('intact.glb', 1), ('fragments.glb', len(fragments))]}
    size = box[1]-box[0]
    write(out/'manifest.json', {'schema_version': '1.0', 'building_id': package_id, 'display_name': label,
        'source_model_id': 'osm/'+osm, 'source_campus': SOURCE,
        'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'source_object': source.name,
        'source_origin_campus_z_up_m': list(origin), 'scale_from_campus': scale,
        'source_dimensions_campus_z_up_m': list(source_dimensions), 'units': 'm', 'coordinate_frame': 'three_y_up',
        'world_coordinate_frame': 'room_z_up', 'apply_additional_axis_rotation': False, 'origin': 'bottom_center',
        'dimensions_m': [size.x,size.z,size.y], 'fragment_count': len(fragments),
        'assets': {'intact': 'intact.glb', 'fragments': 'fragments.glb', 'colliders': 'colliders.json'},
        'gameplay': {'density_kg_m3': 200, 'gravity_mps2': 9.81, 'fixed_timestep_s': 1/60, 'impact_radius_m': .65},
        'accuracy': 'Scaled campus building body and its materials; separate facade/roof details omitted. Not surveyed.',
        'fragment_method': 'Deterministic bounded plane cuts, capped and closed; convex support hulls.',
        'source': 'synthetic', 'input_mode': 'keyboard_demo', 'tracking_mode': 'keyboard_demo'})
    write(out/'colliders.json', {'schema_version': '1.0', 'building_id': package_id, 'units': 'm',
        'coordinate_frame': 'three_y_up', 'intact_collider': 'compound_of_fragment_convex_hulls', 'fragments': colliders})
    for obj in fragments:
        obj.hide_set(True)
    bpy.data.scenes.remove(old_scene)
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    editable = ROOT/'assets/source/campus-v71-123'/(package_id+'.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(editable), compress=True)
    write(REPORTS/'enhancement'/(package_id+'-qa.json'), {'building_id': package_id,
        'blender': bpy.app.version_string, 'source': SOURCE, 'fragment_count': len(fragments),
        'intact_volume_m3': intact_volume, 'volume_relative_error': error, 'errors': [], 'objects': qa,
        'roundtrip': roundtrips, 'editable_source': editable.relative_to(ROOT).as_posix(),
        'review_sheets': [(review/name).relative_to(ROOT).as_posix() for name in ['intact.png', 'fragments.png']]})
    print(f'Practice package: {package_id}, {len(fragments)} fragments, volume relative error {error:.2g}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--building', required=True, choices=CONFIG)
    build(parser.parse_args(sys.argv[sys.argv.index('--')+1:]).building)
