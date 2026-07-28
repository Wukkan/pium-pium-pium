// ---------------------------------------------------------------------------
// Sonidos sintetizados con WebAudio: disparos, impactos, recarga, saltos...
// No se usan archivos externos.
// ---------------------------------------------------------------------------

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  _noise(duration, filterFreq, filterQ, gain, decay) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration);
  }

  _tone(freq, endFreq, duration, gain, type = 'square') {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  shot(kind = 'ar', volume = 1) {
    if (!this.ctx) return;
    if (kind === 'sniper') {
      this._noise(0.4, 400, 0.7, 0.9 * volume, 0.35);
      this._tone(160, 40, 0.3, 0.5 * volume, 'triangle');
    } else if (kind === 'smg') {
      this._noise(0.12, 1800, 1.2, 0.4 * volume, 0.09);
      this._tone(220, 70, 0.07, 0.25 * volume);
    } else {
      this._noise(0.18, 1100, 1, 0.55 * volume, 0.13);
      this._tone(190, 55, 0.1, 0.3 * volume, 'triangle');
    }
  }

  hit() {
    if (!this.ctx) return;
    this._tone(1400, 1100, 0.05, 0.25, 'sine');
  }

  kill() {
    if (!this.ctx) return;
    this._tone(880, 880, 0.07, 0.3, 'sine');
    setTimeout(() => this.ctx && this._tone(1320, 1320, 0.09, 0.3, 'sine'), 70);
  }

  damaged() {
    if (!this.ctx) return;
    this._noise(0.15, 300, 0.8, 0.5, 0.12);
    this._tone(110, 60, 0.12, 0.35, 'triangle');
  }

  reload() {
    if (!this.ctx) return;
    this._tone(500, 350, 0.04, 0.2);
    setTimeout(() => this.ctx && this._tone(350, 500, 0.04, 0.2), 180);
    setTimeout(() => this.ctx && this._tone(650, 650, 0.05, 0.25), 420);
  }

  jump() {
    if (!this.ctx) return;
    this._noise(0.08, 500, 1, 0.12, 0.06);
  }

  land() {
    if (!this.ctx) return;
    this._noise(0.1, 250, 0.9, 0.2, 0.08);
  }

  dry() {
    if (!this.ctx) return;
    this._tone(900, 700, 0.04, 0.15);
  }

  // volumen según distancia para disparos de bots
  distVol(d) {
    return Math.max(0.05, Math.min(1, 1 - d / 70));
  }
}
