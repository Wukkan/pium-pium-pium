import * as THREE from 'three';
import { moveBody } from './shared/physics.js';
import { makeHumanoid, animateHumanoid } from './humanoid.js';
import { BOT_NAMES, BOT_COLORS } from './shared/mapdata.js';

// ---------------------------------------------------------------------------
// Bots LOCALES: solo se usan en modo sin conexión (cuando no hay servidor).
// En modo online los bots corren en el servidor y se ven como marionetas
// (src/remotes.js). La IA de aquí es la misma que la del servidor.
// ---------------------------------------------------------------------------

const BOT_SPEED = 5.2;
const GRAVITY = 24;
const HALF = 0.35, HEIGHT = 1.8;
const ENGAGE_DIST = 42;

class Bot {
  constructor(name, color) {
    this.name = name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.health = 100;
    this.dead = false;
    this.respawnAt = 0;
    this.deathAnim = 0;

    this.state = 'patrol';
    this.waypoint = null;
    this.repathAt = 0;
    this.strafeDir = 1;
    this.strafeChangeAt = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.stuckCheckAt = 0;
    this.lastCheckPos = new THREE.Vector3();
    this.walkRef = { t: 0 };

    this.rig = makeHumanoid(color, name, (part) => ({ bot: this, part }));
    this.group = this.rig.group;
    this.parts = this.rig.parts;
  }

  spawn(point) {
    this.pos.copy(point);
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.dead = false;
    this.deathAnim = 0;
    this.state = 'patrol';
    this.waypoint = null;
    this.group.visible = true;
    this.group.rotation.set(0, 0, 0);
    this.group.position.copy(point);
  }

  eyePos(target = new THREE.Vector3()) {
    return target.set(this.pos.x, this.pos.y + 1.66, this.pos.z);
  }

