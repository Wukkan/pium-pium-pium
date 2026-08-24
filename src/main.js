import * as THREE from 'three';
import * as QUARKS from 'three.quarks';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { WeaponSystem, WEAPON_DEFS, WEAPON_ORDER } from './weapons.js';
import { BotManager } from './bots.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { Net } from './net.js';
import { Remotes } from './remotes.js';
import { KitManager } from './kits.js';
import { GrenadeManager, explosionDamage } from './grenades.js';
import { Missions } from './missions.js';
import { HATS, MAPS, MAX_BOTS, QUICK_CHAT, TOTAL_SLOTS } from './shared/mapdata.js';
import {
  BOT_BODY,
  PLAYER_BODY,
  colliderOccupied,
  isSpawnPointSafe,
  selectSafeSpawn,
} from './shared/spawn-safety.js';
import {
  botPanelState, buyMenuCategoryState, isBotConfigAcknowledgement, loadoutMetadata,
  effectiveMasterVolume, effectivePixelRatio, menuNavState, readSettings, shotTracerState,
} from './ui-models.js';
import {
  BINDING_ACTIONS, assignBinding, bindingSlotIndex, keyCodeLabel,
  matchesBinding, readBindings,
} from './input-bindings.js';
import { makeHumanoid } from './humanoid.js';
import { SKIN_COLORS, sanitizeSkin } from './player-profile.js';

// ---------------------------------------------------------------------------
// PIUM PIUM PIUM — shooter multijugador original para navegador.
// Con servidor: otros jugadores + hasta 5 bots configurables de la sala.
// Sin servidor (o si falla la conexión): modo local con hasta 5 bots.
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
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
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// --- sistemas ---
const world = buildWorld(scene);
const hud = new HUD();
const audio = new AudioSys();
const effects = new Effects(scene, { THREE, quarks: QUARKS });
const player = new Player(camera, world);
const weapons = new WeaponSystem(camera, scene, player, effects, audio, hud);
const net = new Net();
const kitsMgr = new KitManager(scene);
const grenades = new GrenadeManager(scene, world.colliders, effects, audio);
grenades.onCount = (n) => hud.updateGrenades(n);

function safePlayerSpawn(preferred = null, occupants = []) {
  const preferredPoint = preferred && {
    x: Number(preferred.x), y: Number(preferred.y), z: Number(preferred.z),
  };
  const selected = preferredPoint && isSpawnPointSafe(preferredPoint, world.colliders, {
    body: PLAYER_BODY,
    margin: 1,
  }) ? preferredPoint : selectSafeSpawn({
    points: world.playerSpawns,
    colliders: world.colliders,
    body: PLAYER_BODY,
    margin: 1,
    occupants,
    previous: player.pos,
  });
  if (!selected) throw new Error(`El mapa ${world.mapId} no tiene un respawn seguro`);
  return new THREE.Vector3(selected.x, selected.y, selected.z);
}

function onHealed() {
  audio.medkit();
  hud.announce('+25 PV ❤');
  missions.event('kit');
}

function onAmmoPicked(amount = 20) {
  const added = weapons.addAmmo(amount);
  if (added > 0) hud.announce(`📦 Munición +${added}`);
  else hud.announce('📦 Ya llevas la munición al máximo');
  audio.buy();
}

// lanzagranadas → proyectil de impacto
weapons.onLaunch = () => grenades.launch(camera);

// cajas destruibles
const localCrateHp = new Map();
const pendingOnlineCrateRestores = new Map();

function cancelOnlineCrateRestore(id) {
  const timer = pendingOnlineCrateRestores.get(id);
  if (timer) clearTimeout(timer);
  pendingOnlineCrateRestores.delete(id);
}

function clearOnlineCrateRestores() {
  for (const timer of pendingOnlineCrateRestores.values()) clearTimeout(timer);
  pendingOnlineCrateRestores.clear();
}

function syncOnlineCrate(id, alive) {
  if (!alive) {
    cancelOnlineCrateRestore(id);
    return world.setCrate(id, false);
  }
  if (!net.connected) {
    cancelOnlineCrateRestore(id);
    return null;
  }
  const crate = world.crates.get(id);
  if (!crate) return null;
  if (colliderOccupied(crate.collider, [player], PLAYER_BODY, 1)) {
    if (!pendingOnlineCrateRestores.has(id)) {
      const timer = setTimeout(() => {
        pendingOnlineCrateRestores.delete(id);
        syncOnlineCrate(id, true);
      }, 120);
      pendingOnlineCrateRestores.set(id, timer);
    }
    return null;
  }
  cancelOnlineCrateRestore(id);
  return world.setCrate(id, true);
}

function loadWorldMap(mapId) {
  if (!mapId || mapId === world.mapId) return;
  clearOnlineCrateRestores();
  world.load(mapId);
}

function restoreLocalCrateWhenClear(id) {
  const crate = world.crates.get(id);
  if (!crate) return;
  const occupiedByPlayer = colliderOccupied(crate.collider, [player], PLAYER_BODY);
  const occupiedByBot = colliderOccupied(crate.collider, botsLocal?.bots || [], BOT_BODY);
  if (occupiedByPlayer || occupiedByBot) {
    setTimeout(() => restoreLocalCrateWhenClear(id), 1000);
    return;
  }
  localCrateHp.delete(id);
  world.setCrate(id, true);
}

weapons.onCrateHit = (id, dmg, kind) => {
  if (online) {
    net.sendHit('crate', id, dmg, false, kind);
    return;
  }
  const hp = (localCrateHp.has(id) ? localCrateHp.get(id) : 80) - dmg;
  localCrateHp.set(id, hp);
  if (hp <= 0) {
    const pos = world.setCrate(id, false);
    if (pos) {
      effects.impact(pos, 0xc09858, 14);
      audio.boom(0.3);
    }
    setTimeout(() => restoreLocalCrateWhenClear(id), 45000);
  }
};

// --- estado de la partida (modo, podio, equipo) ---
const MODES = ['ffa', 'teams', 'gun', 'zombies'];
let matchInfo = { mode: 'ffa', st: 'playing', tl: 0, ts: { r: 0, b: 0 }, wv: 0, zl: 0 };
let myGunIdx = 0;
let podiumOpen = false;
let teamPickerOpen = false;
let podiumTimer = null;
let podiumStage = 'mode';

function startPodiumCountdown(secs = 15) {
  let remaining = Math.max(0, Number(secs) || 0);
  hud.setPodiumCountdown(remaining);
  clearInterval(podiumTimer);
  podiumTimer = setInterval(() => {
    remaining--;
    hud.setPodiumCountdown(Math.max(0, remaining));
    if (remaining <= 0) clearInterval(podiumTimer);
  }, 1000);
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function bannerText(mm) {
  const mapa = MAPS[mm.map] ? `${MAPS[mm.map]} · ` : '';
  if (mm.st === 'podium') return '🏁 Fin de partida';
  if (mm.mode === 'ffa') return `${mapa}⚔ TODOS CONTRA TODOS · primero a 30 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'teams') return `${mapa}🔴 ${mm.ts.r} — ${mm.ts.b} 🔵 · primero a 30 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'gun') return `${mapa}🔫 BÚSQUEDA DEL ARMA · tu arma ${Math.min(myGunIdx + 1, 5)}/5 · ${fmtTime(mm.tl)}`;
  if (mm.mode === 'zombies') return mm.wv === 0 ? `${mapa}🧟 ZOMBIS · preparaos...` : `${mapa}🧟 Oleada ${mm.wv} · quedan ${mm.zl}`;
  return '';
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const ARSENAL_STORAGE_KEY = 'pium_arsenal_v1';
weapons.restoreEconomyState(safeStorageGet(ARSENAL_STORAGE_KEY));
const saveArsenalEconomy = (snapshot = weapons.exportEconomyState()) =>
  safeStorageSet(ARSENAL_STORAGE_KEY, JSON.stringify(snapshot));
weapons.onEconomyChange = saveArsenalEconomy;

// --- personalización (sombrero + color), guardada en el navegador ---
let storedSkin = null;
try { storedSkin = JSON.parse(safeStorageGet('pium_skin')); } catch { /* se reparará abajo */ }
let skin = sanitizeSkin(storedSkin);
const saveSkin = () => safeStorageSet('pium_skin', JSON.stringify(skin));
const COLORS_PRICE = 300;
let menuMsg = '';

const operatorPreview = {
  host: null,
  renderer: null,
  scene: null,
  camera: null,
  keyLight: null,
  rig: null,
  key: '',
  angle: 0.08,
  renderAccumulator: 0,
};

function disposePreviewRig() {
  if (!operatorPreview.rig) return;
  operatorPreview.scene.remove(operatorPreview.rig.group);
  operatorPreview.rig.group.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;
    if (object.geometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.map) material.map.dispose();
      material.dispose();
    }
  });
  operatorPreview.rig = null;
}

function refreshOperatorPreview() {
  if (!operatorPreview.scene) return;
  const name = (nameInput?.value || 'OPERADOR').toUpperCase();
  const color = skin.color || 0x3f6ea8;
  const key = `${name}|${skin.hat || 'none'}|${color}`;
  if (key === operatorPreview.key) return;
  operatorPreview.key = key;
  disposePreviewRig();
  const rig = makeHumanoid(color, name, (part) => ({ preview: true, part }), '#ffffff', skin.hat || 'none');
  rig.nameSprite.visible = false;
  rig.group.scale.setScalar(1.1);
  rig.group.rotation.y = operatorPreview.angle;
  operatorPreview.scene.add(rig.group);
  operatorPreview.rig = rig;
}

