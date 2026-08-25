import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Effects } from '../src/effects.js';
import { GrenadeManager } from '../src/grenades.js';
import { KitManager } from '../src/kits.js';

test('health and ammunition pickups contain no sharp box geometry', () => {
  const scene = new THREE.Scene();
  const manager = new KitManager(scene);
  manager.spawnLocal({ x: 0, y: 0, z: 0 }, 'health');
  manager.spawnLocal({ x: 2, y: 0, z: 0 }, 'ammo');

  for (const kit of manager.kits.values()) {
    kit.mesh.traverse((part) => {
      if (!part.isMesh) return;
      assert.notEqual(part.geometry.type, 'BoxGeometry');
      assert.equal(part.geometry.type, 'RoundedBoxGeometry');
      assert.ok(part.geometry.parameters.radius > 0);
    });
  }
  for (const id of [...manager.kits.keys()]) manager.remove(id);
});

test('grenade body and safety band use smooth geometry', () => {
  const scene = new THREE.Scene();
  const manager = new GrenadeManager(scene, [], { explosion() {} }, { boom() {} });
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  camera.updateMatrixWorld(true);
  assert.equal(manager.throwFrom(camera), true);

  const meshes = manager.grenades[0].mesh.children.filter((child) => child.isMesh);
  assert.equal(meshes[0].geometry.type, 'SphereGeometry');
  assert.equal(meshes[0].geometry.parameters.widthSegments, 16);
  assert.equal(meshes[1].geometry.type, 'RoundedBoxGeometry');
  assert.ok(meshes[1].geometry.parameters.radius > 0);
});

test('combat effects use rounded tracers, particles, smoke, and casings', () => {
  const effects = new Effects(new THREE.Scene());
  assert.equal(effects.tracerGeo.type, 'RoundedBoxGeometry');
  assert.equal(effects.tracerGeo.parameters.radius, 0.48);
  assert.equal(effects.particleGeo.type, 'SphereGeometry');
  assert.equal(effects.smokeGeo.parameters.widthSegments, 12);
  assert.equal(effects.casingGeo.parameters.radialSegments, 12);
});
