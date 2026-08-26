import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  RELOAD_PAYLOAD_TYPES,
  reloadChoreographyState,
  sanitizeReloadRounds,
} from '../src/reload-choreography.js';
import {
  buildGunModel,
  firstPersonAnimationState,
  WEAPON_DEFS,
  WeaponSystem,
} from '../src/weapons.js';
import { weaponAnimationState } from '../src/ui-models.js';

const WEAPON_KINDS = ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];
const EXPECTED_PAYLOAD = Object.freeze({
  pistol: 'magazine',
  shotgun: 'shell',
  smg: 'magazine',
  ar: 'magazine',
  sniper: 'magazine',
  revolver: 'speedloader',
  launcher: 'grenade',
});
const EXPECTED_MECHANISM = Object.freeze({
  pistol: 'magazineDrop',
  shotgun: 'pumpTravel',
  smg: 'magazineDrop',
  ar: 'magazineDrop',
  sniper: 'magazineDrop',
  revolver: 'cylinderOpen',
  launcher: 'breechOpen',
});
const REQUESTED_ROUNDS = Object.freeze({
  pistol: 3,
  shotgun: 4,
  smg: 3,
  ar: 3,
  sniper: 3,
  revolver: 5,
  launcher: 1,
});

const vectorDistance = (left, right) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

function assertFiniteTree(root, label) {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    assert.ok(
      object.matrixWorld.elements.every(Number.isFinite),
      `${label}: ${object.name || object.type} has a non-finite world matrix`,
    );
  });
}

