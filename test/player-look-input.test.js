import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Player } from '../src/player.js';

function eventHub() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== callback));
    },
    emit(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

function installInputHarness() {
  const previous = {
    addEventListener: globalThis.addEventListener,
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const windowHub = eventHub();
  const documentHub = eventHub();
  const surfaceHub = eventHub();
  const surface = {
    ...surfaceHub,
    contains(target) { return target === surface; },
    getBoundingClientRect() {
      return { left: 100, top: 50, width: 1000, height: 600 };
    },
  };
  const document = {
    ...documentHub,
    pointerLockElement: null,
    visibilityState: 'visible',
    hidden: false,
  };
  globalThis.addEventListener = windowHub.addEventListener.bind(windowHub);
  globalThis.document = document;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 700;

  const camera = new THREE.PerspectiveCamera();
  const player = new Player(camera, { colliders: [], playerSpawns: [] });
  player.pos.y = 10;

  return {
    camera,
    document,
    player,
    surface,
    emitMouse(event) {
      windowHub.emit('mousemove', { target: surface, movementX: 0, movementY: 0, ...event });
    },
    setPointerLock(element) {
      document.pointerLockElement = element;
      documentHub.emit('pointerlockchange');
    },
    setVisibility(state) {
      document.visibilityState = state;
      document.hidden = state === 'hidden';
      documentHub.emit('visibilitychange');
    },
    blur() { windowHub.emit('blur'); },
    restore() {
      if (previous.addEventListener === undefined) delete globalThis.addEventListener;
      else globalThis.addEventListener = previous.addEventListener;
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
      if (previous.innerWidth === undefined) delete globalThis.innerWidth;
      else globalThis.innerWidth = previous.innerWidth;
      if (previous.innerHeight === undefined) delete globalThis.innerHeight;
      else globalThis.innerHeight = previous.innerHeight;
    },
  };
}

function withInputHarness(assertions) {
  const harness = installInputHarness();
  try {
    assertions(harness);
  } finally {
    harness.restore();
  }
}

test('locked mouse packets can cross repeated full turns without a horizontal stop', () => {
  withInputHarness(({ player, surface, setPointerLock, emitMouse }) => {
    player.sensitivity = 0.0023;
    setPointerLock(surface);
    for (let event = 0; event < 400; event += 1) emitMouse({ movementX: 100 });

    const expected = Math.atan2(Math.sin(-400 * 100 * player.sensitivity), Math.cos(-400 * 100 * player.sensitivity));
    assert.ok(Math.abs(player.yaw - expected) < 1e-10);
    assert.ok(Number.isFinite(player.yaw));
  });
});

test('compatible mouse mode derives motion from absolute coordinates when movementX is stale', () => {
  withInputHarness(({ player, surface, emitMouse }) => {
    player.sensitivity = 0.0023;
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 500, clientY: 350, movementX: 0, movementY: 0 });
    const before = player.yaw;

    // Some browsers report a stale, opposite movementX without Pointer Lock.
    // clientX remains the reliable source in compatible mode.
    emitMouse({ clientX: 530, clientY: 350, movementX: -500, movementY: 400 });
    assert.ok(Math.abs(player.yaw - (before - 30 * player.sensitivity)) < 1e-12);
    assert.equal(player.pitch, 0, 'stale movementY moved the vertical aim despite an unchanged clientY');
  });
});

test('holding the cursor at a fallback edge keeps turning after mousemove events stop', () => {
  withInputHarness(({ player, surface, emitMouse }) => {
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 350 });
    const before = player.yaw;
    for (let frame = 0; frame < 300; frame += 1) player.update(1 / 60, true);
    const afterFiveSeconds = player.yaw;
    assert.ok(Math.abs(Math.atan2(Math.sin(afterFiveSeconds - before), Math.cos(afterFiveSeconds - before))) > 0.1);

    // A second interval must still turn: reaching a screen edge is not a camera limit.
    for (let frame = 0; frame < 300; frame += 1) player.update(1 / 60, true);
    assert.notEqual(player.yaw, afterFiveSeconds);
  });
});

test('reasserting the same fallback session does not interrupt edge turning', () => {
  withInputHarness(({ player, surface, emitMouse }) => {
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 350 });
    const intent = player.fallbackTurnX;
    assert.ok(intent > 0);

    player.setFallbackLook(true, surface);
    assert.equal(player.fallbackTurnX, intent);
    const before = player.yaw;
    player.update(1 / 60, true);
    assert.notEqual(player.yaw, before);
  });
});

