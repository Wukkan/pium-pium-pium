const VOTE_LABELS = {
  ffa: 'FFA',
  teams: 'EQUIPOS',
  gun: 'ARMAS',
  zombies: 'ZOMBIS',
  arena: 'ARENA',
  ciudad: 'CIUDAD',
};

export function weaponCardState(def, owned, current, money) {
  if (current) return { status: 'equipped', label: 'EQUIPADA', affordable: false };
  if (owned) return { status: 'owned', label: 'EQUIPAR', affordable: false };
  if (money >= def.price) return { status: 'buy', label: `COMPRAR $${def.price}`, affordable: true };
  return { status: 'locked', label: `FALTAN $${def.price - money}`, affordable: false };
}

export function voteButtonState(kind, selected) {
  const label = VOTE_LABELS[kind] || kind.toUpperCase();
  return {
    className: selected ? 'vote-option selected' : 'vote-option',
    label: selected ? `${label} ✓` : label,
  };
}

export function readOwnedWeapons(raw, validKeys) {
  const owned = { pistol: true };
  if (!Array.isArray(raw)) return owned;
  const valid = new Set(validKeys);
  for (const key of raw) {
    if (typeof key === 'string' && valid.has(key)) owned[key] = true;
  }
  return owned;
}

export function ammoAfterPickup(current, amount = 20, maxReserve = Infinity) {
  return Math.min(maxReserve, Math.max(0, current) + Math.max(0, amount));
}

export function weaponHudLabel(def, index, shortName = def.name, keyLabel = String(index + 1)) {
  return `[${keyLabel}] ${shortName}`;
}

export function voteOptionsState(kinds, selected) {
  return kinds.map((kind) => ({
    kind,
    selected: kind === selected,
    ...voteButtonState(kind, kind === selected),
  }));
}

export function loadoutMetadata(weapons, skin, grenades) {
  return {
    weapon: weapons.current,
    ownedWeapons: Object.keys(weapons.owned).filter((key) => weapons.owned[key]),
    grenades,
    hat: skin.hat,
    color: skin.color,
  };
}

export function weaponSelectionAction(owned) {
  return owned ? 'equip' : 'open-buy';
}

export function humanoidModelProfile() {
  return {
    body: [0.62, 0.62, 0.34],
    limb: [0.18, 0.6, 0.22],
    leg: [0.24, 0.8, 0.26],
    helmet: [0.5, 0.2, 0.46],
    vest: [0.72, 0.68, 0.42],
    shoulder: [0.22, 0.18, 0.3],
    boot: [0.27, 0.16, 0.42],
    backpack: [0.48, 0.68, 0.2],
    hitParts: ['head', 'body', 'arm', 'leg'],
  };
}

const DEFAULT_SETTINGS = {
  fov: 78,
  sensitivity: 0.0023,
  masterVolume: 0.45,
  soundEnabled: true,
  renderScale: 1,
  shadowsEnabled: true,
  shadowQuality: 'high',
  effectsQuality: 'balanced',
  invertY: false,
  showFps: false,
  showPing: true,
  aimMode: 'hold',
  bunnyHopEnabled: true,
  weaponBob: 1,
  screenShake: 1,
  crosshairVisible: true,
  crosshairColor: '#ffffff',
  crosshairScale: 1,
  damageFlash: true,
  highContrast: false,
  reducedMotion: false,
};

const CROSSHAIR_COLORS = new Set(['#ffffff', '#ffc34d', '#66e5ff', '#ff6464', '#79ef8d']);
const SHADOW_QUALITIES = new Set(['low', 'medium', 'high']);
const EFFECT_QUALITIES = new Set(['low', 'balanced', 'high']);

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const readBoolean = (value, fallback) => value === undefined
  ? fallback
  : value === true || value === 1;

