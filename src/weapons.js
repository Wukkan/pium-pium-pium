import * as THREE from 'three';
import { ammoAfterPickup, weaponSelectionAction, weaponAnimationState } from './ui-models.js';
import { DEFAULT_BINDINGS, bindingSlotIndex, keyCodeLabel } from './input-bindings.js';
import { roundedBoxGeometry } from './rounded-geometry.js';
import { handGripState } from './hand-grip.js';

export { HAND_GRIP_PROFILES, handGripState } from './hand-grip.js';

// ---------------------------------------------------------------------------
// Armas: definición, modelo en primera persona (cajas), disparo por raycast,
// retroceso, recarga y apuntado (ADS). El francotirador tiene mira telescópica.
// ---------------------------------------------------------------------------

export const WEAPON_DEFS = {
  pistol: {
    name: 'PISTOLA', kind: 'pistol',
    damage: 18, headMult: 2, rpm: 320, mag: 12, reserve: 72,
    reloadTime: 1.1, spread: 0.016, adsSpread: 0.007, moveSpread: 0.018,
    recoil: 0.011, auto: false, zoom: 1.2, scope: false, price: 0,
  },
  shotgun: {
    name: 'ESCOPETA', kind: 'shotgun',
    damage: 9, pellets: 8, headMult: 1.5, rpm: 78, mag: 6, reserve: 30,
    reloadTime: 2.0, spread: 0.045, adsSpread: 0.035, moveSpread: 0.02,
    recoil: 0.05, auto: false, zoom: 1.15, scope: false, price: 300,
  },
  smg: {
    name: 'SUBFUSIL', kind: 'smg',
    damage: 15, headMult: 2, rpm: 950, mag: 36, reserve: 144,
    reloadTime: 1.25, spread: 0.02, adsSpread: 0.011, moveSpread: 0.022,
    recoil: 0.009, auto: true, zoom: 1.2, scope: false, price: 500,
  },
  ar: {
    name: 'RIFLE DE ASALTO', kind: 'ar',
    damage: 24, headMult: 2, rpm: 600, mag: 30, reserve: 120,
    reloadTime: 1.5, spread: 0.014, adsSpread: 0.005, moveSpread: 0.02,
    recoil: 0.014, auto: true, zoom: 1.35, scope: false, price: 800,
  },
  sniper: {
    name: 'FRANCOTIRADOR', kind: 'sniper',
    damage: 105, headMult: 1.5, rpm: 42, mag: 5, reserve: 25,
    reloadTime: 2.2, spread: 0.07, adsSpread: 0.0006, moveSpread: 0.04,
    recoil: 0.06, auto: false, zoom: 3.6, scope: true, price: 1200,
  },
  revolver: {
    name: 'REVÓLVER', kind: 'revolver',
    damage: 55, headMult: 2, rpm: 150, mag: 6, reserve: 30,
    reloadTime: 1.8, spread: 0.01, adsSpread: 0.004, moveSpread: 0.02,
    recoil: 0.035, auto: false, zoom: 1.4, scope: false, price: 450,
  },
  launcher: {
    name: 'LANZAGRANADAS', kind: 'launcher',
    damage: 0, headMult: 1, rpm: 55, mag: 1, reserve: 6,
    reloadTime: 1.7, spread: 0, adsSpread: 0, moveSpread: 0,
    recoil: 0.08, auto: false, zoom: 1.2, scope: false, price: 2000,
    launcher: true, // dispara granadas de impacto en vez de balas
  },
};

// orden de las ranuras [1]..[7]
export const WEAPON_ORDER = ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];

export const MAX_ARSENAL_MONEY = 999999;

function parseArsenalSnapshot(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeArsenalMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(MAX_ARSENAL_MONEY, Math.max(0, Math.trunc(numeric)))
    : 0;
}

// Límite de confianza para datos persistidos: solo admite las armas del juego,
// conserva siempre la pistola y nunca equipa una entrada no poseída.
export function sanitizeArsenalState(value) {
  const source = parseArsenalSnapshot(value);
  const data = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const money = sanitizeArsenalMoney(data.money);
  const owned = { pistol: true };
  const ownedSource = data.owned;

  for (const key of WEAPON_ORDER) {
    if (key === 'pistol') continue;
    const isOwned = Array.isArray(ownedSource)
      ? ownedSource.includes(key)
      : ownedSource && typeof ownedSource === 'object' &&
        Object.prototype.hasOwnProperty.call(ownedSource, key) && ownedSource[key] === true;
    if (isOwned) owned[key] = true;
  }

  const equipped = typeof data.equipped === 'string' && owned[data.equipped] === true
    ? data.equipped
    : 'pistol';
  return { money, owned, equipped };
}

const BASE_FOV = 78;
const EQUIP_READY_PROGRESS = 0.999;
const MELEE_DURATION = 0.62;
const MELEE_COOLDOWN = 0.9;
const KNIFE_READY_PROGRESS = 0.18;

const EQUIP_DURATIONS = Object.freeze({
  pistol: 0.3,
  revolver: 0.38,
  smg: 0.4,
  ar: 0.46,
  shotgun: 0.52,
  sniper: 0.58,
  launcher: 0.62,
});

const MAGAZINE_WEAPONS = new Set(['pistol', 'smg', 'ar', 'sniper']);

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoothRange = (start, end, value) => smooth01((value - start) / (end - start));
const windowPulse = (value, start, peak, end) => {
  if (value <= start || value >= end) return 0;
  if (value < peak) return smoothRange(start, peak, value);
  return 1 - smoothRange(peak, end, value);
};
const windowPlateau = (value, openStart, openEnd, closeStart, closeEnd) => {
  if (value <= openStart || value >= closeEnd) return 0;
  if (value < openEnd) return smoothRange(openStart, openEnd, value);
  if (value <= closeStart) return 1;
  return 1 - smoothRange(closeStart, closeEnd, value);
};

// Estado puro de la animación de primera persona. Se calcula sin crear objetos
// de Three.js para mantener estable el coste por frame y permitir pruebas.
export function firstPersonAnimationState({
  time = 0,
  speed = 0,
  onGround = true,
  sliding = false,
  ads = false,
  reloading = false,
  reloadProgress = 0,
  equipProgress = 1,
  firePulse = 0,
  kind = 'pistol',
  bobAmount = 1,
} = {}) {
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const movement = onGround ? clamp01(safeSpeed / 7.2) : 0;
  const motionScale = clamp01(bobAmount);
  const stride = Math.sin(time * (7.2 + movement * 3.8)) * movement * motionScale;
  const step = Math.abs(Math.cos(time * (7.2 + movement * 3.8))) * movement * motionScale;
  const breath = Math.sin(time * 1.55) * (1 - movement) * motionScale;
  const reload = reloading ? clamp01(reloadProgress) : 0;
  const reloadArc = reloading ? Math.sin(reload * Math.PI) : 0;
  const equip = 1 - Math.pow(1 - clamp01(equipProgress), 3);
  const draw = 1 - equip;
  const shot = clamp01(firePulse);
  const fireCycle = shot > 0 ? Math.sin((1 - shot) * Math.PI) : 0;
  const sprintBase = smoothRange(4.9, 7.4, safeSpeed);
  const sprint = (ads || reloading ? 0 : sprintBase) * (sliding ? 1 : 0.82);

  const magazineDrop = MAGAZINE_WEAPONS.has(kind)
    ? windowPulse(reload, 0.14, 0.46, 0.79)
    : 0;
  const cylinderOpen = kind === 'revolver'
    ? windowPlateau(reload, 0.08, 0.22, 0.72, 0.9)
    : 0;
  const breechOpen = kind === 'launcher'
    ? windowPlateau(reload, 0.06, 0.2, 0.68, 0.9)
    : 0;
  const reloadPump = kind === 'shotgun' && reloading
    ? Math.max(0, Math.sin(reload * Math.PI * 2)) * reloadArc
    : 0;

  return {
    locomotion: { movement, sprint, stride, step, breath },
    position: {
      x: -0.04 + sprint * 0.105 + stride * 0.008 + draw * 0.13,
      y: 0.045 + breath * 0.004 - step * 0.006 - sprint * 0.075 - draw * 0.36,
      z: -0.1 + sprint * 0.035 + shot * 0.008 + draw * 0.08,
    },
    rotation: {
      x: sprint * 0.11 + draw * 0.2 - shot * 0.025,
      y: -sprint * 0.16 + stride * 0.012,
      z: sprint * 0.28 + draw * 0.58 + stride * 0.018,
    },
    hands: {
      supportReach: reloadArc,
      reloadArc,
      ads: Boolean(ads),
      reloading: Boolean(reloading),
      reloadProgress: reload,
      sway: stride,
      step,
      shot,
      sprint,
    },
    mechanism: {
      slideTravel: (kind === 'pistol' || kind === 'smg' || kind === 'ar' || kind === 'sniper') ? shot : 0,
      pumpTravel: kind === 'shotgun' ? Math.max(fireCycle, reloadPump) : 0,
      magazineDrop,
      cylinderOpen,
      breechOpen,
      chamberCycle: kind === 'revolver' ? fireCycle : 0,
    },
  };
}

