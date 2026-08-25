import * as THREE from 'three';
import { moveBody } from './shared/physics.js';
import { PLAYER_BODY, selectSafeSpawn } from './shared/spawn-safety.js';
import { DEFAULT_BINDINGS } from './input-bindings.js';

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
const { halfX: HALF_X, halfZ: HALF_Z, height: HEIGHT } = PLAYER_BODY;

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
    this.landingKick = 0;
    this.netMode = false;   // true en partidas online (el servidor manda en la vida)

    this.keys = {};
    this.bindings = { ...DEFAULT_BINDINGS };
    this.sensitivity = 0.0023;
    this.invertY = false;
    this.bunnyHopEnabled = true;
    this.screenShake = 1;
    this.fovOffset = 0;
    this.fallbackLookActive = false;
    this.fallbackLookSurface = null;
    this.fallbackPointerX = null;
    this.fallbackPointerY = null;

    this.onJump = null;
    this.onLand = null;
    this.onDamaged = null;
    this.onDeath = null;

    this._wasGrounded = true;
    this._jumpWasHeld = false;

    addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this._jumpWasHeld = false; });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) {
        this.keys = {};
        this._jumpWasHeld = false;
      }
    });
    addEventListener('mousemove', (e) => {
      const locked = !!document.pointerLockElement;
      const overFallbackSurface = this.fallbackLookActive &&
        (!this.fallbackLookSurface || this.fallbackLookSurface.contains?.(e.target));
      if (!locked && !overFallbackSurface) return;
      const limit = locked ? Number.POSITIVE_INFINITY : 80;
      let rawX = Number(e.movementX);
      let rawY = Number(e.movementY);
      if (!locked) {
        const clientX = Number(e.clientX);
        const clientY = Number(e.clientY);
        if (Number.isFinite(clientX) && Number.isFinite(this.fallbackPointerX)) {
          const clientDeltaX = clientX - this.fallbackPointerX;
          if (!Number.isFinite(rawX) || (rawX === 0 && clientDeltaX !== 0)) rawX = clientDeltaX;
        }
        if (Number.isFinite(clientY) && Number.isFinite(this.fallbackPointerY)) {
          const clientDeltaY = clientY - this.fallbackPointerY;
          if (!Number.isFinite(rawY) || (rawY === 0 && clientDeltaY !== 0)) rawY = clientDeltaY;
        }
        this.fallbackPointerX = Number.isFinite(clientX) ? clientX : null;
        this.fallbackPointerY = Number.isFinite(clientY) ? clientY : null;
      }
      const movementX = Math.max(-limit, Math.min(limit, Number.isFinite(rawX) ? rawX : 0));
      const movementY = Math.max(-limit, Math.min(limit, Number.isFinite(rawY) ? rawY : 0));
      this.yaw -= movementX * this.sensitivity;
      this.pitch += (this.invertY ? 1 : -1) * movementY * this.sensitivity;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    });
  }

  setFallbackLook(active, surface = null) {
    this.fallbackLookActive = !!active;
    this.fallbackLookSurface = surface || null;
    this.fallbackPointerX = null;
    this.fallbackPointerY = null;
  }

  setBindings(bindings) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.keys = {};
    this._jumpWasHeld = false;
  }

  spawn(point) {
    this.pos.copy(point);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.dead = false;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideDir.set(0, 0, 0);
    this.onGround = false;
    this._wasGrounded = true;
    this.eyeHeight = EYE_STAND;
    this.recoilPitch = 0;
    this.shakeTime = 0;
    this.landingKick = 0;
    this.lastDamageTime = -99;
    this.lastAttacker = null;
    this.yaw = Math.atan2(point.x, point.z); // mirar hacia el centro
    this.pitch = 0;
    this.keys = {};
    this._jumpWasHeld = false;
  }

  correctPosition(point) {
    const values = Array.isArray(point)
      ? point
      : [point?.x, point?.y, point?.z];
    if (values.length !== 3 || values.some((value) =>
      !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 10000)) return false;
    this.pos.set(Number(values[0]), Number(values[1]), Number(values[2]));
    this.vel.set(0, 0, 0);
    this.sliding = false;
    this.slideTime = 0;
    this.onGround = false;
    return true;
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
    this.shakeTime = Math.min(0.38, 0.18 + Math.max(0, amount) * 0.004);
    if (this.onDamaged) this.onDamaged(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.onDeath) this.onDeath(attackerName);
    }
  }

  update(dt, inputEnabled) {
    const k = this.keys;
    const bind = this.bindings;
    const fwd = inputEnabled ? (k[bind.moveForward] ? 1 : 0) - (k[bind.moveBackward] ? 1 : 0) : 0;
    const strafe = inputEnabled ? (k[bind.moveRight] ? 1 : 0) - (k[bind.moveLeft] ? 1 : 0) : 0;
    const jumpHeld = inputEnabled && !!k[bind.jump];
    const jumpPressed = jumpHeld && !this._jumpWasHeld;
    this._jumpWasHeld = jumpHeld;
    const jumpRequested = this.bunnyHopEnabled ? jumpHeld : jumpPressed;
    const pairedShift = bind.slide === 'ShiftLeft'
      ? 'ShiftRight'
      : bind.slide === 'ShiftRight' ? 'ShiftLeft' : null;
    const pairedShiftIsFree = pairedShift && !Object.entries(bind)
      .some(([action, code]) => action !== 'slide' && code === pairedShift);
    const slideHeld = inputEnabled && !!(k[bind.slide] || (pairedShiftIsFree && k[pairedShift]));

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
    if (jumpRequested && this.onGround) {
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
    const fallSpeed = -this.vel.y; // velocidad de caída antes del impacto
    const res = moveBody(this.pos, this.vel, dt, HALF_X, HALF_Z, HEIGHT, this.world.colliders);
    this.onGround = res.onGround;
    if (!wasGrounded && this.onGround) {
      this.landingKick = Math.min(0.075, Math.max(0, fallSpeed - 5) * 0.0045);
      if (this.onLand) this.onLand();
      if (fallSpeed > 16 && this.onHardLand) this.onHardLand(fallSpeed);
    }
    this._wasGrounded = this.onGround;

    // Red de seguridad: volver a un punto fijo validado, nunca a una
    // coordenada mágica que pueda coincidir con la geometría de otro mapa.
    if (this.pos.y < -30) {
      const recovery = selectSafeSpawn({
        points: this.world.playerSpawns,
        colliders: this.world.colliders,
        body: PLAYER_BODY,
        margin: 0.2,
        previous: this.pos,
        random: () => 0,
      });
      if (recovery) {
        this.pos.set(recovery.x, recovery.y, recovery.z);
        this.vel.set(0, 0, 0);
        this.onGround = false;
        this._wasGrounded = true;
      }
    }

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
    const trauma = this.shakeTime > 0 ? Math.min(1, this.shakeTime / 0.3) * this.screenShake : 0;
    const shakePitch = Math.sin(now * 79) * 0.009 * trauma;
    const shakeYaw = Math.sin(now * 61 + 1.7) * 0.006 * trauma;
    const shakeRoll = Math.sin(now * 93 + 0.8) * 0.008 * trauma;
    const landingOffset = this.landingKick;
    this.landingKick += (0 - this.landingKick) * Math.min(1, dt * 13);

    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight - landingOffset, this.pos.z);
    this.camera.rotation.set(
      this.pitch + this.recoilPitch + shakePitch,
      this.yaw + shakeYaw,
      shakeRoll,
      'YXZ',
    );
  }
}
