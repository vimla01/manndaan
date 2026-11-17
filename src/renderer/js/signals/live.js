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
  MetricType,
  ValidationCode,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

// Poetic hints for the ritual; anything unmapped falls back to the SDK's own
// hint text. null = stay silent (purely technical, not actionable mid-ritual).
// code -> name, for the log ("why is it not measuring?")
const CODE_NAME = Object.fromEntries(
  Object.entries(ValidationCode).map(([name, value]) => [value, name]));

const HINTS = {
  [ValidationCode.kNoFaceFound]: "The river can't see you. Face the water.",
  [ValidationCode.kMultipleFacesFound]: 'One offering at a time.',
  [ValidationCode.kFaceNotCentered]: 'Come to the middle, where the lamp can see you.',
  [ValidationCode.kTooDark]: 'Too dark for the lamp. Turn on a light, or face a window.',
  [ValidationCode.kTooBright]: 'Too much light. Soften it.',
  [ValidationCode.kChestNotVisible]: 'Sit back — the river reads your breath from your chest.',
  [ValidationCode.kExcessiveMotion]: 'Be still, like the water.',
  [ValidationCode.kFaceTooClose]: 'A little further back.',
  [ValidationCode.kFaceTooFar]: 'A little closer.',
  [ValidationCode.kFaceTooHigh]: 'Tilt the screen down, or sit a little lower.',
  [ValidationCode.kFaceTooLow]: 'Tilt the screen up, or sit a little taller.',
  [ValidationCode.kFaceNotForward]: 'Look towards the lamp.',
  // "at least 25 frames per second" means nothing to someone breathing at a
  // diya. In practice a slow camera means a dim room: the webcam lengthens
  // its exposure and delivers fewer frames.
  [ValidationCode.kFrameRateTooLow]: 'More light would help — the lamp is seeing you in slow motion.',
  [ValidationCode.kCameraTuning]: null,
};

