import * as THREE from 'three';
import { humanoidPoseState } from './ui-models.js';

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
  const shirt = new THREE.MeshLambertMaterial({ color });
  const shirtDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.5) });
  const skinTone = new THREE.MeshLambertMaterial({ color: 0xe8c39a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x293344 });
  const shoe = new THREE.MeshLambertMaterial({ color: 0x15171d });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x33333a });

  const group = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.78;
  group.add(torso);
  const parts = [];

  const add = (geometry, mat, x, y, z, partName, parent = group) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (partName) {
      m.userData = userDataFor(partName);
      parts.push(m);
    }
    parent.add(m);
    return m;
  };

  const limb = (radius, height, mat, x, y, z, partName, parent) => add(
    new THREE.CylinderGeometry(radius * 0.96, radius * 1.08, height, 8), mat, x, y, z, partName, parent,
  );
  const box = (w, h, d, mat, x, y, z, partName, parent) => add(
    new THREE.BoxGeometry(w, h, d), mat, x, y, z, partName, parent,
  );
  const sphere = (radius, mat, x, y, z, partName, parent) => add(
    new THREE.SphereGeometry(radius, 12, 8), mat, x, y, z, partName, parent,
  );

  const legL = new THREE.Group(); legL.position.set(-0.16, 0.93, 0);
  const legR = new THREE.Group(); legR.position.set(0.16, 0.93, 0);
  group.add(legL, legR);
  limb(0.13, 0.42, pants, 0, -0.22, 0, 'leg', legL);
  limb(0.13, 0.42, pants, 0, -0.22, 0, 'leg', legR);
  const calfL = new THREE.Group(); calfL.position.set(0, -0.46, 0);
  const calfR = new THREE.Group(); calfR.position.set(0, -0.46, 0);
  legL.add(calfL); legR.add(calfR);
  limb(0.11, 0.4, pants, 0, -0.2, 0, 'leg', calfL);
  limb(0.11, 0.4, pants, 0, -0.2, 0, 'leg', calfR);
  box(0.22, 0.12, 0.38, shoe, 0, -0.41, -0.07, 'leg', calfL);
  box(0.22, 0.12, 0.38, shoe, 0, -0.41, -0.07, 'leg', calfR);

  const body = new THREE.Group();
  torso.add(body);
  add(new THREE.CylinderGeometry(0.28, 0.34, 0.58, 8), shirt, 0, 0.32, 0, 'body', body);
  box(0.5, 0.12, 0.36, shirtDark, 0, 0.12, 0, null, body);
  box(0.56, 0.06, 0.38, shirtDark, 0, 0.55, 0, null, body);

  const head = sphere(0.24, skinTone, 0, 0.86, 0, 'head', torso);
  sphere(0.11, skinTone, -0.21, 0.86, -0.01, null, torso);
  sphere(0.11, skinTone, 0.21, 0.86, -0.01, null, torso);
  const visor = box(0.16, 0.06, 0.035, new THREE.MeshLambertMaterial({ color: 0x18212b }), 0, 0.9, -0.22, null, torso);
  visor.castShadow = false;

  const armL = new THREE.Group(); armL.position.set(-0.39, 0.5, 0);
  const armR = new THREE.Group(); armR.position.set(0.39, 0.5, 0);
  torso.add(armL, armR);
  sphere(0.13, shirt, 0, 0.02, 0, 'arm', armL);
  sphere(0.13, shirt, 0, 0.02, 0, 'arm', armR);
  limb(0.09, 0.32, shirt, 0, -0.2, 0, 'arm', armL);
  limb(0.09, 0.32, shirt, 0, -0.2, 0, 'arm', armR);
  const handL = new THREE.Group(); handL.position.set(0, -0.43, 0);
  const handR = new THREE.Group(); handR.position.set(0, -0.43, 0);
  armL.add(handL); armR.add(handR);
  sphere(0.08, skinTone, 0, -0.11, 0, 'arm', handL);
  sphere(0.08, skinTone, 0, -0.11, 0, 'arm', handR);

  const gun = new THREE.Group();
  gun.position.set(0, -0.08, -0.16);
  gun.rotation.x = Math.PI / 2;
  box(0.065, 0.075, 0.36, gunMat, 0, 0.02, -0.12, null, gun);
  handR.add(gun);

  const hatMesh = makeHat(hat);
  if (hatMesh) {
    hatMesh.position.set(0, 0.98, 0);
    torso.add(hatMesh);
  }

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, hatMesh ? 1.55 : 1.35, 0);
  torso.add(nameSprite);

  return { group, parts, torso, body, legL, legR, armL, armR, head, gun, nameSprite };
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
  rig.torso.position.y = 0.78 + pose.bodyY;
  rig.torso.rotation.z = Math.sin(walkTimeRef.t * 0.5) * Math.min(1, Math.max(0, speed) / 5.2) * 0.025;
}
