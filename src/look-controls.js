// Matemática pura para la cámara en primera persona. Pointer Lock entrega
// deltas ilimitados; el modo compatible necesita además una intención de giro
// en los bordes porque un cursor absoluto deja de moverse al tocar la pantalla.

export const LOOK_CONTROL_LIMITS = Object.freeze({
  baseSensitivity: 0.0023,
  pitch: 1.55,
  lockedDelta: 1200,
  fallbackDelta: 80,
  edgeDeadZone: 0.7,
  edgeTurnRate: 3.4,
  maxStep: 0.1,
});

const finite = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeLookYaw(value, fallback = 0) {
  const safe = finite(value, finite(fallback, 0));
  return Math.atan2(Math.sin(safe), Math.cos(safe));
}

export function clampLookPitch(value, fallback = 0) {
  return clamp(finite(value, finite(fallback, 0)), -LOOK_CONTROL_LIMITS.pitch, LOOK_CONTROL_LIMITS.pitch);
}

export function sanitizeMouseDelta(value, locked = false) {
  const limit = locked ? LOOK_CONTROL_LIMITS.lockedDelta : LOOK_CONTROL_LIMITS.fallbackDelta;
  return clamp(finite(value), -limit, limit);
}

export function fallbackEdgeIntent(coordinate, start, size, deadZone = LOOK_CONTROL_LIMITS.edgeDeadZone) {
  if (coordinate === null || coordinate === undefined || coordinate === '' ||
      typeof coordinate === 'boolean' || !Number.isFinite(Number(coordinate))) return 0;
  const safeSize = finite(size);
  if (safeSize <= 0) return 0;
  const relative = clamp(((finite(coordinate, finite(start)) - finite(start)) / safeSize) * 2 - 1, -1, 1);
  const zone = clamp(finite(deadZone, LOOK_CONTROL_LIMITS.edgeDeadZone), 0, 0.95);
  const magnitude = Math.abs(relative);
  if (magnitude <= zone) return 0;
  const linear = clamp((magnitude - zone) / (1 - zone), 0, 1);
  const eased = linear * linear * (3 - 2 * linear);
  return Math.sign(relative) * eased;
}

export function fallbackEdgeTurn(intent, sensitivity, dt) {
  const amount = clamp(finite(intent), -1, 1);
  const safeSensitivity = clamp(
    finite(sensitivity, LOOK_CONTROL_LIMITS.baseSensitivity),
    0.0001,
    0.02,
  );
  const step = clamp(finite(dt), 0, LOOK_CONTROL_LIMITS.maxStep);
  return amount * LOOK_CONTROL_LIMITS.edgeTurnRate *
    (safeSensitivity / LOOK_CONTROL_LIMITS.baseSensitivity) * step;
}
