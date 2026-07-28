import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { BotManager } from './bots.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { Net } from './net.js';
import { Remotes } from './remotes.js';

// ---------------------------------------------------------------------------
// PIUM PIUM PIUM — réplica de krunker.io, ahora multijugador.
// Con servidor: otros jugadores + bots del servidor (rellenan hasta 10).
// Sin servidor (o si falla la conexión): modo local contra 9 bots.
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa6d3f2);
scene.fog = new THREE.Fog(0xa6d3f2, 70, 170);

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

let viewW = 0, viewH = 0;
function fitViewport() {
  if (innerWidth === viewW && innerHeight === viewH) return;
  viewW = innerWidth; viewH = innerHeight;
  camera.aspect = Math.max(innerWidth, 1) / Math.max(innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
fitViewport();
addEventListener('resize', fitViewport);

scene.add(new THREE.HemisphereLight(0xffffff, 0xcbbd9d, 0.85));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
sun.position.set(35, 55, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
sun.shadow.camera.near = 5; sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0004;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// --- sistemas ---
const world = buildWorld(scene);
const hud = new HUD();
const audio = new AudioSys();
const effects = new Effects(scene);
const player = new Player(camera, world);
const weapons = new WeaponSystem(camera, scene, player, effects, audio, hud);
const net = new Net();

let remotes = null;      // modo online
let botsLocal = null;    // modo offline
let online = false;
let joined = false;
let lastSnap = null;
let kills = 0, deaths = 0;
let state = 'menu'; // menu | playing | dead

const playerEye = new THREE.Vector3();

// --- interfaz del menú ---
const playBtn = document.getElementById('play-btn');
const nameInput = document.getElementById('name-input');
nameInput.value = localStorage.getItem('pium_name') || '';

// sondeo rápido: ¿hay servidor?
fetch('/salud').then((r) => {
  if (r.ok) hud.setNetStatus('🟢 Servidor online — pon tu nombre y JUGAR', true);
  else hud.setNetStatus('🔴 Sin servidor — jugarás contra bots locales', false);
}).catch(() => {
  hud.setNetStatus('🔴 Sin servidor — jugarás contra bots locales', false);
});

// --- cableado modo OFFLINE (bots locales) ---
function setupOffline() {
  botsLocal = new BotManager(scene, world, player, effects, audio, 9);
  weapons.getTargets = () => [...world.occluders, ...botsLocal.getHitMeshes()];
  weapons.onTargetHit = (data, dmg, isHead, point) => {
    if (!data.bot) return;
    const killed = data.bot.takeDamage(dmg, player.pos);
    effects.popup(point, String(dmg), isHead);
    effects.impact(point, 0xcc4444, 4);
    hud.hitmarker(killed);
    audio.hit();
    if (killed) {
      kills++;
      hud.updateScore(kills, deaths);
      hud.killfeed('Tú', data.bot.name, true);
      hud.announce(isHead ? `☠ HEADSHOT — ${data.bot.name}` : `☠ Eliminaste a ${data.bot.name}`);
      audio.kill();
    }
  };
  player.onDeath = (killerName) => {
    deaths++;
    hud.updateScore(kills, deaths);
    hud.killfeed(killerName, 'Tú', false);
    hud.showDeath(true, killerName);
    state = 'dead';
    setTimeout(() => {
      if (state !== 'dead') return;
      hud.showDeath(false);
      player.spawn(world.playerSpawns[Math.floor(Math.random() * world.playerSpawns.length)]);
      hud.updateHealth(player.health, player.maxHealth);
      state = document.pointerLockElement ? 'playing' : 'menu';
      if (state === 'menu') hud.showMenu(true);
    }, 2600);
  };
  hud.setNetStatus('🔴 Modo local — tú contra 9 bots', false);
}

// --- cableado modo ONLINE ---
function setupOnline() {
  online = true;
  player.netMode = true;
  remotes = new Remotes(scene);

  weapons.getTargets = () => [...world.occluders, ...remotes.getHitMeshes()];
  weapons.onTargetHit = (data, dmg, isHead, point) => {
    if (!data.net) return;
    effects.popup(point, String(dmg), isHead);
    effects.impact(point, 0xcc4444, 4);
    hud.hitmarker(false);
    audio.hit();
    net.sendHit(data.net.kind, data.net.id, dmg, isHead);
  };
  weapons.onShot = (a, b, kind) => net.sendFire(a, b, kind);

  net.on('snap', (m) => {
    lastSnap = m;
    remotes.applySnapshot(m, net.id);
    const me = m.pl.find((p) => p.id === net.id);
    if (me) {
      kills = me.k; deaths = me.d;
      hud.updateScore(kills, deaths);
      if (!player.dead) player.health = me.hp;
    }
    hud.setNetStatus(`🟢 ONLINE — ${m.pl.length}/${net.slots} jugadores · ${m.bots.length} bots`, true);
  });

  net.on('fire', (m) => {
    const a = new THREE.Vector3(m.a[0], m.a[1], m.a[2]);
    const b = new THREE.Vector3(m.b[0], m.b[1], m.b[2]);
    effects.tracer(a, b, m.bid !== undefined ? 0xff8866 : 0x9bd4ff);
    player.eyePosition(playerEye);
    audio.shot(m.k, audio.distVol(a.distanceTo(playerEye)) * 0.7);
  });

  net.on('kill', (m) => {
    const soyYo = m.kn === net.name;
    hud.killfeed(m.kn, m.vid === net.id ? 'Tú' : m.vn, soyYo);
    if (soyYo) {
      hud.hitmarker(true);
      hud.announce(m.h ? `☠ HEADSHOT — ${m.vn}` : `☠ Eliminaste a ${m.vn}`);
      audio.kill();
    }
    if (m.vid === net.id) {
      player.dead = true;
      player.health = 0;
      hud.showDeath(true, m.kn);
      state = 'dead';
    }
  });

  net.on('ouch', (m) => {
    player.health = m.hp;
    player.shakeTime = 0.25;
    hud.damageFlash(Math.min(0.8, 0.25 + m.d / 40));
    audio.damaged();
  });

  net.on('spawn', (m) => {
    player.spawn(new THREE.Vector3(m.p[0], m.p[1], m.p[2]));
    hud.showDeath(false);
    hud.updateHealth(player.health, player.maxHealth);
    state = document.pointerLockElement ? 'playing' : 'menu';
    if (state === 'menu') hud.showMenu(true);
  });

  net.on('aviso', (m) => hud.info(String(m.txt).slice(0, 40)));
  net.on('botbye', (m) => remotes.removeBot(m.id));
  net.onClose(() => {
    hud.setNetStatus('🔴 Conexión perdida — recarga la página', false);
    hud.info('⚠ Conexión perdida');
  });
}

// --- entrar al juego ---
let connecting = false;

async function joinAndPlay() {
  audio.ensure();
  if (joined || botsLocal) { tryLock(); return; }
  if (connecting) return;
  connecting = true;
  playBtn.textContent = 'CONECTANDO...';
  const name = nameInput.value.trim();
  if (name) localStorage.setItem('pium_name', name);
  try {
    const hi = await net.connect(name);
    setupOnline();
    joined = true;
    nameInput.value = net.name;
    nameInput.disabled = true;
    player.spawn(new THREE.Vector3(hi.spawn[0], hi.spawn[1], hi.spawn[2]));
  } catch {
    setupOffline();
    player.spawn(world.playerSpawns[0]);
  }
  connecting = false;
  playBtn.textContent = 'JUGAR';
  hud.updateHealth(player.health, player.maxHealth);
  hud.updateAmmo(weapons);
  hud.updateScore(kills, deaths);
  tryLock();
}

function tryLock() {
  const p = renderer.domElement.requestPointerLock({ unadjustedMovement: true });
  if (p && p.catch) p.catch(() => renderer.domElement.requestPointerLock());
}

playBtn.addEventListener('click', joinAndPlay);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinAndPlay();
  e.stopPropagation();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    if (state === 'menu') state = 'playing';
    hud.showMenu(false);
    hud.showHud(true);
  } else {
    if (state === 'playing') {
      state = 'menu';
      hud.showMenu(true);
      hud.setMenuStats(kills, deaths);
      hud.setScope(false);
      hud.showScores(false);
    }
  }
});

