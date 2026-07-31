import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildMapBoxes, buildColliders, PLAYER_SPAWNS, TOTAL_SLOTS, MAX_BOTS, BOT_NAMES, BOT_COLORS } from '../src/shared/mapdata.js';
import { ServerBot } from './botai.js';

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
const colliders = buildColliders(buildMapBoxes());
const players = new Map(); // id -> jugador
const bots = [];
const kits = []; // kits de vida: {id, x, y, z, expireAt}
let nextId = 1;
let botSerial = 0;
let kitSerial = 0;

function spawnKit(pos) {
  kits.push({ id: 'k' + kitSerial++, x: pos.x, y: pos.y, z: pos.z, expireAt: now() + 30 });
  while (kits.length > 12) kits.shift(); // límite de kits en el suelo
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
  return PLAYER_SPAWNS[Math.floor(Math.random() * PLAYER_SPAWNS.length)];
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

// bots = hueco libre hasta TOTAL_SLOTS, con tope de MAX_BOTS
function rebalanceBots() {
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
}

function killPlayer(victim, killerName, isHead) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
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

function damagePlayer(victim, dmg, sourceName, isHead, killerPlayer = null) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastDmg = now();
  send(victim, { t: 'ouch', d: dmg, hp: Math.max(0, victim.hp), by: sourceName });
  if (victim.hp <= 0) {
    if (killerPlayer) killerPlayer.kills++;
    killPlayer(victim, sourceName, isHead);
  }
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
      };
      players.set(id, me);
      rebalanceBots();
      send(me, { t: 'hi', id, name: me.name, spawn: [sp.x, sp.y, sp.z], slots: TOTAL_SLOTS });
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
    } else if (m.t === 'hit') {
      if (!me.alive) return;
      const dmg = Math.max(1, Math.min(120, Math.round(+m.d || 0)));
      if (m.kind === 'bot') {
        const bot = bots.find((b) => b.id === m.id);
        if (bot && !bot.dead) {
          const died = bot.takeDamage(dmg, me.pos);
          if (died) {
            me.kills++;
            spawnKit(bot.pos);
            broadcast({ t: 'kill', vn: bot.name, vid: null, kn: me.name, h: !!m.h });
          }
        }
      } else if (m.kind === 'pl') {
        const victim = players.get(+m.id);
        if (victim && victim.id !== me.id) {
          damagePlayer(victim, dmg, me.name, !!m.h, me);
        }
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
      damagePlayer(target, dmg, bot.name, false);
    } else {
      const died = target.takeDamage(dmg, bot.pos);
      if (died) {
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

  for (const b of bots) b.update(dt, botCtx);

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
    pl: [...players.values()].map((p) => ({
      id: p.id, n: p.name, c: p.color,
      p: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      ry: +p.ry.toFixed(2), rx: +p.rx.toFixed(2), s: +p.speed.toFixed(1),
      hp: Math.round(p.hp), k: p.kills, d: p.deaths, al: p.alive ? 1 : 0,
    })),
    bots: bots.map((b) => ({
      id: b.id, n: b.name, c: b.color,
      p: [+b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2)],
      ry: +b.yaw.toFixed(2), s: +b.speed.toFixed(1),
      hp: Math.round(b.hp), al: b.dead ? 0 : 1, en: b.engaging ? 1 : 0,
    })),
    kits: kits.map((k) => ({ id: k.id, p: [+k.x.toFixed(2), +k.y.toFixed(2), +k.z.toFixed(2)] })),
  };
  broadcast(snap);
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`PIUM PIUM PIUM multijugador en http://localhost:${PORT}`);
});
