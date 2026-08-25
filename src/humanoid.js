import * as THREE from 'three';
import { humanoidModelProfile } from './ui-models.js';
import {
  clamp01,
  operatorDeathState,
  operatorMotionState,
} from './character-motion.js';
import { roundedBoxGeometry } from './rounded-geometry.js';

// ---------------------------------------------------------------------------
// Modelo humanoide "blocky" compartido por bots locales y jugadores remotos.
// ---------------------------------------------------------------------------

// Los volúmenes exteriores siguen siendo idénticos a los hitboxes originales.
// Las piezas grandes reciben un bisel un poco más suave, mientras los detalles
// finos usan un solo segmento para mantener estable el presupuesto por operador.
function operatorBoxGeometry(width, height, depth) {
  const shortest = Math.min(Math.abs(width), Math.abs(height), Math.abs(depth));
  return roundedBoxGeometry(width, height, depth, {
    ratio: shortest < 0.07 ? 0.12 : shortest < 0.16 ? 0.15 : 0.18,
    maxRadius: shortest < 0.07 ? 0.008 : 0.055,
    segments: shortest >= 0.16 ? 2 : 1,
  });
}

const freezeVector = (values) => Object.freeze([...values]);

// Proporciones compactas para que la mano siga siendo legible a distancia sin
// volverla un bloque. Las falanges usan geometría compartida de pocos lados y
// no participan en el raycast: el hitbox de brazo conserva su tamaño original.
export const OPERATOR_HAND_PROFILE = Object.freeze({
  palm: freezeVector([0.19, 0.14, 0.21]),
  wrist: freezeVector([0.16, 0.06, 0.18]),
  fingerLengths: freezeVector([0.086, 0.098, 0.092, 0.075]),
  fingerCurls: freezeVector([0.42, 0.48, 0.53, 0.58]),
  distalCurls: freezeVector([0.62, 0.67, 0.72, 0.78]),
  thumbLength: 0.073,
  segmentsPerFinger: 2,
  meshBudgetPerHand: 13,
});

export function makeNameSprite(name, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.font = "italic 900 26px 'Arial Black', Arial";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(name, 128, 24);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 24);
  const tex = new THREE.CanvasTexture(canvas);
  // depthTest activado: las paredes ocultan el nombre (nada de wallhack)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sprite.scale.set(1.9, 0.36, 1);
  return sprite;
}

