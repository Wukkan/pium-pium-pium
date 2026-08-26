import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildColliders,
  buildMap,
  jumpPadContainsPoint,
  jumpPadIntersectsSegment,
} from '../src/shared/mapdata.js';
import { moveBody } from '../src/shared/physics.js';
import { PLAYER_BODY } from '../src/shared/spawn-safety.js';
import { activateGroundedJumpPad } from '../src/jump-pad-control.js';
import { Player } from '../src/player.js';

const DT = 1 / 60;
const GRAVITY = 24;

function walkUntil(mapId, {
  start,
  direction,
  reached,
  seconds = 7,
  speed = 4,
}) {
  const colliders = buildColliders(buildMap(mapId).boxes);
  const length = Math.hypot(direction.x, direction.z) || 1;
  const pos = { ...start };
  const vel = { x: 0, y: 0, z: 0 };
  let maxY = pos.y;

  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) {
    // Modela a un jugador que mantiene una dirección. Player vuelve a aplicar
    // aceleración cada frame aunque moveBody anule el eje al tocar geometría.
    vel.x = direction.x / length * speed;
    vel.z = direction.z / length * speed;
    vel.y -= GRAVITY * DT;
    moveBody(
      pos,
      vel,
      DT,
      PLAYER_BODY.halfX,
      PLAYER_BODY.halfZ,
      PLAYER_BODY.height,
      colliders,
    );
    maxY = Math.max(maxY, pos.y);
    if (reached(pos)) return { pos, maxY };
  }

  assert.fail(
    `${mapId}: navigation snagged at ` +
    `(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}); ` +
    `maximum foot height ${maxY.toFixed(3)}`,
  );
}

const CITY_ROOFTOP_ROUTES = [
  {
    label: 'northeast',
    start: { x: 24, y: 0.001, z: -1.8 },
    direction: { x: 0, z: -1 },
    lanes: [-1.4, 0, 1.4],
    reached: (pos) => pos.z < -15 && pos.y >= 5.65,
  },
  {
    label: 'northwest',
    start: { x: -23.5, y: 0.001, z: 0 },
    direction: { x: 0, z: -1 },
    lanes: [-1.4, 0, 1.4],
    reached: (pos) => pos.z < -15 && pos.y >= 6.55,
  },
  {
    label: 'southwest',
    start: { x: -20, y: 0.001, z: 1.8 },
    direction: { x: 0, z: 1 },
    lanes: [-1.4, 0, 1.4],
    reached: (pos) => pos.z > 15 && pos.y >= 5.55,
  },
  {
    label: 'southeast',
    start: { x: 24, y: 0.001, z: 0 },
    direction: { x: 0, z: 1 },
    lanes: [-1.6, 0, 1.6],
    reached: (pos) => pos.z > 15 && pos.y >= 6.55,
  },
];

for (const route of CITY_ROOFTOP_ROUTES) {
  test(`city ${route.label} rooftop stairs do not enter the solid building collider`, () => {
    for (const lane of route.lanes) {
      walkUntil('ciudad', {
        ...route,
        start: {
          ...route.start,
          x: route.start.x - route.direction.z * lane,
          z: route.start.z + route.direction.x * lane,
        },
      });
    }
  });
}

const ARENA_ELEVATED_ROUTES = [
    {
      label: 'northeast roof',
      start: { x: 24, y: 0.001, z: -7.8 },
      direction: { x: 0, z: -1 },
      lanes: [-1.4, 0, 1.4],
      reached: (pos) => pos.z < -20 && pos.y >= 5.75,
    },
    {
      label: 'northwest roof',
      start: { x: -24, y: 0.001, z: 7.8 },
      direction: { x: 0, z: 1 },
      lanes: [-1.4, 0, 1.4],
      reached: (pos) => pos.z > 20 && pos.y >= 5.75,
    },
    {
      label: 'southwest roof',
      start: { x: -25, y: 0.001, z: -9.8 },
      direction: { x: 0, z: -1 },
      lanes: [-1.4, 0, 1.4],
      reached: (pos) => pos.z < -21 && pos.y >= 5.15,
    },
    {
      label: 'north central platform',
      start: { x: 0, y: 0.001, z: -14 },
      direction: { x: 0, z: 1 },
      lanes: [-2.4, 0, 2.4],
      reached: (pos) => pos.z > -7.5 && pos.y >= 3,
    },
    {
      label: 'south central platform',
      start: { x: 0, y: 0.001, z: 14 },
      direction: { x: 0, z: -1 },
      lanes: [-2.4, 0, 2.4],
      reached: (pos) => pos.z < 7.5 && pos.y >= 3,
    },
    {
      label: 'watchtower',
      start: { x: 20, y: 0.001, z: 6 },
      direction: { x: 1, z: 0 },
      lanes: [-1, 0, 1],
      reached: (pos) => pos.x > 33 && pos.y >= 6.45,
    },
];

for (const route of ARENA_ELEVATED_ROUTES) {
  test(`arena ${route.label} stairs remain walkable to the top`, () => {
    for (const lane of route.lanes) {
      walkUntil('arena', {
        ...route,
        start: {
          ...route.start,
          x: route.start.x - route.direction.z * lane,
          z: route.start.z + route.direction.x * lane,
        },
      });
    }
  });
}