function sceneStats(root) {
  let objects = 0;
  let triangles = 0;
  root.traverse((object) => {
    objects++;
    if (!object.isMesh || !object.geometry) return;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return { objects, triangles };
}

function objectSnapshot(object) {
  return {
    position: object.position.toArray(),
    rotation: object.rotation.toArray(),
    scale: object.scale.toArray(),
    visible: object.visible,
    count: object.isInstancedMesh ? object.count : null,
  };
}

function applyRigPose(rig, firstPerson, visual) {
  rig.position.set(
    visual.position.x + firstPerson.position.x,
    visual.position.y + firstPerson.position.y,
    visual.position.z + firstPerson.position.z,
  );
  rig.rotation.set(
    visual.rotation.x + firstPerson.rotation.x,
    firstPerson.rotation.y,
    visual.rotation.z + firstPerson.rotation.z,
  );
}

function insertionAmount(state) {
  return state.type === 'magazine' ? state.magazine.inserted : state.payload.insert;
}

function visiblePhaseNearest(kind, rounds, targetInsertion) {
  let nearest = null;
  for (let index = 1; index < 2000; index++) {
    const progress = index / 2000;
    const state = reloadChoreographyState({ kind, progress, active: true, rounds });
    if (!state.payload.visible) continue;
    if (kind === 'shotgun' && state.payload.roundIndex !== 0) continue;
    const delta = Math.abs(insertionAmount(state) - targetInsertion);
    if (!nearest || delta < nearest.delta) nearest = { progress, state, delta };
  }
  assert.ok(nearest, `${kind}: no visible payload phase near ${targetInsertion}`);
  return nearest;
}

function projectedBounds(object, camera) {
  const worldBounds = new THREE.Box3().setFromObject(object);
  assert.equal(worldBounds.isEmpty(), false, `${object.name}: empty projected bounds`);
  const points = [];
  for (const x of [worldBounds.min.x, worldBounds.max.x]) {
    for (const y of [worldBounds.min.y, worldBounds.max.y]) {
      for (const z of [worldBounds.min.z, worldBounds.max.z]) {
        points.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
    center: worldBounds.getCenter(new THREE.Vector3()).project(camera),
  };
}

function visibleRatio(minimum, maximum) {
  const span = maximum - minimum;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, maximum) - Math.max(-1, minimum)) / span;
}

function reloadHarness(kind, { ammo = 0, reserve = WEAPON_DEFS[kind].reserve } = {}) {
  const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 100);
  const rig = new THREE.Group();
  const model = buildGunModel(kind);
  camera.add(rig);
  rig.add(model);

  const calls = {
    ammo: 0,
    reloading: [],
    progress: [],
    scope: [],
    audio: [],
  };
  const weapon = Object.create(WeaponSystem.prototype);
  Object.assign(weapon, {
    camera,
    rig,
    models: { [kind]: model },
    knifeModel: { visible: false },
    current: kind,
    slots: [kind],
    state: { [kind]: { ammo, reserve } },
    owned: { [kind]: true },
    forcedKey: null,
    player: {
      dead: false,
      onGround: true,
      sliding: false,
      recoilPitch: 0,
      horizontalSpeed: () => 0,
    },
    hud: {
      updateAmmo() { calls.ammo++; },
      updateSlots() {},
      setReloading(value) { calls.reloading.push(value); },
      setReloadProgress(value) { calls.progress.push(value); },
      setScope(value) { calls.scope.push(value); },
      setCrosshairSpread() {},
    },
    audio: new Proxy({}, {
      get(_target, property) {
        return () => calls.audio.push(String(property));
      },
    }),
    baseFov: 78,
    equipProgress: 1,
    equipDuration: 0.3,
    reloading: false,
    reloadEnd: 0,
    reloadAmount: 0,
    triggerDown: false,
    aimButtonDown: false,
    ads: false,
    aimMode: 'hold',
    inputBlocked: false,
    knifeEquipped: false,
    meleeActive: false,
    meleeProgress: 0,
    firePulse: 0,
    kickPos: 0,
    kickRot: 0,
    bobTime: 0,
    animationTime: 0,
    weaponBob: 1,
    lastShot: -Infinity,
  });
  return { weapon, model, calls };
}

function applyReloadPose(weapon, model, kind, progress, rounds = REQUESTED_ROUNDS[kind]) {
  const pose = firstPersonAnimationState({
    kind,
    reloading: true,
    reloadProgress: progress,
    reloadRounds: rounds,
  });
  weapon._applyViewmodelPose(model, pose);
  return pose;
}

test('reload choreography exposes the correct payload and complete phases for all seven weapons', () => {
  assert.deepEqual(RELOAD_PAYLOAD_TYPES, EXPECTED_PAYLOAD);

  for (const kind of WEAPON_KINDS) {
    const rounds = REQUESTED_ROUNDS[kind];
    const states = Array.from({ length: 1001 }, (_, index) => reloadChoreographyState({
      kind,
      progress: index / 1000,
      active: true,
      rounds,
    }));
    const first = states[0];
    const last = states.at(-1);
    const visible = states.filter((state) => state.payload.visible);
    const phases = new Set(states.map((state) => state.phase));
    const insertValues = visible.map((state) => (
      state.type === 'magazine' ? state.magazine.inserted : state.payload.insert
    ));
    const socket = first.magazine?.socket || first.payload.socket;
    const startDistance = Math.max(...visible.map((state) => vectorDistance(state.payload.position, socket)));
    const endDistance = Math.min(...visible.map((state) => vectorDistance(state.payload.position, socket)));

    assert.equal(first.kind, kind);
    assert.equal(first.type, EXPECTED_PAYLOAD[kind]);
    assert.equal(first.payload.visible, false, `${kind}: payload visible before reload pickup`);
    assert.equal(last.payload.visible, false, `${kind}: payload remains visible after reload`);
    assert.ok(visible.length > 0, `${kind}: ammunition never becomes visible`);
    assert.ok(phases.size >= 4, `${kind}: reload lacks readable mechanical phases`);
    assert.ok(Math.max(...insertValues) > 0.95, `${kind}: ammunition never reaches its socket`);
    assert.ok(startDistance > endDistance + 0.025, `${kind}: payload does not travel toward its socket`);
    assert.ok(endDistance < 0.015, `${kind}: payload stops short of its socket`);
    assert.ok(
      Math.max(...states.map((state) => state.mechanism[EXPECTED_MECHANISM[kind]])) > 0.95,
      `${kind}: ${EXPECTED_MECHANISM[kind]} never completes its action`,
    );
    assert.equal(last.support.role, 'support', `${kind}: support hand does not recover`);
    for (const state of states) {
      assert.equal(state.roundCount, sanitizeReloadRounds(kind, rounds), `${kind}: unstable round count`);
      assert.ok(state.payload.position.every(Number.isFinite), `${kind}: invalid payload position`);
      assert.ok(state.payload.rotation.every(Number.isFinite), `${kind}: invalid payload rotation`);
    }

    const idle = reloadChoreographyState({ kind, progress: 0.5, active: false, rounds });
    assert.equal(idle.phase, 'idle');
    assert.equal(idle.payload.visible, false);
    assert.equal(idle.support.role, 'support');
    assert.ok(Object.values(idle.mechanism).every((value) => value === 0));
  }
});

test('reload round counts are bounded and shotgun shell indices represent every inserted round', () => {
  assert.equal(sanitizeReloadRounds('pistol', 99), 1);
  assert.equal(sanitizeReloadRounds('launcher', 99), 1);
  assert.equal(sanitizeReloadRounds('shotgun', 4.9), 4);
  assert.equal(sanitizeReloadRounds('shotgun', 99), 6);
  assert.equal(sanitizeReloadRounds('revolver', 5), 5);
  assert.equal(sanitizeReloadRounds('revolver', 99), 6);

  const shellIndices = new Set();
  for (let index = 0; index <= 2000; index++) {
    const state = reloadChoreographyState({
      kind: 'shotgun', progress: index / 2000, active: true, rounds: 4,
    });
    if (state.payload.visible) shellIndices.add(state.payload.roundIndex);
  }
  assert.deepEqual([...shellIndices].sort((left, right) => left - right), [0, 1, 2, 3]);

  for (const kind of WEAPON_KINDS) {
    const animation = firstPersonAnimationState({
      kind,
      reloading: true,
      reloadProgress: 0.5,
      reloadRounds: REQUESTED_ROUNDS[kind],
    });
    const expected = sanitizeReloadRounds(kind, REQUESTED_ROUNDS[kind]);
    assert.equal(animation.hands.reloadRounds, expected, `${kind}: hand round count`);
    assert.equal(animation.reload.roundCount, expected, `${kind}: visual round count`);
  }
});

test('viewmodels reuse one bounded payload while hands and mechanisms follow every reload phase', () => {
  for (const kind of WEAPON_KINDS) {
    const model = buildGunModel(kind);
    const weapon = Object.create(WeaponSystem.prototype);
    const viewmodel = model.userData.viewmodel;
    const reloadVisual = viewmodel.reloadVisual;
    const payload = reloadVisual.payload;
    const socket = reloadVisual.socket;
    const before = sceneStats(model);

    assert.equal(reloadVisual.type, EXPECTED_PAYLOAD[kind], `${kind}: payload semantic`);
    assert.ok(payload?.isObject3D, `${kind}: reload payload missing`);
    assert.ok(socket?.isObject3D, `${kind}: reload socket missing`);
    assert.match(socket.name, new RegExp(`^reload-${EXPECTED_PAYLOAD[kind]}-socket$`));

    for (let index = 0; index <= 100; index++) {
      const pose = applyReloadPose(weapon, model, kind, index / 100);
      const state = pose.reload;
      const expectedVisible = state.type === 'magazine'
        ? state.magazine.installedVisible || state.magazine.spareVisible
        : state.payload.visible;
      assert.equal(payload.visible, expectedVisible, `${kind}: payload visibility at ${index}%`);
      assert.equal(viewmodel.reloadState, state, `${kind}: applied state identity at ${index}%`);

      if (state.payload.visible && state.support.holding) {
        assert.equal(viewmodel.grip.left.role, 'reload', `${kind}: hand is not manipulating payload`);
        const contacts = Object.values(viewmodel.grip.left.fingers)
          .filter((finger) => finger.contact).length + Number(viewmodel.grip.left.thumb.contact);
        assert.ok(contacts >= 2, `${kind}: hand does not close around its payload`);
      }
      if (kind === 'revolver') {
        assert.equal(
          payload.userData.rounds.count,
          state.payload.roundCount,
          'revolver speedloader must empty its cartridges into the cylinder',
        );
        assert.equal(
          reloadVisual.loaded.count,
          state.loadedRoundCount,
          'revolver cylinder must receive the planned cartridges without duplication',
        );
      }
      assertFiniteTree(model, `${kind} ${index}%`);
    }

    const stablePose = firstPersonAnimationState({
      kind, reloading: true, reloadProgress: 0.63, reloadRounds: REQUESTED_ROUNDS[kind],
    });
    weapon._applyViewmodelPose(model, stablePose);
    const stableSnapshot = objectSnapshot(payload);
    applyReloadPose(weapon, model, kind, 0.17);
    weapon._applyViewmodelPose(model, stablePose);
    assert.deepEqual(objectSnapshot(payload), stableSnapshot, `${kind}: replayed phase accumulates drift`);

    weapon._applyViewmodelPose(model, firstPersonAnimationState({ kind }));
    assert.equal(viewmodel.reloadState.active, false, `${kind}: idle state remains active`);
    if (EXPECTED_PAYLOAD[kind] === 'magazine') assert.equal(payload.visible, true);
    else assert.equal(payload.visible, false);
    assert.equal(viewmodel.grip.left.role, 'support');

    const after = sceneStats(model);
    assert.equal(reloadVisual.payload, payload, `${kind}: payload identity changed`);
    assert.equal(reloadVisual.socket, socket, `${kind}: socket identity changed`);
    assert.equal(after.objects, before.objects, `${kind}: animation allocates scene objects`);
    assert.equal(after.triangles, before.triangles, `${kind}: animation changes geometry budget`);
    assert.ok(after.triangles <= 7200, `${kind}: ${after.triangles} triangles exceed reload budget`);
  }
});

test('support-hand motion stays spatially continuous at 60 Hz for every reload duration', () => {
  for (const kind of WEAPON_KINDS) {
    const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 400);
    const rig = new THREE.Group();
    const model = buildGunModel(kind);
    const weapon = Object.create(WeaponSystem.prototype);
    const frames = Math.ceil(WEAPON_DEFS[kind].reloadTime * 60);
    const maximumStep = kind === 'shotgun' ? 0.075 : 0.065;
    let previous = null;
    let travelled = 0;

    camera.add(rig);
    rig.add(model);
    for (let frame = 0; frame <= frames; frame++) {
      const progress = frame / frames;
      const firstPerson = firstPersonAnimationState({
        kind,
        reloading: true,
        reloadProgress: progress,
        reloadRounds: REQUESTED_ROUNDS[kind],
      });
      const visual = weaponAnimationState({ reloading: true, reloadProgress: progress });
      applyRigPose(rig, firstPerson, visual);
      weapon._applyViewmodelPose(model, firstPerson);
      camera.updateMatrixWorld(true);
      const handPosition = model.userData.viewmodel.arms.left.getWorldPosition(new THREE.Vector3());
      if (previous) {
        const step = handPosition.distanceTo(previous);
        travelled += step;
        assert.ok(
          step <= maximumStep,
          `${kind}: support hand teleported ${(step * 100).toFixed(2)} cm between frames ` +
            `${frame - 1} and ${frame} (limit ${(maximumStep * 100).toFixed(1)} cm)`,
        );
      }
      previous = handPosition;
    }

    assert.ok(travelled >= 0.12, `${kind}: support hand never performs a readable reload path`);
  }
});

