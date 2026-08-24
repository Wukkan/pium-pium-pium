import * as THREE from 'three';
import { humanoidModelProfile } from './ui-models.js';
import {
  clamp01,
  operatorDeathState,
  operatorMotionState,
} from './character-motion.js';

// ---------------------------------------------------------------------------
// Modelo humanoide "blocky" compartido por bots locales y jugadores remotos.
// ---------------------------------------------------------------------------

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
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
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
  const glove = new THREE.MeshLambertMaterial({ color: 0x171d25 });
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
    new THREE.BoxGeometry(w, h, d), mat, x, y, z, partName, parent,
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
  const forearmL = new THREE.Group(); forearmL.position.set(0, -0.28, 0);
  const forearmR = new THREE.Group(); forearmR.position.set(0, -0.28, 0);
  forearmL.name = 'forearmL';
  forearmR.name = 'forearmR';
  armL.add(forearmL);
  armR.add(forearmR);
  box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armL);
  box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armR);
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armL);
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armR);
  box(0.24, 0.07, 0.28, uniformAccent, 0, -0.03, -0.01, null, armL);
  box(0.24, 0.07, 0.28, uniformAccent, 0, -0.03, -0.01, null, armR);
  box(0.22, 0.2, 0.27, armorEdge, 0, -0.09, -0.01, null, forearmL);
  box(0.22, 0.2, 0.27, armorEdge, 0, -0.09, -0.01, null, forearmR);
  box(0.21, 0.16, 0.24, glove, 0, -0.3, -0.02, null, forearmL);
  box(0.21, 0.16, 0.24, glove, 0, -0.3, -0.02, null, forearmR);

  const gun = new THREE.Group();
  gun.name = 'gun';
  gun.position.set(0, -0.22, -0.1);
  box(0.14, 0.16, 0.55, gunMat, 0, 0.04, -0.24, null, gun);
  box(0.12, 0.14, 0.24, metal, 0, 0.04, 0.13, null, gun);
  box(0.09, 0.1, 0.38, gunAccent, 0, 0.04, -0.67, null, gun);
  box(0.1, 0.12, 0.2, metal, 0, -0.14, -0.26, null, gun);
  box(0.06, 0.06, 0.12, gunAccent, 0, 0.14, -0.48, null, gun);
  box(0.12, 0.06, 0.08, metal, 0, 0.08, -0.9, null, gun);
  box(0.12, 0.08, 0.2, armorEdge, 0, 0.12, -0.18, null, gun);
  box(0.035, 0.05, 0.32, metal, 0, 0.04, -1.02, null, gun);
  const muzzleFlash = add(
    new THREE.ConeGeometry(0.09, 0.28, 4), flashMaterial,
    0, 0.04, -1.23, null, gun,
  );
  muzzleFlash.name = 'muzzleFlash';
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.visible = false;
  muzzleFlash.castShadow = false;
  muzzleFlash.receiveShadow = false;
  forearmR.add(gun);

  const hatMesh = makeHat(hat);
  if (hatMesh) {
    hatMesh.position.set(0, 0.26, 0);
    headPivot.add(hatMesh);
  }

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, hatMesh ? 2.55 : 2.35, 0);
  torso.add(nameSprite);

  return {
    group, parts, torso, body, legL, legR, armL, armR, forearmL, forearmR,
    head, headPivot, gun, muzzleFlash, nameSprite,
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
  rig.armR.rotation.x = damp(rig.armR.rotation.x, pose.armR, response);
  rig.armL.rotation.x = damp(rig.armL.rotation.x, pose.armL, response);
  rig.armL.position.x = damp(rig.armL.position.x, pose.armLx, response);
  rig.armR.position.x = damp(rig.armR.position.x, pose.armRx, response);
  rig.armL.rotation.z = damp(rig.armL.rotation.z, pose.armLz, response);
  rig.armR.rotation.z = damp(rig.armR.rotation.z, pose.armRz, response);
  if (rig.forearmL) rig.forearmL.rotation.x = damp(rig.forearmL.rotation.x, pose.forearmL, response);
  if (rig.forearmR) rig.forearmR.rotation.x = damp(rig.forearmR.rotation.x, pose.forearmR, response);
  rig.gun.rotation.x = damp(rig.gun.rotation.x, pose.gunRotationX, response);
  rig.gun.position.z = damp(rig.gun.position.z, pose.gunPositionZ, response);
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
  if (rig.forearmL) rig.forearmL.rotation.set(0, 0, 0);
  if (rig.forearmR) rig.forearmR.rotation.set(0, 0, 0);
  if (rig.headPivot) rig.headPivot.rotation.set(0, 0, 0);
  if (rig.equipment) rig.equipment.rotation.set(0, 0, 0);
  rig.gun.rotation.set(0, 0, 0);
  rig.gun.position.z = -0.1;
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
    if (object.geometry) geometries.add(object.geometry);
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