// sombreros comprables, construidos con cajas sobre la cabeza
export function makeHat(type) {
  if (!type || type === 'none') return null;
  const g = new THREE.Group();
  const add = (color, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(operatorBoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  if (type === 'cap') {
    add(0x2e6fd8, 0.46, 0.14, 0.46, 0, 0.07, 0);
    add(0x2e6fd8, 0.4, 0.05, 0.24, 0, 0.02, -0.32); // visera
  } else if (type === 'top') {
    add(0x1a1a1e, 0.52, 0.06, 0.52, 0, 0.03, 0);    // ala
    add(0x1a1a1e, 0.34, 0.42, 0.34, 0, 0.26, 0);    // copa
    add(0xd83a2e, 0.36, 0.07, 0.36, 0, 0.1, 0);     // cinta
  } else if (type === 'crown') {
    add(0xf2c94c, 0.44, 0.14, 0.44, 0, 0.07, 0);
    for (const [px, pz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16], [0, 0]]) {
      add(0xf2c94c, 0.08, 0.16, 0.08, px, 0.2, pz);
    }
  }
  return g;
}

// Devuelve el rig completo. `userData` se asigna a cada malla golpeable
// para que el raycast de las armas identifique a quién y dónde ha dado.
export function makeHumanoid(color, name, userDataFor, nameColor, hat) {
  const accentColor = new THREE.Color(color);
  accentColor.offsetHSL(0, 0.04, 0.18);
  const uniform = new THREE.MeshLambertMaterial({ color });
  const uniformDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.48) });
  const uniformMid = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.72) });
  const uniformAccent = new THREE.MeshLambertMaterial({ color: accentColor });
  const armor = new THREE.MeshLambertMaterial({ color: 0x202a35 });
  const armorEdge = new THREE.MeshLambertMaterial({ color: 0x3f5365 });
  const skinTone = new THREE.MeshLambertMaterial({ color: 0xe0aa7a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x202a34 });
  const boot = new THREE.MeshLambertMaterial({ color: 0x111821 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x1b242d, roughness: 0.94, metalness: 0.01 });
  const glovePanel = new THREE.MeshStandardMaterial({ color: 0x394957, roughness: 0.8, metalness: 0.015 });
  const gloveGrip = new THREE.MeshStandardMaterial({ color: 0x0e141a, roughness: 1, metalness: 0 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x11161d });
  const visor = new THREE.MeshLambertMaterial({ color: 0x152b3a });
  const statusLight = new THREE.MeshBasicMaterial({ color: accentColor });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x292e36 });
  const gunAccent = new THREE.MeshLambertMaterial({ color: 0x59636d });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.9 });

  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const parts = [];
  const profile = humanoidModelProfile();
  const armorGroup = new THREE.Group();
  const headgear = new THREE.Group();
  const equipment = new THREE.Group();
  const headPivot = new THREE.Group();
  armorGroup.name = 'armor';
  headgear.name = 'headgear';
  equipment.name = 'equipment';
  headPivot.name = 'headPivot';
  headPivot.position.set(0, 1.66, 0);
  headPivot.add(headgear);
  torso.add(armorGroup, equipment, headPivot);

  const add = (geometry, material, x, y, z, partName, parent = group) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (partName) {
      m.userData = userDataFor(partName);
      parts.push(m);
    }
    parent.add(m);
    return m;
  };

  const box = (w, h, d, mat, x, y, z, partName, parent) => add(
    operatorBoxGeometry(w, h, d), mat, x, y, z, partName, parent,
  );
  const sphere = (radius, mat, x, y, z, partName, parent) => add(
    new THREE.SphereGeometry(radius, 12, 8), mat, x, y, z, partName, parent,
  );

  const legL = new THREE.Group(); legL.position.set(-0.15, 0.8, 0);
  const legR = new THREE.Group(); legR.position.set(0.15, 0.8, 0);
  legL.name = 'legL';
  legR.name = 'legR';
  group.add(legL, legR);
  box(...profile.leg, pants, 0, -0.4, 0, 'leg', legL);
  box(...profile.leg, pants, 0, -0.4, 0, 'leg', legR);
  box(0.22, 0.12, 0.38, boot, 0, -0.82, -0.08, 'leg', legL);
  box(0.22, 0.12, 0.38, boot, 0, -0.82, -0.08, 'leg', legR);
  box(0.27, 0.08, 0.46, metal, 0, -0.78, -0.12, null, legL);
  box(0.27, 0.08, 0.46, metal, 0, -0.78, -0.12, null, legR);
  box(0.2, 0.12, 0.05, armorEdge, 0, -0.22, -0.14, null, legL);
  box(0.2, 0.12, 0.05, armorEdge, 0, -0.22, -0.14, null, legR);

  const body = new THREE.Group();
  body.name = 'body';
  torso.add(body);
  box(...profile.body, uniform, 0, 1.11, 0, 'body', body);
  box(0.48, 0.08, 0.36, uniformDark, 0, 0.8, 0, null, body);

  // Chaleco, placas y bolsillos: son decoración y no crean nuevos hitboxes.
  box(...profile.vest, armor, 0, 1.11, 0, null, armorGroup);
  box(0.43, 0.32, 0.045, armorEdge, 0, 1.2, -0.24, null, armorGroup);
  box(0.07, 0.31, 0.05, metal, -0.2, 1.2, -0.27, null, armorGroup);
  box(0.07, 0.31, 0.05, metal, 0.2, 1.2, -0.27, null, armorGroup);
  box(0.15, 0.13, 0.07, armorEdge, -0.24, 0.94, -0.25, null, armorGroup);
  box(0.15, 0.13, 0.07, armorEdge, 0.24, 0.94, -0.25, null, armorGroup);
  for (const x of [-0.16, 0, 0.16]) {
    box(0.12, 0.19, 0.07, armorEdge, x, 0.98, -0.28, null, armorGroup);
    box(0.07, 0.035, 0.018, uniformAccent, x, 1.03, -0.325, null, armorGroup);
  }
  box(0.7, 0.08, 0.44, uniformDark, 0, 0.82, 0, null, armorGroup);
  box(0.13, 0.07, 0.04, uniformAccent, 0, 0.82, -0.24, null, armorGroup);
  box(0.2, 0.07, 0.025, statusLight, -0.1, 1.36, -0.265, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, -0.38, 1.3, 0, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, 0.38, 1.3, 0, null, armorGroup);

  // Mochila, correas y radio para dar una silueta reconocible desde atrás.
  box(...profile.backpack, armor, 0, 1.12, 0.29, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, -0.2, 1.12, 0.23, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, 0.2, 1.12, 0.23, null, equipment);
  box(0.14, 0.2, 0.08, metal, 0.28, 1.35, 0.04, null, equipment);
  box(0.04, 0.28, 0.04, armorEdge, 0.28, 1.58, 0.04, null, equipment);
  box(0.18, 0.34, 0.16, armor, 0.39, 0.75, 0.04, null, equipment);
  box(0.2, 0.06, 0.18, armorEdge, 0.39, 0.9, 0.04, null, equipment);

  const head = box(0.42, 0.42, 0.42, skinTone, 0, 0, 0, 'head', headPivot);
  const faceVisor = box(0.28, 0.08, 0.04, visor, 0, 0.1, -0.22, null, headgear);
  faceVisor.castShadow = false;
  box(...profile.helmet, armor, 0, 0.25, 0, null, headgear);
  box(0.56, 0.08, 0.5, armorEdge, 0, 0.16, 0, null, headgear);
  box(0.07, 0.06, 0.34, uniformAccent, 0, 0.31, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, -0.27, 0.2, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, 0.27, 0.2, 0, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, -0.32, -0.03, -0.03, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, 0.32, -0.03, -0.03, null, headgear);
  box(0.04, 0.04, 0.32, metal, 0.25, -0.02, -0.14, null, headgear).rotation.x = 0.35;
  box(0.08, 0.07, 0.06, statusLight, 0.25, -0.07, -0.29, null, headgear);

  const armL = new THREE.Group(); armL.position.set(-0.4, 1.34, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.34, 0);
  armL.name = 'armL';
  armR.name = 'armR';
  torso.add(armL, armR);
  const forearmL = new THREE.Group(); forearmL.position.set(0, -0.52, 0);
  const forearmR = new THREE.Group(); forearmR.position.set(0, -0.52, 0);
  forearmL.name = 'forearmL';
  forearmR.name = 'forearmR';
  armL.add(forearmL);
  armR.add(forearmR);
  const upperArmL = box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armL);
  const upperArmR = box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armR);
  upperArmL.name = 'upperArmL';
  upperArmR.name = 'upperArmR';
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armL);
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armR);
  box(0.24, 0.07, 0.28, uniformAccent, 0, -0.03, -0.01, null, armL);
  box(0.24, 0.07, 0.28, uniformAccent, 0, -0.03, -0.01, null, armR);
  const forearmShellL = box(0.21, 0.22, 0.25, armorEdge, 0, -0.1, -0.01, null, forearmL);
  const forearmShellR = box(0.21, 0.22, 0.25, armorEdge, 0, -0.1, -0.01, null, forearmR);
  forearmShellL.name = 'forearm-shell-L';
  forearmShellR.name = 'forearm-shell-R';

  const fingerGeometry = new THREE.CylinderGeometry(0.014, 0.017, 1, 6, 1);
  const thumbGeometry = new THREE.CylinderGeometry(0.016, 0.019, 1, 6, 1);
  const wristGeometry = new THREE.CylinderGeometry(0.08, 0.085, OPERATOR_HAND_PROFILE.wrist[1], 8, 1);
  const fingerNames = ['index', 'middle', 'ring', 'pinky'];
  const fingerSlots = [0.061, 0.021, -0.022, -0.06];
  const fingerSplay = [0.055, 0.018, -0.012, -0.06];

  const makeOperatorHand = (side, parent) => {
    const direction = side === 'L' ? -1 : 1;
    const hand = new THREE.Group();
    hand.name = `hand${side}`;
    hand.position.set(0, -0.3, -0.02);
    parent.add(hand);

    const palm = box(...OPERATOR_HAND_PROFILE.palm, glove, 0, 0, 0, null, hand);
    palm.name = `hand${side}-palm`;
    // Placa dorsal: el espesor va sobre Z (normal de la palma), no sobre Y.
    // Un pequeño solape oculta z-fighting sin convertirla en un bloque interno.
    const palmPanel = box(0.145, 0.12, 0.025, glovePanel, 0, 0.002, 0.108, null, hand);
    palmPanel.name = `hand${side}-palm-panel`;

    const wrist = add(wristGeometry, glovePanel, 0, 0.095, 0.008, null, hand);
    wrist.name = `hand${side}-wrist`;
    wrist.scale.z = OPERATOR_HAND_PROFILE.wrist[2] / OPERATOR_HAND_PROFILE.wrist[0];

    const fingers = {};
    for (let index = 0; index < fingerNames.length; index++) {
      const fingerName = fingerNames[index];
      const totalLength = OPERATOR_HAND_PROFILE.fingerLengths[index];
      const proximalLength = totalLength * 0.56;
      const distalLength = totalLength - proximalLength;
      const root = new THREE.Group();
      root.name = `hand${side}-${fingerName}`;
      root.position.set(direction * fingerSlots[index], -0.058, -0.058);
      root.rotation.x = OPERATOR_HAND_PROFILE.fingerCurls[index];
      root.rotation.z = direction * fingerSplay[index];

      const proximal = new THREE.Mesh(fingerGeometry, glove);
      proximal.name = `hand${side}-${fingerName}-proximal`;
      proximal.position.y = -proximalLength / 2;
      proximal.scale.y = proximalLength;
      proximal.castShadow = true;
      root.add(proximal);

      const distalJoint = new THREE.Group();
      distalJoint.name = `hand${side}-${fingerName}-distal-joint`;
      distalJoint.position.y = -proximalLength;
      distalJoint.rotation.x = OPERATOR_HAND_PROFILE.distalCurls[index];
      const distal = new THREE.Mesh(fingerGeometry, gloveGrip);
      distal.name = `hand${side}-${fingerName}-distal`;
      distal.position.y = -distalLength / 2;
      distal.scale.set(0.92, distalLength, 0.92);
      distal.castShadow = true;
      distalJoint.add(distal);
      root.add(distalJoint);
      hand.add(root);
      fingers[fingerName] = { root, proximal, distalJoint, distal, totalLength };
    }

    const thumbLength = OPERATOR_HAND_PROFILE.thumbLength;
    const thumbProximalLength = thumbLength * 0.58;
    const thumbDistalLength = thumbLength - thumbProximalLength;
    const thumb = new THREE.Group();
    thumb.name = `hand${side}-thumb`;
    thumb.position.set(direction * 0.088, -0.005, -0.035);
    thumb.rotation.set(0.5, 0, direction * 0.82);
    const thumbProximal = new THREE.Mesh(thumbGeometry, glove);
    thumbProximal.name = `hand${side}-thumb-proximal`;
    thumbProximal.position.y = -thumbProximalLength / 2;
    thumbProximal.scale.y = thumbProximalLength;
    thumbProximal.castShadow = true;
    thumb.add(thumbProximal);
    const thumbDistalJoint = new THREE.Group();
    thumbDistalJoint.position.y = -thumbProximalLength;
    thumbDistalJoint.rotation.x = 0.72;
    const thumbDistal = new THREE.Mesh(thumbGeometry, gloveGrip);
    thumbDistal.name = `hand${side}-thumb-distal`;
    thumbDistal.position.y = -thumbDistalLength / 2;
    thumbDistal.scale.set(0.92, thumbDistalLength, 0.92);
    thumbDistal.castShadow = true;
    thumbDistalJoint.add(thumbDistal);
    thumb.add(thumbDistalJoint);
    hand.add(thumb);

    hand.userData.anatomy = {
      palm,
      palmPanel,
      wrist,
      fingers,
      thumb: { root: thumb, proximal: thumbProximal, distal: thumbDistal },
    };
    return hand;
  };

  const handL = makeOperatorHand('L', forearmL);
  const handR = makeOperatorHand('R', forearmR);

  const gun = new THREE.Group();
  gun.name = 'gun';
  gun.position.set(0, 1.16, -0.12);
  gun.rotation.x = -0.32;
  box(0.14, 0.16, 0.55, gunMat, 0, 0.04, -0.24, null, gun);
  box(0.12, 0.14, 0.24, metal, 0, 0.04, 0.13, null, gun);
  box(0.09, 0.1, 0.38, gunAccent, 0, 0.04, -0.67, null, gun);
  const gunGrip = box(0.105, 0.24, 0.12, metal, 0, -0.12, 0, null, gun);
  gunGrip.name = 'operator-gun-primary-grip';
  box(0.06, 0.06, 0.12, gunAccent, 0, 0.14, -0.48, null, gun);
  box(0.12, 0.06, 0.08, metal, 0, 0.08, -0.9, null, gun);
  const gunHandguard = box(0.13, 0.13, 0.34, armorEdge, 0, 0, -0.38, null, gun);
  gunHandguard.name = 'operator-gun-support-grip';
  box(0.035, 0.05, 0.32, metal, 0, 0.04, -1.02, null, gun);
  const muzzleFlash = add(
    new THREE.ConeGeometry(0.09, 0.28, 6), flashMaterial,
    0, 0.04, -1.23, null, gun,
  );
  muzzleFlash.name = 'muzzleFlash';
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.visible = false;
  muzzleFlash.castShadow = false;
  muzzleFlash.receiveShadow = false;

  // Objetivos comunes arma/manos. Las palmas permanecen tangentes a las dos
  // superficies de agarre mientras los brazos resuelven el alcance desde los
  // hombros; así apuntar no rota el arma a través de los guantes.
  const rightGripTarget = new THREE.Object3D();
  rightGripTarget.name = 'operator-right-hand-target';
  rightGripTarget.position.set(0, -0.11, 0.165);
  const leftGripTarget = new THREE.Object3D();
  leftGripTarget.name = 'operator-left-hand-target';
  leftGripTarget.position.set(0, -0.17, -0.38);
  leftGripTarget.rotation.x = Math.PI / 2;
  gun.add(rightGripTarget, leftGripTarget);
  torso.add(gun);

  const armDown = new THREE.Vector3(0, -1, 0);
  const upperLength = 0.52;
  const forearmWrist = new THREE.Vector3(0, -0.205, -0.01);
  const handWrist = new THREE.Vector3(0, 0.095, 0.008);
  const gunMatrix = new THREE.Matrix4();
  const targetMatrix = new THREE.Matrix4();
  const desiredHandMatrix = new THREE.Matrix4();
  const parentMatrix = new THREE.Matrix4();
  const localHandMatrix = new THREE.Matrix4();
  const inverseArm = new THREE.Quaternion();
  const shoulder = new THREE.Vector3();
  const wrist = new THREE.Vector3();
  const reach = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const upperDirection = new THREE.Vector3();
  const lowerDirection = new THREE.Vector3();
  const localLowerDirection = new THREE.Vector3();
  const poleDirection = new THREE.Vector3();
  const unitForearmWrist = forearmWrist.clone().normalize();
  const lowerLength = forearmWrist.length();
  const handScale = new THREE.Vector3();
  const operatorGripBindings = [
    [-1, armL, forearmL, handL, leftGripTarget],
    [1, armR, forearmR, handR, rightGripTarget],
  ];

  const syncOperatorGrip = () => {
    gun.updateMatrix();
    gunMatrix.copy(gun.matrix);
    for (const [side, arm, forearm, hand, target] of operatorGripBindings) {
      target.updateMatrix();
      targetMatrix.copy(target.matrix);
      desiredHandMatrix.multiplyMatrices(gunMatrix, targetMatrix);
      wrist.copy(handWrist).applyMatrix4(desiredHandMatrix);
      shoulder.copy(arm.position);
      reach.subVectors(wrist, shoulder);
      const distance = Math.max(0.001, reach.length());
      reach.multiplyScalar(1 / distance);
      const safeDistance = Math.min(
        upperLength + lowerLength - 0.001,
        Math.max(Math.abs(upperLength - lowerLength) + 0.001, distance),
      );
      const along = (upperLength ** 2 - lowerLength ** 2 + safeDistance ** 2) / (2 * safeDistance);
      const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
      poleDirection.set(side, -0.18, 0.55);
      poleDirection.addScaledVector(reach, -poleDirection.dot(reach));
      if (poleDirection.lengthSq() < 0.0001) poleDirection.set(side, 0, 0.5);
      poleDirection.normalize();
      elbow.copy(shoulder).addScaledVector(reach, along).addScaledVector(poleDirection, bend);

      upperDirection.subVectors(elbow, shoulder).normalize();
      arm.quaternion.setFromUnitVectors(armDown, upperDirection);
      arm.updateMatrix();
      forearm.position.set(0, -upperLength, 0);
      lowerDirection.subVectors(wrist, elbow).normalize();
      inverseArm.copy(arm.quaternion).invert();
      localLowerDirection.copy(lowerDirection).applyQuaternion(inverseArm).normalize();
      forearm.quaternion.setFromUnitVectors(unitForearmWrist, localLowerDirection);
      forearm.updateMatrix();

      parentMatrix.multiplyMatrices(arm.matrix, forearm.matrix);
      localHandMatrix.copy(parentMatrix).invert().multiply(desiredHandMatrix);
      localHandMatrix.decompose(hand.position, hand.quaternion, handScale);
      hand.scale.set(1, 1, 1);
    }
  };
  syncOperatorGrip();

  const hatMesh = makeHat(hat);
  if (hatMesh) {
    hatMesh.position.set(0, 0.26, 0);
    headPivot.add(hatMesh);
  }

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, hatMesh ? 2.55 : 2.35, 0);
  torso.add(nameSprite);

  return {
    group, parts, torso, body, legL, legR, armL, armR, forearmL, forearmR, handL, handR,
    head, headPivot, gun, gunGrip, gunHandguard, muzzleFlash, nameSprite,
    gripTargets: { left: leftGripTarget, right: rightGripTarget }, syncOperatorGrip,
    armor: armorGroup, headgear, equipment,
    motion: { hit: 0, hitSide: 1, recoil: 0 },
  };
}

