import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Granadas: se lanzan con G, rebotan en el escenario y explotan a los 2.2 s.
// La granada del lanzador aplica el daño; las de los demás son visuales
// (llegan por red con la misma física, así explotan en el mismo sitio).
// ---------------------------------------------------------------------------

const FUSE = 2.2;
const RADIUS = 6;
const MAX_DMG = 90;
const GRAVITY = 22;
const PER_LIFE = 2;
export const MAX_REMOTE_GRENADES = 48;

export function validRemoteGrenadePayload(position, velocity) {
  const validVector = (value, maxAbs) => Array.isArray(value) && value.length === 3 &&
    value.every((component) => Number.isFinite(component) && Math.abs(component) <= maxAbs);
  return validVector(position, 10000) && validVector(velocity, 80);
}

function disposeGrenadeMesh(mesh) {
  mesh.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    for (const material of materials) material.dispose();
  });
}

function buildGrenadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x2c3a2c }),
  );
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.05, 0.05),
    new THREE.MeshLambertMaterial({ color: 0xd83a2e }),
  );
  body.castShadow = true;
  g.add(body, band);
  return g;
}

class Grenade {
  constructor(scene, pos, vel, mine, impact = false) {
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.mine = mine;     // ¿la lancé yo? (solo la mía hace daño)
    this.impact = impact; // del lanzagranadas: explota al tocar algo
    this.fuse = impact ? 4 : FUSE;
    this.mesh = buildGrenadeMesh();
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
  }
}

export class GrenadeManager {
  constructor(scene, colliders, effects, audio) {
    this.scene = scene;
    this.colliders = colliders;
    this.effects = effects;
    this.audio = audio;
    this.grenades = [];
    this.count = PER_LIFE;
    this.onThrow = null;   // (pos, vel) → red
    this.onExplode = null; // (pos) → aplicar daño (solo granadas propias)
    this.onCount = null;   // (n) → HUD
  }

  refill() {
    this.count = PER_LIFE;
    if (this.onCount) this.onCount(this.count);
  }

  // lanzar desde la cámara del jugador
  throwFrom(camera) {
    if (this.count <= 0) return false;
    this.count--;
    if (this.onCount) this.onCount(this.count);
    const pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    pos.addScaledVector(dir, 0.5);
    const vel = dir.multiplyScalar(16);
    vel.y += 4.5;
    this.grenades.push(new Grenade(this.scene, pos, vel, true));
    if (this.onThrow) this.onThrow(pos, vel, false);
    return true;
  }

  // proyectil del lanzagranadas: más rápido y explota al impactar
  launch(camera) {
    const pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    pos.addScaledVector(dir, 0.7);
    const vel = dir.multiplyScalar(28);
    vel.y += 1.5;
    this.grenades.push(new Grenade(this.scene, pos, vel, true, true));
    if (this.onThrow) this.onThrow(pos, vel, true);
  }

  // granada de otro jugador (visual)
  spawnRemote(p, v, impact = false) {
    if (!validRemoteGrenadePayload(p, v)) return false;
    const remoteIndices = this.grenades
      .map((grenade, index) => (!grenade.mine ? index : -1))
      .filter((index) => index >= 0);
    if (remoteIndices.length >= MAX_REMOTE_GRENADES) {
      const [oldest] = this.grenades.splice(remoteIndices[0], 1);
      this.scene.remove(oldest.mesh);
      disposeGrenadeMesh(oldest.mesh);
    }
    this.grenades.push(new Grenade(
      this.scene,
      new THREE.Vector3(p[0], p[1], p[2]),
      new THREE.Vector3(v[0], v[1], v[2]),
      false,
      impact,
    ));
    return true;
  }

  _collides(p) {
    const r = 0.14;
    for (const c of this.colliders) {
      if (p.x + r > c.minX && p.x - r < c.maxX &&
          p.y + r > c.minY && p.y - r < c.maxY &&
          p.z + r > c.minZ && p.z - r < c.maxZ) return true;
    }
    return false;
  }

  update(dt, playerEye) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this._explode(g, playerEye);
        this.grenades.splice(i, 1);
        continue;
      }

      g.vel.y -= GRAVITY * dt;
      // integración por ejes con rebote amortiguado
      let tocado = false;
      for (const axis of ['x', 'y', 'z']) {
        const prev = g.pos[axis];
        g.pos[axis] += g.vel[axis] * dt;
        if (this._collides(g.pos)) {
          tocado = true;
          g.pos[axis] = prev;
          g.vel[axis] *= -0.45;
          // fricción en los otros ejes al rebotar
          for (const other of ['x', 'y', 'z']) {
            if (other !== axis) g.vel[other] *= 0.75;
          }
        }
      }
      if (tocado && g.impact) {
        this._explode(g, playerEye);
        this.grenades.splice(i, 1);
        continue;
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 6;
      g.mesh.rotation.z += dt * 4;
    }
  }

  _explode(g, playerEye) {
    this.scene.remove(g.mesh);
    disposeGrenadeMesh(g.mesh);
    this.effects.explosion(g.pos);
    const dist = playerEye ? g.pos.distanceTo(playerEye) : 99;
    this.audio.boom(Math.max(0.15, Math.min(1, 1 - dist / 55)));
    if (g.mine && this.onExplode) this.onExplode(g.pos);
  }
}

// daño según distancia al centro de la explosión
export function explosionDamage(dist) {
  if (dist > RADIUS) return 0;
  return Math.max(15, Math.round(MAX_DMG * (1 - dist / RADIUS)));
}

export { RADIUS as EXPLOSION_RADIUS };
