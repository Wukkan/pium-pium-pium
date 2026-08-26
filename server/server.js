import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  buildMap, buildColliders, TOTAL_SLOTS, MAX_BOTS, BOT_NAMES, BOT_COLORS,
  MAPS, HATS, QUICK_CHAT, applyJumpPadImpulse, badgeFor,
  jumpPadContainsPoint, jumpPadIntersectsSegment,
} from '../src/shared/mapdata.js';
import {
  DEFAULT_BOT_CONFIG, effectiveBotCount, sanitizeBotConfigUpdate,
} from '../src/shared/bot-config.js';
import {
  LOBBY_MODE_IDS,
  LOBBY_ROOM_CAPACITY,
  LOBBY_ROOM_IDS,
  LOBBY_ROOMS_PER_MODE,
  LOBBY_TOTAL_ROOMS,
  lobbyRoomKey,
} from '../src/lobby-catalog.js';
import {
  BOT_BODY,
  PLAYER_BODY,
  bodyOverlapsCollider,
  bodyPenetratesCollider,
  colliderOccupied,
  isBodyPathClear,
  requireSafeSpawnPoints,
  selectSafeSpawn,
} from '../src/shared/spawn-safety.js';
import { segmentBlocked } from '../src/shared/physics.js';
import { PROTOCOL_VERSION } from '../src/shared/protocol.js';
import {
  COMBAT_LIMITS,
  FIREARM_RULES,
  firearmCrateDamageLimit,
  firearmDamageLimit,
  firearmRule,
  knifeDamageLimit,
  minimumFireInterval,
} from '../src/shared/combat-rules.js';
import { ServerBot } from './botai.js';
import * as ranking from './ranking.js';

// ---------------------------------------------------------------------------
// PIUM PIUM PIUM — servidor: sirve el cliente por HTTP y lleva la partida por
// WebSocket. En modos normales, los bots configurables rellenan plazas sin
// superar TOTAL_SLOTS ni MAX_BOTS. Las oleadas zombis se gestionan aparte.
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 5173;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICK = 1 / 15;
const GAME_VERSION = '1.7.7';
const ZOMBIE_WAVES = 8;
const configuredZombiePrep = Number(process.env.PIUM_ZOMBIE_PREP_SECONDS);
const ZOMBIE_PREP_SECONDS = Number.isFinite(configuredZombiePrep)
  ? Math.max(0.05, Math.min(30, configuredZombiePrep))
  : 5;
const MAX_ZOMBIES_PER_WAVE = 4 + 2 * ZOMBIE_WAVES;
const MIN_ZOMBIE_SPAWNS = MAX_ZOMBIES_PER_WAVE + TOTAL_SLOTS;
const MOVEMENT_HORIZONTAL_RATE = 18;
const MOVEMENT_HORIZONTAL_CAP = 3.25;
const MOVEMENT_VERTICAL_RATE = 25;
const MOVEMENT_VERTICAL_CAP = 4;
const MOVEMENT_INITIAL_HORIZONTAL = 1.5;
const MOVEMENT_INITIAL_VERTICAL = 1.5;
const MESSAGE_BUCKET_CAPACITY = 120;
const MESSAGE_BUCKET_REFILL = 80;
const MESSAGE_ABUSE_STRIKES = 3;
const GRAVITY = 24;
const MOVEMENT_CONTACT_TOLERANCE = 0.004;

if (TOTAL_SLOTS !== LOBBY_ROOM_CAPACITY) {
  throw new Error(`Capacidad incoherente: mapa=${TOTAL_SLOTS}, lobby=${LOBBY_ROOM_CAPACITY}`);
}

let roomRegistry = new Map();