// marcador con TAB
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && document.pointerLockElement) {
    e.preventDefault();
    const rows = [];
    if (online && lastSnap) {
      for (const p of lastSnap.pl) {
        rows.push({ name: p.n, kills: p.k, deaths: p.d, isMe: p.id === net.id, isBot: false, alive: !!p.al });
      }
      rows.sort((a, b) => b.kills - a.kills);
      for (const b of lastSnap.bots) {
        rows.push({ name: b.n, kills: null, deaths: null, isMe: false, isBot: true, alive: !!b.al });
      }
    } else if (botsLocal) {
      rows.push({ name: 'Tú', kills, deaths, isMe: true, isBot: false, alive: !player.dead });
      for (const b of botsLocal.bots) {
        rows.push({ name: b.name, kills: null, deaths: null, isMe: false, isBot: true, alive: !b.dead });
      }
    }
    hud.renderScores(rows);
    hud.showScores(true);
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.showScores(false);
});

player.onJump = () => audio.jump();
player.onLand = () => audio.land();
player.onDamaged = (amount) => {
  hud.damageFlash(Math.min(0.8, 0.25 + amount / 40));
  audio.damaged();
};

// posición inicial de la cámara para el fondo del menú
player.spawn(new THREE.Vector3(0, 0.1, 30));
hud.updateHealth(player.health, player.maxHealth);
hud.updateAmmo(weapons);
hud.updateScore(0, 0);

// --- bucle de juego ---
let lastTime = performance.now();
let fpsAccum = 0, fpsCount = 0, fpsTimer = 0;

function tick(now) {
  fitViewport();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  const playing = state === 'playing';
  const inputEnabled = playing && !player.dead;

  if (state !== 'menu') {
    player.update(dt, inputEnabled);
    weapons.update(dt, inputEnabled);
    if (botsLocal) botsLocal.update(dt);
  }
  // el mundo online sigue vivo aunque estés en el menú
  if (remotes) remotes.update(dt);
  if (online && joined) net.tickState(dt, player);
  effects.update(dt);

  hud.update(dt);
  if (playing || state === 'dead') {
    hud.updateHealth(player.health, player.maxHealth);
  }

  fpsAccum += 1 / Math.max(dt, 1e-4); fpsCount++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    hud.el.fps.textContent = Math.round(fpsAccum / fpsCount);
    fpsAccum = 0; fpsCount = 0; fpsTimer = 0;
  }

  renderer.render(scene, camera);
}

function loop(now) {
  requestAnimationFrame(loop);
  tick(now);
}
requestAnimationFrame(loop);

// gancho de depuración/pruebas (no afecta al juego)
window.__game = {
  scene, camera, renderer, player, weapons, world, effects, net, tick,
  getRemotes: () => remotes,
  getBots: () => botsLocal,
  getState: () => state,
  setState: (s) => { state = s; },
  join: joinAndPlay,
};
