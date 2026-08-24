import * as THREE from 'three';
import { QuarksEffects } from './quarks-effects.js';

// ---------------------------------------------------------------------------
// Efectos visuales: trazadoras de balas, partículas de impacto y números
// de daño flotantes (sprites con canvas).
// ---------------------------------------------------------------------------

const _tmp = new THREE.Vector3();
const EFFECT_QUALITY = Object.freeze({
  low: Object.freeze({ maxItems: 36, particleScale: 0.5, casingEvery: 4, muzzleSmoke: false }),
  balanced: Object.freeze({ maxItems: 60, particleScale: 0.78, casingEvery: 2, muzzleSmoke: true }),
  high: Object.freeze({ maxItems: 84, particleScale: 1, casingEvery: 1, muzzleSmoke: true }),
});

const IMPACT_COLORS = Object.freeze({
  concrete: 0xd8d0b8,
  metal: 0xffc45e,
  wood: 0xc09858,
  flesh: 0xcc4444,
});

export function classifyImpactSurface(color = IMPACT_COLORS.concrete, requested = 'auto') {
  if (requested && requested !== 'auto') {
    return ['concrete', 'metal', 'wood', 'flesh'].includes(requested) ? requested : 'concrete';
  }
  const value = Number(color) >>> 0;
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  if (red > green * 1.45 && red > blue * 1.35) return 'flesh';
  if (Math.abs(value - IMPACT_COLORS.wood) < 0x182818) return 'wood';
  if (red < 120 && green < 120 && blue < 120) return 'metal';
  return 'concrete';
}

export function effectBudgetCount(requested, max = 24) {
  return Math.min(max, Math.max(1, Math.round(Number(requested) || 1)));
}

export function normalizeEffectQuality(value) {
  return Object.hasOwn(EFFECT_QUALITY, value) ? value : 'balanced';
}

