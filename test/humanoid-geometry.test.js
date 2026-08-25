import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  animateHumanoid,
  disposeHumanoid,
  humanoidFacingOffset,
  makeHat,
  makeHumanoid,
  OPERATOR_HAND_PROFILE,
  setHumanoidFacingConvention,
} from '../src/humanoid.js';

function canvasDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            font: '', textAlign: '', textBaseline: '', lineWidth: 0,
            strokeStyle: '', fillStyle: '', strokeText() {}, fillText() {},
          };
        },
      };
    },
  };
}

test('bot facing uses an internal visual pivot without changing logical yaw', () => {
  assert.equal(humanoidFacingOffset('pl'), 0);
  assert.equal(humanoidFacingOffset('bot'), Math.PI);

  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'BOT', (part) => ({ part }));
    rig.group.rotation.y = Math.PI / 2;
    assert.equal(setHumanoidFacingConvention(rig, 'bot'), true);
    rig.group.updateMatrixWorld(true);

    const renderedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      rig.visualRoot.getWorldQuaternion(new THREE.Quaternion()),
    );
    assert.ok(Math.abs(renderedForward.x - 1) < 1e-9);
    assert.ok(Math.abs(renderedForward.z) < 1e-9);
    assert.equal(rig.group.rotation.y, Math.PI / 2, 'visual conversion mutated combat yaw');
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('operator and hats keep their hitbox dimensions while rounding visible boxes', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'cap');
    const hat = makeHat('crown');
    let triangles = 0;
    let roundedBoxes = 0;
    let legacyBoxes = 0;

    for (const root of [rig.group, hat]) {
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        const geometry = object.geometry;
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        if (geometry.type === 'RoundedBoxGeometry') roundedBoxes++;
        if (geometry.type === 'BoxGeometry') legacyBoxes++;
      });
    }

    assert.ok(roundedBoxes >= 65);
    assert.equal(legacyBoxes, 0);
    assert.ok(triangles <= 12000, `${triangles} triangles exceed the operator budget`);
    assert.deepEqual(rig.head.geometry.parameters, {
      width: 0.42, height: 0.42, depth: 0.42, segments: 2, radius: 0.055,
    });
    assert.deepEqual(
      [...new Set(rig.parts.map((part) => part.userData.part))].sort(),
      ['arm', 'body', 'head', 'leg'],
    );
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('operator gloves expose articulated proportions without opening wrist seams', () => {
  assert.equal(Object.isFrozen(OPERATOR_HAND_PROFILE), true);
  for (const key of ['palm', 'wrist', 'fingerLengths', 'fingerCurls', 'distalCurls']) {
    assert.equal(Object.isFrozen(OPERATOR_HAND_PROFILE[key]), true, `${key} must be immutable`);
  }
  assert.equal(OPERATOR_HAND_PROFILE.segmentsPerFinger, 2);
  assert.ok(OPERATOR_HAND_PROFILE.wrist[0] < OPERATOR_HAND_PROFILE.palm[0]);
  assert.ok(OPERATOR_HAND_PROFILE.wrist[2] < OPERATOR_HAND_PROFILE.palm[2]);
  assert.ok(
    OPERATOR_HAND_PROFILE.fingerLengths[1] > OPERATOR_HAND_PROFILE.fingerLengths[2]
      && OPERATOR_HAND_PROFILE.fingerLengths[2] > OPERATOR_HAND_PROFILE.fingerLengths[0]
      && OPERATOR_HAND_PROFILE.fingerLengths[0] > OPERATOR_HAND_PROFILE.fingerLengths[3],
    'middle, ring, index and pinky lengths need a human-readable cascade',
  );

  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'none');
    const fingerNames = ['index', 'middle', 'ring', 'pinky'];

    for (const [side, hand] of [['L', rig.handL], ['R', rig.handR]]) {
      assert.equal(hand?.name, `hand${side}`);
      const { palm, palmPanel, wrist, fingers, thumb } = hand.userData.anatomy;
      let meshes = 0;
      let triangles = 0;
      hand.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        meshes++;
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      });

      assert.equal(meshes, OPERATOR_HAND_PROFILE.meshBudgetPerHand);
      assert.ok(triangles <= 500, `${side} glove uses ${triangles} triangles`);
      assert.equal(palm.geometry.parameters.width, OPERATOR_HAND_PROFILE.palm[0]);
      assert.equal(palm.geometry.parameters.height, OPERATOR_HAND_PROFILE.palm[1]);
      assert.equal(palm.geometry.parameters.depth, OPERATOR_HAND_PROFILE.palm[2]);
      assert.equal(palm.material.isMeshStandardMaterial, true);
      assert.equal(palmPanel.material.isMeshStandardMaterial, true);
      assert.notEqual(palm.material, palmPanel.material, 'the dorsal panel needs separate shading');
      assert.ok(palm.material.roughness >= 0.9, 'the glove shell must remain matte');
      assert.ok(palmPanel.material.roughness >= 0.75, 'the dorsal panel must avoid plastic glare');
      assert.ok(palmPanel.position.z > 0, 'the dorsal panel must sit opposite the gripping face');
      assert.ok(palmPanel.geometry.parameters.height >= OPERATOR_HAND_PROFILE.palm[1] * 0.8);
      assert.ok(palmPanel.geometry.parameters.depth <= OPERATOR_HAND_PROFILE.palm[2] * 0.15);
      const palmBack = palm.position.z + OPERATOR_HAND_PROFILE.palm[2] / 2;
      const panelFront = palmPanel.position.z - palmPanel.geometry.parameters.depth / 2;
      const panelOverlap = palmBack - panelFront;
      assert.ok(panelOverlap >= 0.006 && panelOverlap <= 0.012, `dorsal panel overlap is ${panelOverlap}`);

      assert.deepEqual(Object.keys(fingers), fingerNames);
      fingerNames.forEach((fingerName, index) => {
        const finger = fingers[fingerName];
        assert.equal(finger.root.name, `hand${side}-${fingerName}`);
        assert.equal(finger.proximal.name, `hand${side}-${fingerName}-proximal`);
        assert.equal(finger.distal.name, `hand${side}-${fingerName}-distal`);
        assert.ok(
          Math.abs(finger.proximal.scale.y + finger.distal.scale.y - finger.totalLength) < 1e-9,
          `${side} ${fingerName} changes its declared length`,
        );
        assert.equal(finger.totalLength, OPERATOR_HAND_PROFILE.fingerLengths[index]);
        assert.ok(finger.root.rotation.x > 0, `${side} ${fingerName} has no grip curl`);
        assert.ok(
          finger.distalJoint.rotation.x > finger.root.rotation.x,
          `${side} ${fingerName} distal joint must close around the grip`,
        );
      });

      assert.equal(thumb.root.name, `hand${side}-thumb`);
      assert.equal(thumb.proximal.name, `hand${side}-thumb-proximal`);
      assert.equal(thumb.distal.name, `hand${side}-thumb-distal`);
      assert.ok(Math.abs(thumb.root.rotation.z) >= 0.75, 'thumb must oppose the four fingers');

      const wristHalfHeight = OPERATOR_HAND_PROFILE.wrist[1] / 2;
      rig.group.updateMatrixWorld(true);
      const forearm = side === 'L' ? rig.forearmL : rig.forearmR;
      const forearmEndpoint = wrist.position.clone().set(0, -0.205, -0.01).applyMatrix4(forearm.matrixWorld);
      const wristCenter = wrist.getWorldPosition(wrist.position.clone());
      assert.ok(
        forearmEndpoint.distanceTo(wristCenter) <= 1e-6,
        `${side} wrist must remain anchored to the forearm endpoint`,
      );

      const palmTop = palm.position.y + OPERATOR_HAND_PROFILE.palm[1] / 2;
      const palmWristOverlap = palmTop - (wrist.position.y - wristHalfHeight);
      assert.ok(
        palmWristOverlap >= 0 && palmWristOverlap <= 0.012,
        `${side} wrist must meet the palm without excessive penetration (${palmWristOverlap})`,
      );
    }

    let operatorMeshes = 0;
    rig.group.traverse((object) => { if (object.isMesh) operatorMeshes++; });
    assert.ok(operatorMeshes <= 90, `${operatorMeshes} meshes exceed the articulated operator budget`);
    assert.deepEqual(
      [...new Set(rig.parts.map((part) => part.userData.part))].sort(),
      ['arm', 'body', 'head', 'leg'],
      'finger detail must not create extra damage hitboxes',
    );
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('generic gun keeps both palms tangent and wrists anchored in idle and aim', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'none');
    const clock = { t: 0, idle: 0 };
    const poses = [
      ['idle', () => {}],
      ['aim', () => {
        for (let frame = 0; frame < 180; frame++) animateHumanoid(rig, 1 / 60, 0, clock, true, 0);
      }],
    ];

    for (const [label, applyPose] of poses) {
      applyPose();
      rig.group.updateMatrixWorld(true);
      for (const [side, hand, surface, expectedHalfThickness, forearm] of [
        ['L', rig.handL, rig.gunHandguard, 0.065, rig.forearmL],
        ['R', rig.handR, rig.gunGrip, 0.06, rig.forearmR],
      ]) {
        const { palm, wrist } = hand.userData.anatomy;
        palm.geometry.computeBoundingBox();
        surface.geometry.computeBoundingBox();
        const palmCenter = palm.getWorldPosition(palm.position.clone());
        const localPalmCenter = surface.worldToLocal(palmCenter.clone());
        const closestSurfacePoint = localPalmCenter.clone().clamp(
          surface.geometry.boundingBox.min,
          surface.geometry.boundingBox.max,
        );
        const palmCenterToSurface = localPalmCenter.distanceTo(closestSurfacePoint);
        assert.ok(
          Math.abs(palmCenterToSurface - OPERATOR_HAND_PROFILE.palm[2] / 2) <= 0.006,
          `${label} ${side} palm floats from its grip (${palmCenterToSurface})`,
        );
        assert.equal(
          surface.geometry.boundingBox.containsPoint(localPalmCenter),
          false,
          `${label} ${side} palm center penetrates the gun`,
        );

        const surfaceCenter = surface.getWorldPosition(surface.position.clone());
        const localSurfaceCenter = palm.worldToLocal(surfaceCenter.clone());
        const closestPalmPoint = localSurfaceCenter.clone().clamp(
          palm.geometry.boundingBox.min,
          palm.geometry.boundingBox.max,
        );
        assert.ok(
          Math.abs(localSurfaceCenter.distanceTo(closestPalmPoint) - expectedHalfThickness) <= 0.006,
          `${label} ${side} grip penetrates the palm core`,
        );

        const wristCenter = wrist.getWorldPosition(wrist.position.clone());
        const forearmEndpoint = wrist.position.clone().set(0, -0.205, -0.01).applyMatrix4(forearm.matrixWorld);
        assert.ok(
          wristCenter.distanceTo(forearmEndpoint) <= 1e-6,
          `${label} ${side} wrist opens a seam at the forearm`,
        );
      }
    }
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('disposing one operator never disposes the shared sprite geometry of another', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let first;
  let second;
  let sharedGeometryDisposals = 0;
  const onDispose = () => { sharedGeometryDisposals++; };
  try {
    first = makeHumanoid('#4a78aa', 'ONE', (part) => ({ part }), '#ffffff', 'none');
    second = makeHumanoid('#4a78aa', 'TWO', (part) => ({ part }), '#ffffff', 'none');
    assert.equal(first.nameSprite.geometry, second.nameSprite.geometry);
    second.nameSprite.geometry.addEventListener('dispose', onDispose);
    disposeHumanoid(first);
    first = null;
    assert.equal(sharedGeometryDisposals, 0, 'one rig disposed another operator\'s sprite geometry');
  } finally {
    second?.nameSprite.geometry.removeEventListener('dispose', onDispose);
    if (first) disposeHumanoid(first);
    if (second) disposeHumanoid(second);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
