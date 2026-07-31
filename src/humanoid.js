import * as THREE from 'three';

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

// Devuelve el rig completo. `userData` se asigna a cada malla golpeable
// para que el raycast de las armas identifique a quién y dónde ha dado.
export function makeHumanoid(color, name, userDataFor, nameColor) {
  const skin = new THREE.MeshLambertMaterial({ color });
  const darker = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const skinTone = new THREE.MeshLambertMaterial({ color: 0xe8c39a });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x33333a });

  const group = new THREE.Group();
  const parts = [];

  const add = (mat, w, h, d, x, y, z, partName, parent = group) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (partName) {
      m.userData = userDataFor(partName);
      parts.push(m);
    }
    parent.add(m);
    return m;
  };

  const legL = new THREE.Group(); legL.position.set(-0.15, 0.8, 0);
  const legR = new THREE.Group(); legR.position.set(0.15, 0.8, 0);
  group.add(legL, legR);
  add(darker, 0.24, 0.8, 0.26, 0, -0.4, 0, 'leg', legL);
  add(darker, 0.24, 0.8, 0.26, 0, -0.4, 0, 'leg', legR);

  add(skin, 0.62, 0.62, 0.34, 0, 1.11, 0, 'body');
  const head = add(skinTone, 0.42, 0.42, 0.42, 0, 1.66, 0, 'head');

  const armL = new THREE.Group(); armL.position.set(-0.4, 1.34, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.34, 0);
  group.add(armL, armR);
  add(skin, 0.18, 0.6, 0.22, 0, -0.26, 0, 'arm', armL);
  add(skin, 0.18, 0.6, 0.22, 0, -0.26, 0, 'arm', armR);

  const gun = new THREE.Group();
  gun.position.set(0, -0.5, -0.1);
  add(gunMat, 0.08, 0.1, 0.55, 0, 0.05, -0.2, null, gun);
  armR.add(gun);

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, 2.15, 0);
  group.add(nameSprite);

  return { group, parts, legL, legR, armL, armR, head, gun, nameSprite };
}

// pose de andar/apuntar, compartida
export function animateHumanoid(rig, dt, speed, walkTimeRef, aiming, aimPitch = 0) {
  walkTimeRef.t += dt * speed * 1.7;
  const swing = Math.sin(walkTimeRef.t) * Math.min(1, speed / 5.2) * 0.55;
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  if (aiming) {
    rig.armR.rotation.x = -Math.PI / 2 - aimPitch * 0.8;
    rig.armL.rotation.x = -Math.PI / 2 - aimPitch * 0.8;
  } else {
    rig.armL.rotation.x = -swing * 0.7;
    rig.armR.rotation.x = swing * 0.7;
  }
}