export function readSettings(raw) {
  let value = {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') value = parsed;
  } catch { /* preferencias corruptas: usar valores por defecto */ }
  return {
    fov: Math.round(clamp(value.fov, 70, 110, DEFAULT_SETTINGS.fov)),
    sensitivity: clamp(value.sensitivity, 0.001, 0.006, DEFAULT_SETTINGS.sensitivity),
    masterVolume: clamp(value.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    soundEnabled: readBoolean(value.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    renderScale: clamp(value.renderScale, 0.5, 1, DEFAULT_SETTINGS.renderScale),
    shadowsEnabled: readBoolean(value.shadowsEnabled, DEFAULT_SETTINGS.shadowsEnabled),
    shadowQuality: SHADOW_QUALITIES.has(value.shadowQuality)
      ? value.shadowQuality
      : DEFAULT_SETTINGS.shadowQuality,
    effectsQuality: EFFECT_QUALITIES.has(value.effectsQuality)
      ? value.effectsQuality
      : DEFAULT_SETTINGS.effectsQuality,
    invertY: readBoolean(value.invertY, DEFAULT_SETTINGS.invertY),
    showFps: readBoolean(value.showFps, DEFAULT_SETTINGS.showFps),
    showPing: readBoolean(value.showPing, DEFAULT_SETTINGS.showPing),
    aimMode: value.aimMode === 'toggle' ? 'toggle' : DEFAULT_SETTINGS.aimMode,
    bunnyHopEnabled: readBoolean(value.bunnyHopEnabled, DEFAULT_SETTINGS.bunnyHopEnabled),
    weaponBob: clamp(value.weaponBob, 0, 1, DEFAULT_SETTINGS.weaponBob),
    screenShake: clamp(value.screenShake, 0, 1, DEFAULT_SETTINGS.screenShake),
    crosshairVisible: readBoolean(value.crosshairVisible, DEFAULT_SETTINGS.crosshairVisible),
    crosshairColor: CROSSHAIR_COLORS.has(String(value.crosshairColor).toLowerCase())
      ? String(value.crosshairColor).toLowerCase()
      : DEFAULT_SETTINGS.crosshairColor,
    crosshairScale: clamp(value.crosshairScale, 0.6, 1.8, DEFAULT_SETTINGS.crosshairScale),
    damageFlash: readBoolean(value.damageFlash, DEFAULT_SETTINGS.damageFlash),
    highContrast: readBoolean(value.highContrast, DEFAULT_SETTINGS.highContrast),
    reducedMotion: readBoolean(value.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
  };
}

export function effectiveMasterVolume(settings = DEFAULT_SETTINGS) {
  const soundEnabled = settings?.soundEnabled === undefined
    ? DEFAULT_SETTINGS.soundEnabled
    : settings.soundEnabled === true || settings.soundEnabled === 1;
  return soundEnabled
    ? clamp(settings?.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume)
    : 0;
}

export function effectivePixelRatio(renderScale, deviceRatio = 1) {
  return Math.min(2, Math.max(0.5, Number(renderScale) || DEFAULT_SETTINGS.renderScale) *
    Math.max(1, Number(deviceRatio) || 1));
}

export function menuNavState(active, ids = ['play', 'arsenal', 'operator', 'options']) {
  return ids.map((id) => ({ id, active: id === active }));
}

export function buyMenuCategoryState(active, categories = [
  ['all', 'TODO'],
  ['pistols', 'PISTOLAS'],
  ['smgs', 'SMG'],
  ['rifles', 'RIFLES'],
]) {
  return categories.map(([id, label]) => ({ id, label, active: id === active }));
}

export function podiumStageState(stage = 'mode') {
  if (stage === 'map') {
    return {
      stage: 'map',
      phase: 'FASE 2 / 2',
      title: 'ELIGE EL MAPA',
      voteType: 'map',
    };
  }
  return {
    stage: 'mode',
    phase: 'FASE 1 / 2',
    title: 'ELIGE EL MODO DE JUEGO',
    voteType: 'mode',
  };
}

export function botPanelState(data = {}, mode = 'ffa') {
  const integer = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const max = integer(data.max, 0, 99, 5);
  const slots = integer(data.slots, 0, 99, 10);
  const humans = integer(data.humans, 0, slots, 0);
  const count = integer(data.count, 0, max, max);
  // Las oleadas zombis pueden superar las plazas normales de la sala.
  const actual = integer(data.actual, 0, 99, 0);
  const enabled = data.enabled === undefined ? true : data.enabled === true || data.enabled === 1;
  const locked = mode === 'zombies' || data.locked === true || data.locked === 1;

  return {
    enabled,
    count,
    actual,
    max,
    humans,
    slots,
    locked,
    note: locked
      ? 'Las oleadas de Zombis administran sus enemigos automáticamente.'
      : enabled
        ? `${actual} bot${actual === 1 ? '' : 's'} activo${actual === 1 ? '' : 's'} en la sala.`
        : 'Los bots están desactivados en esta sala.',
  };
}

export function isBotConfigAcknowledgement(message, pendingRequestId) {
  return Number.isSafeInteger(pendingRequestId) && pendingRequestId >= 0 &&
    Number.isSafeInteger(message?.rid) && message.rid === pendingRequestId;
}

export function shotTracerState(kind = 'pistol') {
  const colors = {
    pistol: 0xfff0a8,
    shotgun: 0xffffd0,
    smg: 0xffd66b,
    ar: 0xffff9b,
    sniper: 0xffdff8,
    revolver: 0xffffc2,
  };
  return {
    visible: kind !== 'launcher',
    color: kind === 'launcher' ? 0xff8c42 : (colors[kind] || 0xffd66b),
  };
}

export function humanoidPoseState(time, speed, aiming, aimPitch = 0) {
  const walkAmount = Math.min(1, Math.max(0, speed) / 5.2);
  const swing = Math.sin(time) * walkAmount * 0.55;
  const armAngle = aiming ? -Math.PI / 2 - aimPitch * 0.8 : null;
  const armLx = aiming ? -0.24 : -0.39;
  const armRx = aiming ? 0.24 : 0.39;
  return {
    legL: swing,
    legR: -swing,
    armL: armAngle ?? -swing * 0.7,
    armR: armAngle ?? swing * 0.7,
    armLx,
    armRx,
    armLz: aiming ? 0.2 : 0,
    armRz: aiming ? -0.2 : 0,
    gunRotationX: aiming ? Math.PI / 2 : 0,
    bodyY: Math.abs(Math.cos(time)) * walkAmount * 0.025,
  };
}

export function weaponAnimationState({
  speed = 0,
  ads = false,
  reloading = false,
  reloadProgress = 0,
  bobTime = 0,
  bobAmount = 1,
  kickPos = 0,
  kickRot = 0,
} = {}) {
  const bobScale = (ads ? 0.2 : 1) * Math.min(1, Math.max(0, Number(bobAmount) || 0));
  const bobX = Math.sin(bobTime * 1.6) * 0.012 * bobScale * Math.min(1, speed / 2);
  const bobY = Math.abs(Math.cos(bobTime * 1.6)) * 0.014 * bobScale * Math.min(1, speed / 2);
  const progress = Math.min(1, Math.max(0, reloadProgress));
  const reloadTilt = reloading
    ? Math.sin(progress * Math.PI) * (0.85 + Math.sin(progress * Math.PI * 3) * 0.08)
    : 0;
  const adsT = ads ? 1 : 0;
  const baseX = 0.32 * (1 - adsT);
  const baseY = -0.3 * (1 - adsT) + -0.245 * adsT;
  const baseZ = -0.55 * (1 - adsT) + -0.42 * adsT;
  return {
    position: {
      x: baseX + bobX,
      y: baseY + bobY - reloadTilt * 0.14,
      z: baseZ + kickPos,
    },
    rotation: {
      x: kickRot * 0.5 - reloadTilt * 0.65,
      z: reloadTilt * 0.3,
    },
    reloadTilt,
  };
}