function initOperatorPreview() {
  const host = document.getElementById('operator-preview');
  if (!host || operatorPreview.renderer) return;
  const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  previewRenderer.setPixelRatio(effectivePixelRatio(settings.renderScale, devicePixelRatio));
  previewRenderer.setClearColor(0x000000, 0);
  previewRenderer.shadowMap.enabled = settings.shadowsEnabled;
  previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  previewRenderer.toneMappingExposure = 1.08;
  host.appendChild(previewRenderer.domElement);

  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(27, 1, 0.1, 50);
  previewCamera.position.set(1.35, 1.8, -5.35);
  previewCamera.lookAt(0, 1.15, 0);

  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x0b1220, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffe0ae, 3.2);
  keyLight.position.set(-3.5, 5, -4.5);
  keyLight.castShadow = settings.shadowsEnabled;
  const shadowSize = { low: 512, medium: 1024, high: 2048 }[settings.shadowQuality] || 1024;
  setShadowResolution(keyLight, Math.max(256, shadowSize / 2));
  const rimLight = new THREE.PointLight(0x4e9eff, 2.5, 8);
  rimLight.position.set(2.6, 2.2, 1.8);
  previewScene.add(hemi, keyLight, rimLight);

  const platform = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 40),
    new THREE.MeshBasicMaterial({ color: 0x14243a, transparent: true, opacity: 0.82 }),
  );
  platform.rotation.x = -Math.PI / 2;
  platform.position.y = 0.02;
  previewScene.add(platform);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.012, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc34d, transparent: true, opacity: 0.75 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  previewScene.add(ring);

  operatorPreview.host = host;
  operatorPreview.renderer = previewRenderer;
  operatorPreview.scene = previewScene;
  operatorPreview.camera = previewCamera;
  operatorPreview.keyLight = keyLight;
  refreshOperatorPreview();
}

function renderOperatorPreview(dt) {
  if (!operatorPreview.renderer || !operatorPreview.host) return;
  operatorPreview.renderAccumulator += Math.max(0, dt);
  if (operatorPreview.renderAccumulator < 1 / 30) return;
  const previewDt = Math.min(0.1, operatorPreview.renderAccumulator);
  operatorPreview.renderAccumulator = 0;
  const rect = operatorPreview.host.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return;
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  const pixelRatio = operatorPreview.renderer.getPixelRatio();
  if (operatorPreview.renderer.domElement.width !== Math.floor(width * pixelRatio) ||
      operatorPreview.renderer.domElement.height !== Math.floor(height * pixelRatio)) {
    operatorPreview.renderer.setSize(width, height, false);
    operatorPreview.camera.aspect = width / height;
    operatorPreview.camera.updateProjectionMatrix();
  }
  if (operatorPreview.rig && !document.body.classList.contains('reduced-motion')) {
    operatorPreview.angle += previewDt * 0.12;
    operatorPreview.rig.group.rotation.y = operatorPreview.angle;
  }
  operatorPreview.renderer.render(operatorPreview.scene, operatorPreview.camera);
}

let settings = readSettings(safeStorageGet('pium_settings'));
let bindings = readBindings(safeStorageGet('pium_bindings_v1'));
let activeSettingsTab = 'audio';
let bindingCaptureAction = null;
let appliedBindingsSignature = '';

function saveSettings() {
  return safeStorageSet('pium_settings', JSON.stringify(settings));
}

function saveBindings() {
  return safeStorageSet('pium_bindings_v1', JSON.stringify(bindings));
}

function bindingLabel(action) {
  return keyCodeLabel(bindings[action]);
}

function isAction(event, action) {
  return matchesBinding(bindings, action, event.code);
}

function setShadowResolution(light, size) {
  if (!light?.shadow || light.shadow.mapSize.x === size) return;
  light.shadow.map?.dispose();
  light.shadow.map = null;
  light.shadow.mapSize.set(size, size);
  light.shadow.needsUpdate = true;
}

function renderMenuControlSummary() {
  const summary = document.getElementById('menu-control-summary');
  if (!summary) return;
  const item = (action, text) => `<span><b>${bindingLabel(action)}</b> ${text}</span>`;
  summary.innerHTML = [
    item('moveForward', 'avanzar'), item('jump', 'saltar'), item('slide', 'deslizar'),
    item('reload', 'recargar'), item('grenade', 'granada'), item('melee', 'cuchillo'),
    item('openArsenal', 'arsenal'), item('openBots', 'bots'), item('scoreboard', 'marcador'),
    item('muteSound', 'silenciar'),
  ].join('');
  const botShortcut = document.getElementById('bot-panel-shortcut');
  if (botShortcut) botShortcut.textContent = bindingLabel('openBots');
  const buyShortcut = document.getElementById('buy-menu-shortcut');
  if (buyShortcut) buyShortcut.textContent = bindingLabel('openArsenal');
  const menuArsenalShortcut = document.getElementById('menu-arsenal-shortcut');
  if (menuArsenalShortcut) menuArsenalShortcut.textContent = bindingLabel('openArsenal');
  const buyHelpClose = document.getElementById('buy-help-close');
  if (buyHelpClose) buyHelpClose.textContent = `${bindingLabel('openArsenal')} / ESC`;
  const buyHelpSlots = document.getElementById('buy-help-slots');
  if (buyHelpSlots) {
    buyHelpSlots.textContent = Array.from({ length: 7 }, (_, index) => bindingLabel(`slot${index + 1}`)).join(' / ');
  }
  const teamAction = document.getElementById('team-action-shortcut');
  if (teamAction) teamAction.textContent = bindingLabel('changeTeam');
  for (const [id, action] of [
    ['team-key-red', 'slot1'], ['team-key-blue', 'slot2'], ['team-key-auto', 'slot3'],
  ]) {
    const element = document.getElementById(id);
    if (element) element.textContent = bindingLabel(action);
  }
  const podiumHint = document.getElementById('podium-key-hint');
  if (podiumHint) {
    const modeKeys = Array.from({ length: 4 }, (_, index) => bindingLabel(`slot${index + 1}`)).join(' / ');
    const mapKeys = [bindingLabel('slot5'), bindingLabel('slot6')].join(' / ');
    podiumHint.textContent = `${modeKeys} MODO · ${mapKeys} MAPA`;
  }
}

function applySettings() {
  player.sensitivity = settings.sensitivity;
  player.invertY = settings.invertY;
  player.bunnyHopEnabled = settings.bunnyHopEnabled;
  player.screenShake = settings.reducedMotion ? 0 : settings.screenShake;
  weapons.setFov(settings.fov);
  const bindingsSignature = JSON.stringify(bindings);
  if (bindingsSignature !== appliedBindingsSignature) {
    player.setBindings(bindings);
    weapons.setBindings(bindings);
    appliedBindingsSignature = bindingsSignature;
  }
  weapons.setPreferences({
    aimMode: settings.aimMode,
    weaponBob: settings.reducedMotion ? 0 : settings.weaponBob,
  });
  audio.setMasterVolume(effectiveMasterVolume(settings));
  const pixelRatio = effectivePixelRatio(settings.renderScale, devicePixelRatio);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  if (operatorPreview.renderer && operatorPreview.renderer.getPixelRatio() !== pixelRatio) {
    operatorPreview.renderer.setPixelRatio(pixelRatio);
  }
  renderer.shadowMap.enabled = settings.shadowsEnabled;
  renderer.shadowMap.needsUpdate = true;
  sun.castShadow = settings.shadowsEnabled;
  const shadowSize = { low: 512, medium: 1024, high: 2048 }[settings.shadowQuality] || 1024;
  setShadowResolution(sun, shadowSize);
  if (operatorPreview.renderer) {
    operatorPreview.renderer.shadowMap.enabled = settings.shadowsEnabled;
    setShadowResolution(operatorPreview.keyLight, Math.max(256, shadowSize / 2));
  }
  effects.setQuality(settings.effectsQuality);
  audio.setVoiceLimit({ low: 18, balanced: 28, high: 40 }[settings.effectsQuality] || 28);
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.body.classList.toggle('high-contrast', settings.highContrast);
  hud.setFpsVisible(settings.showFps);
  hud.setPingVisible(settings.showPing);
  hud.setDamageFlashEnabled(settings.damageFlash);
  hud.setCrosshairPreferences({
    visible: settings.crosshairVisible,
    color: settings.crosshairColor,
    scale: settings.crosshairScale,
  });
  hud.setBindingLabels({
    grenade: bindingLabel('grenade'),
    reload: bindingLabel('reload'),
    slots: Array.from({ length: 7 }, (_, index) => bindingLabel(`slot${index + 1}`)),
  });
  renderMenuControlSummary();
}

function setSettingsStatus(message, tone = 'saved') {
  for (const id of ['settings-save-status', 'keybinding-status']) {
    const status = document.getElementById(id);
    if (!status) continue;
    status.textContent = message;
    status.dataset.tone = tone;
  }
}

