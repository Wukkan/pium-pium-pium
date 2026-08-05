import * as THREE from 'three';

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

  if (kind === 'pistol') {
    part(dark, 0.075, 0.11, 0.3, 0, 0.02, -0.08);     // corredera
    part(mid, 0.07, 0.14, 0.11, 0, -0.09, 0.05);      // empuñadura
    part(dark, 0.045, 0.045, 0.12, 0, 0.03, -0.26);   // cañón
    part(accent, 0.02, 0.03, 0.04, 0, 0.09, -0.2);    // mira
  } else if (kind === 'revolver') {
    part(mid, 0.06, 0.09, 0.38, 0, 0.03, -0.15);      // cañón largo
    part(dark, 0.09, 0.1, 0.12, 0, 0, 0.02);          // tambor
    part(wood, 0.07, 0.14, 0.1, 0, -0.1, 0.09);       // empuñadura
    part(accent, 0.02, 0.04, 0.04, 0, 0.1, -0.3);     // mira
  } else if (kind === 'launcher') {
    part(dark, 0.13, 0.13, 0.55, 0, 0, -0.15);        // tubo gordo
    part(accent, 0.15, 0.15, 0.1, 0, 0, -0.45);       // boca
    part(mid, 0.08, 0.16, 0.12, 0, -0.12, 0.1);       // empuñadura
    part(wood, 0.08, 0.1, 0.18, 0, -0.02, 0.25);      // culata
  } else if (kind === 'shotgun') {
    part(dark, 0.07, 0.09, 0.7, 0, 0.01, -0.25);      // cañón largo
    part(wood, 0.075, 0.09, 0.22, 0, -0.06, -0.32);   // bomba (pump)
    part(wood, 0.08, 0.12, 0.3, 0, -0.03, 0.25);      // culata
    part(mid, 0.085, 0.12, 0.2, 0, 0, 0.02);          // recámara
    part(accent, 0.03, 0.03, 0.06, 0, 0.07, -0.55);   // mira
  } else if (kind === 'ar') {
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
  const flashZ = { sniper: -1.0, ar: -0.8, shotgun: -0.7, pistol: -0.35, revolver: -0.4, launcher: -0.55 };
  flash.position.set(0, 0.01, flashZ[kind] !== undefined ? flashZ[kind] : -0.5);
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
    this.defs = WEAPON_DEFS;
    this.slots = [...WEAPON_ORDER];
    this.state = {};
    for (const key of this.slots) {
      this.state[key] = { ammo: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
    }
    this.current = 'pistol';

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
    this.inputBlocked = false; // true mientras un overlay usa las teclas numéricas
    addEventListener('keydown', (e) => {
      if (!document.pointerLockElement || this.inputBlocked) return;
      if (e.code === 'KeyR') this.reload();
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
      if (idx >= 0 && idx < this.slots.length) this.switchTo(this.slots[idx]);
    });
  }

  get def() { return WEAPON_DEFS[this.current]; }
  get ammo() { return this.state[this.current]; }

  // añade dinero (por bajas); actualiza el HUD
  addMoney(n) {
    this.money += n;
    this.hud.updateMoney(this.money);
    this.hud.updateSlots(this);
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
    this.switchTo(key);
  }

  switchTo(key) {
    if (this.forcedKey) return; // en búsqueda del arma no se cambia a mano
    if (key === this.current || this.player.dead) return;
    if (!this.owned[key]) { this.tryBuy(key); return; }
    this._equip(key);
  }

  _equip(key) {
    if (key === this.current) return;
    this.models[this.current].visible = false;
    this.current = key;
    this.models[key].visible = true;
    this.reloading = false;
    this.kickPos = 0.12; // pequeña animación de sacar el arma
    this.hud.updateAmmo(this);
    this.hud.updateSlots(this);
    this.hud.setReloading(false);
  }

  // búsqueda del arma: el servidor impone qué arma llevas
  setForced(key) {
    this.forcedKey = key || null;
    if (key) {
      this.state[key].ammo = WEAPON_DEFS[key].mag;
      this.state[key].reserve = WEAPON_DEFS[key].reserve;
      this._equip(key);
      this.hud.updateAmmo(this);
    }
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

    const muzzle = new THREE.Vector3();
    this.models[this.current].userData.flash.getWorldPosition(muzzle);

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
          this.effects.impact(hit.point, 0xc09858, 3);
          if (this.onCrateHit) this.onCrateHit(data.crate, def.damage, def.kind);
        } else {
          this.effects.impact(hit.point, 0xd8d0b8, pellets > 1 ? 2 : 5);
        }
      }
      this.effects.tracer(muzzle, end);
      if (!firstEnd) firstEnd = end;
    }

    for (const entry of acc.values()) {
      this.onTargetHit(entry.data, entry.dmg, entry.head, entry.point);
    }
    if (this.onShot) this.onShot(muzzle, firstEnd, def.kind);

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
      this.hud.setReloadProgress(prog);
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
