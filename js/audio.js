/* ============================================================
   FIREZONE — synthesized WebAudio (no external assets)
   ============================================================ */

export class AudioEngine {
  constructor(volume = 0.7) {
    this.volume = volume;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.ambience = null;
    this.enabled = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
  }

  _noise(duration, gain, filterType = 'lowpass', frequency = 1200, q = 0.7) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
    return { src, filter, g };
  }

  _tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  shot(type = 'ak') {
    if (!this.ctx) return;
    if (type === 'awm') {
      this._noise(0.42, 0.6, 'lowpass', 900, 0.8);
      this._tone(90, 0.35, 0.38, 'sawtooth', 38);
      this._noise(0.09, 0.22, 'highpass', 1800, 0.4);
    } else if (type === 'ump') {
      this._noise(0.09, 0.24, 'lowpass', 1700, 0.8);
      this._tone(150, 0.08, 0.14, 'square', 70);
    } else if (type === 'pistol') {
      this._noise(0.11, 0.22, 'lowpass', 1500, 0.7);
      this._tone(190, 0.09, 0.13, 'square', 85);
    } else {
      this._noise(0.13, 0.34, 'lowpass', 1450, 0.75);
      this._tone(125, 0.11, 0.18, 'sawtooth', 52);
    }
  }

  hit(head = false) {
    if (!this.ctx) return;
    this._tone(head ? 1650 : 1100, 0.06, head ? 0.11 : 0.07, 'square', head ? 900 : 600);
    this._noise(0.04, 0.06, 'highpass', 2400, 0.4);
  }

  kill() {
    if (!this.ctx) return;
    this._tone(420, 0.12, 0.09, 'triangle', 260);
    setTimeout(() => this._tone(240, 0.22, 0.08, 'triangle', 130), 90);
  }

  reload() {
    if (!this.ctx) return;
    this._noise(0.05, 0.08, 'highpass', 1800, 0.5);
    setTimeout(() => this._noise(0.06, 0.07, 'highpass', 1200, 0.5), 180);
    setTimeout(() => this._tone(520, 0.04, 0.05, 'square', 400), 260);
  }

  pickup() {
    if (!this.ctx) return;
    this._tone(620, 0.08, 0.06, 'sine', 900);
    setTimeout(() => this._tone(930, 0.1, 0.05, 'sine', 1180), 70);
  }

  heal() {
    if (!this.ctx) return;
    this._tone(420, 0.16, 0.05, 'sine', 620);
    setTimeout(() => this._tone(620, 0.2, 0.04, 'sine', 880), 130);
  }

  empty() {
    if (!this.ctx) return;
    this._tone(180, 0.04, 0.06, 'square', 120);
  }

  ui() {
    if (!this.ctx) return;
    this._tone(700, 0.035, 0.035, 'square', 860);
  }

  zone() {
    if (!this.ctx) return;
    this._tone(260, 0.5, 0.05, 'sawtooth', 180);
    setTimeout(() => this._tone(200, 0.7, 0.04, 'sawtooth', 130), 350);
  }

  victory() {
    if (!this.ctx) return;
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.4, 0.07, 'triangle', f * 0.995), i * 130);
    });
  }

  defeat() {
    if (!this.ctx) return;
    [330, 262, 196, 147].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.45, 0.06, 'triangle', f * 0.98), i * 160);
    });
  }

  startAmbience() {
    if (!this.ctx || this.ambience) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.018;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    this.ambience = { src, g, filter };
  }

  stopAmbience() {
    if (!this.ambience) return;
    try { this.ambience.src.stop(); } catch { /* noop */ }
    this.ambience = null;
  }
}
