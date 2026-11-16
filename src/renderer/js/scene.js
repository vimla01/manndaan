// The night ghat. Pure rendering: everything it draws is driven by the state
// object passed to draw() — no ritual logic lives here.
//
// draw(now, s) where s = {
//   trace,          // breathing displacement ~[-1,1]
//   calm,           // boolean — smooth signal right now
//   flameEnergy,    // 0..1 — how alive the flame is
//   shimmer,        // 0..1 — water shimmer intensity (pulse-driven)
//   diya: { x, y, scale, alpha },   // in [0..1] fractions of w/h
//   worry: { text, alpha },
// }

const MOON = { x: 0.70, y: 0.30 };   // x of width, y of waterY

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.stars = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random() * 0.55,
      r: 0.4 + Math.random() * 0.9,
      tw: 0.5 + Math.random() * 2.5,
      ph: Math.random() * Math.PI * 2,
    }));

    // far bank, out of focus: vague dark bumps (painted blurred into a cached
    // layer) + warm bokeh lights. The shallow depth-of-field keeps the eye on
    // our sharp diya and steps.
    this.farBumps = [];
    for (let x = -0.05; x < 1.05; ) {
      const bw = 0.04 + Math.random() * 0.1;
      this.farBumps.push({ x0: x, x1: x + bw, h: 0.012 + Math.random() * 0.03 });
      x += bw * (0.6 + Math.random() * 0.5);
    }
    // vague ghat buildings and homes behind the bumps — only ever seen
    // through heavy blur, so simple blocks and spires are enough
    this.farBuildings = [];
    for (let x = 0; x < 1; ) {
      const bw = 0.015 + Math.random() * 0.04;
      const spire = Math.random() < 0.2;
      const b = {
        x0: x, x1: x + bw, spire,
        h: spire ? 0.045 + Math.random() * 0.03 : 0.018 + Math.random() * 0.032,
        windows: [],
      };
      if (!spire) {
        const n = Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) {
          b.windows.push({ fx: 0.15 + Math.random() * 0.7, fy: 0.25 + Math.random() * 0.55 });
        }
      }
      this.farBuildings.push(b);
      x += bw + Math.random() * 0.025;
    }

    this.bokeh = [];
    for (let x = 0.02; x < 0.98; x += 0.04 + Math.random() * 0.1) {
      this.bokeh.push({
        x: x + (Math.random() - 0.5) * 0.03,
        r: 2.2 + Math.random() * 6,          // bokeh disc radius (× vs)
        b: 0.3 + Math.random() * 0.7,
        warm: Math.random(),
        ph: Math.random() * Math.PI * 2,
      });
    }
    // other people's offerings, far away on the water, softly blurred
    this.floaters = Array.from({ length: 4 }, (_, i) => ({
      x0: Math.random(),
      speed: 0.004 + Math.random() * 0.006,   // screen-widths per minute-ish
      d: 0.05 + Math.random() * 0.14,         // depth into the water band
      b: 0.5 + Math.random() * 0.5,
      ph: Math.random() * Math.PI * 2,
    }));

    // six wave bands of short drifting segments — half the old count, broken
    // up so the water never reads as scribbled lines
    this.waveBands = Array.from({ length: 6 }, (_, i) => {
      const segs = [];
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        segs.push({ x: Math.random(), len: 0.09 + Math.random() * 0.15 });
      }
      return { d: ((i + 1) / 6) ** 2, segs, sp: 0.4 + Math.random() * 0.8 };
    });

    this.shimmerSpecks = Array.from({ length: 80 }, () => ({
      x: Math.random(), d: Math.random(),
      sp: 0.004 + Math.random() * 0.012,
      ph: Math.random() * Math.PI * 2,
    }));

    // subtle stone grain for the steps (normalized to the steps' bounding box)
    this.stoneNoise = Array.from({ length: 240 }, () => ({
      x: Math.random(), y: Math.random(),
      a: 0.02 + Math.random() * 0.05,
      warm: Math.random() > 0.5,
    }));

    // full moon sprite (Dev Deepawali falls on Kartik Purnima): warm off-white,
    // faint mottled maria, feathered edge — painted once
    const m = document.createElement('canvas');
    m.width = m.height = 200;
    const mc = m.getContext('2d');
    const mg = mc.createRadialGradient(100, 100, 10, 100, 100, 80);
    mg.addColorStop(0, 'rgba(240,232,212,0.95)');
    mg.addColorStop(0.72, 'rgba(236,226,202,0.88)');
    mg.addColorStop(0.9, 'rgba(230,220,196,0.42)');
    mg.addColorStop(1, 'rgba(228,218,194,0)');
    mc.fillStyle = mg;
    mc.beginPath();
    mc.arc(100, 100, 80, 0, Math.PI * 2);
    mc.fill();
    // mottling, kept inside the disc
    mc.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 11; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 48;
      const bx = 100 + Math.cos(a) * rr, by = 100 + Math.sin(a) * rr;
      mc.fillStyle = `rgba(168,158,138,${0.05 + Math.random() * 0.08})`;
      mc.beginPath();
      mc.ellipse(bx, by, 7 + Math.random() * 15, 5 + Math.random() * 11,
                 Math.random() * Math.PI, 0, Math.PI * 2);
      mc.fill();
    }
    this.moonSprite = m;

    // bokeh disc sprites (warm + pale), drawn scaled with globalAlpha —
    // cheaper than a fresh radial gradient per light per frame
    this.bokehSprites = {};
    for (const [key, col] of [['warm', '255,176,92'], ['pale', '255,206,140']]) {
      const bc = document.createElement('canvas');
      bc.width = bc.height = 64;
      const b2 = bc.getContext('2d');
      const bg = b2.createRadialGradient(32, 32, 0, 32, 32, 32);
      bg.addColorStop(0, `rgba(${col},0.50)`);
      bg.addColorStop(0.55, `rgba(${col},0.22)`);
      bg.addColorStop(1, `rgba(${col},0)`);
      b2.fillStyle = bg;
      b2.fillRect(0, 0, 64, 64);
      this.bokehSprites[key] = bc;
      // matching reflection strip: vertical fade, drawn scaled + alpha'd
      const rc = document.createElement('canvas');
      rc.width = 16; rc.height = 64;
      const r2 = rc.getContext('2d');
      const rg = r2.createLinearGradient(0, 0, 0, 64);
      rg.addColorStop(0, `rgba(${col},0.10)`);
      rg.addColorStop(1, `rgba(${col},0)`);
      r2.fillStyle = rg;
      r2.fillRect(0, 0, 16, 64);
      this.bokehSprites[key + 'Refl'] = rc;
    }

    // soft warm streak for the reflection — blurred once here, never per frame
    const sb = document.createElement('canvas');
    sb.width = 160; sb.height = 24;
    const sbc = sb.getContext('2d');
    sbc.filter = 'blur(4px)';
    sbc.fillStyle = 'rgb(255,170,80)';
    sbc.fillRect(16, 9, 128, 6);
    this.streakSprite = sb;

    const sv = document.createElement('canvas');
    sv.width = 160; sv.height = 24;
    const svc = sv.getContext('2d');
    svc.filter = 'blur(4px)';
    svc.fillStyle = 'rgb(206,212,226)';
    svc.fillRect(16, 9, 128, 6);
    this.silverStreakSprite = sv;

    // glow behind a lit breath dot
    const dg = document.createElement('canvas');
    dg.width = dg.height = 64;
    const dgc = dg.getContext('2d');
    const dgg = dgc.createRadialGradient(32, 32, 0, 32, 32, 32);
    dgg.addColorStop(0, 'rgba(255,179,71,0.85)');
    dgg.addColorStop(0.35, 'rgba(255,179,71,0.35)');
    dgg.addColorStop(1, 'rgba(255,179,71,0)');
    dgc.fillStyle = dgg;
    dgc.fillRect(0, 0, 64, 64);
    this.dotGlowSprite = dg;

    // reflection streaks: irregular gaps and 2-3 broken segments each, fixed
    // at startup so the shape never jitters between frames
    this._reflGap = Array.from({ length: 12 }, () => 6 + Math.random() * 6);
    this._reflSeg = Array.from({ length: 12 }, () => {
      const n = Math.random() < 0.5 ? 2 : 3;
      const segs = [];
      for (let j = 0; j < n; j++) {
        const s0 = j / n + Math.random() * 0.08;
        segs.push({ s: s0, e: Math.min(1, s0 + (1 / n) * (0.45 + Math.random() * 0.4)) });
      }
      return segs;
    });

    // reflection stroke widths: slow random targets, eased toward
    this._reflW = Array.from({ length: 12 }, () => 40 + Math.random() * 70);
    this._reflTarget = [...this._reflW];
    this._reflAt = 0;

    // seven breath dots: when each lit, and when it began fading back
    this.dots = Array.from({ length: 7 }, () => ({ litAt: 0, unlitAt: 0 }));
    this._dotCount = 0;

    this.ripples = [];   // warm rings: {x, y, t0, dur, rx0, rx1, k}
    this.ink = [];       // {x, y, vx, vy, r, alpha}
    this._textBob = 0;   // heavily smoothed diya bob — the worry text follows
                         // only this, never the flame's flicker
    this._layers = {};   // offscreen caches for static layers, keyed by name
  }

  /** Cached offscreen layer, rebuilt only when the window size changes. */
  _layer(name, w, h, paint) {
    const c = this._layers[name];
    if (c && c.w === w && c.h === h) return c.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    paint(ctx, w, h);
    this._layers[name] = { w, h, canvas };
    return canvas;
  }

  get waterY() { return window.innerHeight * 0.62; }
  /** viewport scale: 1 at 720p, ~1.5 at 1080p */
  get vs() { return Math.min(2.2, Math.max(0.8, window.innerHeight / 720)); }

  /** A ring on the water. `big` is the splash as the diya first settles. */
  addRipple(px, py, big = false) {
    this._pushRing({ x: px, y: py, rx0: 40, rx1: big ? 260 : 150, dur: big ? 4500 : 3000 });
  }

  /** One ring per exhale: calm spreads slow and wide, rushed is quick and small. */
  breathRipple(px, py, calm) {
    this._pushRing(calm
      ? { x: px, y: py, rx0: 40, rx1: 260, dur: 4500 }
      : { x: px, y: py, rx0: 40, rx1: 120, dur: 1800 });
  }

  _pushRing(ring) {
    ring.t0 = performance.now();
    ring.seed = Math.random() * Math.PI * 2;
    ring.k = this.vs / 1.5;                 // spec sizes are tuned for 1080p
    this.ripples.push(ring);
    while (this.ripples.length > 4) this.ripples.shift();
  }

  spawnInk(px, py) {
    const v = this.vs;
    for (let i = 0; i < 26; i++) {
      this.ink.push({
        x: px + (Math.random() - 0.5) * 60 * v,
        y: py + (Math.random() - 0.5) * 14 * v,
        vx: (Math.random() - 0.5) * 6 * v,
        vy: (12 + Math.random() * 22) * v,
        r: (1 + Math.random() * 2.2) * v,
        alpha: 0.5 + Math.random() * 0.3,
      });
    }
  }

  /** Light or unlight the breath dots; push-back fades them right to left. */
  setBreathCount(n, now) {
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (i < n && !d.litAt) { d.litAt = now; d.unlitAt = 0; }
    }
    if (n < this._dotCount) {
      for (let i = this.dots.length - 1; i >= n; i--) {
        const d = this.dots[i];
        if (d.litAt && !d.unlitAt) d.unlitAt = now + (this.dots.length - 1 - i) * 150;
      }
    }
    this._dotCount = n;
  }

  /** Rings and reflection drawn into one offscreen layer, then composited
   *  back blurred, so the water reads as soft light rather than geometry. */
  _waterFx(ctx, now, t, s, w, h) {
    this.ripples = this.ripples.filter((r) => now - r.t0 < r.dur);
    if (s.diya.alpha < 0.02) return;
    const k = this.vs / 1.5;
    const sc = s.diya.scale * this.vs * 1.35;
    const rk = s.diya.scale * k;
    const energy = s.flameEnergy ?? 0.5;
    const cx = s.diya.x * w, cy = s.diya.y * h;

    const fw = Math.min(w, 820 * k), fh = Math.min(h, 340 * k);
    const ox = cx - fw / 2, oy = cy - 80 * k;
    const layer = this._fxLayerFor(fw, fh);
    const g = layer.ctx;
    g.clearRect(0, 0, fw, fh);
    g.globalCompositeOperation = 'lighter';

    // rings: soft bands, uneven around the circumference, the near (lower)
    // arc clear and the far arc barely there; only the newest reads clearly
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      const age = (now - r.t0) / r.dur;
      const rx = (r.rx0 + (r.rx1 - r.rx0) * (1 - Math.pow(1 - age, 3))) * r.k;
      const base = 0.18 * (1 - age) * (i === this.ripples.length - 1 ? 1 : 0.15);
      if (base < 0.005) continue;
      g.lineWidth = 6 * k;
      const SEG = 24;
      for (let j = 0; j < SEG; j++) {
        const a0 = (j / SEG) * Math.PI * 2, a1 = ((j + 1) / SEG) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const near = Math.sin(am) > 0 ? 1 : 0.2;
        const broken = 0.5 + 0.5 * Math.sin(am * 3 + r.seed);
        const a = base * near * broken;
        if (a < 0.005) continue;
        g.strokeStyle = `rgba(255,180,90,${a})`;
        g.beginPath();
        g.ellipse(r.x - ox, r.y - oy, rx, rx * 0.22, 0, a0, a1);
        g.stroke();
      }
    }

    // reflection: broken streaks, widest and brightest at the waterline,
    // narrowing and fading quickly below
    if (now - this._reflAt > 800) {
      this._reflAt = now;
      this._reflTarget = this._reflTarget.map(() => 40 + Math.random() * 70);
    }
    let y = (cy + 9 * sc) - oy + 6 * rk;
    for (let i = 0; i < 12; i++) {
      this._reflW[i] += (this._reflTarget[i] - this._reflW[i]) * 0.04;
      y += this._reflGap[i] * rk;
      const taper = Math.pow(1 - i / 12, 1.8);         // gone within ~120 px
      const ww = this._reflW[i] * rk * (0.5 + 0.5 * taper);
      const off = Math.sin(t * 1.3 + i * 0.9) * (3 + i * 0.6) * rk;
      const a = 0.85 * taper * energy;
      if (a < 0.005) continue;
      g.globalAlpha = a;
      const x0 = cx - ox + off - ww / 2;
      for (const seg of this._reflSeg[i]) {
        g.drawImage(this.streakSprite, x0 + seg.s * ww, y - 3.5 * rk,
                    (seg.e - seg.s) * ww, 7 * rk);
      }
    }
    g.globalAlpha = 1;

    // Blur on the small half-res layer, then composite with no filter at all:
    // ctx.filter costs scale with the DESTINATION area, so blurring during the
    // full-size composite is many times more expensive than blurring here.
    const b = layer.blurCtx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, layer.blurCanvas.width, layer.blurCanvas.height);
    b.filter = `blur(${(2.2 * k).toFixed(1)}px)`;      // half-res px ≈ 4.4 CSS px
    b.drawImage(layer.canvas, 0, 0);
    b.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(layer.blurCanvas, 0, 0, layer.blurCanvas.width, layer.blurCanvas.height,
                  ox, oy, fw, fh);
    ctx.restore();
  }

  /** Wave crests inside the diya's glow, redrawn warm so the water still
   *  reads as water where the lamplight falls on it. */
  _waveGlints(ctx, t, s, w, h) {
    if (s.diya.alpha < 0.2) return;
    const v = this.vs, waterY = this.waterY;
    const dpx = s.diya.x * w, dpy = s.diya.y * h;
    const energy = s.flameEnergy ?? 0.5;
    const spanX = 0.13 * w, spanY = 110 * v * s.diya.scale;
    for (let k = 1; k <= 12; k++) {
      const d = (k / 12) ** 2;
      const y = waterY + d * (h - waterY - 8) + 4;
      if (Math.abs(y - dpy) > spanY) continue;
      const amp = (0.5 + d * 3.0) * v;
      const lambda = (46 + d * 190) * v;
      const phase = t * (0.12 + d * 0.38);
      const near = 1 - Math.abs(y - dpy) / spanY;
      ctx.beginPath();
      for (let x = dpx - spanX; x <= dpx + spanX; x += 14) {
        const yy = y + Math.sin((x / lambda) * Math.PI * 2 + phase * Math.PI * 2 + k * 1.7) * amp;
        x <= dpx - spanX ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      // fade the ends into the dark water — a hard cut reads as stripes
      const fade = (col, a) => {
        const gr = ctx.createLinearGradient(dpx - spanX, 0, dpx + spanX, 0);
        gr.addColorStop(0, `rgba(${col},0)`);
        gr.addColorStop(0.25, `rgba(${col},${a * 0.55})`);
        gr.addColorStop(0.5, `rgba(${col},${a})`);
        gr.addColorStop(0.75, `rgba(${col},${a * 0.55})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        return gr;
      };
      const soft = near * near * energy * s.diya.alpha;
      ctx.strokeStyle = fade('255,196,120', 0.075 * soft);
      ctx.lineWidth = 2.4 + d * 3;
      ctx.stroke();
      ctx.strokeStyle = fade('255,208,140', 0.095 * soft);
      ctx.lineWidth = 0.9 + d * 1.2;
      ctx.stroke();
    }
  }

  _fxLayerFor(fw, fh) {
    let f = this._fxLayer;
    if (!f || f.w !== fw || f.h !== fh) {
      const canvas = document.createElement('canvas');
      const dpr = devicePixelRatio * 0.5;       // half-res: the upscale softens too
      canvas.width = Math.ceil(fw * dpr);
      canvas.height = Math.ceil(fh * dpr);
      const c2 = canvas.getContext('2d');
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = canvas.width;
      blurCanvas.height = canvas.height;
      f = this._fxLayer = {
        w: fw, h: fh, canvas, ctx: c2,
        blurCanvas, blurCtx: blurCanvas.getContext('2d'),
      };
    }
    return f;
  }

  _drawBreathDots(ctx, now, s, w, h) {
    const k = this.vs / 1.5;
    const cx = s.diya.x * w, cy = s.diya.y * h + 150 * k;
    const gap = 22 * k, rad = 5 * k;
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      let lit = 0;
      if (d.litAt) {
        lit = Math.min(1, (now - d.litAt) / 600);           // 600 ms fade-in
        if (d.unlitAt && now >= d.unlitAt) {
          lit *= Math.max(0, 1 - (now - d.unlitAt) / 150);  // 150 ms fade-out
          if (lit <= 0) { d.litAt = 0; d.unlitAt = 0; }
        }
      }
      const x = cx + (i - 3) * gap;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(x, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      if (lit > 0.01) {
        ctx.save();
        ctx.globalAlpha = lit;
        const g = 14 * k;
        ctx.drawImage(this.dotGlowSprite, x - g, cy - g, g * 2, g * 2);
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.arc(x, cy, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  draw(now, s) {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    const waterY = this.waterY;
    const t = now / 1000;
    const v = this.vs;

    // ---- sky: near-black desaturated navy, warming faintly at the horizon ----
    const sky = ctx.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, '#040508');
    sky.addColorStop(0.6, '#080a12');
    sky.addColorStop(1, '#10121a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, waterY);
    // amber haze over the far bank: the glow of the ghat lights in the air
    const haze = ctx.createLinearGradient(0, waterY - h * 0.13, 0, waterY);
    haze.addColorStop(0, 'rgba(255,170,90,0)');
    haze.addColorStop(1, 'rgba(255,170,90,0.055)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, waterY - h * 0.13, w, h * 0.13);

    for (const st of this.stars) {
      const a = 0.18 + 0.30 * (0.5 + 0.5 * Math.sin(t * st.tw + st.ph));
      ctx.fillStyle = `rgba(205,208,225,${a})`;
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * waterY, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- full moon, high and clear of the far bank ----
    const mx = MOON.x * w;
    const my = h * 0.27;
    const mr = 21 * v;
    const mglow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 2.1);
    mglow.addColorStop(0, 'rgba(236,228,206,0.12)');
    mglow.addColorStop(1, 'rgba(236,228,206,0)');
    ctx.fillStyle = mglow;
    ctx.fillRect(mx - mr * 2.1, my - mr * 2.1, mr * 4.2, mr * 4.2);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.moonSprite, mx - mr * 1.25, my - mr * 1.25, mr * 2.5, mr * 2.5);
    ctx.globalAlpha = 1;

    // ---- far bank, out of focus: a blurred dark band with vague shapes ----
    ctx.drawImage(this._layer('farbank', w, h, (c) => {
      // ghat buildings and homes, heavily defocused: blocks and the odd spire
      c.filter = 'blur(9px)';
      c.fillStyle = '#0b0c14';
      for (const b of this.farBuildings) {
        const x0 = b.x0 * w, x1 = b.x1 * w, bh = b.h * h;
        if (b.spire) {
          c.beginPath();
          c.moveTo(x0, waterY);
          c.lineTo((x0 + x1) / 2, waterY - bh);
          c.lineTo(x1, waterY);
          c.closePath();
          c.fill();
        } else {
          c.fillRect(x0, waterY - bh, x1 - x0, bh + 12);
        }
      }
      // low bank bumps in front of them
      c.fillStyle = '#0c0d15';
      c.beginPath();
      c.moveTo(0, waterY + 12);
      for (const b of this.farBumps) {
        c.lineTo(b.x0 * w, waterY - b.h * h * 0.4);
        c.quadraticCurveTo(((b.x0 + b.x1) / 2) * w, waterY - b.h * h,
                           b.x1 * w, waterY - b.h * h * 0.4);
      }
      c.lineTo(w, waterY + 12);
      c.closePath();
      c.fill();
      // warm window lights in the homes, soft through the haze
      c.filter = 'blur(3px)';
      c.fillStyle = 'rgba(255,185,105,0.32)';
      for (const b of this.farBuildings) {
        for (const win of b.windows) {
          c.fillRect((b.x0 + (b.x1 - b.x0) * win.fx) * w,
                     waterY - b.h * h * win.fy, 2.2, 3);
        }
      }
      // slightly darker, lower second band for a hint of depth
      c.filter = 'blur(5px)';
      c.fillStyle = '#080910';
      c.fillRect(0, waterY - h * 0.012, w, h * 0.014 + 12);
      c.filter = 'none';
    }), 0, 0, w, h);

    // warm bokeh lights along the far bank, gently flickering
    for (const g of this.bokeh) {
      const gx = g.x * w, gy = waterY - 2 - g.r * 0.4 * v;
      const flick = (0.72 + 0.28 * Math.sin(t * (0.9 + g.b) + g.ph)) * g.b;
      const r = g.r * v;
      ctx.globalAlpha = flick;
      ctx.drawImage(this.bokehSprites[g.warm > 0.35 ? 'warm' : 'pale'],
                    gx - r, gy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // ---- water: near-black, faint cool grey-blue, so warm light carries ----
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, '#0b0d15');
    water.addColorStop(0.3, '#070810');
    water.addColorStop(1, '#030407');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    // the far shore dissolves into the water instead of meeting a drawn line
    const seam = ctx.createLinearGradient(0, waterY - 10, 0, waterY + 16);
    seam.addColorStop(0, 'rgba(20,18,22,0)');
    seam.addColorStop(0.4, 'rgba(26,22,24,0.35)');
    seam.addColorStop(1, 'rgba(11,13,21,0)');
    ctx.fillStyle = seam;
    ctx.fillRect(0, waterY - 10, w, 26);

    // far lights on the water: two or three tiny warm streaks that wobble
    for (const g of this.bokeh) {
      const gx = g.x * w;
      const flick = (0.72 + 0.28 * Math.sin(t * (0.9 + g.b) + g.ph)) * g.b;
      const r = g.r * v;
      for (let j = 0; j < 3; j++) {
        const yy = waterY + (3 + j * 5) * v;
        const wob = Math.sin(t * (1.1 + j * 0.3) + g.ph + j) * (1.5 + j) * v;
        const ww = r * (2.2 - j * 0.5);
        const a = 0.17 * flick * (1 - j / 3);
        if (a < 0.006) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(this.streakSprite, gx + wob - ww / 2, yy - 2.5 * v, ww, 5 * v);
      }
    }
    ctx.globalAlpha = 1;

    // tiny distant floating diyas — other people's offerings, softly blurred
    for (const f of this.floaters) {
      const fx2 = ((f.x0 + t * f.speed / 60) % 1.06 - 0.03) * w;
      const fy2 = waterY + f.d * (h - waterY) * 0.9 + Math.sin(t * 0.7 + f.ph) * 1.2;
      const flick = (0.6 + 0.4 * Math.sin(t * 1.8 + f.ph)) * f.b;
      const r = 4.5 * v;
      ctx.globalAlpha = flick;
      ctx.drawImage(this.bokehSprites.warm, fx2 - r, fy2 - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(255,185,95,${0.08 * flick})`;
      ctx.fillRect(fx2 - 1.5 * v, fy2 + 2, 3 * v, 8 * v);
    }

    // slow, broken wave segments drifting downstream — soft double stroke
    // (wide faint pass under a narrow core) so each crest reads as a blur
    const diyaOn = s.diya.alpha > 0.2;
    const dpx = s.diya.x * w, dpy = s.diya.y * h;
    ctx.lineCap = 'round';
    for (let k = 0; k < this.waveBands.length; k++) {
      const band = this.waveBands[k];
      const d = band.d;
      const y = waterY + d * (h - waterY - 8) + 4;
      const amp = (0.4 + d * 2.2) * v;
      const lambda = (70 + d * 210) * v;
      const drift = t * (5 + d * 22) * band.sp * v;
      for (const seg of band.segs) {
        const len = seg.len * w;
        const span = w + 2 * len;
        const x0 = ((seg.x * span + drift) % span) - len;
        ctx.beginPath();
        for (let x = x0; x <= x0 + len; x += 16) {
          let yy = y + Math.sin((x / lambda) * Math.PI * 2 + k * 1.7) * amp;
          if (diyaOn) {
            const fxg = Math.exp(-(((x - dpx) / (55 * v * s.diya.scale)) ** 2));
            const ddy = y - dpy;
            const fyg = Math.exp(-((ddy / (40 * v * s.diya.scale)) ** 2));
            yy += Math.sign(ddy || 1) * 4 * v * s.diya.scale * fxg * fyg * s.diya.alpha;
          }
          x === x0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = `rgba(140,152,180,${0.007 + d * 0.009})`;
        ctx.lineWidth = 3 + d * 5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(146,158,186,${0.008 + d * 0.011})`;
        ctx.lineWidth = 1 + d * 1.4;
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';

    // moonlight: a faint broken silver shimmer drifting down the water
    const mlen = 0.5 * (h - waterY);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let yy = 0; yy <= mlen; yy += 11) {
      const fade = 1 - yy / mlen;
      const patch = (0.5 + 0.5 * Math.sin(t * 0.8 + yy * 0.11))
                  * (0.4 + 0.6 * Math.sin(t * 0.33 + yy * 0.045 + 2));
      const a = 0.05 * fade * Math.max(0, patch);
      if (a < 0.004) continue;
      const off = Math.sin(t * 1.1 + yy * 0.06) * (3 + yy * 0.09);
      const ww = (14 + yy * 0.22) * v * (0.6 + 0.4 * Math.sin(t * 0.7 + yy * 0.2));
      ctx.globalAlpha = a;
      ctx.drawImage(this.silverStreakSprite, mx + off - ww / 2, waterY + 4 + yy, ww, 7 * v);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // ---- shimmer glints, brighter near light sources ----
    const glintSources = [mx];
    if (s.diya.alpha > 0.2) glintSources.push(s.diya.x * w);
    glintSources.push(0.125 * w, 0.255 * w);        // step lamps
    const sh = 0.35 + 0.65 * (s.shimmer ?? 0.5);
    for (const sp of this.shimmerSpecks) {
      sp.x += sp.sp * (0.3 + sp.d) * 0.016;
      if (sp.x > 1.02) sp.x = -0.02;
      const px = sp.x * w;
      const y = waterY + sp.d * sp.d * (h - waterY) * 0.9 + 6;
      let boost = 1;
      for (const sx of glintSources) {
        const dx = (px - sx) / (0.07 * w);
        boost += 2.2 * Math.exp(-dx * dx);
      }
      const a = Math.min(0.30, sh * 0.075 * boost) * (0.5 + 0.5 * Math.sin(t * 2.0 + sp.ph));
      // within the diya's glow, crests catch its warm light instead of cool
      const nearDiya = diyaOn
        ? Math.exp(-(((px - dpx) / (0.09 * w)) ** 2) - (((y - dpy) / (0.12 * h)) ** 2))
        : 0;
      ctx.fillStyle = nearDiya > 0.25
        ? `rgba(255,185,105,${Math.min(0.4, a * (1 + nearDiya) * s.flameEnergy)})`
        : `rgba(175,185,210,${a})`;
      ctx.fillRect(px, y, (3 + sp.d * 14) * v, 1);
    }

    // ---- ghat steps ----
    this._drawSteps(ctx, t, w, h, s);

    // ---- diya ----
    if (s.diya.alpha > 0.01) this._drawDiya(now, s, w, h);

    // ---- rings + reflection, blurred into the water over the diya's glow ----
    this._waterFx(ctx, now, t, s, w, h);
    this._waveGlints(ctx, t, s, w, h);

    // ---- ink particles (worry dissolving) ----
    this.ink = this.ink.filter((p) => p.alpha > 0.015);
    for (const p of this.ink) {
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      p.vy *= 0.985;
      if (p.y > waterY + 8) { p.vy = 0; p.vx *= 1.04; p.r += 0.07; p.alpha *= 0.962; }
      else p.alpha *= 0.996;
      ctx.fillStyle = `rgba(190,200,235,${p.alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- seven breath diyas ----
    if (s.breath && s.breath.visible) this._drawBreathDots(ctx, now, s, w, h);
  }

  // One connected sandstone staircase descending into the river at bottom-left.
  // Treads are lighter top surfaces, risers darker front faces; the lowest
  // steps are partly under water, with a soft lapping waterline.
  _drawSteps(ctx, t, w, h, s) {
    const N = 6;
    const topY = h * 0.74;
    const diyaGlow = s.diya.alpha * s.flameEnergy;
    // receding step heights: taller near the viewer's eye line, tighter below
    const hs = [];
    let total = 0;
    for (let i = 0; i < N; i++) { const sh = 1.14 - i * 0.05; hs.push(sh); total += sh; }
    const ys = [topY];
    for (let i = 0; i < N; i++) ys.push(ys[i] + (hs[i] / total) * (h - topY));
    const edge = (i) => w * (0.13 + i * 0.036);
    const waterline = ys[N - 1] + (ys[N] - ys[N - 1]) * 0.35;   // lowest step: mostly submerged

    // static stonework (silhouette, treads, risers, grain, submerged tint) — cached
    ctx.drawImage(this._layer('steps', w, h, (c) => {
      const stone = c.createLinearGradient(0, topY, 0, h);
      stone.addColorStop(0, '#2b2114');
      stone.addColorStop(0.6, '#1e1710');
      stone.addColorStop(1, '#120d08');
      c.fillStyle = stone;
      c.beginPath();
      c.moveTo(0, topY);
      for (let i = 0; i < N; i++) {
        c.lineTo(edge(i), ys[i]);
        c.lineTo(edge(i), ys[i + 1]);
      }
      c.lineTo(0, h);
      c.closePath();
      c.fill();
      c.save();
      c.clip();   // everything below stays inside the staircase

      for (let i = 0; i < N; i++) {
        const y = ys[i], yn = ys[i + 1], e = edge(i);
        // tread: the visible top surface, foreshortened, its right corner
        // skewed back for perspective (lower steps skew more — nearer the eye)
        const treadT = (yn - y) * 0.40;
        const skew = 7 + i * 3.5;
        const tg = c.createLinearGradient(0, y, 0, y + treadT);
        tg.addColorStop(0, 'rgba(226,192,140,0.16)');
        tg.addColorStop(1, 'rgba(226,192,140,0.05)');
        c.fillStyle = tg;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(e - skew, y);          // back edge, set back
        c.lineTo(e, y + treadT);        // front-right corner comes forward
        c.lineTo(0, y + treadT);
        c.closePath();
        c.fill();
        // nosing highlight along the tread's front edge — this is what makes
        // the flight read as one stair, not a stack of boxes
        c.fillStyle = 'rgba(240,212,166,0.22)';
        c.fillRect(0, y + treadT - 1, e, 1.4);
        // back-edge hairline (where this tread meets the riser above)
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(0, y, e - skew, 1);
        // riser: the darker vertical face below the tread
        const rg = c.createLinearGradient(0, y + treadT, 0, yn);
        rg.addColorStop(0, 'rgba(0,0,0,0.30)');
        rg.addColorStop(1, 'rgba(0,0,0,0.16)');
        c.fillStyle = rg;
        c.fillRect(0, y + treadT, e, yn - y - treadT);
        // slanted side edge catching faint light
        c.strokeStyle = 'rgba(226,192,140,0.08)';
        c.beginPath();
        c.moveTo(e - skew, y);
        c.lineTo(e, y + treadT);
        c.lineTo(e, yn);
        c.stroke();
        // right end dissolves into the dark water — a narrow fade left a
        // visible vertical seam that read as a rectangle beside the steps
        const sg = c.createLinearGradient(e - 64, 0, e, 0);
        sg.addColorStop(0, 'rgba(4,5,12,0)');
        sg.addColorStop(0.55, 'rgba(4,5,12,0.45)');
        sg.addColorStop(1, 'rgba(4,5,12,0.97)');
        c.fillStyle = sg;
        c.fillRect(e - 64, y, 64, yn - y);
      }
      for (const n of this.stoneNoise) {
        c.fillStyle = n.warm
          ? `rgba(226,190,140,${n.a})`
          : `rgba(0,0,0,${n.a * 1.4})`;
        c.fillRect(n.x * edge(N - 1), topY + n.y * (h - topY), 1.5, 1.5);
      }
      // submerged portion: translucent water over the lowest steps — still
      // inside the staircase clip, so no dark rectangle bleeds onto open water
      const wg = c.createLinearGradient(0, waterline, 0, h);
      wg.addColorStop(0, 'rgba(10,14,34,0.30)');
      wg.addColorStop(1, 'rgba(4,5,16,0.72)');
      c.fillStyle = wg;
      c.fillRect(0, waterline, edge(N - 1) + 4, h - waterline);
      // soft edge where the stone enters the river
      const edgeG = c.createLinearGradient(0, waterline - 7, 0, waterline + 9);
      edgeG.addColorStop(0, 'rgba(150,180,228,0)');
      edgeG.addColorStop(0.45, 'rgba(150,180,228,0.10)');
      edgeG.addColorStop(1, 'rgba(150,180,228,0)');
      c.fillStyle = edgeG;
      c.fillRect(0, waterline - 7, edge(N - 1) + 4, 16);
      c.restore();
    }), 0, 0, w, h);

    // warm breathing light from the diya on the lower stone (live), clipped to
    // the stonework so its gradient never ends in a visible rectangle
    if (diyaGlow > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, topY);
      for (let i = 0; i < N; i++) { ctx.lineTo(edge(i), ys[i]); ctx.lineTo(edge(i), ys[i + 1]); }
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.clip();
      const gl = ctx.createRadialGradient(s.diya.x * w, s.diya.y * h, 10, s.diya.x * w, s.diya.y * h, w * 0.22);
      gl.addColorStop(0, `rgba(255,170,80,${0.07 * diyaGlow})`);
      gl.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(0, topY, edge(N - 1) + 4, h - topY);
      ctx.restore();
    }

    // lapping waterline + small ripples against the stone (live)
    for (let x = 0; x <= edge(N - 1); x += 10) {
      const yy = waterline + Math.sin(t * 1.3 + x * 0.04) * 1.6;
      const a = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.1 + x * 0.09));
      ctx.fillStyle = `rgba(165,190,238,${a})`;
      ctx.fillRect(x, yy, 7, 1.2);
    }

    // two small lamps on the treads, warm spill on the stone
    for (const [lx, li] of [[0.125, 1], [0.255, 3]]) {
      const px = lx * w, ly = ys[li] - 1;
      const f = 0.72 + 0.28 * Math.sin(t * 6.3 + li * 2.1);
      // light spill across the tread
      const spill = ctx.createRadialGradient(px, ly, 1, px, ly, 46);
      spill.addColorStop(0, `rgba(255,180,95,${0.14 * f})`);
      spill.addColorStop(1, 'rgba(255,180,95,0)');
      ctx.fillStyle = spill;
      ctx.save();
      ctx.scale(1, 0.4);
      ctx.beginPath();
      ctx.arc(px, ly / 0.4, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // air glow + flame + bowl
      const lg = ctx.createRadialGradient(px, ly - 5, 1, px, ly - 5, 30);
      lg.addColorStop(0, `rgba(255,185,95,${0.42 * f})`);
      lg.addColorStop(1, 'rgba(255,185,95,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(px - 30, ly - 35, 60, 60);
      ctx.fillStyle = '#3a2213';
      ctx.beginPath();
      ctx.ellipse(px, ly, 4.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,215,140,${0.95 * f})`;
      ctx.beginPath();
      ctx.ellipse(px, ly - 4.5, 1.5, 3.2 * f, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawDiya(now, s, w, h) {
    const ctx = this.ctx;
    const t = now / 1000;
    const sc = s.diya.scale * this.vs * 1.35;   // viewport-relative diya size
    const bob = Math.sin(t * 1.57) * 2.4 * sc + Math.sin(t * 0.6 + 1.3) * 0.6 * sc;
    const dx = s.diya.x * w;
    const dy = s.diya.y * h + bob;
    ctx.save();
    ctx.globalAlpha = s.diya.alpha;

    const calm = s.calm;
    const energy = s.flameEnergy;
    const jitter = calm ? 0 : (Math.random() - 0.5) * 16 * (1 - energy);
    const flameH = sc * (16 + 30 * energy + (s.trace ?? 0) * 9) + jitter * 0.4;
    const sway = Math.sin(t * 3.1) * 1.6 * sc + (calm ? 0 : jitter * 0.5);
    const fx = dx, fy = dy - 5.5 * sc;

    // lamplight pooling on the water: an ellipse flattened about 2.2:1,
    // with a steep falloff so it has no visible edge
    const poolR = 130 * sc, poolY = dy + 12 * sc;
    ctx.save();
    ctx.translate(dx, poolY);
    ctx.scale(1, 1 / 2.2);
    const wg = ctx.createRadialGradient(0, 0, 2, 0, 0, poolR);
    wg.addColorStop(0, `rgba(255,172,74,${0.26 * energy})`);
    wg.addColorStop(0.18, `rgba(255,168,70,${0.12 * energy})`);
    wg.addColorStop(0.45, `rgba(255,164,66,${0.035 * energy})`);
    wg.addColorStop(1, 'rgba(255,164,66,0)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(0, 0, poolR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const waterLineY = dy + 9 * sc;              // where the bowl meets the river

    // a small round glow around the flame itself
    const gr = 46 * sc;
    const glow = ctx.createRadialGradient(fx, fy - flameH * 0.45, 1, fx, fy - flameH * 0.45, gr);
    glow.addColorStop(0, `rgba(255,198,112,${0.34 + 0.24 * energy})`);
    glow.addColorStop(0.3, `rgba(255,188,96,${0.12 + 0.10 * energy})`);
    glow.addColorStop(0.65, `rgba(255,180,86,${0.03 + 0.03 * energy})`);
    glow.addColorStop(1, 'rgba(255,180,86,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy - flameH * 0.45, gr, 0, Math.PI * 2);
    ctx.fill();

    // ---- clay diya: deep terracotta bowl with a gold garland, after the
    // classic Diwali lamp: wide shallow body, pinched rim, tall teardrop flame.
    const halfW = 34 * sc, depth = 15 * sc;

    // body
    const clay = ctx.createLinearGradient(dx, dy - 2 * sc, dx, dy + depth);
    clay.addColorStop(0, '#a4421a');
    clay.addColorStop(0.45, '#8d3414');
    clay.addColorStop(1, '#4e1c09');
    ctx.fillStyle = clay;
    ctx.beginPath();
    ctx.ellipse(dx, dy, halfW, depth, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();

    // raised pinch at the centre of the rim, where the wick sits
    ctx.beginPath();
    ctx.moveTo(dx - 8 * sc, dy);
    ctx.quadraticCurveTo(dx, dy - 7 * sc, dx + 8 * sc, dy);
    ctx.closePath();
    ctx.fill();

    // rim and the oil inside it, catching the flame
    ctx.fillStyle = '#b55224';
    ctx.beginPath();
    ctx.ellipse(dx, dy, halfW, 4.2 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,185,95,${0.22 + 0.38 * energy})`;
    ctx.beginPath();
    ctx.ellipse(dx, dy + 0.6 * sc, halfW * 0.8, 2.6 * sc, 0, 0, Math.PI * 2);
    ctx.fill();

    // gold garland: two scalloped arcs, a row of dots, a row of petals
    const gold = `rgba(240,170,55,${0.72 + 0.28 * energy})`;
    ctx.strokeStyle = gold;
    ctx.lineWidth = 1.7 * sc;
    ctx.beginPath();
    ctx.moveTo(dx - halfW * 0.94, dy + 2.2 * sc);
    ctx.quadraticCurveTo(dx, dy + 11.5 * sc, dx + halfW * 0.94, dy + 2.2 * sc);
    ctx.stroke();
    ctx.lineWidth = 1.1 * sc;
    ctx.beginPath();
    ctx.moveTo(dx - halfW * 0.86, dy + 4.6 * sc);
    ctx.quadraticCurveTo(dx, dy + 13.4 * sc, dx + halfW * 0.86, dy + 4.6 * sc);
    ctx.stroke();
    ctx.fillStyle = gold;
    for (let i = -3; i <= 3; i++) {
      const u = i / 3;                                   // -1..1 across the bowl
      ctx.beginPath();
      ctx.arc(dx + u * halfW * 0.76, dy + 2.6 * sc + (1 - u * u) * 5.6 * sc,
              1.5 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = -2; i <= 2; i++) {
      const u = i / 2.4;
      ctx.beginPath();
      ctx.ellipse(dx + u * halfW * 0.58, dy + 8.4 * sc + (1 - u * u) * 3.6 * sc,
                  1.3 * sc, 2.7 * sc, u * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // seated in the river: the bowl's lowest ~15% lies under the surface
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(dx, dy, 32 * sc, 12 * sc, 0, 0, Math.PI, false);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,10,20,0.55)';
    ctx.fillRect(dx - 34 * sc, waterLineY, 68 * sc, 16 * sc);
    ctx.restore();
    // a single soft waterline across the hull — no dashes
    const wlGrad = ctx.createLinearGradient(dx - 32 * sc, 0, dx + 32 * sc, 0);
    wlGrad.addColorStop(0, 'rgba(180,200,235,0)');
    wlGrad.addColorStop(0.5, 'rgba(180,200,235,0.22)');
    wlGrad.addColorStop(1, 'rgba(180,200,235,0)');
    ctx.fillStyle = wlGrad;
    ctx.fillRect(dx - 32 * sc, waterLineY + Math.sin(t * 1.4) * 0.6 * sc, 64 * sc, 1.2);

    // wick
    ctx.fillStyle = '#2a1206';
    ctx.beginPath();
    ctx.moveTo(fx - 1.2 * sc, fy + 3 * sc);
    ctx.lineTo(fx, fy - 2 * sc);
    ctx.lineTo(fx + 1.2 * sc, fy + 3 * sc);
    ctx.closePath();
    ctx.fill();

    // flame — outer teardrop
    const tip = fy - Math.max(9 * sc, flameH);
    const outer = ctx.createLinearGradient(fx, fy, fx, tip);
    outer.addColorStop(0, 'rgba(255,110,25,0.95)');
    outer.addColorStop(0.45, '#ffa31f');
    outer.addColorStop(1, 'rgba(255,221,150,0.92)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(fx, fy + 1.5 * sc);
    ctx.bezierCurveTo(fx - 7.5 * sc, fy - flameH * 0.22, fx - 6 * sc, fy - flameH * 0.68,
                      fx + sway, tip);
    ctx.bezierCurveTo(fx + 6 * sc, fy - flameH * 0.68, fx + 7.5 * sc, fy - flameH * 0.22,
                      fx, fy + 1.5 * sc);
    ctx.fill();
    // flame — bright core
    ctx.fillStyle = 'rgba(255,243,196,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.bezierCurveTo(fx - 3.2 * sc, fy - flameH * 0.18, fx - 2.6 * sc, fy - flameH * 0.46,
                      fx + sway * 0.5, fy - flameH * 0.62);
    ctx.bezierCurveTo(fx + 2.6 * sc, fy - flameH * 0.46, fx + 3.2 * sc, fy - flameH * 0.18,
                      fx, fy);
    ctx.fill();

    // worry text, written above the diya. Anchored to a heavily low-passed
    // bob and a fixed height — never to the flame, whose flicker and noise
    // would make the words shiver on video. Positions snap to whole pixels.
    if (s.worry.text && s.worry.alpha > 0.01) {
      this._textBob += (bob - this._textBob) * 0.03;
      const tx = Math.round(fx);
      const anchor = Math.round(s.diya.y * h + this._textBob - 76 * sc);
      ctx.globalAlpha = s.diya.alpha * s.worry.alpha;
      ctx.font = `italic 500 ${Math.max(11, 16 * sc)}px 'Cormorant Garamond', Georgia`;
      ctx.textAlign = 'center';
      const lines = wrapText(s.worry.text, 28);
      ctx.shadowColor = 'rgba(255,200,120,0.6)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(243,233,201,0.92)';
      lines.forEach((ln, i) => {
        ctx.fillText(ln, tx, anchor - Math.round((lines.length - 1 - i) * 19 * sc));
      });
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

}

export function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > maxChars && cur) {
      lines.push(cur.trim());
      cur = word;
    } else cur += ' ' + word;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}
