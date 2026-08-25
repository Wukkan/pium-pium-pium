// ---------------------------------------------------------------------------
// Mezcla de combate con WebAudio. Los disparos usan una firma procedural
// original: ataque consonante, barrido tonal "piu" y cola grave "m".
// ---------------------------------------------------------------------------

export const MAX_AUDIO_VOICES = 28;
export const AUDIO_FLOOR = 0.00001;
export const AUDIO_MIX_PROFILE = Object.freeze({
  headroom: 0.72,
  compressorThreshold: -10,
  compressorKnee: 10,
  compressorRatio: 4,
  compressorAttack: 0.004,
  compressorRelease: 0.12,
  limiterThreshold: -2,
  limiterRatio: 20,
  limiterAttack: 0.001,
  limiterRelease: 0.055,
});

const freezePiumProfile = (profile) => Object.freeze(profile);

export const PIUM_SHOT_PROFILES = Object.freeze({
  pistol: freezePiumProfile({
    startHz: 1850, midHz: 760, endHz: 170, duration: 0.115, knee: 0.34,
    gain: 0.38, noiseDuration: 0.014, noiseHz: 3400, noiseQ: 1, noiseGain: 0.1,
    filterStartHz: 7200, filterEndHz: 1500, wave: 'triangle', variation: 0.024,
  }),
  shotgun: freezePiumProfile({
    startHz: 1050, midHz: 420, endHz: 65, duration: 0.16, knee: 0.32,
    gain: 0.5, noiseDuration: 0.042, noiseHz: 900, noiseQ: 0.8, noiseGain: 0.24,
    filterStartHz: 4200, filterEndHz: 850, wave: 'triangle', variation: 0.018,
  }),
  smg: freezePiumProfile({
    startHz: 2100, midHz: 1050, endHz: 260, duration: 0.058, knee: 0.32,
    gain: 0.25, noiseDuration: 0.009, noiseHz: 4200, noiseQ: 1.15, noiseGain: 0.065,
    filterStartHz: 9000, filterEndHz: 2500, wave: 'triangle', variation: 0.026,
  }),
  ar: freezePiumProfile({
    startHz: 1650, midHz: 680, endHz: 135, duration: 0.1, knee: 0.34,
    gain: 0.34, noiseDuration: 0.016, noiseHz: 2600, noiseQ: 0.9, noiseGain: 0.12,
    filterStartHz: 7600, filterEndHz: 1300, wave: 'triangle', variation: 0.022,
  }),
  sniper: freezePiumProfile({
    startHz: 1400, midHz: 460, endHz: 48, duration: 0.22, knee: 0.28,
    gain: 0.55, noiseDuration: 0.045, noiseHz: 650, noiseQ: 0.7, noiseGain: 0.27,
    filterStartHz: 6000, filterEndHz: 700, wave: 'triangle', variation: 0.014,
  }),
  revolver: freezePiumProfile({
    startHz: 1550, midHz: 540, endHz: 80, duration: 0.16, knee: 0.3,
    gain: 0.47, noiseDuration: 0.032, noiseHz: 1500, noiseQ: 0.8, noiseGain: 0.19,
    filterStartHz: 8200, filterEndHz: 1200, wave: 'triangle', variation: 0.018,
  }),
  launcher: freezePiumProfile({
    startHz: 780, midHz: 260, endHz: 42, duration: 0.24, knee: 0.3,
    gain: 0.56, noiseDuration: 0.052, noiseHz: 420, noiseQ: 0.65, noiseGain: 0.3,
    filterStartHz: 3200, filterEndHz: 600, wave: 'sine', variation: 0.012,
  }),
});

export function piumShotProfile(kind = 'ar') {
  return PIUM_SHOT_PROFILES[kind] || PIUM_SHOT_PROFILES.ar;
}

