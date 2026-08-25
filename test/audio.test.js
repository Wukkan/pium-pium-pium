import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioSys,
  clampVoiceLimit,
  PIUM_SHOT_PROFILES,
  piumShotProfile,
  spatialShotMix,
} from '../src/audio.js';

const WEAPON_KINDS = ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher'];

test('spatial shot mix attenuates and filters distant weapons', () => {
  const near = spatialShotMix({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const far = spatialShotMix({ x: 65, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

  assert.ok(near.gain > far.gain);
  assert.ok(near.cutoff > far.cutoff);
  assert.equal(near.pan, 1);
  assert.ok(far.gain >= 0.035);
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
  assert.deepEqual(calls[0], ['tone', PIUM_SHOT_PROFILES.pistol, 0.5, spatial]);
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
