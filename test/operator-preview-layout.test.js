import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATOR_PREVIEW_COMPACT_FOV,
  OPERATOR_PREVIEW_FALLBACK_FOV,
  OPERATOR_PREVIEW_FULL_FOV,
  operatorPreviewFov,
} from '../src/operator-preview-layout.js';

test('operator preview keeps compact framing fixed and sizes full framing by weapon', () => {
  assert.equal(OPERATOR_PREVIEW_COMPACT_FOV, 30);
  assert.equal(Object.isFrozen(OPERATOR_PREVIEW_FULL_FOV), true);
  assert.deepEqual(OPERATOR_PREVIEW_FULL_FOV, {
    pistol: 31,
    revolver: 31,
    smg: 31,
    launcher: 31,
    ar: 34,
    shotgun: 37,
    sniper: 37,
  });
  for (const kind of Object.keys(OPERATOR_PREVIEW_FULL_FOV)) {
    assert.equal(operatorPreviewFov(kind, { compact: true }), 30);
    assert.equal(operatorPreviewFov(kind), OPERATOR_PREVIEW_FULL_FOV[kind]);
  }
});

test('unknown operator weapons receive the widest safe full framing', () => {
  assert.equal(OPERATOR_PREVIEW_FALLBACK_FOV, 37);
  assert.equal(operatorPreviewFov('generic'), 37);
  assert.equal(operatorPreviewFov(null), 37);
});
