import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildMap, buildColliders } from '../src/shared/mapdata.js';
import { buildWorld } from '../src/world.js';

const closeTo = (actual, expected, epsilon = 1e-5) =>
  Math.abs(actual - expected) <= epsilon;

test('all map boxes preserve solid AABB cover with softened collision-safe edges', () => {
  const scene = new THREE.Scene();
  const world = buildWorld(scene);
  const mapGroup = scene.children.find((child) => child.isGroup);

  for (const mapId of ['arena', 'ciudad']) {
    world.load(mapId);
    const data = buildMap(mapId);
    assert.equal(mapGroup.children.length, data.boxes.length);
    assert.deepEqual(world.colliders, buildColliders(data.boxes));
    assert.equal(world.playerSpawns.length, 10);

    let totalVertices = 0;
    let softenedCorners = 0;

    for (let index = 0; index < data.boxes.length; index++) {
      const box = data.boxes[index];
      const mesh = mapGroup.children[index];
      const geometry = mesh.geometry;
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

      mesh.updateMatrixWorld(true);
      const edgeInset = Math.min(box.w, box.h) * 0.0001;
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(
          box.x + box.w / 2 - edgeInset,
          box.y + box.h / 2 - edgeInset,
          box.z + box.d / 2 + 1,
        ),
        new THREE.Vector3(0, 0, -1),
      );
      assert.ok(
        raycaster.intersectObject(mesh, false).length > 0,
        `${mapId} box ${index} has an uncovered collider corner`,
      );

      const normals = geometry.attributes.normal.array;
      for (let normalIndex = 0; normalIndex < normals.length; normalIndex += 3) {
        const axes = [normals[normalIndex], normals[normalIndex + 1], normals[normalIndex + 2]]
          .filter((value) => Math.abs(value) > 0.05).length;
        if (axes >= 2) {
          softenedCorners++;
          break;
        }
      }
    }

    assert.ok(totalVertices <= 12000, `${mapId} total map vertex budget`);
    assert.equal(softenedCorners, data.boxes.length, `${mapId} lost softened edge normals`);

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