function renderBindings() {
  const list = document.getElementById('keybinding-list');
  if (!list) return;
  list.textContent = '';
  let group = '';
  for (const definition of BINDING_ACTIONS) {
    if (definition.group !== group) {
      group = definition.group;
      const heading = document.createElement('h4');
      heading.className = 'keybind-group-title';
      heading.textContent = group;
      list.append(heading);
    }
    const row = document.createElement('div');
    row.className = 'keybind-row';
    const label = document.createElement('span');
    label.textContent = definition.label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keybind-button';
    button.dataset.bindingAction = definition.action;
    button.textContent = bindingCaptureAction === definition.action
      ? 'PULSA UNA TECLA…'
      : bindingLabel(definition.action);
    button.classList.toggle('listening', bindingCaptureAction === definition.action);
    button.setAttribute('aria-label', `Cambiar ${definition.label}. Tecla actual: ${bindingLabel(definition.action)}`);
    row.append(label, button);
    list.append(row);
  }
}

function cancelBindingCapture(message = 'Asignación cancelada al salir de Controles.') {
  if (!bindingCaptureAction) return false;
  bindingCaptureAction = null;
  renderBindings();
  setSettingsStatus(message, 'warning');
  return true;
}

function renderFullscreenState() {
  const active = !!document.fullscreenElement;
  for (const button of document.querySelectorAll('[data-fullscreen-action]')) {
    button.textContent = active ? 'SALIR DE PANTALLA COMPLETA' : 'PANTALLA COMPLETA';
    button.setAttribute('aria-label', 'Pantalla completa');
    button.setAttribute('aria-pressed', String(active));
  }
}

function setSettingsTab(tab, focus = false) {
  const valid = ['audio', 'video', 'controls', 'gameplay', 'accessibility'];
  const nextTab = valid.includes(tab) ? tab : 'audio';
  if (nextTab !== 'controls') cancelBindingCapture();
  activeSettingsTab = nextTab;
  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === activeSettingsTab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (focus && active) button.focus();
  });
  document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== activeSettingsTab;
  });
}

function renderSettings() {
  const value = (id, next) => { const el = document.getElementById(id); if (el) el.value = next; };
  const checked = (id, next) => { const el = document.getElementById(id); if (el) el.checked = next; };
  const output = (id, next) => { const el = document.getElementById(id); if (el) el.textContent = next; };
  value('option-fov', settings.fov);
  value('option-sensitivity', settings.sensitivity);
  value('option-volume', settings.masterVolume);
  value('option-render-scale', settings.renderScale);
  value('option-shadow-quality', settings.shadowQuality);
  value('option-effects-quality', settings.effectsQuality);
  value('option-aim-mode', settings.aimMode);
  value('option-weapon-bob', settings.weaponBob);
  value('option-screen-shake', settings.screenShake);
  value('option-crosshair-color', settings.crosshairColor);
  value('option-crosshair-scale', settings.crosshairScale);
  checked('option-sound-enabled', settings.soundEnabled);
  checked('option-shadows', settings.shadowsEnabled);
  checked('option-invert', settings.invertY);
  checked('option-show-fps', settings.showFps);
  checked('option-show-ping', settings.showPing);
  checked('option-bunny-hop', settings.bunnyHopEnabled);
  checked('option-crosshair-visible', settings.crosshairVisible);
  checked('option-damage-flash', settings.damageFlash);
  checked('option-high-contrast', settings.highContrast);
  checked('option-reduced-motion', settings.reducedMotion);
  output('option-fov-value', `${settings.fov}°`);
  output('option-sensitivity-value', `${Math.round((settings.sensitivity / 0.0023) * 100)}%`);
  output('option-render-scale-value', `${Math.round(settings.renderScale * 100)}%`);
  output('option-weapon-bob-value', `${Math.round(settings.weaponBob * 100)}%`);
  output('option-screen-shake-value', `${Math.round(settings.screenShake * 100)}%`);
  output('option-crosshair-scale-value', `${Math.round(settings.crosshairScale * 100)}%`);
  const volume = document.getElementById('option-volume');
  if (volume) {
    volume.disabled = !settings.soundEnabled;
    volume.closest('.option-row')?.classList.toggle('is-muted', !settings.soundEnabled);
  }
  const volumePercent = `${Math.round(settings.masterVolume * 100)}%`;
  output('option-volume-value', settings.soundEnabled ? volumePercent : `SILENCIADO · ${volumePercent}`);
  output('mute-shortcut-label', bindingLabel('muteSound'));
  output('settings-audio-state', settings.soundEnabled ? `ACTIVO · ${volumePercent}` : `SILENCIADO · ${volumePercent} GUARDADO`);

  const quickMute = document.getElementById('quick-mute');
  if (quickMute) {
    quickMute.classList.toggle('muted', !settings.soundEnabled);
    quickMute.setAttribute('aria-pressed', String(!settings.soundEnabled));
    quickMute.setAttribute('aria-label', settings.soundEnabled ? 'Silenciar juego' : 'Activar sonido del juego');
    output('quick-mute-icon', settings.soundEnabled ? '🔊' : '🔇');
    output('quick-mute-label', settings.soundEnabled ? 'AUDIO' : 'SILENCIADO');
  }
  const muteAction = document.getElementById('settings-mute-action');
  if (muteAction) {
    muteAction.textContent = settings.soundEnabled ? '🔇 SILENCIAR AHORA' : '🔊 ACTIVAR SONIDO';
    muteAction.classList.toggle('muted', !settings.soundEnabled);
  }
  const setDisabled = (id, disabled) => {
    const control = document.getElementById(id);
    if (!control) return;
    control.disabled = disabled;
    control.closest('.option-row')?.classList.toggle('is-disabled', disabled);
  };
  setDisabled('option-weapon-bob', settings.reducedMotion);
  setDisabled('option-screen-shake', settings.reducedMotion);
  setDisabled('option-shadow-quality', !settings.shadowsEnabled);
  setDisabled('option-crosshair-scale', !settings.crosshairVisible);
  setDisabled('option-crosshair-color', !settings.crosshairVisible);
  if (settings.reducedMotion) {
    output('option-weapon-bob-value', `ANULADO · ${Math.round(settings.weaponBob * 100)}%`);
    output('option-screen-shake-value', `ANULADO · ${Math.round(settings.screenShake * 100)}%`);
  }
  if (!settings.crosshairVisible) {
    output('option-crosshair-scale-value', `OCULTA · ${Math.round(settings.crosshairScale * 100)}%`);
  }
  renderBindings();
  renderFullscreenState();
  setSettingsTab(activeSettingsTab);
}

function commitSettings(message = 'Cambios guardados automáticamente.', announce = true) {
  applySettings();
  const settingsSaved = saveSettings();
  const bindingsSaved = saveBindings();
  renderSettings();
  if (announce && (!settingsSaved || !bindingsSaved)) {
    setSettingsStatus('Cambios aplicados solo durante esta sesión: el navegador bloqueó el guardado.', 'warning');
  } else if (announce && message) {
    setSettingsStatus(message);
  }
  return settingsSaved && bindingsSaved;
}

function toggleSound() {
  settings.soundEnabled = !settings.soundEnabled;
  commitSettings(settings.soundEnabled ? 'Sonido activado.' : 'Juego silenciado. Tu volumen queda guardado.');
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    setSettingsStatus('El navegador no permitió cambiar a pantalla completa.', 'warning');
  }
  renderFullscreenState();
}