const damp = (current, target, response) => current + (target - current) * response;

export function triggerHumanoidHit(rig, intensity = 1, side = 1) {
  if (!rig?.motion) return;
  rig.motion.hit = Math.max(rig.motion.hit, 0.35 + clamp01(intensity) * 0.65);
  rig.motion.hitSide = side < 0 ? -1 : 1;
}

export function triggerHumanoidShot(rig, intensity = 1) {
  if (!rig?.motion) return;
  rig.motion.recoil = Math.max(rig.motion.recoil, clamp01(intensity));
  if (rig.muzzleFlash) rig.muzzleFlash.visible = true;
}

// Caminar, correr, respirar, apuntar y reaccionar al combate comparten el
// mismo rig. La amortiguacion evita saltos visuales al recibir snapshots.
export function animateHumanoid(rig, dt, speed, walkTimeRef, aiming, aimPitch = 0) {
  const frame = Math.min(0.1, Math.max(0, Number(dt) || 0));
  const safeSpeed = Math.max(0, Number(speed) || 0);
  walkTimeRef.t = Number(walkTimeRef.t) || 0;
  walkTimeRef.idle = Number(walkTimeRef.idle) || walkTimeRef.t;
  walkTimeRef.t += frame * safeSpeed * 1.65;
  walkTimeRef.idle += frame;

  const motion = rig.motion || (rig.motion = { hit: 0, hitSide: 1, recoil: 0 });
  motion.hit = Math.max(0, motion.hit - frame * 4.2);
  motion.recoil = Math.max(0, motion.recoil - frame * 11.5);
  const pose = operatorMotionState({
    time: walkTimeRef.t,
    idleTime: walkTimeRef.idle,
    speed: safeSpeed,
    aiming,
    aimPitch,
    hit: motion.hit,
    hitSide: motion.hitSide,
    recoil: motion.recoil,
  });
  const response = 1 - Math.exp(-frame * (aiming ? 18 : 13));

  rig.legL.rotation.x = damp(rig.legL.rotation.x, pose.legL, response);
  rig.legR.rotation.x = damp(rig.legR.rotation.x, pose.legR, response);
  rig.armL.position.x = damp(rig.armL.position.x, aiming ? -0.36 : -0.4, response);
  rig.armR.position.x = damp(rig.armR.position.x, aiming ? 0.36 : 0.4, response);
  const safePitch = Math.min(1.15, Math.max(-1.15, Number(aimPitch) || 0));
  const gunTargetX = 0;
  const gunTargetY = aiming ? 1.32 : 1.16 - pose.sprint * 0.08;
  const gunTargetZ = aiming ? -0.25 : -0.12 + pose.sprint * 0.035;
  const gunTargetRotation = aiming
    ? -safePitch + motion.recoil * 0.08
    : -0.32 - pose.sprint * 0.16 + motion.recoil * 0.04;
  rig.gun.position.x = damp(rig.gun.position.x, gunTargetX, response);
  rig.gun.position.y = damp(rig.gun.position.y, gunTargetY, response);
  rig.gun.position.z = damp(rig.gun.position.z, gunTargetZ, response);
  rig.gun.rotation.x = damp(rig.gun.rotation.x, gunTargetRotation, response);
  rig.gun.rotation.y = damp(rig.gun.rotation.y, 0, response);
  rig.gun.rotation.z = damp(rig.gun.rotation.z, 0, response);
  rig.syncOperatorGrip?.();
  rig.torso.position.y = damp(rig.torso.position.y, pose.bodyY, response);
  rig.torso.rotation.x = damp(rig.torso.rotation.x, pose.torsoPitch, response);
  rig.torso.rotation.y = damp(rig.torso.rotation.y, pose.torsoYaw, response);
  rig.torso.rotation.z = damp(rig.torso.rotation.z, pose.torsoRoll, response);
  if (rig.headPivot) {
    rig.headPivot.rotation.x = damp(rig.headPivot.rotation.x, pose.headPitch, response);
    rig.headPivot.rotation.y = damp(rig.headPivot.rotation.y, pose.headYaw, response);
    rig.headPivot.rotation.z = damp(rig.headPivot.rotation.z, pose.headRoll, response);
  }
  if (rig.equipment) rig.equipment.rotation.z = damp(
    rig.equipment.rotation.z, pose.equipmentRoll, response,
  );
  if (rig.muzzleFlash) {
    rig.muzzleFlash.visible = motion.recoil > 0.12;
    rig.muzzleFlash.scale.setScalar(pose.muzzleScale);
    rig.muzzleFlash.rotation.z += frame * 18;
  }
}

