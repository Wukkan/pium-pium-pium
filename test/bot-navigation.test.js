import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ServerBot } from '../server/botai.js';
import { BotManager } from '../src/bots.js';
import {
  findBotNavigationRoute,
  isWalkableBotPath,
  reachableBotWaypoints,
} from '../src/shared/bot-navigation.js';
import { buildColliders, buildMap } from '../src/shared/mapdata.js';
import { BOT_BODY, isBodyPathClear, isSpawnPointSafe } from '../src/shared/spawn-safety.js';

const START = Object.freeze({ x: 0, y: 0.1, z: -20 });
const BEHIND_FACADE = Object.freeze({ x: 30, y: 0.1, z: -20 });
const SAME_STREET = Object.freeze({ x: 0, y: 0.1, z: -24 });
const ROOFTOP = Object.freeze({ x: 19, y: 5.7, z: -19 });

function cityFixture() {
  const map = buildMap('ciudad');
  const colliders = buildColliders(map.boxes);
  return { map, colliders };
}

function withRandom(value, run) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = original;
  }
}

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

function serverContext(bot, colliders, waypoints) {
  return {
    colliders,
    waypoints,
    players: [],
    bots: [bot],
    onShoot() {},
    onHitTarget() {},
  };
}

test('navigation fixture distinguishes open street from another level and a blocked facade', () => {
  const { colliders } = cityFixture();
  for (const point of [START, BEHIND_FACADE, SAME_STREET, ROOFTOP]) {
    assert.equal(
      isSpawnPointSafe(point, colliders, { body: BOT_BODY }),
      true,
      `fixture point must remain a safe body position: ${JSON.stringify(point)}`,
    );
  }

  assert.equal(isBodyPathClear(START, SAME_STREET, colliders, { body: BOT_BODY }), true);
  assert.equal(isBodyPathClear(START, BEHIND_FACADE, colliders, { body: BOT_BODY }), false);
  assert.equal(isBodyPathClear(START, ROOFTOP, colliders, { body: BOT_BODY }), false);
});

test('every map navigation point and bot spawn belongs to a reachable route', () => {
  for (const mapId of ['arena', 'ciudad']) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    const anchor = map.navigationPoints[0];
    for (const [index, point] of map.navigationPoints.entries()) {
      assert.ok(
        reachableBotWaypoints(point, map.navigationPoints, colliders).length > 0,
        `${mapId} navigation point ${index} is isolated`,
      );
      const reachesFromAnchor = isWalkableBotPath(anchor, point, colliders) ||
        findBotNavigationRoute(
          anchor, map.navigationPoints, colliders, { goal: point, allowPartial: false },
        ).length > 0;
      const returnsToAnchor = isWalkableBotPath(point, anchor, colliders) ||
        findBotNavigationRoute(
          point, map.navigationPoints, colliders, { goal: anchor, allowPartial: false },
        ).length > 0;
      assert.equal(reachesFromAnchor, true, `${mapId} navigation point ${index} is unreachable`);
      assert.equal(returnsToAnchor, true, `${mapId} navigation point ${index} cannot return`);
    }
    for (const [index, spawn] of map.botSpawns.entries()) {
      assert.ok(
        reachableBotWaypoints(spawn, map.navigationPoints, colliders).length > 0,
        `${mapId} bot spawn ${index} cannot enter navigation`,
      );
    }
  }
});

test('ServerBot skips blocked and cross-level patrol choices before it starts moving', () => {
  const { colliders } = cityFixture();
  const bot = new ServerBot('nav-server', 'NavServer', 0xffffff, {
    spawnPicker: () => ({ ...START }),
  });
  bot.stuckCheckAt = Infinity;
  const ctx = serverContext(bot, colliders, [BEHIND_FACADE, ROOFTOP, SAME_STREET]);

  // The old implementation indexes the whole array, so random=0 selects the
  // blocked facade. Navigation must filter first and then sample candidates.
  withRandom(0, () => bot.update(0, ctx));

  assert.deepEqual(bot.waypoint, SAME_STREET);
  assert.ok(Number.isFinite(bot.vel.x) && Number.isFinite(bot.vel.z));
});

