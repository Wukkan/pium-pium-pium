import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponCardState, voteButtonState, readOwnedWeapons, ammoAfterPickup } from '../src/ui-models.js';

test('weapon cards distinguish equipped, owned, affordable, and locked weapons', () => {
  const def = { name: 'ESCOPETA', price: 300 };
  assert.deepEqual(weaponCardState(def, true, false, 0), {
    status: 'owned', label: 'EQUIPAR', affordable: false,
  });
  assert.deepEqual(weaponCardState(def, false, false, 400), {
    status: 'buy', label: 'COMPRAR $300', affordable: true,
  });
  assert.deepEqual(weaponCardState(def, false, false, 100), {
    status: 'locked', label: 'FALTAN $200', affordable: false,
  });
  assert.deepEqual(weaponCardState(def, true, true, 0), {
    status: 'equipped', label: 'EQUIPADA', affordable: false,
  });
});

test('vote buttons expose selected state without changing the vote label', () => {
  assert.deepEqual(voteButtonState('ciudad', false), {
    className: 'vote-option', label: 'CIUDAD',
  });
  assert.deepEqual(voteButtonState('ciudad', true), {
    className: 'vote-option selected', label: 'CIUDAD ✓',
  });
});

test('owned weapons are sanitized and pistol is always available', () => {
  assert.deepEqual(readOwnedWeapons(['shotgun', 'invalid', 'pistol'], ['pistol', 'shotgun']), {
    pistol: true, shotgun: true,
  });
  assert.deepEqual(readOwnedWeapons('bad data', ['pistol', 'shotgun']), { pistol: true });
});

test('ammo pickups add twenty rounds without exceeding the reserve cap', () => {
  assert.equal(ammoAfterPickup(12, 20, 144), 32);
  assert.equal(ammoAfterPickup(140, 20, 144), 144);
});