function isFiniteVectorPayload(value, maxAbs = 10000) {
  return Array.isArray(value) && value.length === 3 &&
    value.every((component) => Number.isFinite(component) && Math.abs(component) <= maxAbs);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('URL malformada');
    return;
  }
  if (urlPath === '/salud') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, version: GAME_VERSION }));
    return;
  }
  if (urlPath === '/salas') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      res.end('método no permitido');
      return;
    }
    const rooms = [...roomRegistry.values()].map((room) => room.summary());
    const body = JSON.stringify({
      version: GAME_VERSION,
      roomsPerMode: LOBBY_ROOMS_PER_MODE,
      capacity: LOBBY_ROOM_CAPACITY,
      totalRooms: LOBBY_TOTAL_ROOMS,
      rooms,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (urlPath === '/ranking') {
    ranking.top(20).then((rows) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(rows));
    });
    return;
  }
  // solo en desarrollo local: guardar capturas del canvas en _shots/
  if (req.method === 'PUT' && !process.env.RENDER && urlPath.startsWith('/_shots/')) {
    const name = path.basename(urlPath);
    if (!name.endsWith('.jpg') && !name.endsWith('.png')) { res.writeHead(403); res.end(); return; }
    fs.mkdirSync(path.join(ROOT, '_shots'), { recursive: true });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(ROOT, '_shots', name), Buffer.concat(chunks));
      res.writeHead(204); res.end();
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('método no permitido');
    return;
  }
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const normalized = path.normalize(requested);
  const allowedRoots = ['src', 'assets', 'sounds', 'vendor'];
  const allowed = normalized === 'index.html' ||
    allowedRoots.some((directory) => normalized.startsWith(`${directory}${path.sep}`));
  const file = path.resolve(ROOT, normalized);
  const relative = path.relative(ROOT, file);
  const outsideRoot = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!allowed || outsideRoot) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('no encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function createRoomEngine(roomMode, roomNumber) {
// --- estado aislado de esta sala ---
const colliders = [];
const crates = new Map(); // id -> {hp, collider, alive, respawnAt}
let mapData = null;
let playerSpawnPoints = [];
let botSpawnPoints = [];
let zombieSpawnPoints = [];
let playBounds = null;
const players = new Map(); // id -> jugador
const bots = [];
const kits = []; // loot del suelo: {id, x, y, z, k, a, expireAt}
let nextId = 1;
let botSerial = 0;
let kitSerial = 0;
let botConfig = { ...DEFAULT_BOT_CONFIG };

function loadMap(mapId) {
  const nextMapData = buildMap(mapId);
  const nextColliders = buildColliders(nextMapData.boxes);
  const nextPlayerSpawns = requireSafeSpawnPoints(nextMapData.playerSpawns, nextColliders, {
    body: PLAYER_BODY,
    margin: 1,
    label: `${mapId}.playerSpawns`,
  });
  const nextBotSpawns = requireSafeSpawnPoints(nextMapData.botSpawns, nextColliders, {
    body: BOT_BODY,
    margin: 0.15,
    label: `${mapId}.botSpawns`,
  });
  requireSafeSpawnPoints(nextMapData.waypoints, nextColliders, {
    body: BOT_BODY,
    margin: 0.05,
    label: `${mapId}.waypoints`,
  });
  requireSafeSpawnPoints(nextMapData.navigationPoints || nextMapData.waypoints, nextColliders, {
    body: BOT_BODY,
    margin: 0.01,
    label: `${mapId}.navigationPoints`,
  });
  const nextZombieSpawns = requireSafeSpawnPoints([
    ...nextMapData.botSpawns,
    ...nextMapData.playerSpawns,
    ...nextMapData.waypoints,
  ], nextColliders, {
    body: BOT_BODY,
    margin: 0.15,
    label: `${mapId}.zombieSpawns`,
  }).filter((point, index, list) => list.findIndex((candidate) =>
    candidate.x === point.x && candidate.y === point.y && candidate.z === point.z) === index);
  if (nextZombieSpawns.length < MIN_ZOMBIE_SPAWNS) {
    throw new Error(`${mapId}: se requieren ${MIN_ZOMBIE_SPAWNS} puntos seguros para humanos y la oleada máxima`);
  }
  const floor = nextMapData.boxes[0];
  const nextPlayBounds = {
    minX: floor.x - floor.w / 2 + PLAYER_BODY.halfX,
    maxX: floor.x + floor.w / 2 - PLAYER_BODY.halfX,
    minZ: floor.z - floor.d / 2 + PLAYER_BODY.halfZ,
    maxZ: floor.z + floor.d / 2 - PLAYER_BODY.halfZ,
  };

  mapData = nextMapData;
  colliders.length = 0;
  colliders.push(...nextColliders);
  playerSpawnPoints = nextPlayerSpawns;
  botSpawnPoints = nextBotSpawns;
  zombieSpawnPoints = nextZombieSpawns;
  playBounds = nextPlayBounds;
  crates.clear();
  for (const c of colliders) {
    if (c.crate) crates.set(c.crate, { hp: 80, collider: c, alive: true, respawnAt: 0 });
  }
}
loadMap('arena');

function destroyedCrates() {
  const out = [];
  for (const [id, c] of crates) if (!c.alive) out.push(id);
  return out;
}

function spawnKit(pos) {
  kits.push({ id: 'k' + kitSerial++, x: pos.x, y: pos.y, z: pos.z, k: 'health', a: 25, expireAt: now() + 30 });
  kits.push({ id: 'k' + kitSerial++, x: pos.x + 0.55, y: pos.y, z: pos.z, k: 'ammo', a: 20, expireAt: now() + 30 });
  while (kits.length > 12) kits.shift(); // límite de kits en el suelo
}

// --- modos de partida ---
const MODE_NAMES = { ffa: 'TODOS CONTRA TODOS', teams: 'EQUIPOS', gun: 'BÚSQUEDA DEL ARMA', zombies: 'ZOMBIS' };
const GUN_LADDER = ['pistol', 'shotgun', 'smg', 'ar', 'sniper'];
const TEAM_COLORS = { r: 0xd84a3a, b: 0x3a6ad8 };
const configuredMatchTime = Number(process.env.PIUM_MATCH_TIME_SECONDS);
const MATCH_TIME = Number.isFinite(configuredMatchTime)
  ? Math.max(1, Math.min(3600, configuredMatchTime))
  : 300;                  // 5 minutos; reducible en integración
const KILL_LIMIT = 30;    // ffa y equipos
const PODIUM_STAGE_TIME = 15;

const match = {
  roundId: 1,
  mode: roomMode,
  map: 'arena',
  state: 'playing', // playing | podium
  endAt: Date.now() / 1000 + MATCH_TIME,
  podiumEndAt: 0,
  podiumStageEndAt: 0,
  podiumStage: 'map',
  mapVotes: new Map(),        // playerId -> mapa votado
  teamScores: { r: 0, b: 0 },
  wave: 0,
  // Las salas nacen ya preparadas para su primera oleada. Mientras están
  // vacías pauseRoomTimers desplaza este deadline, de modo que el conteo
  // comienza al entrar el primer humano y nunca queda bloqueado en wave=0.
  waveBreakAt: roomMode === 'zombies' ? Date.now() / 1000 + ZOMBIE_PREP_SECONDS : 0,
  podiumPayload: null,
};

function botConfigData(reason = null) {
  const data = {
    enabled: botConfig.enabled,
    count: botConfig.count,
    actual: bots.length,
    max: MAX_BOTS,
    humans: players.size,
    slots: TOTAL_SLOTS,
    locked: match.mode === 'zombies',
  };
  if (reason) data.reason = reason;
  return data;
}

function botConfigMsg(reason = null, requestId = null) {
  const msg = { t: 'botcfg', ...botConfigData(reason) };
  if (Number.isSafeInteger(requestId) && requestId >= 0) msg.rid = requestId;
  return msg;
}

function matchMsg() {
  return {
    t: 'match', mode: roomMode, room: roomNumber, map: match.map, st: match.state,
    rid: match.roundId,
    tl: Math.max(0, Math.round((match.state === 'playing' ? match.endAt : match.podiumStageEndAt) - now())),
    ps: match.podiumStage,
    ts: match.teamScores,
    wv: match.wave,
    zl: bots.filter((b) => b.zombie && !b.dead).length,
    bc: botConfigData(),
  };
}

function assignTeam() {
  let r = 0, b = 0;
  for (const p of players.values()) {
    if (p.team === 'r') r++;
    else if (p.team === 'b') b++;
  }
  return r <= b ? 'r' : 'b';
}

function startMatch(mapId = match.map) {
  match.roundId++;
  match.state = 'playing';
  match.podiumStage = 'map';
  match.podiumStageEndAt = 0;
  match.endAt = now() + MATCH_TIME;
  match.mapVotes = new Map();
  match.teamScores = { r: 0, b: 0 };
  match.wave = 0;
  match.waveBreakAt = roomMode === 'zombies' ? now() + ZOMBIE_PREP_SECONDS : 0;
  match.podiumPayload = null;
  bots.length = 0;
  kits.length = 0;
  if (mapId !== match.map) {
    loadMap(mapId);
    match.map = mapId;
  } else {
    // restaurar las cajas destruidas
    for (const c of crates.values()) {
      if (!c.alive) { c.alive = true; c.hp = 80; colliders.push(c.collider); }
    }
  }
  // Invalidar muertes pendientes y reservar los puntos de la nueva ronda de
  // forma secuencial. Así ningún jugador conserva una posición del mapa viejo.
  for (const p of players.values()) {
    p.alive = false;
    p.team = null;
    p.respawnToken = (p.respawnToken || 0) + 1;
  }
  for (const p of players.values()) {
    p.kills = 0; p.deaths = 0; p.curStreak = 0; p.gunIdx = 0;
    p.team = roomMode === 'teams' ? assignTeam() : null;
    spawnPlayer(p);
  }
  rebalanceBots();
  broadcast(matchMsg());
  broadcast(botConfigMsg());
  broadcast({ t: 'aviso', txt: `▶ Nueva ronda: ${MODE_NAMES[roomMode]}` });
  console.log(`[${roomMode}:${roomNumber}] nueva ronda en ${match.map}`);
}

function podiumRows() {
  const rows = [...players.values()].map((p) => ({
    n: p.name, k: p.kills, d: p.deaths, tm: p.team, gi: p.gunIdx || 0,
  }));
  if (match.mode === 'gun') rows.sort((a, b) => b.gi - a.gi || b.k - a.k);
  else rows.sort((a, b) => b.k - a.k);
  return rows.slice(0, 5);
}

function endMatch(reasonTxt) {
  if (match.state !== 'playing') return;
  match.state = 'podium';
  match.podiumEndAt = now() + PODIUM_STAGE_TIME;
  match.podiumStage = 'map';
  match.podiumStageEndAt = now() + PODIUM_STAGE_TIME;
  const rows = podiumRows();
  let winner = rows.length ? rows[0].n : '—';
  if (match.mode === 'teams') {
    winner = match.teamScores.r === match.teamScores.b
      ? 'EMPATE'
      : (match.teamScores.r > match.teamScores.b ? '🔴 EQUIPO ROJO' : '🔵 EQUIPO AZUL');
  }
  match.podiumPayload = {
    t: 'podium', winner, txt: reasonTxt || '', rows,
    ts: match.teamScores, mode: roomMode, room: roomNumber,
    secs: PODIUM_STAGE_TIME, stage: 'map',
    maps: Object.keys(MAPS), map: match.map,
  };
  broadcast(match.podiumPayload);
}

function currentPodiumMsg() {
  if (match.state !== 'podium' || !match.podiumPayload) return null;
  return {
    ...match.podiumPayload,
    secs: Math.max(1, Math.round(match.podiumStageEndAt - now())),
  };
}

function nextMap() {
  const tally = {};
  for (const m of match.mapVotes.values()) tally[m] = (tally[m] || 0) + 1;
  let best = match.map, bestN = 0;
  for (const m of Object.keys(MAPS)) {
    if ((tally[m] || 0) > bestN) { best = m; bestN = tally[m]; }
  }
  return best;
}

// puntuación de equipo (cuentan también las bajas de los bots del equipo)
function scoreTeamKill(team) {
  if (match.mode !== 'teams' || !team || match.state !== 'playing') return;
  match.teamScores[team]++;
  if (match.teamScores[team] >= KILL_LIMIT) endMatch('🎯 Límite de bajas alcanzado');
}

function spawnWave(n) {
  match.wave = n;
  const count = 4 + 2 * n;
  for (let i = 0; i < count; i++) {
    const b = new ServerBot('z' + botSerial++, `Zombi_${i + 1}`, 0x69a05a, {
      zombie: true, hp: 50 + 8 * n, speedMul: 0.75 + n * 0.07, meleeDmg: 10 + n,
      spawnPicker: pickZombieSpawn,
    });
    bots.push(b);
  }
  broadcast({ t: 'aviso', txt: `🧟 Oleada ${n}: ${count} zombis` });
  broadcast(matchMsg());
  broadcast(botConfigMsg());
}

function modeTick(t) {
  if (match.state === 'podium') {
    if (t >= match.podiumStageEndAt) startMatch(nextMap());
    return;
  }
  // reaparición de cajas destruidas (45 s)
  for (const [id, c] of crates) {
    if (!c.alive && t >= c.respawnAt) {
      // Reserva predictiva para cubrir movimiento + latencia de red antes de
      // que el cliente reciba la restauración del collider.
      const occupiedByPlayer = colliderOccupied(c.collider, [...players.values()], PLAYER_BODY, 2);
      const occupiedByBot = colliderOccupied(c.collider, bots, BOT_BODY, 1.25);
      if (occupiedByPlayer || occupiedByBot) {
        c.respawnAt = t + 1;
        continue;
      }
      c.alive = true;
      c.hp = 80;
      colliders.push(c.collider);
      broadcast({ t: 'cbox', id, al: 1 });
    }
  }
  if (players.size === 0) return; // sin humanos el reloj no corre
  if (match.mode === 'zombies') {
    const vivos = bots.filter((b) => !b.dead).length;
    if (match.wave > 0 && vivos === 0 && match.waveBreakAt === 0) {
      bots.length = 0; // limpiar cadáveres
      if (match.wave >= ZOMBIE_WAVES) {
        endMatch(`🏆 ¡Superasteis las ${ZOMBIE_WAVES} oleadas!`);
        return;
      }
      match.waveBreakAt = t + 6;
      broadcast({ t: 'aviso', txt: `✅ Oleada ${match.wave} superada` });
    }
    if (match.waveBreakAt > 0 && t >= match.waveBreakAt) {
      match.waveBreakAt = 0;
      spawnWave(match.wave + 1);
    }
  } else if (t >= match.endAt) {
    endMatch('⏱ Tiempo agotado');
  }
}

const now = () => Date.now() / 1000;

function sanitizeName(raw) {
  let n = String(raw || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 14);
  if (!n) n = 'Pium_' + Math.floor(Math.random() * 999);
  // nombre único
  let base = n, i = 2;
  const taken = () =>
    [...players.values()].some((p) => p.name === n) || bots.some((b) => b.name === n);
  while (taken()) n = base.slice(0, 11) + '_' + i++;
  return n;
}

function liveOccupants(exclude = null) {
  return [
    ...[...players.values()].filter((player) => player !== exclude && player.alive),
    ...bots.filter((bot) => bot !== exclude && !bot.dead),
  ];
}

function pickSpawn(player = null) {
  const spawn = selectSafeSpawn({
    points: playerSpawnPoints,
    colliders,
    body: PLAYER_BODY,
    margin: 1,
    occupants: liveOccupants(player),
    previous: player?.lastSpawn,
  });
  if (!spawn) throw new Error(`No hay respawns seguros en ${match.map}`);
  return spawn;
}

function pickBotSpawn(bot = null) {
  const spawn = selectSafeSpawn({
    points: botSpawnPoints,
    colliders,
    body: BOT_BODY,
    margin: 0.15,
    occupants: liveOccupants(bot),
    previous: bot?.lastSpawn,
    minOccupantDistance: 1.25,
  });
  if (!spawn) throw new Error(`No hay respawns seguros para bots en ${match.map}`);
  return spawn;
}

function pickZombieSpawn(bot = null) {
  const spawn = selectSafeSpawn({
    points: zombieSpawnPoints,
    colliders,
    body: BOT_BODY,
    margin: 0.15,
    occupants: liveOccupants(bot),
    previous: bot?.lastSpawn,
    minOccupantDistance: 1.25,
  });
  if (!spawn) throw new Error(`No hay respawns seguros para zombis en ${match.map}`);
  return spawn;
}

function spawnPlayer(player, notify = true) {
  const sp = pickSpawn(player);
  player.respawnToken = (player.respawnToken || 0) + 1;
  player.spawnSeq = (player.spawnSeq || 0) + 1;
  player.alive = true;
  player.hp = 100;
  player.pos = { ...sp };
  player.lastSpawn = { ...sp };
  resetMovementBudget(player);
  resetCombatState(player);
  if (notify) {
    send(player, {
      t: 'spawn',
      p: [sp.x, sp.y, sp.z],
      sid: player.spawnSeq,
      rid: match.roundId,
      map: match.map,
    });
  }
  return sp;
}

function eventAllowed(player, event, limit) {
  const time = now();
  const windowKey = `_${event}Win`;
  const countKey = `_${event}Count`;
  if (!player[windowKey] || time - player[windowKey] > 1) {
    player[windowKey] = time;
    player[countKey] = 0;
  }
  player[countKey]++;
  return player[countKey] <= limit;
}

function distOk(a, b, max = 130) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= max;
}