function rawMeleeAnimationState(p) {
  const draw = smoothRange(0, 0.18, p);
  const windup = windowPulse(p, 0.12, 0.27, 0.43);
  const strike = windowPulse(p, 0.25, 0.43, 0.68);
  const recover = smoothRange(0.66, 1, p);
  const ready = draw * (1 - recover);
  const guardDrawArc = Math.sin(draw * Math.PI);
  return {
    visible: p < 1,
    draw,
    windup,
    strike,
    recover,
    position: {
      x: 0.08 - ready * 0.03 + windup * 0.09 - strike * 0.24,
      y: 0.07 - (1 - draw) * 0.55 + windup * 0.04 - strike * 0.04 + recover * 0.06,
      z: -0.04 - ready * 0.025 + windup * 0.045 - strike * 0.14,
    },
    rotation: {
      x: -0.08 - windup * 0.12 + strike * 0.38,
      y: 0.78 + windup * 0.18 - strike * 1.34,
      z: 0.26 + (1 - draw) * 0.82 - windup * 0.12 + strike * 0.96 - recover * 0.22,
    },
    // La mano de guardia tiene su propio pivote en espacio de cámara. Solo
    // contrapesa el golpe; nunca viaja rígidamente pegada a la hoja.
    guard: {
      position: {
        x: -(1 - draw) * 0.045 + guardDrawArc * 0.20 - ready * 0.20 - windup * 0.025 + strike * 0.015,
        y: -(1 - draw) * 0.55 + ready * 0.14 - strike * 0.025 + recover * 0.06,
        z: (1 - draw) * 0.055 + windup * 0.018 + strike * 0.026,
      },
      rotation: {
        x: -(1 - draw) * 0.16 + windup * 0.08 - strike * 0.06,
        y: (1 - draw) * 0.12 - windup * 0.07 + strike * 0.045,
        z: -(1 - draw) * 0.28 - windup * 0.08 + strike * 0.12,
      },
    },
    hands: {
      gripPressure: clamp01(0.35 * draw + 0.65 * Math.max(windup, strike)),
      dominantFlex: -windup * 0.055 + strike * 0.085,
      guardFlex: windup * 0.09 + strike * 0.14,
    },
  };
}

const mixMeleeValue = (from, to, amount) => from + (to - from) * amount;
const mixMeleeVector = (from, to, amount) => Object.fromEntries(
  Object.keys(from).map((key) => [key, mixMeleeValue(from[key], to[key], amount)]),
);

function mixMeleePose(from, to, amount) {
  if (amount >= 1) return to;
  return {
    visible: amount > 0 ? to.visible : from.visible,
    draw: mixMeleeValue(from.draw, to.draw, amount),
    windup: mixMeleeValue(from.windup, to.windup, amount),
    strike: mixMeleeValue(from.strike, to.strike, amount),
    recover: mixMeleeValue(from.recover, to.recover, amount),
    position: mixMeleeVector(from.position, to.position, amount),
    rotation: mixMeleeVector(from.rotation, to.rotation, amount),
    guard: {
      position: mixMeleeVector(from.guard.position, to.guard.position, amount),
      rotation: mixMeleeVector(from.guard.rotation, to.guard.rotation, amount),
    },
    hands: mixMeleeVector(from.hands, to.hands, amount),
  };
}

export function meleeAnimationState(progress = 0) {
  const p = clamp01(progress);
  const pose = rawMeleeAnimationState(p);
  const recoveryToReady = smoothRange(0.66, 1, p);
  if (recoveryToReady <= 0) return pose;
  return mixMeleePose(pose, rawMeleeAnimationState(KNIFE_READY_PROGRESS), recoveryToReady);
}

export function viewmodelVisibilityState({
  dead = false, scoped = false, knifeEquipped = false, meleeActive = false,
} = {}) {
  const alive = !dead;
  const showKnife = knifeEquipped || meleeActive;
  return {
    rig: alive,
    firearm: alive && !scoped && !showKnife,
    knife: alive && showKnife,
    scope: alive && scoped && !showKnife,
  };
}

function snapshotTransform(object) {
  object.userData.basePosition = object.position.clone();
  object.userData.baseRotation = object.rotation.clone();
}

const ARM_UP = new THREE.Vector3(0, 1, 0);

function viewmodelBoxGeometry(width, height, depth, options = {}) {
  const shortest = Math.min(Math.abs(width), Math.abs(height), Math.abs(depth));
  return roundedBoxGeometry(width, height, depth, {
    ratio: options.ratio ?? (shortest < 0.03 ? 0.13 : shortest < 0.065 ? 0.16 : 0.19),
    maxRadius: options.maxRadius ?? 0.018,
    segments: options.segments ?? (shortest >= 0.055 ? 2 : 1),
  });
}

function makeArmSegment(material, radiusTop, radiusBottom = radiusTop, { anatomical = false } = {}) {
  const geometry = anatomical
    ? new THREE.LatheGeometry([
      new THREE.Vector2(radiusBottom * 0.84, -0.5),
      new THREE.Vector2(radiusBottom, -0.41),
      new THREE.Vector2(radiusBottom * 1.04, -0.12),
      new THREE.Vector2((radiusTop + radiusBottom) * 0.515, 0.16),
      new THREE.Vector2(radiusTop, 0.41),
      new THREE.Vector2(radiusTop * 0.84, 0.5),
    ], 16)
    : new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 12, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
}

