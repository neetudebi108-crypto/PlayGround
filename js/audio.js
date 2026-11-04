// Tiny procedural audio engine — no external assets
export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.enabled = true
    this.volume = 0.7
    this.noise = null
    this.lastStep = 0
  }
  init() {
    if (this.ctx) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) { this.enabled = false; return }
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(this.ctx.destination)
    const len = this.ctx.sampleRate * 1.2
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noise = buf
    // ambient wind
    const wind = this.ctx.createBufferSource()
    wind.buffer = buf; wind.loop = true
    const wf = this.ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420
    const wg = this.ctx.createGain(); wg.gain.value = 0.035
    wind.connect(wf).connect(wg).connect(this.master)
    wind.start()
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08
    const lg = this.ctx.createGain(); lg.gain.value = 160
    lfo.connect(lg).connect(wf.frequency); lfo.start()
  }
  resume() { this.init(); if (this.ctx?.state === 'suspended') this.ctx.resume() }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v }
  noiseBurst({ dur = .12, freq = 900, q = .8, gain = .5, type = 'lowpass', delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource(); src.buffer = this.noise
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t); src.stop(t + dur + .02)
  }
  tone({ freq = 440, dur = .1, gain = .2, type = 'sine', slide = 0, delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator(); o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + dur + .02)
  }
  shot(kind = 'rifle') {
    if (kind === 'smg') {
      this.noiseBurst({ dur: .075, freq: 1600, gain: .34 })
      this.tone({ freq: 170, slide: -100, dur: .07, gain: .22, type: 'square' })
    } else if (kind === 'shotgun') {
      this.noiseBurst({ dur: .28, freq: 600, gain: .55 })
      this.tone({ freq: 95, slide: -60, dur: .24, gain: .34, type: 'sawtooth' })
    } else {
      this.noiseBurst({ dur: .11, freq: 1150, gain: .42 })
      this.noiseBurst({ dur: .05, freq: 2800, gain: .14, type: 'highpass' })
      this.tone({ freq: 135, slide: -95, dur: .12, gain: .3, type: 'square' })
    }
  }
  enemyShot(dist = 20) {
    if (!this.ctx) return
    const g = Math.max(.035, Math.min(.26, 7 / (dist + 10)))
    this.noiseBurst({ dur: .1, freq: 800, gain: g })
    this.tone({ freq: 120, slide: -60, dur: .1, gain: g * .5, type: 'square' })
  }
  reload() {
    this.noiseBurst({ dur: .045, freq: 2200, gain: .22, type: 'bandpass', q: 2 })
    this.noiseBurst({ dur: .06, freq: 1400, gain: .24, type: 'bandpass', q: 2, delay: .18 })
    this.tone({ freq: 780, dur: .04, gain: .07, type: 'square', delay: .34 })
    this.noiseBurst({ dur: .05, freq: 1900, gain: .25, type: 'bandpass', q: 2, delay: .5 })
  }
  hit(head = false) {
    this.tone({ freq: head ? 1450 : 850, dur: .07, gain: .16, type: 'triangle' })
    if (head) this.tone({ freq: 2200, dur: .11, gain: .1, type: 'sine', delay: .03 })
  }
  hurt() {
    this.noiseBurst({ dur: .2, freq: 300, gain: .25 })
    this.tone({ freq: 80, slide: -30, dur: .25, gain: .18, type: 'sine' })
  }
  kill() {
    this.tone({ freq: 520, dur: .08, gain: .14, type: 'triangle' })
    this.tone({ freq: 880, dur: .14, gain: .11, type: 'triangle', delay: .07 })
  }
  step() {
    const now = performance.now()
    if (now - this.lastStep < 240) return
    this.lastStep = now
    this.noiseBurst({ dur: .07, freq: 320 + Math.random() * 200, gain: .055, type: 'lowpass' })
  }
  ui() { this.tone({ freq: 720, dur: .045, gain: .06, type: 'triangle' }) }
  toggle(on) {
    this.tone({ freq: on ? 660 : 440, dur: .08, gain: .09, type: 'square' })
    if (on) this.tone({ freq: 990, dur: .1, gain: .06, type: 'square', delay: .07 })
  }
  empty() { this.noiseBurst({ dur: .03, freq: 2400, gain: .12, type: 'bandpass', q: 3 }) }
  explosion() {
    this.noiseBurst({ dur: .5, freq: 260, gain: .6 })
    this.tone({ freq: 65, slide: -40, dur: .5, gain: .3, type: 'sawtooth' })
  }
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: .3, gain: .12, type: 'triangle', delay: i * .13 }))
  }
  defeat() {
    [330, 262, 196, 147].forEach((f, i) => this.tone({ freq: f, dur: .38, gain: .12, type: 'triangle', delay: i * .18 }))
  }
}
