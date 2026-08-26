import * as THREE from 'three';
import {
  animateHumanoid,
  animateHumanoidDeath,
  disposeHumanoid,
  makeHumanoid,
  resetHumanoidPose,
  setHumanoidFacingConvention,
  triggerHumanoidHit,
  triggerHumanoidShot,
} from './humanoid.js';
import { stablePoseSide } from './character-motion.js';

// ---------------------------------------------------------------------------
// Entidades remotas (otros jugadores y bots del servidor): marionetas que
// interpolan hacia el último snapshot recibido. Sus mallas son golpeables
// por el raycast de las armas (userData.net = {kind, id}).
// ---------------------------------------------------------------------------

export function sanitizeRemoteHealth(value, fallback = 100) {
  const health = Number(value);
  return Number.isFinite(health) ? Math.min(10000, Math.max(0, health)) : fallback;
}

export function normalizeRemoteYaw(value, fallback = 0) {
  const yaw = Number(value);
  return Number.isFinite(yaw) ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) : fallback;
}

class RemoteEnt {
  constructor(scene, kind, id, name, color, hat, badge) {
    this.scene = scene;
    this.kind = kind; // 'pl' | 'bot'
    this.id = id;
    this.name = name;
    this.color = color;
    this.hat = hat || null;
    this.badge = badge || '';
    this.alive = true;
    this.deathAnim = 0;
    this.deathSide = stablePoseSide(`${kind}:${id}`);
    this.speed = 0;
    this.aimPitch = 0;
    this.aiming = kind === 'pl';
    this.health = 100;
    this.hasState = false;
    this.hasPosition = false;
    this.hitSerial = 0;
    this.walkRef = { t: Math.random() * 10 };
    this.target = new THREE.Vector3();
    this.targetYaw = 0;

    const displayName = (badge ? badge + ' ' : '') + name;
    this.rig = makeHumanoid(color, displayName, (part) => ({
      net: { kind, id },
      part,
      react: (intensity = 1) => this.reactToHit(intensity),
    }), undefined, hat);
    setHumanoidFacingConvention(this.rig, kind);
    scene.add(this.rig.group);
  }

  applyState(p, ry, rx, s, al, hp = this.health) {
    if (Array.isArray(p) && p.length === 3 && p.every((value) => Number.isFinite(value) && Math.abs(value) <= 10000)) {
      this.target.set(p[0], p[1], p[2]);
      if (!this.hasPosition) {
        this.rig.group.position.copy(this.target);
        this.hasPosition = true;
      }
    }
    this.targetYaw = normalizeRemoteYaw(ry, this.targetYaw);
    this.aimPitch = Number.isFinite(rx) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rx)) : 0;
    this.speed = Number.isFinite(s) ? Math.max(0, Math.min(20, s)) : 0;
    // El protocolo no envia un flag ADS para jugadores. A velocidad de sprint
    // bajamos el arma; al caminar o detenerse conserva la postura preparada.
    if (this.kind === 'pl') this.aiming = this.speed < 6.1;
    const nextHealth = sanitizeRemoteHealth(hp, this.health);
    if (this.hasState && al && this.alive && nextHealth < this.health) {
      this.hitSerial++;
      this.reactToHit(Math.min(1, (this.health - nextHealth) / 45));
    }
    this.health = nextHealth;
    this.hasState = true;
    if (!al && this.alive) {
      this.alive = false;
      this.deathAnim = 0.001; // arranca la animación de muerte
      this.deathSide = this.rig.motion?.hitSide || stablePoseSide(`${this.kind}:${this.id}`);
    } else if (al && !this.alive) {
      this.alive = true;
      this.deathAnim = 0;
      this.rig.group.position.copy(this.target); // reaparecer: teletransporte
      resetHumanoidPose(this.rig);
      this.rig.group.visible = true;
    }
  }

  reactToHit(intensity = 1) {
    const fallbackSide = (this.hitSerial + (this.deathSide > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1;
    triggerHumanoidHit(this.rig, intensity, fallbackSide);
  }

  triggerShot(intensity = 0.8) {
    if (this.alive) triggerHumanoidShot(this.rig, intensity);
  }

  update(dt) {
    const g = this.rig.group;
    if (!this.alive) {
      if (this.deathAnim > 0 && this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3.5);
        animateHumanoidDeath(this.rig, this.deathAnim, this.deathSide);
      } else if (this.deathAnim >= 1) {
        animateHumanoidDeath(this.rig, 1, this.deathSide);
        g.position.y -= dt * 1.5;
        if (g.position.y < this.target.y - 2.5) g.visible = false;
      }
      return;
    }
    // interpolación suave; si está muy lejos (teleport/lag), saltar directo
    if (g.position.distanceToSquared(this.target) > 64) {
      g.position.copy(this.target);
    } else {
      g.position.lerp(this.target, Math.min(1, dt * 12));
    }
    const dy = normalizeRemoteYaw(this.targetYaw - g.rotation.y, 0);
    g.rotation.y += dy * Math.min(1, dt * 12);

    animateHumanoid(this.rig, dt, this.speed, this.walkRef, this.aiming, this.aimPitch);
  }

  muzzlePos(target = new THREE.Vector3()) {
    return target.set(
      this.rig.group.position.x,
      this.rig.group.position.y + 1.3,
      this.rig.group.position.z,
    );
  }

  dispose() {
    this.scene.remove(this.rig.group);
    disposeHumanoid(this.rig);
  }
}

