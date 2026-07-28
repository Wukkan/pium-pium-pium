import * as THREE from 'three';
import {
  buildMapBoxes, buildColliders, PLAYER_SPAWNS, BOT_SPAWNS, WAYPOINTS,
} from './shared/mapdata.js';

// ---------------------------------------------------------------------------
// Construye la escena 3D del mapa a partir de los datos compartidos con el
// servidor (src/shared/mapdata.js). La física vive en src/shared/physics.js.
// ---------------------------------------------------------------------------

export function buildWorld(scene) {
  const boxes = buildMapBoxes();
  const colliders = buildColliders(boxes);
  const occluders = [];
  const materialCache = new Map();

  const mat = (color) => {
    if (!materialCache.has(color)) {
      materialCache.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return materialCache.get(color);
  };

  for (const b of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat(b.color));
    mesh.position.set(b.x, b.y, b.z);
    mesh.castShadow = b.h < 6.5; // los muros y el suelo no proyectan
    mesh.receiveShadow = true;
    scene.add(mesh);
    occluders.push(mesh);
  }

  const toVec = (p) => new THREE.Vector3(p.x, p.y, p.z);

  return {
    colliders,
    occluders,
    playerSpawns: PLAYER_SPAWNS.map(toVec),
    botSpawns: BOT_SPAWNS.map(toVec),
    waypoints: WAYPOINTS.map(toVec),
  };
}
