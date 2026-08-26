import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NETWORK_LIMITS,
  outboundDeliveryAction,
  sanitizeIdleSeconds,
  websocketOriginAllowed,
} from '../src/shared/network-limits.js';

test('outbound backpressure drops closed sockets, skips stale snapshots, and closes hard backlog', () => {
  assert.equal(outboundDeliveryAction({ readyState: 0, bufferedAmount: 0, type: 'snap' }), 'drop');
  assert.equal(outboundDeliveryAction({ readyState: 1, bufferedAmount: 0, type: 'snap' }), 'send');
  assert.equal(outboundDeliveryAction({
    readyState: 1,
    bufferedAmount: NETWORK_LIMITS.snapshotBackpressureBytes + 1,
    type: 'snap',
  }), 'skip');
  assert.equal(outboundDeliveryAction({
    readyState: 1,
    bufferedAmount: NETWORK_LIMITS.snapshotBackpressureBytes + 1,
    type: 'kill',
  }), 'send');
  assert.equal(outboundDeliveryAction({
    readyState: 1,
    bufferedAmount: NETWORK_LIMITS.hardBackpressureBytes + 1,
    type: 'kill',
  }), 'close');
  assert.equal(outboundDeliveryAction({ readyState: 1, bufferedAmount: NaN, type: 'snap' }), 'close');
});

test('browser WebSockets require the same HTTP host while native clients remain supported', () => {
  assert.equal(websocketOriginAllowed(undefined, 'game.example'), true);
  assert.equal(websocketOriginAllowed('https://game.example', 'game.example'), true);
  assert.equal(websocketOriginAllowed('http://localhost:5173', 'localhost:5173'), true);
  assert.equal(websocketOriginAllowed('https://evil.example', 'game.example'), false);
  assert.equal(websocketOriginAllowed('null', 'game.example'), false);
  assert.equal(websocketOriginAllowed('not a url', 'game.example'), false);
});

test('idle timeout configuration stays within operational bounds', () => {
  assert.equal(sanitizeIdleSeconds(undefined), NETWORK_LIMITS.clientIdleSeconds);
  assert.equal(sanitizeIdleSeconds(0), 1);
  assert.equal(sanitizeIdleSeconds(9999), 600);
  assert.equal(sanitizeIdleSeconds(45), 45);
});
