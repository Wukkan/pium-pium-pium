import test from 'node:test';
import assert from 'node:assert/strict';

import {
  liveWeaponPreviewPose,
  LiveWeaponPreviewManager,
} from '../src/weapon-previews.js';

function browserHarness({ reducedMotion = false, hidden = false } = {}) {
  let nextFrameId = 1;
  const frames = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Set();
  const observerRecords = [];
  const resizeObserverRecords = [];
  const calls = {
    rendererFactories: 0,
    renders: [],
    sizes: [],
    pixelRatios: [],
    dispose: 0,
    contextLoss: 0,
    requestedFrames: 0,
    cancelledFrames: 0,
    observed: [],
    unobserved: [],
    observerDisconnects: 0,
    resizeObserverDisconnects: 0,
  };

  const documentRef = {
    hidden,
    visibilityState: hidden ? 'hidden' : 'visible',
    createElement(tagName) {
      return makeNode(tagName, documentRef);
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of documentListeners.get(type) || []) listener({ type });
    },
  };

  const canvas = makeNode('canvas', documentRef);
  const rendererFactory = () => {
    calls.rendererFactories++;
    return {
      domElement: canvas,
      shadowMap: {},
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 0,
      setPixelRatio(value) { calls.pixelRatios.push(value); },
      setClearColor() {},
      setSize(width, height, updateStyle) { calls.sizes.push([width, height, updateStyle]); },
      clear() {},
      render(scene, camera) { calls.renders.push([scene, camera]); },
      dispose() { calls.dispose++; },
      forceContextLoss() { calls.contextLoss++; },
    };
  };

  const intersectionObserverFactory = (callback) => {
    const record = {
      callback,
      targets: new Set(),
      observe(target) { this.targets.add(target); calls.observed.push(target); },
      unobserve(target) { this.targets.delete(target); calls.unobserved.push(target); },
      disconnect() { this.targets.clear(); calls.observerDisconnects++; },
    };
    observerRecords.push(record);
    return record;
  };

  const resizeObserverFactory = (callback) => {
    const record = {
      callback,
      targets: new Set(),
      observe(target) { this.targets.add(target); },
      unobserve(target) { this.targets.delete(target); },
      disconnect() { this.targets.clear(); calls.resizeObserverDisconnects++; },
    };
    resizeObserverRecords.push(record);
    return record;
  };

  const mediaQuery = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      mediaListeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'change');
      mediaListeners.delete(listener);
    },
    setMatches(matches) {
      this.matches = matches;
      for (const listener of mediaListeners) listener({ matches });
    },
  };

  return {
    calls,
    canvas,
    documentRef,
    mediaQuery,
    observerRecords,
    resizeObserverRecords,
    rendererFactory,
    intersectionObserverFactory,
    resizeObserverFactory,
    matchMedia() { return mediaQuery; },
    requestFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      calls.requestedFrames++;
      return id;
    },
    cancelFrame(id) {
      if (frames.delete(id)) calls.cancelledFrames++;
    },
    flushFrame(time = 16) {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(time);
    },
    pendingFrames() { return frames.size; },
    documentListenerCount() {
      return [...documentListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
    },
    mediaListenerCount() { return mediaListeners.size; },
    makeTarget(width = 320, height = 112) {
      const target = makeNode('span', documentRef);
      target.rect = { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
      return target;
    },
  };
}

function makeNode(tagName, ownerDocument) {
  const listeners = new Map();
  return {
    tagName: String(tagName).toUpperCase(),
    ownerDocument,
    parentNode: null,
    children: [],
    dataset: {},
    attributes: {},
    style: {},
    hidden: false,
    rect: { x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 112, width: 320, height: 112 },
    append(child) { this.appendChild(child); },
    appendChild(child) {
      child.remove?.();
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child.parentNode === this) child.parentNode = null;
      return child;
    },
    remove() { this.parentNode?.removeChild?.(this); },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.dataset[key] = String(value);
      }
    },
    removeAttribute(name) { delete this.attributes[name]; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type, currentTarget: this, target: this });
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
    },
    getBoundingClientRect() { return { ...this.rect }; },
  };
}

function managerFor(harness, options = {}) {
  return new LiveWeaponPreviewManager({
    rendererFactory: harness.rendererFactory,
    intersectionObserverFactory: harness.intersectionObserverFactory,
    resizeObserverFactory: harness.resizeObserverFactory,
    matchMedia: harness.matchMedia,
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
    documentRef: harness.documentRef,
    pixelRatio: 4,
    now: () => 0,
    ...options,
  });
}

function lastPresentation(harness, kind) {
  const scene = harness.calls.renders.at(-1)?.[0];
  return scene?.getObjectByName(`weapon-preview-presentation-${kind}`);
}

