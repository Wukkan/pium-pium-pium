import * as THREE from 'three';
import { QuarksEffects } from './quarks-effects.js';

// ---------------------------------------------------------------------------
// Efectos visuales: trazadoras de balas, partículas de impacto y números
// de daño flotantes (sprites con canvas).
// ---------------------------------------------------------------------------

const _tmp = new THREE.Vector3();

export class Effects {
  constructor(scene, backend = {}) {
    this.scene = scene;
    this.items = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    this.shockwaveGeo = new THREE.SphereGeometry(0.14, 20, 12);
    this.smokeGeo = new THREE.SphereGeometry(0.22, 8, 8);
    this.quarks = null;
    if (backend.quarks && backend.THREE) {
      try {
        this.quarks = new QuarksEffects(scene, backend.THREE, backend.quarks);
      } catch (error) {
        console.warn('three.quarks no pudo inicializarse; se usan efectos clÃ¡sicos.', error);
      }
    }
  }

  update(dt) {
    if (this.quarks) this.quarks.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.dispose) it.dispose();
        this.items.splice(i, 1);
      } else {
        it.tick(dt);
      }
    }
  }

  muzzle(pos, kind = 'pistol') {
    if (this.quarks) this.quarks.muzzle(pos, kind);
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
    this.items.push({
      obj: mesh, life: 0.07,
      tick() { material.opacity = Math.max(0, this.life / 0.07) * 0.85; },
      dispose() { material.dispose(); },
    });
  }

  impact(pos, color = 0xd8d0b8, count = 5) {
    if (this.quarks) {
      this.quarks.impact(pos, color, count);
      return;
    }
    const material = new THREE.MeshBasicMaterial({ color });
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, material);
      m.position.copy(pos);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 5,
      );
      parts.push({ m, v });
      group.add(m);
    }
    this.scene.add(group);
    this.items.push({
      obj: group, life: 0.45,
      tick(dt) {
        for (const p of parts) {
          p.v.y -= 14 * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += dt * 8;
          p.m.rotation.z += dt * 6;
        }
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
    wave.userData.effect = 'shockwave';
    wave.position.copy(pos);
    this.scene.add(wave);
    const waveTotal = 0.65;
    this.items.push({
      obj: wave, life: waveTotal,
      tick() {
        const p = 1 - this.life / waveTotal;
        wave.scale.setScalar(0.7 + p * 15);
        waveMat.opacity = 0.95 * (1 - p) ** 1.35;
      },
      dispose() { waveMat.dispose(); },
    });
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
    this.items.push({
      obj: sphere, life: total,
      tick() {
        const p = 1 - this.life / total;
        sphere.scale.setScalar(0.5 + p * 5.5);
        mat.opacity = 0.95 * (1 - p);
      },
      dispose() { mat.dispose(); sphere.geometry.dispose(); },
    });

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
    this.items.push({
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
    });

    // metralla y chispas
    this.impact(pos, 0x555049, 14);
    this.impact(pos, 0xffb347, 10);
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
    this.items.push({
      obj: sprite, life: total,
      tick(dt) {
        sprite.position.y += dt * 1.4;
        material.opacity = Math.min(1, (this.life / total) * 2);
      },
      dispose() { material.dispose(); texture.dispose(); },
    });
  }
}
