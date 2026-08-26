import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  animateHumanoid,
  animateHumanoidDeath,
  disposeHumanoid,
  humanoidFacingOffset,
  makeHat,
  makeHumanoid,
  OPERATOR_ARM_PROFILE,
  OPERATOR_FINGER_CONTACT,
  OPERATOR_GRIP_CLEARANCE,
  OPERATOR_HAND_PROFILE,
  OPERATOR_PREVIEW_STANCE,
  OPERATOR_THUMB_CONTACT,
  resetHumanoidPose,
  setHumanoidFacingConvention,
} from '../src/humanoid.js';
import { WEAPON_PREVIEW_KINDS, buildWeaponOnlyModel } from '../src/weapon-previews.js';

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

function nearestVisibleGeometry(root, worldPoint) {
  let nearest = Infinity;
  let inside = false;
  root.updateWorldMatrix(true, true);
  root.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const local = worldPoint.clone().applyMatrix4(object.matrixWorld.clone().invert());
    const closest = local.clone().clamp(
      object.geometry.boundingBox.min,
      object.geometry.boundingBox.max,
    );
    nearest = Math.min(nearest, local.distanceTo(closest));
    inside ||= object.geometry.boundingBox.containsPoint(local);
  });
  return { nearest, inside };
}

function visibleTriangleIntersections(root, targetMesh) {
  if (!targetMesh.geometry.boundingBox) targetMesh.geometry.computeBoundingBox();
  const targetBox = targetMesh.geometry.boundingBox.clone();
  const inverseTarget = targetMesh.matrixWorld.clone().invert();
  const triangle = new THREE.Triangle();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let intersections = 0;
  root.updateWorldMatrix(true, true);
  targetMesh.updateWorldMatrix(true, false);
  root.traverseVisible((object) => {
    const positions = object.geometry?.attributes?.position;
    if (!object.isMesh || !positions) return;
    const toTarget = inverseTarget.clone().multiply(object.matrixWorld);
    const index = object.geometry.index;
    const count = index ? index.count : positions.count;
    for (let offset = 0; offset < count; offset += 3) {
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(positions, ia).applyMatrix4(toTarget);
      b.fromBufferAttribute(positions, ib).applyMatrix4(toTarget);
      c.fromBufferAttribute(positions, ic).applyMatrix4(toTarget);
      triangle.set(a, b, c);
      if (targetBox.intersectsTriangle(triangle)) intersections++;
    }
  });
  return intersections;
}

function collectWorldTriangles(rootOrMeshes) {
  const roots = Array.isArray(rootOrMeshes) ? rootOrMeshes : [rootOrMeshes];
  const triangles = [];
  const appendMesh = (mesh) => {
    const positions = mesh.geometry?.attributes?.position;
    if (!mesh.isMesh || !positions || mesh.visible === false) return;
    mesh.updateWorldMatrix(true, false);
    const index = mesh.geometry.index;
    const count = index ? index.count : positions.count;
    for (let offset = 0; offset < count; offset += 3) {
      const triangle = new THREE.Triangle(
        new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(offset) : offset)
          .applyMatrix4(mesh.matrixWorld),
        new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(offset + 1) : offset + 1)
          .applyMatrix4(mesh.matrixWorld),
        new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(offset + 2) : offset + 2)
          .applyMatrix4(mesh.matrixWorld),
      );
      triangles.push({ triangle, box: new THREE.Box3().setFromPoints([
        triangle.a, triangle.b, triangle.c,
      ]) });
    }
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    if (root.isMesh) appendMesh(root);
    else root.traverseVisible(appendMesh);
  }
  return triangles;
}

function segmentHitsTriangle(from, to, triangle) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < 1e-9) return false;
  const hit = new THREE.Ray(from, direction.multiplyScalar(1 / length))
    .intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3());
  return Boolean(hit && hit.distanceTo(from) <= length + 1e-7);
}

function trianglesIntersect(first, second) {
  const a = first.triangle;
  const b = second.triangle;
  return segmentHitsTriangle(a.a, a.b, b)
    || segmentHitsTriangle(a.b, a.c, b)
    || segmentHitsTriangle(a.c, a.a, b)
    || segmentHitsTriangle(b.a, b.b, a)
    || segmentHitsTriangle(b.b, b.c, a)
    || segmentHitsTriangle(b.c, b.a, a);
}

