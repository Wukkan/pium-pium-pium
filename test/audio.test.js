import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_FLOOR,
  AUDIO_MIX_PROFILE,
  AudioSys,
  clampVoiceLimit,
  PIUM_SHOT_PROFILES,
  piumShotProfile,
  spatialShotMix,
} from '../src/audio.js';

const WEAPON_KINDS = ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];

function automationParam(initialValue = 0) {
  return {
    value: initialValue,
    events: [],
    setValueAtTime(value, time) {
      this.value = value;
      this.events.push({ kind: 'set', value, time });
    },
    linearRampToValueAtTime(value, time) {
      this.value = value;
      this.events.push({ kind: 'linear', value, time });
    },
    exponentialRampToValueAtTime(value, time) {
      this.value = value;
      this.events.push({ kind: 'exponential', value, time });
    },
    setTargetAtTime(value, time, timeConstant) {
      this.value = value;
      this.events.push({ kind: 'target', value, time, timeConstant });
    },
    cancelScheduledValues(time) {
      this.events.push({ kind: 'cancel', time });
    },
    cancelAndHoldAtTime(time) {
      this.events.push({ kind: 'hold', time });
    },
  };
}

function connectable(properties = {}) {
  return {
    connections: [],
    connect(node) {
      this.connections.push(node);
      return node;
    },
    disconnect() {},
    ...properties,
  };
}

function schedulingHarness(currentTime = 4) {
  const sources = [];
  const gains = [];
  const filters = [];
  const destination = connectable({ kind: 'destination' });
  const makeSource = (kind) => connectable({
    kind,
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
      const node = connectable({ kind: 'gain', gain: automationParam(1) });
      gains.push(node);
      return node;
    },
    createBiquadFilter() {
      const node = connectable({
        kind: 'filter',
        frequency: automationParam(),
        Q: automationParam(),
      });
      filters.push(node);
      return node;
    },
  };
  const audio = new AudioSys();
  audio.ctx = ctx;
  audio.master = destination;
  audio.buses = {
    weapons: destination,
    impacts: destination,
    movement: destination,
    ui: destination,
  };
  audio.noiseBuffer = {
    duration: 1.25,
    length: 60000,
    sampleRate: 48000,
  };
  audio._route = () => destination;
  return { audio, ctx, sources, gains, filters, destination };
}

function assertSmoothEnvelope(param, peak, startTime, stopTime, label) {
  const automation = param.events.filter((event) => (
    event.kind === 'set'
    || event.kind === 'linear'
    || event.kind === 'exponential'
    || event.kind === 'target'
  ));
  assert.ok(automation.length >= 3, `${label} needs attack and release automation`);
  assert.equal(automation[0].kind, 'set', `${label} must establish a silent floor first`);
  assert.ok(automation[0].value > 0 && automation[0].value <= AUDIO_FLOOR,
    `${label} must start at the safe audio floor`);
  assert.equal(automation[0].time, startTime);

  const attackIndex = automation.findIndex((event, index) => index > 0
    && Math.abs(event.value - peak) < 1e-9
    && ((event.kind === 'target' && event.time >= startTime && event.timeConstant > 0)
      || (event.kind !== 'target' && event.time > startTime)));
  assert.ok(attackIndex > 0, `${label} must ramp up instead of starting at full gain`);

  const release = automation.slice(attackIndex + 1).find((event) => (
    event.value > 0
    && event.value <= AUDIO_FLOOR
    && event.time > startTime
    && event.time <= stopTime
  ));
  assert.ok(release, `${label} must reach the safe floor before stop`);
}

