import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRemoteYaw, sanitizeRemoteHealth } from '../src/remotes.js';

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
