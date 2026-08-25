import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRemoteYaw, Remotes, sanitizeRemoteHealth } from '../src/remotes.js';

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

test('disposing a remote session releases every entity and clears both registries', () => {
  let disposed = 0;
  const remotes = new Remotes({});
  remotes.players.set(1, { dispose() { disposed++; } });
  remotes.players.set(2, { dispose() { disposed++; } });
  remotes.bots.set('b1', { dispose() { disposed++; } });

  remotes.dispose();

  assert.equal(disposed, 3);
  assert.equal(remotes.players.size, 0);
  assert.equal(remotes.bots.size, 0);
  remotes.dispose();
  assert.equal(disposed, 3, 'dispose must be idempotent');
});