export function animateHumanoidDeath(rig, progress, side = 1) {
  const pose = operatorDeathState(progress, side);
  rig.group.rotation.x = pose.groupRotationX;
  rig.group.rotation.z = pose.groupRotationZ;
  rig.torso.rotation.x = pose.torsoRotationX;
  rig.torso.rotation.z = pose.torsoRotationZ;
  rig.torso.position.y = pose.torsoY;
  rig.legL.rotation.x = pose.legL;
  rig.legR.rotation.x = pose.legR;
  rig.armL.rotation.x = pose.armL;
  rig.armR.rotation.x = pose.armR;
  if (rig.headPivot) rig.headPivot.rotation.z = pose.headRoll;
  if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
  if (rig.nameSprite?.material) rig.nameSprite.material.opacity = pose.nameOpacity;
  return pose;
}

export function resetHumanoidPose(rig) {
  if (!rig) return;
  rig.group.rotation.x = 0;
  rig.group.rotation.z = 0;
  rig.torso.position.y = 0;
  rig.torso.rotation.set(0, 0, 0);
  rig.legL.rotation.set(0, 0, 0);
  rig.legR.rotation.set(0, 0, 0);
  rig.armL.rotation.set(0, 0, 0);
  rig.armR.rotation.set(0, 0, 0);
  rig.armL.position.x = -0.4;
  rig.armR.position.x = 0.4;
  if (rig.headPivot) rig.headPivot.rotation.set(0, 0, 0);
  if (rig.equipment) rig.equipment.rotation.set(0, 0, 0);
  rig.gun.position.set(0, 1.16, -0.12);
  rig.gun.rotation.set(-0.32, 0, 0);
  rig.syncOperatorGrip?.();
  if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
  if (rig.nameSprite?.material) {
    rig.nameSprite.material.opacity = 1;
    rig.nameSprite.visible = true;
  }
  rig.motion = { hit: 0, hitSide: 1, recoil: 0 };
}

export function disposeHumanoid(rig) {
  if (!rig?.group) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  rig.group.traverse((object) => {
    // Sprite usa una geometría singleton interna de Three.js compartida entre
    // todos los nombres. No pertenece al rig y disponerla invalida a los demás.
    if (object.geometry && !object.isSprite) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