function resetCombatState(player) {
  player._weaponAmmo = Object.fromEntries(
    Object.entries(FIREARM_RULES).map(([kind, rule]) => [kind, rule.mag]),
  );
  player._lastFireAt = -Infinity;
  player._lastFireKind = null;
  player._shots = [];
  player._nades = [];
  player._regularNadesUsed = 0;
  player._lastRegularNadeAt = -Infinity;
  player._lastKnifeAt = -Infinity;
  player._verticalFlight = null;
  player._lastAcceptedStateAt = now();
}

function resetMessageBudget(player) {
  player._messageTokens = MESSAGE_BUCKET_CAPACITY;
  player._messageBudgetAt = now();
  player._messageAbuseAt = 0;
  player._messageAbuseStrikes = 0;
  player._closingForAbuse = false;
}

function messageAllowed(player) {
  const time = now();
  const previous = Number.isFinite(player._messageBudgetAt) ? player._messageBudgetAt : time;
  player._messageBudgetAt = time;
  player._messageTokens = Math.min(
    MESSAGE_BUCKET_CAPACITY,
    Math.max(0, Number(player._messageTokens) || 0) + Math.max(0, time - previous) * MESSAGE_BUCKET_REFILL,
  );
  if (player._messageTokens >= 1) {
    player._messageTokens -= 1;
    return true;
  }
  if (!player._messageAbuseAt || time - player._messageAbuseAt > 2) {
    player._messageAbuseAt = time;
    player._messageAbuseStrikes = 0;
  }
  player._messageAbuseStrikes++;
  if (player._messageAbuseStrikes >= MESSAGE_ABUSE_STRIKES && !player._closingForAbuse) {
    player._closingForAbuse = true;
    player.ws.close(1008, 'Demasiados mensajes');
  }
  return false;
}

function vectorFromPayload(value) {
  return { x: value[0], y: value[1], z: value[2] };
}

function entityCenter(entity, head = false) {
  return {
    x: entity.pos.x,
    y: entity.pos.y + (head ? 1.55 : 0.9),
    z: entity.pos.z,
  };
}

function playerEye(player) {
  return { x: player.pos.x, y: player.pos.y + 1.58, z: player.pos.z };
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= 1e-9) return Infinity;
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) /
      lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * ratio),
    point.y - (start.y + dy * ratio),
    point.z - (start.z + dz * ratio),
  );
}

function hasLineOfSight(start, end, ignoredCollider = null) {
  const blockers = ignoredCollider ? colliders.filter((collider) => collider !== ignoredCollider) : colliders;
  return !segmentBlocked(start, end, blockers);
}