test('spatial shot mix attenuates and filters distant weapons', () => {
  const near = spatialShotMix({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const far = spatialShotMix({ x: 65, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

  assert.ok(near.gain > far.gain);
  assert.ok(near.cutoff > far.cutoff);
  assert.equal(near.pan, 1);
  assert.ok(far.gain >= 0.035);
});

test('shots are silent at and beyond their maximum audible distance', () => {
  const listener = { x: 0, y: 0, z: 0 };
  const atLimit = spatialShotMix({ x: 80, y: 0, z: 0 }, listener);
  const beyond = spatialShotMix({ x: 160, y: 0, z: 0 }, listener);
  assert.equal(atLimit.gain, 0);
  assert.equal(beyond.gain, 0);

  const audio = new AudioSys();
  let scheduled = 0;
  audio.ctx = {};
  audio._piumTone = () => scheduled++;
  audio._noise = () => scheduled++;
  const mix = audio.shotAt('ar', { x: 80, y: 0, z: 0 }, listener);
  assert.equal(mix.gain, 0);
  assert.equal(scheduled, 0);
});

test('spatial pan follows listener orientation', () => {
  const right = spatialShotMix(
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 0 },
    { x: 1, z: 0 },
  );
  const left = spatialShotMix(
    { x: 0, y: 0, z: -8 },
    { x: 0, y: 0, z: 0 },
    { x: 1, z: 0 },
  );

  assert.equal(right.pan, 1);
  assert.equal(left.pan, -1);
});

test('audio voice budget remains in a performance-safe range', () => {
  assert.equal(clampVoiceLimit(2), 8);
  assert.equal(clampVoiceLimit(30), 30);
  assert.equal(clampVoiceLimit(200), 48);
});

test('every firearm exposes a distinct finite descending PIUM signature', () => {
  assert.deepEqual(Object.keys(PIUM_SHOT_PROFILES).sort(), [...WEAPON_KINDS].sort());
  const signatures = new Set();
  for (const kind of WEAPON_KINDS) {
    const profile = piumShotProfile(kind);
    for (const field of [
      'startHz', 'midHz', 'endHz', 'duration', 'knee', 'gain',
      'noiseDuration', 'noiseHz', 'noiseQ', 'noiseGain', 'variation',
      'filterStartHz', 'filterEndHz',
    ]) assert.ok(Number.isFinite(profile[field]), `${kind}.${field}`);
    assert.ok(profile.startHz > profile.midHz && profile.midHz > profile.endHz, `${kind} must say piu`);
    assert.ok(profile.endHz > 0 && profile.duration > 0 && profile.duration <= 0.25);
    assert.ok(profile.gain > 0 && profile.gain <= 0.6);
    assert.ok(profile.variation >= 0 && profile.variation <= 0.03);
    assert.ok(profile.filterStartHz > profile.filterEndHz && profile.filterEndHz > 0);
    signatures.add(`${profile.startHz}:${profile.midHz}:${profile.endHz}:${profile.duration}`);
  }
  assert.equal(signatures.size, WEAPON_KINDS.length);
  assert.ok(PIUM_SHOT_PROFILES.smg.duration <= 60 / 950, 'SMG PIUM overlaps its next shot');
  assert.equal(piumShotProfile('unknown'), PIUM_SHOT_PROFILES.ar);
});

test('PIUM profiles keep consonants short and leave safe per-shot headroom', () => {
  assert.ok(Number.isFinite(AUDIO_FLOOR) && AUDIO_FLOOR > 0 && AUDIO_FLOOR <= 0.0001);
  for (const kind of WEAPON_KINDS) {
    const profile = PIUM_SHOT_PROFILES[kind];
    assert.equal(Object.isFrozen(profile), true, `${kind} profile must be immutable`);
    assert.ok(profile.noiseDuration <= profile.duration * 0.3, `${kind} noise is too long`);
    assert.ok(profile.noiseGain <= 0.3, `${kind} noise transient is too loud`);
    assert.ok(profile.noiseQ > 0 && profile.noiseQ <= 1.2, `${kind} noise resonance is unsafe`);
    assert.ok(profile.gain + profile.noiseGain <= 0.9, `${kind} lacks per-shot headroom`);
    assert.ok(profile.startHz < 10000 && profile.filterStartHz <= 12000,
      `${kind} exposes excessive high-frequency energy`);
  }
});

test('mix graph provides headroom, compression, and a final safety limiter', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let ctx;
  class FakeAudioContext {
    constructor() {
      ctx = this;
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 100;
      this.destination = connectable({ kind: 'destination' });
      this.gains = [];
      this.compressors = [];
    }

    createGain() {
      const node = connectable({ kind: 'gain', gain: automationParam(1) });
      this.gains.push(node);
      return node;
    }

    createDynamicsCompressor() {
      const node = connectable({
        kind: 'compressor',
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      });
      this.compressors.push(node);
      return node;
    }

    createBuffer(channels, length, sampleRate) {
      return {
        channels,
        duration: length / sampleRate,
        length,
        sampleRate,
        getChannelData() { return new Float32Array(length); },
      };
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
  });
  try {
    const audio = new AudioSys();
    audio.ensure();

    assert.ok(AUDIO_MIX_PROFILE.headroom > 0 && AUDIO_MIX_PROFILE.headroom < 1);
    assert.equal(audio.mix.gain.value, AUDIO_MIX_PROFILE.headroom);
    assert.equal(audio.limiter.threshold.value, AUDIO_MIX_PROFILE.limiterThreshold);
    assert.ok(audio.limiter.threshold.value <= -1 && audio.limiter.threshold.value >= -6);
    assert.ok(audio.limiter.ratio.value >= 12);
    assert.ok(audio.limiter.attack.value > 0 && audio.limiter.attack.value <= 0.003);
    assert.ok(audio.limiter.release.value >= 0.02 && audio.limiter.release.value <= 0.12);

    assert.deepEqual(audio.mix.connections, [audio.compressor]);
    assert.deepEqual(audio.compressor.connections, [audio.limiter]);
    assert.deepEqual(audio.limiter.connections, [audio.master]);
    assert.deepEqual(audio.master.connections, [ctx.destination]);
    for (const bus of Object.values(audio.buses)) assert.deepEqual(bus.connections, [audio.mix]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('unsupported or suspended WebAudio never blocks entering the game', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    const unsupported = new AudioSys();
    assert.equal(unsupported.ensure(), false);
    assert.equal(unsupported.ctx, null);

    const suspended = new AudioSys();
    suspended.ctx = {
      state: 'suspended',
      resume: () => Promise.reject(new Error('autoplay denied')),
    };
    assert.equal(suspended.ensure(), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('shot always schedules the branded PIUM and its consonant through one spatial contract', () => {
  const audio = new AudioSys();
  const calls = [];
  const spatial = { pan: 0.4, cutoff: 7200, gain: 0.65 };
  audio.ctx = {};
  audio.samples = { pistol: { legacy: true } };
  audio._piumTone = (...args) => calls.push(['tone', ...args]);
  audio._noise = (...args) => calls.push(['noise', ...args]);

  audio.shot('pistol', 0.5, spatial);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['tone', PIUM_SHOT_PROFILES.pistol, 0.5, spatial, 3]);
  const [label, duration, frequency, q, gain, decay, options] = calls[1];
  assert.equal(label, 'noise');
  assert.equal(duration, PIUM_SHOT_PROFILES.pistol.noiseDuration);
  assert.equal(frequency, PIUM_SHOT_PROFILES.pistol.noiseHz);
  assert.equal(q, PIUM_SHOT_PROFILES.pistol.noiseQ);
  assert.equal(gain, PIUM_SHOT_PROFILES.pistol.noiseGain * 0.5);
  assert.ok(decay > 0 && decay <= duration);
  assert.deepEqual(options, { bus: 'weapons', spatial, priority: 3 });
});

test('muted, zero, and non-finite shots do not consume audio voices', () => {
  const audio = new AudioSys();
  let scheduled = 0;
  audio.ctx = {};
  audio._piumTone = () => scheduled++;
  audio._noise = () => scheduled++;

  audio.masterVolume = 0;
  audio.shot('ar', 1);
  audio.masterVolume = 0.45;
  audio.shot('ar', 0);
  audio.shot('ar', Number.NaN);
  audio.shot('ar', Number.POSITIVE_INFINITY);
  assert.equal(scheduled, 0);
});

test('muting prevents every low-level sound path from scheduling voices', () => {
  const { audio, sources, gains } = schedulingHarness();
  audio.masterVolume = 0;

  audio.shot('ar');
  audio.hit();
  audio.kill();
  audio.damaged();
  audio.impact('metal');
  audio.reload();
  audio.jump();
  audio.land();
  audio.dry();
  audio.medkit();
  audio.buy();
  audio.streak(4);
  audio.boom();
  audio.nadeThrow();
  audio.knife();
  audio.chat();

  assert.equal(sources.length, 0);
  assert.equal(gains.length, 0);
  assert.equal(audio.activeVoices.size, 0);
});

test('noise voices use click-free attack and release envelopes', () => {
  const { audio, ctx, sources, gains } = schedulingHarness(2.5);
  audio._noise(0.12, 1800, 1.1, 0.4, 0.09, { bus: 'weapons', priority: 3 });

  assert.equal(sources.length, 1);
  assert.equal(gains.length, 1);
  const stopTime = sources[0].stopCalls[0][0];
  assert.ok(stopTime >= ctx.currentTime + 0.12);
  assertSmoothEnvelope(gains[0].gain, 0.4, ctx.currentTime, stopTime, 'noise');
});

test('tone voices use click-free attack and release envelopes', () => {
  const { audio, ctx, sources, gains } = schedulingHarness(3.25);
  audio._tone(900, 700, 0.1, 0.3, 'square', { bus: 'weapons', priority: 2 });

  assert.equal(sources.length, 1);
  assert.equal(gains.length, 1);
  const stopTime = sources[0].stopCalls[0][0];
  assert.ok(stopTime >= ctx.currentTime + 0.1);
  assertSmoothEnvelope(gains[0].gain, 0.3, ctx.currentTime, stopTime, 'tone');
});

test('noise voices start at distinct valid random offsets', () => {
  const { audio, sources } = schedulingHarness(1);
  const originalRandom = Math.random;
  const values = [0.2, 0.8];
  Math.random = () => values.shift() ?? 0.5;
  try {
    audio._noise(0.1, 900, 1, 0.2, 0.08);
    audio._noise(0.1, 900, 1, 0.2, 0.08);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(sources.length, 2);
  const offsets = sources.map((source) => source.startCalls[0][1]);
  for (const offset of offsets) {
    assert.ok(Number.isFinite(offset), 'noise start offset must be explicit and finite');
    assert.ok(offset >= 0);
    assert.ok(offset <= audio.noiseBuffer.duration - 0.1);
  }
  assert.notEqual(offsets[0], offsets[1], 'successive voices must not replay one identical transient');
});

test('voice stealing fades the victim and stops it slightly in the future', () => {
  const { audio, ctx, sources, gains } = schedulingHarness(6);
  audio.maxVoices = 1;

  audio._tone(440, 220, 0.2, 0.35, 'triangle', { priority: 1 });
  const victimEnd = sources[0].stopCalls[0][0];
  audio._tone(660, 330, 0.2, 0.25, 'triangle', { priority: 1 });

  assert.equal(sources.length, 2);
  const fadeStop = sources[0].stopCalls
    .map((args) => args[0])
    .find((time) => Number.isFinite(time) && time > ctx.currentTime && time <= ctx.currentTime + 0.05);
  assert.ok(fadeStop, 'stolen source must not be stopped immediately');
  assert.ok(fadeStop < victimEnd);

  const fadeEvent = gains[0].gain.events.find((event) => (
    (event.kind === 'linear' || event.kind === 'exponential' || event.kind === 'target')
    && event.value > 0
    && event.value <= AUDIO_FLOOR
    && event.time > ctx.currentTime
    && event.time <= fadeStop
  ));
  assert.ok(fadeEvent, 'stolen voice must ramp to the audio floor before stop');
  assert.equal(audio.activeVoices.size, 1);
});

test('leaving combat releases scheduled combat voices but preserves UI audio', () => {
  const { audio, ctx, sources } = schedulingHarness(7);
  audio._tone(500, 350, 0.2, 0.2, 'square', {
    bus: 'weapons', delay: 0.4, priority: 2,
  });
  audio._tone(900, 900, 0.2, 0.2, 'sine', {
    bus: 'ui', delay: 0.4, priority: 2,
  });

  audio.stopCombat();

  assert.equal(audio.activeVoices.size, 1);
  assert.ok(sources[0].stopCalls.some(([time]) => time === ctx.currentTime),
    'future combat audio must be cancelled before it can start');
  assert.equal(sources[1].stopCalls.length, 1,
    'UI audio must keep only its natural scheduled stop');
});

test('PIUM oscillator schedules positive start, vowel, and low tail ramps', () => {
  const frequencyEvents = [];
  const gainEvents = [];
  const filterEvents = [];
  const frequency = {
    setValueAtTime(value, time) { frequencyEvents.push(['set', value, time]); },
    exponentialRampToValueAtTime(value, time) { frequencyEvents.push(['ramp', value, time]); },
  };
  const envelope = {
    setValueAtTime(value, time) { gainEvents.push(['set', value, time]); },
    exponentialRampToValueAtTime(value, time) { gainEvents.push(['ramp', value, time]); },
  };
  const oscillator = {
    frequency,
    connect() { return gainNode; },
    start(time) { this.startedAt = time; },
    stop(time) { this.stoppedAt = time; },
  };
  const gainNode = { gain: envelope, connect(node) { return node; } };
  const vowelFilter = {
    frequency: {
      setValueAtTime(value, time) { filterEvents.push(['set', value, time]); },
      exponentialRampToValueAtTime(value, time) { filterEvents.push(['ramp', value, time]); },
    },
    Q: { value: 0 },
    connect(node) { return node; },
  };
  const audio = new AudioSys();
  audio.ctx = {
    currentTime: 4,
    createOscillator() { return oscillator; },
    createGain() { return gainNode; },
    createBiquadFilter() { return vowelFilter; },
  };
  audio._track = () => true;
  audio._route = () => ({ destination: true });

  assert.equal(audio._piumTone(PIUM_SHOT_PROFILES.ar, 1, { pan: -0.2 }), true);
  assert.equal(frequencyEvents.length, 3);
  assert.ok(frequencyEvents[0][1] > frequencyEvents[1][1]);
  assert.ok(frequencyEvents[1][1] > frequencyEvents[2][1]);
  assert.ok(frequencyEvents.every(([, value]) => value > 0));
  assert.deepEqual(gainEvents.map(([, value]) => value > 0), [true, true, true, true]);
  assert.equal(filterEvents.length, 2);
  assert.ok(filterEvents[0][1] > filterEvents[1][1] && filterEvents[1][1] > 0);
  assert.equal(oscillator.startedAt, 4);
  assert.ok(oscillator.stoppedAt > oscillator.startedAt);
});
