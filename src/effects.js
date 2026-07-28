import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Efectos visuales: trazadoras de balas, partículas de impacto y números
// de daño flotantes (sprites con canvas).
// ---------------------------------------------------------------------------

const _tmp = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  }

  update(dt) {
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

  // número de daño flotante (amarillo normal, rojo si es headshot)
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
