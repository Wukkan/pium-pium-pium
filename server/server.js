import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  buildMap, buildColliders, TOTAL_SLOTS, MAX_BOTS, BOT_NAMES, BOT_COLORS,
  MAPS, HATS, QUICK_CHAT, badgeFor,
} from '../src/shared/mapdata.js';
import { ServerBot, setBotMap } from './botai.js';
import * as ranking from './ranking.js';

// ---------------------------------------------------------------------------
// PIUM PIUM PIUM — servidor: sirve el cliente por HTTP y lleva la partida por
// WebSocket. Los bots corren aquí y rellenan hasta TOTAL_SLOTS (10):
// 1 humano → 9 bots, 7 humanos → 3 bots, 10+ humanos → 0 bots.
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 5173;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICK = 1 / 15;

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
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
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
  let rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || rel.startsWith('server') || rel.startsWith('.')) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('no encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

// --- estado de la partida ---
const colliders = [];
const crates = new Map(); // id -> {hp, collider, alive, respawnAt}
let mapData = null;
const players = new Map(); // id -> jugador
const bots = [];
const kits = []; // loot del suelo: {id, x, y, z, k, a, expireAt}
let nextId = 1;
let botSerial = 0;
let kitSerial = 0;

function loadMap(mapId) {
  mapData = buildMap(mapId);
  setBotMap(mapData);
  colliders.length = 0;
  colliders.push(...buildColliders(mapData.boxes));
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
const MODES = ['ffa', 'teams', 'gun', 'zombies'];
const MODE_NAMES = { ffa: 'TODOS CONTRA TODOS', teams: 'EQUIPOS', gun: 'BÚSQUEDA DEL ARMA', zombies: 'ZOMBIS' };
const GUN_LADDER = ['pistol', 'shotgun', 'smg', 'ar', 'sniper'];
const TEAM_COLORS = { r: 0xd84a3a, b: 0x3a6ad8 };
const MATCH_TIME = 300;   // 5 minutos
const KILL_LIMIT = 30;    // ffa y equipos
const ZOMBIE_WAVES = 8;
const PODIUM_STAGE_TIME = 15;
const PODIUM_TIME = PODIUM_STAGE_TIME * 2;

const match = {
  mode: 'ffa',
  map: 'arena',
  state: 'playing', // playing | podium
  endAt: Date.now() / 1000 + MATCH_TIME,
  podiumEndAt: 0,
  podiumStageEndAt: 0,
  podiumStage: 'mode',
  votes: new Map(),           // playerId -> modo votado
  mapVotes: new Map(),        // playerId -> mapa votado
  teamScores: { r: 0, b: 0 },
  wave: 0,
  waveBreakAt: 0,
};

function matchMsg() {
  return {
    t: 'match', mode: match.mode, map: match.map, st: match.state,
    tl: Math.max(0, Math.round((match.state === 'playing' ? match.endAt : match.podiumStageEndAt) - now())),
    ps: match.podiumStage,
    ts: match.teamScores,
    wv: match.wave,
    zl: bots.filter((b) => b.zombie && !b.dead).length,
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

function startMatch(mode, mapId = match.map) {
  match.mode = mode;
  match.state = 'playing';
  match.podiumStage = 'mode';
  match.podiumStageEndAt = 0;
  match.endAt = now() + MATCH_TIME;
  match.votes = new Map();
  match.mapVotes = new Map();
  match.teamScores = { r: 0, b: 0 };
  match.wave = 0;
  match.waveBreakAt = mode === 'zombies' ? now() + 5 : 0;
  bots.length = 0;
  kits.length = 0;
  if (mapId !== match.map) {
    match.map = mapId;
    loadMap(mapId);
  } else {
    // restaurar las cajas destruidas
    for (const c of crates.values()) {
      if (!c.alive) { c.alive = true; c.hp = 80; colliders.push(c.collider); }
    }
  }
  for (const p of players.values()) {
    p.kills = 0; p.deaths = 0; p.curStreak = 0; p.gunIdx = 0;
    p.team = mode === 'teams' ? assignTeam() : null;
    const sp = pickSpawn();
    p.alive = true; p.hp = 100; p.pos = { ...sp };
    send(p, { t: 'spawn', p: [sp.x, sp.y, sp.z] });
  }
  rebalanceBots();
  broadcast(matchMsg());
  broadcast({ t: 'aviso', txt: `▶ Nuevo modo: ${MODE_NAMES[mode]}` });
  console.log(`modo: ${mode}`);
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
  match.podiumEndAt = now() + PODIUM_TIME;
  match.podiumStage = 'mode';
  match.podiumStageEndAt = now() + PODIUM_STAGE_TIME;
  const rows = podiumRows();
  let winner = rows.length ? rows[0].n : '—';
  if (match.mode === 'teams') {
    winner = match.teamScores.r === match.teamScores.b
      ? 'EMPATE'
      : (match.teamScores.r > match.teamScores.b ? '🔴 EQUIPO ROJO' : '🔵 EQUIPO AZUL');
  }
  broadcast({
    t: 'podium', winner, txt: reasonTxt || '', rows,
    ts: match.teamScores, mode: match.mode, secs: PODIUM_STAGE_TIME, stage: match.podiumStage, modes: MODES,
    maps: Object.keys(MAPS), map: match.map,
  });
}

function nextMode() {
  const tally = {};
  for (const m of match.votes.values()) tally[m] = (tally[m] || 0) + 1;
  let best = null, bestN = 0;
  for (const m of MODES) {
    if ((tally[m] || 0) > bestN) { best = m; bestN = tally[m]; }
  }
  return best || MODES[(MODES.indexOf(match.mode) + 1) % MODES.length];
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
    });
    bots.push(b);
  }
  broadcast({ t: 'aviso', txt: `🧟 Oleada ${n}: ${count} zombis` });
  broadcast(matchMsg());
}

function modeTick(t) {
  if (match.state === 'podium') {
    if (t >= match.podiumStageEndAt && match.podiumStage === 'mode') {
      match.podiumStage = 'map';
      match.podiumStageEndAt = t + PODIUM_STAGE_TIME;
      broadcast({ t: 'podiumStage', stage: 'map', secs: PODIUM_STAGE_TIME, map: match.map });
      return;
    }
    if (t >= match.podiumStageEndAt && match.podiumStage === 'map') startMatch(nextMode(), nextMap());
    return;
  }
  // reaparición de cajas destruidas (45 s)
  for (const [id, c] of crates) {
    if (!c.alive && t >= c.respawnAt) {
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

function pickSpawn() {
  return mapData.playerSpawns[Math.floor(Math.random() * mapData.playerSpawns.length)];
}

// límite de golpes por jugador (anti-spam básico): 16 por segundo
function hitAllowed(p) {
  const t = now();
  if (!p._hitWin || t - p._hitWin > 1) { p._hitWin = t; p._hitCount = 0; }
  p._hitCount++;
  return p._hitCount <= 16;
}

function distOk(a, b, max = 130) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= max;
}

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(raw);
  }
}

// bots = hueco libre hasta TOTAL_SLOTS, con tope de MAX_BOTS.
// En zombis no aplica (las oleadas gestionan los bots).
function rebalanceBots() {
  if (match.mode === 'zombies') return;
  const target = Math.max(0, Math.min(MAX_BOTS, TOTAL_SLOTS - players.size));
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

function killPlayer(victim, killerName, isHead) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.curStreak = 0;
  ranking.addDeath(victim.name);
  spawnKit(victim.pos);
  broadcast({ t: 'kill', vn: victim.name, vid: victim.id, kn: killerName, h: !!isHead });
  setTimeout(() => {
    if (!players.has(victim.id)) return;
    const sp = pickSpawn();
    victim.alive = true;
    victim.hp = 100;
    victim.pos = { ...sp };
    send(victim, { t: 'spawn', p: [sp.x, sp.y, sp.z] });
  }, 2600);
}

function damagePlayer(victim, dmg, sourceName, isHead, killerPlayer = null, weaponKind = null) {
  if (!victim.alive || match.state !== 'playing') return;
  victim.hp -= dmg;
  victim.lastDmg = now();
  send(victim, { t: 'ouch', d: dmg, hp: Math.max(0, victim.hp), by: sourceName });
  if (victim.hp <= 0) {
    if (killerPlayer) creditKill(killerPlayer, weaponKind);
    killPlayer(victim, sourceName, isHead);
    return true;
  }
  return false;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  let me = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hola' && !me) {
      const sp = pickSpawn();
      me = {
        id, ws,
        name: sanitizeName(m.name),
        color: BOT_COLORS[(id * 3) % BOT_COLORS.length],
        pos: { ...sp }, ry: 0, rx: 0, speed: 0, sliding: false,
        hp: 100, kills: 0, deaths: 0, alive: true, lastDmg: 0,
        team: match.mode === 'teams' ? assignTeam() : null,
        curStreak: 0, gunIdx: 0,
        hat: (m.skin && HATS[m.skin.h]) ? m.skin.h : 'none',
        skinColor: (m.skin && Number.isInteger(m.skin.c)) ? (m.skin.c & 0xffffff) : null,
        badge: '',
      };
      players.set(id, me);
      // insignia de nivel según su historial en el ranking mundial
      ranking.getTotalKills(me.name).then((total) => {
        if (players.has(id)) players.get(id).badge = badgeFor(total);
      });
      rebalanceBots();
      send(me, { t: 'hi', id, name: me.name, spawn: [sp.x, sp.y, sp.z], slots: TOTAL_SLOTS });
      send(me, matchMsg());
      if (match.mode === 'gun') send(me, { t: 'gun', gi: 0 });
      broadcast({ t: 'aviso', txt: `${me.name} entró a la partida` }, id);
      console.log(`+ ${me.name} (${players.size} jugadores, ${bots.length} bots)`);
      return;
    }
    if (!me) return;

    if (m.t === 'st') {
      // estado del jugador: posición, orientación, velocidad
      if (Array.isArray(m.p) && m.p.length === 3) {
        me.pos = { x: +m.p[0] || 0, y: +m.p[1] || 0, z: +m.p[2] || 0 };
      }
      me.ry = +m.ry || 0;
      me.rx = +m.rx || 0;
      me.speed = Math.min(20, +m.s || 0);
      me.sliding = !!m.sl;
    } else if (m.t === 'fire') {
      if (Array.isArray(m.a) && Array.isArray(m.b)) {
        broadcast({ t: 'fire', id, a: m.a, b: m.b, k: String(m.k || 'ar').slice(0, 8) }, id);
      }
    } else if (m.t === 'nade') {
      if (Array.isArray(m.p) && m.p.length === 3 && Array.isArray(m.v) && m.v.length === 3) {
        broadcast({ t: 'nade', id, p: m.p, v: m.v, im: m.im ? 1 : 0 }, id);
      }
    } else if (m.t === 'hit') {
      if (!me.alive || match.state !== 'playing' || !hitAllowed(me)) return;
      const dmg = Math.max(1, Math.min(120, Math.round(+m.d || 0)));
      const weapon = String(m.w || '').slice(0, 10);
      if (m.kind === 'bot') {
        const bot = bots.find((b) => b.id === m.id);
        if (bot && !bot.dead && distOk(me.pos, bot.pos) &&
            !(match.mode === 'teams' && bot.team === me.team)) {
          const died = bot.takeDamage(dmg, me.pos);
          if (died) {
            creditKill(me, weapon);
            spawnKit(bot.pos);
            broadcast({ t: 'kill', vn: bot.name, vid: null, kn: me.name, h: !!m.h });
          }
        }
      } else if (m.kind === 'pl') {
        const victim = players.get(+m.id);
        if (victim && victim.id !== me.id && distOk(me.pos, victim.pos)) {
          if (match.mode === 'teams' && victim.team === me.team) return; // fuego amigo desactivado
          damagePlayer(victim, dmg, me.name, !!m.h, me, weapon);
        }
      } else if (m.kind === 'crate') {
        const c = crates.get(String(m.id));
        if (c && c.alive) {
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
      send(me, { t: 'pong', ts: +m.ts || 0 });
    } else if (m.t === 'skin') {
      me.hat = HATS[m.h] ? m.h : 'none';
      me.skinColor = Number.isInteger(m.c) ? (m.c & 0xffffff) : me.skinColor;
    } else if (m.t === 'selfdmg') {
      // daño por caída, lo declara el propio cliente
      const dmg = Math.max(1, Math.min(60, Math.round(+m.d || 0)));
      damagePlayer(me, dmg, 'la caída', false);
    } else if (m.t === 'team') {
      if (match.mode === 'teams') {
        me.team = m.tm === 'r' || m.tm === 'b' ? m.tm : assignTeam();
        rebalanceBots();
        broadcast({ t: 'aviso', txt: `${me.name} → equipo ${me.team === 'r' ? 'ROJO' : 'AZUL'}` });
      }
    } else if (m.t === 'modo') {
      // cambio de modo a mano (cualquier jugador; partidas entre amigos)
      if (MODES.includes(m.m) && m.m !== match.mode) {
        broadcast({ t: 'aviso', txt: `${me.name} cambió el modo` });
        startMatch(m.m);
      }
    } else if (m.t === 'vote') {
      if (match.state === 'podium') {
        if (match.podiumStage === 'mode' && MODES.includes(m.m)) match.votes.set(me.id, m.m);
        if (match.podiumStage === 'map' && MAPS[m.map]) match.mapVotes.set(me.id, m.map);
        const tally = {};
        for (const v of match.votes.values()) tally[v] = (tally[v] || 0) + 1;
        const mapTally = {};
        for (const v of match.mapVotes.values()) mapTally[v] = (mapTally[v] || 0) + 1;
        broadcast({ t: 'votes', stage: match.podiumStage, tally, mapTally });
      }
    }
  });

  ws.on('close', () => {
    if (me) {
      players.delete(me.id);
      broadcast({ t: 'aviso', txt: `${me.name} salió de la partida` });
      console.log(`- ${me.name} (${players.size} jugadores)`);
      rebalanceBots();
    }
  });
  ws.on('error', () => {});
});

// --- bucle de simulación ---
const botCtx = {
  colliders,
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
        scoreTeamKill(bot.team);
        spawnKit(target.pos);
        broadcast({ t: 'kill', vn: target.name, vid: null, kn: bot.name, h: false });
      }
    }
  },
};

let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.1, t - last);
  last = t;

  modeTick(t);
  if (match.state === 'playing') {
    for (const b of bots) {
      b.update(dt, botCtx);
      // saltadores: también lanzan a los bots
      if (!b.dead && b.onGround) {
        for (const pad of mapData.jumpPads) {
          const dx = b.pos.x - pad.x, dz = b.pos.z - pad.z;
          if (dx * dx + dz * dz < 1.3 && Math.abs(b.pos.y - pad.y) < 0.8) {
            b.vel.y = pad.power;
            break;
          }
        }
      }
    }
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

  if (players.size === 0) return; // nadie conectado: no hace falta emitir

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
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`PIUM PIUM PIUM multijugador en http://localhost:${PORT}`);
});