test('the full supported width of the city roof bridge has snag-free entrances', () => {
  // El tablero va de x=17 a x=21. Con radio 0.38, estos carriles son los
  // extremos que todavía tienen apoyo completo; las tapas de las barandas no
  // deben convertirlos en paredes invisibles al entrar desde las azoteas.
  for (const x of [17.4, 19, 20.6]) {
    walkUntil('ciudad', {
      start: { x, y: 5.701, z: -19 },
      direction: { x: 0, z: 1 },
      seconds: 9,
      reached: (pos) => pos.z > 15 && pos.y >= 6.1,
    });

    walkUntil('ciudad', {
      start: { x, y: 6.601, z: 19 },
      direction: { x: 0, z: -1 },
      seconds: 9,
      reached: (pos) => pos.z < -15 && pos.y >= 5.7,
    });
  }
});

test('rooftop jump pads have enough vertical impulse for their target roofs', () => {
  // h = v² / 2g. Se reserva un pequeño margen sobre cada cubierta para que el
  // jugador pueda dirigir el salto sin depender de un frame perfecto.
  const arenaPad = buildMap('arena').jumpPads.find((pad) => pad.x === 18 && pad.z === -13);
  const cityPads = buildMap('ciudad').jumpPads.filter((pad) => Math.abs(pad.x) === 13);
  assert.ok(arenaPad && arenaPad.power ** 2 / (2 * GRAVITY) > 6.5);
  assert.equal(cityPads.length, 2);
  for (const pad of cityPads) {
    assert.ok(pad.power ** 2 / (2 * GRAVITY) > 6.2);
  }
});

function launchToRoof(mapId, pad, direction, reached, speed = 7.2) {
  const colliders = buildColliders(buildMap(mapId).boxes);
  const length = Math.hypot(direction.x, direction.z) || 1;
  const pos = { x: pad.x, y: 0.201, z: pad.z };
  const vel = {
    x: direction.x / length * speed,
    y: 0,
    z: direction.z / length * speed,
  };
  const player = {
    pos,
    vel,
    onGround: true,
    _wasGrounded: true,
    landingKick: 0.04,
    sliding: false,
    launchVertical: Player.prototype.launchVertical,
    launchFromPad: Player.prototype.launchFromPad,
  };
  assert.equal(activateGroundedJumpPad(player, [pad], true), pad);
  let launches = 1;

  for (let frame = 0; frame < 240; frame++) {
    vel.y -= GRAVITY * DT;
    const result = moveBody(
      pos, vel, DT, PLAYER_BODY.halfX, PLAYER_BODY.halfZ, PLAYER_BODY.height, colliders,
    );
    if (result.onGround && jumpPadContainsPoint(pos, pad)) {
      player.onGround = true;
      if (activateGroundedJumpPad(player, [pad], true)) launches++;
    }
    if (result.onGround && reached(pos)) return { pos, launches };
  }
  assert.fail(`${mapId}: jump pad route ended at (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
}

test('rooftop jump pads clear the eaves at full running speed', () => {
  const arenaPad = buildMap('arena').jumpPads.find((pad) => pad.x === 18 && pad.z === -13);
  const arenaLanding = launchToRoof(
    'arena', arenaPad, { x: 0, z: -1 }, (pos) => pos.z < -19 && pos.y >= 5.75,
  );
  assert.equal(arenaLanding.launches, 1);

  const cityPads = buildMap('ciudad').jumpPads.filter((pad) => Math.abs(pad.x) === 13);
  for (const pad of cityPads) {
    const north = pad.z < 0;
    const landing = launchToRoof(
      'ciudad',
      pad,
      { x: 0, z: north ? -1 : 1 },
      (pos) => (north ? pos.z < -14 : pos.z > 14) && pos.y >= 5.55,
    );
    assert.equal(landing.launches, 1, 'pad retriggered after colliding with an eave');
  }
});

test('directional roof pads work from rest while Space is held', () => {
  const routes = [
    {
      mapId: 'arena',
      pad: buildMap('arena').jumpPads.find((pad) => pad.x === 18),
      reached: (pos) => pos.z < -19 && pos.y >= 5.75,
    },
    ...buildMap('ciudad').jumpPads.filter((pad) => Math.abs(pad.x) === 13).map((pad) => ({
      mapId: 'ciudad',
      pad,
      reached: (pos) => (pad.z < 0 ? pos.z < -14 : pos.z > 14) && pos.y >= 5.55,
    })),
  ];

  for (const route of routes) {
    const result = launchToRoof(route.mapId, route.pad, { x: 0, z: 0 }, route.reached, 0);
    assert.equal(result.launches, 1, `${route.mapId} standing launch retriggered`);
  }
});

test('jump pad authority uses the same visible trigger as local movement', () => {
  const pad = { x: 0, y: 0, z: 0, power: 18 };
  assert.equal(jumpPadContainsPoint({ x: 1.1, y: 0.2, z: 0 }, pad), true);
  assert.equal(jumpPadContainsPoint({ x: 1.2, y: 0.2, z: 0 }, pad), false);
  assert.equal(jumpPadIntersectsSegment(
    { x: -2, y: 0.2, z: 0 }, { x: 2, y: 0.2, z: 0 }, pad,
  ), true, 'a network step crossing the visible pad was rejected');
  assert.equal(jumpPadIntersectsSegment(
    { x: -2, y: 1.2, z: 0 }, { x: 2, y: 1.2, z: 0 }, pad,
  ), false, 'a segment above the pad was authorized');
  assert.equal(jumpPadIntersectsSegment(
    { x: 1.3, y: 0.2, z: 0 }, { x: 1.8, y: 0.5, z: 0 }, pad,
  ), false, 'the server silently enlarged the trigger radius');
});
