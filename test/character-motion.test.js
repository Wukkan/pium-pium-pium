import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  hitReactionSide,
  operatorDeathState,
  operatorMotionState,
  stablePoseSide,
} from '../src/character-motion.js';

test('operator locomotion keeps limbs mirrored and makes sprint readable', () => {
  const walk = operatorMotionState({ time: Math.PI / 2, speed: 4 });
  const sprint = operatorMotionState({ time: Math.PI / 2, speed: 7.2 });

  assert.ok(Math.abs(walk.legL + walk.legR) < 1e-9);
  assert.ok(Math.abs(sprint.legL) > Math.abs(walk.legL));
  assert.ok(sprint.sprint > 0.9);
  assert.ok(sprint.torsoPitch > walk.torsoPitch);
});

test('aim pose brings both hands to the weapon and respects pitch and recoil', () => {
  const level = operatorMotionState({ aiming: true, aimPitch: 0 });
  const elevated = operatorMotionState({ aiming: true, aimPitch: 0.5, recoil: 1 });

  assert.ok(level.armL < -1.4 && level.armR < -1.4);
  assert.equal(level.armLx, -level.armRx);
  assert.ok(elevated.armL < level.armL);
  assert.ok(elevated.gunPositionZ > level.gunPositionZ);
  assert.ok(elevated.gunRotationX > level.gunRotationX);
});

test('damage reaction leans consistently toward the reported impact side', () => {
  const right = operatorMotionState({ hit: 1, hitSide: 1 });
  const left = operatorMotionState({ hit: 1, hitSide: -1 });

  assert.ok(right.torsoRoll > 0);
  assert.ok(left.torsoRoll < 0);
  assert.equal(hitReactionSide({ x: 3, z: 0 }, { x: 0, z: 0 }, 0), 1);
  assert.equal(hitReactionSide({ x: -3, z: 0 }, { x: 0, z: 0 }, 0), -1);
});

test('death animation collapses progressively and hides the floating label', () => {
  const start = operatorDeathState(0, 1);
  const middle = operatorDeathState(0.5, 1);
  const end = operatorDeathState(1, 1);

  assert.equal(Math.abs(start.groupRotationX), 0);
  assert.ok(Math.abs(middle.groupRotationX) > 0.1);
  assert.ok(Math.abs(end.groupRotationX) > Math.abs(middle.groupRotationX));
  assert.equal(end.nameOpacity, 0);
  assert.equal(operatorDeathState(1, -1).groupRotationZ, -end.groupRotationZ);
});

test('motion helpers are deterministic and sanitize invalid input', () => {
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(4), 1);
  assert.equal(clamp01('broken'), 0);
  assert.equal(stablePoseSide('bot-7'), stablePoseSide('bot-7'));
  assert.ok([-1, 1].includes(stablePoseSide('operator')));

  const pose = operatorMotionState({ speed: 'broken', aimPitch: Infinity, hit: NaN });
  for (const value of Object.values(pose)) assert.equal(Number.isFinite(value), true);
});
