import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildMap, buildColliders } from '../src/shared/mapdata.js';
import { collisionSafeBoxGeometry } from '../src/rounded-geometry.js';
import { buildWorld, roundingProfile } from '../src/world.js';

const closeTo = (actual, expected, epsilon = 1e-5) =>
  Math.abs(actual - expected) <= epsilon;

test('all map boxes preserve solid rounded cover after static batching', () => {
  const scene = new THREE.Scene();
  const world = buildWorld(scene);
  const mapGroup = scene.children.find((child) => child.isGroup);

  for (const mapId of ['arena', 'ciudad']) {
    world.load(mapId);
    const data = buildMap(mapId);
    assert.deepEqual(world.colliders, buildColliders(data.boxes));
    assert.equal(world.playerSpawns.length, 10);

    let totalVertices = 0;
    let softenedCorners = 0;

    // Audita cada pieza antes del batching: dimensiones, volumen exterior y
    // normales continúan dependiendo de la forma propia de esa caja.
    for (let index = 0; index < data.boxes.length; index++) {
      const box = data.boxes[index];
      const geometry = collisionSafeBoxGeometry(box.w, box.h, box.d, roundingProfile(box));
      assert.equal(geometry.type, 'CollisionSafeBoxGeometry', `${mapId} box ${index}`);
      assert.ok(geometry.parameters.radius > 0, `${mapId} box ${index} radius`);
      assert.equal(geometry.parameters.bands, 3);

      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      assert.ok(closeTo(size.x, box.w), `${mapId} box ${index} width`);
      assert.ok(closeTo(size.y, box.h), `${mapId} box ${index} height`);
      assert.ok(closeTo(size.z, box.d), `${mapId} box ${index} depth`);

      const vertexCount = geometry.getAttribute('position').count;
      totalVertices += vertexCount;
      assert.ok(vertexCount <= 100, `${mapId} box ${index} vertex budget`);

      const normals = geometry.attributes.normal.array;
      for (let normalIndex = 0; normalIndex < normals.length; normalIndex += 3) {
        const axes = [normals[normalIndex], normals[normalIndex + 1], normals[normalIndex + 2]]
          .filter((value) => Math.abs(value) > 0.05).length;
        if (axes >= 2) {
          softenedCorners++;
          break;
        }
      }
      geometry.dispose();
    }

    assert.ok(totalVertices <= 12000, `${mapId} total map vertex budget`);
    assert.equal(softenedCorners, data.boxes.length, `${mapId} lost softened edge normals`);

    // El raycast visual se hace contra los lotes finales, no contra proxies,
    // para impedir que una unión abra un hueco frente al collider.
    scene.updateMatrixWorld(true);
    for (let index = 0; index < data.boxes.length; index++) {
      const box = data.boxes[index];
      const edgeInset = Math.min(box.w, box.h) * 0.0001;
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(
          box.x + box.w / 2 - edgeInset,
          box.y + box.h / 2 - edgeInset,
          box.z + box.d / 2 + 1,
        ),
        new THREE.Vector3(0, 0, -1),
      );
      const frontZ = box.z + box.d / 2;
      const covered = raycaster.intersectObjects(mapGroup.children, false).some((hit) =>
        closeTo(hit.point.z, frontZ, 1e-4) &&
        hit.point.x >= box.x - box.w / 2 - 1e-4 &&
        hit.point.x <= box.x + box.w / 2 + 1e-4 &&
        hit.point.y >= box.y - box.h / 2 - 1e-4 &&
        hit.point.y <= box.y + box.h / 2 + 1e-4);
      assert.ok(covered, `${mapId} box ${index} has an uncovered collider corner after batching`);
    }

    const budget = mapId === 'arena'
      ? { meshes: 34, shadows: 30 }
      : { meshes: 27, shadows: 21 };
    assert.equal(mapGroup.children.length, world.renderStats.meshes);
    assert.ok(world.renderStats.meshes <= budget.meshes, `${mapId} exceeded mesh budget`);
    assert.ok(world.renderStats.shadowCasters <= budget.shadows, `${mapId} exceeded shadow budget`);
    assert.ok(world.renderStats.meshes < data.boxes.length * 0.35, `${mapId} was not batched`);
    assert.ok(mapGroup.children.every((mesh) => mesh.matrixAutoUpdate === false));
    assert.ok(mapGroup.children
      .filter((mesh) => mesh.userData.mapBatch)
      .every((mesh) => mesh.geometry.type === 'BatchedMapGeometry'));
    assert.equal(world.occluders.length, data.boxes.length);
    const staticProxies = world.occluders.filter((mesh) => mesh.userData.mapOccluder);
    assert.equal(staticProxies.length, data.boxes.filter((box) => !box.crate).length);
    assert.equal(new Set(staticProxies.map((mesh) => mesh.geometry)).size, 1);
    assert.ok(staticProxies.every((mesh) => !mesh.parent && mesh.matrixAutoUpdate === false));
    assert.equal(world.renderStats.raycastProxies, staticProxies.length);

    const [crateId, crate] = world.crates.entries().next().value;
    const colliderCount = world.colliders.length;
    world.setCrate(crateId, false);
    assert.equal(crate.mesh.visible, false);
    assert.equal(world.colliders.length, colliderCount - 1);
    world.setCrate(crateId, true);
    assert.equal(crate.mesh.visible, true);
    assert.equal(world.colliders.length, colliderCount);
    assert.equal(crate.mesh.geometry.type, 'CollisionSafeBoxGeometry');
  }
});
