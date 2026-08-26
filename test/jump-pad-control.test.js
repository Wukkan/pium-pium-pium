import test from 'node:test';
import assert from 'node:assert/strict';

import { activateGroundedJumpPad } from '../src/jump-pad-control.js';
import { Player, landingCameraKick } from '../src/player.js';
import {
  COLORS,
  applyJumpPadImpulse,
  buildMap,
  jumpPadContainsPoint,
} from '../src/shared/mapdata.js';

function fakePlayer(pad) {
  return {
    pos: { x: pad.x, y: 0.201, z: pad.z },
    vel: { x: 0, y: 0, z: 0 },
    onGround: true,
    _wasGrounded: true,
    landingKick: 0.04,
    sliding: false,
    keys: { Space: true },
    launchVertical: Player.prototype.launchVertical,
    launchFromPad: Player.prototype.launchFromPad,
  };
}

test('every pad wins over held jump and can activate only while grounded', () => {
  for (const mapId of ['arena', 'ciudad']) {
    for (const pad of buildMap(mapId).jumpPads) {
      const player = fakePlayer(pad);
      assert.equal(activateGroundedJumpPad(player, [pad], true), pad);
      assert.equal(player.vel.y, pad.power, `${mapId} pad lost its vertical power`);
      assert.equal(player.onGround, false);
      assert.equal(player.landingKick, 0);

      // Este es el branch del salto manual con Espacio: ya no puede sustituir
      // el impulso porque el pad consumió primero onGround.
      if (player.keys.Space && player.onGround) player.vel.y = 8.6;
      assert.equal(player.vel.y, pad.power);
      assert.equal(activateGroundedJumpPad(player, [pad], true), null);
    }
  }
});

test('directional pads guarantee minimum launch speed without erasing lateral momentum', () => {
  const pad = buildMap('arena').jumpPads.find((candidate) => candidate.direction);
  const player = fakePlayer(pad);
  player.vel.z = 2.5;
  activateGroundedJumpPad(player, [pad], true);
  const length = Math.hypot(pad.direction.x, pad.direction.z);
  const nx = pad.direction.x / length, nz = pad.direction.z / length;
  assert.ok(player.vel.x * nx + player.vel.z * nz >= pad.minHorizontalSpeed - 1e-9);
  assert.equal(player.vel.z, 2.5);
});

test('shared pad impulse gives local and authoritative bots the same directional launch', () => {
  for (const mapId of ['arena', 'ciudad']) {
    for (const pad of buildMap(mapId).jumpPads.filter((candidate) => candidate.direction)) {
      const velocity = { x: 0, y: 0, z: 0 };
      assert.equal(applyJumpPadImpulse(velocity, pad), true);
      const length = Math.hypot(pad.direction.x, pad.direction.z);
      const forward = velocity.x * pad.direction.x / length + velocity.z * pad.direction.z / length;
      assert.equal(velocity.y, pad.power);
      assert.ok(forward >= pad.minHorizontalSpeed);
    }
  }
});

test('every visible corner of every square pad belongs to its authoritative trigger', () => {
  for (const mapId of ['arena', 'ciudad']) {
    const map = buildMap(mapId);
    for (const pad of map.jumpPads) {
      const visual = map.boxes.find((box) =>
        box.color === COLORS.pad && box.x === pad.x && box.z === pad.z);
      assert.ok(visual);
      for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
        assert.equal(jumpPadContainsPoint({
          x: pad.x + xSign * visual.w / 2 * 0.999,
          y: visual.y + visual.h / 2,
          z: pad.z + zSign * visual.d / 2 * 0.999,
        }, pad), true, `${mapId} pad has a dead visible corner`);
      }
    }
  }
});

test('ordinary jumps do not move the camera and reduced motion disables hard-landing kick', () => {
  assert.equal(landingCameraKick(8.6, 1), 0);
  assert.ok(landingCameraKick(18, 1) > 0);
  assert.equal(landingCameraKick(18, 0), 0);
});
