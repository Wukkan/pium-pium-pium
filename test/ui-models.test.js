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
  weaponSelectionAction,
  humanoidPoseState,
  weaponAnimationState,
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

test('locked weapon selection opens the arsenal instead of buying immediately', () => {
  assert.equal(weaponSelectionAction(true), 'equip');
  assert.equal(weaponSelectionAction(false), 'open-buy');
});

test('humanoid pose keeps limbs mirrored while walking and aims both arms', () => {
  const walking = humanoidPoseState(Math.PI / 2, 5.2, false);
  assert.equal(walking.legL, -walking.legR);
  assert.equal(walking.armL, -walking.legL * 0.7);
  assert.equal(walking.armR, walking.legL * 0.7);

  const aiming = humanoidPoseState(0, 0, true, 0.25);
  assert.equal(aiming.armL, aiming.armR);
  assert.ok(aiming.armL < -Math.PI / 2);
  assert.ok(Math.abs(aiming.armLx) < 0.3);
  assert.ok(Math.abs(aiming.armRx) < 0.3);
  assert.equal(aiming.gunRotationX, Math.PI / 2);
});

test('weapon animation state adds bob, recoil and a visible reload motion', () => {
  const idle = weaponAnimationState({
    speed: 0, ads: false, reloading: false, reloadProgress: 0,
    bobTime: 0, kickPos: 0, kickRot: 0,
  });
  assert.deepEqual(idle.position, { x: 0.32, y: -0.3, z: -0.55 });

  const reload = weaponAnimationState({
    speed: 7, ads: false, reloading: true, reloadProgress: 0.5,
    bobTime: 1.2, kickPos: 0.08, kickRot: 0.2,
  });
  assert.ok(reload.position.y < -0.3);
  assert.ok(reload.rotation.x < -0.4);
  assert.ok(Math.abs(reload.position.x - idle.position.x) > 0.001);
});