function bindSettings() {
  const numberInput = (id, property) => {
    const control = document.getElementById(id);
    control?.addEventListener('input', (event) => {
      settings[property] = Number(event.currentTarget.value);
      commitSettings(null, false);
    });
    control?.addEventListener('change', () => commitSettings());
  };
  const toggleInput = (id, property) => document.getElementById(id)?.addEventListener('change', (event) => {
    settings[property] = event.currentTarget.checked;
    commitSettings();
  });
  const selectInput = (id, property) => document.getElementById(id)?.addEventListener('change', (event) => {
    settings[property] = event.currentTarget.value;
    commitSettings();
  });

  numberInput('option-fov', 'fov');
  numberInput('option-sensitivity', 'sensitivity');
  numberInput('option-volume', 'masterVolume');
  numberInput('option-render-scale', 'renderScale');
  numberInput('option-weapon-bob', 'weaponBob');
  numberInput('option-screen-shake', 'screenShake');
  numberInput('option-crosshair-scale', 'crosshairScale');
  toggleInput('option-sound-enabled', 'soundEnabled');
  toggleInput('option-shadows', 'shadowsEnabled');
  toggleInput('option-invert', 'invertY');
  toggleInput('option-show-fps', 'showFps');
  toggleInput('option-show-ping', 'showPing');
  toggleInput('option-bunny-hop', 'bunnyHopEnabled');
  toggleInput('option-crosshair-visible', 'crosshairVisible');
  toggleInput('option-damage-flash', 'damageFlash');
  toggleInput('option-high-contrast', 'highContrast');
  toggleInput('option-reduced-motion', 'reducedMotion');
  selectInput('option-aim-mode', 'aimMode');
  selectInput('option-crosshair-color', 'crosshairColor');
  selectInput('option-shadow-quality', 'shadowQuality');
  selectInput('option-effects-quality', 'effectsQuality');

  document.getElementById('quick-mute')?.addEventListener('click', toggleSound);
  document.getElementById('settings-mute-action')?.addEventListener('click', toggleSound);
  document.querySelectorAll('[data-fullscreen-action]').forEach((button) => {
    button.addEventListener('click', toggleFullscreen);
  });
  document.addEventListener('fullscreenchange', renderFullscreenState);

  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
    button.addEventListener('keydown', (event) => {
      const tabs = [...document.querySelectorAll('[data-settings-tab]')];
      const current = tabs.indexOf(button);
      let next = current;
      if (event.code === 'ArrowRight' || event.code === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (event.code === 'ArrowLeft' || event.code === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.code === 'Home') next = 0;
      else if (event.code === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      setSettingsTab(tabs[next].dataset.settingsTab, true);
    });
  });

  document.getElementById('keybinding-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-binding-action]');
    if (!button) return;
    bindingCaptureAction = button.dataset.bindingAction;
    setSettingsStatus('Pulsa una tecla. ESC cancela; las teclas ocupadas se intercambian.', 'listening');
    renderBindings();
    document.querySelector(`[data-binding-action="${bindingCaptureAction}"]`)?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (!bindingCaptureAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'Escape') {
      const cancelledAction = bindingCaptureAction;
      bindingCaptureAction = null;
      setSettingsStatus('Asignación cancelada.', 'warning');
      renderBindings();
      document.querySelector(`[data-binding-action="${cancelledAction}"]`)?.focus();
      return;
    }
    const modifierOnly = /^(?:Control|Alt|Shift)/.test(event.code);
    if (!modifierOnly && (event.ctrlKey || event.altKey || event.metaKey)) {
      setSettingsStatus('No se permiten combinaciones del navegador. Pulsa una sola tecla.', 'warning');
      return;
    }
    const action = bindingCaptureAction;
    const result = assignBinding(bindings, action, event.code);
    if (result.error) {
      const message = result.error === 'occupied-key'
        ? 'Para mover el marcador desde TAB, elige primero una tecla que esté libre.'
        : result.error === 'tab-reserved'
          ? 'TAB se reserva para la navegación o el marcador. Elige otra tecla.'
          : 'Esa tecla está reservada. Elige otra o pulsa ESC.';
      setSettingsStatus(message, 'warning');
      return;
    }
    bindings = result.bindings;
    bindingCaptureAction = null;
    const conflictLabel = result.conflict
      ? BINDING_ACTIONS.find((item) => item.action === result.conflict)?.label
      : '';
    commitSettings(conflictLabel
      ? `Tecla asignada; se intercambió con «${conflictLabel}».`
      : 'Tecla asignada y guardada.');
    document.querySelector(`[data-binding-action="${action}"]`)?.focus();
  }, true);

  document.getElementById('reset-bindings')?.addEventListener('click', () => {
    if (!window.confirm('¿Restaurar las 22 teclas predeterminadas?')) return;
    bindings = readBindings(null);
    bindingCaptureAction = null;
    commitSettings('Controles restaurados.');
  });
  document.getElementById('reset-settings')?.addEventListener('click', () => {
    if (!window.confirm('¿Restaurar audio, video, controles, jugabilidad y accesibilidad?')) return;
    settings = readSettings(null);
    bindings = readBindings(null);
    bindingCaptureAction = null;
    activeSettingsTab = 'audio';
    commitSettings('Toda la configuración fue restaurada.');
  });
  renderSettings();
}

function renderLoadoutPanel() {
  const meta = loadoutMetadata(weapons, skin, grenades.count);
  const weapon = WEAPON_DEFS[meta.weapon];
  const hat = HATS[meta.hat];
  refreshOperatorPreview();
  document.getElementById('loadout-weapon').textContent = weapon.name;
  document.getElementById('loadout-weapon-detail').textContent = `${weapon.name} · ${weapon.mag}/${weapon.reserve}`;
  document.getElementById('loadout-grenades').textContent = `${meta.grenades} disponibles`;
  document.getElementById('loadout-hat').textContent = hat ? hat.name : 'Sin sombrero';
  document.getElementById('loadout-color').textContent = meta.color ? `#${meta.color.toString(16).padStart(6, '0')}` : 'Predeterminado';
  const previewWeapon = document.getElementById('operator-preview-weapon');
  if (previewWeapon) previewWeapon.textContent = `${weapon.name} · ${weapon.kind.toUpperCase()}`;
  const quickWeapon = document.getElementById('menu-quick-weapon');
  const quickDetail = document.getElementById('menu-quick-detail');
  const playerLabel = document.getElementById('menu-player-label');
  if (quickWeapon) quickWeapon.textContent = weapon.name;
  if (quickDetail) quickDetail.textContent = `${weapon.mag} / ${weapon.reserve} · ${meta.grenades} granadas`;
  if (playerLabel) playerLabel.textContent = nameInput ? (nameInput.value || 'INVITADO').toUpperCase() : 'INVITADO';
  document.getElementById('loadout-owned').textContent = `Armas desbloqueadas: ${meta.ownedWeapons.map((key) => WEAPON_DEFS[key].name).join(' · ')}`;
}

// --- misiones diarias ---
const missions = new Missions((amount, txt) => {
  weapons.addMoney(amount);
  hud.announce(`✅ Misión cumplida: ${txt} (+$${amount})`);
  audio.buy();
  renderMenuPanels();
});

let menuArsenalFilter = 'all';

function renderMenuArsenal() {
  const grid = document.getElementById('menu-arsenal-grid');
  const money = document.getElementById('menu-arsenal-money');
  if (!grid || !money) return;
  money.textContent = `$ ${weapons.money}`;
  grid.textContent = '';
  document.querySelectorAll('[data-menu-arsenal-filter]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.menuArsenalFilter === menuArsenalFilter));
  });
  const categories = {
    pistols: new Set(['pistol', 'revolver']),
    primary: new Set(['shotgun', 'smg', 'ar', 'sniper']),
    special: new Set(['launcher']),
  };
  weapons.slots.forEach((key, i) => {
    if (menuArsenalFilter !== 'all' && !categories[menuArsenalFilter]?.has(key)) return;
    const def = WEAPON_DEFS[key];
    const owned = !!weapons.owned[key];
    const equipped = key === weapons.current;
    const affordable = weapons.money >= def.price;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `menu-weapon-card${equipped ? ' equipped' : ''}${!owned && !affordable ? ' locked' : ''}`;
    card.dataset.kind = def.kind;
    card.disabled = !owned && !affordable;
    const action = equipped ? 'EQUIPADA' : owned ? 'EQUIPAR' : affordable ? `COMPRAR $${def.price}` : `FALTAN $${def.price - weapons.money}`;
    const damage = def.launcher ? 100 : Math.min(100, Math.round((def.damage / 105) * 100));
    const cadence = Math.min(100, Math.round((def.rpm / 950) * 100));
    const control = Math.min(100, Math.round((1 - Math.min(0.07, def.recoil) / 0.07) * 100));
    card.setAttribute('aria-label', `${def.name}. ${action}. Cargador ${def.mag}, reserva ${def.reserve}.`);
    card.innerHTML = `<span class="weapon-index">[${bindingLabel(`slot${i + 1}`)}] ${def.kind.toUpperCase()}</span><span class="weapon-icon" aria-hidden="true"></span><span class="weapon-name">${def.name}</span><span class="weapon-info">Cargador ${def.mag} · Reserva ${def.reserve}</span><span class="weapon-stats" aria-hidden="true"><span class="weapon-stat">DAÑO <i style="--stat:${damage}%"></i></span><span class="weapon-stat">CADENCIA <i style="--stat:${cadence}%"></i></span><span class="weapon-stat">CONTROL <i style="--stat:${control}%"></i></span></span><span class="weapon-action">${action}</span>`;
    card.addEventListener('click', () => {
      if (owned) weapons.switchTo(key);
      else if (affordable) weapons.tryBuy(key);
      renderMenuArsenal();
      renderLoadoutPanel();
    });
    grid.append(card);
  });
}

