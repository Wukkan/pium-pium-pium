import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import * as QUARKS from '../vendor/three.quarks.module.js';
import * as CORE_THREE from 'three';
import { Effects } from '../src/effects.js';
import { clampParticleCount, effectLifetime, effectProfile, QuarksEffects } from '../src/quarks-effects.js';

test('particle counts stay within the combat budget', () => {
  assert.equal(clampParticleCount(2, 1, 24), 2);
  assert.equal(clampParticleCount(80, 1, 24), 24);
  assert.equal(clampParticleCount(0, 1, 24), 1);
});

test('effect lifetimes are bounded for automatic cleanup', () => {
  assert.equal(effectLifetime('muzzle'), 0.12);
  assert.equal(effectLifetime('explosion'), 0.65);
  assert.equal(effectLifetime('unknown'), 0.35);
});

test('explosions use layered fire, smoke, and ember bursts', () => {
  assert.deepEqual(effectProfile('explosion').layers, ['flash', 'fire', 'shockwave', 'smoke', 'embers']);
});

test('creates an explosion with the installed three.quarks runtime', () => {
  const effects = new QuarksEffects(new THREE.Scene(), THREE, QUARKS);

  assert.doesNotThrow(() => effects.explosion(new THREE.Vector3(0, 0, 0)));
});

test('fallback explosions include a flash, shockwave, smoke, and debris cleanup', () => {
  const scene = new CORE_THREE.Scene();
  const effects = new Effects(scene);

  effects.explosion(new CORE_THREE.Vector3(0, 0, 0));

  assert.equal(effects.items.length, 5);
  assert.ok(scene.children.some((child) => child.geometry?.type === 'RingGeometry'));
  effects.update(1.1);
  assert.equal(effects.items.length, 0);
});

test('quarks explosions also add a visible expanding shockwave mesh', () => {
  const scene = new CORE_THREE.Scene();
  const effects = new Effects(scene, { THREE: CORE_THREE, quarks: QUARKS });

  effects.explosion(new CORE_THREE.Vector3(0, 0, 0));

  assert.ok(scene.children.some((child) => child.geometry?.type === 'RingGeometry'));
});
