import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { buildColliders, buildMap, TOTAL_SLOTS } from '../src/shared/mapdata.js';
import { isBodyPathClear, isSpawnPointSafe, PLAYER_BODY } from '../src/shared/spawn-safety.js';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(child, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), timeout);
    const onData = (chunk) => {
      if (!String(chunk).includes('multijugador')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code})`));
    });
  });
}

class TestClient {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
  }

  waitFor(predicate, timeout = 4000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('websocket message timeout'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  waitForNext(predicate, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('websocket message timeout'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function connectClient(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client = new TestClient(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  client.send({ t: 'hola', name });
  const hi = await client.waitFor((message) => message.t === 'hi');
  client.hi = hi;
  return client;
}

test('server reserves safe unique spawns, caps rooms, and cancels stale respawns', async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    if (child.exitCode === null) child.kill();
  });
  await waitForServer(child);

  const health = await fetch(`http://127.0.0.1:${port}/salud`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, version: '1.2.0' });

  for (let index = 0; index < TOTAL_SLOTS; index++) {
    clients.push(await connectClient(port, `QA_${index}`));
  }
  const arena = buildMap('arena');
  const arenaColliders = buildColliders(arena.boxes);
  const assigned = clients.map(({ hi }) => ({ x: hi.spawn[0], y: hi.spawn[1], z: hi.spawn[2] }));
  assert.equal(new Set(assigned.map((point) => `${point.x}/${point.y}/${point.z}`)).size, TOTAL_SLOTS);
  for (const point of assigned) {
    assert.equal(isSpawnPointSafe(point, arenaColliders, { body: PLAYER_BODY, margin: 1 }), true);
  }

  const victim = clients[0];
  const observer = clients[1];
  const stateMessage = (position, sid) => ({
    t: 'st', p: position, ry: 0, rx: 0, s: 0, sl: false, sid,
  });
  let nextSnapshot = observer.waitForNext((message) => message.t === 'snap');
  victim.send(stateMessage([assigned[1].x, assigned[1].y, assigned[1].z], victim.hi.sid + 99));
  let snapshot = await nextSnapshot;
  assert.deepEqual(snapshot.pl.find((player) => player.id === victim.hi.id).p,
    [assigned[0].x, assigned[0].y, assigned[0].z], 'a stale spawn sequence moved the player');

  nextSnapshot = observer.waitForNext((message) => message.t === 'snap');
  victim.send(stateMessage([assigned[1].x, assigned[1].y, assigned[1].z], victim.hi.sid));
  snapshot = await nextSnapshot;
  assert.deepEqual(snapshot.pl.find((player) => player.id === victim.hi.id).p,
    [assigned[0].x, assigned[0].y, assigned[0].z], 'an impossible movement jump was accepted');

  nextSnapshot = observer.waitForNext((message) => message.t === 'snap');
  victim.send(stateMessage([30, 0.1, 30], victim.hi.sid));
  snapshot = await nextSnapshot;
  assert.deepEqual(snapshot.pl.find((player) => player.id === victim.hi.id).p,
    [assigned[0].x, assigned[0].y, assigned[0].z], 'a blocked position was accepted');

  const start = assigned[0];
  const microStepCount = 20;
  const direction = [
    { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
  ].find(({ x, z }) => {
    const path = Array.from({ length: microStepCount }, (_, index) => ({
      x: start.x + x * (index + 1) * 0.3,
      y: start.y,
      z: start.z + z * (index + 1) * 0.3,
    }));
    return path.every((point) => isSpawnPointSafe(point, arenaColliders, { body: PLAYER_BODY })) &&
      isBodyPathClear(start, path.at(-1), arenaColliders, { body: PLAYER_BODY });
  });
  assert.ok(direction, 'test spawn has no open movement lane');
  nextSnapshot = observer.waitForNext((message) => message.t === 'snap');
  for (let index = 0; index < microStepCount; index++) {
    victim.send(stateMessage([
      start.x + direction.x * (index + 1) * 0.3,
      start.y,
      start.z + direction.z * (index + 1) * 0.3,
    ], victim.hi.sid));
  }
  snapshot = await nextSnapshot;
  const afterSpam = snapshot.pl.find((player) => player.id === victim.hi.id).p;
  assert.ok(Math.hypot(afterSpam[0] - start.x, afterSpam[2] - start.z) <= 3.75,
    'rapid micro-movements bypassed the server movement budget');

  const overflowWs = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const overflow = new TestClient(overflowWs);
  await new Promise((resolve, reject) => {
    overflowWs.once('open', resolve);
    overflowWs.once('error', reject);
  });
  overflow.send({ t: 'hola', name: 'QA_FULL' });
  assert.deepEqual(await overflow.waitFor((message) => message.t === 'full'), {
    t: 'full', slots: TOTAL_SLOTS,
  });
  overflow.close();

  const killer = clients[1];
  killer.send({ t: 'hit', kind: 'pl', id: victim.hi.id, d: 120, h: 0, w: 'ar' });
  await victim.waitFor((message) => message.t === 'kill' && message.vid === victim.hi.id);
  const spawnCountBeforeRoundChange = victim.messages.filter((message) => message.t === 'spawn').length;
  killer.send({ t: 'modo', m: 'teams' });
  await victim.waitFor((message) => message.t === 'spawn' && message.rid > victim.hi.rid);
  await new Promise((resolve) => setTimeout(resolve, 2900));
  const roundSpawns = victim.messages.filter((message) => message.t === 'spawn').length - spawnCountBeforeRoundChange;
  assert.equal(roundSpawns, 1, 'an old death timer issued a second respawn');
});