function exactTriangleIntersections(firstTriangles, secondTriangles) {
  let intersections = 0;
  for (const first of firstTriangles) {
    for (const second of secondTriangles) {
      if (first.box.intersectsBox(second.box) && trianglesIntersect(first, second)) intersections++;
    }
  }
  return intersections;
}

function exactTriangleSurfaceGap(firstTriangles, secondTriangles) {
  let nearest = Infinity;
  const closest = new THREE.Vector3();
  const firstPoint = new THREE.Vector3();
  const secondPoint = new THREE.Vector3();
  const firstDirection = new THREE.Vector3();
  const secondDirection = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const clampUnit = (value) => Math.min(1, Math.max(0, value));
  const segmentGap = (firstStart, firstEnd, secondStart, secondEnd) => {
    firstDirection.subVectors(firstEnd, firstStart);
    secondDirection.subVectors(secondEnd, secondStart);
    relative.subVectors(firstStart, secondStart);
    const firstLengthSq = firstDirection.lengthSq();
    const secondLengthSq = secondDirection.lengthSq();
    const epsilon = 1e-12;
    let firstAmount = 0;
    let secondAmount = 0;
    if (firstLengthSq <= epsilon && secondLengthSq <= epsilon) {
      return firstStart.distanceTo(secondStart);
    }
    if (firstLengthSq <= epsilon) {
      secondAmount = clampUnit(secondDirection.dot(relative) / secondLengthSq);
    } else {
      const firstRelative = firstDirection.dot(relative);
      if (secondLengthSq <= epsilon) {
        firstAmount = clampUnit(-firstRelative / firstLengthSq);
      } else {
        const directionsDot = firstDirection.dot(secondDirection);
        const secondRelative = secondDirection.dot(relative);
        const denominator = firstLengthSq * secondLengthSq - directionsDot ** 2;
        if (Math.abs(denominator) > epsilon) {
          firstAmount = clampUnit(
            (directionsDot * secondRelative - firstRelative * secondLengthSq) / denominator,
          );
        }
        const projectedSecond = directionsDot * firstAmount + secondRelative;
        if (projectedSecond < 0) {
          secondAmount = 0;
          firstAmount = clampUnit(-firstRelative / firstLengthSq);
        } else if (projectedSecond > secondLengthSq) {
          secondAmount = 1;
          firstAmount = clampUnit((directionsDot - firstRelative) / firstLengthSq);
        } else {
          secondAmount = projectedSecond / secondLengthSq;
        }
      }
    }
    firstPoint.copy(firstDirection).multiplyScalar(firstAmount).add(firstStart);
    secondPoint.copy(secondDirection).multiplyScalar(secondAmount).add(secondStart);
    return firstPoint.distanceTo(secondPoint);
  };
  const compareVertices = (sources, targets) => {
    for (const source of sources) {
      for (const point of [source.triangle.a, source.triangle.b, source.triangle.c]) {
        for (const target of targets) {
          target.triangle.closestPointToPoint(point, closest);
          nearest = Math.min(nearest, point.distanceTo(closest));
        }
      }
    }
  };
  compareVertices(firstTriangles, secondTriangles);
  compareVertices(secondTriangles, firstTriangles);
  const boxGap = (first, second) => {
    const x = Math.max(0, first.min.x - second.max.x, second.min.x - first.max.x);
    const y = Math.max(0, first.min.y - second.max.y, second.min.y - first.max.y);
    const z = Math.max(0, first.min.z - second.max.z, second.min.z - first.max.z);
    return Math.hypot(x, y, z);
  };
  for (const first of firstTriangles) {
    const firstEdges = [
      [first.triangle.a, first.triangle.b],
      [first.triangle.b, first.triangle.c],
      [first.triangle.c, first.triangle.a],
    ];
    for (const second of secondTriangles) {
      if (boxGap(first.box, second.box) >= nearest) continue;
      const secondEdges = [
        [second.triangle.a, second.triangle.b],
        [second.triangle.b, second.triangle.c],
        [second.triangle.c, second.triangle.a],
      ];
      for (const firstEdge of firstEdges) {
        for (const secondEdge of secondEdges) {
          nearest = Math.min(nearest, segmentGap(...firstEdge, ...secondEdge));
        }
      }
    }
  }
  return nearest;
}

