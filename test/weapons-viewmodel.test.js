import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGunModel,
  buildKnifeModel,
  firstPersonAnimationState,
  MAX_ARSENAL_MONEY,
  meleeAnimationState,
  sanitizeArsenalState,
  viewmodelVisibilityState,
  WeaponSystem,
} from '../src/weapons.js';

const WEAPON_KINDS = ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];

function actionHarness(equipProgress = 0.5) {
  const calls = { reload: 0, reloading: [], ammo: 0 };
  const weapon = Object.create(WeaponSystem.prototype);
  Object.assign(weapon, {
    current: 'pistol',
    slots: ['pistol'],
    state: { pistol: { ammo: 5, reserve: 20 } },
    equipProgress,
    reloading: false,
    reloadEnd: 0,
    lastShot: -Infinity,
    triggerDown: true,
    ads: true,
    firePulse: 0.8,
    kickPos: 0.1,
    kickRot: 0.2,
    player: { dead: false },
    audio: {
      reload() { calls.reload++; },
      dry() { throw new Error('blocked fire reached dry-fire feedback'); },
    },
    hud: {
      setReloading(value) { calls.reloading.push(value); },
      updateAmmo() { calls.ammo++; },
    },
  });
  return { weapon, calls };
}

function forcedWeaponHarness() {
  const calls = { equips: [], ammo: 0 };
  const weapon = Object.create(WeaponSystem.prototype);
  Object.assign(weapon, {
    current: 'ar',
    forcedKey: null,
    preForcedKey: null,
    slots: [...WEAPON_KINDS],
    owned: { pistol: true, ar: true },
    state: Object.fromEntries(WEAPON_KINDS.map((key) => [key, { ammo: 0, reserve: 0 }])),
    hud: { updateAmmo() { calls.ammo++; } },
    _equip(key) {
      calls.equips.push(key);
      this.current = key;
    },
  });
  return { weapon, calls };
}

function economyHarness() {
  const calls = { equips: [], money: [], slots: 0, ammo: 0, bought: 0, announcements: [] };
  const weapon = Object.create(WeaponSystem.prototype);
  Object.assign(weapon, {
    current: 'pistol',
    forcedKey: null,
    preForcedKey: null,
    money: 0,
    owned: { pistol: true },
    slots: [...WEAPON_KINDS],
    state: Object.fromEntries(WEAPON_KINDS.map((key) => [key, { ammo: 0, reserve: 0 }])),
    player: { dead: false },
    hud: {
      updateMoney(value) { calls.money.push(value); },
      updateSlots() { calls.slots++; },
      updateAmmo() { calls.ammo++; },
      announce(value) { calls.announcements.push(value); },
    },
    audio: {
      buy() { calls.bought++; },
      dry() {},
    },
    _equip(key) {
      calls.equips.push(key);
      this.current = key;
    },
  });
  return { weapon, calls };
}

function meleeHarness() {
  const calls = { reloading: [], scope: [], shots: 0 };
  const pistol = buildGunModel('pistol');
  const ar = buildGunModel('ar');
  const knife = buildKnifeModel();
  const weapon = Object.create(WeaponSystem.prototype);
  Object.assign(weapon, {
    current: 'pistol',
    forcedKey: null,
    owned: { pistol: true, ar: true },
    models: { pistol, ar },
    knifeModel: knife,
    rig: { visible: true },
    player: { dead: false },
    inputBlocked: false,
    meleeActive: false,
    meleeProgress: 0,
    meleeCooldownUntil: 0,
    triggerDown: true,
    ads: true,
    reloading: true,
    firePulse: 0.8,
    equipProgress: 1,
    equipDuration: 0.3,
    kickPos: 0,
    lastShot: -Infinity,
    state: {
      pistol: { ammo: 5, reserve: 20 },
      ar: { ammo: 30, reserve: 120 },
    },
    hud: {
      setReloading(value) { calls.reloading.push(value); },
      setScope(value) { calls.scope.push(value); },
      updateAmmo() {},
      updateSlots() {},
      announce() {},
    },
    audio: { dry() {}, reload() {} },
    onShot() { calls.shots++; },
  });
  pistol.userData.flash.visible = true;
  pistol.userData.muzzleLight.intensity = 2;
  return { weapon, calls };
}