function showMenuScreen(screen) {
  const valid = ['play', 'arsenal', 'operator', 'options'];
  const active = valid.includes(screen) ? screen : 'play';
  cancelBindingCapture('Asignación cancelada al cambiar de sección.');
  for (const id of valid) {
    const panel = document.getElementById(`menu-screen-${id}`);
    if (panel) panel.classList.toggle('active', id === active);
  }
  const states = menuNavState(active);
  document.querySelectorAll('.menu-nav-btn').forEach((button) => {
    const stateForButton = states.find((item) => item.id === button.dataset.menuScreen);
    button.classList.toggle('active', !!stateForButton?.active);
    if (stateForButton?.active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (active === 'arsenal') renderMenuArsenal();
  if (active === 'operator') {
    initOperatorPreview();
    renderMenuPanels();
  }
  if (active === 'options') renderSettings();
}

function renderMenuPanels() {
  renderLoadoutPanel();
  renderRoomSummary();
  // sombreros
  const hatList = document.getElementById('hat-list');
  hatList.textContent = '';
  for (const [id, def] of Object.entries(HATS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hat-btn';
    const owned = skin.ownedHats.includes(id);
    if (skin.hat === id) btn.classList.add('equipped');
    if (!owned) btn.classList.add('locked');
    btn.textContent = owned ? def.name : `${def.name} $${def.price}`;
    btn.setAttribute('aria-pressed', String(skin.hat === id));
    btn.setAttribute('aria-label', `${def.name}. ${skin.hat === id ? 'Equipado' : owned ? 'Disponible' : `Bloqueado, cuesta $${def.price}`}.`);
    btn.onclick = () => {
      if (!owned) {
        if (weapons.money < def.price) {
          menuMsg = `Te faltan $${def.price - weapons.money} para la ${def.name}`;
          renderMenuPanels();
          return;
        }
        weapons.money -= def.price;
        saveArsenalEconomy();
        skin.ownedHats.push(id);
        audio.ensure(); audio.buy();
      }
      skin.hat = id;
      saveSkin();
      menuMsg = `${def.name} equipada`;
      if (net.connected) net.sendSkin(skin.hat, skin.color);
      hud.updateMoney(weapons.money);
      renderMenuPanels();
    };
    hatList.append(btn);
  }
  // colores
  document.getElementById('colors-price').textContent =
    skin.colorsUnlocked ? '' : `($${COLORS_PRICE} desbloquea todos)`;
  const colorList = document.getElementById('color-list');
  colorList.textContent = '';
  for (const c of SKIN_COLORS) {
    const btn = document.createElement('button');
    const colorHex = c.toString(16).padStart(6, '0').toUpperCase();
    btn.type = 'button';
    btn.className = 'color-btn';
    btn.style.background = `#${colorHex}`;
    if (skin.color === c) btn.classList.add('equipped');
    if (!skin.colorsUnlocked) btn.classList.add('locked');
    btn.setAttribute('aria-pressed', String(skin.color === c));
    btn.setAttribute('aria-label', `Color #${colorHex}. ${skin.color === c ? 'Equipado' : skin.colorsUnlocked ? 'Disponible' : `Bloqueado, desbloquear colores cuesta $${COLORS_PRICE}`}.`);
    btn.onclick = () => {
      if (!skin.colorsUnlocked) {
        if (weapons.money < COLORS_PRICE) {
          menuMsg = `Te faltan $${COLORS_PRICE - weapons.money} para desbloquear colores`;
          renderMenuPanels();
          return;
        }
        weapons.money -= COLORS_PRICE;
        saveArsenalEconomy();
        skin.colorsUnlocked = true;
        audio.ensure(); audio.buy();
      }
      skin.color = c;
      saveSkin();
      menuMsg = 'Color equipado';
      if (net.connected) net.sendSkin(skin.hat, skin.color);
      hud.updateMoney(weapons.money);
      renderMenuPanels();
    };
    colorList.append(btn);
  }
  // misiones
  const list = document.getElementById('mission-list');
  list.textContent = '';
  for (const m of missions.status()) {
    const div = document.createElement('div');
    div.className = m.done ? 'done' : '';
    div.textContent = `${m.done ? '✅' : '⬜'} ${m.txt} — ${m.prog}/${m.goal}`;
    list.append(div);
  }
  document.getElementById('menu-money').textContent =
    `💰 Tu dinero: $${weapons.money}` + (menuMsg ? ` · ${menuMsg}` : '');
}

function setTeamPicker(open) {
  if (open) setChat(false);
  teamPickerOpen = open;
  hud.showTeamPicker(open);
  refreshWeaponInputBlock();
}

// --- economía y rachas: se activan con cada baja mía ---
let streak = 0;
let lastKnifeHitAt = -9999;
let lastNadeHitAt = -9999;

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
  // misiones
  missions.event('kill');
  if (isHead) missions.event('headshot');
  if (streak === 5) missions.event('streak5');
  const nowMs = performance.now();
  if (nowMs - lastKnifeHitAt < 600) missions.event('knifekill');
  if (nowMs - lastNadeHitAt < 600) missions.event('nadekill');
}

function resetStreak() { streak = 0; }

// lanzar granada con la tecla configurada
addEventListener('keydown', (e) => {
  if (!isAction(e, 'grenade') || e.repeat || !document.pointerLockElement) return;
  if (state !== 'playing' || player.dead || weapons.inputBlocked) return;
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
        audio.hit(dmg >= 100);
        lastKnifeHitAt = performance.now();
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
      audio.hit(dmg >= 100);
      if (killed) {
        missions.event('knifekill');
        if (offlineBotKilled) offlineBotKilled(bot, false);
      }
      return;
    }
  }
}

let remotes = null;      // modo online
let botsLocal = null;    // modo offline
let online = false;
let serverAvailable = false;
let joined = false;
let lastSnap = null;
let kills = 0, deaths = 0;
let state = 'menu'; // menu | playing | dead

const playerEye = new THREE.Vector3();
const remoteAudioForward = new THREE.Vector3();

// --- interfaz del menú ---
const playBtn = document.getElementById('play-btn');
const nameInput = document.getElementById('name-input');

nameInput.value = safeStorageGet('pium_name') || '';
document.querySelectorAll('[data-menu-screen]').forEach((button) => {
  button.addEventListener('click', () => showMenuScreen(button.dataset.menuScreen));
});
document.querySelectorAll('[data-menu-arsenal-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    menuArsenalFilter = button.dataset.menuArsenalFilter || 'all';
    renderMenuArsenal();
  });
});
nameInput.addEventListener('input', () => {
  const label = document.getElementById('menu-player-label');
  if (label) label.textContent = (nameInput.value || 'INVITADO').toUpperCase();
});
bindSettings();
applySettings();

// sondeo rápido: ¿hay servidor?
fetch('/salud').then((r) => {
  serverAvailable = r.ok;
  if (r.ok) hud.setNetStatus('🟢 Servidor online — pon tu nombre y JUGAR', true);
  else hud.setNetStatus('🔴 Sin servidor — jugarás contra bots locales', false);
  renderRoomSummary();
}).catch(() => {
  serverAvailable = false;
  hud.setNetStatus('🔴 Sin servidor — jugarás contra bots locales', false);
  renderRoomSummary();
});

// --- cableado modo OFFLINE (bots locales) ---
function localBotStatus(count) {
  return `🔴 Modo local — tú contra ${count} bot${count === 1 ? '' : 's'}`;
}

function setupOffline() {
  online = false;
  botsLocal = new BotManager(scene, world, player, effects, audio, 5);
  receiveBotConfig({
    enabled: true,
    count: botsLocal.bots.length,
    actual: botsLocal.bots.length,
    max: MAX_BOTS,
    humans: 1,
    slots: TOTAL_SLOTS,
    locked: false,
  }, true);
  botsLocal.ctx.onKill = (killer, victim) => hud.killfeed(killer, victim, false);
  botsLocal.ctx.onBotDeath = (bot) => {
    kitsMgr.spawnLocal(bot.pos);
    kitsMgr.spawnAmmoLocal(bot.pos.clone ? bot.pos.clone().add(new THREE.Vector3(.55, 0, 0)) : {
      x: bot.pos.x + .55, y: bot.pos.y, z: bot.pos.z,
    });
  };
  weapons.getTargets = () => [...world.occluders, ...botsLocal.getHitMeshes()];

  const localBotKilled = (bot, isHead) => {
    kills++;
    kitsMgr.spawnLocal(bot.pos);
    kitsMgr.spawnAmmoLocal(bot.pos.clone().add(new THREE.Vector3(.55, 0, 0)));
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
    effects.impact(point, 0xcc4444, 4, 'flesh');
    hud.hitmarker(killed);
    audio.hit(isHead);
    if (killed) localBotKilled(data.bot, isHead);
  };
  weapons.onShot = (a, b, kind) => {
    const shot = shotTracerState(kind);
    if (shot.visible) effects.tracer(a, b, shot.color);
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
      if (killed) {
        missions.event('nadekill');
        localBotKilled(bot, false);
      }
    }
    const dSelf = Math.hypot(player.pos.x - pos.x, player.pos.y + 1 - pos.y, player.pos.z - pos.z);
    const dmgSelf = Math.round(explosionDamage(dSelf) / 2);
    if (dmgSelf > 0) player.damage(dmgSelf, 'tu propia granada');
  };
  offlineBotKilled = localBotKilled;
  hud.setMatchBanner('🔴 MODO LOCAL · partida libre');

  player.onDeath = (killerName) => {
    if (botPanelOpen) setBotPanel(false, false);
    if (buyOpen) setBuyMenu(false, false);
    weapons.clearInput();
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
      player.spawn(safePlayerSpawn(null, botsLocal?.bots || []));
      weapons.refill();
      grenades.refill();
      hud.updateHealth(player.health, player.maxHealth);
      state = document.pointerLockElement ? 'playing' : 'menu';
      if (state === 'menu') hud.showMenu(true);
    }, 2600);
  };
  hud.setNetStatus(localBotStatus(botsLocal.bots.length), false);
  renderRoomSummary();
}

