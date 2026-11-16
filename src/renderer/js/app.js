// MannDaan renderer entry: glue between the signal source (mock now,
// SmartSpectra in step 3), the Scene renderer, and the Ritual state machine.

import { MockSignal } from './signals/mock.js';
import { LiveSignal } from './signals/live.js';
import { Scene } from './scene.js';
import { Ritual } from './ritual.js';
import { BreathGate } from './breathgate.js';

// Game-mechanic thresholds ("calm enough for the river") — tune after webcam
// sessions, log changes in NOTES.md.
const TUNING = {
  calmMinS: 5,     // full breath cycle at least this slow = calm
  rushMaxS: 2.5,   // faster than this = rushing
  needed: 7,       // seven breaths, one diya
  rushLimit: 3,    // rushed breaths in a row before the river refuses
};

const canvas = document.getElementById('scene');
const readout = document.getElementById('readout');
const hintline = document.getElementById('hintline');
const overlay = document.getElementById('overlay');
const mockhelp = document.getElementById('mockhelp');
const breathdots = document.getElementById('breathdots');

const ctx = canvas.getContext('2d');
function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- live signal state ------------------------------------------------------
const sig = {
  trace: 0,
  traceSmooth: 0,
  breathing: null,     // { rate, confidence, stable }
  cardio: null,        // { pulse, confidence, stable }
  flameEnergy: 0.5,    // eased: high when calm & stable
  shimmer: 0.5,        // eased: follows pulse (gentle)
  samples: 0,
};

function onSample(e) {
  const d = e.detail;
  sig.trace = d.trace;
  sig.breathing = d.breathing;
  sig.cardio = d.cardio;
  sig.samples++;
  if (sig.samples === 1) console.log('first sample received');
  if (ritual?.state === 'breathe') gate.feed(d.trace, d.t);
}

// --- breath gate ------------------------------------------------------------
const gate = new BreathGate(TUNING);
let rushHinted = false;

function updateDots(count) {
  [...breathdots.children].forEach((dot, i) => dot.classList.toggle('lit', i < count));
}

gate.addEventListener('breath', (e) => {
  const { durationS, kind } = e.detail;
  console.log(`[gate] breath ${durationS.toFixed(1)} s — ${kind} (calm ${gate.calmCount}/${gate.needed})`);
  if (kind === 'calm') {
    scene.addRipple(ritual.diya.x * innerWidth, ritual.diya.y * innerHeight + 10);
  } else if (kind === 'rushed' && !rushHinted) {
    rushHinted = true;
    ritual.showHint('Slower. The river is in no hurry.');
  }
});
gate.addEventListener('progress', (e) => updateDots(e.detail.count));
gate.addEventListener('release', () => ritual.release());
gate.addEventListener('rush', () => {
  ritual.pushback();
  gate.reset();
  updateDots(0);
});

// --- main loop --------------------------------------------------------------
let scene, ritual;
let fpsCount = 0, fpsStart = 0;
let prevState = '';