test('every first-person weapon exposes two articulated tactical hands', () => {
  for (const kind of WEAPON_KINDS) {
    const model = buildGunModel(kind);
    const viewmodel = model.userData.viewmodel;
    assert.equal(viewmodel.kind, kind);
    assert.equal(viewmodel.arms.root.name, 'first-person-arms');
    assert.equal(viewmodel.arms.right.name, 'right-hand');
    assert.equal(viewmodel.arms.left.name, 'left-hand');
    assert.ok(viewmodel.arms.right.children.length >= 9, `${kind}: detailed right hand`);
    assert.ok(viewmodel.arms.left.children.length >= 9, `${kind}: detailed left hand`);
    assert.ok(model.userData.muzzleLight, `${kind}: muzzle light`);
  }
});

test('firearm and knife viewmodels are mutually exclusive in every visibility mode', () => {
  const normal = viewmodelVisibilityState();
  assert.deepEqual(normal, { rig: true, firearm: true, knife: false, scope: false });

  const melee = viewmodelVisibilityState({ meleeActive: true });
  assert.deepEqual(melee, { rig: true, firearm: false, knife: true, scope: false });

  const scoped = viewmodelVisibilityState({ scoped: true });
  assert.deepEqual(scoped, { rig: true, firearm: false, knife: false, scope: true });

  const dead = viewmodelVisibilityState({ dead: true, scoped: true, meleeActive: true });
  assert.deepEqual(dead, { rig: false, firearm: false, knife: false, scope: false });

  for (const state of [normal, melee, scoped, dead]) {
    assert.equal(state.firearm && state.knife, false, 'gun and knife must never render together');
  }
});

test('melee animation is clamped, strikes once in the middle and finishes hidden', () => {
  const start = meleeAnimationState(-10);
  const strike = meleeAnimationState(0.43);
  const finish = meleeAnimationState(1);
  const clampedFinish = meleeAnimationState(10);

  assert.equal(start.visible, true);
  assert.equal(start.strike, 0);
  assert.ok(strike.strike > 0.99);
  assert.ok(strike.position.x < start.position.x - 0.3);
  assert.equal(finish.visible, false);
  assert.equal(finish.strike, 0);
  assert.deepEqual(clampedFinish, finish);

  for (const pose of [start, strike, finish]) {
    for (const value of [...Object.values(pose.position), ...Object.values(pose.rotation)]) {
      assert.equal(Number.isFinite(value), true);
    }
  }
});

test('gun and knife models expose articulated fingers, thumbs and arm chains', () => {
  const models = [
    ...WEAPON_KINDS.map((kind) => [kind, buildGunModel(kind)]),
    ['knife', buildKnifeModel()],
  ];

  for (const [kind, model] of models) {
    const arms = model.userData.viewmodel.arms;
    for (const side of ['right', 'left']) {
      const hand = arms[side];
      assert.ok(hand, `${kind}: ${side} hand`);
      assert.ok(arms.chains[side], `${kind}: ${side} arm chain`);
      assert.ok(arms.root.getObjectByName(`${side}-upper-arm`), `${kind}: ${side} upper arm`);
      assert.ok(arms.root.getObjectByName(`${side}-forearm`), `${kind}: ${side} forearm`);

      for (let finger = 1; finger <= 4; finger++) {
        const root = hand.getObjectByName(`${side}-finger-${finger}`);
        assert.ok(root, `${kind}: ${side} finger ${finger}`);
        for (const segment of ['proximal', 'middle', 'distal']) {
          assert.ok(
            root.getObjectByName(`${side}-finger-${finger}-${segment}`),
            `${kind}: ${side} finger ${finger} ${segment}`,
          );
        }
        assert.ok(root.getObjectByName(`${side}-finger-${finger}-tip`), `${kind}: ${side} fingertip ${finger}`);
      }

      assert.ok(hand.getObjectByName(`${side}-thumb-proximal`), `${kind}: ${side} thumb proximal`);
      assert.ok(hand.getObjectByName(`${side}-thumb-distal`), `${kind}: ${side} thumb distal`);
    }
  }

  const knife = models.at(-1)[1];
  assert.ok(knife.getObjectByName('knife-blade'));
  assert.ok(knife.getObjectByName('knife-handle'));
});