function setArmSegment(mesh, from, to, delta, fixedLength = null) {
  delta.subVectors(to, from);
  const measuredLength = Math.max(0.001, delta.length());
  const length = fixedLength ?? measuredLength;
  delta.multiplyScalar(1 / measuredLength);
  mesh.position.copy(from).addScaledVector(delta, length * 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(ARM_UP, delta);
}

function buildFirstPersonArms(kind, materials) {
  const root = new THREE.Group();
  root.name = 'first-person-arms';
  const isKnife = kind === 'knife';
  const baseGrip = handGripState({ kind });
  const palmGeometry = isKnife
    ? viewmodelBoxGeometry(0.102, 0.058, 0.132, { ratio: 0.4, maxRadius: 0.024, segments: 1 })
    : new THREE.SphereGeometry(0.075, 12, 8);
  const palmPadGeometry = viewmodelBoxGeometry(0.086, 0.018, 0.072, {
    ratio: 0.28, maxRadius: 0.005, segments: 1,
  });
  const knuckleGeometry = new THREE.SphereGeometry(0.014, 10, 6);
  const fingerLengths = [0.034, 0.029, 0.024];
  const fingerGeometries = fingerLengths.map((length, index) => {
    const geometry = new THREE.CylinderGeometry(
      0.008 - index * 0.0007,
      0.0105 - index * 0.0005,
      length,
      10,
      1,
    );
    geometry.rotateX(Math.PI / 2);
    return geometry;
  });
  const fingertipGeometry = new THREE.SphereGeometry(0.009, 10, 6);
  const thumbTipGeometry = isKnife ? new THREE.SphereGeometry(0.009, 8, 5) : null;
  const thumbLengths = [0.038, 0.031];
  const thumbGeometries = thumbLengths.map((length, index) => {
    const geometry = new THREE.CylinderGeometry(
      0.011 - index * 0.001,
      0.013 - index * 0.001,
      length,
      10,
      1,
    );
    geometry.rotateX(Math.PI / 2);
    return geometry;
  });
  const elbowGeometry = new THREE.SphereGeometry(0.078, isKnife ? 14 : 12, isKnife ? 9 : 8);
  const shoulderGeometry = new THREE.SphereGeometry(0.092, isKnife ? 14 : 12, isKnife ? 9 : 8);

  const fingerNames = ['index', 'middle', 'ring', 'pinky'];
  const fingerCurlRadians = [1.12, 1.38, 1.2];
  const thumbCurlRadians = [0.82, 1.08];

  const makeHand = (side, handPose) => {
    const direction = side === 'left' ? -1 : 1;
    const hand = new THREE.Group();
    hand.name = `${side}-hand`;
    hand.position.fromArray(handPose.position);
    hand.rotation.fromArray(handPose.rotation);

    const palm = new THREE.Mesh(palmGeometry, materials.glove);
    palm.name = `${side}-glove-palm`;
    if (isKnife) palm.scale.set(1, 1, 1);
    else palm.scale.set(0.7, 0.52, 0.96);
    palm.rotation.x = isKnife ? -0.11 : -0.18;
    palm.castShadow = true;
    hand.add(palm);

    const palmPad = new THREE.Mesh(palmPadGeometry, materials.glovePanel);
    palmPad.name = `${side}-palm-pad`;
    // La cara interior queda contra la empuñadura o el guardamanos.
    palmPad.position.set(0, side === 'right' ? -0.032 : 0.032, -0.038);
    palmPad.rotation.x = -0.1;
    hand.add(palmPad);

    if (isKnife) {
      const backPlate = new THREE.Mesh(
        viewmodelBoxGeometry(0.078, 0.014, 0.064, { ratio: 0.32, maxRadius: 0.005, segments: 1 }),
        materials.gloveGrip || materials.glovePanel,
      );
      backPlate.name = `${side}-hand-backplate`;
      backPlate.position.set(0, direction * 0.031, -0.018);
      backPlate.rotation.x = -0.09;
      backPlate.castShadow = true;
      hand.add(backPlate);

      const thenar = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 10, 6),
        materials.glove,
      );
      thenar.name = `${side}-thenar-pad`;
      thenar.position.set(direction * 0.034, -direction * 0.018, -0.014);
      thenar.scale.set(0.76, 0.5, 1.22);
      thenar.castShadow = true;
      hand.add(thenar);

      const handSeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.003, 0.003, 0.052, 8, 1),
        materials.stitch || materials.glovePanel,
      );
      handSeam.name = `${side}-hand-stitch`;
      handSeam.position.set(0, direction * 0.040, 0.008);
      handSeam.rotation.z = Math.PI / 2;
      hand.add(handSeam);
    }

    const lengthScales = [0.96, 1.07, 1, 0.86];
    const fingers = {};

    for (let i = 0; i < 4; i++) {
      const fingerName = fingerNames[i];
      const finger = new THREE.Group();
      finger.name = `${side}-finger-${i + 1}`;
      // En la mano derecha el índice ocupa el extremo opuesto al meñique.
      // Al girar la muñeca sobre Z quedan apilados anatómicamente en el grip.
      const slot = side === 'right' ? 1.5 - i : i - 1.5;
      finger.position.set(slot * 0.021, -0.018, -0.063);
      const knuckle = new THREE.Mesh(knuckleGeometry, materials.glovePanel);
      knuckle.name = `${side}-finger-${i + 1}-knuckle`;
      knuckle.scale.set(0.88, 0.72, 0.9);
      finger.add(knuckle);
      const joints = [finger];
      let joint = finger;
      for (let segmentIndex = 0; segmentIndex < fingerGeometries.length; segmentIndex++) {
        const length = fingerLengths[segmentIndex] * lengthScales[i];
        const segment = new THREE.Mesh(fingerGeometries[segmentIndex], materials.glove);
        const names = ['proximal', 'middle', 'distal'];
        segment.name = `${side}-finger-${i + 1}-${names[segmentIndex]}`;
        segment.scale.z = lengthScales[i];
        segment.position.z = -length / 2;
        segment.castShadow = true;
        joint.add(segment);
        if (segmentIndex < fingerGeometries.length - 1) {
          const nextJoint = new THREE.Group();
          nextJoint.name = `${side}-${fingerName}-${segmentIndex === 0 ? 'pip' : 'dip'}-joint`;
          nextJoint.position.z = -length;
          joint.add(nextJoint);
          joints.push(nextJoint);
          joint = nextJoint;
        } else {
          const tip = new THREE.Mesh(fingertipGeometry, materials.glovePanel);
          tip.name = `${side}-finger-${i + 1}-tip`;
          tip.position.z = -length;
          tip.scale.set(0.9, 0.76, 1.08);
          joint.add(tip);
        }
      }
      if (isKnife) {
        const protector = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0075, 0.008, 0.026, 8, 1),
          materials.gloveGrip || materials.glovePanel,
        );
        protector.name = `${side}-${fingerName}-protector`;
        protector.position.set(0, direction * 0.0105, -0.017);
        protector.rotation.x = Math.PI / 2;
        protector.castShadow = true;
        finger.add(protector);
      }
      finger.userData.semantic = fingerName;
      finger.userData.joints = joints;
      fingers[fingerName] = finger;
      hand.add(finger);
    }

    const thumb = new THREE.Group();
    thumb.name = `${side}-thumb`;
    thumb.position.set(direction * 0.055, -0.018, isKnife && side === 'right' ? -0.020 : -0.005);
    thumb.rotation.y = direction * 0.78;
    thumb.rotation.x = -0.28;
    const thumbJoints = [thumb];
    let thumbJoint = thumb;
    for (let index = 0; index < thumbGeometries.length; index++) {
      const segment = new THREE.Mesh(thumbGeometries[index], index === 0 ? materials.glove : materials.glovePanel);
      segment.name = `${side}-thumb-${index === 0 ? 'proximal' : 'distal'}`;
      segment.position.z = -thumbLengths[index] / 2;
      thumbJoint.add(segment);
      if (index === 0) {
        const next = new THREE.Group();
        next.name = `${side}-thumb-ip-joint`;
        next.position.z = -thumbLengths[index];
        thumbJoint.add(next);
        thumbJoints.push(next);
        thumbJoint = next;
      }
    }
    if (isKnife) {
      const thumbTip = new THREE.Mesh(thumbTipGeometry, materials.glovePanel);
      thumbTip.name = `${side}-thumb-tip`;
      thumbTip.position.z = -thumbLengths[1];
      thumbTip.scale.set(1.06, 0.88, 1.18);
      thumbTip.castShadow = true;
      thumbJoint.add(thumbTip);
    }
    thumb.userData.joints = thumbJoints;
    hand.add(thumb);

    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.074, 0.075, 12),
      materials.cuff,
    );
    cuff.name = `${side}-wrist-cuff`;
    cuff.position.set(direction * 0.004, -0.055, 0.084);
    cuff.rotation.x = Math.PI / 2.7;
    hand.add(cuff);

    const wristStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.072, 0.072, 0.018, 12),
      materials.glovePanel,
    );
    wristStrap.name = `${side}-wrist-strap`;
    wristStrap.position.set(direction * 0.004, -0.04, 0.058);
    wristStrap.rotation.x = Math.PI / 2.7;
    hand.add(wristStrap);

    hand.userData.fingers = fingers;
    hand.userData.thumb = thumb;
    root.add(hand);
    return hand;
  };

  const right = makeHand('right', baseGrip.right);
  const left = makeHand('left', baseGrip.left);

  const applyHandGrip = (hand, state) => {
    hand.position.fromArray(state.position);
    hand.rotation.fromArray(state.rotation);
    hand.userData.role = state.role;
    for (const fingerName of fingerNames) {
      const finger = hand.userData.fingers[fingerName];
      const digitState = state.fingers[fingerName];
      const [mcp, pip, dip] = finger.userData.joints;
      mcp.rotation.set(
        digitState.curl[0] * fingerCurlRadians[0],
        digitState.splay || 0,
        digitState.twist || 0,
      );
      pip.rotation.set(digitState.curl[1] * fingerCurlRadians[1], 0, 0);
      dip.rotation.set(digitState.curl[2] * fingerCurlRadians[2], 0, 0);
      finger.userData.contact = digitState.contact;
    }

    const thumb = hand.userData.thumb;
    const [thumbMcp, thumbIp] = thumb.userData.joints;
    const thumbDirection = hand.name.startsWith('left') ? -1 : 1;
    thumbMcp.rotation.set(
      -0.28 + state.thumb.curl[0] * thumbCurlRadians[0],
      thumbDirection * (0.78 + (state.thumb.splay || 0)),
      state.thumb.twist || 0,
    );
    thumbIp.rotation.set(state.thumb.curl[1] * thumbCurlRadians[1], 0, 0);
    thumb.userData.contact = state.thumb.contact;
  };

  let gripState = baseGrip;
  const applyGrip = (state = baseGrip) => {
    gripState = state;
    applyHandGrip(right, state.right);
    applyHandGrip(left, state.left);
  };
  applyGrip(baseGrip);
  snapshotTransform(right);
  snapshotTransform(left);

  const chains = {};
  const inverseParentMatrix = new THREE.Matrix4();
  const sleeveBandGeometry = isKnife
    ? new THREE.CylinderGeometry(1, 1, 0.045, 14, 1, true)
    : null;
  const sleeveSeamGeometry = isKnife
    ? new THREE.CylinderGeometry(0.0035, 0.0035, 0.48, 8, 1)
    : null;
  const supportArmLengths = {
    pistol: [0.2, 0.18],
    revolver: [0.29, 0.27],
    shotgun: [0.29, 0.27],
    smg: [0.255, 0.235],
    ar: [0.3, 0.28],
    sniper: [0.32, 0.3],
    launcher: [0.35, 0.33],
    knife: [0.32, 0.30],
  };
  for (const [side, hand] of [['right', right], ['left', left]]) {
    const direction = side === 'left' ? -1 : 1;
    const [upperLength, forearmLength] = kind === 'knife'
      ? supportArmLengths.knife
      : side === 'right'
        ? [0.205, 0.185]
        : supportArmLengths[kind] || supportArmLengths.pistol;
    const chain = new THREE.Group();
    chain.name = `${side}-arm-chain`;
    const upperArm = makeArmSegment(
      materials.sleeveDark,
      isKnife ? 0.052 : 0.064,
      isKnife ? 0.061 : 0.074,
      { anatomical: isKnife },
    );
    upperArm.name = `${side}-upper-arm`;
    const forearm = makeArmSegment(
      materials.sleeve,
      isKnife ? 0.044 : 0.052,
      isKnife ? 0.054 : 0.064,
      { anatomical: isKnife },
    );
    forearm.name = `${side}-forearm`;
    const elbowGuard = new THREE.Mesh(elbowGeometry, materials.sleeveDark);
    elbowGuard.name = `${side}-elbow-guard`;
    elbowGuard.scale.set(isKnife ? 0.64 : 0.92, isKnife ? 0.51 : 0.76, isKnife ? 0.63 : 0.9);
    const shoulderPad = new THREE.Mesh(shoulderGeometry, materials.sleeveDark);
    shoulderPad.name = `${side}-shoulder-pad`;
    shoulderPad.scale.set(isKnife ? 0.74 : 1, isKnife ? 0.56 : 0.8, isKnife ? 0.69 : 0.9);
    if (isKnife) {
      for (const [segment, radius, offset] of [
        [upperArm, 0.054, -0.31],
        [forearm, 0.046, 0.31],
      ]) {
        const band = new THREE.Mesh(sleeveBandGeometry, materials.stitch || materials.sleeveDark);
        band.name = `${side}-${segment === upperArm ? 'upper-arm' : 'forearm'}-fold`;
        band.position.y = offset;
        band.scale.set(radius, 1, radius);
        segment.add(band);

        const seam = new THREE.Mesh(sleeveSeamGeometry, materials.sleeveDark);
        seam.name = `${side}-${segment === upperArm ? 'upper-arm' : 'forearm'}-seam`;
        seam.position.z = radius * 0.94;
        segment.add(seam);
      }
    }
    chain.add(upperArm, forearm, elbowGuard, shoulderPad);
    root.add(chain);
    chains[side] = {
      root: chain, hand, direction, upperArm, forearm, elbowGuard, shoulderPad,
      baseShoulder: new THREE.Vector3(
        direction * (isKnife ? 0.345 : 0.31),
        isKnife ? -0.315 : -0.28,
        isKnife ? 0.235 : 0.21,
      ),
      shoulder: new THREE.Vector3(),
      wristOffset: new THREE.Vector3(direction * 0.004, -0.052, 0.083),
      pole: new THREE.Vector3(direction, isKnife ? -0.30 : -0.58, isKnife ? 0.48 : 0.3),
      poleDirection: new THREE.Vector3(),
      directionVector: new THREE.Vector3(),
      wrist: new THREE.Vector3(), elbow: new THREE.Vector3(), delta: new THREE.Vector3(),
      upperLength,
      forearmLength,
    };
  }

  const update = (animatedParentMatrices = null) => {
    for (const [side, chain] of Object.entries(chains)) {
      const animatedParentMatrix = animatedParentMatrices?.isMatrix4
        ? animatedParentMatrices
        : animatedParentMatrices?.[side] || null;
      if (animatedParentMatrix) inverseParentMatrix.copy(animatedParentMatrix).invert();
      chain.wrist.copy(chain.wristOffset).applyEuler(chain.hand.rotation).add(chain.hand.position);
      chain.shoulder.copy(chain.baseShoulder);
      // En golpes amplios el arma y la mano rotan, pero los hombros permanecen
      // anclados al cuerpo/cámara; se expresan aquí en el espacio local animado.
      if (animatedParentMatrix) chain.shoulder.applyMatrix4(inverseParentMatrix);
      chain.directionVector.subVectors(chain.wrist, chain.shoulder);
      let distance = Math.max(0.001, chain.directionVector.length());
      chain.directionVector.multiplyScalar(1 / distance);
      const maximumReach = chain.upperLength + chain.forearmLength - 0.002;
      if (distance > maximumReach) {
        chain.shoulder.addScaledVector(chain.directionVector, distance - maximumReach);
        distance = maximumReach;
      }

      const along = Math.min(
        chain.upperLength,
        (chain.upperLength ** 2 - chain.forearmLength ** 2 + distance ** 2) / (2 * distance),
      );
      const bend = Math.sqrt(Math.max(0, chain.upperLength ** 2 - along ** 2));
      chain.poleDirection.copy(chain.pole)
        .addScaledVector(chain.directionVector, -chain.pole.dot(chain.directionVector));
      if (chain.poleDirection.lengthSq() < 0.0001) {
        chain.poleDirection.set(chain.direction, -0.5, 0);
      }
      chain.poleDirection.normalize();
      chain.elbow.copy(chain.shoulder)
        .addScaledVector(chain.directionVector, along)
        .addScaledVector(chain.poleDirection, bend);

      setArmSegment(chain.upperArm, chain.shoulder, chain.elbow, chain.delta, chain.upperLength);
      setArmSegment(chain.forearm, chain.elbow, chain.wrist, chain.delta, chain.forearmLength);
      chain.elbowGuard.position.copy(chain.elbow);
      chain.shoulderPad.position.copy(chain.shoulder);
    }
  };
  update();
  return {
    root, right, left, chains, update, applyGrip,
    get gripState() { return gripState; },
  };
}

