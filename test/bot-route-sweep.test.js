import test from 'node:test';
import assert from 'node:assert/strict';

import { ServerBot } from '../server/botai.js';
import { buildColliders, buildMap } from '../src/shared/mapdata.js';

const TICK_RATE = 15;
const DT = 1 / TICK_RATE;
const REACHED_HORIZONTAL = 1.25;
const REACHED_VERTICAL = 0.85;

function routeDistance(pos, target) {
  return Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z);
}

function reachedTarget(pos, target) {
  return Math.hypot(pos.x - target.x, pos.z - target.z) <= REACHED_HORIZONTAL &&
    Math.abs(pos.y - target.y) <= REACHED_VERTICAL;
}

function formatPoint(point) {
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
}

// Runs the authoritative server bot at the server's actual 15 Hz cadence.
// Time is virtual so route checks and stuck recovery stay deterministic and CI
// never has to wait for the represented match time.
function simulateZombieRoute({ mapId, start, target, seconds = 36, label = '' }) {
  const map = buildMap(mapId);
  const colliders = buildColliders(map.boxes);
  const realDateNow = Date.now;
  let elapsedMs = 0;

  try {
    Date.now = () => elapsedMs;
    const zombie = new ServerBot(`route-${mapId}-${label}`, label, 0x69a05a, {
      zombie: true,
      spawnPicker: () => ({ ...start }),
    });
    const player = {
      pos: { ...target },
      alive: true,
      team: null,
      speed: 0,
      sliding: false,
    };
    const ctx = {
      colliders,
      waypoints: map.navigationPoints,
      players: [player],
      bots: [zombie],
      onShoot() {},
      onHitTarget() {},
    };

    let minDistance = routeDistance(zombie.pos, target);
    let stationaryTicks = 0;
    let maxStationaryTicks = 0;
    let previous = { ...zombie.pos };

    if (reachedTarget(zombie.pos, target)) {
      return { reached: true, seconds: 0, pos: { ...zombie.pos }, minDistance, maxStationaryTicks };
    }

    const tickLimit = Math.ceil(seconds * TICK_RATE);
    for (let tick = 1; tick <= tickLimit; tick++) {
      elapsedMs = tick * 1000 / TICK_RATE;
      zombie.update(DT, ctx);

      if (![zombie.pos.x, zombie.pos.y, zombie.pos.z].every(Number.isFinite)) {
        return {
          reached: false,
          invalidPosition: true,
          seconds: tick / TICK_RATE,
          pos: { ...zombie.pos },
          minDistance,
          maxStationaryTicks,
        };
      }

      const moved = Math.hypot(
        zombie.pos.x - previous.x,
        zombie.pos.y - previous.y,
        zombie.pos.z - previous.z,
      );
      stationaryTicks = moved < 0.015 ? stationaryTicks + 1 : 0;
      maxStationaryTicks = Math.max(maxStationaryTicks, stationaryTicks);
      previous = { ...zombie.pos };
      minDistance = Math.min(minDistance, routeDistance(zombie.pos, target));

      if (reachedTarget(zombie.pos, target)) {
        return {
          reached: true,
          seconds: tick / TICK_RATE,
          pos: { ...zombie.pos },
          minDistance,
          maxStationaryTicks,
        };
      }
    }

    return {
      reached: false,
      seconds,
      pos: { ...zombie.pos },
      minDistance,
      maxStationaryTicks,
    };
  } finally {
    Date.now = realDateNow;
  }
}

function assertRouteReaches(route) {
  const result = simulateZombieRoute(route);
  assert.equal(
    result.reached,
    true,
    `${route.label} did not reach ${formatPoint(route.target)} in ${route.seconds ?? 36}s; ` +
      `ended at ${formatPoint(result.pos)}, closest=${result.minDistance.toFixed(2)}m, ` +
      `longest stop=${(result.maxStationaryTicks / TICK_RATE).toFixed(2)}s` +
      (result.invalidPosition ? ', position became non-finite' : ''),
  );
}

test('Ciudad zombie descends from the northeast roof to the north street', {
  timeout: 5_000,
}, () => {
  assertRouteReaches({
    label: 'Ciudad roof NE -> north street',
    mapId: 'ciudad',
    start: { x: 19, y: 5.7, z: -19 },
    target: { x: 0, y: 0.1, z: -30 },
    seconds: 28,
  });
});

test('Ciudad zombie can cross from the northeast roof to the southwest roof', {
  timeout: 5_000,
}, () => {
  assertRouteReaches({
    label: 'Ciudad roof NE -> roof SW',
    mapId: 'ciudad',
    start: { x: 19, y: 5.7, z: -19 },
    target: { x: -20, y: 5.7, z: 19 },
    seconds: 42,
  });
});

for (const route of [
  {
    label: 'Arena outer waypoint threshold',
    mapId: 'arena',
    start: { x: 30, y: 0.1, z: -15 },
    target: { x: 34, y: 0.1, z: 32 },
    seconds: 20,
  },
  {
    label: 'Ciudad west outer bend',
    mapId: 'ciudad',
    start: { x: -20, y: 5.7, z: 19 },
    target: { x: -30, y: 0.1, z: -30 },
    seconds: 44,
  },
  {
    label: 'Ciudad east outer bend',
    mapId: 'ciudad',
    start: { x: 0, y: 0.1, z: -20 },
    target: { x: 30, y: 0.1, z: 30 },
    seconds: 36,
  },
  {
    label: 'Ciudad west bend exact approach to east street',
    mapId: 'ciudad',
    start: { x: -30, y: 0.1, z: 20 },
    target: { x: 30, y: 0.1, z: 0 },
    seconds: 55,
  },
  {
    label: 'Ciudad west bend exact approach to northeast street',
    mapId: 'ciudad',
    start: { x: -30, y: 0.1, z: 20 },
    target: { x: 30, y: 0.1, z: -20 },
    seconds: 55,
  },
]) {
  test(`${route.label} does not deadlock near a bend`, { timeout: 5_000 }, () => {
    assertRouteReaches(route);
  });
}

test('representative 15 Hz sweep connects every bot spawn to player spawns', {
  timeout: 10_000,
}, () => {
  const failures = [];

  for (const mapId of ['arena', 'ciudad']) {
    const map = buildMap(mapId);
    for (const [spawnIndex, start] of map.botSpawns.entries()) {
      // Cover a stable nearby/far pairing for every bot spawn without turning
      // this regression into the full 10 x 10 Cartesian product.
      const targetIndices = new Set([
        spawnIndex % map.playerSpawns.length,
        (spawnIndex + Math.floor(map.playerSpawns.length / 2)) % map.playerSpawns.length,
      ]);

      for (const targetIndex of targetIndices) {
        const target = map.playerSpawns[targetIndex];
        const route = {
          label: `${mapId} botSpawn[${spawnIndex}] -> playerSpawn[${targetIndex}]`,
          mapId,
          start,
          target,
          seconds: mapId === 'ciudad' ? 38 : 34,
        };
        const result = simulateZombieRoute(route);
        if (!result.reached) {
          failures.push(
            `${route.label}: final=${formatPoint(result.pos)}, ` +
            `closest=${result.minDistance.toFixed(2)}m, ` +
            `stop=${(result.maxStationaryTicks / TICK_RATE).toFixed(2)}s`,
          );
        }
      }
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
