import * as THREE from 'three';
import { collisionSafeBoxGeometry } from './rounded-geometry.js';
import { mergeMapGeometries } from './geometry-batch.js';
import { buildMap, buildColliders, COLORS } from './shared/mapdata.js';
import {
  BOT_BODY,
  PLAYER_BODY,
  requireSafeSpawnPoints,
} from './shared/spawn-safety.js';

// ---------------------------------------------------------------------------
// Escena 3D del mapa. Recargable en caliente (votación de mapas): load(mapId)
// vacía y reconstruye TODO mutando los mismos arrays, para que las referencias
// de física/armas/bots sigan siendo válidas.
// ---------------------------------------------------------------------------

const BUILDING_COLORS = new Set([COLORS.building1, COLORS.building2, COLORS.building3]);

function castsUsefulShadow(box) {
  if (box.color === COLORS.ground || box.color === COLORS.street || box.color === COLORS.pad) {
    return false;
  }
  return box.h < 6.5;
}

// Los perfiles controlan la franja de iluminación suave junto a cada arista.
// La geometría del mapa permanece rectangular y completa para coincidir con
// los colliders; solo cambian sus normales, nunca el volumen de cobertura.
export function roundingProfile(box) {
  if (box.crate) return { ratio: 0.14, maxRadius: 0.22 };
  if (box.color === COLORS.ground || box.color === COLORS.street) {
    return { ratio: 0.05, maxRadius: 0.06 };
  }
  if (box.color === COLORS.wall) {
    return { ratio: 0.045, maxRadius: 0.1 };
  }
  if (box.color === COLORS.barrier) {
    return { ratio: 0.12, maxRadius: 0.14 };
  }
  if (box.color === COLORS.roof) {
    return { ratio: 0.08, maxRadius: 0.1 };
  }
  if (BUILDING_COLORS.has(box.color)) {
    return { ratio: 0.055, maxRadius: 0.24 };
  }
  if (box.color === COLORS.platform) {
    return { ratio: 0.07, maxRadius: 0.18 };
  }
  if (box.color === COLORS.pad) {
    return { ratio: 0.12, maxRadius: 0.04 };
  }
  return { ratio: 0.1, maxRadius: 0.14 };
}