// --- cableado modo ONLINE ---
function setupOnline() {
  online = true;
  serverAvailable = true;
  player.netMode = true;
  remotes = new Remotes(scene);

  weapons.getTargets = () => [...world.occluders, ...remotes.getHitMeshes()];
  weapons.onTargetHit = (data, dmg, isHead, point) => {
    if (!data.net) return;
    effects.popup(point, String(dmg), isHead);
    effects.impact(point, 0xcc4444, 4, 'flesh');
    hud.hitmarker(false);
    audio.hit(isHead);
    net.sendHit(data.net.kind, data.net.id, dmg, isHead, weapons.def.kind);
  };
  weapons.onShot = (a, b, kind) => {
    const shot = shotTracerState(kind);
    if (shot.visible) effects.tracer(a, b, shot.color);
    net.sendFire(a, b, kind);
  };

  net.on('snap', (m) => {
    lastSnap = m;
    if (m.m?.map) loadWorldMap(m.m.map);
    if (m.dc) {
      const rotas = new Set(m.dc);
      for (const id of world.crates.keys()) syncOnlineCrate(id, !rotas.has(id));
    }
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
      if (m.m.bc) receiveBotConfig(m.m.bc);
      hud.setMatchBanner(bannerText(matchInfo));
    }
    hud.setNetStatus(`🟢 ONLINE — ${m.pl.length}/${net.slots} jugadores · ${m.bots.length} bots`, true);
  });

  net.on('match', (m) => {
    matchInfo = m;
    if (m.bc) receiveBotConfig(m.bc);
    if (m.map) loadWorldMap(m.map);
    if (m.st === 'playing') {
      const returningFromPodium = podiumOpen;
      if (botPanelOpen && m.mode === 'teams') setBotPanel(false, false);
      podiumOpen = false;
      podiumStage = 'mode';
      hud.hidePodium();
      clearInterval(podiumTimer);
      resetStreak();
      myGunIdx = 0;
      weapons.setForced(m.mode === 'gun' ? WEAPON_ORDER[0] : null);
      if (m.mode === 'teams') setTeamPicker(true);
      else setTeamPicker(false);
      if (returningFromPodium && !document.pointerLockElement) {
        hud.info(m.mode === 'teams'
          ? 'Elige equipo y haz clic en la arena para continuar'
          : 'Haz clic en la arena para retomar el control');
      }
    }
    hud.setMatchBanner(bannerText(matchInfo));
  });

  net.on('podium', (m) => {
    if (botPanelOpen) setBotPanel(false, false);
    if (buyOpen) setBuyMenu(false, false);
    setChat(false);
    setTeamPicker(false);
    podiumOpen = true;
    podiumStage = m.stage || 'mode';
    refreshWeaponInputBlock();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showPodium(m);
    hud.setPodiumStage(podiumStage, m.secs || 15);
    if (m.winner === net.name) missions.event('win');
    audio.streak(4); // fanfarria de fin de partida
    startPodiumCountdown(m.secs || 15);
  });

  net.on('podiumStage', (m) => {
    if (!podiumOpen) return;
    podiumStage = m.stage || 'mode';
    hud.setPodiumStage(podiumStage, m.secs || 15);
    startPodiumCountdown(m.secs || 15);
  });

  document.getElementById('podium').onclick = (event) => {
    const button = event.target.closest('.vote-option');
    if (!button || !podiumOpen) return;
    if (button.dataset.voteType !== podiumStage) return;
    const group = button.parentElement;
    group.querySelectorAll('.vote-option').forEach((option) => option.classList.remove('selected'));
    button.classList.add('selected');
    if (podiumStage === 'mode') net.sendVote(button.dataset.vote);
    if (podiumStage === 'map') net.sendMapVote(button.dataset.vote);
  };

  net.on('votes', (m) => hud.setPodiumVotes(
    podiumStage === 'mode' ? (m.tally || {}) : {},
    podiumStage === 'map' ? (m.mapTally || {}) : {},
  ));

  net.on('chat', (m) => {
    if (QUICK_CHAT[m.i] !== undefined) {
      hud.info(`💬 ${m.n}: ${QUICK_CHAT[m.i]}`);
      audio.chat();
    }
  });

  net.on('pong', (m) => hud.setPing(Date.now() - m.ts));
  net.on('ammo', (m) => onAmmoPicked(m.a || 20));
  net.on('botcfg', (m) => {
    const acknowledged = isBotConfigAcknowledgement(m, pendingBotRequestId);
    if (acknowledged) {
      const messages = {
        zombies: 'No se puede cambiar la cantidad durante una oleada de Zombis.',
        rate: 'Espera un instante antes de volver a aplicar cambios.',
        invalid: 'El servidor rechazó una cantidad no válida.',
      };
      pendingBotRequestId = null;
      botPanelStatus = messages[m.reason] || 'Configuración sincronizada con la sala.';
    } else if (!botDraftDirty) {
      botPanelStatus = 'Configuración sincronizada con la sala.';
    }
    receiveBotConfig(m, acknowledged);
  });
  setInterval(() => { if (net.connected) net.sendPing(); }, 3000);

  net.on('cbox', (m) => {
    const pos = syncOnlineCrate(m.id, !!m.al);
    if (pos && !m.al) {
      effects.impact(pos, 0xc09858, 14);
      audio.boom(0.3);
    }
  });

  net.on('gun', (m) => {
    myGunIdx = m.gi || 0;
    weapons.setForced(WEAPON_ORDER[myGunIdx]);
    hud.announce(`🔫 Arma ${myGunIdx + 1}/5 — ¡sigue así!`);
  });

  net.on('fire', (m) => {
    if (!isFiniteVectorPayload(m.a) || !isFiniteVectorPayload(m.b)) return;
    const a = new THREE.Vector3(m.a[0], m.a[1], m.a[2]);
    const b = new THREE.Vector3(m.b[0], m.b[1], m.b[2]);
    effects.muzzle(a, m.k);
    const shot = shotTracerState(m.k);
    if (shot.visible) effects.tracer(a, b, shot.color);
    else effects.trail(a, b, shot.color);
    if (m.bid != null) remotes?.triggerShot('bot', m.bid);
    else if (m.id != null) remotes?.triggerShot('pl', m.id);
    player.eyePosition(playerEye);
    camera.getWorldDirection(remoteAudioForward);
    audio.shotAt(m.k, a, playerEye, remoteAudioForward, 0.7);
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
      if (botPanelOpen) setBotPanel(false, false);
      if (buyOpen) setBuyMenu(false, false);
      weapons.clearInput();
      resetStreak();
      player.dead = true;
      player.health = 0;
      hud.showDeath(true, m.kn);
      state = 'dead';
    }
  });

  // granadas de otros jugadores (visuales, explotan en su sitio)
  net.on('nade', (m) => grenades.spawnRemote(m.p, m.v, !!m.im));
  grenades.onThrow = (pos, vel, impact) => net.sendNade(pos, vel, impact);

  // explosión de granada propia: daño a entidades remotas vía servidor
  grenades.onExplode = (pos) => {
    const aplicar = (ent, kind) => {
      if (!ent.alive) return;
      const ep = ent.rig.group.position;
      const d = Math.hypot(ep.x - pos.x, ep.y + 1 - pos.y, ep.z - pos.z);
      const dmg = explosionDamage(d);
      if (dmg <= 0) return;
      effects.popup(ep.clone().add(new THREE.Vector3(0, 1.4, 0)), String(dmg), false);
      lastNadeHitAt = performance.now();
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
    if (m.map) loadWorldMap(m.map);
    net.acceptSpawn(m.sid);
    player.spawn(safePlayerSpawn(new THREE.Vector3(m.p[0], m.p[1], m.p[2])));
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
    clearOnlineCrateRestores();
    pendingBotRequestId = null;
    if (botPanelOpen) setBotPanel(false, false);
    hud.setNetStatus('🔴 Conexión perdida — recarga la página', false);
    hud.info('⚠ Conexión perdida');
    renderRoomSummary();
  });

  renderRoomSummary();
}

// --- entrar al juego ---
let connecting = false;

async function joinAndPlay() {
  cancelBindingCapture('Asignación cancelada al iniciar la partida.');
  audio.ensure();
  if (joined || botsLocal) { tryLock(); return; }
  if (connecting) return;
  connecting = true;
  // La activación del usuario puede caducar mientras espera la conexión.
  // Pedir el pointer lock antes del await permite entrar con un solo clic.
  tryLock();
  playBtn.textContent = 'CONECTANDO...';
  const name = nameInput.value.trim();
  if (name) safeStorageSet('pium_name', name);
  try {
    const hi = await net.connect(name, { h: skin.hat, c: skin.color });
    setupOnline();
    joined = true;
    if (hi.bc) receiveBotConfig(hi.bc, true);
    nameInput.value = net.name;
    nameInput.disabled = true;
    if (hi.map) loadWorldMap(hi.map);
    player.spawn(safePlayerSpawn(new THREE.Vector3(hi.spawn[0], hi.spawn[1], hi.spawn[2])));
  } catch (error) {
    setupOffline();
    player.spawn(safePlayerSpawn(null, botsLocal?.bots || []));
    if (error?.code === 'ROOM_FULL') hud.info('Sala online llena · modo local activado');
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
  if (p && p.catch) {
    p.catch(() => {
      const fallback = renderer.domElement.requestPointerLock();
      if (fallback && fallback.catch) fallback.catch(() => {});
    });
  }
}

playBtn.addEventListener('click', joinAndPlay);
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing' && !document.pointerLockElement && !player.dead &&
      !buyOpen && !botPanelOpen && !podiumOpen && !teamPickerOpen) tryLock();
});
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
    if (buyOpen || botPanelOpen || podiumOpen || teamPickerOpen) return;
    if (state === 'playing') {
      state = 'menu';
      hud.showMenu(true);
      showMenuScreen('play');
      hud.setMenuStats(kills, deaths);
      hud.setScope(false);
      hud.showScores(false);
      setChat(false);
      setBuyMenu(false);
      renderMenuPanels();
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
  if (isAction(e, 'scoreboard') && !e.repeat && document.pointerLockElement && !weapons.inputBlocked) {
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
  if (isAction(e, 'scoreboard')) hud.showScores(false);
});