export class Remotes {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id -> RemoteEnt
    this.bots = new Map();
  }

  applySnapshot(snap, myId) {
    const seenPl = new Set(), seenBot = new Set();
    for (const p of snap.pl) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
      if (p.id === myId) continue;
      seenPl.add(p.id);
      let ent = this.players.get(p.id);
      const hat = p.h || null, badge = p.b || '';
      if (ent && (ent.color !== p.c || ent.hat !== hat || ent.badge !== badge)) {
        ent.dispose(); // cambio de equipo/color/sombrero/insignia → recrear
        this.players.delete(p.id);
        ent = null;
      }
      if (!ent) {
        ent = new RemoteEnt(this.scene, 'pl', p.id, p.n, p.c, hat, badge);
        this.players.set(p.id, ent);
      }
      ent.applyState(p.p, p.ry, p.rx, p.s, !!p.al, p.hp);
    }
    for (const b of snap.bots) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      seenBot.add(b.id);
      let ent = this.bots.get(b.id);
      if (ent && ent.color !== b.c) {
        ent.dispose();
        this.bots.delete(b.id);
        ent = null;
      }
      if (!ent) {
        ent = new RemoteEnt(this.scene, 'bot', b.id, b.n, b.c);
        this.bots.set(b.id, ent);
      }
      ent.aiming = !!b.en;
      ent.applyState(b.p, b.ry, 0, b.s, !!b.al, b.hp);
    }
    for (const [id, ent] of this.players) {
      if (!seenPl.has(id)) { ent.dispose(); this.players.delete(id); }
    }
    for (const [id, ent] of this.bots) {
      if (!seenBot.has(id)) { ent.dispose(); this.bots.delete(id); }
    }
  }

  removeBot(id) {
    const ent = this.bots.get(id);
    if (ent) { ent.dispose(); this.bots.delete(id); }
  }

  update(dt) {
    for (const ent of this.players.values()) ent.update(dt);
    for (const ent of this.bots.values()) ent.update(dt);
  }

  getHitMeshes() {
    const list = [];
    for (const ent of this.players.values()) if (ent.alive) list.push(...ent.rig.parts);
    for (const ent of this.bots.values()) if (ent.alive) list.push(...ent.rig.parts);
    return list;
  }

  find(kind, id) {
    return kind === 'pl' ? this.players.get(id) : this.bots.get(id);
  }

  triggerShot(kind, id, intensity = 0.8) {
    this.find(kind, id)?.triggerShot(intensity);
  }

  triggerHit(kind, id, intensity = 1) {
    this.find(kind, id)?.reactToHit(intensity);
  }

  dispose() {
    for (const ent of this.players.values()) ent.dispose();
    for (const ent of this.bots.values()) ent.dispose();
    this.players.clear();
    this.bots.clear();
  }
}
