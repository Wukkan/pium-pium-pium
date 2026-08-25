import test from 'node:test';
import assert from 'node:assert/strict';

import { WEAPON_DEFS } from '../src/weapons.js';
import {
  FIREARM_RULES,
  firearmCrateDamageLimit,
  firearmDamageLimit,
  knifeDamageLimit,
  minimumFireInterval,
} from '../src/shared/combat-rules.js';

test('authoritative firearm rules stay aligned with every client weapon definition', () => {
  assert.deepEqual(Object.keys(FIREARM_RULES), Object.keys(WEAPON_DEFS));
  for (const [kind, rule] of Object.entries(FIREARM_RULES)) {
    const client = WEAPON_DEFS[kind];
    assert.equal(rule.damage, client.damage, `${kind} damage`);
    assert.equal(rule.headMult, client.headMult, `${kind} head multiplier`);
    assert.equal(rule.rpm, client.rpm, `${kind} cadence`);
    assert.equal(rule.mag, client.mag, `${kind} magazine`);
    assert.equal(rule.reloadTime, client.reloadTime, `${kind} reload`);
    assert.equal(rule.pellets, client.pellets || (client.launcher ? 0 : 1), `${kind} pellets`);
    assert.equal(!!rule.projectile, !!client.launcher, `${kind} projectile flag`);
  }
});

test('server damage and cadence ceilings are finite and conservative', () => {
  for (const [kind, rule] of Object.entries(FIREARM_RULES)) {
    assert.ok(Number.isFinite(minimumFireInterval(kind)) && minimumFireInterval(kind) > 0);
    if (rule.projectile) {
      assert.equal(firearmDamageLimit(kind, true), 0);
      assert.equal(firearmCrateDamageLimit(kind), 0);
      continue;
    }
    assert.ok(firearmDamageLimit(kind, false) >= rule.damage);
    assert.ok(firearmDamageLimit(kind, true) <= 120);
    assert.equal(firearmCrateDamageLimit(kind), rule.damage);
  }
});

test('knife damage is authoritative for player and bot yaw conventions', () => {
  const target = { x: 0, z: 0 };

  // Player ry=0 looks toward -Z: an attacker at +Z is behind them.
  assert.equal(knifeDamageLimit({ x: 0, z: 1 }, target, 0, 'pl'), 100);
  assert.equal(knifeDamageLimit({ x: 0, z: -1 }, target, 0, 'pl'), 40);

  // Bot yaw=0 looks toward +Z, so the same positions invert the result.
  assert.equal(knifeDamageLimit({ x: 0, z: -1 }, target, 0, 'bot'), 100);
  assert.equal(knifeDamageLimit({ x: 0, z: 1 }, target, 0, 'bot'), 40);
  assert.equal(knifeDamageLimit(null, target, NaN, 'pl'), 40);
});
