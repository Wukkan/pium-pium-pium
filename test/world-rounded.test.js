import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildMap, buildColliders, COLORS } from '../src/shared/mapdata.js';
import { buildWorld } from '../src/world.js';

const closeTo = (actual, expected, epsilon = 1e-5) =>
  Math.abs(actual - expected) <= epsilon;

test('all map boxes use bounded rounded geometry without changing extents or collision', () => {
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
    let crateRadius = 0;
    let perimeterWallRadius = Infinity;

    for (let index = 0; index < data.boxes.length; index++) {
      const box = data.boxes[index];
      const mesh = mapGroup.children[index];
      const geometry = mesh.geometry;
      assert.equal(geometry.type, 'RoundedBoxGeometry', `${mapId} box ${index}`);
      assert.ok(geometry.parameters.radius > 0, `${mapId} box ${index} radius`);
      assert.ok(geometry.parameters.segments >= 1 && geometry.parameters.segments <= 2);

      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      assert.ok(closeTo(size.x, box.w), `${mapId} box ${index} width`);
      assert.ok(closeTo(size.y, box.h), `${mapId} box ${index} height`);
      assert.ok(closeTo(size.z, box.d), `${mapId} box ${index} depth`);

      const vertexCount = geometry.getAttribute('position').count;
      totalVertices += vertexCount;
      assert.ok(vertexCount <= 900, `${mapId} box ${index} vertex budget`);
      if (box.crate) crateRadius = Math.max(crateRadius, geometry.parameters.radius);
      if (box.color === COLORS.wall && Math.max(box.w, box.d) > 70) {
        perimeterWallRadius = Math.min(perimeterWallRadius, geometry.parameters.radius);
      }
    }

    assert.ok(totalVertices <= 100000, `${mapId} total rounded-map vertex budget`);
    assert.ok(crateRadius > perimeterWallRadius, `${mapId} crates should be rounder than long walls`);

    const [crateId, crate] = world.crates.entries().next().value;
    const colliderCount = world.colliders.length;
    world.setCrate(crateId, false);
    assert.equal(crate.mesh.visible, false);
    assert.equal(world.colliders.length, colliderCount - 1);
    world.setCrate(crateId, true);
    assert.equal(crate.mesh.visible, true);
    assert.equal(world.colliders.length, colliderCount);
    assert.equal(crate.mesh.geometry.type, 'RoundedBoxGeometry');
  }
});
