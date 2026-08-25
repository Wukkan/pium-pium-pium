import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyKnifeMeleePose,
  buildGunModel,
  buildKnifeModel,
  firstPersonAnimationState,
  HAND_GRIP_PROFILES,
  handGripState,
  meleeAnimationState,
  WeaponSystem,
} from '../src/weapons.js';

const FIREARMS = ['pistol', 'revolver', 'shotgun', 'smg', 'ar', 'sniper', 'launcher'];
const KINDS = [...FIREARMS, 'knife'];
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const SUPPORT_FORWARD = ['shotgun', 'smg', 'ar', 'sniper', 'launcher'];
const RELOAD_RELEASE = ['pistol', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];

function assertFiniteVector(value, length, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  assert.equal(value.length, length, `${label} must contain ${length} components`);
  for (const component of value) {
    assert.equal(Number.isFinite(component), true, `${label} contains a non-finite component`);
  }
}

function assertNormalizedCurl(value, length, label) {
  assertFiniteVector(value, length, label);
  for (const component of value) {
    assert.ok(component >= 0 && component <= 1, `${label} must stay inside 0..1`);
  }
}

function assertHandContract(hand, label) {
  assert.equal(typeof hand?.role, 'string', `${label} needs an anatomical role`);
  assertFiniteVector(hand.position, 3, `${label}.position`);
  assertFiniteVector(hand.rotation, 3, `${label}.rotation`);

  for (const finger of FINGERS) {
    const pose = hand.fingers?.[finger];
    assert.ok(pose, `${label}.${finger} is missing`);
    assertNormalizedCurl(pose.curl, 3, `${label}.${finger}.curl`);
    assert.equal(typeof pose.contact, 'boolean', `${label}.${finger}.contact must be explicit`);
  }

  assert.ok(hand.thumb, `${label}.thumb is missing`);
  assertNormalizedCurl(hand.thumb.curl, 2, `${label}.thumb.curl`);
  assert.equal(typeof hand.thumb.contact, 'boolean', `${label}.thumb.contact must be explicit`);
}

function contactCount(hand) {
  return FINGERS.reduce((count, finger) => count + Number(hand.fingers[finger].contact), 0)
    + Number(hand.thumb.contact);
}

function maxVectorDelta(a, b) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function elbowAngle(chain) {
  const towardShoulder = chain.shoulder.clone().sub(chain.elbow).normalize();
  const towardWrist = chain.wrist.clone().sub(chain.elbow).normalize();
  return towardShoulder.angleTo(towardWrist);
}

test('hand grip profiles cover every playable firearm and the knife', () => {
  assert.deepEqual(Object.keys(HAND_GRIP_PROFILES).sort(), [...KINDS].sort());
  assert.equal(Object.isFrozen(HAND_GRIP_PROFILES), true, 'the shared profile table must be immutable');

  for (const kind of KINDS) {
    const state = handGripState({ kind });
    assert.equal(state.kind, kind);
    assertHandContract(state.right, `${kind}.right`);
    assertHandContract(state.left, `${kind}.left`);
  }
});

test('the trigger hand wraps the grip while keeping the index independently posed', () => {
  for (const kind of FIREARMS) {
    const { right } = handGripState({ kind });
    assert.equal(right.role, 'trigger', `${kind}: right hand must own the trigger`);
    assert.equal(contactCount(right), 5, `${kind}: every right-hand digit must contact the weapon`);

    const triggerCurl = average(right.fingers.index.curl);
    const grippingCurls = ['middle', 'ring', 'pinky']
      .map((finger) => average(right.fingers[finger].curl));
    assert.ok(
      grippingCurls.every((curl) => curl > triggerCurl + 0.08),
      `${kind}: index finger must be articulated separately from the gripping fingers`,
    );
    assert.ok(
      grippingCurls.every((curl) => curl >= 0.45),
      `${kind}: lower fingers must visibly wrap the pistol grip`,
    );
    assert.ok(average(right.thumb.curl) >= 0.2, `${kind}: thumb must oppose the grip`);
  }
});

