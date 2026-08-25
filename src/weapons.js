import * as THREE from 'three';
import { ammoAfterPickup, weaponSelectionAction, weaponAnimationState } from './ui-models.js';
import { DEFAULT_BINDINGS, bindingSlotIndex, keyCodeLabel } from './input-bindings.js';
import { roundedBoxGeometry } from './rounded-geometry.js';

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

const EQUIP_DURATIONS = Object.freeze({
  pistol: 0.3,
  revolver: 0.38,
  smg: 0.4,
  ar: 0.46,
  shotgun: 0.52,
  sniper: 0.58,
  launcher: 0.62,
});

const HAND_POSES = Object.freeze({
  pistol:   { right: [0.018, -0.145, 0.085], left: [-0.092, -0.13, 0.025] },
  revolver: { right: [0.018, -0.14, 0.095], left: [-0.105, -0.105, 0.005] },
  shotgun:  { right: [0.02, -0.135, 0.09], left: [-0.018, -0.095, -0.31] },
  smg:      { right: [0.018, -0.14, 0.07], left: [-0.018, -0.082, -0.21] },
  ar:       { right: [0.018, -0.145, 0.075], left: [-0.018, -0.085, -0.32] },
  sniper:   { right: [0.018, -0.14, 0.09], left: [-0.018, -0.07, -0.39] },
  launcher: { right: [0.018, -0.15, 0.105], left: [-0.018, -0.105, -0.22] },
  knife:    { right: [0.012, -0.135, 0.07], left: [-0.19, -0.175, 0.12] },
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

export function meleeAnimationState(progress = 0) {
  const p = clamp01(progress);
  const draw = smoothRange(0, 0.2, p);
  const strike = windowPulse(p, 0.16, 0.43, 0.7);
  const recover = smoothRange(0.62, 1, p);
  const ready = draw * (1 - recover);
  return {
    visible: p < 1,
    strike,
    position: {
      x: 0.08 - ready * 0.03 - strike * 0.44,
      y: -0.24 - (1 - draw) * 0.34 + recover * 0.08,
      z: -0.08 - ready * 0.03 - strike * 0.24,
    },
    rotation: {
      x: -0.12 + strike * 0.35,
      y: -0.38 + strike * 0.92,
      z: 0.2 + (1 - draw) * 0.78 + strike * 1.18 - recover * 0.2,
    },
  };
}

export function viewmodelVisibilityState({ dead = false, scoped = false, meleeActive = false } = {}) {
  const alive = !dead;
  return {
    rig: alive,
    firearm: alive && !scoped && !meleeActive,
    knife: alive && meleeActive,
    scope: alive && scoped && !meleeActive,
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

function makeArmSegment(material, radiusTop, radiusBottom = radiusTop) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 12, 1), material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
}

function setArmSegment(mesh, from, to, delta) {
  delta.subVectors(to, from);
  const length = Math.max(0.001, delta.length());
  mesh.position.copy(from).addScaledVector(delta, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(ARM_UP, delta.multiplyScalar(1 / length));
}

function buildFirstPersonArms(kind, materials) {
  const root = new THREE.Group();
  root.name = 'first-person-arms';
  const pose = HAND_POSES[kind] || HAND_POSES.pistol;
  const palmGeometry = new THREE.SphereGeometry(0.075, 12, 8);
  const palmPadGeometry = viewmodelBoxGeometry(0.086, 0.018, 0.072, {
    ratio: 0.28, maxRadius: 0.005, segments: 1,
  });
  const knuckleGeometry = new THREE.SphereGeometry(0.014, 10, 6);
  const fingerLengths = [0.034, 0.029, 0.024];
  const fingerGeometries = fingerLengths.map((length, index) => {
    const geometry = new THREE.CylinderGeometry(0.008 - index * 0.0007, 0.0105 - index * 0.0005, length, 10, 1);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  });
  const fingertipGeometry = new THREE.SphereGeometry(0.009, 10, 6);
  const thumbLengths = [0.038, 0.031];
  const thumbGeometries = thumbLengths.map((length, index) => {
    const geometry = new THREE.CylinderGeometry(0.011 - index * 0.001, 0.013 - index * 0.001, length, 10, 1);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  });
  const elbowGeometry = new THREE.SphereGeometry(0.078, 12, 8);
  const shoulderGeometry = new THREE.SphereGeometry(0.092, 12, 8);

  const makeHand = (side, position) => {
    const direction = side === 'left' ? -1 : 1;
    const hand = new THREE.Group();
    hand.name = `${side}-hand`;
    hand.position.fromArray(position);

    const palm = new THREE.Mesh(palmGeometry, materials.glove);
    palm.name = `${side}-glove-palm`;
    palm.scale.set(0.72, 0.56, 0.94);
    palm.rotation.x = -0.18;
    hand.add(palm);

    const palmPad = new THREE.Mesh(palmPadGeometry, materials.glovePanel);
    palmPad.name = `${side}-palm-pad`;
    palmPad.position.set(0, -0.012, -0.038);
    palmPad.rotation.x = -0.1;
    hand.add(palmPad);

    const baseCurls = side === 'right'
      ? (kind === 'knife' ? [0.26, 0.68, 0.78, 0.86] : [0.16, 0.56, 0.66, 0.74])
      : [0.5, 0.58, 0.66, 0.74];
    const lengthScales = [0.93, 1.05, 1, 0.84];

    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Group();
      finger.name = `${side}-finger-${i + 1}`;
      finger.position.set((i - 1.5) * 0.021, -0.018, -0.063);
      finger.rotation.x = 0.08;
      const knuckle = new THREE.Mesh(knuckleGeometry, materials.glovePanel);
      knuckle.name = `${side}-finger-${i + 1}-knuckle`;
      knuckle.scale.set(0.88, 0.72, 0.9);
      finger.add(knuckle);
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
          nextJoint.position.z = -length;
          nextJoint.rotation.x = baseCurls[i] * (segmentIndex === 0 ? 0.7 : 0.9);
          joint.add(nextJoint);
          joint = nextJoint;
        } else {
          const tip = new THREE.Mesh(fingertipGeometry, materials.glovePanel);
          tip.name = `${side}-finger-${i + 1}-tip`;
          tip.position.z = -length;
          tip.scale.set(0.9, 0.76, 1.08);
          joint.add(tip);
        }
      }
      hand.add(finger);
    }

    const thumb = new THREE.Group();
    thumb.name = `${side}-thumb`;
    thumb.position.set(direction * 0.055, -0.018, -0.005);
    thumb.rotation.z = Math.PI / 2 + direction * 0.22;
    thumb.rotation.x = -0.28;
    let thumbJoint = thumb;
    for (let index = 0; index < thumbGeometries.length; index++) {
      const segment = new THREE.Mesh(thumbGeometries[index], index === 0 ? materials.glove : materials.glovePanel);
      segment.name = `${side}-thumb-${index === 0 ? 'proximal' : 'distal'}`;
      segment.position.z = -thumbLengths[index] / 2;
      thumbJoint.add(segment);
      if (index === 0) {
        const next = new THREE.Group();
        next.position.z = -thumbLengths[index];
        next.rotation.x = kind === 'knife' && side === 'right' ? 0.62 : 0.42;
        thumbJoint.add(next);
        thumbJoint = next;
      }
    }
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

    snapshotTransform(hand);
    root.add(hand);
    return hand;
  };

  const right = makeHand('right', pose.right);
  const left = makeHand('left', pose.left);
  // La mano de apoyo envuelve el guardamanos en vez de copiar la pose del gatillo.
  left.rotation.z = -0.08;
  left.rotation.x = -0.12;
  snapshotTransform(left);

  const chains = {};
  for (const [side, hand] of [['right', right], ['left', left]]) {
    const direction = side === 'left' ? -1 : 1;
    const chain = new THREE.Group();
    chain.name = `${side}-arm-chain`;
    const upperArm = makeArmSegment(materials.sleeveDark, 0.085, 0.103);
    upperArm.name = `${side}-upper-arm`;
    const forearm = makeArmSegment(materials.sleeve, 0.068, 0.083);
    forearm.name = `${side}-forearm`;
    const elbowGuard = new THREE.Mesh(elbowGeometry, materials.sleeveDark);
    elbowGuard.name = `${side}-elbow-guard`;
    elbowGuard.scale.set(0.92, 0.76, 0.9);
    const shoulderPad = new THREE.Mesh(shoulderGeometry, materials.sleeveDark);
    shoulderPad.name = `${side}-shoulder-pad`;
    shoulderPad.scale.set(1, 0.8, 0.9);
    chain.add(upperArm, forearm, elbowGuard, shoulderPad);
    root.add(chain);
    chains[side] = {
      hand, direction, upperArm, forearm, elbowGuard, shoulderPad,
      shoulder: new THREE.Vector3(direction * 0.3, -0.27, 0.2),
      wristOffset: new THREE.Vector3(direction * 0.004, -0.052, 0.083),
      wrist: new THREE.Vector3(), elbow: new THREE.Vector3(), delta: new THREE.Vector3(),
    };
  }

  const update = () => {
    for (const chain of Object.values(chains)) {
      chain.wrist.copy(chain.wristOffset).applyEuler(chain.hand.rotation).add(chain.hand.position);
      chain.elbow.lerpVectors(chain.shoulder, chain.wrist, 0.53);
      chain.elbow.x += chain.direction * 0.055;
      chain.elbow.y -= 0.038;
      chain.elbow.z += 0.025;
      setArmSegment(chain.upperArm, chain.shoulder, chain.elbow, chain.delta);
      setArmSegment(chain.forearm, chain.elbow, chain.wrist, chain.delta);
      chain.elbowGuard.position.copy(chain.elbow);
      chain.shoulderPad.position.copy(chain.shoulder);
    }
  };
  update();
  return { root, right, left, chains, update };
}

