import * as THREE from 'three';
import { humanoidModelProfile, humanoidPoseState } from './ui-models.js';

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
  const uniform = new THREE.MeshLambertMaterial({ color });
  const uniformDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.48) });
  const uniformMid = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.72) });
  const armor = new THREE.MeshLambertMaterial({ color: 0x202a35 });
  const armorEdge = new THREE.MeshLambertMaterial({ color: 0x3f5365 });
  const skinTone = new THREE.MeshLambertMaterial({ color: 0xe0aa7a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x202a34 });
  const boot = new THREE.MeshLambertMaterial({ color: 0x111821 });
  const glove = new THREE.MeshLambertMaterial({ color: 0x171d25 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x11161d });
  const visor = new THREE.MeshLambertMaterial({ color: 0x152b3a });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x292e36 });
  const gunAccent = new THREE.MeshLambertMaterial({ color: 0x59636d });

  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const parts = [];
  const profile = humanoidModelProfile();
  const armorGroup = new THREE.Group();
  const headgear = new THREE.Group();
  const equipment = new THREE.Group();
  armorGroup.name = 'armor';
  headgear.name = 'headgear';
  equipment.name = 'equipment';
  torso.add(armorGroup, headgear, equipment);

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
  box(0.7, 0.08, 0.44, uniformDark, 0, 0.82, 0, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, -0.38, 1.3, 0, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, 0.38, 1.3, 0, null, armorGroup);

  // Mochila, correas y radio para dar una silueta reconocible desde atrás.
  box(...profile.backpack, armor, 0, 1.12, 0.29, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, -0.2, 1.12, 0.23, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, 0.2, 1.12, 0.23, null, equipment);
  box(0.14, 0.2, 0.08, metal, 0.28, 1.35, 0.04, null, equipment);
  box(0.04, 0.28, 0.04, armorEdge, 0.28, 1.58, 0.04, null, equipment);

  const head = box(0.42, 0.42, 0.42, skinTone, 0, 1.66, 0, 'head', torso);
  const faceVisor = box(0.28, 0.08, 0.04, visor, 0, 1.76, -0.22, null, headgear);
  faceVisor.castShadow = false;
  box(...profile.helmet, armor, 0, 1.91, 0, null, headgear);
  box(0.56, 0.08, 0.5, armorEdge, 0, 1.82, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, -0.27, 1.86, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, 0.27, 1.86, 0, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, -0.32, 1.63, -0.03, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, 0.32, 1.63, -0.03, null, headgear);

  const armL = new THREE.Group(); armL.position.set(-0.4, 1.34, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.34, 0);
  armL.name = 'armL';
  armR.name = 'armR';
  torso.add(armL, armR);
  box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armL);
  box(...profile.limb, uniformMid, 0, -0.26, 0, 'arm', armR);
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armL);
  box(...profile.shoulder, armor, 0, -0.03, 0, null, armR);
  box(0.22, 0.12, 0.27, armorEdge, 0, -0.35, -0.01, null, armL);
  box(0.22, 0.12, 0.27, armorEdge, 0, -0.35, -0.01, null, armR);
  box(0.21, 0.16, 0.24, glove, 0, -0.59, -0.02, null, armL);
  box(0.21, 0.16, 0.24, glove, 0, -0.59, -0.02, null, armR);

  const gun = new THREE.Group();
  gun.name = 'gun';
  gun.position.set(0, -0.5, -0.1);
  gun.rotation.x = Math.PI / 2;
  box(0.14, 0.16, 0.55, gunMat, 0, 0.04, -0.24, null, gun);
  box(0.12, 0.14, 0.24, metal, 0, 0.04, 0.13, null, gun);
  box(0.09, 0.1, 0.38, gunAccent, 0, 0.04, -0.67, null, gun);
  box(0.1, 0.12, 0.2, metal, 0, -0.14, -0.26, null, gun);
  box(0.06, 0.06, 0.12, gunAccent, 0, 0.14, -0.48, null, gun);
  box(0.12, 0.06, 0.08, metal, 0, 0.08, -0.9, null, gun);
  armR.add(gun);

  const hatMesh = makeHat(hat);
  if (hatMesh) {
    hatMesh.position.set(0, 1.92, 0);
    torso.add(hatMesh);
  }

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, hatMesh ? 2.55 : 2.35, 0);
  torso.add(nameSprite);

  return { group, parts, torso, body, legL, legR, armL, armR, head, gun, nameSprite, armor: armorGroup, headgear, equipment };
}

// pose de andar/apuntar, compartida
export function animateHumanoid(rig, dt, speed, walkTimeRef, aiming, aimPitch = 0) {
  walkTimeRef.t += dt * speed * 1.7;
  const pose = humanoidPoseState(walkTimeRef.t, speed, aiming, aimPitch);
  rig.legL.rotation.x = pose.legL;
  rig.legR.rotation.x = pose.legR;
  rig.armR.rotation.x = pose.armR;
  rig.armL.rotation.x = pose.armL;
  rig.armL.position.x = pose.armLx;
  rig.armR.position.x = pose.armRx;
  rig.armL.rotation.z = pose.armLz;
  rig.armR.rotation.z = pose.armRz;
  rig.gun.rotation.x = pose.gunRotationX;
  rig.torso.position.y = pose.bodyY;
  const sway = Math.sin(walkTimeRef.t * 0.5) * Math.min(1, Math.max(0, speed) / 5.2);
  rig.torso.rotation.z = sway * 0.025;
  if (rig.equipment) rig.equipment.rotation.z = -sway * 0.04;
}