test('support-hand placement follows each weapon instead of reusing the trigger pose', () => {
  const supportPositions = new Set();

  for (const kind of FIREARMS) {
    const state = handGripState({ kind });
    assert.equal(state.left.role, 'support', `${kind}: left hand must support the weapon`);
    assert.ok(contactCount(state.left) >= 4, `${kind}: support hand needs stable weapon contact`);
    assert.notDeepEqual(state.left.position, state.right.position, `${kind}: both hands cannot overlap`);
    supportPositions.add(state.left.position.map((value) => value.toFixed(3)).join(','));

    if (SUPPORT_FORWARD.includes(kind)) {
      assert.ok(
        state.left.position[2] < state.right.position[2] - 0.12,
        `${kind}: support hand must reach the forward handguard`,
      );
    }
  }

  assert.ok(supportPositions.size >= 6, 'weapon classes need distinct support-hand anchors');
});

test('knife pose closes the dominant hand around the handle and keeps a separate guard hand', () => {
  const pistol = handGripState({ kind: 'pistol' });
  const knife = handGripState({ kind: 'knife' });

  assert.equal(knife.right.role, 'knife');
  assert.ok(['support', 'guard'].includes(knife.left.role));
  assert.equal(contactCount(knife.right), 5, 'knife handle must be held by all dominant-hand digits');
  assert.ok(
    average(knife.right.fingers.index.curl) > average(pistol.right.fingers.index.curl) + 0.05,
    'knife index must close around the handle instead of resting in a trigger pose',
  );
  for (const finger of ['middle', 'ring', 'pinky']) {
    assert.ok(average(knife.right.fingers[finger].curl) >= 0.58, `${finger} must wrap the knife handle`);
  }
  assert.notDeepEqual(knife.left.position, knife.right.position, 'guard and knife hands cannot overlap');
});

test('knife fingertips rest on the handle surface in anatomical order', () => {
  const model = buildKnifeModel();
  const handle = model.getObjectByName('knife-handle');
  const halfLength = handle.geometry.parameters.height / 2;

  for (const progress of [0, 0.18, 0.27, 0.43, 0.68]) {
    applyKnifeMeleePose(model, meleeAnimationState(progress));
    model.updateMatrixWorld(true);
    const start = handle.position.clone().set(0, -halfLength, 0).applyMatrix4(handle.matrixWorld);
    const end = handle.position.clone().set(0, halfLength, 0).applyMatrix4(handle.matrixWorld);
    const axis = end.clone().sub(start);
    const axisLengthSq = axis.lengthSq();
    const parameters = [];

    const surfaceDistance = (object) => {
      const point = object.getWorldPosition(object.position.clone());
      const parameter = Math.min(1, Math.max(0, point.clone().sub(start).dot(axis) / axisLengthSq));
      parameters.push(parameter);
      return point.distanceTo(start.clone().addScaledVector(axis, parameter));
    };

    for (let index = 1; index <= 4; index++) {
      const distance = surfaceDistance(model.getObjectByName(`right-finger-${index}-tip`));
      assert.ok(
        distance >= 0.039 && distance <= 0.057,
        `${progress}: finger ${index} misses the handle surface (${distance})`,
      );
    }
    assert.ok(
      parameters.every((value, index) => index === 0 || value > parameters[index - 1]),
      `${progress}: fingers must stack along the handle`,
    );

    parameters.length = 0;
    const thumbDistance = surfaceDistance(model.getObjectByName('right-thumb-tip'));
    assert.ok(
      thumbDistance >= 0.038 && thumbDistance <= 0.056,
      `${progress}: thumb penetrates or floats off the handle (${thumbDistance})`,
    );
  }
});

