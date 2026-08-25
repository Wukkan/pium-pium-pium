import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { buildColliders, buildMap, TOTAL_SLOTS } from '../src/shared/mapdata.js';
import {
  LOBBY_MODE_IDS, LOBBY_ROOM_CAPACITY, LOBBY_ROOM_IDS, LOBBY_TOTAL_ROOMS,
} from '../src/lobby-catalog.js';
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

async function openClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client = new TestClient(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return client;
}

async function connectClient(port, name, mode = 'ffa', room = 1) {
  const client = await openClient(port);
  client.send({ t: 'hola', name, mode, room });
  const hi = await client.waitFor((message) => message.t === 'hi');
  client.hi = hi;
  return client;
}

test('server exposes eight isolated fixed-mode rooms with strict ten-player admission', async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  const roomOneClients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    if (child.exitCode === null) child.kill();
  });
  await waitForServer(child);

  const health = await fetch(`http://127.0.0.1:${port}/salud`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, version: '1.6.2' });

  const roomsResponse = await fetch(`http://127.0.0.1:${port}/salas`);
  assert.equal(roomsResponse.headers.get('cache-control'), 'no-store');
  const lobby = await roomsResponse.json();
  assert.equal(lobby.version, '1.6.2');
  assert.equal(lobby.capacity, LOBBY_ROOM_CAPACITY);
  assert.equal(lobby.totalRooms, LOBBY_TOTAL_ROOMS);
  assert.equal(lobby.rooms.length, LOBBY_TOTAL_ROOMS);
  assert.equal(lobby.rooms.every(({ players, capacity }) =>
    players === 0 && capacity === LOBBY_ROOM_CAPACITY), true);
  assert.equal(lobby.rooms.every(({ timeLeft }) => timeLeft === 300), true);
  assert.deepEqual(new Set(lobby.rooms.map(({ mode }) => mode)), new Set(LOBBY_MODE_IDS));
  for (const mode of LOBBY_MODE_IDS) {
    assert.deepEqual(lobby.rooms.filter((entry) => entry.mode === mode).map(({ room }) => room),
      LOBBY_ROOM_IDS);
  }

  const roomsHead = await fetch(`http://127.0.0.1:${port}/salas`, { method: 'HEAD' });
  assert.equal(roomsHead.status, 200);
  assert.equal(await roomsHead.text(), '');
  const roomsPost = await fetch(`http://127.0.0.1:${port}/salas`, { method: 'POST' });
  assert.equal(roomsPost.status, 405);
  assert.equal(roomsPost.headers.get('allow'), 'GET, HEAD');

  const invalid = await openClient(port);
  clients.push(invalid);
  invalid.send({ t: 'hola', name: 'SIN_SALA' });
  assert.deepEqual(await invalid.waitFor((message) => message.t === 'joinerr'), {
    t: 'joinerr', code: 'INVALID_SELECTION',
  });

  // El reloj de una sala aún vacía no consume la ronda.
  await new Promise((resolve) => setTimeout(resolve, 1250));

  for (let index = 0; index < TOTAL_SLOTS; index++) {
    const client = await connectClient(port, `QA_${index}`, 'ffa', 1);
    clients.push(client);
    roomOneClients.push(client);
  }
  assert.equal(roomOneClients[0].messages.find((message) => message.t === 'match').tl, 300);
  assert.equal(roomOneClients.every(({ hi }) => hi.mode === 'ffa' && hi.room === 1), true);
  const arena = buildMap('arena');
  const arenaColliders = buildColliders(arena.boxes);
  const assigned = roomOneClients.map(({ hi }) => ({ x: hi.spawn[0], y: hi.spawn[1], z: hi.spawn[2] }));
  assert.equal(new Set(assigned.map((point) => `${point.x}/${point.y}/${point.z}`)).size, TOTAL_SLOTS);
  for (const point of assigned) {
    assert.equal(isSpawnPointSafe(point, arenaColliders, { body: PLAYER_BODY, margin: 1 }), true);
  }

  const victim = roomOneClients[0];
  const observer = roomOneClients[1];
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

  const overflow = await openClient(port);
  clients.push(overflow);
  overflow.send({ t: 'hola', name: 'QA_FULL', mode: 'ffa', room: 1 });
  assert.deepEqual(await overflow.waitFor((message) => message.t === 'full'), {
    t: 'full', code: 'ROOM_FULL', mode: 'ffa', room: 1,
    slots: TOTAL_SLOTS, players: TOTAL_SLOTS,
  });

  // Llenar una sala no bloquea la segunda sala del mismo modo ni otra
  // modalidad. Sus snapshots y cambios de bots tampoco se cruzan.
  const roomTwo = await connectClient(port, 'QA_ROOM_2', 'ffa', 2);
  const teams = await connectClient(port, 'QA_TEAMS', 'teams', 1);
  clients.push(roomTwo, teams);
  assert.equal(roomTwo.hi.mode, 'ffa');
  assert.equal(roomTwo.hi.room, 2);
  assert.equal(teams.hi.mode, 'teams');
  assert.equal(teams.hi.room, 1);

  const roomOneSnapshot = await observer.waitForNext((message) => message.t === 'snap');
  const roomTwoSnapshot = await roomTwo.waitForNext((message) => message.t === 'snap');
  const teamsSnapshot = await teams.waitForNext((message) => message.t === 'snap');
  assert.equal(roomOneSnapshot.pl.length, TOTAL_SLOTS);
  assert.equal(roomTwoSnapshot.pl.length, 1);
  assert.equal(teamsSnapshot.pl.length, 1);
  assert.equal(roomTwoSnapshot.m.mode, 'ffa');
  assert.equal(roomTwoSnapshot.m.room, 2);
  assert.equal(teamsSnapshot.m.mode, 'teams');
  assert.equal(teamsSnapshot.m.room, 1);

  teams.send({ t: 'modo', m: 'ffa' });
  const immutableModeSnapshot = await teams.waitForNext((message) => message.t === 'snap');
  assert.equal(immutableModeSnapshot.m.mode, 'teams', 'a client changed the fixed room mode');

  roomTwo.send({ t: 'botcfg', enabled: false, count: 0, rid: 77 });
  const changedConfig = await roomTwo.waitFor((message) => message.t === 'botcfg' && message.rid === 77);
  assert.equal(changedConfig.actual, 0);
  assert.ok(teams.hi.bc.actual > 0);
  assert.equal(teams.messages.some((message) => message.t === 'botcfg' && message.rid === 77), false,
    'bot configuration leaked across rooms');

  roomTwo.send({ t: 'chat', i: 0 });
  await roomTwo.waitForNext((message) => message.t === 'chat' && message.n === 'QA_ROOM_2');
  assert.equal(teams.messages.some((message) => message.t === 'chat' && message.n === 'QA_ROOM_2'), false,
    'chat leaked across rooms');

  const occupiedLobby = await fetch(`http://127.0.0.1:${port}/salas`).then((response) => response.json());
  const fullRoom = occupiedLobby.rooms.find((entry) => entry.mode === 'ffa' && entry.room === 1);
  const availableRoom = occupiedLobby.rooms.find((entry) => entry.mode === 'ffa' && entry.room === 2);
  assert.equal(fullRoom.players, TOTAL_SLOTS);
  assert.equal(fullRoom.full, true);
  assert.equal(availableRoom.players, 1);
  assert.equal(availableRoom.joinable, true);
});
