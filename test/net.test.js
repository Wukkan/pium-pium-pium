import test from 'node:test';
import assert from 'node:assert/strict';
import { Net, isProtocolMessage, lobbyHelloMessage } from '../src/net.js';

test('protocol messages reject null, arrays, and messages without a type', () => {
  assert.equal(isProtocolMessage(null), false);
  assert.equal(isProtocolMessage([]), false);
  assert.equal(isProtocolMessage({}), false);
  assert.equal(isProtocolMessage({ t: 'snap' }), true);
});

test('lobby hello carries the exact protocol version, mode, and room', () => {
  assert.deepEqual(lobbyHelloMessage('Ana', { h: 'cap', c: 123 }, { mode: 'teams', room: 2 }), {
    t: 'hola', pv: 2, name: 'Ana', skin: { h: 'cap', c: 123 }, mode: 'teams', room: 2,
  });
  assert.throws(
    () => lobbyHelloMessage('Ana', {}, { mode: 'unknown', room: 1 }),
    (error) => error.code === 'INVALID_SELECTION',
  );
  assert.throws(
    () => lobbyHelloMessage('Ana', {}, { mode: 'ffa', room: 3 }),
    (error) => error.code === 'INVALID_SELECTION',
  );
});

test('bot configuration messages include the request id used for acknowledgements', () => {
  const sent = [];
  const net = new Net();
  net.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };

  net.sendBotConfig(true, 3, 42);

  assert.deepEqual(sent, [{ t: 'botcfg', enabled: true, count: 3, rid: 42 }]);
});

test('state messages carry the accepted spawn sequence and stop while dead', () => {
  const sent = [];
  const net = new Net();
  net.connected = true;
  net.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  assert.equal(net.acceptSpawn(7), 7);
  assert.equal(net.acceptSpawn('8'), 7);

  const player = {
    dead: false,
    pos: { x: 1, y: 0.1, z: 2 },
    yaw: 0.2,
    pitch: -0.1,
    sliding: false,
    horizontalSpeed: () => 3,
  };
  net.tickState(1, player);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sid, 7);

  player.dead = true;
  net._sendTimer = 0;
  net.tickState(1, player);
  assert.equal(sent.length, 1);
});