test('reload keeps ADS and the sniper scope disabled despite held RMB or stale toggle state', () => {
  for (const kind of WEAPON_KINDS) {
    const def = WEAPON_DEFS[kind];
    const { weapon, model, calls } = reloadHarness(kind, { ammo: 0, reserve: def.reserve });
    weapon.aimMode = 'hold';
    weapon.aimButtonDown = true;
    weapon.ads = true;
    weapon.camera.fov = weapon.baseFov / def.zoom;
    model.visible = false;

    assert.equal(weapon.reload(), true, `${kind}: reload did not start from ADS`);
    assert.equal(weapon.ads, false, `${kind}: reload did not leave ADS immediately`);
    weapon.reloadEnd = performance.now() / 1000 + 100;

    for (const aimMode of ['hold', 'toggle']) {
      weapon.aimMode = aimMode;
      weapon.aimButtonDown = true;
      weapon.ads = true;
      const priorFov = weapon.camera.fov;
      weapon.update(1 / 60, true);
      assert.equal(weapon.reloading, true, `${kind}: test reload ended unexpectedly`);
      assert.equal(weapon.ads, false, `${kind}: ${aimMode} aim reactivated during reload`);
      assert.ok(weapon.camera.fov >= priorFov, `${kind}: camera moved back toward ADS zoom`);
      assert.equal(model.visible, true, `${kind}: firearm stayed hidden like a scoped view`);
      assert.equal(calls.scope.at(-1), false, `${kind}: scope overlay reappeared during reload`);
    }
  }
});

