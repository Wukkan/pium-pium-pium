import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  combatAudioAllowed,
  GrenadeManager,
  MAX_REMOTE_GRENADES,
  playSpatialBoom,
  validRemoteGrenadePayload,
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

test('combat audio is silent outside active unobstructed gameplay', () => {
  assert.equal(combatAudioAllowed({ state: 'playing' }), true);
  assert.equal(combatAudioAllowed({ state: 'menu' }), false);
  assert.equal(combatAudioAllowed({ state: 'dead' }), false);
  assert.equal(combatAudioAllowed({ state: 'playing', dead: true }), false);
  assert.equal(combatAudioAllowed({ state: 'playing', overlayOpen: true }), false);
  assert.equal(combatAudioAllowed({ state: 'playing', hidden: true }), false);
});

test('explosions prefer spatial boomAt and honor the gameplay audio gate', () => {
  const calls = [];
  const audio = {
    boomAt(...args) { calls.push(['spatial', ...args]); },
    boom(...args) { calls.push(['fallback', ...args]); },
  };
  const source = new THREE.Vector3(4, 2, -3);
  const listener = new THREE.Vector3(1, 1.6, 2);
  const forward = new THREE.Vector3(0.5, 0, -0.5);

  assert.equal(playSpatialBoom(audio, source, listener, forward, 0.3, false), false);
  assert.deepEqual(calls, []);
  assert.equal(playSpatialBoom(audio, source, listener, forward, 0.3, true), true);
  assert.deepEqual(calls, [['spatial', source, listener, forward, 0.3]]);
});

test('grenade explosions consult the audio gate at explosion time', () => {
  const scene = new THREE.Scene();
  const calls = [];
  let enabled = false;
  const manager = new GrenadeManager(
    scene,
    [],
    { explosion() {} },
    { boomAt(...args) { calls.push(args); } },
    { shouldPlayAudio: () => enabled },
  );
  const listener = new THREE.Vector3(0, 1.6, 0);
  const forward = new THREE.Vector3(0, 0, -1);

  manager.spawnRemote([2, 1, 0], [0, 0, 0]);
  manager.grenades[0].fuse = 0;
  manager.update(0.01, listener, forward);
  assert.equal(calls.length, 0);

  enabled = true;
  manager.spawnRemote([3, 1, 0], [0, 0, 0]);
  manager.grenades[0].fuse = 0;
  manager.update(0.01, listener, forward);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [listener, forward, 1]);
});