function frame(now) {
  // FPS instrumentation for NOTES.md
  if (!fpsStart) fpsStart = now;
  fpsCount++;
  if (now - fpsStart >= 10000) {
    console.log(`[measure] render fps: ${(fpsCount / ((now - fpsStart) / 1000)).toFixed(1)} over last 10 s`);
    fpsCount = 0;
    fpsStart = now;
  }

  // ease flame energy toward target: stable+calm breath = tall, still flame
  const calm = sig.breathing?.stable ?? false;
  const target = calm ? 0.9 : 0.25;
  sig.flameEnergy += (target - sig.flameEnergy) * 0.02;
  sig.traceSmooth += (sig.trace - sig.traceSmooth) * 0.12;

  // shimmer follows pulse: resting pulse ≈ calm water, higher = livelier
  const pulse = sig.cardio?.pulse ?? 70;
  const shimmerTarget = Math.min(1, Math.max(0, (pulse - 55) / 50));
  sig.shimmer += (shimmerTarget - sig.shimmer) * 0.01;

  // breath-gate visibility + lifecycle follows the ritual state
  if (ritual.state !== prevState) {
    if (ritual.state === 'breathe' && prevState === 'settle') {
      gate.reset();           // a fresh offering starts from zero breaths
      updateDots(0);
      rushHinted = false;
    }
    breathdots.classList.toggle('show', ritual.state === 'breathe');
    prevState = ritual.state;
  }

  ritual.update(now);
  const r = ritual.getDrawState();
  scene.draw(now, {
    trace: sig.traceSmooth,
    calm,
    flameEnergy: sig.flameEnergy,
    shimmer: sig.shimmer,
    diya: r.diya,
    worry: r.worry,
  });

  // judges' readout — live numbers from the signal source
  const b = sig.breathing, c = sig.cardio;
  readout.innerHTML = b && c
    ? `breath <span class="${b.stable ? 'stable' : 'unstable'}">${b.rate.toFixed(1)}/min ${b.stable ? '●' : '○'}</span>` +
      ` · pulse <span class="${c.stable ? 'stable' : 'unstable'}">${c.pulse.toFixed(0)} bpm ${c.stable ? '●' : '○'}</span>`
    : 'waiting for signal…';

  requestAnimationFrame(frame);
}

// --- boot -------------------------------------------------------------------
async function boot() {
  const cfg = await window.manndaan?.getConfig?.() ?? { mode: 'mock' };
  const mock = cfg.mode === 'mock';
  console.log(`MannDaan booted in ${cfg.mode} mode`);

  scene = new Scene(canvas);
  for (let i = 0; i < TUNING.needed; i++) breathdots.appendChild(document.createElement('span'));

  let signal = null;
  const startSignal = async () => {
    if (signal) return;
    if (mock) {
      signal = new MockSignal();
    } else {
      if (!cfg.apiKey) throw new Error('no PRESAGE_API_KEY in .env');
      signal = new LiveSignal({ apiKey: cfg.apiKey });
      signal.addEventListener('stream', (e) => {
        // small live preview: honest proof the signal is real
        const v = document.getElementById('preview');
        v.srcObject = e.detail.stream;
        v.hidden = false;
        v.play().catch(() => {});
      });
    }
    signal.addEventListener('sample', onSample);
    signal.addEventListener('hint', (e) => ritual.showHint(e.detail.message));
    await signal.start();   // mock: sync; live: resolves when the camera runs
  };

  ritual = new Ritual({
    overlay, hintline, readout, scene, mock,
    onConsent: startSignal,   // camera (or mock) starts only after consent
  });

  if (mock) {
    document.getElementById('mocktag').hidden = false;
    if (new URLSearchParams(location.search).get('dev') === '1') {
      mockhelp.hidden = false;
      mockhelp.textContent = 'mock: ↑/↓ breath speed · e erratic · h hint · r release · p pushback';
    }
  }

  requestAnimationFrame(frame);

  // smoke autopilot: walk the whole ritual unattended, log each state
  if (new URLSearchParams(location.search).get('smoke') === '1') {
    const click = (id) => document.getElementById(id)?.click();
    const at = (ms, fn) => setTimeout(() => { fn(); console.log(`smoke: state=${ritual.state}`); }, ms);
    at(6000, () => click('begin'));
    at(7000, () => click('consent-yes'));
    at(8500, () => {
      const input = document.getElementById('worry-input');
      if (input) {
        input.value = 'the exam on monday';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      }
    });
    // drive the real gate through the mock signal: rush → pushback,
    // then (with a shortened calm threshold) slow breathing → release
    at(11000, () => { signal.periodS = 1.2; });            // rushing
    at(20000, () => { signal.periodS = 9; });              // settle during pushback
    at(27000, () => { gate.calmMinS = 2; signal.periodS = 3.2; });  // calm (shortened for smoke)
    at(56000, () => console.log(`smoke: final state=${ritual.state} worry="${ritual.worry}" dots=${breathdots.querySelectorAll('.lit').length}`));
  }
}

boot();
