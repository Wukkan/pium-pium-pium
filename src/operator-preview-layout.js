export const OPERATOR_PREVIEW_COMPACT_FOV = 30;

// Encuadre completo con al menos ~5 % de margen durante una vuelta de 360°.
// Las armas largas necesitan más aire; las compactas conservan presencia.
export const OPERATOR_PREVIEW_FULL_FOV = Object.freeze({
  pistol: 31,
  revolver: 31,
  smg: 31,
  launcher: 31,
  ar: 34,
  shotgun: 37,
  sniper: 37,
});

export const OPERATOR_PREVIEW_FALLBACK_FOV = 37;

export function operatorPreviewFov(kind, { compact = false } = {}) {
  if (compact) return OPERATOR_PREVIEW_COMPACT_FOV;
  return OPERATOR_PREVIEW_FULL_FOV[kind] ?? OPERATOR_PREVIEW_FALLBACK_FOV;
}
