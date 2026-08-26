import * as THREE from 'three';
import { moveBody } from './shared/physics.js';
import { BOT_BODY, selectSafeSpawn } from './shared/spawn-safety.js';
import {
  botWaypointReachable,
  selectReachableBotWaypoint,
} from './shared/bot-navigation.js';
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
import { hitReactionSide, stablePoseSide } from './character-motion.js';
import {
  BOT_NAMES, BOT_COLORS, MAX_BOTS, jumpPadContainsPoint,
} from './shared/mapdata.js';

// ---------------------------------------------------------------------------
// Bots LOCALES: solo se usan en modo sin conexión (cuando no hay servidor).
// En modo online los bots corren en el servidor y se ven como marionetas
// (src/remotes.js). La IA de aquí es la misma que la del servidor.
// ---------------------------------------------------------------------------

const BOT_SPEED = 5.2;
const GRAVITY = 24;
const { halfX: HALF, height: HEIGHT } = BOT_BODY;
const ENGAGE_DIST = 42;

export function playLocalBotShot(audio, origin, player, fallbackDistance = 0) {
  if (!audio) return null;
  const listener = typeof player?.eyePosition === 'function'
    ? player.eyePosition(new THREE.Vector3())
    : new THREE.Vector3(
        Number(player?.pos?.x) || 0,
        (Number(player?.pos?.y) || 0) + (Number(player?.eyeHeight) || 1.62),
        Number(player?.pos?.z) || 0,
      );
  const forward = new THREE.Vector3(0, 0, -1);
  if (typeof player?.camera?.getWorldDirection === 'function') {
    player.camera.getWorldDirection(forward);
  } else {
    const yaw = Number.isFinite(player?.yaw) ? player.yaw : 0;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  if (typeof audio.shotAt === 'function') {
    return audio.shotAt('smg', origin, listener, forward, 0.7);
  }
  const attenuation = typeof audio.distVol === 'function'
    ? audio.distVol(fallbackDistance)
    : 1;
  if (typeof audio.shot === 'function') audio.shot('smg', attenuation * 0.7);
  return null;
}

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
    this.deathSide = stablePoseSide(name);

    this.state = 'patrol';
    this.waypoint = null;
    this.repathAt = 0;
    this.strafeDir = 1;
    this.strafeChangeAt = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.stuckCheckAt = 0;
    this.nextPathCheckAt = 0;
    this.lastCheckPos = new THREE.Vector3();
    this.walkRef = { t: 0 };

    this.rig = makeHumanoid(color, name, (part) => ({ bot: this, part }));
    setHumanoidFacingConvention(this.rig, 'bot');
    this.group = this.rig.group;
    this.parts = this.rig.parts;
  }

  spawn(point) {
    if (!point) return false;
    this.pos.copy(point);
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.dead = false;
    this.deathAnim = 0;
    this.state = 'patrol';
    this.waypoint = null;
    this.repathAt = 0;
    this.stuckCheckAt = 0;
    this.nextPathCheckAt = 0;
    this.lastCheckPos.copy(point);
    this.onGround = false;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.group.visible = true;
    resetHumanoidPose(this.rig);
    this.group.rotation.y = this.yaw;
    this.group.position.copy(point);
    this.lastSpawn = { x: point.x, y: point.y, z: point.z };
    return true;
  }

  eyePos(target = new THREE.Vector3()) {
    return target.set(this.pos.x, this.pos.y + 1.66, this.pos.z);
  }

  takeDamage(amount, attackerPos) {
    if (this.dead) return false;
    const impactSide = attackerPos
      ? hitReactionSide(attackerPos, this.pos, this.yaw)
      : this.deathSide;
    triggerHumanoidHit(this.rig, Math.min(1, Math.max(0.2, Number(amount) / 45)), impactSide);
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.deathAnim = 0.001;
      this.deathSide = impactSide;
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
        animateHumanoidDeath(this.rig, this.deathAnim, this.deathSide);
      } else if (now > this.respawnAt - 1) {
        animateHumanoidDeath(this.rig, 1, this.deathSide);
        this.group.position.y -= dt * 2;
      }
      if (now >= this.respawnAt) {
        this.spawn(ctx.pickSpawn(this));
      }
      return;
    }

    // objetivo: el jugador u otro bot, el vivo visible más cercano
    // (el humano tiene preferencia ligera)
    const player = ctx.player;
    let target = null, isPlayer = false, dist = Infinity, best = Infinity;
    const considerar = (ent, entIsPlayer, alive, eyeY) => {
      if (!alive || ent === this) return;
      const d = Math.hypot(ent.pos.x - this.pos.x, ent.pos.y - this.pos.y, ent.pos.z - this.pos.z);
      if (d > ENGAGE_DIST) return;
      const score = entIsPlayer ? d * 0.75 : d;
      if (score >= best) return;
      const from = this.eyePos();
      const to = new THREE.Vector3(ent.pos.x, ent.pos.y + eyeY, ent.pos.z);
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      dir.normalize();
      ctx.raycaster.set(from, dir);
      ctx.raycaster.far = len - 0.3;
      if (ctx.raycaster.intersectObjects(ctx.occluders, false).length > 0) return;
      target = ent; isPlayer = entIsPlayer; dist = d; best = score;
    };
    considerar(player, true, !player.dead, 1.6);
    for (const b of ctx.bots) considerar(b, false, !b.dead, 1.66);

    let moveX = 0, moveZ = 0;
    this._aimTarget = target;

    if (target) {
      const toTarget = new THREE.Vector3().subVectors(target.pos, this.pos);
      this.targetYaw = Math.atan2(toTarget.x, toTarget.z);
      if (now > this.strafeChangeAt) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeChangeAt = now + 0.8 + Math.random() * 1.4;
      }
      const fwd = new THREE.Vector3(toTarget.x, 0, toTarget.z).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(this.strafeDir);
      let push = 0;
      if (dist > 26) push = 1;
      else if (dist < 9) push = -1;
      moveX = (side.x + fwd.x * push) * 0.8;
      moveZ = (side.z + fwd.z * push) * 0.8;

      if (this.burstLeft > 0 && now >= this.nextShotAt) {
        this.burstLeft--;
        this.nextShotAt = now + 0.11;
        this.shootAt(target, isPlayer, ctx, dist);
      } else if (this.burstLeft <= 0 && now >= this.nextBurstAt) {
        this.burstLeft = 3 + Math.floor(Math.random() * 4);
        this.nextBurstAt = now + 0.7 + Math.random() * 1.1;
        this.nextShotAt = now + 0.15 + Math.random() * 0.25;
      }
      this.waypoint = target.pos.clone(); // si lo pierde de vista, ir a por él
      this.repathAt = now + 4;
    } else {
      let needsWaypoint = !this.waypoint || now > this.repathAt ||
        this.pos.distanceToSquared(this.waypoint) < 2.5;
      if (!needsWaypoint && now >= this.nextPathCheckAt) {
        needsWaypoint = !botWaypointReachable(this.pos, this.waypoint, ctx.colliders, BOT_BODY);
        this.nextPathCheckAt = now + 0.75;
      }
      if (needsWaypoint) {
        const nextWaypoint = selectReachableBotWaypoint(
          this.pos, ctx.waypoints, ctx.colliders, { body: BOT_BODY },
        );
        this.waypoint = nextWaypoint?.clone
          ? nextWaypoint.clone()
          : nextWaypoint
            ? new THREE.Vector3(nextWaypoint.x, nextWaypoint.y, nextWaypoint.z)
            : null;
        this.repathAt = now + (this.waypoint ? 6 + Math.random() * 5 : 0.75);
        this.nextPathCheckAt = now + 0.75;
      }
      if (this.waypoint) {
        const dir = new THREE.Vector3().subVectors(this.waypoint, this.pos);
        dir.y = 0;
        if (dir.lengthSq() > 0.5) {
          dir.normalize();
          moveX = dir.x; moveZ = dir.z;
          this.targetYaw = Math.atan2(dir.x, dir.z);
        }
      }
    }

    if (now > this.stuckCheckAt) {
      if ((moveX !== 0 || moveZ !== 0) && this.pos.distanceToSquared(this.lastCheckPos) < 0.09) {
        if (this.onGround) this.vel.y = 8.4;
        this.waypoint = null;
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
    if (this.onGround) {
      for (const pad of ctx.jumpPads || []) {
        if (!jumpPadContainsPoint(this.pos, pad)) continue;
        this.vel.y = pad.power;
        this.onGround = false;
        break;
      }
    }
    if (this.pos.y < -30) this.spawn(ctx.pickSpawn(this));

    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const aiming = !!this._aimTarget;
    const aimPitch = aiming
      ? Math.atan2(
          this._aimTarget.pos.y + 1.4 - (this.pos.y + 1.34),
          Math.hypot(this._aimTarget.pos.x - this.pos.x, this._aimTarget.pos.z - this.pos.z),
        )
      : 0;
    animateHumanoid(this.rig, dt, speed, this.walkRef, aiming, aimPitch);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  shootAt(target, isPlayer, ctx, dist) {
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z);
    const to = new THREE.Vector3(
      target.pos.x,
      target.pos.y + 1.3 - Math.random() * 0.4,
      target.pos.z,
    );

    const tSpeed = isPlayer ? target.horizontalSpeed() : Math.hypot(target.vel.x, target.vel.z);
    const hitChance = Math.max(0.06, 0.55 - dist * 0.008 - tSpeed * 0.022 - (target.sliding ? 0.1 : 0));
    const hits = Math.random() < hitChance;
    triggerHumanoidShot(this.rig, 0.82);

    let end = to;
    if (hits) {
      if (isPlayer) {
        target.damage(7 + Math.floor(Math.random() * 6), this.name);
      } else {
        const died = target.takeDamage(7 + Math.floor(Math.random() * 6), this.pos);
        if (died) {
          if (ctx.onKill) ctx.onKill(this.name, target.name);
          if (ctx.onBotDeath) ctx.onBotDeath(target);
        }
      }
    } else {
      end = to.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 3,
      ));
    }
    ctx.effects.tracer(from, end, 0xff8866);
    playLocalBotShot(ctx.audio, from, ctx.player, dist);
  }
}

