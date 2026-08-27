import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampLookPitch,
  fallbackEdgeIntent,
  fallbackEdgeTurn,
  normalizeLookYaw,
  sanitizeMouseDelta,
} from '../src/look-controls.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-10;

function angularDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

test('horizontal look remains continuous across any number of complete turns', () => {
  const startingYaw = 0.731;
  for (const turns of [-10_000, -137, -2, 0, 3, 251, 10_000]) {
    const yaw = normalizeLookYaw(startingYaw + turns * TAU);
    assert.ok(Number.isFinite(yaw), `turn ${turns} produced a non-finite yaw`);
    assert.ok(yaw >= -Math.PI - EPSILON && yaw <= Math.PI + EPSILON);
    assert.ok(angularDistance(yaw, startingYaw) < 1e-9, `turn ${turns} changed the facing direction`);
  }

  let yaw = 0;
  for (let event = 0; event < 12_000; event += 1) {
    yaw = normalizeLookYaw(yaw - sanitizeMouseDelta(37, true) * 0.0023);
  }
  assert.ok(Number.isFinite(yaw));
  assert.ok(angularDistance(yaw, normalizeLookYaw(-12_000 * 37 * 0.0023)) < EPSILON);
});

test('corrupt mouse packets cannot poison yaw or pitch with NaN or Infinity', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, 'broken', {}, []]) {
    assert.equal(sanitizeMouseDelta(value, true), 0);
    assert.equal(sanitizeMouseDelta(value, false), 0);
  }
  for (const value of [undefined, null, NaN, Infinity, -Infinity, 'broken', {}, []]) {
    assert.ok(Number.isFinite(normalizeLookYaw(value)));
    assert.ok(Number.isFinite(clampLookPitch(value)));
  }
});

test('Pointer Lock preserves real mouse deltas while both modes reject giant corrupt jumps', () => {
  for (const delta of [-1200, -160, -1, 0, 1, 160, 1200]) {
    assert.equal(sanitizeMouseDelta(delta, true), delta, `locked delta ${delta} was truncated`);
  }

  assert.ok(sanitizeMouseDelta(2048, true) > 0 && sanitizeMouseDelta(2048, true) < 2048);
  assert.equal(sanitizeMouseDelta(-2048, true), -sanitizeMouseDelta(2048, true));

  const positive = sanitizeMouseDelta(2048, false);
  const negative = sanitizeMouseDelta(-2048, false);
  assert.ok(positive > 0 && positive < 2048);
  assert.equal(negative, -positive);
});

test('pitch has vertical limits without imposing a horizontal dead stop', () => {
  assert.equal(clampLookPitch(0.42), 0.42);
  assert.ok(clampLookPitch(100) > 1.5 && clampLookPitch(100) < Math.PI / 2);
  assert.ok(clampLookPitch(-100) < -1.5 && clampLookPitch(-100) > -Math.PI / 2);
  assert.equal(clampLookPitch(100), -clampLookPitch(-100));

  assert.notEqual(normalizeLookYaw(100), normalizeLookYaw(99));
  assert.notEqual(normalizeLookYaw(-100), normalizeLookYaw(-99));
});

test('fallback edge intent is neutral in the center and directional at both borders', () => {
  const start = 100;
  const size = 1000;
  const center = fallbackEdgeIntent(start + size / 2, start, size);
  const leftNear = fallbackEdgeIntent(start + 30, start, size);
  const leftEdge = fallbackEdgeIntent(start, start, size);
  const rightNear = fallbackEdgeIntent(start + size - 30, start, size);
  const rightEdge = fallbackEdgeIntent(start + size, start, size);

  assert.equal(center, 0);
  assert.ok(leftEdge <= leftNear && leftNear < 0);
  assert.ok(rightEdge >= rightNear && rightNear > 0);
  assert.ok(Math.abs(leftEdge) <= 1 && Math.abs(rightEdge) <= 1);
  assert.ok(Math.abs(leftEdge + rightEdge) < EPSILON, 'edge response is not symmetrical');

  for (const invalid of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(fallbackEdgeIntent(invalid, start, size), 0);
  }
  assert.equal(fallbackEdgeIntent(center, start, 0), 0);
});

test('fallback border turn keeps rotating every frame and respects sensitivity and frame time', () => {
  const intent = fallbackEdgeIntent(1095, 100, 1000);
  const base = fallbackEdgeTurn(intent, 0.0023, 1 / 60);
  assert.ok(base > 0, 'right border did not request a right turn');
  assert.equal(fallbackEdgeTurn(-intent, 0.0023, 1 / 60), -base);
  assert.ok(Math.abs(fallbackEdgeTurn(intent, 0.0046, 1 / 60) - base * 2) < EPSILON);
  assert.ok(Math.abs(fallbackEdgeTurn(intent, 0.0023, 1 / 30) - base * 2) < EPSILON);
  assert.equal(fallbackEdgeTurn(intent, 0.0023, 0), 0);

  let accumulated = 0;
  for (let frame = 0; frame < 60 * 20; frame += 1) {
    accumulated += fallbackEdgeTurn(intent, 0.0023, 1 / 60);
  }
  assert.ok(accumulated > TAU * 2, 'compatible mode stopped before completing multiple turns');
});

test('zero sensitivity disables fallback border turning', () => {
  assert.equal(fallbackEdgeTurn(1, 0, 1 / 60), 0);
});

test('fallback edge rotation is frame-rate independent at 30, 60, and 144 FPS', () => {
  const intent = fallbackEdgeIntent(1099, 100, 1000);
  const simulate = (fps) => {
    let accumulated = 0;
    for (let frame = 0; frame < fps * 4; frame += 1) {
      accumulated += fallbackEdgeTurn(intent, 0.0023, 1 / fps);
    }
    return accumulated;
  };
  const at30 = simulate(30);
  const at60 = simulate(60);
  const at144 = simulate(144);
  assert.ok(Math.abs(at30 - at60) < EPSILON);
  assert.ok(Math.abs(at60 - at144) < EPSILON);
});

test('fallback calculations remain finite under malformed layout, sensitivity, and timing', () => {
  const badValues = [NaN, Infinity, -Infinity, undefined, null, 'bad', {}, []];
  for (const coordinate of badValues) {
    for (const start of badValues) {
      assert.ok(Number.isFinite(fallbackEdgeIntent(coordinate, start, 800)));
    }
  }
  for (const intent of badValues) {
    for (const sensitivity of badValues) {
      for (const dt of badValues) {
        assert.ok(Number.isFinite(fallbackEdgeTurn(intent, sensitivity, dt)));
      }
    }
  }
});
