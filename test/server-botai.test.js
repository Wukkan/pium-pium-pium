import test from 'node:test';
import assert from 'node:assert/strict';

import { ServerBot } from '../server/botai.js';

function zombieMeleeHarness(colliders = []) {
  const zombie = new ServerBot('z-test', 'Zombi_test', 0x69a05a, {
    zombie: true,
    spawnPicker: () => ({ x: 0, y: 0, z: 0 }),
  });
  const player = {
    pos: { x: 1.2, y: 0, z: 0 },
    alive: true,
    team: null,
    speed: 0,
    sliding: false,
  };
  const hits = [];
  const ctx = {
    colliders,
    waypoints: [],
    players: [player],
    bots: [zombie],
    onShoot() {},
    onHitTarget(...args) { hits.push(args); },
  };
  return { zombie, player, hits, ctx };
}

test('zombie melee requires a clear segment to the target', () => {
  const wall = {
    minX: 0.5, maxX: 0.7,
    minY: -1, maxY: 3,
    minZ: -2, maxZ: 2,
  };
  const { zombie, hits, ctx } = zombieMeleeHarness([wall]);

  zombie.update(0, ctx);
  assert.equal(hits.length, 0, 'a wall must block melee damage');

  ctx.colliders.length = 0;
  zombie.update(0, ctx);
  assert.equal(hits.length, 1, 'the same nearby target is hit once line of sight is clear');
});
