import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BotManager, playLocalBotShot } from '../src/bots.js';

function canvasDocument() {
  return {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            font: '', textAlign: '', textBaseline: '', lineWidth: 0,
            strokeStyle: '', fillStyle: '', strokeText() {}, fillText() {},
          };
        },
      };
    },
  };
}

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

test('local bots render toward logical +Z while preserving their combat yaw', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let manager;
  try {
    const floor = { minX: -5, maxX: 5, minY: -1, maxY: 0, minZ: -5, maxZ: 5 };
    manager = new BotManager(
      { add() {}, remove() {} },
      {
        botSpawns: [new THREE.Vector3(0, 0, 0)],
        colliders: [floor],
        occluders: [],
        waypoints: [new THREE.Vector3(0, 0, 2)],
      },
      { dead: true, pos: new THREE.Vector3(20, 0, 20) },
      {},
      null,
      1,
    );

    const bot = manager.bots[0];
    bot.group.updateMatrixWorld(true);
    const renderedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      bot.rig.visualRoot.getWorldQuaternion(new THREE.Quaternion()),
    );
    assert.equal(bot.yaw, 0);
    assert.equal(bot.group.rotation.y, 0);
    assert.ok(Math.abs(renderedForward.x) < 1e-9);
    assert.ok(Math.abs(renderedForward.z - 1) < 1e-9);
  } finally {
    manager?.setCount(0);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('local bots use the same jump pads as authoritative bots', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let manager;
  try {
    const floor = { minX: -5, maxX: 5, minY: -1, maxY: 0, minZ: -5, maxZ: 5 };
    const padCollider = { minX: -0.8, maxX: 0.8, minY: 0, maxY: 0.2, minZ: -0.8, maxZ: 0.8 };
    manager = new BotManager(
      { add() {}, remove() {} },
      {
        botSpawns: [new THREE.Vector3(3, 0.1, 3)],
        colliders: [floor, padCollider],
        occluders: [],
        waypoints: [new THREE.Vector3(3, 0.1, 2)],
        jumpPads: [{ x: 0, y: 0, z: 0, power: 18 }],
      },
      { dead: true, pos: new THREE.Vector3(20, 0, 20) },
      {},
      null,
      1,
    );
    const bot = manager.bots[0];
    bot.pos.set(0, 0.201, 0);
    bot.vel.set(0, 0, 0);
    bot.update(1 / 60, manager.ctx);
    assert.equal(bot.vel.y, 18);
    assert.equal(bot.onGround, false);
  } finally {
    manager?.setCount(0);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