function consumeWeaponUse(player, kind, time) {
  const rule = firearmRule(kind);
  if (!rule) return false;
  if (match.mode === 'gun' && kind !== GUN_LADDER[player.gunIdx]) return false;
  const elapsed = time - player._lastFireAt;
  const minimum = player._lastFireKind && player._lastFireKind !== kind
    ? COMBAT_LIMITS.weaponSwitchDelay
    : minimumFireInterval(kind);
  if (elapsed < minimum) return false;

  if (elapsed >= rule.reloadTime * 0.85) player._weaponAmmo[kind] = rule.mag;
  const ammo = Number(player._weaponAmmo[kind]);
  if (!Number.isFinite(ammo) || ammo <= 0) return false;
  player._weaponAmmo[kind] = ammo - 1;
  player._lastFireAt = time;
  player._lastFireKind = kind;
  return true;
}

function acceptFire(player, message) {
  const kind = typeof message.k === 'string' ? message.k : '';
  const rule = firearmRule(kind);
  if (!rule || rule.projectile || !isFiniteVectorPayload(message.a, 1000) ||
      !isFiniteVectorPayload(message.b, 1000)) return null;
  const start = vectorFromPayload(message.a);
  const end = vectorFromPayload(message.b);
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!distOk(player.pos, start, 6) || length < 0.05 || length > COMBAT_LIMITS.maxShotDistance) return null;
  const time = now();
  if (!consumeWeaponUse(player, kind, time)) return null;
  const shot = {
    kind,
    at: time,
    start,
    end,
    remainingHits: rule.pellets,
    remainingBaseDamage: rule.damage * rule.pellets,
    remainingHeadBonus: Math.max(0, Math.round(rule.damage * rule.headMult) - rule.damage) * rule.pellets,
  };
  player._shots = player._shots
    .filter((candidate) => time - candidate.at <= COMBAT_LIMITS.shotHitWindow)
    .slice(-3);
  player._shots.push(shot);
  return shot;
}

function matchingShot(player, weapon, targetPoint) {
  const time = now();
  player._shots = player._shots.filter((shot) =>
    time - shot.at <= COMBAT_LIMITS.shotHitWindow && shot.remainingHits > 0 &&
      shot.remainingBaseDamage + shot.remainingHeadBonus > 0);
  for (let index = player._shots.length - 1; index >= 0; index--) {
    const shot = player._shots[index];
    if (shot.kind !== weapon) continue;
    const distance = Math.hypot(
      targetPoint.x - shot.start.x,
      targetPoint.y - shot.start.y,
      targetPoint.z - shot.start.z,
    );
    const tolerance = shot.kind === 'shotgun' ? 2.75 + distance * 0.14 : 3.25;
    if (pointSegmentDistance(targetPoint, shot.start, shot.end) <= tolerance) return shot;
  }
  return null;
}

function consumeFirearmHit(player, weapon, targetPoint, claimedDamage, head, ignoredCollider = null) {
  const shot = matchingShot(player, weapon, targetPoint);
  if (!shot || !hasLineOfSight(playerEye(player), targetPoint, ignoredCollider)) return 0;
  const maximum = ignoredCollider
    ? firearmCrateDamageLimit(weapon)
    : firearmDamageLimit(weapon, head);
  const declared = Math.round(Number(claimedDamage));
  if (!Number.isFinite(declared) || declared <= 0 || maximum <= 0) return 0;
  const available = shot.remainingBaseDamage + (!ignoredCollider && head ? shot.remainingHeadBonus : 0);
  const damage = Math.min(declared, maximum, available);
  if (damage <= 0) return 0;
  shot.remainingHits--;
  const baseSpent = Math.min(shot.remainingBaseDamage, damage);
  shot.remainingBaseDamage -= baseSpent;
  shot.remainingHeadBonus -= Math.min(shot.remainingHeadBonus, damage - baseSpent);
  return damage;
}

function consumeKnifeHit(player, target, claimedDamage, targetKind) {
  const time = now();
  if (time - player._lastKnifeAt < COMBAT_LIMITS.knifeCooldown) return 0;
  const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z;
  if (Math.hypot(dx, dz) > COMBAT_LIMITS.knifeRange ||
      Math.abs(target.pos.y - player.pos.y) > COMBAT_LIMITS.knifeVerticalRange) return 0;
  const length = Math.hypot(dx, dz) || 1;
  const forwardX = -Math.sin(player.ry), forwardZ = -Math.cos(player.ry);
  if ((dx / length) * forwardX + (dz / length) * forwardZ < 0.15) return 0;
  if (!hasLineOfSight(playerEye(player), entityCenter(target))) return 0;
  const declared = Math.round(Number(claimedDamage));
  if (!Number.isFinite(declared) || declared <= 0) return 0;
  player._lastKnifeAt = time;
  const yaw = targetKind === 'bot' ? target.yaw : target.ry;
  return Math.min(declared, knifeDamageLimit(player.pos, target.pos, yaw, targetKind));
}

function nadeCollides(pos, activeColliders) {
  const radius = 0.14;
  for (const collider of activeColliders) {
    if (pos.x + radius > collider.minX && pos.x - radius < collider.maxX &&
        pos.y + radius > collider.minY && pos.y - radius < collider.maxY &&
        pos.z + radius > collider.minZ && pos.z - radius < collider.maxZ) return true;
  }
  return false;
}

function advanceNadeTo(nade, time, activeColliders = activeMovementColliders()) {
  if (nade.explodedAt !== null || time <= nade.simulatedAt) return;
  let remaining = Math.min(5, time - nade.simulatedAt);
  while (remaining > 1e-6 && nade.explodedAt === null) {
    const dt = Math.min(1 / 60, remaining);
    remaining -= dt;
    nade.simulatedAt += dt;
    nade.fuse -= dt;
    if (nade.fuse <= 0) {
      nade.explodedAt = nade.simulatedAt;
      nade.explosionPos = { ...nade.pos };
      break;
    }
    nade.vel.y -= COMBAT_LIMITS.nadeGravity * dt;
    let touched = false;
    for (const axis of ['x', 'y', 'z']) {
      const previous = nade.pos[axis];
      nade.pos[axis] += nade.vel[axis] * dt;
      if (!nadeCollides(nade.pos, activeColliders)) continue;
      touched = true;
      nade.pos[axis] = previous;
      nade.vel[axis] *= -0.45;
      for (const other of ['x', 'y', 'z']) {
        if (other !== axis) nade.vel[other] *= 0.75;
      }
    }
    if (touched && nade.impact) {
      nade.explodedAt = nade.simulatedAt;
      nade.explosionPos = { ...nade.pos };
    }
  }
}

function acceptNade(player, message) {
  if (!isFiniteVectorPayload(message.p, 1000) || !isFiniteVectorPayload(message.v, 80)) return null;
  const origin = vectorFromPayload(message.p);
  const velocity = vectorFromPayload(message.v);
  if (!distOk(player.pos, origin, 6)) return null;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const impact = !!message.im;
  const time = now();
  if (impact) {
    if (speed < 20 || speed > 35 || !consumeWeaponUse(player, 'launcher', time)) return null;
  } else {
    if (speed < 10 || speed > 22 || player._regularNadesUsed >= 2 ||
        time - player._lastRegularNadeAt < 0.25) return null;
    player._regularNadesUsed++;
    player._lastRegularNadeAt = time;
  }
  const nade = {
    at: time,
    origin,
    pos: { ...origin },
    vel: { ...velocity },
    fuse: impact ? 4 : COMBAT_LIMITS.nadeFuse,
    simulatedAt: time,
    explodedAt: null,
    explosionPos: null,
    impact,
    damageApplied: false,
  };
  player._nades = player._nades.filter((candidate) => time - candidate.at <= 4.5).slice(-3);
  player._nades.push(nade);
  return nade;
}

