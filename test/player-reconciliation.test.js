import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Player } from '../src/player.js';

test('authoritative correction resolves movement divergence without resetting combat state', () => {
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    pos: new THREE.Vector3(8, 2, -5),
    vel: new THREE.Vector3(7, 3, 1),
    sliding: true,
    slideTime: 0.4,
    onGround: true,
    health: 73,
    yaw: 1.2,
  });

  assert.equal(player.correctPosition([1, 0.1, 2]), true);
  assert.deepEqual(player.pos.toArray(), [1, 0.1, 2]);
  assert.deepEqual(player.vel.toArray(), [0, 0, 0]);
  assert.equal(player.sliding, false);
  assert.equal(player.slideTime, 0);
  assert.equal(player.onGround, false);
  assert.equal(player.health, 73);
  assert.equal(player.yaw, 1.2);

  assert.equal(player.correctPosition([Number.NaN, 0, 0]), false);
  assert.deepEqual(player.pos.toArray(), [1, 0.1, 2]);
});
