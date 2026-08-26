import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combatAudioAllowed,
  gameplayCapabilities,
  gameplayOverlayPolicy,
} from '../src/gameplay-policy.js';

test('gameplay capabilities share one authoritative state matrix', () => {
  const base = { state: 'playing', hasControl: true };
  assert.deepEqual(
    { ...gameplayCapabilities(base), overlays: { ...gameplayCapabilities(base).overlays } },
    {
      active: true,
      movement: true,
      combat: true,
      audio: true,
      pointerLock: true,
      overlays: { modal: false, communication: false, movement: false, combat: false, audio: false },
    },
  );

  for (const state of ['menu', 'dead']) {
    const result = gameplayCapabilities({ ...base, state });
    assert.equal(result.movement, false);
    assert.equal(result.combat, false);
    assert.equal(result.audio, false);
    assert.equal(result.pointerLock, false);
  }
  for (const flag of ['connecting', 'dead']) {
    const result = gameplayCapabilities({ ...base, [flag]: true });
    assert.equal(result.movement, false);
    assert.equal(result.combat, false);
    assert.equal(result.pointerLock, false);
  }
  assert.equal(gameplayCapabilities({ ...base, hasControl: false }).combat, false);
  assert.equal(gameplayCapabilities({ ...base, hidden: true }).audio, false);
});

test('modal overlays block all input while quick chat preserves movement only', () => {
  const base = { state: 'playing', hasControl: true };
  for (const flag of ['buyOpen', 'botPanelOpen', 'podiumOpen', 'teamPickerOpen']) {
    const result = gameplayCapabilities({ ...base, [flag]: true });
    assert.equal(result.overlays.modal, true, flag);
    assert.equal(result.movement, false, flag);
    assert.equal(result.combat, false, flag);
    assert.equal(result.audio, false, flag);
    assert.equal(result.pointerLock, false, flag);
  }

  const chat = gameplayCapabilities({ ...base, chatOpen: true });
  assert.equal(chat.overlays.modal, false);
  assert.equal(chat.movement, true);
  assert.equal(chat.combat, false);
  assert.equal(chat.audio, false);
  assert.equal(chat.pointerLock, true);
});

test('overlay policy and legacy audio facade remain defensive and compatible', () => {
  assert.equal(gameplayOverlayPolicy().combat, false);
  assert.equal(gameplayOverlayPolicy({ chatOpen: 1 }).communication, true);
  assert.equal(gameplayOverlayPolicy({ buyOpen: true }).modal, true);
  assert.equal(combatAudioAllowed({ state: 'playing' }), true);
  assert.equal(combatAudioAllowed({ state: 'playing', overlayOpen: true }), false);
  assert.equal(combatAudioAllowed({ state: 'playing', dead: true }), false);
});
