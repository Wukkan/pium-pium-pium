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

export function weaponHudLabel(def, index, shortName = def.name) {
  return `[${index + 1}] ${shortName}`;
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
  invertY: false,
  showFps: false,
  reducedMotion: false,
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
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
    invertY: value.invertY === true || value.invertY === 1,
    showFps: value.showFps === true || value.showFps === 1,
    reducedMotion: value.reducedMotion === true || value.reducedMotion === 1,
  };
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
  kickPos = 0,
  kickRot = 0,
} = {}) {
  const bobScale = ads ? 0.2 : 1;
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
