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
  shadowQuality: 'medium',
  effectsQuality: 'balanced',
  invertY: false,
  showFps: false,
  showPing: true,
  aimMode: 'hold',
  bunnyHopEnabled: true,
  weaponBob: 1,
  screenShake: 1,
  crosshairVisible: true,
  crosshairStyle: 'classic',
  crosshairColor: '#ffffff',
  crosshairScale: 1,
  crosshairThickness: 2,
  crosshairGap: 6,
  crosshairDot: false,
  crosshairDotSize: 2,
  crosshairOutline: true,
  crosshairOutlineThickness: 1,
  crosshairOutlineColor: '#000000',
  crosshairOpacity: 1,
  crosshairDynamic: true,
  crosshairDynamicAmount: 1,
  damageFlash: true,
  highContrast: false,
  reducedMotion: false,
};

const CROSSHAIR_STYLES = new Set(['classic', 'tactical', 'dot']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SHADOW_QUALITIES = new Set(['low', 'medium', 'high']);
const EFFECT_QUALITIES = new Set(['low', 'balanced', 'high']);

const freezePreset = (preset) => Object.freeze(preset);

export const CROSSHAIR_PRESETS = Object.freeze({
  balanced: freezePreset({
    label: 'EQUILIBRADA',
    crosshairVisible: true,
    crosshairStyle: 'classic',
    crosshairColor: '#ffffff',
    crosshairScale: 1,
    crosshairThickness: 2,
    crosshairGap: 6,
    crosshairDot: false,
    crosshairDotSize: 2,
    crosshairOutline: true,
    crosshairOutlineThickness: 1,
    crosshairOutlineColor: '#000000',
    crosshairOpacity: 1,
    crosshairDynamic: true,
    crosshairDynamicAmount: 1,
  }),
  precise: freezePreset({
    label: 'PRECISA',
    crosshairVisible: true,
    crosshairStyle: 'classic',
    crosshairColor: '#66e5ff',
    crosshairScale: 0.7,
    crosshairThickness: 1,
    crosshairGap: 3,
    crosshairDot: true,
    crosshairDotSize: 2,
    crosshairOutline: true,
    crosshairOutlineThickness: 0.5,
    crosshairOutlineColor: '#000000',
    crosshairOpacity: 1,
    crosshairDynamic: false,
    crosshairDynamicAmount: 0.5,
  }),
  highVisibility: freezePreset({
    label: 'ALTA VISIBILIDAD',
    crosshairVisible: true,
    crosshairStyle: 'tactical',
    crosshairColor: '#79ef8d',
    crosshairScale: 1.4,
    crosshairThickness: 3,
    crosshairGap: 7,
    crosshairDot: true,
    crosshairDotSize: 3,
    crosshairOutline: true,
    crosshairOutlineThickness: 2,
    crosshairOutlineColor: '#000000',
    crosshairOpacity: 1,
    crosshairDynamic: false,
    crosshairDynamicAmount: 1,
  }),
  dynamic: freezePreset({
    label: 'DINÁMICA',
    crosshairVisible: true,
    crosshairStyle: 'classic',
    crosshairColor: '#ffc34d',
    crosshairScale: 1,
    crosshairThickness: 2,
    crosshairGap: 5,
    crosshairDot: false,
    crosshairDotSize: 2,
    crosshairOutline: true,
    crosshairOutlineThickness: 1,
    crosshairOutlineColor: '#000000',
    crosshairOpacity: 1,
    crosshairDynamic: true,
    crosshairDynamicAmount: 1.25,
  }),
});

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const readBoolean = (value, fallback) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return fallback;
};

const readHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return HEX_COLOR.test(normalized) ? normalized : fallback;
};

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
    crosshairStyle: CROSSHAIR_STYLES.has(value.crosshairStyle)
      ? value.crosshairStyle
      : DEFAULT_SETTINGS.crosshairStyle,
    crosshairColor: readHexColor(value.crosshairColor, DEFAULT_SETTINGS.crosshairColor),
    crosshairScale: clamp(value.crosshairScale, 0.6, 1.8, DEFAULT_SETTINGS.crosshairScale),
    crosshairThickness: clamp(
      value.crosshairThickness, 1, 6, DEFAULT_SETTINGS.crosshairThickness,
    ),
    crosshairGap: clamp(value.crosshairGap, 0, 20, DEFAULT_SETTINGS.crosshairGap),
    crosshairDot: readBoolean(value.crosshairDot, DEFAULT_SETTINGS.crosshairDot),
    crosshairDotSize: clamp(value.crosshairDotSize, 1, 8, DEFAULT_SETTINGS.crosshairDotSize),
    crosshairOutline: readBoolean(value.crosshairOutline, DEFAULT_SETTINGS.crosshairOutline),
    crosshairOutlineThickness: clamp(
      value.crosshairOutlineThickness, 0.5, 3, DEFAULT_SETTINGS.crosshairOutlineThickness,
    ),
    crosshairOutlineColor: readHexColor(
      value.crosshairOutlineColor, DEFAULT_SETTINGS.crosshairOutlineColor,
    ),
    crosshairOpacity: clamp(value.crosshairOpacity, 0.2, 1, DEFAULT_SETTINGS.crosshairOpacity),
    crosshairDynamic: readBoolean(value.crosshairDynamic, DEFAULT_SETTINGS.crosshairDynamic),
    crosshairDynamicAmount: clamp(
      value.crosshairDynamicAmount, 0, 2, DEFAULT_SETTINGS.crosshairDynamicAmount,
    ),
    damageFlash: readBoolean(value.damageFlash, DEFAULT_SETTINGS.damageFlash),
    highContrast: readBoolean(value.highContrast, DEFAULT_SETTINGS.highContrast),
    reducedMotion: readBoolean(value.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
  };
}