export class LiveSignal extends EventTarget {
  constructor({ apiKey }) {
    super();
    this.sdk = new SmartSpectraSDK({
      apiKey,
      // Only what the ritual uses. The `cardioMetrics` bundle also contains
      // ARTERIAL_PRESSURE_TRACE and HRV, which need Presage's encrypted model
      // delivered into ~/.cache/SmartSpectraSDK; when that cache is empty the
      // graph goes terminal the moment a face appears and every frame is
      // dropped. Requesting the minimum is both more robust and a smaller
      // privacy surface.
      requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE],
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

    // everything the NOTES.md table needs, gathered in one session
    this.stats = {
      startedAt: 0, firstMetricsMs: null, firstStableBreathMs: null,
      firstStablePulseMs: null, events: 0, traceSamples: 0,
      traceMin: Infinity, traceMax: -Infinity,
      rateMin: Infinity, rateMax: -Infinity,
      pulseMin: Infinity, pulseMax: -Infinity,
      camera: null,            // what the webcam actually delivered
      validation: {},          // code -> count
      errors: [],
    };

    this.sdk.on('metrics', (buf, tsUs) => this._onMetrics(buf, tsUs));
    this.sdk.on('validationStatus', (code, tsUs, hint) => this._onValidation(code, hint));
    this.sdk.on('streamAvailable', (stream) => {
      this.dispatchEvent(new CustomEvent('stream', { detail: { stream } }));
    });
    this.sdk.on('error', (code, message, retryable) => {
      console.error(`[sdk error] code=${code} retryable=${retryable}: ${message}`);
      this.stats.errors.push(`${code}: ${message}`);
      this.dispatchEvent(new CustomEvent('hint', {
        detail: { code: 'SDK_ERROR', message: 'The river lost sight of you. (see console)' },
      }));
    });
  }

  async start() {
    this._t0 = performance.now();
    this.stats.startedAt = Date.now();
    this._cadenceWindowStart = this._t0;

    // The SDK's default capture is 1280x720@30. Indoor webcams lengthen their
    // exposure in dim light and sag to 10-15 fps at that size, and the SDK
    // then stops the session with error 14 ("frame rate stayed too low").
    // Asking for 640x480 keeps the rate up and gives the pipeline a quarter of
    // the pixels to process.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 }, height: { ideal: 480 },
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });
      this._stream = stream;
      this.sdk.useMediaStream(stream);
      const st = stream.getVideoTracks()[0].getSettings();
      this.stats.camera = { width: st.width, height: st.height, frameRate: st.frameRate };
      console.log(`[measure] camera ${st.width}x${st.height} @ ${st.frameRate} fps`);
      this.dispatchEvent(new CustomEvent('stream', { detail: { stream } }));
    } catch (err) {
      console.warn('[live] could not open the camera ourselves, letting the SDK try:', err.message);
    }

    await this.sdk.start();   // uses our stream, or acquires one itself
    console.log(`[measure] sdk.start() resolved after ${(performance.now() - this._t0).toFixed(0)} ms`);
  }

  /** Stop measuring and hand the camera back to the system straight away.
   *  Safe to call repeatedly and from a page-unload handler. */
  async stop() {
    if (this._stopping) return;
    this._stopping = true;
    try { await this.sdk.stop(); } catch (e) { console.warn('stop failed', e); }
    if (this._stream) {
      // Put the camera back the way we found it. The SDK locks AE/AWB/focus
      // while measuring, and on Linux those are device-level V4L2 controls
      // that survive this process — leaving them locked makes every other app
      // (video calls included) see a dark, fixed-exposure picture.
      for (const track of this._stream.getVideoTracks()) {
        try {
          const caps = track.getCapabilities ? track.getCapabilities() : {};
          const advanced = [];
          if (caps.exposureMode?.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
          if (caps.whiteBalanceMode?.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' });
          if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
          if (advanced.length) track.applyConstraints({ advanced });   // not awaited: unload will not wait
          console.log('[live] camera auto-exposure restored');
        } catch (err) {
          console.warn('[live] could not restore camera controls:', err.message);
        }
      }
      for (const track of this._stream.getTracks()) track.stop();
      this._stream = null;
      console.log('[live] camera released');
    }
  }

  destroy() { this.sdk.destroy(); }

  _onMetrics(buf, tsUs) {
    const now = performance.now();
    this._eventCount++;
    this.stats.events++;
    if (!this._firstMetricsAt) {
      this._firstMetricsAt = now;
      this.stats.firstMetricsMs = Math.round(now - this._t0);
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
      if (Number.isFinite(rate.value)) {
        this.stats.rateMin = Math.min(this.stats.rateMin, rate.value);
        this.stats.rateMax = Math.max(this.stats.rateMax, rate.value);
      }
      if (rate.stable && !this._firstStableBreath) {
        this._firstStableBreath = now;
        this.stats.firstStableBreathMs = Math.round(now - this._t0);
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
      if (Number.isFinite(pulse.value)) {
        this.stats.pulseMin = Math.min(this.stats.pulseMin, pulse.value);
        this.stats.pulseMax = Math.max(this.stats.pulseMax, pulse.value);
      }
      if (pulse.stable && !this._firstStablePulse) {
        this._firstStablePulse = now;
        this.stats.firstStablePulseMs = Math.round(now - this._t0);
        console.log(`[measure] first STABLE pulse ${(now - this._t0).toFixed(0)} ms after start`);
      }
    }

    // breathing trace (fast-moving) — chest trace, normalized to ~[-1, 1]
    const tr = m.breathing?.upperTrace?.at(-1);
    let trace = null;
    if (tr && Number.isFinite(tr.value)) {
      this.stats.traceSamples++;
      this.stats.traceMin = Math.min(this.stats.traceMin, tr.value);
      this.stats.traceMax = Math.max(this.stats.traceMax, tr.value);
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

  /** Everything measured this session, for NOTES.md. */
  report() {
    const s = this.stats;
    const secs = (performance.now() - this._t0) / 1000;
    return {
      sessionSeconds: +secs.toFixed(1),
      firstMetricsMs: s.firstMetricsMs,
      metricsPerSecond: +(s.events / secs).toFixed(2),
      firstStableBreathMs: s.firstStableBreathMs,
      firstStablePulseMs: s.firstStablePulseMs,
      breathingRateRange: s.rateMin === Infinity ? null
        : [+s.rateMin.toFixed(1), +s.rateMax.toFixed(1)],
      pulseRange: s.pulseMin === Infinity ? null
        : [Math.round(s.pulseMin), Math.round(s.pulseMax)],
      camera: s.camera ?? null,
      traceSamples: s.traceSamples,
      traceRawRange: s.traceMin === Infinity ? null
        : [+s.traceMin.toFixed(4), +s.traceMax.toFixed(4)],
      validationCounts: s.validation,
      sdkErrors: s.errors,
    };
  }

  _onValidation(code, sdkHint) {
    const now = performance.now();
    // log every change of state, throttled per code, so the terminal shows
    // exactly what the SDK is unhappy about
    this._lastLogged = this._lastLogged ?? {};
    if (!this._lastLogged[code] || now - this._lastLogged[code] > 3000) {
      this._lastLogged[code] = now;
      console.log(`[validation] ${CODE_NAME[code] ?? code}${sdkHint ? ' — ' + sdkHint : ''}`);
    }
    this.dispatchEvent(new CustomEvent('validation', { detail: { code } }));
    if (code === ValidationCode.kOk) return;
    if (now - this._lastHintAt < 6000) return;   // don't nag
    const message = code in HINTS ? HINTS[code] : null;   // never show raw SDK text
    if (!message) return;
    this._lastHintAt = now;
    this.stats.validation[code] = (this.stats.validation[code] ?? 0) + 1;
    this.dispatchEvent(new CustomEvent('hint', { detail: { code, message } }));
  }
}