export function buildWorld(scene) {
  const world = {
    mapId: null,
    colliders: [],
    occluders: [],
    playerSpawns: [],
    botSpawns: [],
    waypoints: [],
    navigationPoints: [],
    jumpPads: [],
    crates: new Map(), // id -> {mesh, collider}
    renderStats: null,
    load,
    setCrate,
  };

  const group = new THREE.Group();
  scene.add(group);
  const materialCache = new Map();
  const activeGeometries = new Set();
  // Los batches reducen draw calls, pero son costosos para raycast porque su
  // bounding box abarca todo el mapa. Estos proxies unitarios conservan el
  // descarte AABB por pieza y comparten una sola geometría liviana.
  const occluderGeometry = new THREE.BoxGeometry(1, 1, 1);

  const mat = (color) => {
    if (!materialCache.has(color)) {
      materialCache.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return materialCache.get(color);
  };

  function load(mapId) {
    if (mapId === world.mapId) return;

    // Preparar y validar primero: si un mapa futuro está mal definido, el
    // mundo visible anterior permanece intacto en vez de quedar a medias.
    const data = buildMap(mapId);
    const colliders = buildColliders(data.boxes);
    const playerSpawns = requireSafeSpawnPoints(data.playerSpawns, colliders, {
      body: PLAYER_BODY,
      margin: 1,
      label: `${mapId}.playerSpawns`,
    });
    const botSpawns = requireSafeSpawnPoints(data.botSpawns, colliders, {
      body: BOT_BODY,
      margin: 0.15,
      label: `${mapId}.botSpawns`,
    });
    const waypoints = requireSafeSpawnPoints(data.waypoints, colliders, {
      body: BOT_BODY,
      margin: 0.05,
      label: `${mapId}.waypoints`,
    });
    const navigationSource = data.navigationPoints || data.waypoints;
    requireSafeSpawnPoints(
      navigationSource,
      colliders,
      { body: BOT_BODY, margin: 0.01, label: `${mapId}.navigationPoints` },
    );

    world.mapId = mapId;

    // Liberar cada recurso GPU una sola vez. Las cajas de igual tamaño pueden
    // compartir geometría, mientras que los lotes estáticos ya están unidos.
    for (const geometry of activeGeometries) geometry.dispose();
    activeGeometries.clear();

    // vaciar lo anterior
    group.clear();
    world.colliders.length = 0;
    world.occluders.length = 0;
    world.playerSpawns.length = 0;
    world.botSpawns.length = 0;
    world.waypoints.length = 0;
    world.navigationPoints.length = 0;
    world.jumpPads.length = 0;
    world.crates.clear();

    world.colliders.push(...colliders);

    const staticBatches = new Map();
    const sharedDynamicGeometry = new Map();
    for (const [boxIndex, b] of data.boxes.entries()) {
      const castShadow = castsUsefulShadow(b);
      if (!b.crate) {
        const occluder = new THREE.Mesh(occluderGeometry, mat(b.color));
        occluder.position.set(b.x, b.y, b.z);
        occluder.scale.set(b.w, b.h, b.d);
        occluder.userData = { mapOccluder: true, boxIndex };
        occluder.updateMatrix();
        occluder.matrixAutoUpdate = false;
        occluder.updateMatrixWorld(true);
        occluder.matrixWorldAutoUpdate = false;
        world.occluders.push(occluder);

        const key = `${b.color}|${castShadow ? 1 : 0}`;
        if (!staticBatches.has(key)) staticBatches.set(key, { color: b.color, castShadow, parts: [] });
        const geometry = collisionSafeBoxGeometry(b.w, b.h, b.d, roundingProfile(b));
        geometry.translate(b.x, b.y, b.z);
        staticBatches.get(key).parts.push(geometry);
        continue;
      }

      const profile = roundingProfile(b);
      const geometryKey = `${b.w}|${b.h}|${b.d}|${profile.ratio}|${profile.maxRadius}`;
      let geometry = sharedDynamicGeometry.get(geometryKey);
      if (!geometry) {
        geometry = collisionSafeBoxGeometry(b.w, b.h, b.d, profile);
        sharedDynamicGeometry.set(geometryKey, geometry);
        activeGeometries.add(geometry);
      }
      const mesh = new THREE.Mesh(geometry, mat(b.color));
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.userData = { crate: b.crate };
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      world.crates.set(b.crate, {
        mesh,
        collider: colliders.find((c) => c.crate === b.crate),
      });
      group.add(mesh);
      world.occluders.push(mesh);
    }

    for (const batch of staticBatches.values()) {
      const geometry = mergeMapGeometries(batch.parts);
      for (const part of batch.parts) part.dispose();
      if (!geometry) continue;
      activeGeometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, mat(batch.color));
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = true;
      mesh.userData = { mapBatch: true, sourceBoxes: batch.parts.length };
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }

    world.renderStats = Object.freeze({
      mapId,
      boxes: data.boxes.length,
      meshes: group.children.length,
      staticBatches: staticBatches.size,
      dynamicMeshes: world.crates.size,
      geometries: activeGeometries.size,
      shadowCasters: group.children.filter((mesh) => mesh.castShadow).length,
      raycastProxies: world.occluders.filter((mesh) => mesh.userData.mapOccluder).length,
    });

    const toVec = (p) => {
      const point = new THREE.Vector3(p.x, p.y, p.z);
      if (Number.isInteger(p.navigationRoute)) point.navigationRoute = p.navigationRoute;
      if (Number.isInteger(p.navigationOrder)) point.navigationOrder = p.navigationOrder;
      return point;
    };
    world.playerSpawns.push(...playerSpawns.map(toVec));
    world.botSpawns.push(...botSpawns.map(toVec));
    world.waypoints.push(...waypoints.map(toVec));
    world.navigationPoints.push(...navigationSource.map(toVec));
    world.jumpPads.push(...data.jumpPads);
  }

  // caja destruible: alive=false la oculta y quita su colisión; true la restaura
  function setCrate(id, alive) {
    const c = world.crates.get(id);
    if (!c) return null;
    const estaba = c.mesh.visible;
    c.mesh.visible = alive;
    const idx = world.colliders.indexOf(c.collider);
    if (!alive && idx >= 0) world.colliders.splice(idx, 1);
    if (alive && idx < 0) world.colliders.push(c.collider);
    // los occluders (balas/visión) siguen a la malla
    const oidx = world.occluders.indexOf(c.mesh);
    if (!alive && oidx >= 0) world.occluders.splice(oidx, 1);
    if (alive && oidx < 0) world.occluders.push(c.mesh);
    return estaba !== alive ? c.mesh.position : null;
  }

  load('arena');
  return world;
}