function distalTip(digit) {
  return new THREE.Vector3(0, digit.distal.position.y * 2, 0)
    .applyMatrix4(digit.distalJoint.matrixWorld);
}

function nearestTriangleDistance(triangles, point) {
  const closest = new THREE.Vector3();
  let nearest = Infinity;
  for (const entry of triangles) {
    entry.triangle.closestPointToPoint(point, closest);
    nearest = Math.min(nearest, point.distanceTo(closest));
  }
  return nearest;
}

const insideDirections = [
  new THREE.Vector3(1, 0.173, 0.311).normalize(),
  new THREE.Vector3(-0.217, 1, 0.419).normalize(),
  new THREE.Vector3(0.293, -0.367, 1).normalize(),
];

function pointInsideGeometry(geometry, point, direction) {
  const positions = geometry?.attributes?.position;
  if (!positions) return false;
  const index = geometry.index;
  const count = index ? index.count : positions.count;
  const ray = new THREE.Ray(point, direction);
  const triangle = new THREE.Triangle();
  const hit = new THREE.Vector3();
  const distances = [];
  for (let offset = 0; offset < count; offset += 3) {
    triangle.a.fromBufferAttribute(positions, index ? index.getX(offset) : offset);
    triangle.b.fromBufferAttribute(positions, index ? index.getX(offset + 1) : offset + 1);
    triangle.c.fromBufferAttribute(positions, index ? index.getX(offset + 2) : offset + 2);
    if (!ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) continue;
    const distance = hit.distanceTo(point);
    if (distance > 1e-6 && !distances.some((value) => Math.abs(value - distance) < 1e-5)) {
      distances.push(distance);
    }
  }
  return distances.length % 2 === 1;
}

function pointInsideVisibleGeometry(root, worldPoint) {
  let inside = false;
  root.traverseVisible((mesh) => {
    if (inside || !mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const localPoint = mesh.worldToLocal(worldPoint.clone());
    let votes = 0;
    for (const direction of insideDirections) {
      if (pointInsideGeometry(mesh.geometry, localPoint, direction)) votes++;
    }
    inside = votes >= 2;
  });
  return inside;
}

function meshesHaveVertexInside(root, meshes) {
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.attributes.position;
    // Sin cruces de superficie, un vertice basta para detectar si toda la
    // falange quedo encerrada; muestreamos todos para dar un error mas claro.
    for (let index = 0; index < positions.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld);
      if (pointInsideVisibleGeometry(root, point)) return true;
    }
  }
  return false;
}