test('Pointer Lock loss and recovery reset stale fallback intent without corrupting aim', () => {
  withInputHarness(({ player, surface, emitMouse, setPointerLock }) => {
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 350 });
    assert.ok(player.fallbackTurnX > 0);

    setPointerLock(surface);
    assert.equal(player.fallbackTurnX, 0);
    const beforeLockedMove = player.yaw;
    emitMouse({ movementX: 45, movementY: -10, clientX: 1099, clientY: 350 });
    assert.ok(player.yaw < beforeLockedMove);
    assert.equal(player.fallbackTurnX, 0);

    setPointerLock(null);
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackPointerX, null);
    assert.equal(player.fallbackPointerY, null);
    assert.ok(Number.isFinite(player.yaw));

    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 350 });
    assert.ok(player.fallbackTurnX > 0, 'compatible control did not recover after Pointer Lock loss');
  });
});

test('overlays, canvas leave, and blur cannot leave camera movement latched', () => {
  withInputHarness(({ player, surface, emitMouse, blur }) => {
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 350 });
    assert.ok(player.fallbackTurnX > 0);

    surface.emit('mouseleave');
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackTurnY, 0);

    emitMouse({ clientX: 1099, clientY: 649 });
    assert.ok(player.fallbackTurnX > 0 && player.fallbackTurnY > 0);
    blur();
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackTurnY, 0);

    player.setFallbackLook(false, surface); // same transition used by modal overlays
    const yaw = player.yaw;
    const pitch = player.pitch;
    emitMouse({ clientX: 1099, clientY: 649, movementX: 70, movementY: 70 });
    player.update(1 / 60, true);
    assert.equal(player.yaw, yaw);
    assert.equal(player.pitch, pitch);
  });
});

test('tab visibility, death, and respawn clear fallback edge motion', () => {
  withInputHarness(({ player, surface, emitMouse, setVisibility }) => {
    player.setFallbackLook(true, surface);
    emitMouse({ clientX: 1099, clientY: 649 });
    assert.ok(player.fallbackTurnX > 0 && player.fallbackTurnY > 0);
    setVisibility('hidden');
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackTurnY, 0);

    setVisibility('visible');
    emitMouse({ clientX: 1099, clientY: 649 });
    player.damage(player.maxHealth, 'test');
    assert.equal(player.dead, true);
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackTurnY, 0);

    emitMouse({ clientX: 1099, clientY: 649 });
    assert.equal(player.fallbackTurnX, 0, 'dead player accepted a new edge turn');
    assert.equal(player.fallbackTurnY, 0, 'dead player accepted a new edge turn');
    player.spawn(new THREE.Vector3(2, 3, 4));
    emitMouse({ clientX: 1099, clientY: 649 });
    assert.ok(player.fallbackTurnX > 0 && player.fallbackTurnY > 0);
    player.spawn(new THREE.Vector3(2, 3, 4));
    assert.equal(player.fallbackTurnX, 0);
    assert.equal(player.fallbackTurnY, 0);
    assert.equal(player.fallbackPointerX, null);
    assert.equal(player.fallbackPointerY, null);
  });
});

test('configured sensitivity scales locked and fallback look consistently', () => {
  const measureLocked = (sensitivity) => {
    let rotation = 0;
    withInputHarness(({ player, surface, setPointerLock, emitMouse }) => {
      player.sensitivity = sensitivity;
      setPointerLock(surface);
      emitMouse({ movementX: 20 });
      rotation = Math.abs(player.yaw);
    });
    return rotation;
  };
  const measureFallback = (sensitivity) => {
    let rotation = 0;
    withInputHarness(({ player, surface, emitMouse }) => {
      player.sensitivity = sensitivity;
      player.setFallbackLook(true, surface);
      emitMouse({ clientX: 1099, clientY: 350 });
      const before = player.yaw;
      player.update(1 / 60, true);
      rotation = Math.abs(player.yaw - before);
    });
    return rotation;
  };

  const lowLocked = measureLocked(0.001);
  const highLocked = measureLocked(0.006);
  const lowFallback = measureFallback(0.001);
  const highFallback = measureFallback(0.006);
  assert.ok(Math.abs(highLocked / lowLocked - 6) < EPSILON);
  assert.ok(Math.abs(highFallback / lowFallback - 6) < EPSILON);
});

const EPSILON = 1e-10;
