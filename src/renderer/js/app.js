// MannDaan renderer entry. Step 1: mock signal + placeholder scene.
// Step 2 replaces the placeholder with the full night-ghat scene;
// step 3 adds signals/live.js (SmartSpectra) behind the same interface.

import { MockSignal } from './signals/mock.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const readout = document.getElementById('readout');
const mockhelp = document.getElementById('mockhelp');

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- signal state ---------------------------------------------------------
const state = {
  trace: 0,          // latest breathing displacement, ~[-1, 1]
  traceSmooth: 0,
  breathing: null,   // { rate, confidence, stable }
  cardio: null,      // { pulse, confidence, stable }
  hint: null,
  hintUntil: 0,
  samples: 0,
};

function onSample(e) {
  const d = e.detail;
  state.trace = d.trace;
  state.breathing = d.breathing;
  state.cardio = d.cardio;
  state.samples++;
  if (state.samples === 1) console.log('first sample received');
  if (state.samples % 50 === 0) {
    console.log(`samples=${state.samples} rate=${d.breathing.rate.toFixed(1)} pulse=${d.cardio.pulse.toFixed(0)}`);
  }
}

function onHint(e) {
  state.hint = e.detail.message;
  state.hintUntil = performance.now() + 4000;
}

// --- placeholder scene ----------------------------------------------------
// A dark water horizon and a single diya whose flame follows the breath trace.
// Just enough to prove the pipeline; real art comes in step 2.
function draw(now) {
  const w = window.innerWidth, h = window.innerHeight;
  state.traceSmooth += (state.trace - state.traceSmooth) * 0.12;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#05060f');
  sky.addColorStop(0.62, '#0b1026');
  sky.addColorStop(0.65, '#060a18');
  sky.addColorStop(1, '#03040a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // water line
  const waterY = h * 0.65;
  ctx.strokeStyle = 'rgba(120,130,170,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, waterY);
  ctx.lineTo(w, waterY);
  ctx.stroke();

  // diya bowl
  const dx = w * 0.5, dy = waterY + h * 0.12 + Math.sin(now / 1400) * 3;
  ctx.fillStyle = '#5a3222';
  ctx.beginPath();
  ctx.ellipse(dx, dy, 34, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // flame: height rises with inhale (trace), flickers when signal is rough
  const calm = state.breathing?.stable ?? false;
  const flicker = calm ? Math.sin(now / 90) * 1.5 : (Math.random() - 0.5) * 14;
  const flameH = 26 + state.traceSmooth * 14 + flicker;
  const fx = dx, fy = dy - 10;
  const glow = ctx.createRadialGradient(fx, fy - flameH / 2, 2, fx, fy - flameH / 2, 90);
  glow.addColorStop(0, 'rgba(255,190,90,0.35)');
  glow.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(fx - 90, fy - flameH / 2 - 90, 180, 180);
  const flame = ctx.createLinearGradient(fx, fy, fx, fy - flameH);
  flame.addColorStop(0, '#ff9c3f');
  flame.addColorStop(1, '#ffe9b0');
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(fx - 6, fy);
  ctx.quadraticCurveTo(fx - 7, fy - flameH * 0.6, fx + (calm ? 0 : flicker * 0.4), fy - Math.max(8, flameH));
  ctx.quadraticCurveTo(fx + 7, fy - flameH * 0.6, fx + 6, fy);
  ctx.fill();

  // reflection
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.scale(1, -0.5);
  ctx.translate(0, -2 * (dy + 14) * 2);
  ctx.restore();

  // hint
  if (state.hint && now < state.hintUntil) {
    ctx.fillStyle = 'rgba(232,228,216,0.75)';
    ctx.font = '18px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText(state.hint, w / 2, h * 0.2);
  }

  // readout (DOM, judges need to see the live numbers)
  const b = state.breathing, c = state.cardio;
  readout.innerHTML = b && c
    ? `breath <span class="${b.stable ? 'stable' : 'unstable'}">${b.rate.toFixed(1)} br/min ${b.stable ? '●' : '○'}</span><br>` +
      `pulse <span class="${c.stable ? 'stable' : 'unstable'}">${c.pulse.toFixed(0)} bpm ${c.stable ? '●' : '○'}</span>`
    : 'waiting for signal…';

  requestAnimationFrame(draw);
}

// --- boot -------------------------------------------------------------------
async function boot() {
  const cfg = await window.manndaan?.getConfig?.() ?? { mode: 'mock' };
  console.log(`MannDaan booted in ${cfg.mode} mode`);

  if (cfg.mode === 'mock') {
    mockhelp.hidden = false;
    mockhelp.textContent = 'mock: ↑/↓ breath speed · e erratic · h hint';
    const signal = new MockSignal();
    signal.addEventListener('sample', onSample);
    signal.addEventListener('hint', onHint);
    signal.start();
  } else {
    // Step 3: const { LiveSignal } = await import('./signals/live.js');
    console.log('live mode not wired yet (step 3)');
  }

  requestAnimationFrame(draw);
}

boot();
