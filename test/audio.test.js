import test from 'node:test';
import assert from 'node:assert/strict';
import { clampVoiceLimit, spatialShotMix } from '../src/audio.js';

test('spatial shot mix attenuates and filters distant weapons', () => {
  const near = spatialShotMix({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const far = spatialShotMix({ x: 65, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

  assert.ok(near.gain > far.gain);
  assert.ok(near.cutoff > far.cutoff);
  assert.equal(near.pan, 1);
  assert.ok(far.gain >= 0.035);
});

test('spatial pan follows listener orientation', () => {
  const right = spatialShotMix(
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 0 },
    { x: 1, z: 0 },
  );
  const left = spatialShotMix(
    { x: 0, y: 0, z: -8 },
    { x: 0, y: 0, z: 0 },
    { x: 1, z: 0 },
  );

  assert.equal(right.pan, 1);
  assert.equal(left.pan, -1);
});

test('audio voice budget remains in a performance-safe range', () => {
  assert.equal(clampVoiceLimit(2), 8);
  assert.equal(clampVoiceLimit(30), 30);
  assert.equal(clampVoiceLimit(200), 48);
});
