// ---------------------------------------------------------------------------
// Sonidos sintetizados con WebAudio: disparos, impactos, recarga, saltos...
// No se usan archivos externos.
// ---------------------------------------------------------------------------

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.samples = null; // grabaciones reales (CC0); si fallan, sintetizado
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

    this._loadSamples();
  }

  async _loadSamples() {
    if (this.samples) return;
    this.samples = {};
    const files = {
      ar: 'sounds/ar.wav',
      smg: 'sounds/smg.wav',
      sniper: 'sounds/sniper.wav',
      shotgun: 'sounds/shotgun.wav',
      pistol: 'sounds/smg.wav', // misma CZ-52 real; el subfusil la acelera
    };
    for (const [kind, url] of Object.entries(files)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        this.samples[kind] = await this.ctx.decodeAudioData(buf);
      } catch { /* se queda el sonido sintetizado */ }
    }
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
    // grabación real si está cargada (con variación de tono para no sonar robótico)
    const sample = this.samples && this.samples[kind];
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample;
      const rate = kind === 'smg' ? 1.22 : 0.94; // el subfusil acelera la CZ-52
      src.playbackRate.value = rate + Math.random() * 0.12;
      const g = this.ctx.createGain();
      const base = kind === 'sniper' ? 0.95 : kind === 'shotgun' ? 0.85 : kind === 'smg' ? 0.5 : kind === 'pistol' ? 0.55 : 0.65;
      g.gain.value = base * volume;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
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

  medkit() {
    if (!this.ctx) return;
    this._tone(660, 660, 0.08, 0.25, 'sine');
    setTimeout(() => this.ctx && this._tone(880, 880, 0.08, 0.25, 'sine'), 90);
    setTimeout(() => this.ctx && this._tone(1100, 1100, 0.12, 0.25, 'sine'), 180);
  }

  buy() {
    if (!this.ctx) return;
    this._tone(520, 520, 0.05, 0.2);
    setTimeout(() => this.ctx && this._tone(780, 780, 0.05, 0.22), 70);
    setTimeout(() => this.ctx && this._tone(1180, 1180, 0.14, 0.24, 'sine'), 140);
  }

  streak(level) {
    if (!this.ctx) return;
    const base = 440 + level * 60;
    [0, 90, 180, 270].forEach((delay, i) => {
      setTimeout(() => this.ctx && this._tone(base * (1 + i * 0.25), base * (1 + i * 0.25), 0.12, 0.22, 'square'), delay);
    });
  }

  boom(volume = 1) {
    if (!this.ctx) return;
    this._noise(0.7, 180, 0.5, 0.9 * volume, 0.55);
    this._tone(90, 30, 0.5, 0.6 * volume, 'sine');
  }

  nadeThrow() {
    if (!this.ctx) return;
    this._noise(0.06, 900, 1, 0.12, 0.05);
  }

  // volumen según distancia para disparos de bots
  distVol(d) {
    return Math.max(0.05, Math.min(1, 1 - d / 70));
  }
}
