import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Armas: definición, modelo en primera persona (cajas), disparo por raycast,
// retroceso, recarga y apuntado (ADS). El francotirador tiene mira telescópica.
// ---------------------------------------------------------------------------

export const WEAPON_DEFS = {
  ar: {
    name: 'RIFLE DE ASALTO', kind: 'ar',
    damage: 24, headMult: 2, rpm: 600, mag: 30, reserve: 120,
    reloadTime: 1.5, spread: 0.014, adsSpread: 0.005, moveSpread: 0.02,
    recoil: 0.014, auto: true, zoom: 1.35, scope: false,
  },
  smg: {
    name: 'SUBFUSIL', kind: 'smg',
    damage: 15, headMult: 2, rpm: 950, mag: 36, reserve: 144,
    reloadTime: 1.25, spread: 0.02, adsSpread: 0.011, moveSpread: 0.022,
    recoil: 0.009, auto: true, zoom: 1.2, scope: false,
  },
  sniper: {
    name: 'FRANCOTIRADOR', kind: 'sniper',
    damage: 105, headMult: 1.5, rpm: 42, mag: 5, reserve: 25,
    reloadTime: 2.2, spread: 0.07, adsSpread: 0.0006, moveSpread: 0.04,
    recoil: 0.06, auto: false, zoom: 3.6, scope: true,
  },
};

const BASE_FOV = 78;

