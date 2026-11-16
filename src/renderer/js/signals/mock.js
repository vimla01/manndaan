// Mock breathing/pulse source. Same event shape the live SmartSpectra adapter
// (src/renderer/js/signals/live.js, step 3) will emit, so the scene code never
// knows which one it is talking to.
//
// Events:
//   'sample' -> { t, trace, breathing: {rate, confidence, stable},
//                 cardio: {pulse, confidence, stable} }
//   'hint'   -> { code, message }   (live mode: from validationStatus)
//
// Keyboard (mock only):
//   ArrowUp / ArrowDown : breathe faster / slower
//   e                   : toggle erratic breathing
//   h                   : emit a fake validation hint

export class MockSignal extends EventTarget {
  constructor() {
    super();
    this.periodS = 3.2;       // seconds per full breath cycle
    this.erratic = false;
    this.phase = 0;
    this.pulsePhase = 0;
    this.rateShown = 60 / this.periodS; // lags toward true rate, like the SDK's averaged rate
    this._timer = null;
    this._last = performance.now();
  }

  start() {
    this._timer = setInterval(() => this._tick(), 100); // ~10 Hz samples
    window.addEventListener('keydown', this._onKey);
  }

  stop() {
    clearInterval(this._timer);
    window.removeEventListener('keydown', this._onKey);
  }

  _onKey = (e) => {
    if (e.key === 'ArrowUp') this.periodS = Math.max(1.2, this.periodS - 0.4);
    if (e.key === 'ArrowDown') this.periodS = Math.min(9, this.periodS + 0.4);
    if (e.key === 'e') this.erratic = !this.erratic;
    if (e.key === 'h') {
      this.dispatchEvent(new CustomEvent('hint', {
        detail: { code: 'MOCK_LOW_LIGHT', message: 'Move into the light.' },
      }));
    }
  };

  _tick() {
    const now = performance.now();
    const dt = (now - this._last) / 1000;
    this._last = now;

    let period = this.periodS;
    if (this.erratic) period *= 0.55 + Math.random() * 0.9;
    this.phase += (2 * Math.PI * dt) / period;

    let trace = Math.sin(this.phase);
    trace += (Math.random() - 0.5) * (this.erratic ? 0.25 : 0.04);

    // Simulated slow-moving displayed rate (the SDK averages over ~tens of seconds).
    const trueRate = 60 / this.periodS * (this.erratic ? 1.5 : 1);
    this.rateShown += (trueRate - this.rateShown) * Math.min(1, dt / 8);

    this.pulsePhase += dt;
    const pulse = 72 + 6 * Math.sin(this.pulsePhase / 11) + (this.erratic ? 9 : 0);

    const breathingConfidence = this.erratic ? 30 : 80;
    this.dispatchEvent(new CustomEvent('sample', {
      detail: {
        t: now,
        trace,
        breathing: {
          rate: this.rateShown,
          confidence: breathingConfidence,
          stable: breathingConfidence >= 45,
        },
        cardio: { pulse, confidence: 75, stable: true },
      },
    }));
  }
}
