import test from 'node:test';
import assert from 'node:assert/strict';
import { buildColliders, buildMap } from '../src/shared/mapdata.js';
import { moveBody } from '../src/shared/physics.js';
import {
  BOT_BODY,
  PLAYER_BODY,
  bodyOverlapsCollider,
  bodyPenetratesCollider,
  colliderOccupied,
  inspectSpawnPoint,
  isBodyPathClear,
  isSpawnPointSafe,
  selectSafeSpawn,
  validateSpawnPoints,
} from '../src/shared/spawn-safety.js';

const MAP_IDS = ['arena', 'ciudad'];

test('every map exposes ten unique fixed player spawns with one metre of clearance', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    const audit = validateSpawnPoints(map.playerSpawns, colliders, {
      body: PLAYER_BODY,
      margin: 1,
    });

    assert.equal(audit.invalid.length, 0, `${mapId} has blocked player spawns`);
    assert.equal(audit.valid.length, 10, `${mapId} must cover a full ten-player room`);
    assert.equal(new Set(audit.valid.map((point) => `${point.x}/${point.y}/${point.z}`)).size, 10);

    for (let i = 0; i < audit.valid.length; i++) {
      for (let j = i + 1; j < audit.valid.length; j++) {
        const a = audit.valid[i], b = audit.valid[j];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 10,
          `${mapId} spawns ${i}/${j} are too close`);
      }
    }
  }
});

test('bot spawns and patrol waypoints are clear and supported on every map', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    assert.equal(validateSpawnPoints(map.botSpawns, colliders, {
      body: BOT_BODY,
      margin: 0.15,
    }).invalid.length, 0, `${mapId} has blocked bot spawns`);
    assert.equal(validateSpawnPoints(map.waypoints, colliders, {
      body: BOT_BODY,
      margin: 0.05,
    }).invalid.length, 0, `${mapId} has blocked waypoints`);
  }
});

test('maximum zombie waves reserve twenty distinct points even with ten players', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    const pool = validateSpawnPoints([
      ...map.botSpawns, ...map.playerSpawns, ...map.waypoints,
    ], colliders, { body: BOT_BODY, margin: 0.15 }).valid
      .filter((point, index, list) => list.findIndex((candidate) =>
        candidate.x === point.x && candidate.y === point.y && candidate.z === point.z) === index);
    assert.ok(pool.length >= 30, `${mapId} lacks maximum-wave capacity`);

    const occupants = map.playerSpawns.map((pos) => ({ pos, alive: true }));
    const zombies = [];
    for (let index = 0; index < 20; index++) {
      const point = selectSafeSpawn({
        points: pool,
        colliders,
        body: BOT_BODY,
        margin: 0.15,
        occupants,
        minOccupantDistance: 1.25,
        random: () => 0,
      });
      assert.ok(point);
      assert.ok(occupants.every(({ pos }) =>
        Math.hypot(point.x - pos.x, point.y - pos.y, point.z - pos.z) >= 1.25));
      zombies.push(point);
      occupants.push({ pos: point, alive: true });
    }
    assert.equal(new Set(zombies.map((point) => `${point.x}/${point.y}/${point.z}`)).size, 20);
  }
});

test('the five legacy points embedded in map geometry remain rejected', () => {
  const arenaColliders = buildColliders(buildMap('arena').boxes);
  for (const point of [
    { x: -30, y: 0.1, z: 0 },
    { x: 30, y: 0.1, z: 30 },
    { x: -30, y: 0.1, z: -30 },
  ]) {
    assert.equal(isSpawnPointSafe(point, arenaColliders, { body: PLAYER_BODY }), false);
  }

  const cityColliders = buildColliders(buildMap('ciudad').boxes);
  for (const point of [
    { x: 26, y: 0.1, z: -4 },
    { x: -26, y: 0.1, z: 4 },
  ]) {
    assert.equal(isSpawnPointSafe(point, cityColliders, { body: BOT_BODY }), false);
  }
});

test('spawn inspection rejects floating, blocked, and non-finite points', () => {
  const floor = { minX: -20, maxX: 20, minY: -1, maxY: 0, minZ: -20, maxZ: 20 };
  const wall = { minX: 2, maxX: 4, minY: 0, maxY: 5, minZ: 2, maxZ: 4 };
  assert.equal(inspectSpawnPoint({ x: 0, y: 4, z: 0 }, [floor]).supported, false);
  assert.equal(inspectSpawnPoint({ x: 3, y: 0.1, z: 3 }, [floor, wall]).ok, false);
  assert.equal(inspectSpawnPoint({ x: NaN, y: 0.1, z: 0 }, [floor]).finite, false);
});

test('movement path validation blocks thin walls while allowing a normal step-up', () => {
  const floor = { minX: -10, maxX: 10, minY: -1, maxY: 0, minZ: -10, maxZ: 10 };
  const thinWall = { minX: 0.9, maxX: 1.1, minY: 0, maxY: 4, minZ: -2, maxZ: 2 };
  assert.equal(isBodyPathClear(
    { x: 0, y: 0.1, z: 0 },
    { x: 2, y: 0.1, z: 0 },
    [floor, thinWall],
    { body: PLAYER_BODY },
  ), false);

  const lowStep = { minX: 0.8, maxX: 2, minY: 0, maxY: 0.5, minZ: -2, maxZ: 2 };
  assert.equal(isBodyPathClear(
    { x: 0, y: 0.1, z: 0 },
    { x: 1.5, y: 0.501, z: 0 },
    [floor, lowStep],
    { body: PLAYER_BODY },
  ), true);
});