function createViewmodelMaterials() {
  return {
    dark: new THREE.MeshLambertMaterial({ color: 0x171c24 }),
    mid: new THREE.MeshLambertMaterial({ color: 0x465463 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x252d37 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8796a5, metalness: 0.78, roughness: 0.27 }),
    steelEdge: new THREE.MeshStandardMaterial({
      color: 0xc7d0d7, metalness: 0.92, roughness: 0.16, side: THREE.DoubleSide,
    }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x3f4a54, metalness: 0.72, roughness: 0.34 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5c4738, roughness: 0.72 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.92 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xc69b48, metalness: 0.45, roughness: 0.42 }),
    glove: new THREE.MeshStandardMaterial({
      color: 0x3b4d5c, roughness: 0.92, emissive: 0x080d12, emissiveIntensity: 0.025,
    }),
    glovePanel: new THREE.MeshStandardMaterial({
      color: 0x6c8291, roughness: 0.78, emissive: 0x090e12, emissiveIntensity: 0.035,
    }),
    gloveGrip: new THREE.MeshStandardMaterial({ color: 0x1b252d, roughness: 0.98 }),
    stitch: new THREE.MeshStandardMaterial({ color: 0xa79a7a, roughness: 1 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x202b36, roughness: 0.9 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.94 }),
    sleeveDark: new THREE.MeshStandardMaterial({ color: 0x253647, roughness: 0.96 }),
  };
}

function createGripTargets(model, gripState) {
  const right = new THREE.Object3D();
  right.name = 'weapon-primary-grip';
  right.position.fromArray(gripState.right.position);
  right.userData.hand = 'right';
  right.userData.role = gripState.right.role;

  const left = new THREE.Object3D();
  left.name = 'weapon-support-grip';
  left.position.fromArray(gripState.left.position);
  left.userData.hand = 'left';
  left.userData.role = gripState.left.role;

  model.add(right, left);
  return { right, left };
}

export function buildGunModel(kind) {
  const g = new THREE.Group();
  g.name = `viewmodel-${kind}`;
  const {
    dark, mid, polymer, steel, wood, rubber, accent,
    glove, glovePanel, cuff, sleeve, sleeveDark,
  } = createViewmodelMaterials();
  const moving = {};

  const part = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(viewmodelBoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  const tube = (mat, radius, length, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), mat);
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    g.add(m);
    return m;
  };

  const sight = (x, z, width = 0.05) => {
    part(dark, width, 0.06, 0.12, x, 0.1, z);
    part(accent, width * 0.42, 0.025, 0.04, x, 0.14, z - 0.03);
  };

  if (kind === 'pistol') {
    part(polymer, 0.1, 0.06, 0.25, 0, -0.02, 0.02);
    part(rubber, 0.065, 0.18, 0.12, 0, -0.16, 0.06);
    tube(steel, 0.018, 0.14, 0, 0.03, -0.31);
    sight(0, -0.1, 0.045);
    moving.slide = part(dark, 0.075, 0.11, 0.3, 0, 0.02, -0.08); // corredera
    part(mid, 0.07, 0.14, 0.11, 0, -0.09, 0.05);      // empuñadura
    moving.magazine = part(dark, 0.052, 0.13, 0.072, 0, -0.145, 0.065);
    part(dark, 0.045, 0.045, 0.12, 0, 0.03, -0.26);   // cañón
    part(accent, 0.02, 0.03, 0.04, 0, 0.09, -0.2);    // mira
  } else if (kind === 'revolver') {
    moving.cylinder = tube(dark, 0.075, 0.14, 0, 0.03, 0.03);
    tube(steel, 0.018, 0.14, 0, 0.04, -0.37);
    part(rubber, 0.075, 0.06, 0.04, 0, -0.17, 0.1);
    sight(0, -0.22, 0.04);
    part(mid, 0.06, 0.09, 0.38, 0, 0.03, -0.15);      // cañón largo
    part(dark, 0.09, 0.1, 0.12, 0, 0, 0.02);          // tambor
    part(wood, 0.07, 0.14, 0.1, 0, -0.1, 0.09);       // empuñadura
    part(accent, 0.02, 0.04, 0.04, 0, 0.1, -0.3);     // mira
  } else if (kind === 'launcher') {
    tube(steel, 0.055, 0.08, 0, 0.01, -0.52);
    part(rubber, 0.15, 0.04, 0.12, 0, -0.08, 0.02);
    sight(0, -0.25, 0.08);
    part(accent, 0.04, 0.04, 0.18, 0, 0.09, -0.18);
    part(dark, 0.13, 0.13, 0.55, 0, 0, -0.15);        // tubo gordo
    moving.breech = part(accent, 0.15, 0.15, 0.1, 0, 0, -0.45); // cierre
    part(mid, 0.08, 0.16, 0.12, 0, -0.12, 0.1);       // empuñadura
    part(wood, 0.08, 0.1, 0.18, 0, -0.02, 0.25);      // culata
  } else if (kind === 'shotgun') {
    tube(steel, 0.024, 0.55, -0.026, 0.05, -0.63);
    tube(dark, 0.022, 0.55, 0.026, 0.05, -0.63);
    part(rubber, 0.1, 0.035, 0.16, 0, 0.08, -0.03);
    part(wood, 0.09, 0.05, 0.18, 0, -0.1, -0.3);
    part(dark, 0.07, 0.09, 0.7, 0, 0.01, -0.25);      // cañón largo
    moving.pump = part(wood, 0.075, 0.09, 0.22, 0, -0.06, -0.32); // bomba
    part(rubber, 0.075, 0.16, 0.105, 0, -0.12, 0.09); // empuñadura trasera
    part(wood, 0.08, 0.12, 0.3, 0, -0.03, 0.25);      // culata
    part(mid, 0.085, 0.12, 0.2, 0, 0, 0.02);          // recámara
    part(accent, 0.03, 0.03, 0.06, 0, 0.07, -0.55);   // mira
  } else if (kind === 'ar') {
    tube(steel, 0.024, 0.38, 0, 0.02, -0.63);
    part(rubber, 0.12, 0.035, 0.28, 0, 0.08, -0.3);
    part(polymer, 0.09, 0.13, 0.08, 0, -0.16, 0.03);
    sight(0, -0.18, 0.055);
    part(mid, 0.09, 0.13, 0.62, 0, 0, -0.1);          // cuerpo
    part(dark, 0.055, 0.055, 0.45, 0, 0.01, -0.55);   // cañón
    moving.magazine = part(dark, 0.07, 0.16, 0.13, 0, -0.13, 0.02);
    part(wood, 0.08, 0.11, 0.22, 0, -0.03, 0.28);     // culata
    part(dark, 0.03, 0.05, 0.14, 0, 0.09, -0.05);     // mira
    part(accent, 0.06, 0.04, 0.1, 0, -0.02, -0.35);   // detalle
    moving.slide = part(steel, 0.016, 0.045, 0.105, 0.048, 0.025, -0.12);
  } else if (kind === 'smg') {
    tube(steel, 0.022, 0.22, 0, 0.02, -0.48);
    part(rubber, 0.12, 0.03, 0.2, 0, 0.09, -0.12);
    part(polymer, 0.08, 0.12, 0.07, 0, -0.11, 0.03);
    sight(0, -0.24, 0.05);
    part(mid, 0.09, 0.12, 0.42, 0, 0, -0.05);
    part(dark, 0.05, 0.05, 0.25, 0, 0.01, -0.36);
    moving.magazine = part(dark, 0.06, 0.2, 0.1, 0, -0.15, 0.03);
    part(dark, 0.07, 0.09, 0.13, 0, -0.02, 0.2);
    part(accent, 0.095, 0.03, 0.08, 0, 0.07, -0.1);
    moving.slide = part(steel, 0.015, 0.04, 0.075, 0.047, 0.02, -0.1);
  } else {
    tube(steel, 0.026, 0.42, 0, 0.03, -0.73);
    tube(dark, 0.045, 0.22, 0, 0.12, -0.12);
    part(rubber, 0.1, 0.035, 0.3, 0, 0.09, -0.3);
    sight(0, -0.42, 0.06);
    part(wood, 0.09, 0.13, 0.75, 0, 0, -0.05);
    part(dark, 0.05, 0.05, 0.6, 0, 0.02, -0.68);
    moving.magazine = part(dark, 0.06, 0.12, 0.1, 0, -0.12, -0.02);
    part(rubber, 0.078, 0.15, 0.105, 0, -0.12, 0.105); // empuñadura separada
    part(mid, 0.06, 0.08, 0.28, 0, 0.12, -0.12);      // mira telescópica
    part(dark, 0.07, 0.09, 0.03, 0, 0.12, -0.27);
    part(wood, 0.085, 0.12, 0.2, 0, -0.02, 0.32);
    moving.slide = part(steel, 0.018, 0.04, 0.11, 0.05, 0.035, -0.2);
  }

  const triggerZ = ({
    pistol: -0.04, revolver: -0.015, shotgun: -0.025, smg: -0.055,
    ar: -0.05, sniper: -0.015, launcher: 0.01,
  }[kind] ?? -0.04);
  const trigger = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.045, 8), accent);
  trigger.name = 'weapon-trigger';
  trigger.position.set(0.006, -0.082, triggerZ);
  trigger.rotation.x = -0.2;
  trigger.castShadow = true;
  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0055, 5, 12, Math.PI * 1.35), dark);
  triggerGuard.name = 'weapon-trigger-guard';
  triggerGuard.position.set(0, -0.075, triggerZ + 0.006);
  triggerGuard.rotation.y = Math.PI / 2;
  triggerGuard.rotation.x = -0.2;
  triggerGuard.castShadow = true;
  g.add(trigger, triggerGuard);

  for (const [name, object] of Object.entries(moving)) {
    object.name = `weapon-${name}`;
    snapshotTransform(object);
  }

  const arms = buildFirstPersonArms(kind, { glove, glovePanel, cuff, sleeve, sleeveDark });
  g.add(arms.root);
  const gripTargets = createGripTargets(g, arms.gripState);
  g.userData.viewmodel = { kind, arms, moving, grip: arms.gripState, gripTargets };

  // destello del cañón
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffe9a0, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthTest: false,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.3, 0.3, 1);
  const flashZ = { sniper: -1.0, ar: -0.8, shotgun: -0.7, pistol: -0.35, revolver: -0.4, launcher: -0.55 };
  flash.position.set(0, 0.01, flashZ[kind] !== undefined ? flashZ[kind] : -0.5);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;

  const muzzleLight = new THREE.PointLight(0xffc56d, 0, 2.4, 2);
  muzzleLight.name = 'muzzle-light';
  muzzleLight.position.copy(flash.position);
  muzzleLight.castShadow = false;
  g.add(muzzleLight);
  g.userData.muzzleLight = muzzleLight;

  return g;
}

