import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS, assignBinding, bindingSlotIndex, isBindableKeyCode,
  keyCodeLabel, matchesBinding, readBindings,
} from '../src/input-bindings.js';

test('bindings use stable defaults and reject corrupt stored values', () => {
  assert.deepEqual(readBindings('broken'), { ...DEFAULT_BINDINGS });
  const value = readBindings({ moveForward: 'KeyI', grenade: 'Escape', unknown: 'KeyZ' });
  assert.equal(value.moveForward, 'KeyI');
  assert.equal(value.grenade, 'KeyG');
  assert.equal(value.unknown, undefined);
});

test('assigning an occupied key swaps the conflicting action', () => {
  const result = assignBinding(DEFAULT_BINDINGS, 'grenade', 'KeyV');
  assert.equal(result.changed, true);
  assert.equal(result.conflict, 'melee');
  assert.equal(result.bindings.grenade, 'KeyV');
  assert.equal(result.bindings.melee, 'KeyG');
  assert.deepEqual(readBindings(JSON.stringify(result.bindings)), result.bindings);
});

test('reserved browser and escape keys cannot replace gameplay bindings', () => {
  for (const code of ['Escape', 'F5', 'F11', 'MetaLeft', 'ControlLeft', 'AltRight', 'PrintScreen']) {
    assert.equal(isBindableKeyCode(code), false);
    const result = assignBinding(DEFAULT_BINDINGS, 'jump', code);
    assert.equal(result.error, 'reserved-key');
    assert.equal(result.bindings.jump, 'Space');
  }
});

test('tab remains exclusive to scoreboard and never leaks into global actions', () => {
  const globalTab = assignBinding(DEFAULT_BINDINGS, 'openBots', 'Tab');
  assert.equal(globalTab.error, 'tab-reserved');
  assert.equal(globalTab.bindings.openBots, 'KeyH');

  const occupiedScoreboard = assignBinding(DEFAULT_BINDINGS, 'scoreboard', 'KeyH');
  assert.equal(occupiedScoreboard.error, 'occupied-key');
  assert.equal(occupiedScoreboard.bindings.scoreboard, 'Tab');

  const movedScoreboard = assignBinding(DEFAULT_BINDINGS, 'scoreboard', 'KeyK');
  assert.equal(movedScoreboard.error, null);
  assert.equal(movedScoreboard.bindings.scoreboard, 'KeyK');
  assert.equal(Object.values(movedScoreboard.bindings).includes('Tab'), false);

  const swappedAfterMoving = assignBinding(movedScoreboard.bindings, 'openBots', 'KeyK');
  assert.equal(swappedAfterMoving.bindings.scoreboard, 'KeyH');
  assert.equal(swappedAfterMoving.bindings.openBots, 'KeyK');
  assert.deepEqual(
    readBindings(JSON.stringify(swappedAfterMoving.bindings)),
    swappedAfterMoving.bindings,
  );

  const corrupt = readBindings({ openBots: 'Tab', scoreboard: 'KeyH' });
  assert.equal(corrupt.openBots, 'KeyH');
  assert.equal(corrupt.scoreboard, 'Tab');
});

test('binding helpers match actions, slots, and readable labels', () => {
  const bindings = readBindings({ slot1: 'KeyZ', muteSound: 'Numpad0' });
  assert.equal(matchesBinding(bindings, 'muteSound', 'Numpad0'), true);
  assert.equal(bindingSlotIndex(bindings, 'KeyZ'), 0);
  assert.equal(keyCodeLabel('KeyZ'), 'Z');
  assert.equal(keyCodeLabel('Space'), 'ESPACIO');
  assert.equal(keyCodeLabel('ShiftLeft'), 'SHIFT IZQ');
});