test('beginning and cancelling melee blocks firearm actions and restores only the active gun', () => {
  const { weapon, calls } = meleeHarness();
  const ammoBefore = weapon.ammo.ammo;

  assert.equal(weapon.beginMelee(), true);
  assert.equal(weapon.meleeActive, true);
  assert.equal(weapon.triggerDown, false);
  assert.equal(weapon.ads, false);
  assert.equal(weapon.reloading, false);
  assert.equal(weapon.firePulse, 0);
  assert.equal(weapon.models.pistol.userData.flash.visible, false);
  assert.equal(weapon.models.pistol.userData.muzzleLight.intensity, 0);
  assert.equal(weapon.models.pistol.visible, false);
  assert.equal(weapon.models.ar.visible, false);
  assert.equal(weapon.knifeModel.visible, true);
  assert.equal(calls.reloading.at(-1), false);
  assert.equal(calls.scope.at(-1), false);

  assert.equal(weapon.beginMelee(), false, 'an active melee animation cannot restart');
  weapon.fire();
  weapon.reload();
  weapon.switchTo('ar');
  assert.equal(weapon.ammo.ammo, ammoBefore, 'melee must block gunfire');
  assert.equal(weapon.reloading, false, 'melee must block reload');
  assert.equal(weapon.current, 'pistol', 'melee must block manual weapon switching');
  assert.equal(calls.shots, 0);

  assert.equal(weapon.cancelMelee(true), true);
  assert.equal(weapon.meleeActive, false);
  assert.equal(weapon.meleeProgress, 0);
  assert.equal(weapon.knifeModel.visible, false);
  assert.equal(weapon.models.pistol.visible, true);
  assert.equal(weapon.models.ar.visible, false);
  assert.equal(weapon.equipProgress, 0, 'restored firearm must play its draw animation');
  assert.equal(weapon.equipDuration, 0.28);
  assert.equal(weapon.cancelMelee(), false, 'cancelling an inactive melee is a no-op');
});

test('melee strike callback fires exactly once when progress crosses the impact point', () => {
  const { weapon } = meleeHarness();
  let strikes = 0;

  assert.equal(weapon.beginMelee(() => { strikes++; }), true);
  weapon._updateMelee(0.26);
  assert.equal(strikes, 0, 'impact must wait until progress reaches 0.43');

  weapon._updateMelee(0.02);
  assert.equal(strikes, 1, 'impact fires on the first update that crosses 0.43');
  weapon._updateMelee(0.1);
  weapon._updateMelee(1);
  assert.equal(strikes, 1, 'later updates and recovery cannot repeat the impact');
});

test('cancelling melee before the impact point discards its strike callback', () => {
  const { weapon } = meleeHarness();
  let strikes = 0;

  assert.equal(weapon.beginMelee(() => { strikes++; }), true);
  weapon._updateMelee(0.2);
  assert.equal(weapon.meleeProgress < 0.43, true);
  assert.equal(weapon.cancelMelee(false), true);
  weapon._updateMelee(1);

  assert.equal(strikes, 0);
  assert.equal(weapon.meleeStrikeCallback, null);
  assert.equal(weapon.meleeStrikeFired, false);
});

