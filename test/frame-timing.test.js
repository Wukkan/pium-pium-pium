import test from 'node:test';
import assert from 'node:assert/strict';

import {
  frameSimulationPlan,
  MAX_FRAME_CATCHUP,
  MAX_SIMULATION_STEP,
} from '../src/frame-timing.js';

test('fast frames keep one variable step while slow frames are safely subdivided', () => {
  assert.deepEqual(frameSimulationPlan(1 / 144), {
    elapsed: 1 / 144, steps: 1, step: 1 / 144,
  });

  const tenFps = frameSimulationPlan(0.1);
  assert.equal(tenFps.steps, 6);
  assert.ok(tenFps.step <= MAX_SIMULATION_STEP + Number.EPSILON);
  assert.ok(Math.abs(tenFps.step * tenFps.steps - 0.1) < 1e-12);
});

test('catch-up is bounded and invalid elapsed values never advance simulation', () => {
  const stalled = frameSimulationPlan(2);
  assert.equal(stalled.elapsed, MAX_FRAME_CATCHUP);
  assert.equal(stalled.steps, 15);
  assert.ok(stalled.step <= MAX_SIMULATION_STEP + Number.EPSILON);
  assert.deepEqual(frameSimulationPlan(Number.NaN), { elapsed: 0, steps: 0, step: 0 });
  assert.deepEqual(frameSimulationPlan(-1), { elapsed: 0, steps: 0, step: 0 });
});
