// Reglas numéricas compartidas por cliente y servidor para validar el combate.
// El módulo no depende de DOM/Three y evita que daño, cadencia o cuchillo
// diverjan entre la presentación local y la autoridad online.

export const FIREARM_RULES = Object.freeze({
  pistol: Object.freeze({ damage: 18, headMult: 2, rpm: 320, pellets: 1, mag: 12, reloadTime: 1.1 }),
  shotgun: Object.freeze({ damage: 9, headMult: 1.5, rpm: 78, pellets: 8, mag: 6, reloadTime: 2 }),
  smg: Object.freeze({ damage: 15, headMult: 2, rpm: 950, pellets: 1, mag: 36, reloadTime: 1.25 }),
  ar: Object.freeze({ damage: 24, headMult: 2, rpm: 600, pellets: 1, mag: 30, reloadTime: 1.5 }),
  sniper: Object.freeze({ damage: 105, headMult: 1.5, rpm: 42, pellets: 1, mag: 5, reloadTime: 2.2 }),
  revolver: Object.freeze({ damage: 55, headMult: 2, rpm: 150, pellets: 1, mag: 6, reloadTime: 1.8 }),
  launcher: Object.freeze({ damage: 0, headMult: 1, rpm: 55, pellets: 0, mag: 1, reloadTime: 1.7, projectile: true }),
});

export const COMBAT_LIMITS = Object.freeze({
  maxDeclaredDamage: 120,
  maxShotDistance: 320,
  shotHitWindow: 0.45,
  weaponSwitchDelay: 0.24,
  cadenceTolerance: 0.8,
  knifeDamage: 100,
  knifeFrontDamage: 40,
  knifeBackstabDot: 0.35,
  knifeRange: 2.8,
  knifeVerticalRange: 2.4,
  knifeCooldown: 0.75,
  nadeDamage: 90,
  nadeMaxTargets: 16,
  nadeRadius: 6,
  nadeFuse: 2.2,
  nadeGravity: 22,
});

export function firearmRule(kind) {
  return typeof kind === 'string' && Object.hasOwn(FIREARM_RULES, kind)
    ? FIREARM_RULES[kind]
    : null;
}

export function firearmDamageLimit(kind, head = false) {
  const rule = firearmRule(kind);
  if (!rule || rule.projectile) return 0;
  const perPellet = Math.round(rule.damage * (head ? rule.headMult : 1));
  return Math.min(COMBAT_LIMITS.maxDeclaredDamage, perPellet * rule.pellets);
}

export function firearmCrateDamageLimit(kind) {
  const rule = firearmRule(kind);
  return !rule || rule.projectile ? 0 : rule.damage;
}

export function minimumFireInterval(kind) {
  const rule = firearmRule(kind);
  return rule ? (60 / rule.rpm) * COMBAT_LIMITS.cadenceTolerance : Infinity;
}

// Un jugador mira hacia -Z cuando ry=0; los bots autoritativos usan +Z para
// el mismo yaw. El atacante está detrás cuando la dirección atacante→objetivo
// coincide con el frente del objetivo.
export function knifeDamageLimit(attacker, target, targetYaw, targetKind = 'pl') {
  const ax = Number(attacker?.x), az = Number(attacker?.z);
  const tx = Number(target?.x), tz = Number(target?.z);
  const yaw = Number(targetYaw);
  if (![ax, az, tx, tz, yaw].every(Number.isFinite)) return COMBAT_LIMITS.knifeFrontDamage;
  const dx = tx - ax, dz = tz - az;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return COMBAT_LIMITS.knifeFrontDamage;
  const convention = targetKind === 'bot' ? 1 : -1;
  const facingX = convention * Math.sin(yaw);
  const facingZ = convention * Math.cos(yaw);
  const alignment = facingX * (dx / length) + facingZ * (dz / length);
  return alignment > COMBAT_LIMITS.knifeBackstabDot
    ? COMBAT_LIMITS.knifeDamage
    : COMBAT_LIMITS.knifeFrontDamage;
}