export class Effects {
  constructor(scene, backend = {}) {
    this.scene = scene;
    this.items = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    this.shockwaveGeo = new THREE.SphereGeometry(0.14, 20, 12);
    this.smokeGeo = new THREE.SphereGeometry(0.22, 8, 8);
    this.casingGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 7);
    this.casingMaterial = new THREE.MeshStandardMaterial({
      color: 0xc89b3c, metalness: 0.82, roughness: 0.3,
    });
    this.quality = 'balanced';
    this.qualityProfile = EFFECT_QUALITY.balanced;
    this.muzzleCount = 0;
    this.quarks = null;
    if (backend.quarks && backend.THREE) {
      try {
        this.quarks = new QuarksEffects(scene, backend.THREE, backend.quarks);
      } catch (error) {
        console.warn('three.quarks no pudo inicializarse; se usan efectos clásicos.', error);
      }
    }
  }

  update(dt) {
    if (this.quarks) this.quarks.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this._removeItem(i);
      } else {
        it.tick(dt);
      }
    }
  }

  setQuality(value = 'balanced') {
    this.quality = normalizeEffectQuality(value);
    this.qualityProfile = EFFECT_QUALITY[this.quality];
    if (this.quarks?.setQuality) this.quarks.setQuality(this.quality);
    while (this.items.length > this.qualityProfile.maxItems) this._removeItem(0);
  }

  _removeItem(index) {
    const item = this.items[index];
    if (!item) return;
    this.scene.remove(item.obj);
    if (item.dispose) item.dispose();
    this.items.splice(index, 1);
  }

  _addItem(item, priority = 0) {
    item.priority = priority;
    if (this.items.length >= this.qualityProfile.maxItems) {
      let candidate = 0;
      for (let i = 1; i < this.items.length; i++) {
        if ((this.items[i].priority || 0) < (this.items[candidate].priority || 0)) candidate = i;
      }
      if ((this.items[candidate].priority || 0) > priority) {
        this.scene.remove(item.obj);
        if (item.dispose) item.dispose();
        return false;
      }
      this._removeItem(candidate);
    }
    this.items.push(item);
    return true;
  }

  muzzle(pos, kind = 'pistol') {
    this.muzzleCount++;
    if (this.quarks) this.quarks.muzzle(pos, kind);
    else this._classicMuzzle(pos, kind);
    if (this.muzzleCount % this.qualityProfile.casingEvery === 0) this.casing(pos, kind);
  }

  _classicMuzzle(pos, kind) {
    const color = kind === 'launcher' ? 0xff7b35 : kind === 'sniper' ? 0x9bd4ff : 0xffd66b;
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Mesh(this.smokeGeo, material);
    flash.position.copy(pos);
    flash.scale.set(kind === 'shotgun' ? 1.15 : 0.75, 0.52, kind === 'shotgun' ? 1.5 : 1);
    this.scene.add(flash);
    const total = 0.075;
    this._addItem({
      obj: flash, life: total,
      tick() {
        const fade = Math.max(0, this.life / total);
        material.opacity = fade;
        flash.scale.multiplyScalar(1 + 8 * Math.min(0.025, this.life));
      },
      dispose() { material.dispose(); },
    }, 2);

    if (!this.qualityProfile.muzzleSmoke) return;
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x77716c, transparent: true, opacity: 0.24, depthWrite: false,
    });
    const smoke = new THREE.Mesh(this.smokeGeo, smokeMat);
    smoke.position.copy(pos);
    smoke.scale.setScalar(kind === 'shotgun' || kind === 'launcher' ? 0.75 : 0.45);
    this.scene.add(smoke);
    const smokeTotal = 0.42;
    this._addItem({
      obj: smoke, life: smokeTotal,
      tick(dt) {
        const p = 1 - this.life / smokeTotal;
        smoke.position.y += dt * 0.28;
        smoke.scale.setScalar(0.45 + p * 1.1);
        smokeMat.opacity = 0.24 * (1 - p);
      },
      dispose() { smokeMat.dispose(); },
    });
  }

  casing(pos, kind = 'pistol') {
    if (kind === 'launcher') return;
    const casing = new THREE.Mesh(this.casingGeo, this.casingMaterial);
    casing.position.copy(pos);
    casing.position.x += (Math.random() - 0.5) * 0.08;
    casing.position.z += (Math.random() - 0.5) * 0.08;
    casing.scale.setScalar(kind === 'sniper' || kind === 'shotgun' ? 1.25 : 0.9);
    casing.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const velocity = new THREE.Vector3(
      0.7 + Math.random() * 0.75,
      1.1 + Math.random() * 0.8,
      (Math.random() - 0.5) * 1.1,
    );
    this.scene.add(casing);
    const total = 1.65;
    const floor = Math.max(0.035, pos.y - 1.55);
    this._addItem({
      obj: casing, life: total,
      tick(dt) {
        velocity.y -= 8.5 * dt;
        casing.position.addScaledVector(velocity, dt);
        casing.rotation.x += dt * 17;
        casing.rotation.z += dt * 12;
        if (casing.position.y < floor && velocity.y < 0) {
          casing.position.y = floor;
          velocity.y *= -0.32;
          velocity.x *= 0.72;
          velocity.z *= 0.72;
        }
      },
    });
  }

  tracer(from, to, color = 0xffd66b) {
    const dir = _tmp.subVectors(to, from);
    const len = dir.length();
    if (len < 0.5) return;
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, material);
    mesh.scale.set(0.035, 0.035, len);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    this.scene.add(mesh);
    this._addItem({
      obj: mesh, life: 0.07,
      tick() { material.opacity = Math.max(0, this.life / 0.07) * 0.85; },
      dispose() { material.dispose(); },
    }, 1);
  }

  impact(pos, color = 0xd8d0b8, count = 5, requestedSurface = 'auto') {
    const surface = classifyImpactSurface(color, requestedSurface);
    const safeCount = effectBudgetCount(
      Number(count) * this.qualityProfile.particleScale,
      surface === 'metal' ? 16 : 24,
    );
    if (this.quarks) {
      this.quarks.impact(pos, color, safeCount, surface);
      this._impactPuff(pos, surface);
      return;
    }
    const colors = { concrete: color, metal: 0xffc45e, wood: 0xc79352, flesh: 0xb63b37 };
    const material = new THREE.MeshBasicMaterial({
      color: colors[surface], transparent: true, opacity: surface === 'metal' ? 0.95 : 0.82,
      blending: surface === 'metal' ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: surface !== 'metal',
    });
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < safeCount; i++) {
      const m = new THREE.Mesh(this.particleGeo, material);
      m.position.copy(pos);
      if (surface === 'metal') m.scale.set(0.45, 0.45, 2.4);
      else if (surface === 'wood') m.scale.set(0.55, 0.55, 1.8);
      else if (surface === 'flesh') m.scale.setScalar(0.72);
      const energy = surface === 'metal' ? 1.7 : surface === 'wood' ? 1.15 : surface === 'flesh' ? 0.72 : 1;
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 5 * energy,
        (Math.random() * 4 + 1) * energy,
        (Math.random() - 0.5) * 5 * energy,
      );
      parts.push({ m, v });
      group.add(m);
    }
    const puffMat = new THREE.MeshBasicMaterial({
      color: surface === 'flesh' ? 0x7b1f25 : surface === 'wood' ? 0x7b5b38 : 0x77726c,
      transparent: true,
      opacity: surface === 'metal' ? 0.08 : 0.24,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(this.smokeGeo, puffMat);
    puff.position.copy(pos);
    puff.scale.setScalar(surface === 'flesh' ? 0.52 : 0.38);
    group.add(puff);
    this.scene.add(group);
    const total = surface === 'metal' ? 0.38 : 0.48;
    this._addItem({
      obj: group, life: total,
      tick(dt) {
        const p = 1 - this.life / total;
        for (const p of parts) {
          p.v.y -= 14 * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += dt * 8;
          p.m.rotation.z += dt * 6;
        }
        material.opacity = (surface === 'metal' ? 0.95 : 0.82) * (1 - p);
        puff.scale.setScalar((surface === 'flesh' ? 0.52 : 0.38) + p * 0.75);
        puffMat.opacity = (surface === 'metal' ? 0.08 : 0.24) * (1 - p);
      },
      dispose() { material.dispose(); puffMat.dispose(); },
    }, surface === 'metal' ? 1 : 0);
  }

  _impactPuff(pos, surface) {
    if (surface === 'metal') return;
    const material = new THREE.MeshBasicMaterial({
      color: surface === 'flesh' ? 0x7b1f25 : surface === 'wood' ? 0x7b5b38 : 0x77726c,
      transparent: true, opacity: surface === 'flesh' ? 0.2 : 0.16, depthWrite: false,
    });
    const puff = new THREE.Mesh(this.smokeGeo, material);
    puff.position.copy(pos);
    puff.scale.setScalar(surface === 'flesh' ? 0.42 : 0.3);
    this.scene.add(puff);
    const total = surface === 'flesh' ? 0.3 : 0.42;
    this._addItem({
      obj: puff, life: total,
      tick(dt) {
        const p = 1 - this.life / total;
        puff.position.y += dt * (surface === 'flesh' ? 0.12 : 0.28);
        puff.scale.setScalar((surface === 'flesh' ? 0.42 : 0.3) + p * 0.72);
        material.opacity = (surface === 'flesh' ? 0.2 : 0.16) * (1 - p);
      },
      dispose() { material.dispose(); },
    });
  }

  shockwave(pos) {
    const waveMat = new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
    });
    const wave = new THREE.Mesh(this.shockwaveGeo, waveMat);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8b32, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(this.shockwaveGeo, glowMat);
    glow.scale.setScalar(0.9);
    wave.add(glow);
    wave.userData.effect = 'shockwave';
    wave.position.copy(pos);
    this.scene.add(wave);
    const waveTotal = 0.65;
    this._addItem({
      obj: wave, life: waveTotal,
      tick(dt) {
        const p = 1 - this.life / waveTotal;
        wave.scale.setScalar(0.7 + p * 15);
        wave.rotation.y += dt * 0.9;
        wave.rotation.x += dt * 0.45;
        waveMat.opacity = 0.95 * (1 - p) ** 1.35;
        glowMat.opacity = 0.2 * (1 - p) ** 1.15;
      },
      dispose() { waveMat.dispose(); glowMat.dispose(); },
    }, 3);
  }

  explosion(pos) {
    this.shockwave(pos);
    if (this.quarks) {
      this.quarks.explosion(pos);
      return;
    }
    // destello esférico que crece y se desvanece
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), mat);
    sphere.position.copy(pos);
    this.scene.add(sphere);
    const total = 0.35;
    this._addItem({
      obj: sphere, life: total,
      tick() {
        const p = 1 - this.life / total;
        sphere.scale.setScalar(0.5 + p * 5.5);
        mat.opacity = 0.95 * (1 - p);
      },
      dispose() { mat.dispose(); sphere.geometry.dispose(); },
    }, 3);

    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x454241, transparent: true, opacity: 0.42, depthWrite: false,
    });
    const smoke = new THREE.Group();
    const smokeParts = [];
    for (let i = 0; i < 8; i++) {
      const puff = new THREE.Mesh(this.smokeGeo, smokeMat);
      puff.position.set((Math.random() - 0.5) * 0.7, Math.random() * 0.35, (Math.random() - 0.5) * 0.7);
      puff.scale.setScalar(0.65 + Math.random() * 0.85);
      smokeParts.push({ puff, rise: 0.45 + Math.random() * 0.7 });
      smoke.add(puff);
    }
    smoke.position.copy(pos);
    this.scene.add(smoke);
    const smokeTotal = 0.95;
    this._addItem({
      obj: smoke, life: smokeTotal,
      tick(dt) {
        const p = 1 - this.life / smokeTotal;
        for (const part of smokeParts) {
          part.puff.position.y += part.rise * dt;
          part.puff.scale.setScalar((0.65 + p * 1.5) * (0.7 + part.rise * 0.35));
        }
        smoke.rotation.y += dt * 0.45;
        smokeMat.opacity = 0.42 * (1 - p);
      },
      dispose() { smokeMat.dispose(); },
    }, 2);

    // metralla y chispas
    this.impact(pos, 0x555049, 14);
    this.impact(pos, 0xffb347, 10, 'metal');
  }

  // número de daño flotante (amarillo normal, rojo si es headshot)
  trail(from, to, color = 0xffd66b) {
    if (this.quarks) this.quarks.trail(from, to, color);
  }

  popup(pos, text, isCrit = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = `italic 900 ${isCrit ? 58 : 48}px 'Arial Black', Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 96, 48);
    ctx.fillStyle = isCrit ? '#ff5040' : '#ffd24d';
    ctx.fillText(text, 96, 48);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    const s = isCrit ? 1.5 : 1.15;
    sprite.scale.set(s * 2, s, 1);
    sprite.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5,
    ));
    this.scene.add(sprite);
    const total = 0.7;
    const baseScale = sprite.scale.clone();
    this._addItem({
      obj: sprite, life: total,
      tick(dt) {
        const p = 1 - this.life / total;
        sprite.position.y += dt * 1.4;
        material.opacity = Math.min(1, (this.life / total) * 2);
        const pop = 1 + Math.sin(Math.min(1, p * 4) * Math.PI) * (isCrit ? 0.24 : 0.14);
        sprite.scale.copy(baseScale).multiplyScalar(pop);
      },
      dispose() { material.dispose(); texture.dispose(); },
    }, 2);
  }
}