function authoritativeNadeDamage(blastOrigin, target) {
  const targetPoint = entityCenter(target);
  const distance = Math.hypot(
    blastOrigin.x - targetPoint.x,
    blastOrigin.y - targetPoint.y,
    blastOrigin.z - targetPoint.z,
  );
  if (distance > COMBAT_LIMITS.nadeRadius || !hasLineOfSight(blastOrigin, targetPoint)) return 0;
  return Math.max(15, Math.round(COMBAT_LIMITS.nadeDamage *
    (1 - distance / COMBAT_LIMITS.nadeRadius)));
}

function resolveNadeExplosion(owner, nade) {
  if (nade.damageApplied || nade.explodedAt === null) return;
  nade.damageApplied = true;
  if (match.state !== 'playing' || !nade.explosionPos) return;
  const blastOrigin = {
    x: nade.explosionPos.x,
    y: nade.explosionPos.y + 0.2,
    z: nade.explosionPos.z,
  };

  for (const victim of players.values()) {
    if (match.state !== 'playing') break;
    if (!victim.alive) continue;
    if (victim !== owner && match.mode === 'teams' && victim.team === owner.team) continue;
    let damage = authoritativeNadeDamage(blastOrigin, victim);
    if (victim === owner) damage = Math.round(damage / 2);
    if (damage <= 0) continue;
    const previousHealth = victim.hp;
    damagePlayer(
      victim,
      damage,
      victim === owner ? 'tu propia granada' : owner.name,
      false,
      victim === owner ? null : owner,
      'nade',
    );
    if (victim !== owner && victim.hp < previousHealth) {
      send(owner, { t: 'hitok', w: 'nade', kind: 'pl', id: victim.id, d: damage });
    }
  }

  for (const bot of bots) {
    if (match.state !== 'playing') break;
    if (bot.dead || (match.mode === 'teams' && bot.team === owner.team)) continue;
    const damage = authoritativeNadeDamage(blastOrigin, bot);
    if (damage <= 0) continue;
    const died = bot.takeDamage(damage, owner.pos);
    send(owner, { t: 'hitok', w: 'nade', kind: 'bot', id: bot.id, d: damage });
    if (died) {
      spawnKit(bot.pos);
      broadcast({ t: 'kill', vn: bot.name, vid: null, kn: owner.name, h: false, w: 'nade' });
      creditKill(owner, 'nade');
    }
  }
}

function resetMovementBudget(player) {
  player._movementBudgetAt = now();
  player._horizontalBudget = MOVEMENT_INITIAL_HORIZONTAL;
  player._verticalBudget = MOVEMENT_INITIAL_VERTICAL;
}

function refillMovementBudget(player, time) {
  const previousTime = Number.isFinite(player._movementBudgetAt) ? player._movementBudgetAt : time;
  const elapsed = Math.max(0, Math.min(1, time - previousTime));
  player._movementBudgetAt = time;
  player._horizontalBudget = Math.min(
    MOVEMENT_HORIZONTAL_CAP,
    Math.max(0, Number(player._horizontalBudget) || 0) + elapsed * MOVEMENT_HORIZONTAL_RATE,
  );
  player._verticalBudget = Math.min(
    MOVEMENT_VERTICAL_CAP,
    Math.max(0, Number(player._verticalBudget) || 0) + elapsed * MOVEMENT_VERTICAL_RATE,
  );
}

function activeMovementColliders() {
  return colliders.filter((collider) => !collider.crate || crates.get(collider.crate)?.alive !== false);
}

function bodySupportedAt(pos, activeColliders) {
  for (const collider of activeColliders) {
    const drop = pos.y - collider.maxY;
    if (drop < -0.06 || drop > 0.28) continue;
    if (pos.x + PLAYER_BODY.halfX > collider.minX && pos.x - PLAYER_BODY.halfX < collider.maxX &&
        pos.z + PLAYER_BODY.halfZ > collider.minZ && pos.z - PLAYER_BODY.halfZ < collider.maxZ) return true;
  }
  return false;
}

function jumpPadPowerNear(start, end) {
  let power = 0;
  for (const pad of mapData?.jumpPads || []) {
    if (jumpPadIntersectsSegment(start, end, pad)) {
      power = Math.max(power, Number(pad.power) || 0);
    }
  }
  return power;
}

function verticalMoveState(player, pos, activeColliders, time) {
  if (bodySupportedAt(pos, activeColliders)) return { allowed: true, flight: null };
  const currentSupported = bodySupportedAt(player.pos, activeColliders);
  let flight = player._verticalFlight;
  if (!flight || currentSupported) {
    const padPower = jumpPadPowerNear(player.pos, pos);
    const rising = pos.y > player.pos.y + 0.04;
    flight = {
      originY: player.pos.y,
      startedAt: Math.min(time, Number(player._lastAcceptedStateAt) || time),
      velocity: padPower > 0 ? padPower + 0.75 : rising ? 9.6 : 2.5,
    };
  }
  const age = Math.max(0, time - flight.startedAt);
  const ballisticCeiling = flight.originY + flight.velocity * age - 0.5 * GRAVITY * age * age + 0.7;
  if (pos.y > ballisticCeiling) return { allowed: false, flight };
  return { allowed: true, flight };
}

function playerPositionAllowed(player, pos) {
  if (!playBounds || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return false;
  if (pos.x < playBounds.minX || pos.x > playBounds.maxX ||
      pos.z < playBounds.minZ || pos.z > playBounds.maxZ || pos.y < -2 || pos.y > 60) return false;
  const time = now();
  refillMovementBudget(player, time);
  const horizontalCost = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
  const verticalCost = Math.abs(pos.y - player.pos.y);
  if (horizontalCost > player._horizontalBudget + 0.01 ||
      verticalCost > player._verticalBudget + 0.01) return false;

  const activeColliders = activeMovementColliders();
  const vertical = verticalMoveState(player, pos, activeColliders, time);
  if (!vertical.allowed ||
      activeColliders.some((collider) => bodyPenetratesCollider(
        pos, collider, PLAYER_BODY, MOVEMENT_CONTACT_TOLERANCE,
      )) ||
      !isBodyPathClear(player.pos, pos, activeColliders, {
        body: PLAYER_BODY,
        contactTolerance: MOVEMENT_CONTACT_TOLERANCE,
      })) return false;

  player._horizontalBudget = Math.max(0, player._horizontalBudget - horizontalCost);
  player._verticalBudget = Math.max(0, player._verticalBudget - verticalCost);
  player._verticalFlight = vertical.flight;
  player._lastAcceptedStateAt = time;
  return true;
}

function settleStaleVerticalPosition(player, time) {
  const flight = player._verticalFlight;
  if (!flight || time - player._lastAcceptedStateAt <= 0.25) return;
  const age = Math.max(0, time - flight.startedAt);
  const ceiling = flight.originY + flight.velocity * age - 0.5 * GRAVITY * age * age + 0.7;
  if (player.pos.y <= ceiling) return;
  const activeColliders = activeMovementColliders();
  let support = null;
  for (const collider of activeColliders) {
    if (collider.maxY > player.pos.y + 0.06 || collider.maxY < ceiling - 0.06) continue;
    if (player.pos.x + PLAYER_BODY.halfX <= collider.minX || player.pos.x - PLAYER_BODY.halfX >= collider.maxX ||
        player.pos.z + PLAYER_BODY.halfZ <= collider.minZ || player.pos.z - PLAYER_BODY.halfZ >= collider.maxZ) continue;
    if (!support || collider.maxY > support.maxY) support = collider;
  }
  if (support) {
    player.pos.y = support.maxY + 0.001;
    player._verticalFlight = null;
    player._lastAcceptedStateAt = time;
  } else {
    player.pos.y = Math.max(-2, ceiling);
  }
}

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  const isSnapshot = msg?.t === 'snap';
  for (const p of players.values()) {
    if (p.id === exceptId || p.ws.readyState !== 1) continue;
    // Un cliente lento no debe acumular segundos de snapshots obsoletos.
    if (isSnapshot && Number(p.ws.bufferedAmount) > 256 * 1024) continue;
    p.ws.send(raw);
  }
}

