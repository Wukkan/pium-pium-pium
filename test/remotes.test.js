import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { normalizeRemoteYaw, Remotes, sanitizeRemoteHealth } from '../src/remotes.js';
import { knifeDamageLimit } from '../src/shared/combat-rules.js';

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

test('remote health preserves reinforced zombie values above one hundred', () => {
  assert.equal(sanitizeRemoteHealth(148), 148);
  assert.equal(sanitizeRemoteHealth(-5), 0);
  assert.equal(sanitizeRemoteHealth(Number.NaN, 75), 75);
  assert.equal(sanitizeRemoteHealth(1e9), 10000);
});

test('remote yaw normalization is constant-time for extreme finite input', () => {
  const normalized = normalizeRemoteYaw(1e308);
  assert.equal(Number.isFinite(normalized), true);
  assert.equal(normalized >= -Math.PI && normalized <= Math.PI, true);
  assert.equal(normalizeRemoteYaw(Number.NaN, 0.5), 0.5);
});

test('disposing a remote session releases every entity and clears both registries', () => {
  let disposed = 0;
  const remotes = new Remotes({});
  remotes.players.set(1, { dispose() { disposed++; } });
  remotes.players.set(2, { dispose() { disposed++; } });
  remotes.bots.set('b1', { dispose() { disposed++; } });

  remotes.dispose();

  assert.equal(disposed, 3);
  assert.equal(remotes.players.size, 0);
  assert.equal(remotes.bots.size, 0);
  remotes.dispose();
  assert.equal(disposed, 3, 'dispose must be idempotent');
});

test('remote bots reverse only their visual pivot and keep authoritative yaw for backstabs', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  const scene = { add() {}, remove() {} };
  const remotes = new Remotes(scene);
  try {
    remotes.applySnapshot({
      pl: [{ id: 'p1', n: 'PLAYER', c: '#4a78aa', p: [0, 0, 0], ry: 0, rx: 0, s: 0, al: true, hp: 100 }],
      bots: [{ id: 'b1', n: 'BOT', c: '#aa4a4a', p: [2, 0, 0], ry: 0, s: 0, al: true, hp: 100, en: true }],
    }, 'self');
    remotes.update(1);

    const player = remotes.players.get('p1');
    const bot = remotes.bots.get('b1');
    player.rig.group.updateMatrixWorld(true);
    bot.rig.group.updateMatrixWorld(true);
    const localForward = new THREE.Vector3(0, 0, -1);
    const playerForward = localForward.clone().applyQuaternion(
      player.rig.visualRoot.getWorldQuaternion(new THREE.Quaternion()),
    );
    const botForward = localForward.clone().applyQuaternion(
      bot.rig.visualRoot.getWorldQuaternion(new THREE.Quaternion()),
    );

    assert.ok(Math.abs(playerForward.z + 1) < 1e-9, 'player must render toward protocol -Z');
    assert.ok(Math.abs(botForward.z - 1) < 1e-9, 'bot must render toward protocol +Z');
    assert.equal(bot.rig.group.rotation.y, 0, 'visual pivot must not replace authoritative bot yaw');
    assert.equal(
      knifeDamageLimit({ x: 2, z: -1 }, { x: 2, z: 0 }, bot.rig.group.rotation.y, 'bot'),
      100,
      'backstab calculation must continue receiving logical bot yaw',
    );
  } finally {
    remotes.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('first valid remote position snaps immediately instead of sliding from world origin', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  const remotes = new Remotes({ add() {}, remove() {} });
  try {
    remotes.applySnapshot({
      pl: [{ id: 'p1', n: 'PLAYER', c: '#4a78aa', p: [Number.NaN, 0, 0], ry: 0, rx: 0, s: 0, al: true, hp: 100 }],
      bots: [],
    }, 'self');
    assert.deepEqual(remotes.players.get('p1').rig.group.position.toArray(), [0, 0, 0]);

    remotes.applySnapshot({
      pl: [{ id: 'p1', n: 'PLAYER', c: '#4a78aa', p: [3, 0, 4], ry: 0, rx: 0, s: 0, al: true, hp: 100 }],
      bots: [],
    }, 'self');
    assert.deepEqual(remotes.players.get('p1').rig.group.position.toArray(), [3, 0, 4]);

    remotes.applySnapshot({
      pl: [{ id: 'p1', n: 'PLAYER', c: '#4a78aa', p: [4, 0, 4], ry: 0, rx: 0, s: 0, al: true, hp: 100 }],
      bots: [],
    }, 'self');
    assert.deepEqual(
      remotes.players.get('p1').rig.group.position.toArray(),
      [3, 0, 4],
      'later snapshots must remain interpolation targets',
    );
  } finally {
    remotes.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
