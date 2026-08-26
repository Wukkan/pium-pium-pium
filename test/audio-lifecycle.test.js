import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED_AUDIO_EVENTS, AudioSys } from '../src/audio.js';

const audioSource = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const audibleCallSites = [
  mainSource,
  ...['../src/weapons.js', '../src/bots.js', '../src/grenades.js']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')),
].join('\n');

const ALLOWED_ONE_SHOTS = Object.freeze({
  shot: ['pistol', 1],
  shotAt: [
    'pistol',
    { x: 2, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, z: -1 },
    1,
  ],
  boom: [1],
  boomAt: [
    { x: 2, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, z: -1 },
    1,
  ],
  nadeThrow: [],
  weaponSwitch: [],
  jump: [],
  death: [],
  respawn: [],
});

const FORBIDDEN_SFX = Object.freeze([
  'hit',
  'kill',
  'damaged',
  'impact',
  'reload',
  'land',
  'dry',
  'medkit',
  'buy',
  'streak',
  'knife',
  'chat',
]);

function automationParam(initialValue = 0) {
  return {
    value: initialValue,
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  };
}

function connectable(properties = {}) {
  return {
    connections: [],
    connect(node) {
      this.connections.push(node);
      return node;
    },
    ...properties,
  };
}

function oneShotHarness(currentTime = 3) {
  const sources = [];
  const destination = connectable({ kind: 'destination' });
  const makeSource = (kind) => connectable({
    kind,
    loop: false,
    startCalls: [],
    stopCalls: [],
    start(...args) { this.startCalls.push(args); },
    stop(...args) { this.stopCalls.push(args); },
    onended: null,
  });
  const ctx = {
    currentTime,
    sampleRate: 48000,
    destination,
    createBufferSource() {
      const source = makeSource('buffer');
      sources.push(source);
      return source;
    },
    createOscillator() {
      const source = makeSource('oscillator');
      source.frequency = automationParam();
      sources.push(source);
      return source;
    },
    createGain() {
      return connectable({ gain: automationParam(1) });
    },
    createBiquadFilter() {
      return connectable({ frequency: automationParam(), Q: automationParam() });
    },
    createStereoPanner() {
      return connectable({ pan: { value: 0 } });
    },
  };
  const audio = new AudioSys();
  audio.ctx = ctx;
  audio.master = destination;
  audio.buses = {
    weapons: destination,
    grenades: destination,
    movement: destination,
    lifecycle: destination,
  };
  audio.noiseBuffer = { duration: 1.25, length: 60000, sampleRate: 48000 };
  return { audio, ctx, sources };
}

function assertFiniteOneShots(sources, label) {
  assert.ok(sources.length > 0, `${label} must schedule an audible one-shot`);
  for (const source of sources) {
    assert.notEqual(source.loop, true, `${label} must never enable source.loop`);
    assert.equal(source.startCalls.length, 1, `${label} must start each voice exactly once`);
    assert.equal(source.stopCalls.length, 1, `${label} must stop each voice exactly once`);
    const startAt = Number(source.startCalls[0][0]);
    const stopAt = Number(source.stopCalls[0][0]);
    assert.equal(Number.isFinite(startAt), true, `${label} needs a finite start time`);
    assert.equal(Number.isFinite(stopAt), true, `${label} needs a finite stop time`);
    assert.ok(stopAt > startAt, `${label} must stop after it starts`);
  }
}

