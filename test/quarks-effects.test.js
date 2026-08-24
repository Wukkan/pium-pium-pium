import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import * as QUARKS from '../vendor/three.quarks.module.js';
import * as CORE_THREE from 'three';
import {
  classifyImpactSurface,
  effectBudgetCount,
  Effects,
  normalizeEffectQuality,
} from '../src/effects.js';
import {
  clampParticleCount,
  effectLifetime,
  effectProfile,
  impactSurfaceProfile,
  QuarksEffects,
} from '../src/quarks-effects.js';

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

test('combat impacts select a distinct surface treatment', () => {
  assert.equal(classifyImpactSurface(0xcc4444), 'flesh');
  assert.equal(classifyImpactSurface(0xc09858), 'wood');
  assert.equal(classifyImpactSurface(0x555049), 'metal');
  assert.equal(classifyImpactSurface(0xd8d0b8), 'concrete');
  assert.equal(impactSurfaceProfile('metal').additive, true);
  assert.equal(impactSurfaceProfile('flesh').texture, 'smoke');
});

test('quality and classic effect budgets have safe fallbacks', () => {
  assert.equal(normalizeEffectQuality('high'), 'high');
  assert.equal(normalizeEffectQuality('ultra'), 'balanced');
  assert.equal(effectBudgetCount(90, 16), 16);
  assert.equal(effectBudgetCount(0, 16), 1);
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
  const shockwave = scene.children.find((child) => child.userData?.effect === 'shockwave');
  assert.equal(shockwave?.geometry?.type, 'SphereGeometry');
  assert.equal(shockwave?.children.length, 1);
  effects.update(1.1);
  assert.equal(effects.items.length, 0);
});

test('quarks explosions also add a visible expanding shockwave mesh', () => {
  const scene = new CORE_THREE.Scene();
  const effects = new Effects(scene, { THREE: CORE_THREE, quarks: QUARKS });

  effects.explosion(new CORE_THREE.Vector3(0, 0, 0));

  const shockwave = scene.children.find((child) => child.userData?.effect === 'shockwave');
  assert.equal(shockwave?.geometry?.type, 'SphereGeometry');
  assert.equal(shockwave?.children.length, 1);
});

test('low effect quality reduces classic transient objects', () => {
  const scene = new CORE_THREE.Scene();
  const effects = new Effects(scene);
  effects.setQuality('low');
  const origin = new CORE_THREE.Vector3(0, 2, 0);

  for (let i = 0; i < 60; i++) effects.tracer(origin, new CORE_THREE.Vector3(0, 2, -10));

  assert.equal(effects.quality, 'low');
  assert.ok(effects.items.length <= 36);
});

test('high quality muzzle feedback includes flash, smoke, and a bounded casing', () => {
  const scene = new CORE_THREE.Scene();
  const effects = new Effects(scene);
  effects.setQuality('high');

  effects.muzzle(new CORE_THREE.Vector3(0, 2, 0), 'ar');

  assert.equal(effects.items.length, 3);
  assert.ok(scene.children.some((child) => child.geometry?.type === 'CylinderGeometry'));
  effects.update(2);
  assert.equal(effects.items.length, 0);
});
