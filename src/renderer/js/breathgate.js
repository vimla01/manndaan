// The gate the river keeps. Watches the breathing trace, detects breath
// cycles, and decides when the diya may go (7 calm breaths) or gets pushed
// back (rushing). Thresholds are game mechanics — "calm enough for the
// river" — not health judgments.
//
// Cycle detection: hysteresis zero-crossings on a lightly smoothed trace.
// A cycle = time between successive upward crossings, accepted only if the
// trace actually swung (amplitude guard), so shallow noise doesn't count.
//
// Events:
//   'breath'   -> { durationS, kind: 'calm' | 'rushed' | 'between' }
//   'progress' -> { count, needed }
//   'release'  -> {}            calm breaths reached `needed`
//   'rush'     -> {}            too many rushed breaths in a row

export class BreathGate extends EventTarget {
  constructor({
    calmMinS = 5,     // a breath this slow (or slower) is calm
    calmMaxS = 20,    // sanity ceiling — slower than this is a lost signal
    rushMaxS = 2.5,   // a breath this fast is rushing
    needed = 7,       // calm breaths to release the diya
    rushLimit = 3,    // consecutive rushed breaths before the river refuses
    upThresh = 0.18,  // hysteresis thresholds on the normalized trace
    downThresh = -0.18,
    minSwing = 0.5,   // required peak-to-trough swing for a real breath
  } = {}) {
    super();
    Object.assign(this, { calmMinS, calmMaxS, rushMaxS, needed, rushLimit, upThresh, downThresh, minSwing });
    this.reset();
  }

  reset() {
    this.calmCount = 0;
    this.rushCount = 0;
    this._s = 0;            // smoothed trace
    this._phase = 'mid';    // 'high' after up-cross, 'low' after down-cross
    this._lastUp = 0;       // ms timestamp of last upward crossing
    this._min = Infinity;
    this._max = -Infinity;
  }

  /** Feed one trace sample (normalized ~[-1,1]) at time t (ms). */
  feed(trace, t) {
    this._s += (trace - this._s) * 0.25;
    const s = this._s;
    this._min = Math.min(this._min, s);
    this._max = Math.max(this._max, s);

    if (this._phase !== 'low' && s < this.downThresh) this._phase = 'low';

    if (this._phase !== 'high' && s > this.upThresh) {
      this._phase = 'high';
      if (this._lastUp) {
        const durationS = (t - this._lastUp) / 1000;
        const swing = this._max - this._min;
        if (swing >= this.minSwing) this._classify(durationS);
      }
      this._lastUp = t;
      this._min = this._max = s;
    }
  }

  _classify(durationS) {
    let kind = 'between';
    if (durationS >= this.calmMinS && durationS <= this.calmMaxS) {
      kind = 'calm';
      this.calmCount++;
      this.rushCount = 0;
    } else if (durationS < this.rushMaxS) {
      kind = 'rushed';
      this.rushCount++;
      this.calmCount = Math.max(0, this.calmCount - 1);  // gentle erosion
    }
    // 'between' breaths (neither calm nor rushed) keep progress but add nothing

    this.dispatchEvent(new CustomEvent('breath', { detail: { durationS, kind } }));
    this.dispatchEvent(new CustomEvent('progress', { detail: { count: this.calmCount, needed: this.needed } }));

    if (this.calmCount >= this.needed) {
      this.dispatchEvent(new CustomEvent('release'));
    } else if (this.rushCount >= this.rushLimit) {
      this.dispatchEvent(new CustomEvent('rush'));
    }
  }
}