test('presented and inserting payload bounds remain visibly projected at FOV 70 and 78', () => {
  for (const kind of WEAPON_KINDS) {
    const rounds = REQUESTED_ROUNDS[kind];
    const phases = [
      ['presentation', visiblePhaseNearest(kind, rounds, 0)],
      ['insertion', visiblePhaseNearest(kind, rounds, 0.55)],
    ];

    for (const fov of [70, 78]) {
      for (const [label, phase] of phases) {
        const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 400);
        const rig = new THREE.Group();
        const model = buildGunModel(kind);
        const weapon = Object.create(WeaponSystem.prototype);
        camera.add(rig);
        rig.add(model);

        const firstPerson = firstPersonAnimationState({
          kind,
          reloading: true,
          reloadProgress: phase.progress,
          reloadRounds: rounds,
        });
        const visual = weaponAnimationState({
          reloading: true,
          reloadProgress: phase.progress,
        });
        applyRigPose(rig, firstPerson, visual);
        weapon._applyViewmodelPose(model, firstPerson);
        camera.updateMatrixWorld(true);

        const payload = model.userData.viewmodel.reloadVisual.payload;
        assert.equal(payload.visible, true, `${kind}: ${label} payload is hidden`);
        const bounds = projectedBounds(payload, camera);
        const horizontalVisibility = visibleRatio(bounds.minX, bounds.maxX);
        const verticalVisibility = visibleRatio(bounds.minY, bounds.maxY);
        assert.ok(Math.abs(bounds.center.x) <= 1, `${kind}: ${label} center is outside horizontally at FOV ${fov}`);
        assert.ok(Math.abs(bounds.center.y) <= 1, `${kind}: ${label} center is outside vertically at FOV ${fov}`);
        assert.ok(bounds.center.z >= -1 && bounds.center.z <= 1, `${kind}: ${label} is outside depth at FOV ${fov}`);
        assert.ok(horizontalVisibility >= 0.9, `${kind}: ${label} is horizontally clipped at FOV ${fov}`);
        assert.ok(
          verticalVisibility >= 0.6,
          `${kind}: only ${(verticalVisibility * 100).toFixed(1)}% of ${label} payload is visible at FOV ${fov}`,
        );
        assert.ok(bounds.minZ > -1 && bounds.maxZ < 1, `${kind}: ${label} crosses camera depth bounds`);
      }
    }
  }
});