test('ServerBot abandons a stale unreachable objective instead of jump-looping into its wall', () => {
  const { colliders } = cityFixture();
  const bot = new ServerBot('nav-stale', 'NavStale', 0xffffff, {
    spawnPicker: () => ({ ...START }),
  });
  bot.waypoint = { ...BEHIND_FACADE };
  bot.repathAt = Infinity;
  bot.onGround = true;
  bot.stuckCheckAt = 0;
  bot.lastCheckPos = { ...bot.pos };
  const ctx = serverContext(bot, colliders, [BEHIND_FACADE, SAME_STREET]);

  // First tick detects no progress; second tick performs the forced repath.
  // Sampling must not pick the same unreachable point again.
  withRandom(0, () => {
    bot.update(0, ctx);
    bot.update(0, ctx);
  });

  assert.deepEqual(bot.waypoint, SAME_STREET);
});

test('local bots use the same reachable-waypoint policy as ServerBot', () => {
  const { colliders } = cityFixture();
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  const scene = new THREE.Scene();
  const player = {
    dead: true,
    pos: new THREE.Vector3(34, 0.1, 34),
  };
  const world = {
    colliders,
    occluders: [],
    jumpPads: [],
    botSpawns: [new THREE.Vector3(START.x, START.y, START.z)],
    waypoints: [
      new THREE.Vector3(BEHIND_FACADE.x, BEHIND_FACADE.y, BEHIND_FACADE.z),
      new THREE.Vector3(ROOFTOP.x, ROOFTOP.y, ROOFTOP.z),
      new THREE.Vector3(SAME_STREET.x, SAME_STREET.y, SAME_STREET.z),
    ],
  };
  let manager;

  try {
    manager = withRandom(0, () => new BotManager(scene, world, player, {}, null, 1));
    manager.bots[0].stuckCheckAt = Infinity;
    withRandom(0, () => manager.update(0));
    assert.deepEqual(manager.bots[0].waypoint.toArray(), [SAME_STREET.x, SAME_STREET.y, SAME_STREET.z]);

    manager.bots[0].waypoint.set(BEHIND_FACADE.x, BEHIND_FACADE.y, BEHIND_FACADE.z);
    manager.bots[0].repathAt = Infinity;
    manager.bots[0].onGround = true;
    manager.bots[0].stuckCheckAt = 0;
    manager.bots[0].lastCheckPos.copy(manager.bots[0].pos);
    world.waypoints.splice(0, world.waypoints.length,
      new THREE.Vector3(BEHIND_FACADE.x, BEHIND_FACADE.y, BEHIND_FACADE.z),
      new THREE.Vector3(SAME_STREET.x, SAME_STREET.y, SAME_STREET.z));
    withRandom(0, () => {
      manager.update(0);
      manager.update(0);
    });
    assert.deepEqual(manager.bots[0].waypoint.toArray(), [SAME_STREET.x, SAME_STREET.y, SAME_STREET.z]);
  } finally {
    manager?.setCount(0);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('local patrol remains stable when a room temporarily has no waypoint candidates', () => {
  const { colliders } = cityFixture();
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let manager;
  try {
    manager = new BotManager(
      { add() {}, remove() {} },
      {
        colliders,
        occluders: [],
        jumpPads: [],
        botSpawns: [new THREE.Vector3(START.x, START.y, START.z)],
        waypoints: [],
      },
      { dead: true, pos: new THREE.Vector3(34, 0.1, 34) },
      {},
      null,
      1,
    );

    assert.doesNotThrow(() => manager.update(1 / 60));
    assert.equal(manager.bots[0].waypoint, null);
    assert.ok(manager.bots[0].pos.toArray().every(Number.isFinite));
  } finally {
    manager?.setCount(0);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('navigation graph cache keeps identical rooms isolated when one destroys cover', () => {
  const ground = {
    minX: -20, minY: -1, minZ: -10,
    maxX: 120, maxY: 0, maxZ: 10,
  };
  const leftWall = {
    minX: -0.5, minY: 0, minZ: -1,
    maxX: 0.5, maxY: 3, maxZ: 1,
    crate: 'left',
  };
  const remoteWall = {
    minX: 99.5, minY: 0, minZ: -1,
    maxX: 100.5, maxY: 3, maxZ: 1,
    crate: 'remote',
  };
  const roomAColliders = [ground, leftWall, remoteWall].map((collider) => ({ ...collider }));
  const roomBColliders = [ground, leftWall, remoteWall].map((collider) => ({ ...collider }));
  const baseWaypoints = [
    { x: -3, y: 0.001, z: 2 },
    { x: 0, y: 0.001, z: 2 },
    { x: 3, y: 0.001, z: 2 },
    { x: 98, y: 0.001, z: 0 },
    { x: 102, y: 0.001, z: 0 },
  ];
  const roomAWaypoints = baseWaypoints.map((point) => ({ ...point }));
  const roomBWaypoints = baseWaypoints.map((point) => ({ ...point }));

  const warmRoute = findBotNavigationRoute(
    { x: -4, y: 0.001, z: 0 },
    roomAWaypoints,
    roomAColliders,
    { goal: { x: 4, y: 0.001, z: 0 }, allowPartial: false },
  );
  assert.ok(warmRoute.length > 0, 'room A must populate its graph cache');

  roomAColliders.splice(2, 1); // solo la sala A destruye la cobertura remota
  const roomBStart = { x: 96, y: 0.001, z: 0 };
  const roomBGoal = { x: 104, y: 0.001, z: 0 };
  assert.equal(isWalkableBotPath(roomBStart, roomBGoal, roomBColliders), false);
  assert.deepEqual(
    findBotNavigationRoute(
      roomBStart,
      roomBWaypoints,
      roomBColliders,
      { goal: roomBGoal, allowPartial: false },
    ),
    [],
    'room B must retain its own blocker instead of reusing room A colliders',
  );
});

test('authoritative zombies navigate facades, rooftops, and arena structures', () => {
  const routes = [
    {
      label: 'street facade',
      mapId: 'ciudad',
      start: START,
      target: BEHIND_FACADE,
      seconds: 20,
    },
    {
      label: 'rooftop staircase',
      mapId: 'ciudad',
      start: { x: 19, y: 0.1, z: -8 },
      target: ROOFTOP,
      seconds: 14,
    },
    {
      label: 'arena structure detour',
      mapId: 'arena',
      start: { x: 30, y: 0.1, z: -15 },
      target: { x: -20, y: 0.1, z: 0 },
      seconds: 24,
    },
  ];
  const originalNow = Date.now;

  try {
    for (const route of routes) {
      const map = buildMap(route.mapId);
      const colliders = buildColliders(map.boxes);
      let milliseconds = 0;
      Date.now = () => milliseconds;
      const zombie = new ServerBot(`z-${route.label}`, route.label, 0x69a05a, {
        zombie: true,
        spawnPicker: () => ({ ...route.start }),
      });
      const target = {
        pos: { ...route.target },
        alive: true,
        team: null,
        speed: 0,
        sliding: false,
      };
      const ctx = {
        colliders,
        waypoints: map.navigationPoints,
        players: [target],
        bots: [zombie],
        onShoot() {},
        onHitTarget() {},
      };

      let reached = false;
      for (let frame = 0; frame < route.seconds * 60; frame++) {
        milliseconds += 1000 / 60;
        zombie.update(1 / 60, ctx);
        const horizontal = Math.hypot(
          zombie.pos.x - target.pos.x,
          zombie.pos.z - target.pos.z,
        );
        if (horizontal < 0.7 && Math.abs(zombie.pos.y - target.pos.y) < 0.8) {
          reached = true;
          break;
        }
      }
      assert.equal(
        reached,
        true,
        `${route.label} route stalled at ${JSON.stringify(zombie.pos)}`,
      );
    }
  } finally {
    Date.now = originalNow;
  }
});