// bots = cantidad configurada que cabe hasta TOTAL_SLOTS, con tope de MAX_BOTS.
// En zombis no aplica (las oleadas gestionan los bots).
function rebalanceBots() {
  if (match.mode === 'zombies') return;
  const target = effectiveBotCount(botConfig, players.size, match.mode);
  while (bots.length > target) {
    const b = bots.pop();
    broadcast({ t: 'botbye', id: b.id });
  }
  while (bots.length < target) {
    const idx = botSerial++;
    const b = new ServerBot(
      'b' + idx,
      BOT_NAMES[idx % BOT_NAMES.length] + (idx >= BOT_NAMES.length ? '_' + idx : ''),
      BOT_COLORS[idx % BOT_COLORS.length],
      { spawnPicker: pickBotSpawn },
    );
    bots.push(b);
  }
  // en equipos: repartir bots equilibrando el tamaño total de cada bando
  if (match.mode === 'teams') {
    let r = 0, b2 = 0;
    for (const p of players.values()) (p.team === 'b' ? b2++ : r++);
    for (const bt of bots) {
      if (r <= b2) { bt.team = 'r'; r++; } else { bt.team = 'b'; b2++; }
    }
  } else {
    for (const bt of bots) bt.team = null;
  }
}

function creditKill(killer, weaponKind) {
  killer.kills++;
  killer.curStreak = (killer.curStreak || 0) + 1;
  ranking.addKill(killer.name, killer.curStreak);
  scoreTeamKill(killer.team);
  if (match.state !== 'playing') return;
  if (match.mode === 'ffa' && killer.kills >= KILL_LIMIT) {
    endMatch('🎯 Límite de bajas alcanzado');
  } else if (match.mode === 'gun' && weaponKind === GUN_LADDER[killer.gunIdx]) {
    killer.gunIdx++;
    if (killer.gunIdx >= GUN_LADDER.length) {
      endMatch(`🏆 ${killer.name} completó todas las armas`);
    } else {
      send(killer, { t: 'gun', gi: killer.gunIdx });
    }
  }
}

function killPlayer(victim, killerName, isHead, weaponKind = '') {
  victim.alive = false;
  const respawnToken = (victim.respawnToken || 0) + 1;
  victim.respawnToken = respawnToken;
  victim.hp = 0;
  victim.deaths++;
  victim.curStreak = 0;
  ranking.addDeath(victim.name);
  spawnKit(victim.pos);
  broadcast({
    t: 'kill', vn: victim.name, vid: victim.id, kn: killerName,
    h: !!isHead, w: String(weaponKind || '').slice(0, 10),
  });
  setTimeout(() => {
    if (!players.has(victim.id) || victim.respawnToken !== respawnToken ||
        victim.alive || match.state !== 'playing') return;
    spawnPlayer(victim);
  }, 2600);
}

function damagePlayer(victim, dmg, sourceName, isHead, killerPlayer = null, weaponKind = null) {
  if (!victim.alive || match.state !== 'playing') return;
  victim.hp -= dmg;
  victim.lastDmg = now();
  send(victim, { t: 'ouch', d: dmg, hp: Math.max(0, victim.hp), by: sourceName });
  if (victim.hp <= 0) {
    killPlayer(victim, sourceName, isHead, weaponKind);
    // La baja debe llegar antes que el podio de una muerte que cierra ronda.
    if (killerPlayer) creditKill(killerPlayer, weaponKind);
    return true;
  }
  return false;
}