test('knife guard hand counterbalances the strike instead of following the blade pivot', () => {
  const model = buildKnifeModel();
  const { arms } = model.userData.viewmodel;
  const point = arms.right.position.clone().set(0, 0, 0);

  applyKnifeMeleePose(model, meleeAnimationState(0.18));
  model.updateMatrixWorld(true);
  const dominantReady = arms.right.getWorldPosition(point.clone());
  const guardReady = arms.left.getWorldPosition(point.clone());

  applyKnifeMeleePose(model, meleeAnimationState(0.43));
  model.updateMatrixWorld(true);
  const dominantStrike = arms.right.getWorldPosition(point.clone());
  const guardStrike = arms.left.getWorldPosition(point.clone());
  const dominantTravel = dominantReady.distanceTo(dominantStrike);
  const guardTravel = guardReady.distanceTo(guardStrike);

  assert.ok(dominantTravel > 0.28, 'dominant hand must drive a readable slash');
  assert.ok(guardTravel < dominantTravel * 0.35, 'guard hand is still rigidly attached to the blade');
});

test('knife draw arc keeps both elbows outside the collapsed anatomical range', () => {
  const model = buildKnifeModel();
  const { arms, attackPivot, guardPivot } = model.userData.viewmodel;
  for (let step = 0; step <= 100; step++) {
    const progress = step / 100;
    applyKnifeMeleePose(model, meleeAnimationState(progress));
    for (const side of ['right', 'left']) {
      const chain = arms.chains[side];
      const angle = elbowAngle(chain);
      assert.ok(angle >= 0.65 && angle <= 3.05, `${progress}: ${side} elbow folded unnaturally (${angle})`);
      const pivot = side === 'right' ? attackPivot : guardPivot;
      const anchoredShoulder = chain.shoulder.clone().applyMatrix4(pivot.matrix);
      assert.ok(
        anchoredShoulder.distanceTo(chain.baseShoulder) < 1e-9,
        `${progress}: ${side} shoulder moved to satisfy IK`,
      );
    }
  }
});

test('ADS and recoil preserve finger contact without teleporting either hand', () => {
  for (const kind of FIREARMS) {
    const idle = handGripState({ kind });
    const ads = handGripState({ kind, ads: true });
    const recoil = handGripState({ kind, firePulse: 1 });

    for (const posed of [ads, recoil]) {
      assert.equal(contactCount(posed.right), contactCount(idle.right), `${kind}: trigger contact changed`);
      assert.equal(contactCount(posed.left), contactCount(idle.left), `${kind}: support contact changed`);
      assert.ok(maxVectorDelta(posed.right.position, idle.right.position) <= 0.12, `${kind}: right hand teleported`);
      assert.ok(maxVectorDelta(posed.left.position, idle.left.position) <= 0.12, `${kind}: left hand teleported`);
      assert.ok(maxVectorDelta(posed.right.rotation, idle.right.rotation) <= 0.8, `${kind}: right wrist snapped`);
      assert.ok(maxVectorDelta(posed.left.rotation, idle.left.rotation) <= 0.8, `${kind}: left wrist snapped`);
    }
  }
});

test('reload releases only the hand that manipulates the mechanism and returns to grip', () => {
  for (const kind of RELOAD_RELEASE) {
    const idle = handGripState({ kind });
    const middle = handGripState({ kind, reloading: true, reloadProgress: 0.5 });
    const finished = handGripState({ kind, reloading: true, reloadProgress: 1 });

    assert.equal(middle.right.role, 'trigger', `${kind}: reload must not detach the firing hand`);
    assert.equal(contactCount(middle.right), contactCount(idle.right), `${kind}: firing hand lost contact`);
    assert.equal(middle.left.role, 'reload', `${kind}: support hand needs a reload role`);
    assert.ok(contactCount(middle.left) < contactCount(idle.left), `${kind}: reload hand never releases its grip`);
    assert.ok(
      maxVectorDelta(middle.left.position, idle.left.position) >= 0.02,
      `${kind}: reload hand never reaches the magazine or action`,
    );

    assert.equal(finished.left.role, 'support', `${kind}: support role must recover after reload`);
    assert.ok(
      maxVectorDelta(finished.left.position, idle.left.position) <= 1e-6,
      `${kind}: support anchor must recover exactly`,
    );
    assert.equal(contactCount(finished.left), contactCount(idle.left), `${kind}: support contact must recover`);
  }

  const shotgunIdle = handGripState({ kind: 'shotgun' });
  const shotgunReload = handGripState({ kind: 'shotgun', reloading: true, reloadProgress: 0.25 });
  assert.ok(['pump', 'reload'].includes(shotgunReload.left.role));
  assert.equal(contactCount(shotgunReload.left), contactCount(shotgunIdle.left));
  assert.deepEqual(
    shotgunReload.left.position,
    shotgunIdle.left.position,
    'the grip state must not add a second movement independent from the pump',
  );
});