export class BotManager {
  constructor(scene, world, player, effects, audio, count = MAX_BOTS) {
    this.scene = scene;
    this.player = player;
    this.bots = [];
    this.botSpawns = world.botSpawns;
    this.botSerial = 0;
    this.ctx = {
      player,
      effects,
      audio,
      bots: this.bots,
      onKill: null,     // (nombreAsesino, nombreVictima) — lo asigna main.js
      onBotDeath: null, // (bot) — para soltar kits de vida
      colliders: world.colliders,
      occluders: world.occluders,
      waypoints: world.navigationPoints?.length ? world.navigationPoints : world.waypoints,
      jumpPads: world.jumpPads,
      botSpawns: this.botSpawns,
      pickSpawn: (exclude) => this.pickSpawn(exclude),
      raycaster: new THREE.Raycaster(),
    };

    this.setCount(count);
  }

  setCount(count) {
    const parsed = Number(count);
    const target = Number.isFinite(parsed)
      ? Math.max(0, Math.min(MAX_BOTS, Math.trunc(parsed)))
      : 0;

    while (this.bots.length > target) {
      const bot = this.bots.pop();
      this.disposeBot(bot);
    }

    while (this.bots.length < target && this.botSpawns.length > 0) {
      const serial = this.botSerial++;
      const baseName = BOT_NAMES[serial % BOT_NAMES.length];
      const name = serial < BOT_NAMES.length ? baseName : `${baseName}_${serial}`;
      const bot = new Bot(name, BOT_COLORS[serial % BOT_COLORS.length]);
      bot.spawn(this.pickSpawn(bot));
      this.scene.add(bot.group);
      this.bots.push(bot);
    }

    return this.bots.length;
  }

  pickSpawn(exclude = null) {
    return selectSafeSpawn({
      points: this.botSpawns,
      colliders: this.ctx.colliders,
      body: BOT_BODY,
      margin: 0.15,
      occupants: [this.player, ...this.bots.filter((bot) => bot !== exclude)],
      previous: exclude?.lastSpawn,
    });
  }

  disposeBot(bot) {
    this.scene.remove(bot.group);
    disposeHumanoid(bot.rig);
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
