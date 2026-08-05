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

export function humanoidPoseState(time, speed, aiming, aimPitch = 0) {
  const walkAmount = Math.min(1, Math.max(0, speed) / 5.2);
  const swing = Math.sin(time) * walkAmount * 0.55;
  const armAngle = aiming ? -Math.PI / 2 - aimPitch * 0.8 : null;
  return {
    legL: swing,
    legR: -swing,
    armL: armAngle ?? -swing * 0.7,
    armR: armAngle ?? swing * 0.7,
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