// teclas de modo: V cuchillo, M equipo, C chat, B compra, H bots, 1-6 en overlays
let chatOpen = false;
let buyOpen = false;
let botPanelOpen = false;
let buyCategory = 'all';
let buyMenuReturnFocus = null;
let botControl = botPanelState({
  enabled: true,
  count: MAX_BOTS,
  actual: 0,
  max: MAX_BOTS,
  humans: 0,
  slots: TOTAL_SLOTS,
  locked: false,
});
let botDraftDirty = false;
let botPanelStatus = 'Ajusta la configuración y pulsa APLICAR.';
let botRequestSerial = 0;
let pendingBotRequestId = null;
let botPanelReturnFocus = null;

function renderRoomSummary() {
  const title = document.getElementById('menu-room-state');
  const detail = document.getElementById('menu-room-detail');
  const status = document.getElementById('menu-room-status');
  const modes = { ffa: 'TODOS CONTRA TODOS', teams: 'EQUIPOS', gun: 'BÚSQUEDA DEL ARMA', zombies: 'ZOMBIS' };
  if (title) title.textContent = modes[matchInfo.mode] || 'LISTA PARA COMBATIR';
  if (detail) {
    detail.textContent = botControl.locked
      ? 'Las oleadas controlan automáticamente a sus enemigos.'
      : botControl.enabled
        ? `${botControl.actual} bot${botControl.actual === 1 ? '' : 's'} activo${botControl.actual === 1 ? '' : 's'} · objetivo configurado: ${botControl.count}.`
        : 'Bots desactivados para la sala actual.';
  }
  if (status) {
    status.textContent = net.connected
      ? 'SERVIDOR ONLINE'
      : serverAvailable
        ? 'SERVIDOR DISPONIBLE'
        : 'ENTRENAMIENTO LOCAL';
  }
}

function refreshWeaponInputBlock() {
  const blocked = chatOpen || buyOpen || botPanelOpen || podiumOpen || teamPickerOpen;
  if (blocked && !weapons.inputBlocked) weapons.clearInput();
  weapons.inputBlocked = blocked;
}

function isFiniteVectorPayload(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every((component) => Number.isFinite(component) && Math.abs(component) <= 10000);
}

function setChat(open) {
  if (open) setTeamPicker(false);
  chatOpen = open;
  hud.showChatMenu(open, QUICK_CHAT);
  refreshWeaponInputBlock();
}

function receiveBotConfig(raw, acknowledged = false) {
  const hasExplicitLock = raw && (raw.locked === true || raw.locked === false || raw.locked === 1 || raw.locked === 0);
  const mode = hasExplicitLock ? (raw.locked === true || raw.locked === 1 ? 'zombies' : 'ffa') : matchInfo.mode;
  botControl = botPanelState(raw, mode);
  if (acknowledged) botDraftDirty = false;
  renderRoomSummary();
  if (botPanelOpen) renderBotPanel(acknowledged || !botDraftDirty);
}

function renderBotPanel(syncControls = true) {
  const panel = document.getElementById('bot-panel');
  if (!panel) return;
  const enabled = document.getElementById('bot-enabled');
  const count = document.getElementById('bot-count');
  const minus = document.getElementById('bot-minus');
  const plus = document.getElementById('bot-plus');
  const apply = document.getElementById('bot-apply');
  const capacity = Math.max(0, botControl.slots - botControl.humans);
  const controlsDisabled = botControl.locked || pendingBotRequestId !== null;

  panel.dataset.locked = botControl.locked ? 'true' : 'false';
  panel.dataset.pending = pendingBotRequestId !== null ? 'true' : 'false';
  document.getElementById('bot-active').textContent = String(botControl.actual);
  document.getElementById('bot-humans').textContent = String(botControl.humans);
  document.getElementById('bot-slots').textContent = String(botControl.slots);
  document.getElementById('bot-panel-status').textContent = botPanelStatus;
  document.getElementById('bot-panel-note').textContent = botControl.locked
    ? botControl.note
    : `${botControl.note}${botControl.enabled && botControl.actual < botControl.count
      ? ` Hay ${capacity} plazas disponibles; se conserva la cantidad deseada.`
      : ''}`;

  count.max = String(botControl.max);
  if (syncControls) {
    enabled.checked = botControl.enabled;
    count.value = String(botControl.count);
  }
  for (const control of [enabled, count, minus, plus, apply]) control.disabled = controlsDisabled;
}

function markBotDraft() {
  botDraftDirty = true;
  botPanelStatus = 'Cambios sin aplicar.';
  renderBotPanel(false);
}

function draftBotCount() {
  const input = document.getElementById('bot-count');
  const raw = Number(input.value);
  const value = Number.isFinite(raw) ? Math.round(raw) : botControl.count;
  return Math.min(botControl.max, Math.max(0, value));
}

function adjustBotCount(delta) {
  const input = document.getElementById('bot-count');
  input.value = String(Math.min(botControl.max, Math.max(0, draftBotCount() + delta)));
  markBotDraft();
}

function setBotBackgroundInert(inert) {
  for (const id of ['app', 'hud', 'menu', 'buy-menu', 'death']) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (inert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }
}

function trapBotPanelFocus(event) {
  const focusable = [...document.querySelectorAll(
    '#bot-panel button:not(:disabled), #bot-panel input:not(:disabled)',
  )].filter((element) => element.offsetParent !== null);
  if (focusable.length === 0) return;
  const current = focusable.indexOf(document.activeElement);
  const next = event.shiftKey
    ? (current <= 0 ? focusable.length - 1 : current - 1)
    : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
  event.preventDefault();
  focusable[next].focus();
}

function applyBotDraft() {
  if (botControl.locked) return;
  const count = draftBotCount();
  const enabledInput = document.getElementById('bot-enabled');
  const enabled = enabledInput.checked && count > 0;
  enabledInput.checked = enabled;
  document.getElementById('bot-count').value = String(count);
  botPanelStatus = online ? 'Aplicando cambios en la sala...' : 'Aplicando cambios en modo local...';

  if (online && net.connected) {
    botDraftDirty = true;
    pendingBotRequestId = ++botRequestSerial;
    renderBotPanel(false);
    net.sendBotConfig(enabled, count, pendingBotRequestId);
    return;
  }
  renderBotPanel(false);
  if (botsLocal) {
    const actual = botsLocal.setCount(enabled ? count : 0);
    botPanelStatus = 'Configuración aplicada en modo local.';
    receiveBotConfig({
      enabled,
      count,
      actual,
      max: MAX_BOTS,
      humans: 1,
      slots: TOTAL_SLOTS,
      locked: false,
    }, true);
    hud.setNetStatus(localBotStatus(actual), false);
  }
}

function setBotPanel(open, restorePointer = true) {
  const canOpen = (state === 'playing' || state === 'menu') && !player.dead && (joined || !!botsLocal) &&
    !podiumOpen && !teamPickerOpen && !buyOpen;
  if (open && !canOpen) return;
  botPanelOpen = !!open;
  if (botPanelOpen) {
    botPanelReturnFocus = document.activeElement;
    setBotBackgroundInert(true);
    setChat(false);
    botDraftDirty = false;
    botPanelStatus = botControl.locked
      ? 'Control bloqueado durante el modo Zombis.'
      : 'Ajusta la configuración y pulsa APLICAR.';
    weapons.triggerDown = false;
    weapons.ads = false;
    hud.setScope(false);
    renderBotPanel(true);
  }
  hud.showBotPanel(botPanelOpen);
  refreshWeaponInputBlock();
  if (botPanelOpen) {
    if (document.pointerLockElement) document.exitPointerLock();
    requestAnimationFrame(() => {
      document.getElementById(botControl.locked ? 'bot-close' : 'bot-count')?.focus();
    });
  } else {
    setBotBackgroundInert(false);
    const returnFocus = botPanelReturnFocus;
    botPanelReturnFocus = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true });
    }
    if (restorePointer && state === 'playing' && !player.dead && !podiumOpen && !teamPickerOpen) tryLock();
  }
}

document.getElementById('bot-close')?.addEventListener('click', () => setBotPanel(false));
document.getElementById('bot-apply')?.addEventListener('click', applyBotDraft);
document.getElementById('bot-minus')?.addEventListener('click', () => adjustBotCount(-1));
document.getElementById('bot-plus')?.addEventListener('click', () => adjustBotCount(1));
document.getElementById('bot-enabled')?.addEventListener('change', markBotDraft);
document.getElementById('bot-count')?.addEventListener('input', markBotDraft);
document.getElementById('bot-count')?.addEventListener('keydown', (event) => {
  if (event.code === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    applyBotDraft();
  }
});
document.getElementById('bot-panel')?.addEventListener('click', (event) => {
  if (event.target.id === 'bot-panel') setBotPanel(false);
});