function attach(ws, hello) {
  const id = nextId++;
  let me = null;
  const helloTimeout = setTimeout(() => {
    if (!me && ws.readyState === 1) ws.close(1008, 'Saludo requerido');
  }, 5000);

  const handleMessage = (raw) => {
    // Una vez completado el saludo, todo frame consume presupuesto incluso si
    // su JSON o su forma son inválidos. De otro modo un flood de "{", null o
    // arrays eludiría el límite antes de llegar a la validación del protocolo.
    if (me && !messageAllowed(me)) return;
    let m;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !Buffer.isBuffer(raw)) {
      m = raw;
    } else {
      try { m = JSON.parse(raw); } catch { return; }
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;

    if (m.t === 'hola' && !me) {
      if (m.mode !== roomMode || m.room !== roomNumber) {
        clearTimeout(helloTimeout);
        if (ws.readyState === 1) ws.send(JSON.stringify({
          t: 'joinerr', code: 'ROOM_MISMATCH', mode: roomMode, room: roomNumber,
        }));
        ws.close(1008, 'Selección de sala inválida');
        return;
      }
      if (players.size >= LOBBY_ROOM_CAPACITY) {
        clearTimeout(helloTimeout);
        if (ws.readyState === 1) ws.send(JSON.stringify({
          t: 'full', code: 'ROOM_FULL', mode: roomMode, room: roomNumber,
          slots: LOBBY_ROOM_CAPACITY, players: players.size,
        }));
        ws.close(1013, 'Sala llena');
        return;
      }
      clearTimeout(helloTimeout);
      const sp = pickSpawn();
      me = {
        id, ws,
        name: sanitizeName(m.name),
        color: BOT_COLORS[(id * 3) % BOT_COLORS.length],
        pos: { ...sp }, ry: 0, rx: 0, speed: 0, sliding: false,
        hp: 100, kills: 0, deaths: 0, alive: true, lastDmg: 0,
        spawnSeq: 1, respawnToken: 0, lastSpawn: { ...sp },
        _movementBudgetAt: now(),
        _horizontalBudget: MOVEMENT_INITIAL_HORIZONTAL,
        _verticalBudget: MOVEMENT_INITIAL_VERTICAL,
        team: match.mode === 'teams' ? assignTeam() : null,
        curStreak: 0, gunIdx: 0,
        hat: (m.skin && HATS[m.skin.h]) ? m.skin.h : 'none',
        skinColor: (m.skin && Number.isInteger(m.skin.c)) ? (m.skin.c & 0xffffff) : null,
        badge: '',
      };
      resetCombatState(me);
      resetMessageBudget(me);
      players.set(id, me);
      // insignia de nivel según su historial en el ranking mundial
      ranking.getTotalKills(me.name).then((total) => {
        if (players.has(id)) players.get(id).badge = badgeFor(total);
      });
      rebalanceBots();
      send(me, {
        t: 'hi', id, name: me.name, spawn: [sp.x, sp.y, sp.z], slots: LOBBY_ROOM_CAPACITY,
        mode: roomMode, room: roomNumber,
        sid: me.spawnSeq, rid: match.roundId, map: match.map,
        bc: botConfigData(),
      });
      send(me, matchMsg());
      const podium = currentPodiumMsg();
      if (podium) send(me, podium);
      broadcast(botConfigMsg());
      if (match.mode === 'gun') send(me, { t: 'gun', gi: 0 });
      broadcast({ t: 'aviso', txt: `${me.name} entró a la partida` }, id);
      console.log(`[${roomMode}:${roomNumber}] + ${me.name} (${players.size} jugadores, ${bots.length} bots)`);
      return;
    }
    if (!me) return;

    if (m.t === 'st') {
      // estado del jugador: posición, orientación, velocidad
      if (!me.alive || match.state !== 'playing' ||
          !Number.isSafeInteger(m.sid) || m.sid !== me.spawnSeq ||
          !eventAllowed(me, 'state', 45)) return;
      if (isFiniteVectorPayload(m.p, 1000)) {
        const nextPos = { x: m.p[0], y: m.p[1], z: m.p[2] };
        if (playerPositionAllowed(me, nextPos)) {
          me.pos = nextPos;
        } else {
          send(me, {
            t: 'corr', sid: me.spawnSeq,
            p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)],
          });
        }
      }
      if (Number.isFinite(m.ry)) me.ry = Math.atan2(Math.sin(m.ry), Math.cos(m.ry));
      if (Number.isFinite(m.rx)) me.rx = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.rx));
      if (Number.isFinite(m.s)) me.speed = Math.max(0, Math.min(20, m.s));
      me.sliding = !!m.sl;
    } else if (m.t === 'fire') {
      if (!me.alive || match.state !== 'playing') return;
      const shot = acceptFire(me, m);
      if (shot) broadcast({ t: 'fire', id, a: m.a, b: m.b, k: shot.kind }, id);
    } else if (m.t === 'nade') {
      if (me.alive && match.state === 'playing' && acceptNade(me, m)) {
        broadcast({ t: 'nade', id, p: m.p, v: m.v, im: m.im ? 1 : 0 }, id);
      }
    } else if (m.t === 'hit') {
      if (!me.alive || match.state !== 'playing' || !eventAllowed(me, 'hit', 32)) return;
      const weapon = String(m.w || '').slice(0, 10);
      if (m.kind === 'bot') {
        const bot = bots.find((b) => b.id === m.id);
        if (bot && !bot.dead && distOk(me.pos, bot.pos) &&
            !(match.mode === 'teams' && bot.team === me.team)) {
          const dmg = weapon === 'knife'
            ? consumeKnifeHit(me, bot, m.d, 'bot')
            : weapon === 'nade'
              ? 0 // daño de explosión resuelto por la simulación autoritativa
              : consumeFirearmHit(me, weapon, entityCenter(bot, !!m.h), m.d, !!m.h);
          if (dmg <= 0) return;
          const died = bot.takeDamage(dmg, me.pos);
          if (died) {
            spawnKit(bot.pos);
            broadcast({
              t: 'kill', vn: bot.name, vid: null, kn: me.name,
              h: !!m.h, w: weapon,
            });
            creditKill(me, weapon);
          }
        }
      } else if (m.kind === 'pl') {
        const victim = players.get(+m.id);
        if (victim && victim.id !== me.id && distOk(me.pos, victim.pos)) {
          if (match.mode === 'teams' && victim.team === me.team) return; // fuego amigo desactivado
          const dmg = weapon === 'knife'
            ? consumeKnifeHit(me, victim, m.d, 'pl')
            : weapon === 'nade'
              ? 0
              : consumeFirearmHit(me, weapon, entityCenter(victim, !!m.h), m.d, !!m.h);
          if (dmg <= 0) return;
          damagePlayer(victim, dmg, me.name, !!m.h, me, weapon);
        }
      } else if (m.kind === 'crate') {
        const c = crates.get(String(m.id));
        if (c && c.alive) {
          const target = {
            x: (c.collider.minX + c.collider.maxX) / 2,
            y: (c.collider.minY + c.collider.maxY) / 2,
            z: (c.collider.minZ + c.collider.maxZ) / 2,
          };
          if (!distOk(me.pos, target)) return;
          const dmg = consumeFirearmHit(me, weapon, target, m.d, false, c.collider);
          if (dmg <= 0) return;
          c.hp -= dmg;
          if (c.hp <= 0) {
            c.alive = false;
            c.respawnAt = now() + 45;
            const idx = colliders.indexOf(c.collider);
            if (idx >= 0) colliders.splice(idx, 1);
            broadcast({ t: 'cbox', id: String(m.id), al: 0 });
          }
        }
      }
    } else if (m.t === 'chat') {
      // chat rápido: mensajes predefinidos, máx 1 por segundo
      const i = Math.floor(+m.i);
      const t = now();
      if (i >= 0 && i < QUICK_CHAT.length && (!me._lastChat || t - me._lastChat > 1)) {
        me._lastChat = t;
        broadcast({ t: 'chat', n: me.name, i });
      }
    } else if (m.t === 'ping') {
      if (eventAllowed(me, 'ping', 2)) send(me, { t: 'pong', ts: +m.ts || 0 });
    } else if (m.t === 'skin') {
      if (!eventAllowed(me, 'skin', 2)) return;
      const nextHat = typeof m.h === 'string' && Object.hasOwn(HATS, m.h) ? m.h : 'none';
      const nextColor = Number.isInteger(m.c) ? (m.c & 0xffffff) : me.skinColor;
      if (nextHat === me.hat && nextColor === me.skinColor) return;
      me.hat = nextHat;
      me.skinColor = nextColor;
    } else if (m.t === 'selfdmg') {
      // daño por caída, lo declara el propio cliente
      if (!eventAllowed(me, 'selfdmg', 4)) return;
      const dmg = Math.max(1, Math.min(60, Math.round(+m.d || 0)));
      damagePlayer(me, dmg, 'la caída', false);
    } else if (m.t === 'team') {
      if (match.mode === 'teams') {
        const nextTeam = m.tm === 'r' || m.tm === 'b' ? m.tm : assignTeam();
        const t = now();
        if (nextTeam === me.team || (me._lastTeamChange && t - me._lastTeamChange < 2)) return;
        me._lastTeamChange = t;
        me.team = nextTeam;
        rebalanceBots();
        broadcast({ t: 'aviso', txt: `${me.name} → equipo ${me.team === 'r' ? 'ROJO' : 'AZUL'}` });
      }
    } else if (m.t === 'botcfg') {
      const t = now();
      const requestId = Number.isSafeInteger(m.rid) && m.rid >= 0 ? m.rid : null;
      if (match.mode === 'zombies') {
        send(me, botConfigMsg('zombies', requestId));
        return;
      }
      if (me._lastBotConfig && t - me._lastBotConfig < 0.15) {
        send(me, botConfigMsg('rate', requestId));
        return;
      }
      me._lastBotConfig = t;
      const nextConfig = sanitizeBotConfigUpdate(m);
      if (!nextConfig) {
        send(me, botConfigMsg('invalid', requestId));
        return;
      }
      const changed = nextConfig.enabled !== botConfig.enabled || nextConfig.count !== botConfig.count;
      if (!changed) {
        send(me, botConfigMsg(null, requestId));
        return;
      }
      botConfig = nextConfig;
      rebalanceBots();
      broadcast(botConfigMsg());
      send(me, botConfigMsg(null, requestId));
      const description = botConfig.enabled ? `${botConfig.count} bots` : 'bots desactivados';
      broadcast({ t: 'aviso', txt: `${me.name}: ${description}` });
    } else if (m.t === 'vote') {
      if (match.state === 'podium' && eventAllowed(me, 'vote', 4)) {
        if (typeof m.map !== 'string' || !Object.hasOwn(MAPS, m.map) ||
            match.mapVotes.get(me.id) === m.map) return;
        match.mapVotes.set(me.id, m.map);
        const mapTally = {};
        for (const v of match.mapVotes.values()) mapTally[v] = (mapTally[v] || 0) + 1;
        broadcast({ t: 'votes', stage: 'map', tally: {}, mapTally });
      }
    }
  };
  ws.on('message', handleMessage);
  handleMessage(hello);

  ws.on('close', () => {
    clearTimeout(helloTimeout);
    if (me) {
      players.delete(me.id);
      broadcast({ t: 'aviso', txt: `${me.name} salió de la partida` });
      console.log(`[${roomMode}:${roomNumber}] - ${me.name} (${players.size} jugadores)`);
      rebalanceBots();
      broadcast(botConfigMsg());
    }
  });
  ws.on('error', () => {});
  return me !== null;
}

// --- bucle de simulación ---
const botCtx = {
  colliders,
  get waypoints() { return mapData?.navigationPoints || mapData?.waypoints || []; },
  get players() { return [...players.values()]; },
  get bots() { return bots; },
  onShoot(bot, from, to) {
    broadcast({ t: 'fire', bid: bot.id, a: [from.x, from.y, from.z], b: [to.x, to.y, to.z], k: 'smg' });
  },
  onHitTarget(bot, kind, target, dmg) {
    if (kind === 'pl') {
      const died = damagePlayer(target, dmg, bot.name, false);
      if (died) scoreTeamKill(bot.team);
    } else {
      const died = target.takeDamage(dmg, bot.pos);
      if (died) {
        spawnKit(target.pos);
        broadcast({ t: 'kill', vn: target.name, vid: null, kn: bot.name, h: false });
        scoreTeamKill(bot.team);
      }
    }
  },
};

