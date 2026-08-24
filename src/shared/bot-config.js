import { MAX_BOTS, TOTAL_SLOTS } from './mapdata.js';

export const DEFAULT_BOT_CONFIG = Object.freeze({
  enabled: true,
  count: MAX_BOTS,
});

function isFiniteInteger(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

export function normalizeBotCount(value, fallback = DEFAULT_BOT_CONFIG.count) {
  const safeFallback = isFiniteInteger(fallback)
    ? Math.max(0, Math.min(MAX_BOTS, fallback))
    : DEFAULT_BOT_CONFIG.count;
  if (!isFiniteInteger(value)) return safeFallback;
  return Math.max(0, Math.min(MAX_BOTS, value));
}

export function normalizeBotConfig(value, fallback = DEFAULT_BOT_CONFIG) {
  const safeFallback = {
    enabled: typeof fallback?.enabled === 'boolean'
      ? fallback.enabled
      : DEFAULT_BOT_CONFIG.enabled,
    count: normalizeBotCount(fallback?.count, DEFAULT_BOT_CONFIG.count),
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safeFallback;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : safeFallback.enabled,
    count: normalizeBotCount(value.count, safeFallback.count),
  };
}

// Network updates are strict about types, while still clamping a numeric integer
// to the supported room range. Invalid updates return null and leave state intact.
export function sanitizeBotConfigUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.enabled !== 'boolean' || !isFiniteInteger(value.count)) return null;
  return {
    enabled: value.enabled,
    count: normalizeBotCount(value.count),
  };
}

// Configurable filler bots are not used without humans or in zombie mode.
export function effectiveBotCount(config, humanCount, mode = 'ffa') {
  const humans = isFiniteInteger(humanCount) ? Math.max(0, humanCount) : 0;
  if (humans === 0 || mode === 'zombies') return 0;
  const normalized = normalizeBotConfig(config);
  if (!normalized.enabled) return 0;
  const available = Math.max(0, TOTAL_SLOTS - humans);
  return Math.min(normalized.count, MAX_BOTS, available);
}
