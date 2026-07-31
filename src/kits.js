import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Kits de vida: caen donde muere alguien y curan +25 al recogerlos.
// Online: el servidor decide (lista en cada snapshot). Offline: lógica local.
// ---------------------------------------------------------------------------

const PICKUP_DIST_SQ = 1.2 * 1.2;
const LIFETIME = 30;

function buildKitMesh() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd83a2e });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.26, 0.45), white);
  base.castShadow = true;
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.11), red);
  c1.position.y = 0.14;
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.3), red);
  c2.position.y = 0.14;
  group.add(base, c1, c2);
  return group;
}

class Kit {
  constructor(scene, id, pos) {
    this.id = id;
    this.baseY = pos.y + 0.35;
    this.mesh = buildKitMesh();
    this.mesh.position.set(pos.x, this.baseY, pos.z);
    this.expireAt = performance.now() / 1000 + LIFETIME; // solo se usa offline
    scene.add(this.mesh);
  }
}

export class KitManager {
  constructor(scene) {
    this.scene = scene;
    this.kits = new Map(); // id -> Kit
    this.time = 0;
    this.serial = 0;
  }

  // --- online: sincronizar con la lista del snapshot ---
  sync(list) {
    const seen = new Set();
    for (const k of list) {
      seen.add(k.id);
      if (!this.kits.has(k.id)) {
        this.kits.set(k.id, new Kit(this.scene, k.id, { x: k.p[0], y: k.p[1], z: k.p[2] }));
      }
    }
    for (const [id, kit] of this.kits) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  // --- offline ---
  spawnLocal(pos) {
    const id = 'lk' + this.serial++;
    this.kits.set(id, new Kit(this.scene, id, pos));
  }

  // recogida y caducidad en modo local. onHealPlayer se llama si cura al jugador.
  offlineUpdate(player, bots, onHealPlayer) {
    const now = performance.now() / 1000;
    for (const [id, kit] of this.kits) {
      if (now > kit.expireAt) { this.remove(id); continue; }
      const kp = kit.mesh.position;

      if (!player.dead && player.health < player.maxHealth) {
        const dx = player.pos.x - kp.x, dy = player.pos.y - (kp.y - 0.35), dz = player.pos.z - kp.z;
        if (dx * dx + dz * dz < PICKUP_DIST_SQ && Math.abs(dy) < 1.6) {
          player.health = Math.min(player.maxHealth, player.health + 25);
          onHealPlayer();
          this.remove(id);
          continue;
        }
      }
      if (bots) {
        for (const b of bots.bots) {
          if (b.dead || b.health >= 100) continue;
          const dx = b.pos.x - kp.x, dz = b.pos.z - kp.z;
          if (dx * dx + dz * dz < PICKUP_DIST_SQ && Math.abs(b.pos.y - (kp.y - 0.35)) < 1.6) {
            b.health = Math.min(100, b.health + 25);
            this.remove(id);
            break;
          }
        }
      }
    }
  }

  remove(id) {
    const kit = this.kits.get(id);
    if (kit) {
      this.scene.remove(kit.mesh);
      this.kits.delete(id);
    }
  }

  // giro y flotación
  update(dt) {
    this.time += dt;
    for (const kit of this.kits.values()) {
      kit.mesh.rotation.y = this.time * 1.5;
      kit.mesh.position.y = kit.baseY + Math.sin(this.time * 2.5 + kit.baseY) * 0.08;
    }
  }
}