function assertHandSelfCollisionFree(label, hand) {
  const { palm, fingers, thumb } = hand.userData.anatomy;
  const palmTriangles = collectWorldTriangles(palm);
  const digits = [];
  for (const [name, finger] of Object.entries(fingers)) {
    const fullMeshes = [finger.proximal, finger.intermediate, finger.distal];
    const freeMeshes = [finger.intermediate, finger.distal];
    const freeTriangles = collectWorldTriangles(freeMeshes);
    assert.equal(
      exactTriangleIntersections(palmTriangles, freeTriangles),
      0,
      `${label} ${name} folds through its palm`,
    );
    assert.equal(
      meshesHaveVertexInside(palm, freeMeshes),
      false,
      `${label} ${name} is enclosed by its palm`,
    );
    digits.push([name, collectWorldTriangles(fullMeshes)]);
  }
  const thumbMeshes = [thumb.proximal, thumb.distal];
  const thumbFreeTriangles = collectWorldTriangles(thumb.distal);
  assert.equal(
    exactTriangleIntersections(palmTriangles, thumbFreeTriangles),
    0,
    `${label} thumb folds through its palm`,
  );
  assert.equal(
    meshesHaveVertexInside(palm, [thumb.distal]),
    false,
    `${label} thumb is enclosed by its palm`,
  );
  digits.push(['thumb', collectWorldTriangles(thumbMeshes)]);
  for (let first = 0; first < digits.length; first++) {
    for (let second = first + 1; second < digits.length; second++) {
      assert.equal(
        exactTriangleIntersections(digits[first][1], digits[second][1]),
        0,
        `${label} ${digits[first][0]} intersects ${digits[second][0]}`,
      );
    }
  }
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
    assert.ok(triangles <= 12500, `${triangles} triangles exceed the operator budget`);
    assert.deepEqual(rig.head.geometry.parameters, {
      width: 0.42, height: 0.42, depth: 0.42, segments: 2, radius: 0.055,
    });
    assert.deepEqual(
      [...new Set(rig.parts.map((part) => part.userData.part))].sort(),
      ['arm', 'body', 'head', 'leg'],
    );
    const armHitboxes = rig.parts.filter((part) => part.userData.part === 'arm');
    assert.equal(armHitboxes.length, 2, 'visual forearms must not add damage targets');
    rig.group.updateMatrixWorld(true);
    for (const hitbox of armHitboxes) {
      assert.deepEqual(
        [hitbox.geometry.parameters.width, hitbox.geometry.parameters.height, hitbox.geometry.parameters.depth],
        [0.18, 0.6, 0.22],
        'arm damage volume changed with the visual anatomy',
      );
      assert.equal(hitbox.material.visible, false, 'legacy damage volume leaked into the render');
      const center = hitbox.getWorldPosition(new THREE.Vector3());
      const direction = new THREE.Vector3(-1, 0, 0).applyQuaternion(
        hitbox.getWorldQuaternion(new THREE.Quaternion()),
      );
      const origin = center.clone().addScaledVector(direction, -1);
      assert.ok(
        new THREE.Raycaster(origin, direction).intersectObject(hitbox).length > 0,
        'invisible visual separation disabled arm hit detection',
      );
    }
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('operator gloves expose articulated proportions without opening wrist seams', () => {
  assert.equal(Object.isFrozen(OPERATOR_HAND_PROFILE), true);
  for (const key of [
    'palm', 'wrist', 'fingerLengths', 'fingerCurls', 'middleCurls', 'distalCurls',
  ]) {
    assert.equal(Object.isFrozen(OPERATOR_HAND_PROFILE[key]), true, `${key} must be immutable`);
  }
  assert.equal(OPERATOR_HAND_PROFILE.segmentsPerFinger, 3);
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
      assert.ok(triangles <= 750, `${side} glove uses ${triangles} triangles`);
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
        assert.equal(finger.intermediate.name, `hand${side}-${fingerName}-intermediate`);
        assert.equal(finger.distal.name, `hand${side}-${fingerName}-distal`);
        assert.ok(
          Math.abs(
            finger.proximal.scale.y + finger.intermediate.scale.y + finger.distal.scale.y
              - finger.totalLength,
          ) < 1e-9,
          `${side} ${fingerName} changes its declared length`,
        );
        assert.equal(finger.totalLength, OPERATOR_HAND_PROFILE.fingerLengths[index]);
        assert.ok(finger.root.rotation.x > 0, `${side} ${fingerName} has no grip curl`);
        assert.ok(finger.intermediateJoint.rotation.x > 0, `${side} ${fingerName} PIP is rigid`);
        assert.ok(finger.distalJoint.rotation.x > 0, `${side} ${fingerName} DIP is rigid`);
      });

      assert.equal(thumb.root.name, `hand${side}-thumb`);
      assert.equal(thumb.proximal.name, `hand${side}-thumb-proximal`);
      assert.equal(thumb.distal.name, `hand${side}-thumb-distal`);
      assert.ok(OPERATOR_THUMB_CONTACT.ar[side === 'L' ? 'left' : 'right']);
      assert.equal(thumb.root.userData.contact, true, 'thumb must keep its grip contact role');

      const wristHalfHeight = OPERATOR_HAND_PROFILE.wrist[1] / 2;
      rig.group.updateMatrixWorld(true);
      const forearm = side === 'L' ? rig.forearmL : rig.forearmR;
      const forearmEndpoint = new THREE.Vector3(
        0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
      ).applyMatrix4(forearm.matrixWorld);
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
    assert.ok(operatorMeshes <= 104, `${operatorMeshes} meshes exceed the articulated operator budget`);
    assert.ok(
      Math.abs(
        rig.handR.userData.anatomy.fingers.index.root.rotation.x
          - rig.handR.userData.anatomy.fingers.middle.root.rotation.x,
      ) > 0.03,
      'the trigger index must remain independent from the gripping fingers',
    );
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

test('operator arms keep human proportions and continuous joints through tactical poses', () => {
  assert.equal(Object.isFrozen(OPERATOR_ARM_PROFILE), true);
  for (const key of ['upper', 'forearm', 'shoulder', 'elbow', 'cuff']) {
    assert.equal(Object.isFrozen(OPERATOR_ARM_PROFILE[key]), true, `${key} must be immutable`);
  }
  const ratio = OPERATOR_ARM_PROFILE.forearmLength / OPERATOR_ARM_PROFILE.upperLength;
  assert.ok(ratio >= 0.82 && ratio <= 1.05, `forearm/upper-arm ratio is ${ratio}`);
  assert.ok(
    Math.abs(OPERATOR_ARM_PROFILE.upperLength + OPERATOR_ARM_PROFILE.forearmLength - 0.725) < 1e-9,
    'the visual redesign changed total reach',
  );

  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'none');
    const clock = { t: 0, idle: 0 };
    const poses = [
      { aiming: false, pitch: 0 },
      { aiming: true, pitch: -1.15 },
      { aiming: true, pitch: 0 },
      { aiming: true, pitch: 1.15 },
    ];

    for (const pose of poses) {
      for (let frame = 0; frame < 90; frame++) {
        animateHumanoid(rig, 1 / 60, 0, clock, pose.aiming, pose.pitch);
      }
      rig.group.updateMatrixWorld(true);
      for (const [side, arm, forearm, hand] of [
        ['L', rig.armL, rig.forearmL, rig.handL],
        ['R', rig.armR, rig.forearmR, rig.handR],
      ]) {
        const anatomy = arm.userData.anatomy;
        assert.equal(anatomy.shoulder.parent, rig.torso, `${side} shoulder must stay on torso`);
        assert.equal(
          Object.values(anatomy).filter((part) => part?.isMesh).length,
          OPERATOR_ARM_PROFILE.meshBudgetPerArm,
        );
        const shoulder = arm.getWorldPosition(new THREE.Vector3());
        const elbow = forearm.getWorldPosition(new THREE.Vector3());
        const wrist = hand.userData.anatomy.wrist.getWorldPosition(new THREE.Vector3());
        const endpoint = new THREE.Vector3(
          0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
        ).applyMatrix4(forearm.matrixWorld);
        assert.ok(
          Math.abs(shoulder.distanceTo(elbow) - OPERATOR_ARM_PROFILE.upperLength) < 1e-6,
          `${side} upper arm changed length`,
        );
        assert.ok(
          Math.abs(elbow.distanceTo(wrist) - OPERATOR_ARM_PROFILE.forearmLength) < 1e-6,
          `${side} forearm changed length`,
        );
        assert.ok(endpoint.distanceTo(wrist) < 1e-6, `${side} wrist opened a seam`);
        assert.ok(
          anatomy.shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(shoulder) < 0.08,
          `${side} rotating arm escaped its fixed shoulder socket`,
        );
        for (const value of [...arm.matrixWorld.elements, ...forearm.matrixWorld.elements, ...hand.matrixWorld.elements]) {
          assert.equal(Number.isFinite(value), true, `${side} pose produced an invalid matrix`);
        }
      }
    }
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('all seven preview weapons drive canonical hand targets and finger roles', () => {
  assert.equal(Object.isFrozen(OPERATOR_GRIP_CLEARANCE), true);
  assert.equal(Object.isFrozen(OPERATOR_GRIP_CLEARANCE.left), true);
  assert.equal(Object.isFrozen(OPERATOR_GRIP_CLEARANCE.right), true);
  for (const kind of WEAPON_PREVIEW_KINDS) {
    assert.equal(Object.isFrozen(OPERATOR_GRIP_CLEARANCE.left[kind]), true);
    assert.equal(Object.isFrozen(OPERATOR_GRIP_CLEARANCE.right[kind]), true);
    assert.equal(Object.isFrozen(OPERATOR_THUMB_CONTACT[kind]), true);
    assert.equal(Object.isFrozen(OPERATOR_THUMB_CONTACT[kind].left), true);
    assert.equal(Object.isFrozen(OPERATOR_THUMB_CONTACT[kind].right), true);
    assert.equal(Object.isFrozen(OPERATOR_FINGER_CONTACT[kind]), true);
    assert.equal(Object.isFrozen(OPERATOR_FINGER_CONTACT[kind].left), true);
    assert.equal(Object.isFrozen(OPERATOR_FINGER_CONTACT[kind].right), true);
    assert.equal(Object.isFrozen(OPERATOR_PREVIEW_STANCE[kind]), true);
  }
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  const basis = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

  try {
    for (const kind of WEAPON_PREVIEW_KINDS) {
      let rig;
      try {
        rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'none');
        const weapon = buildWeaponOnlyModel(kind);
        const scale = 1.03;
        weapon.scale.setScalar(scale);
        rig.gun.add(weapon);
        assert.equal(rig.setOperatorWeaponGrip(kind, scale), kind);
        assert.equal(rig.getOperatorWeaponGripKind(), kind);
        rig.group.updateMatrixWorld(true);
        const weaponTriangles = collectWorldTriangles(weapon);

        const canonical = weapon.userData.viewmodel.grip;
        for (const [side, target, hand, pose, clearance] of [
          [
            'R', rig.gripTargets.right, rig.handR, canonical.right,
            OPERATOR_GRIP_CLEARANCE.right[kind],
          ],
          [
            'L', rig.gripTargets.left, rig.handL, canonical.left,
            OPERATOR_GRIP_CLEARANCE.left[kind],
          ],
        ]) {
          const expectedQuaternion = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(...pose.rotation))
            .multiply(basis);
          const expectedPosition = new THREE.Vector3(...pose.position).multiplyScalar(scale)
            .add(new THREE.Vector3(...clearance).applyQuaternion(expectedQuaternion));
          assert.ok(
            target.position.distanceTo(expectedPosition) < 1e-9,
            `${kind} ${side} ignored its canonical grip position`,
          );
          assert.ok(
            target.quaternion.angleTo(expectedQuaternion) < 1e-6,
            `${kind} ${side} ignored its canonical grip rotation`,
          );
          assert.equal(hand.userData.role, pose.role, `${kind} ${side} lost its hand role`);
          const palmCenter = hand.userData.anatomy.palm.getWorldPosition(new THREE.Vector3());
          const contact = nearestVisibleGeometry(weapon, palmCenter);
          assert.equal(contact.inside, false, `${kind} ${side} palm center penetrates the weapon`);
          assert.ok(contact.nearest <= 0.15, `${kind} ${side} palm floats ${contact.nearest}`);
          assert.equal(
            visibleTriangleIntersections(weapon, hand.userData.anatomy.palm),
            0,
            `${kind} ${side} weapon geometry clips through the palm`,
          );
          const wrist = hand.userData.anatomy.wrist.getWorldPosition(new THREE.Vector3());
          const forearm = side === 'L' ? rig.forearmL : rig.forearmR;
          const endpoint = new THREE.Vector3(
            0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
          ).applyMatrix4(forearm.matrixWorld);
          assert.ok(endpoint.distanceTo(wrist) < 1e-6, `${kind} ${side} wrist detached`);

          const thumb = hand.userData.anatomy.thumb;
          const thumbTriangles = collectWorldTriangles([thumb.proximal, thumb.distal]);
          assert.equal(
            exactTriangleIntersections(weaponTriangles, thumbTriangles),
            0,
            `${kind} ${side} thumb clips through the weapon`,
          );
          assert.equal(
            meshesHaveVertexInside(weapon, [thumb.proximal, thumb.distal]),
            false,
            `${kind} ${side} thumb is enclosed by the weapon`,
          );
          const thumbGap = exactTriangleSurfaceGap(weaponTriangles, thumbTriangles);
          assert.ok(
            thumbGap >= 0.00025 && thumbGap <= 0.0155,
            `${kind} ${side} thumb surface gap is ${(thumbGap * 1000).toFixed(2)} mm`,
          );
          assert.ok(
            nearestTriangleDistance(weaponTriangles, distalTip(thumb)) <= 0.04,
            `${kind} ${side} thumb tip does not reach its grip`,
          );

          for (const [fingerName, finger] of Object.entries(hand.userData.anatomy.fingers)) {
            const meshes = [finger.proximal, finger.intermediate, finger.distal];
            const fingerTriangles = collectWorldTriangles(meshes);
            assert.equal(
              exactTriangleIntersections(weaponTriangles, fingerTriangles),
              0,
              `${kind} ${side} ${fingerName} clips through the weapon`,
            );
            assert.equal(
              meshesHaveVertexInside(weapon, meshes),
              false,
              `${kind} ${side} ${fingerName} is enclosed by the weapon`,
            );
            const separatedTrigger = side === 'R' && fingerName === 'index' && kind !== 'launcher';
            if (!separatedTrigger) {
              const fingerGap = exactTriangleSurfaceGap(weaponTriangles, fingerTriangles);
              assert.ok(
                fingerGap >= 0.0002 && fingerGap <= 0.0155,
                `${kind} ${side} ${fingerName} surface gap is ${(fingerGap * 1000).toFixed(2)} mm`,
              );
            }
          }
          assertHandSelfCollisionFree(`${kind} ${side}`, hand);
        }
        const stance = rig.setOperatorPreviewStance();
        assert.equal(stance, OPERATOR_PREVIEW_STANCE[kind]);
        assert.equal(rig.gun.position.z, stance.z);
        assert.equal(rig.gun.rotation.y, stance.yaw);
        rig.group.updateMatrixWorld(true);
        const obstacleTriangles = collectWorldTriangles([rig.body, rig.armor]);
        const limbTriangles = collectWorldTriangles([rig.forearmL, rig.forearmR]);
        assert.equal(
          exactTriangleIntersections(obstacleTriangles, limbTriangles),
          0,
          `${kind} preview forearms clip through the torso`,
        );
        const limbMeshes = [];
        for (const root of [rig.forearmL, rig.forearmR]) {
          root.traverseVisible((object) => {
            if (object.isMesh && object.geometry?.attributes?.position) limbMeshes.push(object);
          });
        }
        assert.equal(
          meshesHaveVertexInside(rig.body, limbMeshes),
          false,
          `${kind} preview forearms are enclosed by the body`,
        );
        assert.equal(
          meshesHaveVertexInside(rig.armor, limbMeshes),
          false,
          `${kind} preview forearms are enclosed by the armor`,
        );
        for (const [side, hand, forearm] of [
          ['L', rig.handL, rig.forearmL],
          ['R', rig.handR, rig.forearmR],
        ]) {
          const wrist = hand.userData.anatomy.wrist.getWorldPosition(new THREE.Vector3());
          const endpoint = new THREE.Vector3(
            0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
          ).applyMatrix4(forearm.matrixWorld);
          assert.ok(endpoint.distanceTo(wrist) < 1e-6, `${kind} preview detached ${side} wrist`);
        }
        assert.ok(
          Math.abs(
            rig.handR.userData.anatomy.fingers.index.root.rotation.x
              - rig.handR.userData.anatomy.fingers.middle.root.rotation.x,
          ) > 0.03,
          `${kind} trigger finger closes like the other fingers`,
        );
      } finally {
        if (rig) disposeHumanoid(rig);
      }
    }
  } finally {
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
      const weaponTriangles = collectWorldTriangles(rig.gun);
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
        const forearmEndpoint = new THREE.Vector3(
          0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
        ).applyMatrix4(forearm.matrixWorld);
        assert.ok(
          wristCenter.distanceTo(forearmEndpoint) <= 1e-6,
          `${label} ${side} wrist opens a seam at the forearm`,
        );

        const { fingers, thumb } = hand.userData.anatomy;
        const thumbMeshes = [thumb.proximal, thumb.distal];
        const thumbTriangles = collectWorldTriangles(thumbMeshes);
        assert.equal(
          exactTriangleIntersections(weaponTriangles, thumbTriangles),
          0,
          `${label} ${side} generic thumb clips through the weapon`,
        );
        assert.equal(
          meshesHaveVertexInside(rig.gun, thumbMeshes),
          false,
          `${label} ${side} generic thumb is enclosed by the weapon`,
        );
        const thumbGap = exactTriangleSurfaceGap(weaponTriangles, thumbTriangles);
        assert.ok(
          thumbGap >= 0.00025 && thumbGap <= 0.0155,
          `${label} ${side} generic thumb surface gap is ${(thumbGap * 1000).toFixed(2)} mm`,
        );
        for (const [fingerName, finger] of Object.entries(fingers)) {
          const meshes = [finger.proximal, finger.intermediate, finger.distal];
          const fingerTriangles = collectWorldTriangles(meshes);
          assert.equal(
            exactTriangleIntersections(weaponTriangles, fingerTriangles),
            0,
            `${label} ${side} generic ${fingerName} clips through the weapon`,
          );
          assert.equal(
            meshesHaveVertexInside(rig.gun, meshes),
            false,
            `${label} ${side} generic ${fingerName} is enclosed by the weapon`,
          );
          if (!(side === 'R' && fingerName === 'index')) {
            const fingerGap = exactTriangleSurfaceGap(weaponTriangles, fingerTriangles);
            assert.ok(
              fingerGap >= 0.0002 && fingerGap <= 0.0155,
              `${label} ${side} generic ${fingerName} surface gap is ${(fingerGap * 1000).toFixed(2)} mm`,
            );
          }
        }
        assertHandSelfCollisionFree(`${label} ${side} generic`, hand);
      }
    }
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('death and respawn keep the weapon chain deterministic without changing logical yaw', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let aimed;
  let sprinting;
  const assertWristSeams = (rig, label) => {
    rig.group.updateMatrixWorld(true);
    for (const [side, hand, forearm] of [
      ['L', rig.handL, rig.forearmL],
      ['R', rig.handR, rig.forearmR],
    ]) {
      const wrist = hand.userData.anatomy.wrist.getWorldPosition(new THREE.Vector3());
      const endpoint = new THREE.Vector3(
        0, -OPERATOR_ARM_PROFILE.forearmLength, 0,
      ).applyMatrix4(forearm.matrixWorld);
      assert.ok(endpoint.distanceTo(wrist) < 1e-6, `${label} opened ${side} wrist seam`);
    }
  };
  try {
    aimed = makeHumanoid('#4a78aa', 'AIM', (part) => ({ part }), '#ffffff', 'none');
    sprinting = makeHumanoid('#4a78aa', 'RUN', (part) => ({ part }), '#ffffff', 'none');
    aimed.group.rotation.y = 0.73;
    sprinting.group.rotation.y = -1.12;
    const aimedClock = { t: 0, idle: 0 };
    const sprintClock = { t: 2.4, idle: 2.4 };
    for (let frame = 0; frame < 90; frame++) {
      animateHumanoid(aimed, 1 / 60, 0, aimedClock, true, 1.1);
      animateHumanoid(sprinting, 1 / 60, 7, sprintClock, false, -0.8);
    }

    animateHumanoidDeath(aimed, 0.72, -1);
    animateHumanoidDeath(sprinting, 0.72, -1);
    assert.equal(aimed.group.rotation.y, 0.73, 'death changed aimed logical yaw');
    assert.equal(sprinting.group.rotation.y, -1.12, 'death changed sprint logical yaw');
    for (const key of ['torso', 'gun', 'armL', 'armR', 'forearmL', 'forearmR', 'handL', 'handR']) {
      assert.ok(
        aimed[key].position.distanceTo(sprinting[key].position) < 1e-7,
        `${key} retained a previous translation during death`,
      );
      assert.ok(
        aimed[key].quaternion.angleTo(sprinting[key].quaternion) < 1e-7,
        `${key} retained a previous rotation during death`,
      );
    }
    assertWristSeams(aimed, 'death');
    assertWristSeams(sprinting, 'death');

    resetHumanoidPose(aimed);
    assert.equal(aimed.group.rotation.y, 0.73, 'respawn changed logical yaw');
    assert.equal(aimed.armL.position.x, -0.4);
    assert.equal(aimed.armR.position.x, 0.4);
    assertWristSeams(aimed, 'respawn');
  } finally {
    if (aimed) disposeHumanoid(aimed);
    if (sprinting) disposeHumanoid(sprinting);
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