test('each weapon class exposes the moving part needed by its reload', () => {
  const expected = {
    pistol: ['magazine', 'slide'],
    smg: ['magazine', 'slide'],
    ar: ['magazine', 'slide'],
    sniper: ['magazine', 'slide'],
    shotgun: ['pump'],
    revolver: ['cylinder'],
    launcher: ['breech'],
  };

  for (const [kind, parts] of Object.entries(expected)) {
    const moving = buildGunModel(kind).userData.viewmodel.moving;
    for (const part of parts) assert.ok(moving[part], `${kind}: ${part}`);
  }
});

test('first-person animation differentiates draw, sprint, ADS and reduced bob', () => {
  const drawn = firstPersonAnimationState({ equipProgress: 1 });
  const drawing = firstPersonAnimationState({ equipProgress: 0 });
  assert.ok(drawing.position.y < drawn.position.y - 0.3);
  assert.ok(drawing.rotation.z > drawn.rotation.z + 0.5);

  const sprint = firstPersonAnimationState({ speed: 8, time: 0.3 });
  const ads = firstPersonAnimationState({ speed: 8, time: 0.3, ads: true });
  assert.ok(sprint.locomotion.sprint > 0.75);
  assert.equal(ads.locomotion.sprint, 0);
  assert.ok(sprint.rotation.z > ads.rotation.z + 0.2);

  const noBob = firstPersonAnimationState({ speed: 5, time: 0.7, bobAmount: 0 });
  assert.equal(noBob.locomotion.stride, 0);
  assert.equal(noBob.locomotion.step, 0);
  assert.equal(noBob.locomotion.breath, 0);
});

test('reload choreography is specific to magazines, pump, cylinder and breech', () => {
  const shared = { reloading: true, reloadProgress: 0.46 };
  const rifle = firstPersonAnimationState({ ...shared, kind: 'ar' });
  const shotgun = firstPersonAnimationState({ ...shared, kind: 'shotgun', reloadProgress: 0.25 });
  const revolver = firstPersonAnimationState({ ...shared, kind: 'revolver' });
  const launcher = firstPersonAnimationState({ ...shared, kind: 'launcher' });

  assert.ok(rifle.mechanism.magazineDrop > 0.95);
  assert.equal(rifle.mechanism.cylinderOpen, 0);
  assert.ok(shotgun.mechanism.pumpTravel > 0.65);
  assert.ok(revolver.mechanism.cylinderOpen > 0.95);
  assert.ok(launcher.mechanism.breechOpen > 0.95);
});

test('shot impulse drives firearm slides and the shotgun pump cycle', () => {
  const pistol = firstPersonAnimationState({ kind: 'pistol', firePulse: 1 });
  const shotgun = firstPersonAnimationState({ kind: 'shotgun', firePulse: 0.5 });
  const idle = firstPersonAnimationState({ kind: 'pistol', firePulse: 0 });

  assert.equal(pistol.mechanism.slideTravel, 1);
  assert.equal(idle.mechanism.slideTravel, 0);
  assert.ok(shotgun.mechanism.pumpTravel > 0.99);
  assert.ok(pistol.hands.shot > idle.hands.shot);
});

test('fire and reload stay blocked until the equip animation is complete', () => {
  const { weapon, calls } = actionHarness(0.75);
  weapon.fire();
  weapon.reload();
  assert.equal(weapon.ammo.ammo, 5);
  assert.equal(weapon.reloading, false);
  assert.equal(calls.reload, 0);

  weapon.equipProgress = 1;
  weapon.reload();
  assert.equal(weapon.reloading, true);
  assert.equal(calls.reload, 1);
  assert.deepEqual(calls.reloading, [true]);
});

