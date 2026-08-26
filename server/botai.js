import { moveBody, segmentBlocked } from '../src/shared/physics.js';
import { BOT_BODY } from '../src/shared/spawn-safety.js';
import {
  botWaypointReachable,
  findBotNavigationRoute,
  selectReachableBotWaypoint,
} from '../src/shared/bot-navigation.js';

// ---------------------------------------------------------------------------
// IA de los bots en el SERVIDOR. Es el mismo comportamiento que tenía el
// cliente en modo local: patrullar waypoints, encarar al jugador visible más
// cercano, disparar en ráfagas con probabilidad de acierto.
// ---------------------------------------------------------------------------

const BOT_SPEED = 5.2;
const GRAVITY = 24;
const { halfX: HALF, height: HEIGHT } = BOT_BODY;
const ENGAGE_DIST = 42;

const now = () => Date.now() / 1000;

export class ServerBot {
  // opts: { team: 'r'|'b'|null, zombie: bool, hp, speedMul, meleeDmg }
  constructor(id, name, color, opts = {}) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.team = opts.team || null;
    this.zombie = !!opts.zombie;
    this.maxHp = opts.hp || 100;
    this.speedMul = opts.speedMul || 1;
    this.meleeDmg = opts.meleeDmg || 12;
    this.spawnPicker = typeof opts.spawnPicker === 'function' ? opts.spawnPicker : null;
    this.nextMeleeAt = 0;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.targetYaw = 0;
    this.hp = 100;
    this.dead = false;
    this.respawnAt = 0;
    this.speed = 0;
    this.engaging = false;

    this.waypoint = null;
    this.repathAt = 0;
    this.strafeDir = 1;
    this.strafeChangeAt = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.stuckCheckAt = 0;
    this.nextPathCheckAt = 0;
    this.navigationTarget = null;
    this.navigationGoal = null;
    this.navigationRoute = [];
    this.directChase = false;
    this.lastCheckPos = { x: 0, y: 0, z: 0 };
    this.onGround = false;