test('shotgun hand and pump use the exact same mechanical travel', () => {
  const model = buildGunModel('shotgun');
  const arms = model.userData.viewmodel.arms;
  const pump = model.userData.viewmodel.moving.pump;
  const baseHandZ = arms.left.position.z;
  const basePumpZ = pump.position.z;
  const pose = firstPersonAnimationState({
    kind: 'shotgun', reloading: true, reloadProgress: 0.31,
  });
  const weapon = Object.create(WeaponSystem.prototype);
  weapon._applyViewmodelPose(model, pose);
  assert.ok(Math.abs((arms.left.position.z - baseHandZ) - (pump.position.z - basePumpZ)) < 1e-9);
});

test('generated models expose three working joints per finger and their base grip state', () => {
  for (const kind of KINDS) {
    const model = kind === 'knife' ? buildKnifeModel() : buildGunModel(kind);
    const viewmodel = model.userData.viewmodel;
    assert.ok(viewmodel.grip, `${kind}: model is missing its grip state`);
    assert.equal(viewmodel.grip.kind, kind);

    for (const [side, hand] of [['right', viewmodel.arms.right], ['left', viewmodel.arms.left]]) {
      assert.ok(
        maxVectorDelta(hand.position.toArray(), viewmodel.grip[side].position) <= 1e-6,
        `${kind}: ${side} hand does not use its declared grip anchor`,
      );
      const articulatedCurls = [];
      for (let index = 1; index <= 4; index++) {
        const finger = hand.getObjectByName(`${side}-finger-${index}`);
        assert.ok(finger, `${kind}: missing ${side} finger ${index}`);
        const joints = finger.userData.joints;
        assert.equal(Array.isArray(joints), true, `${kind}: ${side} finger ${index} joints are not exposed`);
        assert.equal(joints.length, 3, `${kind}: ${side} finger ${index} must have MCP, PIP and DIP joints`);
        assert.ok(joints.every((joint) => joint?.isObject3D), `${kind}: invalid articulated joint`);
        assert.ok(
          joints.some((joint) => Math.abs(joint.rotation.x) > 0.04),
          `${kind}: ${side} finger ${index} has no visible articulation`,
        );
        articulatedCurls.push(joints.reduce((sum, joint) => sum + Math.abs(joint.rotation.x), 0));
      }

      if (side === 'right' && kind !== 'knife') {
        assert.ok(
          articulatedCurls.slice(1).every((curl) => curl > articulatedCurls[0] + 0.08),
          `${kind}: actual trigger finger joints are not independent from the gripping fingers`,
        );
      }
    }
  }
});

test('visible trigger and grip anchors match the articulated contact points', () => {
  for (const kind of FIREARMS) {
    const model = buildGunModel(kind);
    const viewmodel = model.userData.viewmodel;
    const primary = viewmodel.gripTargets?.right;
    const support = viewmodel.gripTargets?.left;
    const trigger = model.getObjectByName('weapon-trigger');
    const triggerGuard = model.getObjectByName('weapon-trigger-guard');
    const indexTip = model.getObjectByName('right-finger-1-tip');

    assert.equal(primary?.name, 'weapon-primary-grip', `${kind}: primary grip anchor missing`);
    assert.equal(support?.name, 'weapon-support-grip', `${kind}: support grip anchor missing`);
    assert.ok(trigger, `${kind}: visible trigger missing`);
    assert.ok(triggerGuard, `${kind}: trigger guard missing`);

    model.updateMatrixWorld(true);
    const tipPoint = indexTip.position.clone();
    const triggerPoint = trigger.position.clone();
    indexTip.getWorldPosition(tipPoint);
    trigger.getWorldPosition(triggerPoint);
    assert.ok(
      tipPoint.distanceTo(triggerPoint) <= 0.04,
      `${kind}: index finger is not resting on the trigger`,
    );
  }
});

