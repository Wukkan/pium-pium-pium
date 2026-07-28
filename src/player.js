import * as THREE from 'three';
import { moveBody } from './shared/physics.js';

// ---------------------------------------------------------------------------
// Jugador en primera persona: WASD + salto + bunny-hop + deslizamiento.
// pos = posición de los PIES. La cámara va a la altura de los ojos.
// ---------------------------------------------------------------------------

const WALK_SPEED = 7.2;
const MAX_SPEED = 13.5;
const ACCEL_GROUND = 70;
const FRICTION = 9;
const ACCEL_AIR = 22;
const GRAVITY = 24;
const JUMP_VEL = 8.6;
const EYE_STAND = 1.62;
const EYE_SLIDE = 0.95;
const HALF_X = 0.38, HALF_Z = 0.38, HEIGHT = 1.8;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.eyeHeight = EYE_STAND;

    this.health = 100;
    this.maxHealth = 100;
    this.dead = false;
    this.lastDamageTime = -99;
    this.lastAttacker = null;

    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideDir = new THREE.Vector3();

    this.recoilPitch = 0;   // lo empujan las armas
    this.shakeTime = 0;
    this.netMode = false;   // true en partidas online (el servidor manda en la vida)

    this.keys = {};
    this.sensitivity = 0.0023;
    this.fovOffset = 0;

    this.onJump = null;
    this.onLand = null;
    this.onDamaged = null;
    this.onDeath = null;

    this._wasGrounded = true;

    addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * this.sensitivity;
        this.pitch -= e.movementY * this.sensitivity;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      }
    });
  }

  spawn(point) {
    this.pos.copy(point);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.dead = false;
    this.sliding = false;
    this.recoilPitch = 0;
    this.yaw = Math.atan2(point.x, point.z); // mirar hacia el centro
    this.pitch = 0;
  }

  eyePosition(target = new THREE.Vector3()) {
    return target.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  damage(amount, attackerName) {
    if (this.dead) return;
    this.health -= amount;
    this.lastDamageTime = performance.now() / 1000;
    this.lastAttacker = attackerName;
    this.shakeTime = 0.25;
    if (this.onDamaged) this.onDamaged(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.onDeath) this.onDeath(attackerName);
    }
  }

  update(dt, inputEnabled) {
    const k = this.keys;
    const fwd = inputEnabled ? (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0) : 0;
    const strafe = inputEnabled ? (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0) : 0;
    const jumpHeld = inputEnabled && k['Space'];
    const slideHeld = inputEnabled && (k['ShiftLeft'] || k['ShiftRight']);

    // dirección deseada en el plano XZ según la cámara
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (-sin * fwd + cos * strafe);
    const wishZ = (-cos * fwd - sin * strafe);
    const wishLen = Math.hypot(wishX, wishZ);
    const wx = wishLen > 0 ? wishX / wishLen : 0;
    const wz = wishLen > 0 ? wishZ / wishLen : 0;

    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // --- deslizamiento ---
    if (!this.sliding && slideHeld && this.onGround && this.horizontalSpeed() > 4.5 && this.slideCooldown <= 0) {
      this.sliding = true;
      this.slideTime = 0.55;
      const sp = Math.min(MAX_SPEED, Math.max(this.horizontalSpeed() * 1.4, 11));
      this.slideDir.set(this.vel.x, 0, this.vel.z).normalize();
      this.vel.x = this.slideDir.x * sp;
      this.vel.z = this.slideDir.z * sp;
    }
    if (this.sliding) {
      this.slideTime -= dt;
      if (this.slideTime <= 0 || !slideHeld || this.horizontalSpeed() < 3.5) {
        this.sliding = false;
        this.slideCooldown = 0.7;
      }
    }

    // --- aceleración horizontal ---
    if (this.onGround && !this.sliding) {
      // fricción
      const sp = this.horizontalSpeed();
      if (sp > 0) {
        const drop = sp * FRICTION * dt;
        const scale = Math.max(0, sp - drop) / sp;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }
      // acelerar hacia wishdir
      this.vel.x += wx * ACCEL_GROUND * dt;
      this.vel.z += wz * ACCEL_GROUND * dt;
      const nsp = this.horizontalSpeed();
      if (nsp > WALK_SPEED && wishLen > 0) {
        const s = WALK_SPEED / nsp;
        this.vel.x *= s; this.vel.z *= s;
      }
    } else if (this.onGround && this.sliding) {
      // fricción muy baja durante el deslizamiento
      this.vel.x *= Math.max(0, 1 - 1.6 * dt);
      this.vel.z *= Math.max(0, 1 - 1.6 * dt);
    } else {
      // control aéreo: acelera sin superar la velocidad actual (o la de andar)
      const cap = Math.max(this.horizontalSpeed(), WALK_SPEED * 0.95);
      this.vel.x += wx * ACCEL_AIR * dt;
      this.vel.z += wz * ACCEL_AIR * dt;
      const nsp = this.horizontalSpeed();
      if (nsp > cap) {
        const s = cap / nsp;
        this.vel.x *= s; this.vel.z *= s;
      }
    }

    // --- salto / bunny-hop ---
    if (jumpHeld && this.onGround) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
      if (this.sliding) {
        // salto desde deslizamiento: conserva el impulso
        this.sliding = false;
        this.slideCooldown = 0.5;
      } else {
        // bunny-hop: pequeño impulso extra conservando velocidad
        const sp = this.horizontalSpeed();
        if (sp > WALK_SPEED * 0.9) {
          const boost = Math.min(MAX_SPEED, sp * 1.03) / (sp || 1);
          this.vel.x *= boost; this.vel.z *= boost;
        }
      }
      if (this.onJump) this.onJump();
    }

    // --- gravedad y colisión ---
    this.vel.y -= GRAVITY * dt;
    const wasGrounded = this._wasGrounded;
    const res = moveBody(this.pos, this.vel, dt, HALF_X, HALF_Z, HEIGHT, this.world.colliders);
    this.onGround = res.onGround;
    if (!wasGrounded && this.onGround && this.onLand) this.onLand();
    this._wasGrounded = this.onGround;

    // red de seguridad si algo sale mal
    if (this.pos.y < -30) this.pos.set(0, 5, 20);

    // --- regeneración de vida (en online la lleva el servidor) ---
    const now = performance.now() / 1000;
    if (!this.netMode && !this.dead && this.health < this.maxHealth && now - this.lastDamageTime > 4) {
      this.health = Math.min(this.maxHealth, this.health + 14 * dt);
    }

    // --- cámara ---
    const targetEye = this.sliding ? EYE_SLIDE : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);

    // retroceso vuelve a su sitio
    this.recoilPitch *= Math.max(0, 1 - dt * 9);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    const shake = this.shakeTime > 0 ? Math.sin(now * 80) * 0.004 * (this.shakeTime / 0.25) : 0;

    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch + shake, this.yaw, 0, 'YXZ');
  }
}