    this.spawn();
  }

  spawn() {
    const sp = this.spawnPicker?.(this);
    if (!sp) return false;
    this.pos = { ...sp };
    this.vel = { x: 0, y: 0, z: 0 };
    this.hp = this.maxHp;
    this.dead = false;
    this.respawnAt = 0;
    this.waypoint = null;
    this.onGround = false;
    this.engaging = false;
    this.speed = 0;
    this.repathAt = 0;
    this.stuckCheckAt = 0;
    this.nextPathCheckAt = 0;
    this.navigationTarget = null;
    this.navigationGoal = null;
    this.navigationRoute = [];
    this.directChase = false;
    this.lastCheckPos = { ...sp };
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.nextMeleeAt = 0;
    this.lastSpawn = { ...sp };
    return true;
  }

  eyePos() {
    return { x: this.pos.x, y: this.pos.y + 1.66, z: this.pos.z };
  }

  // devuelve true si ha muerto con este golpe
  takeDamage(amount, attackerPos) {
    if (this.dead) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.respawnAt = now() + 3.5;
      return true;
    }
    if (attackerPos) {
      this.waypoint = { ...attackerPos };
      this.repathAt = now() + 5;
    }
    return false;
  }

  // ctx pertenece a una única sala. El mapa/waypoints nunca viven en estado
  // global: dos salas pueden simular mapas distintos sin contaminar su IA.
  // ctx: { colliders, waypoints, players, bots, onShoot, onHitTarget }
  update(dt, ctx) {
    const t = now();

    if (this.dead) {
      if (this.zombie) return; // los zombis no reaparecen: los repone la oleada
      if (t >= this.respawnAt) this.spawn();
      return;
    }

    // objetivo: entidad viva visible más cercana (jugadores u otros bots;
    // los humanos tienen preferencia ligera). Nunca compañeros de equipo.
    // Los zombis solo cazan jugadores y los ven desde toda la arena.
    const engageDist = this.zombie ? 200 : ENGAGE_DIST;
    let target = null, targetKind = null, targetDist = Infinity, best = Infinity;
    const considerar = (kind, ent, alive) => {
      if (!alive || ent === this) return;
      if (this.team && ent.team === this.team) return;
      const d = Math.hypot(ent.pos.x - this.pos.x, ent.pos.y - this.pos.y, ent.pos.z - this.pos.z);
      if (d > engageDist) return;
      const score = kind === 'pl' ? d * 0.75 : d;
      if (score >= best) return;
      if (!this.zombie) {
        const from = this.eyePos();
        const to = { x: ent.pos.x, y: ent.pos.y + 1.6, z: ent.pos.z };
        if (segmentBlocked(from, to, ctx.colliders)) return;
      }
      target = ent; targetKind = kind; targetDist = d; best = score;
    };
    for (const p of ctx.players) considerar('pl', p, p.alive);
    if (!this.zombie) for (const b of ctx.bots) considerar('bot', b, !b.dead);

    let moveX = 0, moveZ = 0;
    this.engaging = !!target;

    if (target && this.zombie) {
      // Conserva la ruta completa elegida por A*. Recalcular un waypoint
      // independiente en cada rellano producía oscilaciones, especialmente al
      // bajar de una azotea: dos candidatos parecían alternadamente mejores.
      const waypointReached = this.waypoint &&
        Math.hypot(this.pos.x - this.waypoint.x, this.pos.z - this.waypoint.z) < 0.72 &&
        Math.abs(this.pos.y - this.waypoint.y) < 0.3;
      const targetChanged = this.navigationTarget !== target;
      const targetMoved = this.navigationGoal && Math.hypot(
        target.pos.x - this.navigationGoal.x,
        target.pos.y - this.navigationGoal.y,
        target.pos.z - this.navigationGoal.z,
      ) > 4;

      if (targetChanged) {
        this.navigationTarget = target;
        this.navigationRoute = [];
        this.waypoint = null;
        this.directChase = false;
      }

      if (waypointReached) {
        this.navigationRoute.shift();
        this.waypoint = this.navigationRoute[0] ? { ...this.navigationRoute[0] } : null;
        this.vel.x = 0;
        this.vel.z = 0;
      }

      const pathCheckDue = t >= this.nextPathCheckAt;
      const routeSegmentBlocked = pathCheckDue && this.waypoint &&
        !botWaypointReachable(this.pos, this.waypoint, ctx.colliders, BOT_BODY);
      const needsRoute = targetChanged || targetMoved || routeSegmentBlocked ||
        (!this.directChase && !this.waypoint) || pathCheckDue;
      if (needsRoute) {
        const canChaseDirectly = botWaypointReachable(
          this.pos, target.pos, ctx.colliders, BOT_BODY,
        );
        if (canChaseDirectly) {
          this.directChase = true;
          this.navigationRoute = [];
          this.waypoint = null;
        } else if (targetChanged || targetMoved || routeSegmentBlocked || !this.waypoint) {
          const route = findBotNavigationRoute(
            this.pos,
            ctx.waypoints,
            ctx.colliders,
            { body: BOT_BODY, goal: target.pos, allowPartial: true },
          );
          this.navigationRoute = route;
          this.waypoint = route[0] ? { ...route[0] } : null;
          this.directChase = false;
          // Al cambiar de tramo se elimina la inercia lateral que podría
          // recortar la esquina de un edificio o una baranda.
          this.vel.x = 0;
          this.vel.z = 0;
        } else {
          this.directChase = false;
        }
        this.navigationGoal = { ...target.pos };
        this.nextPathCheckAt = t + (this.waypoint || this.directChase ? 0.5 : 0.75);
      }
      const chasePoint = this.directChase ? target.pos : this.waypoint;
      const dx = chasePoint ? chasePoint.x - this.pos.x : 0;
      const dz = chasePoint ? chasePoint.z - this.pos.z : 0;
      this.targetYaw = Math.atan2(dx, dz);
      const fl = Math.hypot(dx, dz) || 1;
      const pendingLevelChange = !this.directChase && this.waypoint &&
        Math.abs(this.pos.y - this.waypoint.y) >= 0.3;
      if (fl >= 0.7 || (pendingLevelChange && fl > 0.05)) {
        moveX = dx / fl; moveZ = dz / fl;
      }
      const meleeTarget = { x: target.pos.x, y: target.pos.y + 1, z: target.pos.z };
      if (targetDist < 1.9 && t >= this.nextMeleeAt &&
          !segmentBlocked(this.eyePos(), meleeTarget, ctx.colliders)) {
        this.nextMeleeAt = t + 0.8;
        ctx.onHitTarget(this, targetKind, target, this.meleeDmg);
      }
    } else if (target) {
      this.navigationTarget = null;
      this.navigationGoal = null;
      this.navigationRoute = [];
      const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
      this.targetYaw = Math.atan2(dx, dz);

      if (t > this.strafeChangeAt) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeChangeAt = t + 0.8 + Math.random() * 1.4;
      }
      const fl = Math.hypot(dx, dz) || 1;
      const fx = dx / fl, fz = dz / fl;
      let push = 0;
      if (targetDist > 26) push = 1;
      else if (targetDist < 9) push = -1;
      moveX = (-fz * this.strafeDir + fx * push) * 0.8;
      moveZ = (fx * this.strafeDir + fz * push) * 0.8;

      if (this.burstLeft > 0 && t >= this.nextShotAt) {
        this.burstLeft--;
        this.nextShotAt = t + 0.11;
        this.shootAt(target, targetKind, targetDist, ctx);
      } else if (this.burstLeft <= 0 && t >= this.nextBurstAt) {
        this.burstLeft = 3 + Math.floor(Math.random() * 4);
        this.nextBurstAt = t + 0.7 + Math.random() * 1.1;
        this.nextShotAt = t + 0.15 + Math.random() * 0.25;
      }
    } else {
      this.navigationTarget = null;
      this.navigationGoal = null;
      this.navigationRoute = [];
      let needsWaypoint = !this.waypoint || t > this.repathAt ||
        (this.pos.x - this.waypoint.x) ** 2 + (this.pos.z - this.waypoint.z) ** 2 < 2.5;
      if (!needsWaypoint && t >= this.nextPathCheckAt) {
        needsWaypoint = !botWaypointReachable(this.pos, this.waypoint, ctx.colliders, BOT_BODY);
        this.nextPathCheckAt = t + 0.75;
      }
      if (needsWaypoint) {
        const nextWaypoint = selectReachableBotWaypoint(
          this.pos, ctx.waypoints, ctx.colliders, { body: BOT_BODY },
        );
        this.waypoint = nextWaypoint ? { ...nextWaypoint } : null;
        this.repathAt = t + (this.waypoint ? 6 + Math.random() * 5 : 0.75);
        this.nextPathCheckAt = t + 0.75;
      }
      if (this.waypoint) {
        const dx = this.waypoint.x - this.pos.x, dz = this.waypoint.z - this.pos.z;
        const l = Math.hypot(dx, dz);
        if (l > 0.7) {
          moveX = dx / l; moveZ = dz / l;
          this.targetYaw = Math.atan2(moveX, moveZ);
        }
      }
    }

    // detector de atasco
    if (t > this.stuckCheckAt) {
      const moved = (this.pos.x - this.lastCheckPos.x) ** 2 + (this.pos.z - this.lastCheckPos.z) ** 2;
      if ((moveX !== 0 || moveZ !== 0) && moved < 0.09) {
        if (this.onGround) this.vel.y = 8.4;
        this.waypoint = null;
        this.navigationRoute = [];
        this.directChase = false;
        this.repathAt = 0;
      }
      this.lastCheckPos = { ...this.pos };
      this.stuckCheckAt = t + 0.6;
    }

    // movimiento
    const speed = BOT_SPEED * this.speedMul;
    const k = Math.min(1, dt * 8);
    this.vel.x += (moveX * speed - this.vel.x) * k;
    this.vel.z += (moveZ * speed - this.vel.z) * k;
    this.vel.y -= GRAVITY * dt;
    const res = moveBody(this.pos, this.vel, dt, HALF, HALF, HEIGHT, ctx.colliders);
    this.onGround = res.onGround;
    if (this.pos.y < -30) this.spawn();

    // orientación suave
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }

  shootAt(target, kind, dist, ctx) {
    const from = { x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z };
    const to = {
      x: target.pos.x,
      y: target.pos.y + 1.3 - Math.random() * 0.5,
      z: target.pos.z,
    };
    const hitChance = Math.max(
      0.06,
      0.55 - dist * 0.008 - (target.speed || 0) * 0.022 - (target.sliding ? 0.1 : 0),
    );
    const hits = Math.random() < hitChance;
    if (!hits) {
      to.x += (Math.random() - 0.5) * 3;
      to.y += (Math.random() - 0.5) * 2.5;
      to.z += (Math.random() - 0.5) * 3;
    }
    ctx.onShoot(this, from, to);
    if (hits) ctx.onHitTarget(this, kind, target, 7 + Math.floor(Math.random() * 6));
  }
}