test('movement path validation accepts the axis-resolved route around an arena pillar', () => {
  const colliders = buildColliders(buildMap('arena').boxes);
  const start = { x: -33.570, y: 0.001, z: 8.781 };
  const end = { x: -33.986, y: 0.001, z: 8.661 };
  assert.equal(colliders.some((collider) => bodyOverlapsCollider(start, collider, PLAYER_BODY)), false);
  assert.equal(colliders.some((collider) => bodyOverlapsCollider(end, collider, PLAYER_BODY)), false);
  assert.equal(isBodyPathClear(start, end, colliders, { body: PLAYER_BODY }), true);
});

test('network contact tolerance preserves every surface in Arena and Ciudad', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    for (let index = 0; index < colliders.length; index++) {
      const collider = colliders[index];
      const settled = {
        x: Number(((collider.minX + collider.maxX) / 2).toFixed(3)),
        y: Number((collider.maxY + 0.001).toFixed(3)),
        z: Number(((collider.minZ + collider.maxZ) / 2).toFixed(3)),
      };
      assert.equal(
        bodyPenetratesCollider(settled, collider, PLAYER_BODY, 0.004),
        false,
        `${mapId} surface ${index} became solid after network serialization`,
      );
    }
  }

  const wall = { minX: 0, maxX: 1, minY: 0, maxY: 4, minZ: -2, maxZ: 2 };
  assert.equal(bodyPenetratesCollider({ x: -0.377, y: 0.1, z: 0 }, wall, PLAYER_BODY, 0.004), false);
  assert.equal(bodyPenetratesCollider({ x: -0.36, y: 0.1, z: 0 }, wall, PLAYER_BODY, 0.004), true);
  assert.equal(isBodyPathClear(
    { x: -0.381, y: 0.1, z: -1 },
    { x: -0.377, y: 0.1, z: 1 },
    [wall],
    { body: PLAYER_BODY, contactTolerance: 0.004 },
  ), true);
});

test('maximin selection avoids the previous point and chooses away from live occupants', () => {
  const floor = { minX: -30, maxX: 30, minY: -1, maxY: 0, minZ: -30, maxZ: 30 };
  const points = [
    { x: -10, y: 0.1, z: 0 },
    { x: 0, y: 0.1, z: 0 },
    { x: 10, y: 0.1, z: 0 },
  ];
  const first = selectSafeSpawn({
    points,
    colliders: [floor],
    occupants: [{ pos: { x: -9, y: 0.1, z: 0 }, alive: true }],
    random: () => 0,
  });
  assert.deepEqual(first, points[2]);

  const next = selectSafeSpawn({
    points,
    colliders: [floor],
    occupants: [{ pos: { x: -9, y: 0.1, z: 0 }, alive: true }],
    previous: { ...first, y: 0.001 }, // posición ya asentada por la gravedad
    random: () => 0,
  });
  assert.deepEqual(next, points[1]);
});

test('a free previous spawn wins over an occupied alternative', () => {
  const floor = { minX: -20, maxX: 20, minY: -1, maxY: 0, minZ: -20, maxZ: 20 };
  const previous = { x: -10, y: 0.1, z: 0 };
  const occupied = { x: 10, y: 0.1, z: 0 };
  assert.deepEqual(selectSafeSpawn({
    points: [previous, occupied],
    colliders: [floor],
    occupants: [{ pos: occupied, alive: true }],
    previous,
    minOccupantDistance: 3,
    random: () => 0,
  }), previous);
});

test('sequential room reservations assign all ten spawn points without duplicates', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    const occupants = [];
    for (let i = 0; i < 10; i++) {
      const point = selectSafeSpawn({
        points: map.playerSpawns,
        colliders,
        body: PLAYER_BODY,
        margin: 1,
        occupants,
        random: () => 0,
      });
      assert.ok(point);
      occupants.push({ pos: point, alive: true });
    }
    assert.equal(new Set(occupants.map(({ pos }) => `${pos.x}/${pos.z}`)).size, 10);
  }
});

test('every player spawn remains valid after its first two seconds of physics', () => {
  for (const mapId of MAP_IDS) {
    const map = buildMap(mapId);
    const colliders = buildColliders(map.boxes);
    for (const spawn of map.playerSpawns) {
      const pos = { ...spawn };
      const vel = { x: 0, y: 0, z: 0 };
      for (let frame = 0; frame < 120; frame++) {
        vel.y -= 24 / 60;
        moveBody(pos, vel, 1 / 60, PLAYER_BODY.halfX, PLAYER_BODY.halfZ, PLAYER_BODY.height, colliders);
      }
      assert.ok(pos.y >= 0, `${mapId} spawn fell below the map`);
      assert.equal(colliders.some((collider) =>
        bodyOverlapsCollider(pos, collider, PLAYER_BODY)), false,
      `${mapId} spawn penetrated geometry after settling`);
    }
  }
});

test('crate occupancy ignores dead entities but blocks live players and bots', () => {
  const crate = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 };
  const point = { x: 0, y: 0.1, z: 0 };
  assert.equal(colliderOccupied(crate, [{ pos: point, alive: true }], PLAYER_BODY), true);
  assert.equal(colliderOccupied(crate, [{ pos: point, alive: false }], PLAYER_BODY), false);
  assert.equal(colliderOccupied(crate, [{ pos: point, dead: false }], BOT_BODY), true);
  assert.equal(colliderOccupied(crate, [{ pos: point, dead: true }], BOT_BODY), false);
  assert.equal(colliderOccupied(crate, [{ pos: { x: 3, y: 0.1, z: 0 }, alive: true }],
    PLAYER_BODY, 0.05), false);
  assert.equal(colliderOccupied(crate, [{ pos: { x: 3, y: 0.1, z: 0 }, alive: true }],
    PLAYER_BODY, 2), true);
});
