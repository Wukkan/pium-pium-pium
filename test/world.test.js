import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildWorld } from '../src/world.js';

test('map reload keeps shared arrays stable and disposes old GPU geometries', () => {
  const scene = new THREE.Scene();
  const world = buildWorld(scene);
  const refs = {
    colliders: world.colliders,
    playerSpawns: world.playerSpawns,
    botSpawns: world.botSpawns,
    waypoints: world.waypoints,
    navigationPoints: world.navigationPoints,
  };
  const mapGroup = scene.children.find((child) => child.isGroup);
  const oldGeometries = mapGroup.children.map((mesh) => mesh.geometry);
  let disposed = 0;
  for (const geometry of oldGeometries) geometry.addEventListener('dispose', () => disposed++);

  world.load('ciudad');

  assert.equal(disposed, oldGeometries.length);
  assert.equal(world.colliders, refs.colliders);
  assert.equal(world.playerSpawns, refs.playerSpawns);
  assert.equal(world.botSpawns, refs.botSpawns);
  assert.equal(world.waypoints, refs.waypoints);
  assert.equal(world.navigationPoints, refs.navigationPoints);
  assert.equal(world.mapId, 'ciudad');
  assert.equal(world.playerSpawns.length, 10);
  assert.ok(world.navigationPoints.some((point) =>
    Number.isInteger(point.navigationRoute) && Number.isInteger(point.navigationOrder)));
  assert.deepEqual(world.renderStats, {
    mapId: 'ciudad',
    boxes: 100,
    meshes: 27,
    staticBatches: 13,
    dynamicMeshes: 14,
    geometries: 14,
    shadowCasters: 21,
    raycastProxies: 86,
  });
});
