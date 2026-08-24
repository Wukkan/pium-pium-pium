import { HATS } from './shared/mapdata.js';

export const SKIN_COLORS = Object.freeze([
  0xe05252, 0x5278e0, 0x52b86a, 0xc27ad0,
  0xe0a052, 0x52c2c2, 0xf2f2f2, 0x333340,
]);

export const DEFAULT_SKIN = Object.freeze({
  hat: 'none',
  color: null,
  ownedHats: Object.freeze(['none']),
  colorsUnlocked: false,
});

export function sanitizeSkin(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const owned = Array.isArray(source.ownedHats)
    ? [...new Set(source.ownedHats.filter((id) => typeof id === 'string' && Object.hasOwn(HATS, id)))]
    : [];
  if (!owned.includes('none')) owned.unshift('none');
  const colorsUnlocked = source.colorsUnlocked === true;
  const color = colorsUnlocked && Number.isInteger(source.color) && SKIN_COLORS.includes(source.color)
    ? source.color
    : null;
  const hat = typeof source.hat === 'string' && owned.includes(source.hat) && Object.hasOwn(HATS, source.hat)
    ? source.hat
    : 'none';
  return { hat, color, ownedHats: owned, colorsUnlocked };
}
