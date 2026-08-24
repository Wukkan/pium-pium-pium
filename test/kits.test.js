import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposePickupMesh, KitManager } from '../src/kits.js';

test('pickup disposal releases shared geometry, material, and texture once', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.alphaMap = texture;
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

  let geometryDisposals = 0;
  let materialDisposals = 0;
  let textureDisposals = 0;
  geometry.dispose = () => { geometryDisposals++; };
  material.dispose = () => { materialDisposals++; };
  texture.dispose = () => { textureDisposals++; };

  assert.deepEqual(disposePickupMesh(root), { geometries: 1, materials: 1, textures: 1 });
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(textureDisposals, 1);
});

test('KitManager.remove detaches and disposes a pickup only once', () => {
  const scene = new THREE.Scene();
  const manager = new KitManager(scene);
  manager.spawnLocal({ x: 0, y: 0, z: 0 });
  const [id, kit] = manager.kits.entries().next().value;

  const geometries = new Set();
  const materials = new Set();
  kit.mesh.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const geometry of geometries) geometry.dispose = () => { geometryDisposals++; };
  for (const material of materials) material.dispose = () => { materialDisposals++; };

  manager.remove(id);
  manager.remove(id);

  assert.equal(manager.kits.size, 0);
  assert.equal(scene.children.includes(kit.mesh), false);
  assert.equal(geometryDisposals, geometries.size);
  assert.equal(materialDisposals, materials.size);
});
