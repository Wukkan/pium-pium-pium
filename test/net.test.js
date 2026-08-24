import test from 'node:test';
import assert from 'node:assert/strict';
import { Net, isProtocolMessage } from '../src/net.js';

test('protocol messages reject null, arrays, and messages without a type', () => {
  assert.equal(isProtocolMessage(null), false);
  assert.equal(isProtocolMessage([]), false);
  assert.equal(isProtocolMessage({}), false);
  assert.equal(isProtocolMessage({ t: 'snap' }), true);
});

test('bot configuration messages include the request id used for acknowledgements', () => {
  const sent = [];
  const net = new Net();
  net.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };

  net.sendBotConfig(true, 3, 42);

  assert.deepEqual(sent, [{ t: 'botcfg', enabled: true, count: 3, rid: 42 }]);
});
