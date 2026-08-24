import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  GrenadeManager, MAX_REMOTE_GRENADES, validRemoteGrenadePayload,
} from '../src/grenades.js';

test('remote grenade payloads require finite bounded vectors', () => {
  assert.equal(validRemoteGrenadePayload([0, 1, 2], [10, 20, 30]), true);
  assert.equal(validRemoteGrenadePayload([0, 1], [10, 20, 30]), false);
  assert.equal(validRemoteGrenadePayload([0, Number.NaN, 2], [10, 20, 30]), false);
  assert.equal(validRemoteGrenadePayload([0, 1, 2], [10, 20, 1000]), false);
});

test('remote grenade visuals stay inside a fixed resource budget', () => {
  const scene = new THREE.Scene();
  const manager = new GrenadeManager(scene, [], { explosion() {} }, { boom() {} });
  for (let index = 0; index < MAX_REMOTE_GRENADES + 20; index++) {
    assert.equal(manager.spawnRemote([index, 1, 0], [1, 2, 3]), true);
  }
  assert.equal(manager.grenades.length, MAX_REMOTE_GRENADES);
  assert.equal(scene.children.length, MAX_REMOTE_GRENADES);
});
