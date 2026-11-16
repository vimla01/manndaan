// Live SmartSpectra signal source. Emits the same events as MockSignal:
//   'sample' -> { t, trace, breathing: {rate, confidence, stable},
//                 cardio: {pulse, confidence, stable} }
//   'hint'   -> { code, message }
//   'stream' -> { stream }   (camera MediaStream, for the small preview)
//
// Also logs '[measure] …' lines to the console: first-metrics latency, event
// cadence, time to first stable reading. Copy those into NOTES.md after a run.

import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  ValidationCode,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

// Poetic hints for the ritual; anything unmapped falls back to the SDK's own
// hint text. null = stay silent (purely technical, not actionable mid-ritual).
const HINTS = {
  [ValidationCode.kNoFaceFound]: "The river can't see you. Face the water.",
  [ValidationCode.kMultipleFacesFound]: 'One offering at a time.',
  [ValidationCode.kFaceNotCentered]: 'Come to the middle, where the lamp can see you.',
  [ValidationCode.kTooDark]: 'Move into the light.',
  [ValidationCode.kTooBright]: 'Too much light. Soften it.',
  [ValidationCode.kChestNotVisible]: 'Sit back — let the lamp see you breathe.',
  [ValidationCode.kExcessiveMotion]: 'Be still, like the water.',
  [ValidationCode.kCameraTuning]: null,
};

export class LiveSignal extends EventTarget {
  constructor({ apiKey }) {
    super();
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
      enableTelemetry: false,   // consent screen promises this
    });

    // adaptive trace normalizer (SDK trace units are unspecified)
    this._mean = null;
    this._amp = 0.01;

    // latest decoded values, re-emitted together on every metrics packet
    this._breathing = null;
    this._cardio = null;

    // measurement instrumentation
    this._t0 = 0;
    this._firstMetricsAt = 0;
    this._eventCount = 0;
    this._cadenceWindowStart = 0;
    this._firstStableBreath = 0;
    this._firstStablePulse = 0;
    this._lastHintAt = 0;

    this.sdk.on('metrics', (buf, tsUs) => this._onMetrics(buf, tsUs));
    this.sdk.on('validationStatus', (code, tsUs, hint) => this._onValidation(code, hint));
    this.sdk.on('streamAvailable', (stream) => {
      this.dispatchEvent(new CustomEvent('stream', { detail: { stream } }));
    });
    this.sdk.on('error', (code, message, retryable) => {
      console.error(`[sdk error] code=${code} retryable=${retryable}: ${message}`);
      this.dispatchEvent(new CustomEvent('hint', {
        detail: { code: 'SDK_ERROR', message: 'The river lost sight of you. (see console)' },
      }));
    });
  }

  async start() {
    this._t0 = performance.now();
    this._cadenceWindowStart = this._t0;
    await this.sdk.start();   // acquires the camera, emits streamAvailable
    console.log(`[measure] sdk.start() resolved after ${(performance.now() - this._t0).toFixed(0)} ms`);
  }

  async stop() {
    try { await this.sdk.stop(); } catch (e) { console.warn('stop failed', e); }
  }

  destroy() { this.sdk.destroy(); }

  _onMetrics(buf, tsUs) {
    const now = performance.now();
    this._eventCount++;
    if (!this._firstMetricsAt) {
      this._firstMetricsAt = now;
      console.log(`[measure] first metrics event ${(now - this._t0).toFixed(0)} ms after start`);
    }
    if (now - this._cadenceWindowStart >= 10000) {
      console.log(`[measure] metrics cadence: ${(this._eventCount / ((now - this._cadenceWindowStart) / 1000)).toFixed(2)} events/s over last 10 s`);
      this._eventCount = 0;
      this._cadenceWindowStart = now;
    }

    const m = decodeMetrics(buf);
    if (!m || typeof m !== 'object' || !('breathing' in m || 'cardio' in m)) return;

    // breathing rate (slow-moving, ~tens-of-seconds average)
    const rate = m.breathing?.rate?.at(-1);
    if (rate) {
      this._breathing = {
        rate: rate.value,
        confidence: rate.confidence ?? 0,
        stable: Boolean(rate.stable),
      };
      if (rate.stable && !this._firstStableBreath) {
        this._firstStableBreath = now;
        console.log(`[measure] first STABLE breathing rate ${(now - this._t0).toFixed(0)} ms after start`);
      }
    }

    // pulse
    const pulse = m.cardio?.pulseRate?.at(-1);
    if (pulse) {
      this._cardio = {
        pulse: pulse.value,
        confidence: pulse.confidence ?? 0,
        stable: Boolean(pulse.stable),
      };
      if (pulse.stable && !this._firstStablePulse) {
        this._firstStablePulse = now;
        console.log(`[measure] first STABLE pulse ${(now - this._t0).toFixed(0)} ms after start`);
      }
    }

    // breathing trace (fast-moving) — chest trace, normalized to ~[-1, 1]
    const tr = m.breathing?.upperTrace?.at(-1);
    let trace = null;
    if (tr && Number.isFinite(tr.value)) {
      if (this._mean === null) this._mean = tr.value;
      this._mean += (tr.value - this._mean) * 0.04;
      const dev = Math.abs(tr.value - this._mean);
      this._amp += (dev - this._amp) * 0.03;
      trace = Math.max(-1.2, Math.min(1.2, (tr.value - this._mean) / Math.max(this._amp * 1.6, 1e-6)));
    }

    if (this._breathing || this._cardio) {
      this.dispatchEvent(new CustomEvent('sample', {
        detail: {
          t: now,
          trace: trace ?? 0,
          breathing: this._breathing ?? { rate: 0, confidence: 0, stable: false },
          cardio: this._cardio ?? { pulse: 0, confidence: 0, stable: false },
        },
      }));
    }
  }

  _onValidation(code, sdkHint) {
    if (code === ValidationCode.kOk) return;
    const now = performance.now();
    if (now - this._lastHintAt < 6000) return;   // don't nag
    const message = code in HINTS ? HINTS[code] : sdkHint;
    if (!message) return;
    this._lastHintAt = now;
    this.dispatchEvent(new CustomEvent('hint', { detail: { code, message } }));
  }
}
