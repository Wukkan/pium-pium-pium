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
import { segmentBlocked } from '../src/shared/physics.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  client.send({ t: 'hola', pv: 2, name, mode, room });
  const hi = await client.waitFor((message) => message.t === 'hi');
  client.hi = hi;
  return client;
}

async function launchTestServer(t, extraEnv = {}) {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      SUPABASE_URL: 'http://127.0.0.1:9',
      PORT: String(port),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  t.after(() => {
    for (const client of clients) client.close();
    if (child.exitCode === null) child.kill();
  });
  await waitForServer(child);
  return { port, child, clients };
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
  assert.deepEqual(health, { ok: true, version: '1.7.5' });

  const roomsResponse = await fetch(`http://127.0.0.1:${port}/salas`);
  assert.equal(roomsResponse.headers.get('cache-control'), 'no-store');
  const lobby = await roomsResponse.json();
  assert.equal(lobby.version, '1.7.5');
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

  const staleClient = await openClient(port);
  clients.push(staleClient);
  staleClient.send({ t: 'hola', pv: 1, name: 'VERSION_VIEJA', mode: 'ffa', room: 1 });
  assert.deepEqual(await staleClient.waitFor((message) => message.t === 'joinerr'), {
    t: 'joinerr', code: 'PROTOCOL_MISMATCH', expected: 2,
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
  const correctionPromise = victim.waitForNext((message) => message.t === 'corr');
  victim.send(stateMessage([assigned[1].x, assigned[1].y, assigned[1].z], victim.hi.sid));
  [snapshot] = await Promise.all([nextSnapshot, correctionPromise.then((correction) => {
    assert.equal(correction.sid, victim.hi.sid);
    assert.deepEqual(correction.p, [assigned[0].x, assigned[0].y, assigned[0].z]);
    return correction;
  })]);
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
  overflow.send({ t: 'hola', pv: 2, name: 'QA_FULL', mode: 'ffa', room: 1 });
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

test('server rejects forged combat, incremental flight, and sustained message floods', async (t) => {
  const { port, clients } = await launchTestServer(t);
  const controller = await connectClient(port, 'SEC_0');
  clients.push(controller);
  controller.send({ t: 'botcfg', enabled: false, count: 0, rid: 1 });
  await controller.waitFor((message) => message.t === 'botcfg' && message.rid === 1);

  for (let index = 1; index < 8; index++) {
    const client = await connectClient(port, `SEC_${index}`);
    clients.push(client);
  }
  const snapshot = await controller.waitForNext((message) => message.t === 'snap' && message.pl.length === 8);
  const arenaColliders = buildColliders(buildMap('arena').boxes);
  let visiblePair = null;
  outer: for (const attackerState of snapshot.pl) {
    for (const victimState of snapshot.pl) {
      if (attackerState.id === victimState.id) continue;
      const eye = { x: attackerState.p[0], y: attackerState.p[1] + 1.58, z: attackerState.p[2] };
      const target = { x: victimState.p[0], y: victimState.p[1] + 0.9, z: victimState.p[2] };
      if (segmentBlocked(eye, target, arenaColliders)) continue;
      visiblePair = {
        attacker: clients.find(({ hi }) => hi?.id === attackerState.id),
        victim: clients.find(({ hi }) => hi?.id === victimState.id),
        eye,
        target,
      };
      break outer;
    }
  }
  assert.ok(visiblePair, 'the fixed spawn set must expose at least one visible player pair');
  const { attacker, victim, eye, target } = visiblePair;

  // Un hit sin ticket de disparo no puede causar daño ni romper una caja.
  attacker.send({ t: 'hit', kind: 'pl', id: victim.hi.id, d: 120, h: 1, w: 'sniper' });
  attacker.send({ t: 'hit', kind: 'crate', id: 'c0', d: 120, h: 0, w: 'sniper' });
  let next = await attacker.waitForNext((message) => message.t === 'snap');
  assert.equal(next.pl.find(({ id }) => id === victim.hi.id).hp, 100);
  assert.equal(next.dc.includes('c0'), false);
  assert.equal(victim.messages.some((message) => message.t === 'ouch'), false);

  // Un disparo coherente sí funciona, pero el daño declarado se limita por arma.
  attacker.send({
    t: 'fire', a: [eye.x, eye.y, eye.z], b: [target.x, target.y, target.z], k: 'pistol',
  });
  attacker.send({ t: 'hit', kind: 'pl', id: victim.hi.id, d: 120, h: 0, w: 'pistol' });
  const ouch = await victim.waitForNext((message) => message.t === 'ouch');
  assert.equal(ouch.d, 18);
  assert.equal(ouch.hp, 82);

  // El arma del hit debe coincidir con el fire y dos fires instantáneos no
  // pueden saltarse la cadencia de la pistola.
  await delay(220);
  attacker.send({
    t: 'fire', a: [eye.x, eye.y, eye.z], b: [target.x, target.y, target.z], k: 'pistol',
  });
  attacker.send({ t: 'hit', kind: 'pl', id: victim.hi.id, d: 120, h: 0, w: 'sniper' });
  next = await attacker.waitForNext((message) => message.t === 'snap');
  assert.equal(next.pl.find(({ id }) => id === victim.hi.id).hp, 82);

  await delay(220);
  const observer = clients.find((client) => client !== attacker && client !== victim);
  const observerIndex = observer.messages.length;
  const visualFire = { t: 'fire', a: [eye.x, eye.y, eye.z], b: [target.x, target.y, target.z], k: 'pistol' };
  attacker.send(visualFire);
  attacker.send(visualFire);
  await delay(120);
  assert.equal(observer.messages.slice(observerIndex)
    .filter((message) => message.t === 'fire' && message.id === attacker.hi.id).length, 1);

  // Un ticket de granada todavía exige que la explosión autoritativa esté
  // dentro de su radio; lanzarla no autoriza a dañar a cualquier sala.
  const farVictim = snapshot.pl
    .filter(({ id }) => id !== attacker.hi.id)
    .sort((left, right) => {
      const distance = (state) => Math.hypot(state.p[0] - eye.x, state.p[2] - eye.z);
      return distance(right) - distance(left);
    })[0];
  const farClient = clients.find(({ hi }) => hi?.id === farVictim.id);
  const beforeNade = next.pl.find(({ id }) => id === farVictim.id)?.hp ?? 100;
  const farOuchBefore = farClient.messages.filter((message) => message.t === 'ouch').length;
  const awayX = eye.x - farVictim.p[0], awayZ = eye.z - farVictim.p[2];
  const awayLength = Math.hypot(awayX, awayZ) || 1;
  attacker.send({
    t: 'nade', p: [eye.x, eye.y, eye.z],
    v: [awayX / awayLength * 16, 4.5, awayZ / awayLength * 16], im: 0,
  });
  await delay(2300);
  attacker.send({ t: 'hit', kind: 'pl', id: farVictim.id, d: 90, h: 0, w: 'nade' });
  next = await attacker.waitForNext((message) => message.t === 'snap');
  assert.equal(next.pl.find(({ id }) => id === farVictim.id).hp, beforeNade);
  assert.equal(farClient.messages.filter((message) => message.t === 'ouch').length, farOuchBefore);

  // La explosión se resuelve sin confiar en un mensaje hit del cliente e
  // incluye medio daño propio, igual que el entrenamiento local.
  const selfDamage = attacker.waitForNext((message) =>
    message.t === 'ouch' && message.by === 'tu propia granada');
  attacker.send({
    t: 'nade', p: [eye.x, eye.y, eye.z], v: [0, 10, 0], im: 0,
  });
  const selfOuch = await selfDamage;
  assert.ok(selfOuch.d > 0 && selfOuch.d <= 45);
  assert.ok(selfOuch.hp < 100);

  // Muchos micro-estados no pueden fabricar vuelo y, al dejar de enviar,
  // la posición autoritativa cae a una superficie válida.
  const flyer = clients.find((client) => client !== attacker && client !== victim && client !== observer);
  const flyerState = next.pl.find(({ id }) => id === flyer.hi.id);
  for (let index = 1; index <= 34; index++) {
    flyer.send({
      t: 'st', p: [flyerState.p[0], flyerState.p[1] + index * 0.3, flyerState.p[2]],
      ry: 0, rx: 0, s: 0, sl: false, sid: flyer.hi.sid,
    });
    await delay(25);
  }
  await delay(1100);
  next = await flyer.waitForNext((message) => message.t === 'snap');
  assert.ok(next.pl.find(({ id }) => id === flyer.hi.id).p[1] <= flyerState.p[1] + 0.5,
    'incremental ascent left the authoritative player hovering');

  // El bucket global corta el socket, aunque ping individual tenga dedupe.
  const flood = await connectClient(port, 'SEC_FLOOD', 'ffa', 2);
  clients.push(flood);
  const closed = new Promise((resolve) => flood.ws.once('close', (code, reason) =>
    resolve({ code, reason: String(reason) })));
  for (let index = 0; index < 500; index++) flood.send({ t: 'ping', ts: index });
  const closeInfo = await Promise.race([closed, delay(2000).then(() => null)]);
  assert.deepEqual(closeInfo, { code: 1008, reason: 'Demasiados mensajes' });

  // El presupuesto se cobra antes de parsear: frames inválidos tampoco pueden
  // eludir el límite global de la conexión.
  const malformedFlood = await connectClient(port, 'SEC_BAD_JSON', 'ffa', 2);
  clients.push(malformedFlood);
  const malformedClosed = new Promise((resolve) => malformedFlood.ws.once('close', (code, reason) =>
    resolve({ code, reason: String(reason) })));
  for (let index = 0; index < 500; index++) malformedFlood.ws.send(index % 3 === 0 ? '{' : index % 3 === 1 ? 'null' : '[]');
  const malformedCloseInfo = await Promise.race([malformedClosed, delay(2000).then(() => null)]);
  assert.deepEqual(malformedCloseInfo, { code: 1008, reason: 'Demasiados mensajes' });
});

test('a player joining during podium receives the complete current podium payload', async (t) => {
  const { port, clients } = await launchTestServer(t, { PIUM_MATCH_TIME_SECONDS: '1' });
  const first = await connectClient(port, 'PODIUM_FIRST');
  clients.push(first);
  const originalPodium = await first.waitFor((message) => message.t === 'podium', 4000);
  assert.equal(originalPodium.stage, 'map');

  const late = await connectClient(port, 'PODIUM_LATE');
  clients.push(late);
  const lateMatch = await late.waitFor((message) => message.t === 'match');
  const latePodium = await late.waitFor((message) => message.t === 'podium');
  assert.equal(lateMatch.st, 'podium');
  assert.equal(latePodium.winner, originalPodium.winner);
  assert.deepEqual(latePodium.rows, originalPodium.rows);
  assert.equal(latePodium.stage, 'map');
  assert.ok(latePodium.secs >= 1 && latePodium.secs <= 15);
});

test('a fresh zombie room starts its first wave after the preparation countdown', async (t) => {
  const { port, clients } = await launchTestServer(t, {
    PIUM_ZOMBIE_PREP_SECONDS: '0.05',
  });
  const player = await connectClient(port, 'ZOMBIE_START_QA', 'zombies', 1);
  clients.push(player);

  const wave = await player.waitFor(
    (message) => message.t === 'match' && message.wv === 1,
    3000,
  );
  assert.equal(wave.zl, 6);
  const snapshot = await player.waitFor(
    (message) => message.t === 'snap' &&
      message.bots.filter((bot) => bot.z === 1 && bot.al === 1).length === 6,
    3000,
  );
  assert.equal(snapshot.m.wv, 1);
});