test('reload completion transfers the planned ammunition exactly once for every weapon', () => {
  for (const kind of WEAPON_KINDS) {
    const def = WEAPON_DEFS[kind];
    const missing = Math.min(REQUESTED_ROUNDS[kind], def.mag);
    const initialAmmo = def.mag - missing;
    const initialReserve = missing + 2;
    const { weapon, model, calls } = reloadHarness(kind, {
      ammo: initialAmmo,
      reserve: initialReserve,
    });

    assert.equal(weapon.reload(), true, `${kind}: reload did not start`);
    assert.equal(weapon.reloadAmount, missing, `${kind}: planned amount`);
    assert.equal(weapon.ads, false, `${kind}: reload must leave ADS`);
    assert.deepEqual(calls.reloading, [true]);

    weapon.reloadEnd = -1;
    weapon.update(1 / 60, false);
    assert.equal(weapon.ammo.ammo, def.mag, `${kind}: final magazine`);
    assert.equal(weapon.ammo.reserve, 2, `${kind}: final reserve`);
    assert.equal(weapon.reloading, false);
    assert.equal(weapon.reloadAmount, 0);
    assert.equal(weapon.reloadEnd, 0);
    assert.equal(calls.ammo, 1, `${kind}: ammo HUD should update once`);
    assert.equal(calls.reloading.at(-1), false);
    assert.equal(model.userData.viewmodel.reloadState.active, false);

    weapon.update(1 / 60, false);
    assert.equal(weapon.ammo.ammo, def.mag, `${kind}: completion repeated ammo transfer`);
    assert.equal(weapon.ammo.reserve, 2, `${kind}: completion repeated reserve transfer`);
    assert.equal(calls.ammo, 1, `${kind}: completion repeated HUD update`);
    assert.deepEqual(calls.audio, [], `${kind}: visual reload emitted forbidden audio`);
  }
});