function tacticalKnifeBladeGeometry() {
  const profile = new THREE.Shape();
  profile.moveTo(0, -0.038);
  profile.lineTo(0, 0.052);
  profile.lineTo(0.29, 0.048);
  profile.lineTo(0.40, 0.028);
  profile.lineTo(0.49, -0.008);
  profile.lineTo(0.305, -0.036);
  profile.lineTo(0.055, -0.04);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: 0.028,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.0035,
    bevelThickness: 0.0035,
  });
  geometry.translate(0, 0, -0.014);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

function tacticalKnifeEdgeGeometry() {
  const edge = new THREE.Shape();
  edge.moveTo(0.035, -0.035);
  edge.lineTo(0.305, -0.031);
  edge.lineTo(0.49, -0.008);
  edge.lineTo(0.31, -0.018);
  edge.lineTo(0.055, -0.021);
  edge.closePath();
  const geometry = new THREE.ShapeGeometry(edge, 1);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

export function applyKnifeMeleePose(model, pose = meleeAnimationState(0)) {
  const viewmodel = model.userData.viewmodel;
  if (!viewmodel?.attackPivot || !viewmodel?.guardPivot) return false;
  const { attackPivot, guardPivot, arms } = viewmodel;
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  attackPivot.position.set(pose.position.x, pose.position.y, pose.position.z);
  attackPivot.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
  guardPivot.position.set(pose.guard.position.x, pose.guard.position.y, pose.guard.position.z);
  guardPivot.rotation.set(pose.guard.rotation.x, pose.guard.rotation.y, pose.guard.rotation.z);

  const grip = handGripState({ kind: 'knife', firePulse: pose.hands.gripPressure });
  arms.applyGrip(grip);
  // Al apretar, las falanges cierran pero la palma cede unos milímetros hacia
  // fuera. Así las yemas comprimen la superficie sin atravesar el mango.
  arms.right.position.x -= pose.hands.gripPressure * 0.014;
  arms.right.rotation.x += pose.hands.dominantFlex;
  arms.left.rotation.x += pose.hands.guardFlex;
  // Los dedos mantienen sus puntos de contacto, pero el volumen principal de
  // la palma se apoya fuera del eje del mango. El offset se expresa primero en
  // el espacio radial del pivote y luego se convierte al espacio local de la mano.
  const palmOffset = new THREE.Vector3(0.04, 0, 0)
    .applyQuaternion(arms.right.quaternion.clone().invert());
  for (const name of [
    'right-glove-palm', 'right-palm-pad', 'right-hand-backplate', 'right-thenar-pad',
  ]) {
    const part = arms.right.getObjectByName(name);
    if (!part) continue;
    part.userData.knifePalmBasePosition ||= part.position.clone();
    part.position.copy(part.userData.knifePalmBasePosition).add(palmOffset);
  }
  viewmodel.grip = grip;

  attackPivot.updateMatrix();
  guardPivot.updateMatrix();
  arms.update({ right: attackPivot.matrix, left: guardPivot.matrix });
  return true;
}

export function buildKnifeModel() {
  const g = new THREE.Group();
  g.name = 'viewmodel-knife';
  const {
    steel, steelEdge, steelDark, rubber, accent,
    glove, glovePanel, gloveGrip, stitch, cuff, sleeve, sleeveDark,
  } = createViewmodelMaterials();

  const attackPivot = new THREE.Group();
  attackPivot.name = 'knife-attack-pivot';
  const guardPivot = new THREE.Group();
  guardPivot.name = 'knife-guard-pivot';

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.235, 16, 2), rubber);
  handle.name = 'knife-handle';
  handle.position.set(0, -0.095, 0.065);
  // Sigue la diagonal guarda-pomo para que hoja, empuñadura y mano formen una
  // sola silueta continua.
  handle.rotation.x = 2.39;
  for (let index = 0; index < 3; index++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0385, 0.0027, 3, 10), steelDark);
    rib.name = `knife-handle-rib-${index + 1}`;
    rib.position.y = -0.06 + index * 0.06;
    rib.rotation.x = Math.PI / 2;
    handle.add(rib);
  }

  const guard = new THREE.Mesh(viewmodelBoxGeometry(0.142, 0.028, 0.052, {
    ratio: 0.3, maxRadius: 0.007, segments: 1,
  }), accent);
  guard.name = 'knife-guard';
  guard.position.set(0, -0.002, -0.035);
  const quillions = [-1, 1].map((direction) => {
    const quillion = new THREE.Mesh(viewmodelBoxGeometry(0.027, 0.068, 0.03, {
      ratio: 0.34, maxRadius: 0.007, segments: 1,
    }), accent);
    quillion.name = `knife-guard-quillion-${direction < 0 ? 'left' : 'right'}`;
    quillion.position.set(direction * 0.063, direction * 0.011, -0.033);
    quillion.rotation.z = -direction * 0.34;
    return quillion;
  });

  const blade = new THREE.Mesh(tacticalKnifeBladeGeometry(), steel);
  blade.name = 'knife-blade';
  blade.position.set(0, 0.008, -0.035);
  const edge = new THREE.Mesh(tacticalKnifeEdgeGeometry(), steelEdge);
  edge.name = 'knife-edge';
  edge.position.set(0.018, 0.008, -0.035);
  const fuller = new THREE.Mesh(viewmodelBoxGeometry(0.006, 0.015, 0.27, {
    ratio: 0.28, maxRadius: 0.0025, segments: 1,
  }), steelDark);
  fuller.name = 'knife-fuller';
  fuller.position.set(0.0185, 0.031, -0.215);
  const spine = new THREE.Mesh(viewmodelBoxGeometry(0.034, 0.012, 0.285, {
    ratio: 0.25, maxRadius: 0.003, segments: 1,
  }), steelDark);
  spine.name = 'knife-spine';
  spine.position.set(0, 0.056, -0.205);
  const tip = new THREE.Object3D();
  tip.name = 'knife-tip';
  tip.position.set(0, 0, -0.525);

  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.036, 0.038, 16, 1), steelDark);
  pommel.name = 'knife-pommel';
  pommel.position.set(0, -0.205, 0.155);
  pommel.rotation.x = 2.39;
  for (const part of [handle, guard, ...quillions, blade, edge, fuller, spine, pommel]) {
    part.castShadow = true;
    part.frustumCulled = false;
  }

  const arms = buildFirstPersonArms('knife', {
    glove, glovePanel, gloveGrip, stitch, cuff, sleeve, sleeveDark,
  });
  // Solo la mano dominante comparte el pivote de la hoja. La guardia usa un
  // pivote independiente para conservar su masa y contrapesar el ataque.
  attackPivot.add(handle, guard, ...quillions, blade, edge, fuller, spine, tip, pommel);
  attackPivot.add(arms.right, arms.chains.right.root);
  guardPivot.add(arms.left, arms.chains.left.root);
  arms.root.add(attackPivot, guardPivot);
  g.add(arms.root);

  const gripTargets = createGripTargets(g, arms.gripState);
  attackPivot.add(gripTargets.right);
  guardPivot.add(gripTargets.left);
  g.userData.viewmodel = {
    kind: 'knife', arms, moving: {}, grip: arms.gripState, gripTargets, attackPivot, guardPivot,
  };
  g.userData.blade = blade;
  g.userData.handle = handle;
  applyKnifeMeleePose(g, meleeAnimationState(0));
  g.visible = false;
  return g;
}

