import * as THREE from 'three';
import { roundedBoxGeometry } from './rounded-geometry.js';

// ---------------------------------------------------------------------------
// Loot: kits de vida y cajas de munición caen donde muere alguien.
// Online: el servidor decide (lista en cada snapshot). Offline: lógica local.
// ---------------------------------------------------------------------------

const PICKUP_DIST_SQ = 1.2 * 1.2;
const LIFETIME = 30;

// Un mismo pickup puede reutilizar material o textura en varias mallas (la
// cruz roja, por ejemplo). Los Sets garantizan un unico dispose por recurso.
export function disposePickupMesh(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((object) => {
    if (object.geometry?.dispose) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material?.dispose) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.dispose) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}

function buildKitMesh() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd83a2e });
  const base = new THREE.Mesh(
    roundedBoxGeometry(0.45, 0.26, 0.45, { ratio: 0.22, maxRadius: 0.065 }),
    white,
  );
  base.castShadow = true;
  const c1 = new THREE.Mesh(
    roundedBoxGeometry(0.3, 0.08, 0.11, { ratio: 0.32, maxRadius: 0.026 }),
    red,
  );
  c1.position.y = 0.14;
  const c2 = new THREE.Mesh(
    roundedBoxGeometry(0.11, 0.08, 0.3, { ratio: 0.32, maxRadius: 0.026 }),
    red,
  );
  c2.position.y = 0.14;
  group.add(base, c1, c2);
  return group;
}

function buildAmmoMesh() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    roundedBoxGeometry(0.5, 0.3, 0.42, { ratio: 0.18, maxRadius: 0.065 }),
    new THREE.MeshLambertMaterial({ color: 0x3b4d2f }),
  );
  const lid = new THREE.Mesh(
    roundedBoxGeometry(0.42, 0.07, 0.34, { ratio: 0.32, maxRadius: 0.024 }),
    new THREE.MeshLambertMaterial({ color: 0xb58b38 }),
  );
  lid.position.y = 0.18;
  const stripe = new THREE.Mesh(
    roundedBoxGeometry(0.08, 0.08, 0.36, { ratio: 0.34, maxRadius: 0.027 }),
    new THREE.MeshLambertMaterial({ color: 0xe5c15a }),
  );
  stripe.position.y = 0.22;
  group.add(base, lid, stripe);
  return group;
}

class Kit {
  constructor(scene, id, pos, kind = 'health', amount = 25) {
    this.id = id;
    this.kind = kind;
    this.amount = amount;
    this.baseY = pos.y + 0.35;
    this.mesh = kind === 'ammo' ? buildAmmoMesh() : buildKitMesh();
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
        this.kits.set(k.id, new Kit(
          this.scene,
          k.id,
          { x: k.p[0], y: k.p[1], z: k.p[2] },
          k.k || 'health',
          k.a || (k.k === 'ammo' ? 20 : 25),
        ));
      }
    }
    for (const [id, kit] of this.kits) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  // --- offline ---
  spawnLocal(pos, kind = 'health', amount = kind === 'ammo' ? 20 : 25) {
    const id = 'lk' + this.serial++;
    this.kits.set(id, new Kit(this.scene, id, pos, kind, amount));
  }

  spawnAmmoLocal(pos) { this.spawnLocal(pos, 'ammo', 20); }

  // recogida y caducidad en modo local. onHealPlayer se llama si cura al jugador.
  offlineUpdate(player, bots, onHealPlayer, onAmmoPlayer) {
    const now = performance.now() / 1000;
    for (const [id, kit] of this.kits) {
      if (now > kit.expireAt) { this.remove(id); continue; }
      const kp = kit.mesh.position;

      if (!player.dead && kit.kind === 'health' && player.health < player.maxHealth) {
        const dx = player.pos.x - kp.x, dy = player.pos.y - (kp.y - 0.35), dz = player.pos.z - kp.z;
        if (dx * dx + dz * dz < PICKUP_DIST_SQ && Math.abs(dy) < 1.6) {
          player.health = Math.min(player.maxHealth, player.health + kit.amount);
          onHealPlayer();
          this.remove(id);
          continue;
        }
      }
      if (!player.dead && kit.kind === 'ammo') {
        const dx = player.pos.x - kp.x, dy = player.pos.y - (kp.y - 0.35), dz = player.pos.z - kp.z;
        if (dx * dx + dz * dz < PICKUP_DIST_SQ && Math.abs(dy) < 1.6) {
          if (onAmmoPlayer) onAmmoPlayer(kit.amount);
          this.remove(id);
          continue;
        }
      }
      if (kit.kind !== 'health') continue;
      if (bots) {
        for (const b of bots.bots) {
          if (b.dead || b.health >= 100) continue;
          const dx = b.pos.x - kp.x, dz = b.pos.z - kp.z;
          if (dx * dx + dz * dz < PICKUP_DIST_SQ && Math.abs(b.pos.y - (kp.y - 0.35)) < 1.6) {
            b.health = Math.min(100, b.health + kit.amount);
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
      disposePickupMesh(kit.mesh);
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
