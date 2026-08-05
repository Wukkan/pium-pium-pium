import test from 'node:test';
import assert from 'node:assert/strict';
import { clampParticleCount, effectLifetime } from '../src/quarks-effects.js';

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
