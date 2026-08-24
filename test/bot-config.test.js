import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOTS, TOTAL_SLOTS } from '../src/shared/mapdata.js';
import {
  DEFAULT_BOT_CONFIG,
  effectiveBotCount,
  normalizeBotConfig,
  normalizeBotCount,
  sanitizeBotConfigUpdate,
} from '../src/shared/bot-config.js';

test('default bot configuration enables the supported maximum', () => {
  assert.deepEqual(DEFAULT_BOT_CONFIG, { enabled: true, count: MAX_BOTS });
  assert.ok(Object.isFrozen(DEFAULT_BOT_CONFIG));
});

test('bot counts clamp integers and fall back for invalid types', () => {
  assert.equal(normalizeBotCount(-3), 0);
  assert.equal(normalizeBotCount(MAX_BOTS + 20), MAX_BOTS);
  assert.equal(normalizeBotCount(2), 2);
  assert.equal(normalizeBotCount(2.5, 3), 3);
  assert.equal(normalizeBotCount('2', 3), 3);
  assert.equal(normalizeBotCount(Number.NaN, 3), 3);
});

test('normalization preserves safe fallback fields for partial or invalid data', () => {
  assert.deepEqual(normalizeBotConfig({ enabled: false, count: 2 }), { enabled: false, count: 2 });
  assert.deepEqual(
    normalizeBotConfig({ enabled: 'yes', count: 99 }, { enabled: false, count: 3 }),
    { enabled: false, count: MAX_BOTS },
  );
  assert.deepEqual(normalizeBotConfig(null), DEFAULT_BOT_CONFIG);
});

test('network updates require exact types but clamp integer bounds', () => {
  assert.deepEqual(sanitizeBotConfigUpdate({ enabled: true, count: -10 }), { enabled: true, count: 0 });
  assert.deepEqual(
    sanitizeBotConfigUpdate({ enabled: false, count: MAX_BOTS + 10 }),
    { enabled: false, count: MAX_BOTS },
  );
  assert.equal(sanitizeBotConfigUpdate({ enabled: 'true', count: 2 }), null);
  assert.equal(sanitizeBotConfigUpdate({ enabled: true, count: '2' }), null);
  assert.equal(sanitizeBotConfigUpdate({ enabled: true, count: 2.5 }), null);
  assert.equal(sanitizeBotConfigUpdate({ enabled: true, count: Number.NaN }), null);
  assert.equal(sanitizeBotConfigUpdate({ enabled: true }), null);
});

test('disabled configuration always produces zero filler bots', () => {
  assert.equal(effectiveBotCount({ enabled: false, count: MAX_BOTS }, 1), 0);
  assert.equal(effectiveBotCount({ enabled: false, count: MAX_BOTS }, 7), 0);
});

test('default filler policy respects one, seven, and ten humans', () => {
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, 1), MAX_BOTS);
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, 7), 3);
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, 10), 0);
});

test('a desired count below the maximum is preserved when room space allows', () => {
  assert.equal(effectiveBotCount({ enabled: true, count: 2 }, 1), 2);
  assert.equal(effectiveBotCount({ enabled: true, count: 2 }, 9), 1);
  assert.equal(effectiveBotCount({ enabled: true, count: 0 }, 1), 0);
});

test('an empty room never keeps filler bots', () => {
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, 0), 0);
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, -1), 0);
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, Number.NaN), 0);
});

test('filler bots never exceed room slots or the bot maximum', () => {
  for (let humans = 1; humans <= TOTAL_SLOTS; humans++) {
    const count = effectiveBotCount({ enabled: true, count: MAX_BOTS + 50 }, humans);
    assert.ok(count <= MAX_BOTS);
    assert.ok(count + humans <= TOTAL_SLOTS);
  }
});

test('zombie mode owns its enemies instead of using configurable filler bots', () => {
  assert.equal(effectiveBotCount(DEFAULT_BOT_CONFIG, 1, 'zombies'), 0);
});