export function crosshairPresentation(settings, spreadPx = 0) {
  const normalized = readSettings(settings);
  const style = normalized.crosshairStyle;
  const spread = clamp(spreadPx, 0, 32, 0);
  const requestedExpansion = normalized.crosshairDynamic
    ? spread * normalized.crosshairDynamicAmount
    : 0;
  // El máximo cubre toda la combinación válida (gap 20 + spread 32 × 2),
  // de modo que los ajustes extremos aún conservan feedback al disparar.
  const gap = Math.min(84, normalized.crosshairGap + requestedExpansion);
  const dynamicExpansion = gap - normalized.crosshairGap;
  const showLines = style !== 'dot';
  const dotExpansion = style === 'dot' ? Math.min(12, dynamicExpansion * 0.18) : 0;

  return {
    visible: normalized.crosshairVisible,
    style,
    color: normalized.crosshairColor,
    length: normalized.crosshairScale * 9,
    thickness: normalized.crosshairThickness,
    gap,
    baseGap: normalized.crosshairGap,
    dynamicExpansion,
    showTop: showLines && style !== 'tactical',
    showBottom: showLines,
    showLeft: showLines,
    showRight: showLines,
    showDot: style === 'dot' || normalized.crosshairDot,
    dotSize: normalized.crosshairDotSize + dotExpansion,
    dotExpansion,
    outlineThickness: normalized.crosshairOutline
      ? normalized.crosshairOutlineThickness
      : 0,
    outlineColor: normalized.crosshairOutlineColor,
    opacity: normalized.crosshairOpacity,
  };
}

// Proyecta la desviación direccional usada por el raycast al mismo espacio de
// píxeles en el que se dibuja la mira. Un multiplicador fijo se desajusta al
// cambiar FOV, resolución o al entrar en ADS.
export function projectSpreadToPixels(spread, verticalFov = DEFAULT_SETTINGS.fov, viewportHeight = 720) {
  const numericSpread = Number(spread);
  const safeSpread = Number.isFinite(numericSpread) ? Math.max(0, numericSpread) : 0;
  const numericFov = Number(verticalFov);
  const safeFov = Number.isFinite(numericFov) && numericFov > 0 && numericFov < 180
    ? numericFov
    : DEFAULT_SETTINGS.fov;
  const numericHeight = Number(viewportHeight);
  const safeHeight = Number.isFinite(numericHeight) && numericHeight > 0
    ? Math.min(16384, numericHeight)
    : 720;
  const focalLength = safeHeight / (2 * Math.tan((safeFov * Math.PI) / 360));
  return Math.min(32, safeSpread * focalLength);
}

export function shotCrosshairKickPixels(recoil, firePulse, ads = false) {
  const safeRecoil = Math.max(0, Number(recoil) || 0);
  const safePulse = Math.min(1, Math.max(0, Number(firePulse) || 0));
  const fullKick = Math.min(12, 4 + safeRecoil * 120);
  return safePulse * fullKick * (ads ? 0.6 : 1);
}

export function crosshairFeedbackPixels(baseSpreadPixels, recoil, firePulse, ads = false) {
  const numericBase = Number(baseSpreadPixels);
  const safeBase = Number.isFinite(numericBase) ? Math.min(20, Math.max(0, numericBase)) : 0;
  return Math.min(32, safeBase + shotCrosshairKickPixels(recoil, firePulse, ads));
}

export function applyCrosshairPreset(settings, presetId) {
  const normalized = readSettings(settings);
  const preset = CROSSHAIR_PRESETS[presetId];
  if (!preset) return normalized;
  const { label: _label, ...values } = preset;
  return readSettings({ ...normalized, ...values });
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
  return Math.min(1.5, Math.max(0.5, Number(renderScale) || DEFAULT_SETTINGS.renderScale) *
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

export function podiumStageState(stage = 'map') {
  if (stage === 'map') {
    return {
      stage: 'map',
      phase: 'MAPA DE LA SALA',
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
      // La recarga se presenta arriba y hacia el centro para que la munición y
      // la mano manipuladora permanezcan dentro del encuadre, incluso a FOV 70.
      x: baseX + bobX - reloadTilt * 0.1,
      y: baseY + bobY + reloadTilt * 0.33,
      z: baseZ + kickPos + reloadTilt * 0.035,
    },
    rotation: {
      x: kickRot * 0.5 - reloadTilt * 0.22,
      z: reloadTilt * 0.2,
    },
    reloadTilt,
  };
}