test('turntable pose completes a full rotation and reduced motion stays at rest', () => {
  const speed = 0.8;
  const quarter = liveWeaponPreviewPose(Math.PI / (2 * speed), { rotationSpeed: speed });
  const half = liveWeaponPreviewPose(Math.PI / speed, { rotationSpeed: speed });
  const full = liveWeaponPreviewPose((Math.PI * 2) / speed, { rotationSpeed: speed });
  assert.ok(Math.abs(quarter.y - Math.PI / 2) < 1e-10);
  assert.ok(Math.abs(half.y - Math.PI) < 1e-10);
  assert.ok(Math.min(Math.abs(full.y), Math.abs(full.y - Math.PI * 2)) < 1e-10);
  assert.deepEqual(liveWeaponPreviewPose(10, { reducedMotion: true }), { x: 0, y: 0, z: 0 });
});

test('application and system reduced-motion preferences combine without overriding each other', () => {
  const harness = browserHarness({ reducedMotion: true });
  const manager = managerFor(harness, { reducedMotion: false });
  assert.equal(manager.reducedMotion, true, 'the system request wins over an app false value');
  manager.syncPreferences({ renderScale: 0.75 });
  assert.equal(manager.appReducedMotion, false, 'a scale-only update must not persist the system value');
  harness.mediaQuery.setMatches(false);
  assert.equal(manager.reducedMotion, false);
  manager.setReducedMotion(true);
  harness.mediaQuery.setMatches(true);
  harness.mediaQuery.setMatches(false);
  assert.equal(manager.reducedMotion, true, 'the app request survives later system changes');
  manager.setReducedMotion(false);
  assert.equal(manager.reducedMotion, false);
  manager.dispose();
});

test('live gallery uses one WebGL context, exact playable models and a bounded HiDPI framebuffer', () => {
  const harness = browserHarness();
  const manager = managerFor(harness, {
    maxPixelRatio: 1.5,
    maxPixels: 100_000,
    maxDimension: 500,
  });
  const pistolTarget = harness.makeTarget(4000, 2000);
  const rifleTarget = harness.makeTarget(360, 126);
  const pistol = manager.mount(pistolTarget, 'pistol');
  const rifle = manager.mount(rifleTarget, 'ar');

  pistol.activate();
  manager.setVisible(pistol, true);
  manager.tick(0);

  assert.equal(harness.calls.rendererFactories, 1);
  assert.ok(harness.calls.renders.length >= 1);
  const pistolPresentation = lastPresentation(harness, 'pistol');
  const pistolModel = pistolPresentation?.getObjectByName('viewmodel-pistol');
  assert.ok(pistolModel, 'the live scene must contain the model built for gameplay');
  assert.deepEqual(pistolModel.userData.weaponPreview, { kind: 'pistol', source: 'buildGunModel' });
  assert.equal(pistolModel.getObjectByName('first-person-arms'), undefined);

  const [renderWidth, renderHeight] = harness.calls.sizes.at(-1);
  assert.ok(renderWidth <= 500 && renderHeight <= 500);
  assert.ok(renderWidth * renderHeight <= 100_000);

  let disposedGeometry = 0;
  const ownedMesh = pistolModel.children.find((child) => child.isMesh);
  ownedMesh.geometry.addEventListener('dispose', () => { disposedGeometry++; });
  rifle.activate();
  manager.setVisible(rifle, true);
  manager.tick(100);

  assert.equal(harness.calls.rendererFactories, 1, 'switching cards must reuse the same context');
  assert.ok(lastPresentation(harness, 'ar')?.getObjectByName('viewmodel-ar'));
  assert.equal(disposedGeometry, 1, 'the previous active model must release its owned geometry');
  manager.dispose();
});

test('intersection visibility pauses rendering and animation until the active card returns', () => {
  const harness = browserHarness();
  const manager = managerFor(harness);
  const target = harness.makeTarget();
  const handle = manager.mount(target, 'sniper');
  handle.activate();
  manager.tick(0);
  const presentation = lastPresentation(harness, 'sniper');
  assert.ok(presentation);

  const initialRenders = harness.calls.renders.length;
  assert.equal(manager.tick(10), false, '30 FPS cap rejects an early frame');
  assert.equal(harness.calls.renders.length, initialRenders);
  assert.equal(manager.tick(34), true);
  assert.equal(harness.calls.renders.length, initialRenders + 1);

  manager.tick(1000);
  const animatedAngle = presentation.rotation.y;
  assert.notEqual(animatedAngle, 0, 'normal motion rotates the presentation');

  const observer = harness.observerRecords[0];
  assert.equal(observer.targets.has(target), true);
  observer.callback([{ target, isIntersecting: false, intersectionRatio: 0 }]);
  const rendersBeforePause = harness.calls.renders.length;
  const angleBeforePause = presentation.rotation.y;
  manager.tick(2000);
  harness.flushFrame(2100);
  assert.equal(harness.calls.renders.length, rendersBeforePause);
  assert.equal(presentation.rotation.y, angleBeforePause);
  assert.equal(harness.pendingFrames(), 0, 'an offscreen card must not keep a RAF loop alive');

  observer.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]);
  manager.tick(2200);
  assert.ok(harness.calls.renders.length > rendersBeforePause);
  assert.notEqual(presentation.rotation.y, angleBeforePause);
  manager.dispose();
});

