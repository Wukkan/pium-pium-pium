import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import * as QUARKS from '../vendor/three.quarks.module.js';
import { clampParticleCount, effectLifetime, effectProfile, QuarksEffects } from '../src/quarks-effects.js';

test('particle counts stay within the combat budget', () => {
  assert.equal(clampParticleCount(2, 1, 24), 2);
  assert.equal(clampParticleCount(80, 1, 24), 24);
  assert.equal(clampParticleCount(0, 1, 24), 1);
});

test('effect lifetimes are bounded for automatic cleanup', () => {
  assert.equal(effectLifetime('muzzle'), 0.12);
  assert.equal(effectLifetime('explosion'), 0.65);
  assert.equal(effectLifetime('unknown'), 0.35);
});

test('explosions use layered fire, smoke, and ember bursts', () => {
  assert.deepEqual(effectProfile('explosion').layers, ['fire', 'smoke', 'embers']);
});

test('creates an explosion with the installed three.quarks runtime', () => {
  const effects = new QuarksEffects(new THREE.Scene(), THREE, QUARKS);

  assert.doesNotThrow(() => effects.explosion(new THREE.Vector3(0, 0, 0)));
});
