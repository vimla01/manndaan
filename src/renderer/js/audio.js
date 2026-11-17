// The ghat's sound, synthesized in the browser — no audio files, nothing to
// license, and it matches the rest of the scene being drawn in code.
//
//   river  : brown noise through a slowly breathing low-pass, plus a thin
//            high band for the surface
//   bells  : inharmonic partials with exponential decay, through a generated
//            reverb impulse. Struck at an interval derived from the live pulse,
//            so the distant temple keeps time with the person's heart.
//
// Nothing starts until consent: the AudioContext is created on that click.

export class Ambience {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.pulse = 72;
    this._bellTimer = null;
    this._dropTimer = null;
  }

  /** Called from the consent click, which is the user gesture audio needs. */
  start() {
    if (this.ready) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0;              // fade in below
      this.master.connect(ctx.destination);

      // --- reverb: an impulse made of decaying noise ---
      const irLen = Math.floor(ctx.sampleRate * 2.8);
      const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
        }
      }
      this.verb = ctx.createConvolver();
      this.verb.buffer = ir;
      const verbGain = ctx.createGain();
      verbGain.gain.value = 0.55;
      this.verb.connect(verbGain).connect(this.master);

      // --- the river ---
      // Steady filtered noise is what *wind* sounds like. Water reads as water
      // because of transients: droplets, and the slow lap of the current
      // against stone. So the noise bed is kept low and quiet, and the
      // character comes from events scheduled on top of it.
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      this.noiseBuffer = buf;

      const bed = ctx.createBufferSource();
      bed.buffer = buf;
      bed.loop = true;
      const bedFilter = ctx.createBiquadFilter();
      bedFilter.type = 'bandpass';          // not lowpass: lowpass is wind
      bedFilter.frequency.value = 620;
      bedFilter.Q.value = 0.9;
      this.riverGain = ctx.createGain();
      this.riverGain.gain.value = 0.16;     // quiet: a bed, not the subject
      bed.connect(bedFilter).connect(this.riverGain).connect(this.master);
      bed.start();

      this.bedFilter = bedFilter;

      this.master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 4);
      this.ready = true;
      this._scheduleBell(7);
      this._scheduleWater();
    } catch (err) {
      console.warn('[audio] unavailable:', err.message);
    }
  }

  /** A single drop: a short sine whose pitch *rises* as the bubble closes.
   *  This is the sound the ear reads as "water" more than any noise does. */
  _drop(at) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f1 = 500 + Math.random() * 500;
    osc.frequency.setValueAtTime(f1, at);
    osc.frequency.exponentialRampToValueAtTime(f1 * (1.8 + Math.random()), at + 0.055);
    const g = ctx.createGain();
    const amp = 0.012 + Math.random() * 0.02;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09 + Math.random() * 0.06);
    osc.connect(g);
    g.connect(this.verb);
    g.connect(this.master);
    osc.start(at);
    osc.stop(at + 0.3);
  }

  /** The current turning over against the steps: a slow swell of noise. */
  _lap(at) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(380 + Math.random() * 200, at);
    bp.frequency.linearRampToValueAtTime(900 + Math.random() * 500, at + 1.1);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    const amp = 0.05 + Math.random() * 0.05;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.5 + Math.random() * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2 + Math.random());
    src.connect(bp).connect(g);
    g.connect(this.master);
    src.start(at);
    src.stop(at + 3.4);
  }

  _scheduleWater() {
    clearTimeout(this._dropTimer);
    const tick = () => {
      if (!this.ready || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (!this.muted) {
        this._drop(now + 0.02);
        if (Math.random() < 0.35) this._drop(now + 0.25 + Math.random() * 0.4);
        if (Math.random() < 0.45) this._lap(now + Math.random() * 0.5);
      }
      this._dropTimer = setTimeout(tick, (1.6 + Math.random() * 3.2) * 1000);
    };
    this._dropTimer = setTimeout(tick, 900);
  }

  /** One struck bell: inharmonic partials, soft, far away. */
  _strike(at, level = 1) {
    const ctx = this.ctx;
    const f0 = 298;
    const partials = [1, 2.76, 5.4, 8.93, 13.34];
    partials.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      const amp = level * 0.085 / (1 + i * 1.7);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.0 / (1 + i * 0.55));
      osc.connect(g);
      g.connect(this.verb);
      osc.start(at);
      osc.stop(at + 3.4);
    });
  }

  /** Bells keep time with the heart: one every eight beats, give or take. */
  _scheduleBell(delaySeconds) {
    clearTimeout(this._bellTimer);
    this._bellTimer = setTimeout(() => {
      if (!this.ready || !this.ctx) return;
      if (!this.muted) this._strike(this.ctx.currentTime + 0.05, 0.8 + Math.random() * 0.4);
      const beat = 60 / Math.min(140, Math.max(45, this.pulse));
      const next = Math.min(14, Math.max(5, beat * 8));
      this._scheduleBell(next);
    }, delaySeconds * 1000);
  }

  /** Live pulse sets the bell tempo; the ritual's phase sets the level. */
  update({ pulse, state }) {
    if (!this.ready) return;
    if (Number.isFinite(pulse) && pulse > 30) this.pulse = pulse;
    const target = this.muted ? 0
      : state === 'breathe' ? 0.42
      : state === 'release' || state === 'closing' ? 0.16
      : 0.3;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 1.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.35, this.ctx.currentTime, 0.4);
    }
    return this.muted;
  }

  stop() {
    clearTimeout(this._bellTimer);
    clearTimeout(this._dropTimer);
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 1.5);
    setTimeout(() => { try { this.ctx.close(); } catch {} this.ready = false; }, 4000);
  }
}