function createViewmodelMaterials() {
  return {
    dark: new THREE.MeshLambertMaterial({ color: 0x171c24 }),
    mid: new THREE.MeshLambertMaterial({ color: 0x465463 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x252d37 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8796a5, metalness: 0.78, roughness: 0.27 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5c4738, roughness: 0.72 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.92 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xc69b48, metalness: 0.45, roughness: 0.42 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x394956, roughness: 0.88 }),
    glovePanel: new THREE.MeshStandardMaterial({ color: 0x718493, roughness: 0.68 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x202b36, roughness: 0.9 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.94 }),
    sleeveDark: new THREE.MeshStandardMaterial({ color: 0x253647, roughness: 0.96 }),
  };
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
    moving.magazine = part(dark, 0.06, 0.12, 0.1, 0, -0.12, 0.08);
    part(mid, 0.06, 0.08, 0.28, 0, 0.12, -0.12);      // mira telescópica
    part(dark, 0.07, 0.09, 0.03, 0, 0.12, -0.27);
    part(wood, 0.085, 0.12, 0.2, 0, -0.02, 0.32);
    moving.slide = part(steel, 0.018, 0.04, 0.11, 0.05, 0.035, -0.2);
  }

  for (const [name, object] of Object.entries(moving)) {
    object.name = `weapon-${name}`;
    snapshotTransform(object);
  }

  const arms = buildFirstPersonArms(kind, { glove, glovePanel, cuff, sleeve, sleeveDark });
  g.add(arms.root);
  g.userData.viewmodel = { kind, arms, moving };

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

