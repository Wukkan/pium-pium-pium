import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { buildGunModel, WEAPON_DEFS } from '../src/weapons.js';
import {
  buildWeaponOnlyModel,
  captureWeaponPreviewDataUrls,
  createWeaponPreviewModel,
  disposeWeaponPreviewObject,
  mountWeaponPreviews,
  resolveWeaponPreviewSize,
  visibleObjectBounds,
  weaponPreviewFrame,
  WeaponPreviewManager,
  WEAPON_PREVIEW_KINDS,
} from '../src/weapon-previews.js';

function visibleMeshSignature(root) {
  const signature = [];
  root.updateWorldMatrix(true, true);
  root.traverseVisible((object) => {
    if (!object.isMesh) return;
    const parameters = object.geometry?.parameters || {};
    signature.push({
      type: object.geometry?.type,
      parameters: Object.fromEntries(
        Object.entries(parameters)
          .filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      position: object.position.toArray(),
      rotation: object.rotation.toArray().slice(0, 3),
      scale: object.scale.toArray(),
      material: object.material?.type,
      color: object.material?.color?.getHex(),
    });
  });
  return signature;
}

function fakeDom() {
  const images = [];
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'img');
      const image = {
        tagName: 'IMG',
        className: '',
        style: {},
        src: '',
        alt: '',
        hidden: false,
        remove() { image.removed = true; },
      };
      images.push(image);
      return image;
    },
  };
  const makeHost = (kind = null) => ({
    ownerDocument: documentRef,
    dataset: kind ? { weaponPreview: kind } : {},
    attributes: {},
    children: [],
    append(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  return { images, makeHost };
}

function fakeRendererHarness() {
  const calls = { render: [], sizes: [], clear: 0, dispose: 0, contextLoss: 0, factories: 0, dataUrls: [] };
  const rendererFactory = () => {
    calls.factories++;
    return {
      domElement: {
        toDataURL(type, quality) {
          calls.dataUrls.push([type, quality]);
          return `data:${type};base64,preview-${calls.render.length}`;
        },
      },
      shadowMap: {},
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 0,
      setPixelRatio(value) { calls.pixelRatio = value; },
      setClearColor(color, alpha) { calls.clearColor = [color, alpha]; },
      setSize(...args) { calls.sizes.push(args); },
      clear() { calls.clear++; },
      render(...args) { calls.render.push(args); },
      dispose() { calls.dispose++; },
      forceContextLoss() { calls.contextLoss++; },
    };
  };
  return { calls, rendererFactory };
}

test('weapon-only models keep exact playable meshes and physically remove viewmodel extras', () => {
  assert.deepEqual(WEAPON_PREVIEW_KINDS, Object.keys(WEAPON_DEFS));
  for (const kind of WEAPON_PREVIEW_KINDS) {
    const playable = buildGunModel(kind);
    playable.userData.viewmodel.arms.root.visible = false;
    playable.userData.flash.visible = false;
    const preview = buildWeaponOnlyModel(kind);

    assert.equal(preview.name, playable.name);
    assert.equal(preview.userData.viewmodel.kind, kind);
    assert.equal(preview.userData.weaponPreview.source, 'buildGunModel');
    assert.equal(preview.userData.viewmodel.arms, null);
    assert.equal(preview.userData.flash, null);
    assert.equal(preview.userData.muzzleLight, null);
    assert.equal(preview.getObjectByName('first-person-arms'), undefined);
    assert.equal(preview.getObjectByName('muzzle-light'), undefined);
    assert.equal(preview.children.some((child) => child.isSprite || child.isLight), false);
    assert.deepEqual(visibleMeshSignature(preview), visibleMeshSignature(playable), `${kind}: model drift`);

    disposeWeaponPreviewObject(playable);
    disposeWeaponPreviewObject(preview);
  }
});

test('weapon-only construction calls the source contract and protects shared sprite geometry', () => {
  const received = [];
  let spriteGeometryDisposals = 0;
  let spriteMaterialDisposals = 0;
  const model = createWeaponPreviewModel('smg', {
    modelFactory(kind) {
      received.push(kind);
      const playable = buildGunModel(kind);
      playable.userData.flash.geometry.addEventListener('dispose', () => { spriteGeometryDisposals++; });
      playable.userData.flash.material.addEventListener('dispose', () => { spriteMaterialDisposals++; });
      return playable;
    },
  });
  assert.deepEqual(received, ['smg']);
  assert.equal(spriteGeometryDisposals, 0, 'Sprite geometry belongs to Three.js and must stay shared');
  assert.equal(spriteMaterialDisposals, 1, 'the per-model flash material is owned and released');
  assert.throws(() => createWeaponPreviewModel('admin-rifle'), /Arma desconocida/);
  assert.throws(() => createWeaponPreviewModel('pistol', { modelFactory: () => ({}) }), /Object3D/);
  disposeWeaponPreviewObject(model);
});

test('visible bounds are finite and long guns project wide from the +X camera', () => {
  for (const kind of WEAPON_PREVIEW_KINDS) {
    const model = buildWeaponOnlyModel(kind);
    const bounds = visibleObjectBounds(model);
    const size = bounds.getSize(new THREE.Vector3());
    assert.equal(bounds.isEmpty(), false);
    assert.ok(size.x > 0 && size.y > 0 && size.z > 0, `${kind}: non-zero volume`);
    assert.ok([...size.toArray(), ...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
    assert.ok(size.x < 0.3, `${kind}: detached arms must not inflate weapon depth`);
    if (kind === 'shotgun' || kind === 'sniper') {
      assert.ok(size.z > size.y * 3.5, `${kind}: longitudinal Z must dominate projected height`);
    }
    disposeWeaponPreviewObject(model);
  }
  assert.throws(() => visibleObjectBounds(new THREE.Group()), /no contiene geometría visible/);
});

test('render size caps DPR, maximum dimension and total pixel budget', () => {
  const normal = resolveWeaponPreviewSize({ width: 240, height: 96, pixelRatio: 2, maxPixelRatio: 1.5 });
  assert.deepEqual(
    { width: normal.width, height: normal.height, aspect: normal.aspect },
    { width: 360, height: 144, aspect: 2.5 },
  );
  assert.equal(normal.pixelRatio, 1.5);

  const huge = resolveWeaponPreviewSize({
    width: 4000, height: 2000, pixelRatio: 4, maxPixelRatio: 2,
    maxPixels: 100_000, maxDimension: 500,
  });
  assert.ok(huge.width <= 500 && huge.height <= 500);
  assert.ok(huge.width * huge.height <= 100_000);
  assert.ok(Math.abs(huge.aspect - 2) < 0.01);
  assert.equal(resolveWeaponPreviewSize({ width: 0, height: NaN, pixelRatio: -1 }).width > 0, true);
});

test('orthographic framing preserves aspect and encloses wide and tall models', () => {
  const wide = weaponPreviewFrame(new THREE.Vector3(2, 0.5, 0.2), 2, 1.2);
  assert.equal(wide.right - wide.left, (wide.top - wide.bottom) * 2);
  assert.ok(wide.right - wide.left >= 2 * 1.2 - Number.EPSILON);
  assert.ok(wide.cameraZ > 0 && wide.far > wide.cameraZ && wide.near > 0);

  const tall = weaponPreviewFrame(new THREE.Vector3(0.5, 2, 0.2), 3, 1.1);
  assert.ok(tall.top - tall.bottom >= 2 * 1.1 - Number.EPSILON);
  assert.equal(tall.right, -tall.left);
  assert.equal(tall.top, -tall.bottom);
});

test('capture renders each cache miss once with one renderer and releases all ownership', () => {
  const renderer = fakeRendererHarness();
  const cache = new Map([['pistol', 'data:image/png;base64,already-cached']]);
  const built = [];
  const result = captureWeaponPreviewDataUrls({
    kinds: ['pistol', 'ar', 'sniper', 'ar'],
    cache,
    rendererFactory: renderer.rendererFactory,
    modelFactory(kind) {
      const model = buildGunModel(kind);
      built.push(model);
      return model;
    },
    pixelRatio: 2,
    width: 220,
    height: 88,
  });
  assert.equal(result, cache);
  assert.equal(renderer.calls.factories, 1);
  assert.equal(renderer.calls.render.length, 2, 'cached pistol and duplicate ar are not rendered');
  assert.equal(renderer.calls.sizes.length, 1, 'one framebuffer serves the complete batch');
  assert.equal(renderer.calls.dispose, 1);
  assert.equal(renderer.calls.contextLoss, 1);
  assert.equal(renderer.calls.render.every(([, camera]) => camera.position.x > 0 && camera.position.y === 0 && camera.position.z === 0), true);
  assert.equal(built.every((model) => model.parent === null), true, 'temporary models are detached after capture');
  assert.match(cache.get('ar'), /^data:image\/png/);
  assert.match(cache.get('sniper'), /^data:image\/png/);

  captureWeaponPreviewDataUrls({ kinds: ['pistol', 'ar', 'sniper'], cache, rendererFactory: renderer.rendererFactory });
  assert.equal(renderer.calls.factories, 1, 'a complete cache allocates no WebGL context');
  assert.throws(() => captureWeaponPreviewDataUrls({ kinds: ['knife'], cache }), /Arma desconocida/);
  assert.throws(() => captureWeaponPreviewDataUrls({ cache: {} }), /cache debe ser un Map/);
});

test('manager preloads once, mounts cached images and reuses URLs across menus', () => {
  const dom = fakeDom();
  const calls = [];
  const capture = ({ kinds, cache }) => {
    calls.push([...kinds]);
    for (const kind of kinds) if (!cache.has(kind)) cache.set(kind, `data:image/png;base64,${kind}`);
    return cache;
  };
  const manager = new WeaponPreviewManager({ capture });
  const first = manager.mount(dom.makeHost(), 'pistol');
  const duplicate = manager.mount(dom.makeHost(), 'pistol');
  const rifle = manager.mount(dom.makeHost(), 'ar');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], WEAPON_PREVIEW_KINDS);
  assert.equal(first.available && duplicate.available && rifle.available, true);
  assert.equal(first.image.src, duplicate.image.src, 'both menus share one cached image');
  assert.match(first.image.alt, /PISTOLA/);
  assert.equal(first.setWeapon('shotgun'), true);
  assert.equal(first.kind, 'shotgun');
  assert.match(first.image.src, /shotgun$/);
  assert.equal(first.setWeapon('shotgun'), false);
  assert.equal(calls.length, 1, 'switching uses cache without rendering');

  assert.equal(first.dispose(), true);
  assert.equal(first.dispose(), false);
  assert.equal(first.image.removed, true);
  duplicate.dispose();
  rifle.dispose();
  manager.dispose();
  manager.dispose();
});

test('manager leaves existing fallback content untouched when WebGL is unavailable', () => {
  const dom = fakeDom();
  const host = dom.makeHost();
  const manager = new WeaponPreviewManager({ capture() { throw new Error('WebGL unavailable'); } });
  const handle = manager.mount(host, 'sniper');
  assert.equal(handle.available, false);
  assert.equal(handle.image, null);
  assert.equal(host.children.length, 0);
  assert.equal(host.dataset.weaponPreviewState, 'fallback');
  assert.match(manager.lastError.message, /WebGL unavailable/);
  manager.dispose();
});

test('gallery helper mounts declarative targets and leaves an injected manager alive', () => {
  const dom = fakeDom();
  const manager = new WeaponPreviewManager({
    capture({ kinds, cache }) {
      for (const kind of kinds) cache.set(kind, `data:image/png;base64,${kind}`);
    },
  });
  const targets = [dom.makeHost('pistol'), dom.makeHost('sniper')];
  const root = { querySelectorAll(selector) { assert.equal(selector, '[data-weapon-preview]'); return targets; } };
  const gallery = mountWeaponPreviews(root, { manager });
  assert.deepEqual(gallery.handles.map((handle) => handle.kind), ['pistol', 'sniper']);
  gallery.dispose();
  assert.equal(manager.disposed, false);
  manager.dispose();
});