test('clearInput, death and weapon switching cancel reload without awarding ammunition or stale props', () => {
  const clear = reloadHarness('launcher', { ammo: 0, reserve: 4 });
  assert.equal(clear.weapon.reload(), true);
  applyReloadPose(clear.weapon, clear.model, 'launcher', 0.5, 1);
  assert.equal(clear.model.userData.viewmodel.reloadVisual.payload.visible, true);
  clear.weapon.clearInput();
  assert.equal(clear.weapon.reloading, false);
  assert.equal(clear.weapon.reloadEnd, 0);
  assert.equal(clear.weapon.reloadAmount, 0);
  assert.deepEqual(clear.weapon.ammo, { ammo: 0, reserve: 4 });
  assert.equal(clear.model.userData.viewmodel.reloadVisual.payload.visible, false);
  assert.equal(clear.model.userData.viewmodel.reloadState.active, false);

  const death = reloadHarness('shotgun', { ammo: 2, reserve: 10 });
  assert.equal(death.weapon.reload(), true);
  applyReloadPose(death.weapon, death.model, 'shotgun', 0.31, 4);
  assert.equal(death.model.userData.viewmodel.reloadVisual.payload.visible, true);
  death.weapon.reloadEnd = -1;
  death.weapon.player.dead = true;
  death.weapon.update(1 / 60, false);
  assert.deepEqual(death.weapon.ammo, { ammo: 2, reserve: 10 });
  assert.equal(death.weapon.reloading, false);
  assert.equal(death.weapon.reloadEnd, 0);
  assert.equal(death.model.userData.viewmodel.reloadVisual.payload.visible, false);
  assert.equal(death.calls.ammo, 0, 'death must not complete the pending reload');

  const change = reloadHarness('pistol', { ammo: 4, reserve: 20 });
  const shotgun = buildGunModel('shotgun');
  change.weapon.models.shotgun = shotgun;
  change.weapon.rig.add(shotgun);
  change.weapon.slots.push('shotgun');
  change.weapon.state.shotgun = { ammo: 6, reserve: 30 };
  change.weapon.owned.shotgun = true;
  assert.equal(change.weapon.reload(), true);
  applyReloadPose(change.weapon, change.model, 'pistol', 0.5, 1);
  const magazine = change.model.userData.viewmodel.moving.magazine;
  assert.notDeepEqual(magazine.position.toArray(), magazine.userData.basePosition.toArray());
  change.weapon._equip('shotgun', false);
  assert.equal(change.weapon.current, 'shotgun');
  assert.equal(change.weapon.reloading, false);
  assert.equal(change.weapon.reloadEnd, 0);
  assert.equal(change.weapon.reloadAmount, 0);
  assert.deepEqual(change.weapon.state.pistol, { ammo: 4, reserve: 20 });
  assert.deepEqual(magazine.position.toArray(), magazine.userData.basePosition.toArray());
  assert.equal(change.model.userData.viewmodel.reloadState.active, false);
  assert.deepEqual(change.calls.audio, []);
});