export class WeaponSystem {
  constructor(camera, scene, player, effects, audio, hud) {
    this.camera = camera;
    this.scene = scene;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.hud = hud;

    this.raycaster = new THREE.Raycaster();
    this.getTargets = () => [];       // lo inyecta main.js
    this.onTargetHit = () => {};      // lo inyecta main.js (bot local o entidad de red)
    this.onShot = null;               // aviso de cada disparo (para la red)
    this.onMeleeTrigger = null;        // clic primario con el cuchillo equipado
    this.onOpenBuy = null;             // selección de un slot todavía bloqueado
    this.onEconomyChange = null;      // persistencia opcional inyectada por main.js

    // estado por arma (munición persistente al cambiar)
    this.defs = WEAPON_DEFS;
    this.slots = [...WEAPON_ORDER];
    this.state = {};
    for (const key of this.slots) {
      this.state[key] = { ammo: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
    }
    this.current = 'pistol';
    this.preForcedKey = null;
    this.baseFov = BASE_FOV;

    // economía: empiezas solo con la pistola y compras el resto con bajas
    this.money = 0;
    this.owned = { pistol: true };

    this.triggerDown = false;
    this.ads = false;
    this.lastShot = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.kickPos = 0;
    this.kickRot = 0;
    this.bobTime = 0;
    this.animationTime = 0;
    this.firePulse = 0;
    this.equipProgress = 1;
    this.equipDuration = EQUIP_DURATIONS.pistol;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.aimMode = 'hold';
    this.weaponBob = 1;
    this.knifeEquipped = false;
    this.meleeActive = false;
    this.meleeProgress = 0;
    this.meleeCooldownUntil = 0;
    this.meleeStrikeCallback = null;
    this.meleeStrikeFired = false;
    this.fallbackControls = false;
    this.fallbackControlSurface = null;

    // grupo del modelo en primera persona, colgado de la cámara
    this.rig = new THREE.Group();
    this.rig.position.set(0.32, -0.3, -0.55);
    camera.add(this.rig);
    this.models = {};
    for (const key of this.slots) {
      const m = buildGunModel(WEAPON_DEFS[key].kind);
      m.visible = key === this.current;
      this.rig.add(m);
      this.models[key] = m;
    }
    this.knifeModel = buildKnifeModel();
    this.rig.add(this.knifeModel);

    addEventListener('mousedown', (e) => {
      if (!this.hasGameplayControl(e) || this.inputBlocked || this.meleeActive) return;
      if (e.button === 0) {
        this.primaryAction();
      }
      if (e.button === 2 && !this.knifeEquipped) {
        this.ads = this.aimMode === 'toggle' ? !this.ads : true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.triggerDown = false;
      if (e.button === 2 && this.aimMode === 'hold') this.ads = false;
    });
    addEventListener('contextmenu', (e) => {
      if (this.hasGameplayControl(e)) e.preventDefault();
    });
    this.inputBlocked = false; // true mientras un overlay usa las teclas numéricas
    addEventListener('keydown', (e) => {
      if (!this.hasGameplayControl() || this.inputBlocked) return;
      if (e.code === this.bindings.reload && !e.repeat) this.reload();
      const idx = bindingSlotIndex(this.bindings, e.code);
      if (!e.repeat && idx >= 0 && idx < this.slots.length) this.switchTo(this.slots[idx]);
    });
    addEventListener('wheel', (e) => {
      if (!this.hasGameplayControl(e) || this.inputBlocked || !e.deltaY) return;
      if (this.cycleWeapon(e.deltaY)) e.preventDefault();
    }, { passive: false });
    addEventListener('blur', () => this.clearInput());
    document.addEventListener('pointerlockchange', () => {
      if (!this.hasGameplayControl()) this.clearInput();
    });
  }

  setBindings(bindings) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.clearInput();
  }

  setFallbackControls(active, surface = null) {
    this.fallbackControls = !!active;
    this.fallbackControlSurface = surface || null;
    if (!this.hasGameplayControl()) this.clearInput();
  }

  hasGameplayControl(event = null) {
    if (document.pointerLockElement) return true;
    if (!this.fallbackControls) return false;
    if (!event || !this.fallbackControlSurface) return true;
    return this.fallbackControlSurface.contains?.(event.target) === true;
  }

  primaryAction() {
    if (this.player.dead || this.inputBlocked || this.meleeActive) return false;
    if (!this.knifeEquipped) {
      this.triggerDown = true;
      return true;
    }
    this.triggerDown = false;
    if (typeof this.onMeleeTrigger !== 'function') return false;
    return this.onMeleeTrigger() !== false;
  }

  setPreferences({ aimMode = 'hold', weaponBob = 1 } = {}) {
    this.aimMode = aimMode === 'toggle' ? 'toggle' : 'hold';
    this.weaponBob = Math.min(1, Math.max(0, Number(weaponBob) || 0));
    if (this.aimMode === 'hold' && !this.hasGameplayControl()) this.ads = false;
  }

  clearInput() {
    this.triggerDown = false;
    this.ads = false;
    if (this.meleeActive) this.cancelMelee();
  }

  get def() { return WEAPON_DEFS[this.current]; }
  get ammo() { return this.state[this.current]; }

  setFov(value) {
    const nextFov = Math.min(110, Math.max(70, Number(value) || BASE_FOV));
    if (nextFov === this.baseFov) return;
    this.baseFov = nextFov;
    if (this.ads) return;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  exportEconomyState() {
    const equipped = this.forcedKey ? this.preForcedKey : this.current;
    return sanitizeArsenalState({
      money: this.money,
      owned: this.owned,
      equipped,
    });
  }

  restoreEconomyState(value) {
    const restored = sanitizeArsenalState(value);
    this.money = restored.money;
    this.owned = { ...restored.owned };
    if (this.forcedKey) {
      this.preForcedKey = restored.equipped;
    } else if (restored.equipped !== this.current) {
      this._equip(restored.equipped);
    }
    this.hud.updateMoney(this.money);
    this.hud.updateSlots(this);
    this.hud.updateAmmo(this);
    return this.exportEconomyState();
  }

  _emitEconomyChange() {
    if (typeof this.onEconomyChange === 'function') {
      this.onEconomyChange(this.exportEconomyState());
    }
  }

  // añade dinero (por bajas); actualiza el HUD
  addMoney(n) {
    const amount = Number(n);
    const currentMoney = sanitizeArsenalMoney(this.money);
    this.money = sanitizeArsenalMoney(currentMoney + (Number.isFinite(amount) ? amount : 0));
    this.hud.updateMoney(this.money);
    this.hud.updateSlots(this);
    this._emitEconomyChange();
  }

  addAmmo(amount = 20) {
    const st = this.ammo;
    const before = st.reserve;
    st.reserve = ammoAfterPickup(st.reserve, amount, this.def.reserve * 2);
    const added = st.reserve - before;
    if (added > 0) this.hud.updateAmmo(this);
    return added;
  }

  // intenta comprar un arma no poseída
  tryBuy(key) {
    const def = WEAPON_DEFS[key];
    if (this.money < def.price) {
      this.hud.announce(`🔒 Te faltan $${def.price - this.money} para la ${def.name}`);
      this.audio.dry();
      return;
    }
    this.money -= def.price;
    this.owned[key] = true;
    this.audio.buy();
    this.hud.announce(`✔ ${def.name} desbloqueada`);
    this.hud.updateMoney(this.money);
    this.hud.updateSlots(this);
    if (!this.forcedKey) this._equip(key);
    this._emitEconomyChange();
  }

  switchTo(key) {
    if (this.player.dead) return;
    if (this.forcedKey) {
      // En búsqueda del arma no se cambia la selección impuesta, pero cualquier
      // tecla de arma sí permite volver del cuchillo a esa arma.
      if (this.knifeEquipped) this.unequipKnife(true);
      return;
    }
    if (key === this.current && !this.knifeEquipped) return;
    if (weaponSelectionAction(!!this.owned[key]) === 'open-buy') {
      if (this.knifeEquipped) this.unequipKnife(true);
      if (typeof this.onOpenBuy === 'function') this.onOpenBuy(key);
      else this.hud.announce(`Pulsa ${keyCodeLabel(this.bindings.openArsenal)} para abrir el arsenal y comprar armas`);
      this.audio.dry();
      return;
    }
    this._equip(key);
    this._emitEconomyChange();
  }

  _equip(key) {
    const leavingKnife = this.knifeEquipped;
    if (leavingKnife) this.unequipKnife(false);
    if (key === this.current) {
      if (!leavingKnife) return;
      this.equipProgress = 0;
      this.equipDuration = 0.28;
      this.kickPos = 0.06;
      this.hud.updateAmmo(this);
      this.hud.updateSlots(this);
      this._syncViewmodelVisibility();
      return;
    }
    const previous = this.models[this.current];
    previous.userData.flash.visible = false;
    previous.userData.muzzleLight.intensity = 0;
    this.current = key;
    this.reloading = false;
    this.equipProgress = 0;
    this.equipDuration = EQUIP_DURATIONS[this.def.kind] || 0.45;
    this.firePulse = 0;
    this.kickPos = 0.12; // pequeña animación de sacar el arma
    this.hud.updateAmmo(this);
    this.hud.updateSlots(this);
    this.hud.setReloading(false);
    this._syncViewmodelVisibility();
  }

  cycleWeapon(delta) {
    if (this.player.dead || !Number.isFinite(Number(delta)) || Number(delta) === 0) return false;
    if (this.forcedKey) {
      if (!this.knifeEquipped) return false;
      this.unequipKnife(true);
      return true;
    }
    const available = this.slots.filter((key) => this.owned[key]);
    if (available.length === 0) return false;
    const currentIndex = Math.max(0, available.indexOf(this.current));
    const direction = Number(delta) > 0 ? 1 : -1;
    const next = available[(currentIndex + direction + available.length) % available.length];
    const prior = this.current;
    const wasKnifeEquipped = this.knifeEquipped;
    this.switchTo(next);
    return wasKnifeEquipped || this.current !== prior;
  }

  // búsqueda del arma: el servidor impone qué arma llevas
  setForced(key) {
    const nextKey = key || null;
    const wasForced = !!this.forcedKey;
    if (nextKey) {
      if (!wasForced) {
        this.preForcedKey = this.owned[this.current] ? this.current : null;
      }
      this.forcedKey = nextKey;
      this.state[nextKey].ammo = WEAPON_DEFS[nextKey].mag;
      this.state[nextKey].reserve = WEAPON_DEFS[nextKey].reserve;
      this._equip(nextKey);
      this.hud.updateAmmo(this);
      return;
    }

    this.forcedKey = null;
    if (wasForced) {
      const previousOwned = this.preForcedKey && this.owned[this.preForcedKey]
        ? this.preForcedKey
        : null;
      const fallback = this.owned.pistol
        ? 'pistol'
        : this.slots.find((slot) => this.owned[slot]) || 'pistol';
      this.preForcedKey = null;
      this._equip(previousOwned || fallback);
      this.hud.updateAmmo(this);
    }
  }

  reload() {
    const st = this.ammo;
    const def = this.def;
    if (this.knifeEquipped || this.meleeActive || this.equipProgress < EQUIP_READY_PROGRESS || this.reloading ||
        st.ammo >= def.mag || st.reserve <= 0 || this.player.dead) return;
    this.reloading = true;
    this.reloadEnd = performance.now() / 1000 + def.reloadTime;
    this.audio.reload();
    this.hud.setReloading(true);
  }

  // munición completa en todas las armas (al reaparecer)
  refill() {
    this.clearInput();
    this.firePulse = 0;
    this.kickPos = 0;
    this.kickRot = 0;
    for (const key of this.slots) {
      this.state[key].ammo = WEAPON_DEFS[key].mag;
      this.state[key].reserve = WEAPON_DEFS[key].reserve;
    }
    this.reloading = false;
    this.hud.updateAmmo(this);
    this.hud.setReloading(false);
  }

  equipKnife() {
    if (this.knifeEquipped || this.player.dead || this.inputBlocked) return false;
    this.knifeEquipped = true;
    this.meleeActive = false;
    this.meleeProgress = KNIFE_READY_PROGRESS;
    this.meleeStrikeCallback = null;
    this.meleeStrikeFired = false;
    this.triggerDown = false;
    this.ads = false;
    this.reloading = false;
    this.firePulse = 0;
    this.models[this.current].userData.flash.visible = false;
    this.models[this.current].userData.muzzleLight.intensity = 0;
    this.hud.setReloading(false);
    this.hud.setScope(false);
    applyKnifeMeleePose(this.knifeModel, meleeAnimationState(KNIFE_READY_PROGRESS));
    this._syncViewmodelVisibility(false);
    return true;
  }

  unequipKnife(restoreDraw = true) {
    if (!this.knifeEquipped) return false;
    if (this.meleeActive) this.cancelMelee();
    this.knifeEquipped = false;
    this.meleeProgress = 0;
    this.meleeStrikeCallback = null;
    this.meleeStrikeFired = false;
    this.knifeModel.visible = false;
    if (restoreDraw && !this.player.dead) {
      this.equipProgress = 0;
      this.equipDuration = 0.28;
      this.kickPos = 0.06;
    }
    this._syncViewmodelVisibility();
    return true;
  }

  beginMelee(onStrike = null) {
    const time = performance.now() / 1000;
    if (!this.knifeEquipped || this.meleeActive || this.player.dead || this.inputBlocked ||
        time < this.meleeCooldownUntil) return false;
    this.meleeActive = true;
    this.meleeProgress = KNIFE_READY_PROGRESS;
    this.meleeStrikeCallback = typeof onStrike === 'function' ? onStrike : null;
    this.meleeStrikeFired = false;
    this.meleeCooldownUntil = time + MELEE_COOLDOWN;
    this.triggerDown = false;
    this.ads = false;
    this.reloading = false;
    this.firePulse = 0;
    this.models[this.current].userData.flash.visible = false;
    this.models[this.current].userData.muzzleLight.intensity = 0;
    this.hud.setReloading(false);
    this.hud.setScope(false);
    applyKnifeMeleePose(this.knifeModel, meleeAnimationState(KNIFE_READY_PROGRESS));
    this._syncViewmodelVisibility(false);
    return true;
  }

  cancelMelee() {
    if (!this.meleeActive) return false;
    this.meleeActive = false;
    this.meleeProgress = this.knifeEquipped ? KNIFE_READY_PROGRESS : 0;
    this.meleeStrikeCallback = null;
    this.meleeStrikeFired = false;
    if (this.knifeEquipped) {
      applyKnifeMeleePose(this.knifeModel, meleeAnimationState(KNIFE_READY_PROGRESS));
    }
    this._syncViewmodelVisibility();
    return true;
  }

  _syncViewmodelVisibility(scoped = this.ads && this.def.scope && !this.player.dead) {
    const visibility = viewmodelVisibilityState({
      dead: this.player.dead,
      scoped,
      knifeEquipped: this.knifeEquipped,
      meleeActive: this.meleeActive,
    });
    this.rig.visible = visibility.rig;
    for (const [key, model] of Object.entries(this.models)) {
      model.visible = visibility.firearm && key === this.current;
    }
    this.knifeModel.visible = visibility.knife;
    this.hud.setScope(visibility.scope);
    return visibility;
  }

  _updateMelee(dt) {
    if (!this.meleeActive) return;
    if (this.player.dead) {
      this.cancelMelee();
      return;
    }
    this.meleeProgress = Math.min(1, this.meleeProgress + Math.max(0, dt) / MELEE_DURATION);
    const pose = meleeAnimationState(this.meleeProgress);
    applyKnifeMeleePose(this.knifeModel, pose);
    if (!this.meleeStrikeFired && this.meleeProgress >= 0.43) {
      this.meleeStrikeFired = true;
      const strike = this.meleeStrikeCallback;
      this.meleeStrikeCallback = null;
      if (strike) strike();
    }
    if (this.meleeProgress >= 1) this.cancelMelee();
  }

  currentSpread() {
    const def = this.def;
    let s = this.ads ? def.adsSpread : def.spread;
    const moveFactor = Math.min(1, this.player.horizontalSpeed() / 8);
    if (!this.ads || def.scope === false) s += def.moveSpread * moveFactor * (this.ads ? 0.35 : 1);
    if (!this.player.onGround) s *= 1.6;
    return s;
  }

  _pulseViewmodelShot(kind) {
    const model = this.models[this.current];
    const flash = model.userData.flash;
    const scale = kind === 'shotgun' || kind === 'launcher' ? 0.42 : kind === 'sniper' ? 0.36 : 0.28;
    flash.visible = true;
    flash.material.rotation = Math.random() * Math.PI;
    flash.scale.setScalar(scale * (0.82 + Math.random() * 0.34));
    model.userData.muzzleLight.intensity = kind === 'launcher' ? 2.8 : kind === 'shotgun' ? 2.4 : 1.75;
    this.firePulse = 1;
    setTimeout(() => {
      flash.visible = false;
      model.userData.muzzleLight.intensity = 0;
    }, kind === 'launcher' ? 65 : 42);
  }

  fire() {
    const now = performance.now() / 1000;
    const def = this.def;
    const st = this.ammo;
    if (this.knifeEquipped || this.meleeActive || this.equipProgress < EQUIP_READY_PROGRESS || this.player.dead ||
        this.reloading || now - this.lastShot < 60 / def.rpm) return;
    if (st.ammo <= 0) {
      this.lastShot = now;
      // Un clic vacío produce una sola respuesta. Sin esto, mantener el botón
      // repite el sonido seco a la cadencia completa del arma cuando no queda reserva.
      this.triggerDown = false;
      this.audio.dry();
      this.reload();
      return;
    }
    this.lastShot = now;
    st.ammo--;

    const muzzle = new THREE.Vector3();
    this.models[this.current].userData.flash.getWorldPosition(muzzle);
    this._pulseViewmodelShot(def.kind);

    // el lanzagranadas dispara un proyectil, no balas
    if (def.launcher) {
      this.effects.muzzle(muzzle, def.kind);
      this.player.recoilPitch += def.recoil;
      this.kickPos = Math.min(0.2, this.kickPos + 0.15);
      this.kickRot = Math.min(0.6, this.kickRot + 0.4);
      this.audio.shot('launcher', 1);
      this.hud.updateAmmo(this);
      if (this.onLaunch) this.onLaunch();
      if (st.ammo <= 0) this.reload();
      this.triggerDown = false;
      return;
    }

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const spread = this.currentSpread();
    const targets = this.getTargets();
    const pellets = def.pellets || 1;

    this.effects.muzzle(muzzle, def.kind);

    // la escopeta dispara varios perdigones: el daño se agrega por objetivo
    const acc = new Map();
    const crateHits = [];
    let firstEnd = null;
    let impactSound = null;

    for (let i = 0; i < pellets; i++) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      dir.x += (Math.random() - 0.5) * 2 * spread;
      dir.y += (Math.random() - 0.5) * 2 * spread;
      dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = 300;

      const hits = this.raycaster.intersectObjects(targets, false);
      let end = origin.clone().addScaledVector(dir, 300);
      if (hits.length > 0) {
        const hit = hits[0];
        end = hit.point;
        const data = hit.object.userData;
        if (data.bot || data.net) {
          const isHead = data.part === 'head';
          const mult = isHead ? def.headMult : data.part === 'leg' ? 0.75 : 1;
          const key = data.bot || `${data.net.kind}:${data.net.id}`;
          const entry = acc.get(key) || { data, dmg: 0, head: false, point: hit.point };
          entry.dmg += Math.round(def.damage * mult);
          entry.head = entry.head || isHead;
          acc.set(key, entry);
        } else if (data.crate) {
          this.effects.impact(hit.point, 0xc09858, 3, 'wood');
          impactSound ||= 'wood';
          crateHits.push(data.crate);
        } else {
          this.effects.impact(hit.point, 0xd8d0b8, pellets > 1 ? 2 : 5, 'concrete');
          impactSound ||= 'concrete';
        }
      }
      if (!firstEnd) firstEnd = end;
    }

    if (impactSound && this.audio.impact) this.audio.impact(impactSound);
    if (this.onShot) this.onShot(muzzle, firstEnd, def.kind);
    // WebSocket conserva el orden: el servidor debe conocer el disparo antes
    // de autorizar cualquiera de sus impactos (incluidos los perdigones).
    for (const crateId of crateHits) {
      if (this.onCrateHit) this.onCrateHit(crateId, def.damage, def.kind);
    }
    for (const entry of acc.values()) {
      this.onTargetHit(entry.data, entry.dmg, entry.head, entry.point);
    }

    // retroceso
    this.player.recoilPitch += def.recoil * (this.ads ? 0.6 : 1);
    this.kickPos = Math.min(0.16, this.kickPos + def.recoil * 6);
    this.kickRot = Math.min(0.5, this.kickRot + def.recoil * 14);

    this.audio.shot(def.kind, 1);
    this.hud.updateAmmo(this);

    if (!def.auto) this.triggerDown = false;
  }

  _applyViewmodelPose(model, pose) {
    const viewmodel = model.userData.viewmodel;
    if (!viewmodel) return;
    const { kind, arms, moving } = viewmodel;
    const { right, left } = arms;
    const handPose = pose.hands;
    const mechanism = pose.mechanism;

    // Los dedos permanecen anclados al arma durante movimiento, ADS y recoil.
    // Solo la mano que manipula el mecanismo abandona temporalmente su agarre.
    const grip = handGripState({
      kind,
      ads: handPose.ads,
      reloading: handPose.reloading,
      reloadProgress: handPose.reloadProgress,
      firePulse: handPose.shot,
    });
    arms.applyGrip(grip);
    viewmodel.grip = grip;

    for (const object of Object.values(moving)) {
      object.position.copy(object.userData.basePosition);
      object.rotation.copy(object.userData.baseRotation);
      object.visible = true;
    }

    if (moving.slide) moving.slide.position.z += mechanism.slideTravel * 0.072;
    if (moving.magazine) {
      moving.magazine.position.y -= mechanism.magazineDrop * 0.3;
      moving.magazine.position.z += mechanism.magazineDrop * 0.055;
      moving.magazine.rotation.x += mechanism.magazineDrop * 0.22;
      moving.magazine.rotation.z += mechanism.magazineDrop * 0.12;
    }
    if (moving.pump) {
      const pumpTravel = mechanism.pumpTravel * 0.16;
      moving.pump.position.z += pumpTravel;
      // La mano acompaña exactamente la bomba y conserva todos sus contactos.
      left.position.z += pumpTravel;
    }
    if (moving.cylinder) {
      moving.cylinder.position.x += mechanism.cylinderOpen * 0.095;
      moving.cylinder.rotation.z += mechanism.cylinderOpen * 0.55 + mechanism.chamberCycle * 0.18;
    }
    if (moving.breech) {
      moving.breech.position.y -= mechanism.breechOpen * 0.055;
      moving.breech.rotation.x += mechanism.breechOpen * 0.82;
    }
    arms.update();
  }

  update(dt, inputEnabled) {
    const now = performance.now() / 1000;
    const def = this.def;
    const st = this.ammo;
    this.animationTime += Math.max(0, dt);
    this.equipProgress = Math.min(1, this.equipProgress + dt / Math.max(0.1, this.equipDuration));
    this.firePulse = Math.max(0, this.firePulse - dt * 4.8);
    this._updateMelee(dt);

    // recarga completa
    if (this.reloading && now >= this.reloadEnd) {
      this.reloading = false;
      const need = def.mag - st.ammo;
      const take = Math.min(need, st.reserve);
      st.ammo += take;
      st.reserve -= take;
      this.hud.updateAmmo(this);
      this.hud.setReloading(false);
    }

    if (inputEnabled && this.triggerDown && !this.player.dead && !this.knifeEquipped && !this.meleeActive) {
      this.fire();
    }

    // FOV según ADS
    const targetFov = (this.ads && !this.player.dead) ? this.baseFov / def.zoom : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();

    // mira telescópica: oculta el modelo y muestra el overlay
    const scoped = this.ads && def.scope && !this.player.dead && !this.knifeEquipped && !this.meleeActive;
    this._syncViewmodelVisibility(scoped);

    // animación del modelo: bob al andar + retroceso con muelle
    const speed = this.player.horizontalSpeed();
    if (this.player.onGround && speed > 1) this.bobTime += dt * Math.min(speed, 10);
    this.kickPos *= Math.max(0, 1 - dt * 10);
    this.kickRot *= Math.max(0, 1 - dt * 10);

    // animación de recarga: el arma baja, gira y vuelve a subir
    let reloadProgress = 0;
    if (this.reloading) {
      reloadProgress = Math.min(1, Math.max(0, 1 - (this.reloadEnd - now) / def.reloadTime));
      this.hud.setReloadProgress(reloadProgress);
    }

    const visual = weaponAnimationState({
      speed,
      ads: this.ads && !def.scope,
      reloading: this.reloading,
      reloadProgress,
      bobTime: this.bobTime,
      bobAmount: this.weaponBob,
      kickPos: this.kickPos,
      kickRot: this.kickRot,
    });
    const firstPerson = firstPersonAnimationState({
      time: this.animationTime,
      speed,
      onGround: this.player.onGround,
      sliding: this.player.sliding,
      ads: this.ads && !def.scope,
      reloading: this.reloading,
      reloadProgress,
      equipProgress: this.equipProgress,
      firePulse: this.firePulse,
      kind: def.kind,
      bobAmount: this.weaponBob,
    });
    const targetX = visual.position.x + firstPerson.position.x;
    const targetY = visual.position.y + firstPerson.position.y;
    const targetZ = visual.position.z + firstPerson.position.z;
    this.rig.position.x += (targetX - this.rig.position.x) * Math.min(1, dt * 14);
    this.rig.position.y += (targetY - this.rig.position.y) * Math.min(1, dt * 14);
    this.rig.position.z += (targetZ - this.rig.position.z) * Math.min(1, dt * 18);
    this.rig.rotation.x = visual.rotation.x + firstPerson.rotation.x;
    this.rig.rotation.y += (firstPerson.rotation.y - this.rig.rotation.y) * Math.min(1, dt * 16);
    this.rig.rotation.z = visual.rotation.z + firstPerson.rotation.z;
    const activeModel = this.models[this.current];
    activeModel.userData.muzzleLight.intensity *= Math.max(0, 1 - dt * 28);
    this._applyViewmodelPose(activeModel, firstPerson);

    // separación del punto de mira según dispersión
    this.hud.setCrosshairSpread(this.meleeActive ? 0 : this.currentSpread() * 900);
  }
}