export function spatialShotMix(source, listener, forward = { x: 0, z: -1 }, maxDistance = 80) {
  const dx = Number(source?.x || 0) - Number(listener?.x || 0);
  const dy = Number(source?.y || 0) - Number(listener?.y || 0);
  const dz = Number(source?.z || 0) - Number(listener?.z || 0);
  const distance = Math.hypot(dx, dy, dz);
  const normalized = Math.min(1, Math.max(0, distance / Math.max(1, maxDistance)));
  const baseGain = 1 / (1 + (distance / 18) ** 1.65);
  const gain = distance >= maxDistance ? 0 : baseGain * Math.max(0, 1 - normalized ** 4);
  const fx = Number(forward?.x || 0);
  const fz = Number(forward?.z ?? -1);
  const fLength = Math.hypot(fx, fz) || 1;
  const horizontal = Math.hypot(dx, dz) || 1;
  const rightX = -fz / fLength;
  const rightZ = fx / fLength;
  const pan = Math.max(-1, Math.min(1, (dx / horizontal) * rightX + (dz / horizontal) * rightZ));
  return {
    distance,
    gain,
    pan,
    cutoff: Math.max(1500, 15000 - normalized * 12800),
  };
}

export function clampVoiceLimit(value) {
  return Math.min(48, Math.max(8, Math.round(Number(value) || MAX_AUDIO_VOICES)));
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.masterVolume = 0.45;
    this.noiseBuffer = null;
    this.mix = null;
    this.compressor = null;
    this.limiter = null;
    this.buses = null;
    this.activeVoices = new Set();
    this.maxVoices = MAX_AUDIO_VOICES;
    this.voiceSerial = 0;
    this.lastImpactAt = Number.NEGATIVE_INFINITY;
    this.lastHitAt = Number.NEGATIVE_INFINITY;
    this.lastKillAt = Number.NEGATIVE_INFINITY;
    this.lastDryAt = Number.NEGATIVE_INFINITY;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.mix = this.ctx.createGain();
    this.mix.gain.value = AUDIO_MIX_PROFILE.headroom;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = AUDIO_MIX_PROFILE.compressorThreshold;
    this.compressor.knee.value = AUDIO_MIX_PROFILE.compressorKnee;
    this.compressor.ratio.value = AUDIO_MIX_PROFILE.compressorRatio;
    this.compressor.attack.value = AUDIO_MIX_PROFILE.compressorAttack;
    this.compressor.release.value = AUDIO_MIX_PROFILE.compressorRelease;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = AUDIO_MIX_PROFILE.limiterThreshold;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = AUDIO_MIX_PROFILE.limiterRatio;
    this.limiter.attack.value = AUDIO_MIX_PROFILE.limiterAttack;
    this.limiter.release.value = AUDIO_MIX_PROFILE.limiterRelease;
    this.mix.connect(this.compressor).connect(this.limiter).connect(this.master).connect(this.ctx.destination);

    this.buses = {
      weapons: this.ctx.createGain(),
      impacts: this.ctx.createGain(),
      movement: this.ctx.createGain(),
      ui: this.ctx.createGain(),
    };
    this.buses.weapons.gain.value = 0.92;
    this.buses.impacts.gain.value = 0.82;
    this.buses.movement.gain.value = 0.72;
    this.buses.ui.gain.value = 0.78;
    for (const bus of Object.values(this.buses)) bus.connect(this.mix);

    const len = Math.ceil(this.ctx.sampleRate * 1.25);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  }

  setMasterVolume(value) {
    this.masterVolume = Math.min(1, Math.max(0, Number(value) || 0));
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.masterVolume, t, 0.012);
      if (this.masterVolume === 0) {
        for (const voice of this.activeVoices) this._releaseVoice(voice, 0.012);
        this.activeVoices.clear();
      }
    }
  }

  setVoiceLimit(value) {
    this.maxVoices = clampVoiceLimit(value);
  }

  stopCombat(fade = 0.01) {
    for (const voice of [...this.activeVoices]) {
      if (voice.bus === 'ui') continue;
      this._releaseVoice(voice, fade);
      this.activeVoices.delete(voice);
    }
  }

  _releaseVoice(voice, fade = 0.006) {
    if (!voice?.source) return;
    const now = Number(this.ctx?.currentTime) || 0;
    const release = Math.max(0.003, Number(fade) || 0.006);
    try {
      const param = voice.envelope?.gain;
      if (param && voice.startAt <= now + 0.001) {
        if (typeof param.cancelAndHoldAtTime === 'function') {
          param.cancelAndHoldAtTime(now);
        } else {
          if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
          if (typeof param.setValueAtTime === 'function') {
            const current = Math.max(
              AUDIO_FLOOR,
              Math.min(1.2, Number.isFinite(Number(param.value)) ? Number(param.value) : AUDIO_FLOOR),
            );
            param.setValueAtTime(current, now);
          }
        }
        if (typeof param.linearRampToValueAtTime === 'function') {
          param.linearRampToValueAtTime(AUDIO_FLOOR, now + release);
        } else if (typeof param.setTargetAtTime === 'function') {
          param.setTargetAtTime(AUDIO_FLOOR, now, release / 3);
        }
        voice.source.stop(now + release + 0.002);
      } else {
        voice.source.stop(now);
      }
    } catch {
      try { voice.source.stop(); } catch { /* ya finalizó */ }
    }
  }

  _track(source, priority = 1, options = {}) {
    if (this.activeVoices.size >= this.maxVoices) {
      let oldest = null;
      for (const voice of this.activeVoices) {
        if (!oldest || voice.priority < oldest.priority
          || (voice.priority === oldest.priority && voice.serial < oldest.serial)) oldest = voice;
      }
      if (!oldest || oldest.priority > priority) return false;
      this._releaseVoice(oldest);
      this.activeVoices.delete(oldest);
    }
    const voice = {
      source,
      priority,
      serial: this.voiceSerial++,
      envelope: options.envelope || null,
      bus: options.bus || 'ui',
      startAt: Number.isFinite(Number(options.startAt))
        ? Number(options.startAt)
        : (Number(this.ctx?.currentTime) || 0),
    };
    this.activeVoices.add(voice);
    const priorEnded = source.onended;
    source.onended = (...args) => {
      this.activeVoices.delete(voice);
      if (typeof priorEnded === 'function') priorEnded.apply(source, args);
    };
    return true;
  }

  _route(busName = 'ui', spatial = null) {
    const bus = this.buses?.[busName] || this.master;
    if (!spatial) return bus;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const safeNyquist = Math.max(1200, (Number(this.ctx.sampleRate) || 48000) * 0.45);
    filter.frequency.value = Math.max(1200, Math.min(safeNyquist, Number(spatial.cutoff) || safeNyquist));
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, spatial.pan || 0));
      filter.connect(panner).connect(bus);
    } else {
      filter.connect(bus);
    }
    return filter;
  }

  _noise(duration, filterFreq, filterQ, gain, decay, options = {}) {
    if (!this.ctx || !this.noiseBuffer || this.masterVolume <= 0) return false;
    const safeDuration = Math.max(
      0.006,
      Math.min(Number(this.noiseBuffer.duration) || 1.25, Number(duration) || 0.01),
    );
    const safeGain = Math.max(0, Math.min(1.2, Number(gain) || 0));
    if (safeGain <= 0) return false;
    const t = this.ctx.currentTime + Math.max(0, Number(options.delay) || 0);
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const maxFrequency = Math.max(1200, (Number(this.ctx.sampleRate) || 48000) * 0.45);
    filter.frequency.value = Math.max(20, Math.min(maxFrequency, Number(filterFreq) || 1000));
    filter.Q.value = Math.max(0.1, Math.min(30, Number(filterQ) || 1));
    const g = this.ctx.createGain();
    if (!this._track(src, options.priority ?? 1, {
      envelope: g, startAt: t, bus: options.bus || 'ui',
    })) return false;
    src.buffer = this.noiseBuffer;
    const attack = Math.max(0.001, Math.min(0.003, safeDuration * 0.18));
    const requestedDecay = Math.max(attack + 0.001, Number(decay) || safeDuration * 0.8);
    const releaseAt = Math.min(safeDuration - 0.002, requestedDecay);
    g.gain.setValueAtTime(AUDIO_FLOOR, t);
    g.gain.linearRampToValueAtTime(safeGain, t + attack);
    g.gain.exponentialRampToValueAtTime(AUDIO_FLOOR, t + Math.max(attack + 0.001, releaseAt));
    src.connect(filter).connect(g).connect(this._route(options.bus || 'ui', options.spatial));
    const tail = 0.003;
    const maxOffset = Math.max(0, (Number(this.noiseBuffer.duration) || safeDuration) - safeDuration - tail);
    const offset = Math.random() * maxOffset;
    src.start(t, offset);
    src.stop(t + safeDuration + tail);
    return true;
  }

  _tone(freq, endFreq, duration, gain, type = 'square', options = {}) {
    if (!this.ctx || this.masterVolume <= 0) return false;
    const safeDuration = Math.max(0.008, Math.min(2, Number(duration) || 0.04));
    const safeGain = Math.max(0, Math.min(1.2, Number(gain) || 0));
    if (safeGain <= 0) return false;
    const t = this.ctx.currentTime + Math.max(0, Number(options.delay) || 0);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const startFrequency = Math.max(1, Math.min(20000, Number(freq) || 440));
    const finishFrequency = Math.max(1, Math.min(20000, Number(endFreq) || startFrequency));
    osc.frequency.setValueAtTime(startFrequency, t);
    if (finishFrequency !== startFrequency) {
      osc.frequency.exponentialRampToValueAtTime(finishFrequency, t + safeDuration);
    }
    const g = this.ctx.createGain();
    if (!this._track(osc, options.priority ?? 1, {
      envelope: g, startAt: t, bus: options.bus || 'ui',
    })) return false;
    const attack = Math.max(0.002, Math.min(0.004, safeDuration * 0.16));
    g.gain.setValueAtTime(AUDIO_FLOOR, t);
    g.gain.linearRampToValueAtTime(safeGain, t + attack);
    g.gain.exponentialRampToValueAtTime(AUDIO_FLOOR, t + safeDuration);
    osc.connect(g).connect(this._route(options.bus || 'ui', options.spatial));
    osc.start(t);
    osc.stop(t + safeDuration + 0.003);
    return true;
  }

  _piumTone(profile, volume, spatial = null, priority = 3) {
    if (!this.ctx || this.masterVolume <= 0) return false;
    const safeGain = Math.max(0, Number(profile?.gain) || 0) * volume;
    if (safeGain <= 0) return false;
    const t = this.ctx.currentTime;
    const duration = Math.max(0.04, Number(profile.duration) || 0.1);
    const knee = Math.max(0.18, Math.min(0.6, Number(profile.knee) || 0.34));
    const variation = Math.max(0, Math.min(0.03, Number(profile.variation) || 0));
    const pitchScale = 1 + (Math.random() * 2 - 1) * variation;
    const startHz = Math.max(1, profile.startHz * pitchScale);
    const midHz = Math.max(1, profile.midHz * pitchScale);
    const endHz = Math.max(1, profile.endHz * pitchScale);
    const attack = Math.min(0.006, duration * 0.08);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (!this._track(osc, priority, { envelope: gain, startAt: t, bus: 'weapons' })) return false;

    osc.type = profile.wave || 'triangle';
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(midHz, t + duration * knee);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + duration);

    gain.gain.setValueAtTime(AUDIO_FLOOR, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(AUDIO_FLOOR, safeGain), t + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(AUDIO_FLOOR, safeGain * 0.2), t + duration * 0.68);
    gain.gain.exponentialRampToValueAtTime(AUDIO_FLOOR, t + duration);
    const vowelFilter = this.ctx.createBiquadFilter();
    vowelFilter.type = 'lowpass';
    vowelFilter.Q.value = 0.72;
    const maxFrequency = Math.max(1200, (Number(this.ctx.sampleRate) || 48000) * 0.45);
    vowelFilter.frequency.setValueAtTime(Math.max(1, Math.min(maxFrequency, profile.filterStartHz)), t);
    vowelFilter.frequency.exponentialRampToValueAtTime(
      Math.max(1, Math.min(maxFrequency, profile.filterEndHz)),
      t + duration,
    );
    osc.connect(gain).connect(vowelFilter).connect(this._route('weapons', spatial));
    osc.start(t);
    osc.stop(t + duration + 0.005);
    return true;
  }

  shot(kind = 'ar', volume = 1, spatial = null, priority = 3) {
    if (!this.ctx) return;
    const numericVolume = Number(volume);
    const safeVolume = Number.isFinite(numericVolume)
      ? Math.max(0, Math.min(1.2, numericVolume))
      : 0;
    if (safeVolume <= 0 || this.masterVolume <= 0) return;
    const distanceSpatial = spatial || (safeVolume < 0.98
      ? { pan: 0, cutoff: 1800 + safeVolume * 12000 }
      : null);
    const profile = piumShotProfile(kind);
    const safePriority = Math.max(1, Math.min(5, Math.round(Number(priority) || 3)));
    this._piumTone(profile, safeVolume, distanceSpatial, safePriority);
    this._noise(
      profile.noiseDuration,
      profile.noiseHz,
      profile.noiseQ,
      profile.noiseGain * safeVolume,
      Math.min(profile.noiseDuration * 0.82, profile.duration * 0.38),
      { bus: 'weapons', spatial: distanceSpatial, priority: safePriority },
    );
  }

  shotAt(kind, source, listener, forward = { x: 0, z: -1 }, volume = 1) {
    const mix = spatialShotMix(source, listener, forward);
    if (mix.gain > 0.001) {
      this.shot(kind, mix.gain * Math.max(0, Number(volume) || 0), mix, 2);
    }
    return mix;
  }

  hit(critical = false) {
    if (!this.ctx || this.masterVolume <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHitAt < 0.025) return;
    this.lastHitAt = now;
    const pitch = critical ? 1760 : 1420;
    this._tone(pitch, critical ? 1320 : 1080, 0.055, critical ? 0.3 : 0.22, 'sine', { bus: 'impacts', priority: 4 });
    this._noise(0.035, critical ? 2600 : 2100, 2.4, 0.075, 0.028, { bus: 'impacts', priority: 4 });
  }

  kill() {
    if (!this.ctx || this.masterVolume <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKillAt < 0.045) return;
    this.lastKillAt = now;
    this._tone(760, 760, 0.065, 0.26, 'sine', { bus: 'impacts', priority: 5 });
    this._tone(1140, 1140, 0.075, 0.3, 'sine', { bus: 'impacts', delay: 0.06, priority: 5 });
    this._tone(1520, 1240, 0.11, 0.24, 'triangle', { bus: 'impacts', delay: 0.125, priority: 5 });
  }

  damaged() {
    if (!this.ctx) return;
    this._noise(0.15, 300, 0.8, 0.5, 0.12, { bus: 'impacts', priority: 5 });
    this._tone(110, 60, 0.12, 0.35, 'triangle', { bus: 'impacts', priority: 5 });
  }

  impact(surface = 'concrete', volume = 1, spatial = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.025) return;
    this.lastImpactAt = now;
    const safeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    const profiles = {
      concrete: { freq: 620, q: 0.7, gain: 0.16, tone: 130 },
      metal: { freq: 2800, q: 2.8, gain: 0.2, tone: 1680 },
      wood: { freq: 900, q: 1.2, gain: 0.17, tone: 360 },
      flesh: { freq: 360, q: 0.8, gain: 0.15, tone: 90 },
    };
    const profile = profiles[surface] || profiles.concrete;
    this._noise(0.09, profile.freq, profile.q, profile.gain * safeVolume, 0.065, {
      bus: 'impacts', spatial, priority: 2,
    });
    this._tone(profile.tone, Math.max(40, profile.tone * 0.62), surface === 'metal' ? 0.11 : 0.065,
      0.08 * safeVolume, surface === 'metal' ? 'sine' : 'triangle', {
        bus: 'impacts', spatial, priority: 2,
      });
  }

  reload() {
    if (!this.ctx) return;
    this._tone(500, 350, 0.04, 0.2, 'square', { bus: 'weapons', priority: 2 });
    this._tone(350, 500, 0.04, 0.2, 'square', { bus: 'weapons', delay: 0.18, priority: 2 });
    this._tone(650, 650, 0.05, 0.25, 'square', { bus: 'weapons', delay: 0.42, priority: 2 });
  }

  jump() {
    if (!this.ctx) return;
    this._noise(0.08, 500, 1, 0.12, 0.06, { bus: 'movement' });
  }

  land() {
    if (!this.ctx) return;
    this._noise(0.1, 250, 0.9, 0.2, 0.08, { bus: 'movement' });
  }

  dry() {
    if (!this.ctx || this.masterVolume <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDryAt < 0.12) return;
    this.lastDryAt = now;
    this._tone(900, 700, 0.04, 0.15, 'square', { bus: 'weapons', priority: 2 });
  }

  medkit() {
    if (!this.ctx) return;
    this._tone(660, 660, 0.08, 0.25, 'sine', { bus: 'ui', priority: 2 });
    this._tone(880, 880, 0.08, 0.25, 'sine', { bus: 'ui', delay: 0.09, priority: 2 });
    this._tone(1100, 1100, 0.12, 0.25, 'sine', { bus: 'ui', delay: 0.18, priority: 2 });
  }

  buy() {
    if (!this.ctx) return;
    this._tone(520, 520, 0.05, 0.2, 'square', { bus: 'ui', priority: 2 });
    this._tone(780, 780, 0.05, 0.22, 'square', { bus: 'ui', delay: 0.07, priority: 2 });
    this._tone(1180, 1180, 0.14, 0.24, 'sine', { bus: 'ui', delay: 0.14, priority: 2 });
  }

  streak(level) {
    if (!this.ctx) return;
    const base = 440 + level * 60;
    [0, 90, 180, 270].forEach((delay, i) => {
      this._tone(base * (1 + i * 0.25), base * (1 + i * 0.25), 0.12, 0.22, 'square', {
        bus: 'ui', delay: delay / 1000, priority: 3,
      });
    });
  }

  boom(volume = 1, spatial = null) {
    if (!this.ctx || this.masterVolume <= 0) return false;
    const safeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (safeVolume <= 0) return false;
    this._noise(0.7, 180, 0.5, 0.62 * safeVolume, 0.55, {
      bus: 'impacts', spatial, priority: 5,
    });
    this._tone(90, 30, 0.5, 0.42 * safeVolume, 'sine', {
      bus: 'impacts', spatial, priority: 5,
    });
    return true;
  }

  boomAt(source, listener, forward = { x: 0, z: -1 }, volume = 1) {
    const mix = spatialShotMix(source, listener, forward, 90);
    if (mix.gain > 0.001) {
      this.boom(mix.gain * Math.max(0, Number(volume) || 0), mix);
    }
    return mix;
  }

  nadeThrow() {
    if (!this.ctx) return;
    this._noise(0.06, 900, 1, 0.12, 0.05, { bus: 'weapons' });
  }

  knife() {
    if (!this.ctx) return;
    this._noise(0.12, 2400, 2.5, 0.22, 0.1, { bus: 'weapons', priority: 2 }); // silbido del tajo
  }

  chat() {
    if (!this.ctx) return;
    this._tone(950, 950, 0.06, 0.15, 'sine', { bus: 'ui' });
  }

  // volumen según distancia para disparos de bots
  distVol(d) {
    return spatialShotMix({ x: Number(d) || 0 }, { x: 0 }, { x: 0, z: -1 }, 70).gain;
  }
}