function renderBuyMenu() {
  const grid = document.getElementById('buy-grid');
  document.getElementById('buy-money').textContent = `$ ${weapons.money}`;
  const categoryStates = buyMenuCategoryState(buyCategory);
  document.querySelectorAll('[data-buy-category]').forEach((button) => {
    const stateForButton = categoryStates.find((item) => item.id === button.dataset.buyCategory);
    button.classList.toggle('active', !!stateForButton?.active);
  });
  grid.textContent = '';
  const visibleSlots = weapons.slots.filter((key) => {
    if (buyCategory === 'all') return true;
    const kind = WEAPON_DEFS[key].kind;
    if (buyCategory === 'pistols') return kind === 'pistol' || kind === 'revolver';
    if (buyCategory === 'smgs') return kind === 'smg' || kind === 'shotgun';
    if (buyCategory === 'rifles') return kind === 'ar' || kind === 'sniper' || kind === 'launcher';
    return true;
  });
  visibleSlots.forEach((key) => {
    const def = WEAPON_DEFS[key];
    const card = document.createElement('button');
    const owned = !!weapons.owned[key];
    const equipped = key === weapons.current;
    const affordable = weapons.money >= def.price;
    card.type = 'button';
    card.className = `buy-card${equipped ? ' equipped' : ''}${owned ? ' owned' : ''}${!owned && !affordable ? ' locked' : ''}`;
    card.dataset.weapon = key;
    const action = equipped ? 'EQUIPADA' : owned ? 'EQUIPAR' : affordable ? `COMPRAR $${def.price}` : `FALTAN $${def.price}`;
    const slot = WEAPON_ORDER.indexOf(key) + 1;
    card.innerHTML = `<span class="buy-key">[${bindingLabel(`slot${slot}`)}] ${def.kind.toUpperCase()}</span>` +
      `<span class="buy-weapon-icon ${def.kind}" aria-hidden="true"></span>` +
      `<span class="buy-name">${def.name}</span>` +
      `<span class="buy-info">Cargador ${def.mag} · Reserva ${def.reserve}</span>` +
      `<span class="buy-action">${action}</span>`;
    card.disabled = !owned && !affordable;
    card.addEventListener('click', () => {
      if (owned) weapons.switchTo(key);
      else if (affordable) weapons.tryBuy(key);
      renderBuyMenu();
    });
    grid.append(card);
  });
}

function setBuyMenu(open, restorePointer = true) {
  const nextOpen = !!open && state === 'playing' && !player.dead;
  if (nextOpen && !buyOpen) buyMenuReturnFocus = document.activeElement;
  buyOpen = nextOpen;
  if (buyOpen) renderBuyMenu();
  hud.showBuyMenu(buyOpen);
  setBuyBackgroundInert(buyOpen);
  refreshWeaponInputBlock();
  if (buyOpen) {
    if (document.pointerLockElement) document.exitPointerLock();
    requestAnimationFrame(() => document.getElementById('buy-close')?.focus());
  } else {
    const returnFocus = buyMenuReturnFocus;
    buyMenuReturnFocus = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true });
    }
    if (restorePointer && state === 'playing' && !player.dead) tryLock();
  }
}

function setBuyBackgroundInert(inert) {
  for (const id of ['app', 'hud', 'menu', 'death', 'bot-panel']) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (inert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }
}

function trapBuyMenuFocus(event) {
  const focusable = [...document.querySelectorAll(
    '#buy-menu button:not(:disabled), #buy-menu input:not(:disabled), #buy-menu select:not(:disabled), #buy-menu [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute('hidden'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.querySelectorAll('[data-buy-category]').forEach((button) => {
  button.addEventListener('click', () => {
    buyCategory = button.dataset.buyCategory;
    renderBuyMenu();
  });
});
document.getElementById('buy-close')?.addEventListener('click', () => setBuyMenu(false));

function handleMatchOverlaySlot(index) {
  if (podiumOpen && online) {
    if (podiumStage === 'mode' && index < 4) net.sendVote(MODES[index]);
    else if (podiumStage === 'map' && index >= 4) net.sendMapVote(index === 4 ? 'arena' : 'ciudad');
    else return false;
    return true;
  }
  if (teamPickerOpen) {
    if (index === 0) net.sendTeam('r');
    else if (index === 1) net.sendTeam('b');
    else if (index === 2) net.sendTeam(null);
    else return false;
    setTeamPicker(false);
    if (!document.pointerLockElement) hud.info('Haz clic en la arena para retomar el control');
    return true;
  }
  return false;
}

addEventListener('keydown', (e) => {
  const uiFocused = e.target instanceof HTMLElement &&
    (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(e.target.tagName));
  if (!uiFocused && isAction(e, 'muteSound') && !e.repeat) {
    e.preventDefault();
    toggleSound();
    return;
  }
  if (botPanelOpen) {
    if (e.code === 'Tab') {
      trapBotPanelFocus(e);
      return;
    }
    if ((e.code === 'Escape' || isAction(e, 'openBots')) && !e.repeat) {
      e.preventDefault();
      setBotPanel(false);
    }
    return;
  }
  if (buyOpen) {
    if (e.code === 'Tab') {
      trapBuyMenuFocus(e);
      return;
    }
    if (e.code === 'Escape' || (isAction(e, 'openArsenal') && !e.repeat)) {
      e.preventDefault();
      setBuyMenu(false);
      return;
    }
    const buyIndex = bindingSlotIndex(bindings, e.code);
    if (buyIndex >= 0 && !e.repeat) {
      const key = WEAPON_ORDER[buyIndex];
      if (weapons.owned[key]) weapons.switchTo(key);
      else weapons.tryBuy(key);
      renderBuyMenu();
    }
    return;
  }
  const overlayIndex = bindingSlotIndex(bindings, e.code);
  if (!e.repeat && (podiumOpen || teamPickerOpen) && overlayIndex >= 0 && handleMatchOverlaySlot(overlayIndex)) {
    e.preventDefault();
    return;
  }
  if (uiFocused && !document.pointerLockElement) return;
  if (isAction(e, 'openBots') && !e.repeat && !podiumOpen && !teamPickerOpen) {
    e.preventDefault();
    setBotPanel(true);
    return;
  }
  if (!document.pointerLockElement) return;
  if (isAction(e, 'openArsenal') && !e.repeat && !podiumOpen && !teamPickerOpen) {
    setChat(false);
    setBuyMenu(!buyOpen);
    return;
  }
  if (isAction(e, 'melee') && !e.repeat && !weapons.inputBlocked) doKnife();
  if (isAction(e, 'changeTeam') && !e.repeat && online && matchInfo.mode === 'teams' && !podiumOpen) {
    setTeamPicker(!teamPickerOpen);
  }
  if (isAction(e, 'quickChat') && !e.repeat && online && !podiumOpen) {
    setChat(!chatOpen);
  }
  const idx = bindingSlotIndex(bindings, e.code);
  if (idx >= 0 && !e.repeat) {
    if (chatOpen) {
      net.sendChat(idx);
      setChat(false);
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
player.spawn(safePlayerSpawn(world.playerSpawns[0]));
hud.updateHealth(player.health, player.maxHealth);
hud.updateAmmo(weapons);
hud.updateScore(0, 0);
hud.updateMoney(0);
hud.updateSlots(weapons);
hud.updateGrenades(grenades.count);
renderMenuPanels();
renderMenuArsenal();
showMenuScreen('play');

// --- bucle de juego ---
let lastTime = performance.now();
let fpsCount = 0, fpsTimer = 0;
document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
  if (document.hidden) weapons.clearInput();
});

function tick(now) {
  fitViewport();
  const rawDt = Math.max(0, (now - lastTime) / 1000);
  const dt = Math.min(0.05, rawDt);
  lastTime = now;

  const playing = state === 'playing';
  const inputEnabled = playing && !!document.pointerLockElement && !connecting && !player.dead &&
    !buyOpen && !botPanelOpen && !podiumOpen && !teamPickerOpen;

  if (state !== 'menu') {
    player.update(dt, inputEnabled);
    // saltadores
    if (inputEnabled && player.onGround) {
      for (const pad of world.jumpPads) {
        const dx = player.pos.x - pad.x, dz = player.pos.z - pad.z;
        if (dx * dx + dz * dz < 1.3 && Math.abs(player.pos.y - pad.y) < 0.8) {
          player.vel.y = pad.power;
          player.onGround = false;
          audio.jump();
          break;
        }
      }
    }
    weapons.update(dt, inputEnabled);
    if (botsLocal) botsLocal.update(dt);
    if (botsLocal) kitsMgr.offlineUpdate(player, botsLocal, onHealed, onAmmoPicked);
  }
  // el mundo online sigue vivo aunque estés en el menú
  if (remotes) remotes.update(dt);
  if (online && joined && state === 'playing' && !podiumOpen && !player.dead) net.tickState(dt, player);
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

  if (!document.hidden) {
    fpsCount++;
    fpsTimer += rawDt;
  }
  if (fpsTimer > 0.5) {
    hud.el.fps.textContent = String(Math.round(fpsCount / fpsTimer));
    fpsCount = 0; fpsTimer = 0;
  }

  if (state !== 'menu') renderer.render(scene, camera);
  renderOperatorPreview(dt);
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