test('unknown weapon kinds keep a finite defensive trigger position', () => {
  const model = buildGunModel('unknown-kind');
  const trigger = model.getObjectByName('weapon-trigger');
  model.updateMatrixWorld(true);
  assert.ok(trigger);
  assert.ok(trigger.position.toArray().every(Number.isFinite));
  assert.ok(trigger.matrixWorld.elements.every(Number.isFinite));
});

test('knife handle forms one continuous diagonal between guard and pommel', () => {
  const model = buildKnifeModel();
  const handle = model.getObjectByName('knife-handle');
  const guard = model.getObjectByName('knife-guard');
  const pommel = model.getObjectByName('knife-pommel');
  model.updateMatrixWorld(true);

  const halfLength = handle.geometry.parameters.height / 2;
  const endpoints = [-halfLength, halfLength].map((offset) => (
    handle.position.clone().set(0, offset, 0).applyMatrix4(handle.matrixWorld)
  ));
  const guardCenter = guard.getWorldPosition(guard.position.clone());
  const pommelCenter = pommel.getWorldPosition(pommel.position.clone());
  const nearest = (point) => Math.min(...endpoints.map((endpoint) => endpoint.distanceTo(point)));

  assert.ok(nearest(guardCenter) < 0.075, 'knife handle is visually detached from its guard');
  assert.ok(nearest(pommelCenter) < 0.075, 'knife handle is visually detached from its pommel');
});

test('two-bone arms keep human proportions during reload and the knife swing', () => {
  for (const kind of KINDS) {
    const model = kind === 'knife' ? buildKnifeModel() : buildGunModel(kind);
    const arms = model.userData.viewmodel.arms;
    if (kind !== 'knife') {
      arms.applyGrip(handGripState({ kind, reloading: true, reloadProgress: 0.5 }));
      arms.update();
    }
    for (const side of ['right', 'left']) {
      const chain = arms.chains[side];
      assert.ok(Math.abs(chain.upperArm.scale.y - chain.upperLength) < 1e-9, `${kind}: upper arm stretched`);
      assert.ok(Math.abs(chain.forearm.scale.y - chain.forearmLength) < 1e-9, `${kind}: forearm stretched`);
      if (kind !== 'knife') {
        assert.ok(chain.shoulder.distanceTo(chain.baseShoulder) < 1e-9, `${kind}: shoulder slid to reach the grip`);
        const angle = elbowAngle(chain);
        assert.ok(angle >= 0.65 && angle <= 3.05, `${kind}: ${side} elbow folded unnaturally (${angle})`);
      }
    }
  }

  const knife = buildKnifeModel();
  const arms = knife.userData.viewmodel.arms;
  const pose = meleeAnimationState(0.43);
  applyKnifeMeleePose(knife, pose);
  for (const side of ['right', 'left']) {
    const chain = arms.chains[side];
    const pivot = side === 'right'
      ? knife.userData.viewmodel.attackPivot
      : knife.userData.viewmodel.guardPivot;
    const anchoredShoulder = chain.shoulder.clone().applyMatrix4(pivot.matrix);
    assert.ok(
      anchoredShoulder.distanceTo(chain.baseShoulder) < 1e-9,
      `knife: ${side} shoulder followed the blade instead of the body`,
    );
    const angle = elbowAngle(chain);
    assert.ok(angle >= 0.65 && angle <= 3.05, `knife: ${side} elbow folded unnaturally (${angle})`);
  }
});

test('higher-detail grips stay inside the first-person rendering budget', () => {
  for (const kind of KINDS) {
    const model = kind === 'knife' ? buildKnifeModel() : buildGunModel(kind);
    let triangles = 0;
    let meshes = 0;

    model.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });

    assert.ok(triangles <= 9000, `${kind}: ${triangles} triangles exceed the first-person budget`);
    assert.ok(meshes <= 110, `${kind}: ${meshes} meshes exceed the draw-call guardrail`);
  }
});
