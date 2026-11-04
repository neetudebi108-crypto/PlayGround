/* ============================================================
   AUDIO — procedural WebAudio SFX (no asset downloads)
   ============================================================ */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.65;
    this.noise = null;
    this.lastStep = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.9;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    this.ambience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, .05);
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  env(gain, attack, decay, peak = 1) {
    const t = this.now();
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  ambience() {
    if (!this.ctx) return;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 240;
    const g = this.ctx.createGain(); g.gain.value = .025;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    // distant conflict rumble
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 44;
    const og = this.ctx.createGain(); og.gain.value = .018;
    osc.connect(og); og.connect(this.master); osc.start();
  }

  shot(id = 'ak', distant = false) {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = this.ctx.createGain();
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    let peak = distant ? .12 : .72, len = .16;
    if (id === 'awm') { filter.frequency.value = distant ? 900 : 2600; peak = distant ? .2 : 1.0; len = .45; osc.frequency.value = 62; }
    else if (id === 'ump') { filter.frequency.value = distant ? 800 : 1800; peak = distant ? .08 : .52; len = .11; osc.frequency.value = 120; }
    else { filter.frequency.value = distant ? 1000 : 2200; peak = distant ? .1 : .78; len = .18; osc.frequency.value = 95; }
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(.0001, t + len + (id === 'awm' ? .5 : .12));
    src.start(t); src.stop(t + len + .6);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(osc.frequency.value, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + .12);
    osc.connect(og); og.connect(this.master);
    og.gain.setValueAtTime(peak * .65, t);
    og.gain.exponentialRampToValueAtTime(.0001, t + .22);
    osc.start(t); osc.stop(t + .28);
    if (id === 'awm' && !distant) {
      // echo tail
      const src2 = this.noiseSource();
      const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 700; f2.Q.value = .7;
      const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(.16, t + .08);
      g2.gain.exponentialRampToValueAtTime(.0001, t + .8);
      src2.connect(f2); f2.connect(g2); g2.connect(this.master);
      src2.start(t + .06); src2.stop(t + .9);
    }
  }

  hit(head = false) {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(head ? 1500 : 980, t);
    osc.frequency.exponentialRampToValueAtTime(head ? 700 : 420, t + .04);
    g.gain.setValueAtTime(.12, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + .08);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + .1);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.now();
    [0, .07, .14].forEach((d, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = [440, 660, 880][i];
      g.gain.setValueAtTime(.13, t + d); g.gain.exponentialRampToValueAtTime(.0001, t + d + .22);
      o.connect(g); g.connect(this.master); o.start(t + d); o.stop(t + d + .25);
    });
  }

  reload() {
    if (!this.ctx) return;
    const t = this.now();
    for (const d of [0, .22, .5]) {
      const src = this.noiseSource();
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(.12, t + d); g.gain.exponentialRampToValueAtTime(.0001, t + d + .05);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t + d); src.stop(t + d + .07);
    }
  }

  empty() {
    if (!this.ctx) return;
    const t = this.now();
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 180;
    g.gain.setValueAtTime(.07, t + .04); g.gain.exponentialRampToValueAtTime(.0001, t + .09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .1);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.now();
    [620, 930].forEach((f, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.08, t + i * .06); g.gain.exponentialRampToValueAtTime(.0001, t + .2 + i * .06);
      o.connect(g); g.connect(this.master); o.start(t + i * .06); o.stop(t + .3);
    });
  }

  heal() {
    if (!this.ctx) return;
    const t = this.now();
    [330, 440, 550, 660].forEach((f, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.06, t + i * .1); g.gain.exponentialRampToValueAtTime(.0001, t + .3 + i * .1);
      o.connect(g); g.connect(this.master); o.start(t + i * .1); o.stop(t + .4 + i * .1);
    });
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.0001, t + .18);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + .2);
  }

  step() {
    if (!this.ctx) return;
    const t = this.now();
    if (t - this.lastStep < .28) return;
    this.lastStep = t;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.035, t); g.gain.exponentialRampToValueAtTime(.0001, t + .08);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + .1);
  }

  victory() {
    if (!this.ctx) return;
    const t = this.now();
    [523, 659, 784, 1046].forEach((f, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(.15, t + i * .12); g.gain.exponentialRampToValueAtTime(.0001, t + 1.0 + i * .12);
      o.connect(g); g.connect(this.master); o.start(t + i * .12); o.stop(t + 1.2 + i * .12);
    });
  }

  defeat() {
    if (!this.ctx) return;
    const t = this.now();
    [330, 277, 220, 165].forEach((f, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      g.gain.setValueAtTime(.06, t + i * .14); g.gain.exponentialRampToValueAtTime(.0001, t + .9 + i * .14);
      o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t + i * .14); o.stop(t + 1 + i * .14);
    });
  }
}