  takeDamage(amount, attackerPos) {
    if (this.dead) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.deathAnim = 0.001;
      this.respawnAt = performance.now() / 1000 + 3.5;
      return true;
    }
    if (attackerPos) {
      this.waypoint = attackerPos.clone();
      this.repathAt = performance.now() / 1000 + 5;
    }
    return false;
  }

  update(dt, ctx) {
    const now = performance.now() / 1000;

    if (this.dead) {
      if (this.deathAnim > 0 && this.deathAnim < 1) {
        this.deathAnim = Math.min(1, this.deathAnim + dt * 3.5);
        this.group.rotation.x = -this.deathAnim * Math.PI / 2;
      } else if (now > this.respawnAt - 1) {
        this.group.position.y -= dt * 2;
      }
      if (now >= this.respawnAt) {
        const sp = ctx.botSpawns[Math.floor(Math.random() * ctx.botSpawns.length)];
        this.spawn(sp);
      }
      return;
    }

    const player = ctx.player;
    const toPlayer = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toPlayer.length();

    let seesPlayer = false;
    if (!player.dead && dist < ENGAGE_DIST) {
      const from = this.eyePos();
      const to = player.eyePosition(new THREE.Vector3());
      const dir = new THREE.Vector3().subVectors(to, from);
      const d = dir.length();
      dir.normalize();
      ctx.raycaster.set(from, dir);
      ctx.raycaster.far = d - 0.3;
      seesPlayer = ctx.raycaster.intersectObjects(ctx.occluders, false).length === 0;
    }

    this.state = seesPlayer ? 'engage' : (this.state === 'engage' && dist < ENGAGE_DIST ? 'hunt' : 'patrol');

    let moveX = 0, moveZ = 0;

    if (this.state === 'engage') {
      this.targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      if (now > this.strafeChangeAt) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeChangeAt = now + 0.8 + Math.random() * 1.4;
      }
      const fwd = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(this.strafeDir);
      let push = 0;
      if (dist > 26) push = 1;
      else if (dist < 9) push = -1;
      moveX = (side.x + fwd.x * push) * 0.8;
      moveZ = (side.z + fwd.z * push) * 0.8;

      if (this.burstLeft > 0 && now >= this.nextShotAt) {
        this.burstLeft--;
        this.nextShotAt = now + 0.11;
        this.shootAt(player, ctx, dist);
      } else if (this.burstLeft <= 0 && now >= this.nextBurstAt) {
        this.burstLeft = 3 + Math.floor(Math.random() * 4);
        this.nextBurstAt = now + 0.7 + Math.random() * 1.1;
        this.nextShotAt = now + 0.15 + Math.random() * 0.25;
      }
    } else {
      if (this.state === 'hunt') {
        this.waypoint = player.pos.clone();
        if (dist < 4) this.state = 'patrol';
      }
      if (!this.waypoint || now > this.repathAt ||
          this.pos.distanceToSquared(this.waypoint) < 2.5) {
        this.waypoint = ctx.waypoints[Math.floor(Math.random() * ctx.waypoints.length)].clone();
        this.repathAt = now + 6 + Math.random() * 5;
      }
      const dir = new THREE.Vector3().subVectors(this.waypoint, this.pos);
      dir.y = 0;
      if (dir.lengthSq() > 0.5) {
        dir.normalize();
        moveX = dir.x; moveZ = dir.z;
        this.targetYaw = Math.atan2(dir.x, dir.z);
      }
    }

    if (now > this.stuckCheckAt) {
      if ((moveX !== 0 || moveZ !== 0) && this.pos.distanceToSquared(this.lastCheckPos) < 0.09) {
        if (this.onGround) this.vel.y = 8.4;
        this.repathAt = 0;
      }
      this.lastCheckPos.copy(this.pos);
      this.stuckCheckAt = now + 0.6;
    }

    const targetVx = moveX * BOT_SPEED;
    const targetVz = moveZ * BOT_SPEED;
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, dt * 8);
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, dt * 8);
    this.vel.y -= GRAVITY * dt;

    const res = moveBody(this.pos, this.vel, dt, HALF, HALF, HEIGHT, ctx.colliders);
    this.onGround = res.onGround;
    if (this.pos.y < -30) this.pos.set(0, 5, 0);

    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const aimPitch = this.state === 'engage'
      ? Math.atan2(player.pos.y + 1.4 - (this.pos.y + 1.34), Math.hypot(toPlayer.x, toPlayer.z))
      : 0;
    animateHumanoid(this.rig, dt, speed, this.walkRef, this.state === 'engage', aimPitch);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  shootAt(player, ctx, dist) {
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z);
    const to = player.eyePosition(new THREE.Vector3());
    to.y -= 0.3 + Math.random() * 0.6;

    const playerSpeed = player.horizontalSpeed();
    const hitChance = Math.max(0.06, 0.55 - dist * 0.008 - playerSpeed * 0.022 - (player.sliding ? 0.1 : 0));
    const hits = Math.random() < hitChance;

    let end;
    if (hits) {
      end = to;
      player.damage(7 + Math.floor(Math.random() * 6), this.name);
    } else {
      end = to.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 3,
      ));
    }
    ctx.effects.tracer(from, end, 0xff8866);
    ctx.audio.shot('smg', ctx.audio.distVol(dist) * 0.7);
  }
}

export class BotManager {
  constructor(scene, world, player, effects, audio, count = 9) {
    this.scene = scene;
    this.player = player;
    this.bots = [];
    this.ctx = {
      player,
      effects,
      audio,
      colliders: world.colliders,
      occluders: world.occluders,
      waypoints: world.waypoints,
      botSpawns: world.botSpawns,
      raycaster: new THREE.Raycaster(),
    };

    for (let i = 0; i < count; i++) {
      const bot = new Bot(BOT_NAMES[i % BOT_NAMES.length], BOT_COLORS[i % BOT_COLORS.length]);
      bot.spawn(world.botSpawns[i % world.botSpawns.length]);
      scene.add(bot.group);
      this.bots.push(bot);
    }
  }

  update(dt) {
    for (const bot of this.bots) bot.update(dt, this.ctx);
  }

  getHitMeshes() {
    const list = [];
    for (const bot of this.bots) {
      if (!bot.dead) list.push(...bot.parts);
    }
    return list;
  }
}
