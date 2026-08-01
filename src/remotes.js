import * as THREE from 'three';
import { makeHumanoid, animateHumanoid } from './humanoid.js';

// ---------------------------------------------------------------------------
// Entidades remotas (otros jugadores y bots del servidor): marionetas que
// interpolan hacia el último snapshot recibido. Sus mallas son golpeables
// por el raycast de las armas (userData.net = {kind, id}).
// ---------------------------------------------------------------------------

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
    this.speed = 0;
    this.aimPitch = 0;
    this.aiming = kind === 'pl';
    this.walkRef = { t: Math.random() * 10 };
    this.target = new THREE.Vector3();
    this.targetYaw = 0;

    const displayName = (badge ? badge + ' ' : '') + name;
    this.rig = makeHumanoid(color, displayName, (part) => ({ net: { kind, id }, part }), undefined, hat);
    scene.add(this.rig.group);
  }

  applyState(p, ry, rx, s, al) {
    this.target.set(p[0], p[1], p[2]);
    this.targetYaw = ry;
    this.aimPitch = rx || 0;
    this.speed = s;
    if (!al && this.alive) {
      this.alive = false;
      this.deathAnim = 0.001; // arranca la animación de muerte
    } else if (al && !this.alive) {
      this.alive = true;
      this.deathAnim = 0;
      this.rig.group.position.copy(this.target); // reaparecer: teletransporte
      this.rig.group.rotation.x = 0;
      this.rig.group.visible = true;
    }
  }

  update(dt) {
    const g = this.rig.group;
    if (!this.alive) {
      if (this.deathAnim > 0 && this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3.5);
        g.rotation.x = -this.deathAnim * Math.PI / 2;
      } else if (this.deathAnim >= 1) {
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
    let dy = this.targetYaw - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
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
      ent.applyState(p.p, p.ry, p.rx, p.s, !!p.al);
    }
    for (const b of snap.bots) {
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
      ent.applyState(b.p, b.ry, 0, b.s, !!b.al);
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
}