test('audio initialization is silent and contains no ambient playback primitive', () => {
  assert.doesNotMatch(audioSource, /\bnew\s+Audio\s*\(/);
  assert.doesNotMatch(audioSource, /createMediaElementSource\s*\(/);
  assert.doesNotMatch(audioSource, /\.loop\s*=\s*true\b/);
  assert.doesNotMatch(audioSource, /\bsetInterval\s*\(/);
  assert.doesNotMatch(audioSource, /\brequestAnimationFrame\s*\(/);
  assert.doesNotMatch(indexSource, /<audio\b/i);

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let sourceCreations = 0;
  class SilentContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 100;
      this.destination = connectable();
    }

    createGain() { return connectable({ gain: automationParam(1) }); }
    createDynamicsCompressor() {
      return connectable({
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      });
    }
    createBuffer(channels, length, sampleRate) {
      return {
        channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData() { return new Float32Array(length); },
      };
    }
    createBufferSource() { sourceCreations++; return connectable(); }
    createOscillator() { sourceCreations++; return connectable(); }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: SilentContext },
  });
  try {
    const audio = new AudioSys();
    assert.equal(audio.ensure(), true);
    assert.equal(sourceCreations, 0, 'creating the audio graph must remain completely silent');
    assert.equal(audio.activeVoices.size, 0);
    assert.deepEqual(Object.keys(audio.buses).sort(), [
      'grenades',
      'lifecycle',
      'movement',
      'weapons',
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('a closed or interrupted audio context recovers without trapping the game in silence', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let constructions = 0;
  class RecoveryContext {
    constructor() {
      constructions++;
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 100;
      this.destination = connectable();
    }
    createGain() { return connectable({ gain: automationParam(1) }); }
    createDynamicsCompressor() {
      return connectable({
        threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
        attack: { value: 0 }, release: { value: 0 },
      });
    }
    createBuffer(channels, length, sampleRate) {
      return {
        channels, length, sampleRate, duration: length / sampleRate,
        getChannelData() { return new Float32Array(length); },
      };
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: RecoveryContext },
  });
  try {
    const audio = new AudioSys();
    audio.ctx = { state: 'closed' };
    audio.master = {};
    audio.activeVoices.add({ source: {} });
    assert.equal(audio.ensure(), true);
    assert.equal(constructions, 1);
    assert.equal(audio.ctx.state, 'running');
    assert.equal(audio.activeVoices.size, 0);

    let resumes = 0;
    audio.ctx.state = 'interrupted';
    audio.ctx.resume = async () => { resumes++; };
    assert.equal(audio.ensure(), true);
    await Promise.resolve();
    assert.equal(resumes, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('only the requested gameplay sounds remain audible and every one is one-shot', () => {
  assert.deepEqual(ALLOWED_AUDIO_EVENTS, [
    'shot',
    'shotAt',
    'boom',
    'boomAt',
    'nadeThrow',
    'weaponSwitch',
    'jump',
    'death',
    'respawn',
  ]);
  assert.equal(Object.isFrozen(ALLOWED_AUDIO_EVENTS), true);

  for (const [method, args] of Object.entries(ALLOWED_ONE_SHOTS)) {
    assert.equal(typeof AudioSys.prototype[method], 'function', `${method} must be an explicit audio event`);
    const { audio, sources } = oneShotHarness();
    audio[method](...args);
    assertFiniteOneShots(sources, method);

    for (const source of sources) source.onended?.();
    assert.equal(audio.activeVoices.size, 0, `${method} must release all tracked voices on end`);
  }
});

test('non-requested feedback sounds are silent even if legacy code calls them', () => {
  for (const method of FORBIDDEN_SFX) {
    const { audio, sources } = oneShotHarness();
    audio[method]?.();
    assert.equal(sources.length, 0, `${method} is outside the requested sound set`);
    assert.equal(audio.activeVoices.size, 0, `${method} must not retain a voice`);
  }
});

test('runtime call sites cannot bypass the strict gameplay sound allowlist', () => {
  for (const method of FORBIDDEN_SFX) {
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(
      audibleCallSites,
      new RegExp(`playCombatSound\\(\\s*['\"]${escaped}['\"]|(?:(?:this|ctx)\\.)?audio\\??\\.${escaped}\\s*\\(`),
      `${method} must not have an audible runtime call site`,
    );
  }

  for (const method of Object.keys(ALLOWED_ONE_SHOTS)) {
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      audibleCallSites,
      new RegExp(`playCombatSound\\(\\s*['\"]${escaped}['\"]|(?:(?:this|ctx)\\.)?audio\\??\\.${escaped}\\s*\\(`),
      `${method} must be wired to a real gameplay event`,
    );
  }
});

test('automatic bot firefights remain visual without becoming ambient audio', () => {
  assert.doesNotMatch(mainSource, /const\s+botAudio\s*=/);
  assert.match(mainSource, /new\s+BotManager\([\s\S]{0,120}?null,\s*5\s*\)/);
  assert.match(
    mainSource,
    /if\s*\(m\.bid\s*==\s*null\)\s*playCombatSound\(\s*['"]shotAt['"]/,
  );
});