test('refill clears held fire and ADS before restoring ammunition', () => {
  const { weapon, calls } = actionHarness(1);
  weapon.refill();
  assert.equal(weapon.triggerDown, false);
  assert.equal(weapon.ads, false);
  assert.equal(weapon.firePulse, 0);
  assert.equal(weapon.kickPos, 0);
  assert.equal(weapon.kickRot, 0);
  assert.equal(weapon.ammo.ammo, 12);
  assert.equal(weapon.ammo.reserve, 72);
  assert.equal(calls.ammo, 1);
  assert.deepEqual(calls.reloading, [false]);
});

test('leaving a forced-weapon mode restores an owned weapon deterministically', () => {
  const preferred = forcedWeaponHarness();
  preferred.weapon.setForced('sniper');
  preferred.weapon.setForced('shotgun');
  assert.equal(preferred.weapon.preForcedKey, 'ar');
  preferred.weapon.setForced(null);
  assert.equal(preferred.weapon.current, 'ar');
  assert.equal(preferred.weapon.forcedKey, null);
  assert.equal(preferred.weapon.preForcedKey, null);
  assert.deepEqual(preferred.calls.equips, ['sniper', 'shotgun', 'ar']);

  const fallback = forcedWeaponHarness();
  fallback.weapon.setForced('launcher');
  fallback.weapon.owned.ar = false;
  fallback.weapon.setForced(null);
  assert.equal(fallback.weapon.current, 'pistol');
  assert.deepEqual(fallback.calls.equips, ['launcher', 'pistol']);

  const inactive = forcedWeaponHarness();
  inactive.weapon.setForced(null);
  assert.deepEqual(inactive.calls.equips, []);
});

test('arsenal snapshots sanitize money, ownership allowlist and equipped weapon', () => {
  assert.deepEqual(sanitizeArsenalState({
    money: 42.9,
    owned: { pistol: false, ar: true, admin_weapon: true },
    equipped: 'ar',
  }), {
    money: 42,
    owned: { pistol: true, ar: true },
    equipped: 'ar',
  });

  assert.deepEqual(sanitizeArsenalState(JSON.stringify({
    money: MAX_ARSENAL_MONEY + 5000,
    owned: ['sniper', '__proto__'],
    equipped: '__proto__',
  })), {
    money: MAX_ARSENAL_MONEY,
    owned: { pistol: true, sniper: true },
    equipped: 'pistol',
  });

  assert.deepEqual(sanitizeArsenalState('{broken'), {
    money: 0,
    owned: { pistol: true },
    equipped: 'pistol',
  });
  assert.equal(sanitizeArsenalState({ money: -9 }).money, 0);
  assert.equal(sanitizeArsenalState({ money: Infinity }).money, 0);
});

test('economy instance restores, exports and emits only persistent player choices', () => {
  const { weapon, calls } = economyHarness();
  const changes = [];
  weapon.onEconomyChange = (snapshot) => changes.push(snapshot);

  const restored = weapon.restoreEconomyState({
    money: 900.8,
    owned: { smg: true, unknown: true },
    equipped: 'smg',
  });
  assert.deepEqual(restored, {
    money: 900,
    owned: { pistol: true, smg: true },
    equipped: 'smg',
  });
  assert.equal(weapon.current, 'smg');
  assert.equal(changes.length, 0, 'restore should not rewrite storage through the callback');

  weapon.addMoney(MAX_ARSENAL_MONEY);
  assert.equal(weapon.money, MAX_ARSENAL_MONEY);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].money, MAX_ARSENAL_MONEY);

  weapon.switchTo('pistol');
  assert.equal(changes.length, 2);
  assert.equal(changes[1].equipped, 'pistol');

  weapon.setForced('sniper');
  assert.equal(weapon.exportEconomyState().equipped, 'pistol');
  weapon.switchTo('smg');
  weapon.setForced(null);
  assert.equal(changes.length, 2, 'forced weapon transitions must not persist as manual choices');

  weapon.tryBuy('shotgun');
  assert.equal(changes.length, 3);
  assert.equal(changes[2].equipped, 'shotgun');
  assert.equal(changes[2].owned.shotgun, true);
  assert.equal(calls.bought, 1);
});
