import {
  ConstantColor,
  ConstantValue,
  IntervalValue,
  PointEmitter,
  Vector4,
} from 'quarks.core';

const LIFETIMES = {
  muzzle: 0.12,
  impact: 0.3,
  explosion: 0.65,
  trail: 0.2,
};

const SURFACE_PROFILES = Object.freeze({
  concrete: Object.freeze({ color: 0xd8d0b8, texture: 'smoke', speed: [0.3, 1.6], size: [0.045, 0.13], life: [0.16, 0.38], additive: false }),
  metal: Object.freeze({ color: 0xffc45e, texture: 'impact', speed: [1.4, 4.2], size: [0.025, 0.075], life: [0.1, 0.28], additive: true }),
  wood: Object.freeze({ color: 0xc79352, texture: 'impact', speed: [0.65, 2.5], size: [0.04, 0.12], life: [0.18, 0.42], additive: false }),
  flesh: Object.freeze({ color: 0xb63b37, texture: 'smoke', speed: [0.25, 1.25], size: [0.05, 0.15], life: [0.12, 0.3], additive: false }),
});

const QUALITY = Object.freeze({
  low: Object.freeze({ active: 32, particles: 0.48, smoke: false }),
  balanced: Object.freeze({ active: 52, particles: 0.76, smoke: true }),
  high: Object.freeze({ active: 72, particles: 1, smoke: true }),
});

export function effectProfile(kind) {
  if (kind === 'explosion') return { layers: ['flash', 'fire', 'shockwave', 'smoke', 'embers'] };
  if (kind === 'muzzle') return { layers: ['flash', 'sparks'] };
  return { layers: ['particles'] };
}

export function clampParticleCount(value, min = 1, max = 24) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

export function effectLifetime(kind) {
  return LIFETIMES[kind] || 0.35;
}

export function impactSurfaceProfile(surface = 'concrete') {
  return SURFACE_PROFILES[surface] || SURFACE_PROFILES.concrete;
}

export class QuarksEffects {
  constructor(scene, THREE, quarks) {
    this.scene = scene;
    this.THREE = THREE;
    this.quarks = quarks;
    this.batch = new quarks.BatchedRenderer();
    this.active = new Set();
    this.quality = 'balanced';
    this.qualityProfile = QUALITY.balanced;
    this.texture = this.createTexture();
    this.textures = {
      default: this.loadTexture('/assets/effects/particle_default.png'),
      smoke: this.loadTexture('/assets/effects/smoke_cloud.png'),
      impact: this.loadTexture('/assets/effects/spikes_impact.png'),
      trail: this.loadTexture('/assets/effects/stretch_trail.png'),
    };
    scene.add(this.batch);
  }

  loadTexture(url) {
    if (typeof document === 'undefined') return null;
    const texture = new this.THREE.TextureLoader().load(url);
    texture.needsUpdate = true;
    return texture;
  }

  createTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  update(dt) {
    this.batch.update(dt);
  }

  setQuality(value = 'balanced') {
    this.quality = Object.hasOwn(QUALITY, value) ? value : 'balanced';
    this.qualityProfile = QUALITY[this.quality];
  }

