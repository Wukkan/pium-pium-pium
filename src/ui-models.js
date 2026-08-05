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
