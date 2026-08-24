import * as THREE from 'three';
import { buildMap, buildColliders } from './shared/mapdata.js';
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

export function buildWorld(scene) {
  const world = {
    mapId: null,
    colliders: [],
    occluders: [],
    playerSpawns: [],
    botSpawns: [],
    waypoints: [],
    jumpPads: [],
    crates: new Map(), // id -> {mesh, collider}
    load,
    setCrate,
  };

  const group = new THREE.Group();
  scene.add(group);
  const materialCache = new Map();

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

    world.mapId = mapId;

    // Liberar las geometrías del mapa anterior antes de reconstruirlo. Los
    // materiales se conservan en caché y se reutilizan entre mapas.
    group.traverse((object) => {
      if (object !== group && object.geometry?.dispose) object.geometry.dispose();
    });

    // vaciar lo anterior
    group.clear();
    world.colliders.length = 0;
    world.occluders.length = 0;
    world.playerSpawns.length = 0;
    world.botSpawns.length = 0;
    world.waypoints.length = 0;
    world.jumpPads.length = 0;
    world.crates.clear();

    world.colliders.push(...colliders);

    for (const b of data.boxes) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat(b.color));
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = b.h < 6.5;
      mesh.receiveShadow = true;
      if (b.crate) {
        mesh.userData = { crate: b.crate };
        world.crates.set(b.crate, {
          mesh,
          collider: colliders.find((c) => c.crate === b.crate),
        });
      }
      group.add(mesh);
      world.occluders.push(mesh);
    }

    const toVec = (p) => new THREE.Vector3(p.x, p.y, p.z);
    world.playerSpawns.push(...playerSpawns.map(toVec));
    world.botSpawns.push(...botSpawns.map(toVec));
    world.waypoints.push(...waypoints.map(toVec));
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
