import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { playLocalBotShot } from '../src/bots.js';

test('local bot shots use the bot origin and the real player listener orientation', () => {
  const calls = [];
  const audio = {
    shotAt(...args) { calls.push(args); return { pan: 0.5 }; },
  };
  const player = {
    pos: new THREE.Vector3(2, 3, 4),
    eyePosition(target) { return target.set(2, 4.6, 4); },
    camera: {
      getWorldDirection(target) { return target.set(0.6, 0, -0.8); },
    },
  };
  const origin = new THREE.Vector3(-4, 1.3, 10);

  const result = playLocalBotShot(audio, origin, player, 12);

  assert.deepEqual(result, { pan: 0.5 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'smg');
  assert.deepEqual(calls[0][1].toArray(), [-4, 1.3, 10]);
  assert.deepEqual(calls[0][2].toArray(), [2, 4.6, 4]);
  assert.deepEqual(calls[0][3].toArray(), [0.6, 0, -0.8]);
  assert.equal(calls[0][4], 0.7);
});

test('local bot audio keeps the centered fallback for legacy mocks', () => {
  const calls = [];
  const audio = {
    distVol(distance) { assert.equal(distance, 20); return 0.4; },
    shot(...args) { calls.push(args); },
  };

  playLocalBotShot(audio, new THREE.Vector3(), { pos: new THREE.Vector3(), yaw: Math.PI / 2 }, 20);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'smg');
  assert.ok(Math.abs(calls[0][1] - 0.28) < 1e-10);
});
