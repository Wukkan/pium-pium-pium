import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SKIN, SKIN_COLORS, sanitizeSkin } from '../src/player-profile.js';

test('skin profile repairs missing and corrupt browser data', () => {
  assert.deepEqual(sanitizeSkin({}), { ...DEFAULT_SKIN, ownedHats: ['none'] });
  assert.deepEqual(sanitizeSkin(null), { ...DEFAULT_SKIN, ownedHats: ['none'] });
  assert.deepEqual(sanitizeSkin({ hat: 'crown', ownedHats: null }), {
    ...DEFAULT_SKIN,
    ownedHats: ['none'],
  });
});

test('skin profile keeps only owned cosmetics from the allowlists', () => {
  const color = SKIN_COLORS[2];
  assert.deepEqual(sanitizeSkin({
    hat: 'cap',
    color,
    ownedHats: ['cap', 'cap', '__proto__'],
    colorsUnlocked: true,
  }), {
    hat: 'cap', color, ownedHats: ['none', 'cap'], colorsUnlocked: true,
  });
});
