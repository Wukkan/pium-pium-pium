// Estado visual puro del operador. Mantener estas funciones sin dependencias de
// Three.js permite probar la animacion y reutilizarla en bots y jugadores remotos.

const finite = (value, fallback = 0) => Number.isFinite(Number(value))
  ? Number(value)
  : fallback;

export const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));

const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export function stablePoseSide(id) {
  const text = String(id ?? 'operator');
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return (hash & 1) === 0 ? 1 : -1;
}

export function hitReactionSide(attacker, target, targetYaw = 0) {
  const dx = finite(attacker?.x) - finite(target?.x);
  const dz = finite(attacker?.z) - finite(target?.z);
  if (Math.abs(dx) + Math.abs(dz) < 0.0001) return 1;
  const relative = Math.sin(Math.atan2(dx, dz) - finite(targetYaw));
  if (Math.abs(relative) < 0.05) return dx >= 0 ? 1 : -1;
  return relative >= 0 ? 1 : -1;
}

export function operatorMotionState({
  time = 0,
  idleTime = time,
  speed = 0,
  aiming = false,
  aimPitch = 0,
  hit = 0,
  hitSide = 1,
  recoil = 0,
} = {}) {
  const safeSpeed = Math.max(0, finite(speed));
  const walk = clamp01(safeSpeed / 5.2);
  const sprint = smoothstep((safeSpeed - 4.8) / 2.2);
  const pitch = Math.min(1.15, Math.max(-1.15, finite(aimPitch)));
  const cycle = Math.sin(finite(time));
  const cycleQuarter = Math.cos(finite(time));
  const stride = cycle * walk * (0.5 + sprint * 0.2);
  const breathing = Math.sin(finite(idleTime) * 1.8);
  const impact = Math.sin(clamp01(hit) * Math.PI * 0.5);
  const side = finite(hitSide, 1) < 0 ? -1 : 1;
  const kick = clamp01(recoil);
  const aim = !!aiming;

  const armL = aim
    ? -1.5 - pitch * 0.78 + kick * 0.1
    : -stride * (0.78 + sprint * 0.18) - sprint * 0.16;
  const armR = aim
    ? -1.54 - pitch * 0.78 + kick * 0.22
    : stride * (0.78 + sprint * 0.18) - sprint * 0.16;

  return {
    locomotion: walk,
    sprint,
    legL: stride - impact * 0.05,
    legR: -stride + impact * 0.05,
    armL,
    armR,
    armLx: aim ? -0.27 : -0.4,
    armRx: aim ? 0.27 : 0.4,
    armLz: aim ? 0.18 : sprint * 0.04,
    armRz: aim ? -0.18 : -sprint * 0.04,
    forearmL: aim ? -0.2 : -sprint * 0.18,
    forearmR: aim ? 0.06 + kick * 0.12 : -sprint * 0.18,
    gunRotationX: aim ? Math.PI / 2 + kick * 0.13 : kick * 0.08,
    gunPositionZ: -0.1 + kick * 0.07,
    bodyY: Math.abs(cycleQuarter) * walk * 0.032 + breathing * (1 - walk) * 0.006,
    torsoPitch: sprint * 0.13 - impact * 0.08,
    torsoYaw: -cycle * walk * 0.035 - side * impact * 0.1,
    torsoRoll: cycleQuarter * walk * 0.025 + side * impact * 0.13,
    headPitch: aim ? -pitch * 0.55 : -sprint * 0.08,
    headYaw: aim ? side * impact * 0.05 : -cycle * walk * 0.04,
    headRoll: side * impact * 0.08,
    equipmentRoll: -cycleQuarter * walk * 0.04 - side * impact * 0.025,
    muzzleScale: 0.85 + kick * 0.55,
  };
}

export function operatorDeathState(progress = 0, side = 1) {
  const p = clamp01(progress);
  const fall = smoothstep((p - 0.06) / 0.82);
  const collapse = smoothstep(p / 0.42);
  const direction = finite(side, 1) < 0 ? -1 : 1;
  return {
    progress: p,
    groupRotationX: -fall * 1.38,
    groupRotationZ: direction * fall * 0.3,
    torsoRotationX: collapse * 0.14,
    torsoRotationZ: direction * collapse * 0.16,
    torsoY: -fall * 0.1,
    legL: collapse * (direction > 0 ? 0.5 : 0.18),
    legR: collapse * (direction > 0 ? 0.18 : 0.5),
    armL: -collapse * (direction > 0 ? 0.32 : 0.72),
    armR: -collapse * (direction > 0 ? 0.72 : 0.32),
    gunX: direction * collapse * 0.055,
    gunY: 1.16 - collapse * 0.11,
    gunZ: -0.12 + collapse * 0.075,
    gunPitch: -0.32 + collapse * 0.48,
    gunYaw: direction * collapse * 0.1,
    gunRoll: direction * collapse * 0.16,
    headRoll: direction * collapse * 0.2,
    equipmentRoll: -direction * collapse * 0.08,
    nameOpacity: 1 - smoothstep(p / 0.28),
  };
}