test('hover acceleration preserves the current turntable phase without a visual jump', () => {
  const harness = browserHarness();
  const manager = managerFor(harness);
  const target = harness.makeTarget();
  const handle = manager.mount(target, 'ar');
  handle.activate();
  manager.tick(5000);
  const presentation = lastPresentation(harness, 'ar');
  const beforeHover = presentation.rotation.y;

  target.dispatch('pointerenter');
  manager.tick(5034);
  const afterHover = presentation.rotation.y;
  const angularDelta = Math.abs(Math.atan2(
    Math.sin(afterHover - beforeHover),
    Math.cos(afterHover - beforeHover),
  ));

  assert.ok(angularDelta > 0, 'hover must accelerate the next rendered step');
  assert.ok(angularDelta < 0.12, 'speed changes must not recalculate the accumulated phase');
  manager.dispose();
});

test('reduced motion renders a static weapon without scheduling a continuous RAF loop', () => {
  const harness = browserHarness({ reducedMotion: true });
  const manager = managerFor(harness);
  const handle = manager.mount(harness.makeTarget(), 'revolver');
  handle.activate();
  manager.setVisible(handle, true);
  manager.tick(0);
  const presentation = lastPresentation(harness, 'revolver');
  assert.ok(presentation);
  const initialAngle = presentation.rotation.y;
  const renders = harness.calls.renders.length;

  manager.tick(1000);
  harness.flushFrame(1100);
  assert.equal(presentation.rotation.y, initialAngle);
  assert.equal(harness.pendingFrames(), 0);
  assert.ok(harness.calls.renders.length <= renders + 1, 'reduced motion may refresh, but never animate continuously');

  harness.mediaQuery.setMatches(false);
  manager.tick(2000);
  assert.notEqual(presentation.rotation.y, initialAngle, 'animation resumes when the preference changes');
  manager.dispose();
});

test('equipped cards auto-activate and live preferences scale DPR without breaking the budget', () => {
  const harness = browserHarness();
  const manager = managerFor(harness, {
    maxPixelRatio: 4,
    maxPixels: 1_000_000,
    maxDimension: 1200,
    renderScale: 1,
  });
  const target = harness.makeTarget(200, 80);
  const handle = manager.mount(target, 'shotgun', { equipped: true });

  assert.equal(handle.autoActive, true);
  assert.equal(handle.active, true);
  assert.equal(handle.live, true);
  assert.deepEqual(harness.calls.sizes.at(-1).slice(0, 2), [800, 320]);
  assert.ok(harness.pendingFrames() > 0);

  assert.equal(manager.syncPreferences({ reducedMotion: true, renderScale: 0.5 }), true);
  assert.equal(manager.reducedMotion, true);
  assert.equal(manager.renderScale, 0.5);
  assert.deepEqual(harness.calls.sizes.at(-1).slice(0, 2), [400, 160]);
  assert.equal(harness.pendingFrames(), 0);
  assert.equal(manager.sceneEntry.presentation.rotation.y, 0);

  assert.equal(handle.setEquipped(false), true);
  assert.equal(handle.autoActive, false);
  assert.equal(handle.active, false);
  assert.equal(handle.live, false);
  assert.equal(harness.canvas.parentNode, null);
  manager.dispose();
});

test('dispose closes the renderer, context, observer, RAF and DOM listeners exactly once', () => {
  const harness = browserHarness();
  const manager = managerFor(harness);
  const target = harness.makeTarget();
  const handle = manager.mount(target, 'launcher');
  handle.activate();
  manager.setVisible(handle, true);
  manager.tick(0);
  const model = lastPresentation(harness, 'launcher')?.getObjectByName('viewmodel-launcher');
  let disposedGeometry = 0;
  model.children.find((child) => child.isMesh).geometry.addEventListener('dispose', () => { disposedGeometry++; });

  manager.dispose();
  manager.dispose();
  assert.equal(disposedGeometry, 1);
  assert.equal(harness.calls.dispose, 1);
  assert.equal(harness.calls.contextLoss, 1);
  assert.equal(harness.calls.observerDisconnects, 1);
  assert.equal(harness.calls.resizeObserverDisconnects, 1);
  assert.equal(harness.pendingFrames(), 0);
  assert.equal(harness.documentListenerCount(), 0);
  assert.equal(harness.mediaListenerCount(), 0);
  assert.equal(target.listenerCount(), 0);
  assert.equal(harness.canvas.parentNode, null);
  assert.equal(handle.live, false);
});

test('WebGL failure preserves the existing snapshot fallback and does not leak a frame loop', () => {
  const harness = browserHarness();
  const target = harness.makeTarget();
  const fallback = makeNode('img', harness.documentRef);
  fallback.src = 'data:image/png;base64,snapshot';
  target.append(fallback);
  const manager = managerFor(harness, {
    rendererFactory() {
      harness.calls.rendererFactories++;
      throw new Error('WebGL unavailable');
    },
  });
  const handle = manager.mount(target, 'smg');

  assert.doesNotThrow(() => handle.activate());
  assert.equal(target.children.includes(fallback), true);
  assert.equal(fallback.hidden, false);
  assert.equal(handle.live, false);
  assert.equal(harness.pendingFrames(), 0);
  manager.dispose();
});
