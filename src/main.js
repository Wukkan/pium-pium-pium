import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { WeaponSystem, WEAPON_ORDER } from './weapons.js';
import { BotManager } from './bots.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { Net } from './net.js';
import { Remotes } from './remotes.js';
import { KitManager } from './kits.js';
import { GrenadeManager, explosionDamage } from './grenades.js';

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
const kitsMgr = new KitManager(scene);
const grenades = new GrenadeManager(scene, world.colliders, effects, audio);
grenades.onCount = (n) => hud.updateGrenades(n);

function onHealed() {
  audio.medkit();
  hud.announce('+25 PV ❤');
}

// --- estado de la partida (modo, podio, equipo) ---
const MODES = ['ffa', 'teams', 'gun', 'zombies'];
let matchInfo = { mode: 'ffa', st: 'playing', tl: 0, ts: { r: 0, b: 0 }, wv: 0, zl: 0 };
let myGunIdx = 0;
let podiumOpen = false;
let teamPickerOpen = false;
let podiumTimer = null;

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function bannerText(mm) {
  if (mm.st === 'podium') return '🏁 Fin de partida';
  if (mm.mode === 'ffa') return `⚔ TODOS CONTRA TODOS · primero a 30 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'teams') return `🔴 ${mm.ts.r} — ${mm.ts.b} 🔵 · primero a 30 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'gun') return `🔫 BÚSQUEDA DEL ARMA · tu arma ${Math.min(myGunIdx + 1, 5)}/5 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'zombies') return mm.wv === 0 ? '🧟 ZOMBIS · preparaos...' : `🧟 Oleada ${mm.wv} · quedan ${mm.zl}`;
  return '';
}

function setTeamPicker(open) {
  teamPickerOpen = open;
  hud.showTeamPicker(open);
  weapons.inputBlocked = open || podiumOpen;
}

// --- economía y rachas: se activan con cada baja mía ---
let streak = 0;

function onMyKill(isHead, victimName) {
  const earned = 100 + (isHead ? 50 : 0);
  streak++;
  let bonus = 0;
  if ([3, 5, 8, 10, 15, 20].includes(streak)) {
    bonus = streak * 25;
    hud.announce(`🔥 ¡RACHA x${streak}! (+$${bonus})`);
    audio.streak(streak);
  }
  weapons.addMoney(earned + bonus);
}

function resetStreak() { streak = 0; }

// lanzar granada con G
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || !document.pointerLockElement) return;
  if (state !== 'playing' || player.dead) return;
  if (grenades.throwFrom(camera)) audio.nadeThrow();
});

// --- cuchillo (V): tajo rápido, 100 de daño por la espalda ---
function buildKnifeMesh() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.09, 0.36),
    new THREE.MeshLambertMaterial({ color: 0xd8dde2 }),
  );
  blade.position.set(0, 0.02, -0.28);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.06, 0.16),
    new THREE.MeshLambertMaterial({ color: 0x3a2c20 }),
  );
  g.add(blade, handle);
  g.position.set(0.3, -0.24, -0.5);
  g.visible = false;
  return g;
}
const knifeMesh = buildKnifeMesh();
camera.add(knifeMesh);
let knifeCooldownUntil = 0;
let knifeAnim = 0;
let offlineBotKilled = null; // lo asigna setupOffline

function doKnife() {
  const nowS = performance.now() / 1000;
  if (nowS < knifeCooldownUntil || player.dead || state !== 'playing') return;
  knifeCooldownUntil = nowS + 0.9;
  knifeAnim = 0.001;
  audio.knife();

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  fwd.y = 0;
  fwd.normalize();

  // ¿hay alguien a tiro de cuchillo delante de mí?
  const enRango = (pos) => {
    const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
    if (Math.hypot(dx, dz) > 2.4 || Math.abs(pos.y - player.pos.y) > 2) return false;
    return new THREE.Vector3(dx, 0, dz).normalize().dot(fwd) > 0.5;
  };
  const calcDmg = (yaw) => {
    const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    return facing.dot(fwd) > 0.35 ? 100 : 40; // por la espalda = letal
  };

  if (online && remotes) {
    const grupos = [['pl', remotes.players], ['bot', remotes.bots]];
    for (const [kind, map] of grupos) {
      for (const ent of map.values()) {
        if (!ent.alive) continue;
        const pos = ent.rig.group.position;
        if (!enRango(pos)) continue;
        const dmg = calcDmg(ent.rig.group.rotation.y);
        effects.popup(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), String(dmg), dmg >= 100);
        hud.hitmarker(false);
        audio.hit();
        net.sendHit(kind, ent.id, dmg, dmg >= 100, 'knife');
        return;
      }
    }
  } else if (botsLocal) {
    for (const bot of botsLocal.bots) {
      if (bot.dead || !enRango(bot.pos)) continue;
      const dmg = calcDmg(bot.yaw);
      const killed = bot.takeDamage(dmg, player.pos);
      effects.popup(bot.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)), String(dmg), dmg >= 100);
      hud.hitmarker(killed);
      audio.hit();
      if (killed && offlineBotKilled) offlineBotKilled(bot, false);
      return;
    }
  }
}

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
  botsLocal = new BotManager(scene, world, player, effects, audio, 5);
  botsLocal.ctx.onKill = (killer, victim) => hud.killfeed(killer, victim, false);
  botsLocal.ctx.onBotDeath = (bot) => kitsMgr.spawnLocal(bot.pos);
  weapons.getTargets = () => [...world.occluders, ...botsLocal.getHitMeshes()];

  const localBotKilled = (bot, isHead) => {
    kills++;
    kitsMgr.spawnLocal(bot.pos);
    hud.updateScore(kills, deaths);
    hud.killfeed('Tú', bot.name, true);
    hud.announce(isHead ? `☠ HEADSHOT — ${bot.name}` : `☠ Eliminaste a ${bot.name}`);
    audio.kill();
    onMyKill(isHead, bot.name);
  };

  weapons.onTargetHit = (data, dmg, isHead, point) => {
    if (!data.bot) return;
    const killed = data.bot.takeDamage(dmg, player.pos);
    effects.popup(point, String(dmg), isHead);
    effects.impact(point, 0xcc4444, 4);
    hud.hitmarker(killed);
    audio.hit();
    if (killed) localBotKilled(data.bot, isHead);
  };

  // explosión de granada propia: daño por cercanía a bots y a mí mismo
  grenades.onExplode = (pos) => {
    for (const bot of botsLocal.bots) {
      if (bot.dead) continue;
      const d = Math.hypot(bot.pos.x - pos.x, bot.pos.y + 1 - pos.y, bot.pos.z - pos.z);
      const dmg = explosionDamage(d);
      if (dmg <= 0) continue;
      const killed = bot.takeDamage(dmg, player.pos);
      effects.popup(bot.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), String(dmg), false);
      if (killed) localBotKilled(bot, false);
    }
    const dSelf = Math.hypot(player.pos.x - pos.x, player.pos.y + 1 - pos.y, player.pos.z - pos.z);
    const dmgSelf = Math.round(explosionDamage(dSelf) / 2);
    if (dmgSelf > 0) player.damage(dmgSelf, 'tu propia granada');
  };
  offlineBotKilled = localBotKilled;
  hud.setMatchBanner('🔴 MODO LOCAL · partida libre');

  player.onDeath = (killerName) => {
    deaths++;
    resetStreak();
    kitsMgr.spawnLocal({ x: player.pos.x, y: player.pos.y, z: player.pos.z });
    hud.updateScore(kills, deaths);
    hud.killfeed(killerName, 'Tú', false);
    hud.showDeath(true, killerName);
    state = 'dead';
    setTimeout(() => {
      if (state !== 'dead') return;
      hud.showDeath(false);
      player.spawn(world.playerSpawns[Math.floor(Math.random() * world.playerSpawns.length)]);
      weapons.refill();
      grenades.refill();
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
    net.sendHit(data.net.kind, data.net.id, dmg, isHead, weapons.def.kind);
  };
  weapons.onShot = (a, b, kind) => net.sendFire(a, b, kind);

  net.on('snap', (m) => {
    lastSnap = m;
    remotes.applySnapshot(m, net.id);
    kitsMgr.sync(m.kits || []);
    const me = m.pl.find((p) => p.id === net.id);
    if (me) {
      kills = me.k; deaths = me.d;
      myGunIdx = me.gi || 0;
      hud.updateScore(kills, deaths);
      if (!player.dead) player.health = me.hp;
    }
    if (m.m) {
      matchInfo = m.m;
      hud.setMatchBanner(bannerText(matchInfo));
    }
    hud.setNetStatus(`🟢 ONLINE — ${m.pl.length}/${net.slots} jugadores · ${m.bots.length} bots`, true);
  });

  net.on('match', (m) => {
    matchInfo = m;
    if (m.st === 'playing') {
      podiumOpen = false;
      hud.hidePodium();
      clearInterval(podiumTimer);
      resetStreak();
      myGunIdx = 0;
      weapons.setForced(m.mode === 'gun' ? WEAPON_ORDER[0] : null);
      if (m.mode === 'teams') setTeamPicker(true);
      else setTeamPicker(false);
    }
    hud.setMatchBanner(bannerText(matchInfo));
  });

  net.on('podium', (m) => {
    setTeamPicker(false);
    podiumOpen = true;
    weapons.inputBlocked = true;
    hud.showPodium(m);
    audio.streak(4); // fanfarria de fin de partida
    let secs = m.secs || 12;
    hud.setPodiumCountdown(secs);
    clearInterval(podiumTimer);
    podiumTimer = setInterval(() => {
      secs--;
      hud.setPodiumCountdown(Math.max(0, secs));
      if (secs <= 0) clearInterval(podiumTimer);
    }, 1000);
  });

  net.on('votes', (m) => hud.setPodiumVotes(m.tally || {}));

  net.on('gun', (m) => {
    myGunIdx = m.gi || 0;
    weapons.setForced(WEAPON_ORDER[myGunIdx]);
    hud.announce(`🔫 Arma ${myGunIdx + 1}/5 — ¡sigue así!`);
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
      onMyKill(!!m.h, m.vn);
    }
    if (m.vid === net.id) {
      resetStreak();
      player.dead = true;
      player.health = 0;
      hud.showDeath(true, m.kn);
      state = 'dead';
    }
  });

  // granadas de otros jugadores (visuales, explotan en su sitio)
  net.on('nade', (m) => grenades.spawnRemote(m.p, m.v));
  grenades.onThrow = (pos, vel) => net.sendNade(pos, vel);

  // explosión de granada propia: daño a entidades remotas vía servidor
  grenades.onExplode = (pos) => {
    const aplicar = (ent, kind) => {
      if (!ent.alive) return;
      const ep = ent.rig.group.position;
      const d = Math.hypot(ep.x - pos.x, ep.y + 1 - pos.y, ep.z - pos.z);
      const dmg = explosionDamage(d);
      if (dmg <= 0) return;
      effects.popup(ep.clone().add(new THREE.Vector3(0, 1.4, 0)), String(dmg), false);
      net.sendHit(kind, ent.id, dmg, false, 'nade');
    };
    for (const ent of remotes.players.values()) aplicar(ent, 'pl');
    for (const ent of remotes.bots.values()) aplicar(ent, 'bot');
  };

  net.on('ouch', (m) => {
    player.health = m.hp;
    player.shakeTime = 0.25;
    hud.damageFlash(Math.min(0.8, 0.25 + m.d / 40));
    audio.damaged();
  });

  net.on('spawn', (m) => {
    player.spawn(new THREE.Vector3(m.p[0], m.p[1], m.p[2]));
    weapons.refill();
    grenades.refill();
    hud.showDeath(false);
    hud.updateHealth(player.health, player.maxHealth);
    state = document.pointerLockElement ? 'playing' : 'menu';
    if (state === 'menu') hud.showMenu(true);
  });

  net.on('med', (m) => {
    player.health = m.hp;
    onHealed();
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

// marcador con TAB (partida actual + top mundial)
let worldFetchedAt = -99999;

function refreshWorldRanking() {
  if (performance.now() - worldFetchedAt < 10000) return;
  worldFetchedAt = performance.now();
  fetch('/ranking')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => hud.renderWorld(rows, net.name))
    .catch(() => hud.renderWorld([], null));
}

addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && document.pointerLockElement) {
    e.preventDefault();
    refreshWorldRanking();
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

// teclas de modo: V cuchillo, M cambiar equipo, 1-4 en podio/selector
addEventListener('keydown', (e) => {
  if (!document.pointerLockElement) return;
  if (e.code === 'KeyV') doKnife();
  if (e.code === 'KeyM' && online && matchInfo.mode === 'teams' && !podiumOpen) {
    setTeamPicker(!teamPickerOpen);
  }
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (idx >= 0) {
    if (podiumOpen && online) {
      net.sendVote(MODES[idx]);
    } else if (teamPickerOpen) {
      if (idx === 0) net.sendTeam('r');
      else if (idx === 1) net.sendTeam('b');
      if (idx < 3) setTeamPicker(false);
    }
  }
});

player.onHardLand = (speed) => {
  const dmg = Math.round((speed - 16) * 4);
  if (dmg <= 0) return;
  if (online) net.sendSelfDmg(dmg);
  else if (!player.dead) player.damage(dmg, 'la caída');
};

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
hud.updateMoney(0);
hud.updateSlots(weapons);
hud.updateGrenades(grenades.count);

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
    if (botsLocal) kitsMgr.offlineUpdate(player, botsLocal, onHealed);
  }
  // el mundo online sigue vivo aunque estés en el menú
  if (remotes) remotes.update(dt);
  if (online && joined) net.tickState(dt, player);
  kitsMgr.update(dt);
  grenades.update(dt, player.eyePosition(playerEye));
  effects.update(dt);

  // animación del tajo de cuchillo
  if (knifeAnim > 0) {
    knifeAnim += dt * 4.5;
    if (knifeAnim >= 1) {
      knifeAnim = 0;
      knifeMesh.visible = false;
    } else {
      knifeMesh.visible = true;
      const t = knifeAnim;
      knifeMesh.position.x = 0.3 - t * 0.42;
      knifeMesh.position.z = -0.5 - Math.sin(t * Math.PI) * 0.25;
      knifeMesh.rotation.z = t * 1.1;
      knifeMesh.rotation.y = -0.3 + t * 0.6;
    }
  }

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
  scene, camera, renderer, player, weapons, world, effects, net, tick, grenades, doKnife,
  getRemotes: () => remotes,
  getBots: () => botsLocal,
  getState: () => state,
  setState: (s) => { state = s; },
  join: joinAndPlay,
};
