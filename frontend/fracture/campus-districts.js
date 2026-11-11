import { Box3, Plane, Vector3 } from 'three';

const groundPadding = 24;

function normalizeBuildingId(value) {
  return String(value ?? '').replace(/^osm\//, '');
}

function nearestDistrict(bounds, districts) {
  const center = bounds.getCenter(new Vector3());
  let nearest;
  let distance = Infinity;
  for (const district of districts) {
    const [x, , z] = district.target_y_up_m;
    const candidate = (center.x - x) ** 2 + (center.z - z) ** 2;
    if (candidate < distance) {
      nearest = district.id;
      distance = candidate;
    }
  }
  return nearest;
}

function buildingOwner(entry, byId, byName) {
  const data = entry.node.userData;
  // The campus export stores building ownership on both base and detail nodes.
  for (const value of [entry.buildingId, data.building_osm, data.detail_owner_id,
    data['v10 건물 ID'], data.building_id, entry.name.match(/\[([^\]]+)\]$/)?.[1]]) {
    const owner = byId.get(normalizeBuildingId(value));
    if (owner) return owner;
  }
  for (const part of entry.name.split(' | ')) {
    const owner = byName.get(part);
    if (owner) return owner;
  }
}

function groundPlanes({ min, max }) {
  return [
    new Plane(new Vector3(1, 0, 0), -min.x),
    new Plane(new Vector3(-1, 0, 0), max.x),
    new Plane(new Vector3(0, 0, 1), -min.z),
    new Plane(new Vector3(0, 0, -1), max.z),
  ];
}

export function createCampusDistrictView(campus, districts) {
  const entries = campus.children.map(node => ({
    node,
    name: node.userData.name ?? node.name,
    buildingId: normalizeBuildingId(node.userData.osm_way ?? node.userData.source_id),
    bounds: new Box3().setFromObject(node),
    originallyVisible: node.visible,
  }));
  const buildings = entries.filter(entry => entry.buildingId);
  const byId = new Map(buildings.map(entry => [entry.buildingId, entry]));
  const byName = new Map(buildings.map(entry => [entry.name, entry]));
  const assignments = new Map(districts.flatMap(district =>
    (district.building_ids ?? []).map(id => [normalizeBuildingId(id), district.id])));
  const boundsByDistrict = new Map(districts.map(district => [district.id, new Box3()]));
  for (const entry of buildings) {
    entry.district = assignments.get(entry.buildingId) ?? nearestDistrict(entry.bounds, districts);
    boundsByDistrict.get(entry.district)?.union(entry.bounds);
  }
  for (const entry of entries.filter(entry => !entry.buildingId)) {
    const owner = buildingOwner(entry, byId, byName);
    const landmark = districts.find(district =>
      district.landmark_prefixes?.some(prefix => entry.name.startsWith(prefix)));
    entry.district = owner?.district ?? landmark?.id;
    if (landmark) boundsByDistrict.get(landmark.id).union(entry.bounds);
    if (!entry.district && entry.name.startsWith('PhotoDetail')) {
      entry.district = nearestDistrict(entry.bounds, districts);
    }
  }

  const structureMaterials = new Set();
  const landscapeMaterials = new Set();
  const landscapeCopies = new Map();
  for (const entry of entries.filter(entry => entry.district)) {
    entry.node.traverse(node => {
      if (!node.isMesh) return;
      for (const material of [].concat(node.material)) structureMaterials.add(material);
    });
  }
  for (const entry of entries.filter(entry => !entry.district)) {
    entry.node.traverse(node => {
      if (!node.isMesh) return;
      const materials = [].concat(node.material).map(material => {
        // A shared material must not clip an assigned building or landmark.
        if (structureMaterials.has(material)) {
          if (!landscapeCopies.has(material)) landscapeCopies.set(material, material.clone());
          material = landscapeCopies.get(material);
        }
        landscapeMaterials.add(material);
        return material;
      });
      node.material = Array.isArray(node.material) ? materials : materials[0];
    });
  }

  for (const bounds of boundsByDistrict.values()) {
    if (!bounds.isEmpty()) bounds.expandByVector(new Vector3(groundPadding, 0, groundPadding));
  }
  return {
    show(id) {
      const bounds = boundsByDistrict.get(id);
      const planes = bounds && !bounds.isEmpty() ? groundPlanes(bounds) : null;
      for (const { node, district, originallyVisible } of entries) {
        node.visible = originallyVisible && (!planes || !district || district === id);
      }
      for (const material of landscapeMaterials) material.clippingPlanes = planes;
      return planes ? bounds : null;
    },
    snapshot() {
      return {
        buildingIds: buildings.filter(entry => entry.node.visible).map(entry => entry.buildingId),
        groundClipPlanes: landscapeMaterials.values().next().value?.clippingPlanes?.length ?? 0,
      };
    },
  };
}
