import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponCardState,
  voteButtonState,
  readOwnedWeapons,
  ammoAfterPickup,
  weaponHudLabel,
  voteOptionsState,
  loadoutMetadata,
} from '../src/ui-models.js';

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

test('price-free HUD labels never expose purchase text', () => {
  const label = weaponHudLabel({ name: 'RIFLE' }, 3);
  assert.equal(label, '[4] RIFLE');
  assert.doesNotMatch(label, /[$🔒]/);
});

test('vote option state marks only the selected option', () => {
  const options = voteOptionsState(['ffa', 'teams', 'gun'], 'teams');
  assert.equal(options.find((option) => option.kind === 'teams').className, 'vote-option selected');
  assert.equal(options.find((option) => option.kind === 'ffa').className, 'vote-option');
});

test('loadout metadata exposes the equipped player presentation', () => {
  assert.deepEqual(loadoutMetadata(
    { current: 'smg', owned: { pistol: true, smg: true } },
    { hat: 'cap', color: 0xe05252 },
    2,
  ), {
    weapon: 'smg', ownedWeapons: ['pistol', 'smg'], grenades: 2, hat: 'cap', color: 0xe05252,
  });
});
