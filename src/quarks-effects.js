const LIFETIMES = {
  muzzle: 0.12,
  impact: 0.3,
  explosion: 0.65,
  trail: 0.2,
};

export function clampParticleCount(value, min = 1, max = 24) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

export function effectLifetime(kind) {
  return LIFETIMES[kind] || 0.35;
}

function colorVector(THREE, color) {
  const c = new THREE.Color(color);
  return new THREE.Vector4(c.r, c.g, c.b, 1);
}

export class QuarksEffects {
  constructor(scene, THREE, quarks) {
    this.scene = scene;
    this.THREE = THREE;
    this.quarks = quarks;
    this.batch = new quarks.BatchedRenderer();
    this.active = new Set();
    this.texture = this.createTexture();
    scene.add(this.batch);
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

  burst(position, kind, options) {
    const { THREE, quarks } = this;
    const count = clampParticleCount(options.count, 1, options.maxCount || 24);
    const duration = options.duration || 0.06;
    const material = new THREE.MeshBasicMaterial({
      color: options.color,
      map: this.texture,
      transparent: true,
      opacity: options.opacity ?? 0.9,
      depthWrite: false,
      blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const system = new quarks.ParticleSystem({
      autoDestroy: true,
      looping: false,
      duration,
      shape: new quarks.PointEmitter(),
      startLife: new quarks.IntervalValue(options.life[0], options.life[1]),
      startSpeed: new quarks.IntervalValue(options.speed[0], options.speed[1]),
      startSize: new quarks.IntervalValue(options.size[0], options.size[1]),
      startColor: new quarks.ConstantColor(colorVector(THREE, options.color)),
      emissionBursts: [{
        time: 0,
        count: new quarks.ConstantValue(count),
        cycle: 1,
        interval: 0,
        probability: 1,
      }],
      material,
      renderMode: quarks.RenderMode.BillBoard,
      worldSpace: true,
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
    this.burst(position, 'muzzle', {
      color,
      count: kind === 'shotgun' ? 9 : 5,
      maxCount: 12,
      duration: 0.045,
      life: [0.06, 0.16],
      speed: [0.25, kind === 'launcher' ? 1.2 : 0.8],
      size: [0.12, kind === 'shotgun' ? 0.3 : 0.22],
      opacity: 0.95,
    });
  }

  impact(position, color = 0xd8d0b8, count = 5) {
    this.burst(position, 'impact', {
      color,
      count,
      maxCount: 24,
      duration: 0.04,
      life: [0.12, 0.3],
      speed: [0.35, 1.8],
      size: [0.035, 0.11],
      opacity: 0.85,
      additive: false,
    });
  }

  explosion(position) {
    this.burst(position, 'explosion', {
      color: 0xffb347,
      count: 22,
      maxCount: 24,
      duration: 0.05,
      life: [0.2, 0.55],
      speed: [1.5, 5.5],
      size: [0.12, 0.42],
      opacity: 0.9,
    });
    this.burst(position, 'explosion', {
      color: 0x5b5149,
      count: 12,
      maxCount: 16,
      duration: 0.08,
      life: [0.35, 0.7],
      speed: [0.6, 2.5],
      size: [0.18, 0.5],
      opacity: 0.35,
      additive: false,
    });
  }

  trail(from, to, color = 0xffd66b) {
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const distance = from.distanceTo(to);
    this.burst(midpoint, 'trail', {
      color,
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
