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
    pos: { x: 1.2346, y: 5.801, z: -2.3456 },
    yaw: 0.2,
    pitch: -0.1,
    sliding: false,
    horizontalSpeed: () => 3,
  };
  net.tickState(1, player);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sid, 7);
  assert.deepEqual(sent[0].p, [1.235, 5.801, -2.346]);

  player.dead = true;
  net._sendTimer = 0;
  net.tickState(1, player);
  assert.equal(sent.length, 1);
});

test('state cadence preserves fractional frame time instead of drifting below 15 Hz', () => {
  const simulate = (fps) => {
    const sent = [];
    const net = new Net();
    net.connected = true;
    net.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
    const player = {
      dead: false,
      pos: { x: 0, y: 0.1, z: 0 }, yaw: 0, pitch: 0, sliding: false,
      horizontalSpeed: () => 0,
    };
    for (let frame = 0; frame < fps; frame++) net.tickState(1 / fps, player);
    return sent.length;
  };

  assert.equal(simulate(60), 15);
  assert.equal(simulate(20), 15);
  assert.equal(simulate(10), 10, 'a frame emits at most one fresh state packet');
});

test('network heartbeat has one owner and restarting it clears the previous timer', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = [];
  const cleared = [];
  globalThis.setInterval = (callback, delay) => {
    const timer = { callback, delay, id: timers.length + 1 };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => cleared.push(timer);
  try {
    const sent = [];
    const net = new Net();
    net.connected = true;
    net.sendPing = () => sent.push('ping');

    const first = net.startHeartbeat(100);
    const second = net.startHeartbeat(4500);
    assert.equal(first.delay, 1000);
    assert.equal(second.delay, 4500);
    assert.deepEqual(cleared, [first]);

    second.callback();
    assert.deepEqual(sent, ['ping']);
    net.stopHeartbeat();
    assert.deepEqual(cleared, [first, second]);
    assert.equal(net._heartbeatTimer, null);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('heartbeat closes a connection that stops acknowledging pings', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalNow = Date.now;
  let callback = null;
  let clock = 1000;
  globalThis.setInterval = (fn) => { callback = fn; return 1; };
  globalThis.clearInterval = () => {};
  Date.now = () => clock;
  try {
    const closed = [];
    const net = new Net();
    net.connected = true;
    net.ws = { close: (...args) => closed.push(args) };
    net.sendPing = () => {};
    net.startHeartbeat(3000);

    clock += 10501;
    callback();
    assert.deepEqual(closed, [[4000, 'Servidor sin respuesta']]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalNow;
  }
});