export function buildKnifeModel() {
  const g = new THREE.Group();
  g.name = 'viewmodel-knife';
  const {
    steel, rubber, accent, glove, glovePanel, cuff, sleeve, sleeveDark,
  } = createViewmodelMaterials();

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.041, 0.19, 12), rubber);
  handle.name = 'knife-handle';
  handle.position.set(0, -0.095, 0.065);
  handle.rotation.x = Math.PI / 2;
  const guard = new THREE.Mesh(viewmodelBoxGeometry(0.145, 0.026, 0.045, {
    ratio: 0.25, maxRadius: 0.006, segments: 2,
  }), accent);
  guard.name = 'knife-guard';
  guard.position.set(0, -0.002, -0.035);
  const blade = new THREE.Mesh(viewmodelBoxGeometry(0.032, 0.065, 0.38, {
    ratio: 0.18, maxRadius: 0.006, segments: 2,
  }), steel);
  blade.name = 'knife-blade';
  blade.position.set(0, 0.008, -0.245);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.13, 6), steel);
  tip.name = 'knife-tip';
  tip.position.set(0, 0.008, -0.5);
  tip.rotation.x = -Math.PI / 2;
  tip.rotation.y = Math.PI / 4;
  const spine = new THREE.Mesh(viewmodelBoxGeometry(0.045, 0.018, 0.31, {
    ratio: 0.22, maxRadius: 0.004, segments: 1,
  }), accent);
  spine.name = 'knife-spine';
  spine.position.set(0, 0.045, -0.22);
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.036, 0.035, 12), accent);
  pommel.name = 'knife-pommel';
  pommel.position.set(0, -0.205, 0.155);
  pommel.rotation.x = Math.PI / 2;
  for (const part of [handle, guard, blade, tip, spine, pommel]) {
    part.castShadow = true;
    part.frustumCulled = false;
  }
  g.add(handle, guard, blade, tip, spine, pommel);

  const arms = buildFirstPersonArms('knife', { glove, glovePanel, cuff, sleeve, sleeveDark });
  arms.right.rotation.x -= 0.08;
  arms.right.rotation.z += 0.06;
  snapshotTransform(arms.right);
  arms.left.rotation.x = -0.36;
  arms.left.rotation.z = -0.22;
  snapshotTransform(arms.left);
  arms.update();
  g.add(arms.root);
  g.userData.viewmodel = { kind: 'knife', arms, moving: {} };
  g.userData.blade = blade;
  g.userData.handle = handle;
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
    this.meleeActive = false;
    this.meleeProgress = 0;
    this.meleeCooldownUntil = 0;
    this.meleeStrikeCallback = null;
    this.meleeStrikeFired = false;

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
      if (!document.pointerLockElement || this.inputBlocked || this.meleeActive) return;
      if (e.button === 0) this.triggerDown = true;
      if (e.button === 2) this.ads = this.aimMode === 'toggle' ? !this.ads : true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.triggerDown = false;
      if (e.button === 2 && this.aimMode === 'hold') this.ads = false;
    });
    addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement) e.preventDefault();
    });
    this.inputBlocked = false; // true mientras un overlay usa las teclas numéricas
    addEventListener('keydown', (e) => {
      if (!document.pointerLockElement || this.inputBlocked) return;
      if (e.code === this.bindings.reload && !e.repeat) this.reload();
      const idx = bindingSlotIndex(this.bindings, e.code);
      if (!e.repeat && idx >= 0 && idx < this.slots.length) this.switchTo(this.slots[idx]);
    });
    addEventListener('blur', () => this.clearInput());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.clearInput();
    });
  }

  setBindings(bindings) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.clearInput();
  }

  setPreferences({ aimMode = 'hold', weaponBob = 1 } = {}) {
    this.aimMode = aimMode === 'toggle' ? 'toggle' : 'hold';
    this.weaponBob = Math.min(1, Math.max(0, Number(weaponBob) || 0));
    if (this.aimMode === 'hold' && !document.pointerLockElement) this.ads = false;
  }

  clearInput() {
    this.triggerDown = false;
    this.ads = false;
    if (this.meleeActive) this.cancelMelee(false);
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
    if (this.forcedKey) return; // en búsqueda del arma no se cambia a mano
    if (key === this.current || this.player.dead || this.meleeActive) return;
    if (weaponSelectionAction(!!this.owned[key]) === 'open-buy') {
      this.hud.announce(`Pulsa ${keyCodeLabel(this.bindings.openArsenal)} para abrir el arsenal y comprar armas`);
      this.audio.dry();
      return;
    }
    this._equip(key);
    this._emitEconomyChange();
  }

  _equip(key) {
    if (key === this.current) return;
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
    if (this.meleeActive || this.equipProgress < EQUIP_READY_PROGRESS || this.reloading ||
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

  beginMelee(onStrike = null) {
    const time = performance.now() / 1000;
    if (this.meleeActive || this.player.dead || this.inputBlocked || time < this.meleeCooldownUntil) return false;
    this.meleeActive = true;
    this.meleeProgress = 0;
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
    this._syncViewmodelVisibility(false);
    return true;
  }

  cancelMelee(restoreDraw = true) {
    if (!this.meleeActive) return false;
    this.meleeActive = false;
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

  _syncViewmodelVisibility(scoped = this.ads && this.def.scope && !this.player.dead) {
    const visibility = viewmodelVisibilityState({
      dead: this.player.dead,
      scoped,
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
      this.cancelMelee(false);
      return;
    }
    this.meleeProgress = Math.min(1, this.meleeProgress + Math.max(0, dt) / MELEE_DURATION);
    const pose = meleeAnimationState(this.meleeProgress);
    this.knifeModel.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.knifeModel.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
    this.knifeModel.userData.viewmodel.arms.update();
    if (!this.meleeStrikeFired && this.meleeProgress >= 0.43) {
      this.meleeStrikeFired = true;
      const strike = this.meleeStrikeCallback;
      this.meleeStrikeCallback = null;
      if (strike) strike();
    }
    if (this.meleeProgress >= 1) this.cancelMelee(true);
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
    if (this.meleeActive || this.equipProgress < EQUIP_READY_PROGRESS || this.player.dead ||
        this.reloading || now - this.lastShot < 60 / def.rpm) return;
    if (st.ammo <= 0) {
      this.lastShot = now;
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
          if (this.onCrateHit) this.onCrateHit(data.crate, def.damage, def.kind);
        } else {
          this.effects.impact(hit.point, 0xd8d0b8, pellets > 1 ? 2 : 5, 'concrete');
          impactSound ||= 'concrete';
        }
      }
      if (!firstEnd) firstEnd = end;
    }

    for (const entry of acc.values()) {
      this.onTargetHit(entry.data, entry.dmg, entry.head, entry.point);
    }
    if (impactSound && this.audio.impact) this.audio.impact(impactSound);
    if (this.onShot) this.onShot(muzzle, firstEnd, def.kind);

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

    right.position.copy(right.userData.basePosition);
    right.rotation.copy(right.userData.baseRotation);
    left.position.copy(left.userData.basePosition);
    left.rotation.copy(left.userData.baseRotation);

    // Las dos manos absorben el paso y el disparo de forma ligeramente distinta:
    // evita que parezcan una única pieza rígida pegada al arma.
    right.position.y -= handPose.step * 0.003;
    right.position.z += handPose.shot * 0.025;
    right.rotation.x += handPose.shot * 0.12;
    right.rotation.z += handPose.sway * 0.012 - handPose.sprint * 0.055;
    left.position.y += handPose.step * 0.002;
    left.position.x -= handPose.sway * 0.004;
    left.position.z += handPose.shot * 0.018;
    left.rotation.x += handPose.shot * 0.08;
    left.rotation.z -= handPose.sway * 0.014 - handPose.sprint * 0.09;

    const reloadArc = handPose.reloadArc;
    if (MAGAZINE_WEAPONS.has(kind)) {
      left.position.x += reloadArc * 0.07;
      left.position.y -= reloadArc * 0.09 + mechanism.magazineDrop * 0.19;
      left.position.z += reloadArc * 0.085;
      left.rotation.x -= reloadArc * 0.72;
      left.rotation.z += reloadArc * 0.38;
    } else if (kind === 'shotgun') {
      left.position.z += mechanism.pumpTravel * 0.17;
      left.position.y -= reloadArc * 0.045;
      left.rotation.x += mechanism.pumpTravel * 0.2;
    } else if (kind === 'revolver') {
      left.position.x += reloadArc * 0.16;
      left.position.y += reloadArc * 0.025;
      left.position.z += reloadArc * 0.065;
      left.rotation.x -= reloadArc * 0.48;
      left.rotation.z += reloadArc * 0.62;
      right.rotation.z -= reloadArc * 0.12;
    } else if (kind === 'launcher') {
      left.position.x -= reloadArc * 0.035;
      left.position.y -= reloadArc * 0.15;
      left.position.z += reloadArc * 0.12;
      left.rotation.x -= reloadArc * 0.8;
      right.rotation.z -= reloadArc * 0.1;
    }

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
    if (moving.pump) moving.pump.position.z += mechanism.pumpTravel * 0.16;
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

    if (inputEnabled && this.triggerDown && !this.player.dead && !this.meleeActive) this.fire();

    // FOV según ADS
    const targetFov = (this.ads && !this.player.dead) ? this.baseFov / def.zoom : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();

    // mira telescópica: oculta el modelo y muestra el overlay
    const scoped = this.ads && def.scope && !this.player.dead && !this.meleeActive;
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