function buildGunModel(kind) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x2e2e34 });
  const mid = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd8a03a });

  const part = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  if (kind === 'ar') {
    part(mid, 0.09, 0.13, 0.62, 0, 0, -0.1);          // cuerpo
    part(dark, 0.055, 0.055, 0.45, 0, 0.01, -0.55);   // cañón
    part(dark, 0.07, 0.16, 0.13, 0, -0.13, 0.02);     // cargador
    part(wood, 0.08, 0.11, 0.22, 0, -0.03, 0.28);     // culata
    part(dark, 0.03, 0.05, 0.14, 0, 0.09, -0.05);     // mira
    part(accent, 0.06, 0.04, 0.1, 0, -0.02, -0.35);   // detalle
  } else if (kind === 'smg') {
    part(mid, 0.09, 0.12, 0.42, 0, 0, -0.05);
    part(dark, 0.05, 0.05, 0.25, 0, 0.01, -0.36);
    part(dark, 0.06, 0.2, 0.1, 0, -0.15, 0.03);
    part(dark, 0.07, 0.09, 0.13, 0, -0.02, 0.2);
    part(accent, 0.095, 0.03, 0.08, 0, 0.07, -0.1);
  } else {
    part(wood, 0.09, 0.13, 0.75, 0, 0, -0.05);
    part(dark, 0.05, 0.05, 0.6, 0, 0.02, -0.68);
    part(dark, 0.06, 0.12, 0.1, 0, -0.12, 0.08);
    part(mid, 0.06, 0.08, 0.28, 0, 0.12, -0.12);      // mira telescópica
    part(dark, 0.07, 0.09, 0.03, 0, 0.12, -0.27);
    part(wood, 0.085, 0.12, 0.2, 0, -0.02, 0.32);
  }

  // destello del cañón
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffe9a0, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthTest: false,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.3, 0.3, 1);
  flash.position.set(0, 0.01, kind === 'sniper' ? -1.0 : kind === 'ar' ? -0.8 : -0.5);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;

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

    // estado por arma (munición persistente al cambiar)
    this.slots = ['ar', 'smg', 'sniper'];
    this.state = {};
    for (const key of this.slots) {
      this.state[key] = { ammo: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
    }
    this.current = 'ar';

    this.triggerDown = false;
    this.ads = false;
    this.lastShot = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.kickPos = 0;
    this.kickRot = 0;
    this.bobTime = 0;

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

    addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return;
      if (e.button === 0) this.triggerDown = true;
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.triggerDown = false;
      if (e.button === 2) this.ads = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (!document.pointerLockElement) return;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'Digit1') this.switchTo('ar');
      if (e.code === 'Digit2') this.switchTo('smg');
      if (e.code === 'Digit3') this.switchTo('sniper');
    });
  }

  get def() { return WEAPON_DEFS[this.current]; }
  get ammo() { return this.state[this.current]; }

  switchTo(key) {
    if (key === this.current || this.player.dead) return;
    this.models[this.current].visible = false;
    this.current = key;
    this.models[key].visible = true;
    this.reloading = false;
    this.kickPos = 0.12; // pequeña animación de sacar el arma
    this.hud.updateAmmo(this);
    this.hud.setReloading(false);
  }

  reload() {
    const st = this.ammo;
    const def = this.def;
    if (this.reloading || st.ammo >= def.mag || st.reserve <= 0 || this.player.dead) return;
    this.reloading = true;
    this.reloadEnd = performance.now() / 1000 + def.reloadTime;
    this.audio.reload();
    this.hud.setReloading(true);
  }

  // munición completa en todas las armas (al reaparecer)
  refill() {
    for (const key of this.slots) {
      this.state[key].ammo = WEAPON_DEFS[key].mag;
      this.state[key].reserve = WEAPON_DEFS[key].reserve;
    }
    this.reloading = false;
    this.hud.updateAmmo(this);
    this.hud.setReloading(false);
  }

  currentSpread() {
    const def = this.def;
    let s = this.ads ? def.adsSpread : def.spread;
    const moveFactor = Math.min(1, this.player.horizontalSpeed() / 8);
    if (!this.ads || def.scope === false) s += def.moveSpread * moveFactor * (this.ads ? 0.35 : 1);
    if (!this.player.onGround) s *= 1.6;
    return s;
  }

  fire() {
    const now = performance.now() / 1000;
    const def = this.def;
    const st = this.ammo;
    if (this.reloading || now - this.lastShot < 60 / def.rpm) return;
    if (st.ammo <= 0) {
      this.lastShot = now;
      this.audio.dry();
      this.reload();
      return;
    }
    this.lastShot = now;
    st.ammo--;

    // dirección con dispersión
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spread = this.currentSpread();
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 300;

    const hits = this.raycaster.intersectObjects(this.getTargets(), false);
    let end = origin.clone().addScaledVector(dir, 300);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point;
      const data = hit.object.userData;
      if (data.bot || data.net) {
        const isHead = data.part === 'head';
        const dmg = Math.round(def.damage * (isHead ? def.headMult : 1));
        this.onTargetHit(data, dmg, isHead, hit.point);
      } else {
        this.effects.impact(hit.point);
      }
    }

    // trazadora desde la boca del cañón
    const muzzle = new THREE.Vector3();
    this.models[this.current].userData.flash.getWorldPosition(muzzle);
    this.effects.tracer(muzzle, end);
    if (this.onShot) this.onShot(muzzle, end, def.kind);

    // destello
    const flash = this.models[this.current].userData.flash;
    flash.visible = true;
    flash.material.rotation = Math.random() * Math.PI;
    setTimeout(() => { flash.visible = false; }, 40);

    // retroceso
    this.player.recoilPitch += def.recoil * (this.ads ? 0.6 : 1);
    this.kickPos = Math.min(0.16, this.kickPos + def.recoil * 6);
    this.kickRot = Math.min(0.5, this.kickRot + def.recoil * 14);

    this.audio.shot(def.kind, 1);
    this.hud.updateAmmo(this);

    if (!def.auto) this.triggerDown = false;
  }

  update(dt, inputEnabled) {
    const now = performance.now() / 1000;
    const def = this.def;
    const st = this.ammo;

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

    if (inputEnabled && this.triggerDown && !this.player.dead) this.fire();

    // FOV según ADS
    const targetFov = (this.ads && !this.player.dead) ? BASE_FOV / def.zoom : BASE_FOV;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();

    // mira telescópica: oculta el modelo y muestra el overlay
    const scoped = this.ads && def.scope && !this.player.dead;
    this.rig.visible = !scoped && !this.player.dead;
    this.hud.setScope(scoped);

    // animación del modelo: bob al andar + retroceso con muelle
    const speed = this.player.horizontalSpeed();
    if (this.player.onGround && speed > 1) this.bobTime += dt * Math.min(speed, 10);
    const bobX = Math.sin(this.bobTime * 1.6) * 0.012 * (this.ads ? 0.2 : 1);
    const bobY = Math.abs(Math.cos(this.bobTime * 1.6)) * 0.014 * (this.ads ? 0.2 : 1);

    this.kickPos *= Math.max(0, 1 - dt * 10);
    this.kickRot *= Math.max(0, 1 - dt * 10);

    // animación de recarga: el arma baja, gira y vuelve a subir
    let reloadTilt = 0;
    if (this.reloading) {
      const prog = Math.min(1, Math.max(0, 1 - (this.reloadEnd - now) / def.reloadTime));
      reloadTilt = Math.sin(prog * Math.PI) * (0.85 + Math.sin(prog * Math.PI * 3) * 0.08);
    }

    // posición ADS: centrar el arma
    const adsT = this.ads && !def.scope ? 1 : 0;
    const baseX = 0.32 * (1 - adsT) + 0.0 * adsT;
    const baseY = -0.3 * (1 - adsT) + -0.245 * adsT;
    const baseZ = -0.55 * (1 - adsT) + -0.42 * adsT;

    this.rig.position.x += (baseX + bobX - this.rig.position.x) * Math.min(1, dt * 14);
    this.rig.position.y += (baseY + bobY - reloadTilt * 0.14 - this.rig.position.y) * Math.min(1, dt * 14);
    this.rig.position.z += (baseZ + this.kickPos - this.rig.position.z) * Math.min(1, dt * 18);
    this.rig.rotation.x = this.kickRot * 0.5 - reloadTilt * 0.65;
    this.rig.rotation.z = reloadTilt * 0.3;

    // separación del punto de mira según dispersión
    this.hud.setCrosshairGap(6 + this.currentSpread() * 900);
  }
}