function pauseRoomTimers(dt) {
  if (match.state === 'playing') match.endAt += dt;
  else {
    match.podiumEndAt += dt;
    match.podiumStageEndAt += dt;
  }
  if (match.waveBreakAt > 0) match.waveBreakAt += dt;
  for (const crate of crates.values()) {
    if (!crate.alive && crate.respawnAt > 0) crate.respawnAt += dt;
  }
  for (const kit of kits) kit.expireAt += dt;
  for (const bot of bots) {
    if (bot.dead && bot.respawnAt > 0) bot.respawnAt += dt;
  }
}

function tick(t, dt, elapsed = dt) {
  // Una sala vacía queda totalmente congelada: ni el reloj de ronda/podio ni
  // cajas, kits, oleadas o respawns consumen tiempo hasta que vuelva alguien.
  if (players.size === 0) {
    pauseRoomTimers(elapsed);
    return;
  }

  modeTick(t);
  const nadeColliders = activeMovementColliders();
  for (const player of players.values()) {
    player._nades = (player._nades || []).filter((nade) => t - nade.at <= (nade.impact ? 5 : 3.3));
    for (const nade of player._nades) {
      advanceNadeTo(nade, t, nadeColliders);
      resolveNadeExplosion(player, nade);
    }
  }
  if (match.state === 'playing') {
    for (const b of bots) {
      b.update(dt, botCtx);
      // saltadores: también lanzan a los bots
      if (!b.dead && b.onGround) {
        for (const pad of mapData.jumpPads) {
          if (jumpPadContainsPoint(b.pos, pad)) {
            applyJumpPadImpulse(b.vel, pad);
            b.onGround = false;
            break;
          }
        }
      }
    }
  }

  for (const p of players.values()) {
    if (p.alive) settleStaleVerticalPosition(p, t);
  }

  // regeneración de vida de jugadores
  for (const p of players.values()) {
    if (p.alive && p.hp < 100 && t - p.lastDmg > 4) {
      p.hp = Math.min(100, p.hp + 14 * dt);
    }
  }

  // kits de vida: caducidad y recogida (+25, solo si falta vida)
  for (let i = kits.length - 1; i >= 0; i--) {
    const k = kits[i];
    if (t > k.expireAt) { kits.splice(i, 1); continue; }
    let taken = false;
    if (k.k === 'ammo') {
      for (const p of players.values()) {
        if (!p.alive) continue;
        const dx = p.pos.x - k.x, dz = p.pos.z - k.z;
        if (dx * dx + dz * dz < 1.44 && Math.abs(p.pos.y - k.y) < 1.6) {
          send(p, { t: 'ammo', a: k.a || 20 });
          taken = true;
          break;
        }
      }
      if (taken) kits.splice(i, 1);
      continue;
    }
    for (const p of players.values()) {
      if (!p.alive || p.hp >= 100) continue;
      const dx = p.pos.x - k.x, dz = p.pos.z - k.z;
      if (dx * dx + dz * dz < 1.44 && Math.abs(p.pos.y - k.y) < 1.6) {
        p.hp = Math.min(100, p.hp + 25);
        send(p, { t: 'med', hp: Math.round(p.hp) });
        taken = true;
        break;
      }
    }
    if (!taken) {
      for (const b of bots) {
        if (b.dead || b.hp >= 100) continue;
        const dx = b.pos.x - k.x, dz = b.pos.z - k.z;
        if (dx * dx + dz * dz < 1.44 && Math.abs(b.pos.y - k.y) < 1.6) {
          b.hp = Math.min(100, b.hp + 25);
          taken = true;
          break;
        }
      }
    }
    if (taken) kits.splice(i, 1);
  }

  const snap = {
    t: 'snap',
    m: matchMsg(),
    dc: destroyedCrates(),
    pl: [...players.values()].map((p) => ({
      id: p.id, n: p.name,
      c: p.team ? TEAM_COLORS[p.team] : (p.skinColor ?? p.color),
      tm: p.team || undefined, gi: p.gunIdx || 0,
      h: p.hat !== 'none' ? p.hat : undefined,
      b: p.badge || undefined,
      p: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      ry: +p.ry.toFixed(2), rx: +p.rx.toFixed(2), s: +p.speed.toFixed(1),
      hp: Math.round(p.hp), k: p.kills, d: p.deaths, al: p.alive ? 1 : 0,
    })),
    bots: bots.map((b) => ({
      id: b.id, n: b.name,
      c: b.team ? TEAM_COLORS[b.team] : b.color,
      tm: b.team || undefined, z: b.zombie ? 1 : 0,
      p: [+b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2)],
      ry: +b.yaw.toFixed(2), s: +b.speed.toFixed(1),
      hp: Math.round(b.hp), al: b.dead ? 0 : 1, en: b.engaging || b.zombie ? 1 : 0,
    })),
    kits: kits.map((k) => ({ id: k.id, k: k.k, a: k.a, p: [+k.x.toFixed(2), +k.y.toFixed(2), +k.z.toFixed(2)] })),
  };
  broadcast(snap);
}

function summary() {
  const humanCount = players.size;
  const available = Math.max(0, LOBBY_ROOM_CAPACITY - humanCount);
  const deadline = match.state === 'playing' ? match.endAt : match.podiumStageEndAt;
  return {
    key: lobbyRoomKey(roomMode, roomNumber),
    mode: roomMode,
    room: roomNumber,
    players: humanCount,
    capacity: LOBBY_ROOM_CAPACITY,
    available,
    full: available === 0,
    joinable: available > 0,
    bots: bots.length,
    map: match.map,
    state: match.state,
    timeLeft: Math.max(0, Math.round(deadline - now())),
  };
}

return {
  mode: roomMode,
  room: roomNumber,
  key: lobbyRoomKey(roomMode, roomNumber),
  attach,
  tick,
  summary,
};
}

roomRegistry = new Map();
for (const mode of LOBBY_MODE_IDS) {
  for (const roomNumber of LOBBY_ROOM_IDS) {
    const engine = createRoomEngine(mode, roomNumber);
    roomRegistry.set(engine.key, engine);
  }
}

function rejectJoin(ws, code, details = {}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'joinerr', code, ...details }));
  ws.close(1008, code);
}

wss.on('connection', (ws) => {
  let routed = false;
  const helloTimeout = setTimeout(() => {
    if (!routed && ws.readyState === 1) rejectJoin(ws, 'HELLO_REQUIRED');
  }, 5000);

  const routeHello = (raw) => {
    if (routed) return;
    let message;
    try { message = JSON.parse(raw); } catch {
      clearTimeout(helloTimeout);
      rejectJoin(ws, 'INVALID_HELLO');
      return;
    }
    const validMode = typeof message?.mode === 'string' && LOBBY_MODE_IDS.includes(message.mode);
    const validRoom = Number.isSafeInteger(message?.room) && LOBBY_ROOM_IDS.includes(message.room);
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        message.t !== 'hola' || !validMode || !validRoom) {
      clearTimeout(helloTimeout);
      rejectJoin(ws, 'INVALID_SELECTION');
      return;
    }
    if (message.pv !== PROTOCOL_VERSION) {
      clearTimeout(helloTimeout);
      rejectJoin(ws, 'PROTOCOL_MISMATCH', { expected: PROTOCOL_VERSION });
      return;
    }
    const room = roomRegistry.get(lobbyRoomKey(message.mode, message.room));
    if (!room) {
      clearTimeout(helloTimeout);
      rejectJoin(ws, 'ROOM_NOT_FOUND', { mode: message.mode, room: message.room });
      return;
    }
    routed = true;
    clearTimeout(helloTimeout);
    ws.off('message', routeHello);
    room.attach(ws, message);
  };

  ws.on('message', routeHello);
  ws.on('close', () => clearTimeout(helloTimeout));
  ws.on('error', () => clearTimeout(helloTimeout));
});

let last = Date.now() / 1000;
setInterval(() => {
  const time = Date.now() / 1000;
  const elapsed = Math.max(0, time - last);
  const dt = Math.min(0.1, elapsed);
  last = time;
  for (const room of roomRegistry.values()) room.tick(time, dt, elapsed);
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`PIUM PIUM PIUM multijugador en http://localhost:${PORT}`);
});