  burst(position, kind, options) {
    const { THREE, quarks } = this;
    // Bajo fuego automático es preferible omitir una partícula secundaria que
    // dejar cientos de sistemas vivos y provocar tirones en el frame principal.
    if (this.active.size >= this.qualityProfile.active) return null;
    const count = clampParticleCount(
      Number(options.count) * this.qualityProfile.particles,
      1,
      options.maxCount || 24,
    );
    const duration = options.duration || 0.06;
    const material = new THREE.MeshBasicMaterial({
      color: options.color,
      map: this.textures[options.texture] || this.texture,
      transparent: true,
      opacity: options.opacity ?? 0.9,
      depthWrite: false,
      blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const tint = new THREE.Color(options.color);
    const system = new quarks.ParticleSystem({
      autoDestroy: true,
      looping: false,
      duration,
      maxParticle: count,
      emissionOverTime: new ConstantValue(0),
      shape: new PointEmitter(),
      startLife: new IntervalValue(options.life[0], options.life[1]),
      startSpeed: new IntervalValue(options.speed[0], options.speed[1]),
      startSize: new IntervalValue(options.size[0], options.size[1]),
      startRotation: new IntervalValue(-Math.PI, Math.PI),
      startColor: new ConstantColor(new Vector4(tint.r, tint.g, tint.b, 1)),
      emissionBursts: [{
        time: 0,
        count: new ConstantValue(count),
        cycle: 1,
        interval: 0,
        probability: 1,
      }],
      material,
      renderMode: quarks.RenderMode.BillBoard,
      worldSpace: true,
      renderOrder: options.renderOrder || 0,
    });
    system.emitter.position.copy(position);
    system.addEventListener('destroy', () => {
      this.active.delete(system);
      material.dispose();
    });
    this.scene.add(system.emitter);
    this.batch.addSystem(system);
    this.active.add(system);
    system.play();
    return system;
  }

  muzzle(position, kind = 'pistol') {
    const color = kind === 'launcher' ? 0xff7b35 : kind === 'sniper' ? 0x9bd4ff : 0xffd66b;
    if (this.qualityProfile.smoke) this.burst(position, 'muzzle', {
      color,
      texture: 'default',
      count: kind === 'shotgun' ? 2 : 1,
      maxCount: 3,
      duration: 0.025,
      life: [0.06, 0.11],
      speed: [0, 0.2],
      size: [0.38, kind === 'shotgun' ? 0.7 : 0.55],
      opacity: 0.95,
    });
    this.burst(position, 'muzzle', {
      color: kind === 'launcher' ? 0xffa347 : 0xffc95a,
      texture: 'default',
      count: kind === 'shotgun' ? 8 : 5,
      maxCount: 12,
      duration: 0.04,
      life: [0.08, 0.18],
      speed: [0.6, kind === 'launcher' ? 2.4 : 1.4],
      size: [0.04, kind === 'shotgun' ? 0.13 : 0.09],
      opacity: 0.9,
    });
    this.burst(position, 'muzzle', {
      color: 0x77716c,
      texture: 'smoke',
      count: kind === 'shotgun' || kind === 'launcher' ? 3 : 1,
      maxCount: 3,
      duration: 0.025,
      life: [0.22, 0.48],
      speed: [0.08, 0.42],
      size: [0.08, kind === 'shotgun' ? 0.24 : 0.17],
      opacity: 0.28,
      additive: false,
    });
  }

  impact(position, color = 0xd8d0b8, count = 5, surface = 'concrete') {
    const profile = impactSurfaceProfile(surface);
    this.burst(position, 'impact', {
      color: surface === 'concrete' ? color : profile.color,
      texture: profile.texture,
      count,
      maxCount: 24,
      duration: 0.04,
      life: profile.life,
      speed: profile.speed,
      size: profile.size,
      opacity: 0.85,
      additive: profile.additive,
    });
    if (surface === 'metal') {
      this.burst(position, 'impact', {
        color: 0xfff1b0,
        texture: 'trail',
        count: Math.min(5, Math.ceil(count / 2)),
        maxCount: 5,
        duration: 0.025,
        life: [0.12, 0.24],
        speed: [2.1, 5.2],
        size: [0.02, 0.055],
        opacity: 0.95,
      });
    }
  }

  explosion(position) {
    this.burst(position, 'explosion', {
      color: 0xfff2c0,
      texture: 'default',
      count: 1,
      maxCount: 1,
      duration: 0.02,
      life: [0.06, 0.11],
      speed: [0, 0.15],
      size: [0.9, 1.35],
      opacity: 1,
    });
    this.burst(position, 'explosion', {
      color: 0xff8b32,
      texture: 'impact',
      count: 18,
      maxCount: 22,
      duration: 0.04,
      life: [0.14, 0.38],
      speed: [1.8, 5.2],
      size: [0.2, 0.62],
      opacity: 0.95,
    });
    this.burst(position, 'explosion', {
      color: 0xffe4a1,
      texture: 'impact',
      count: 5,
      maxCount: 6,
      duration: 0.03,
      life: [0.08, 0.18],
      speed: [0.1, 0.45],
      size: [0.62, 1.05],
      opacity: 0.62,
    });
    this.burst(position, 'explosion', {
      color: 0x706a68,
      texture: 'smoke',
      count: 20,
      maxCount: 24,
      duration: 0.06,
      life: [0.5, 1.05],
      speed: [0.35, 2.1],
      size: [0.42, 0.95],
      opacity: 0.48,
      additive: false,
    });
    this.burst(position, 'explosion', {
      color: 0xffa33e,
      texture: 'default',
      count: 16,
      maxCount: 20,
      duration: 0.05,
      life: [0.25, 0.72],
      speed: [2.8, 6.8],
      size: [0.045, 0.14],
      opacity: 0.95,
    });
  }

  trail(from, to, color = 0xffd66b) {
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const distance = from.distanceTo(to);
    this.burst(midpoint, 'trail', {
      color,
      texture: 'trail',
      count: Math.min(6, Math.max(1, Math.round(distance / 30))),
      maxCount: 6,
      duration: 0.03,
      life: [0.08, 0.2],
      speed: [0.05, 0.3],
      size: [0.02, 0.06],
      opacity: 0.55,
    });
  }
}
