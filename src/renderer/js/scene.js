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

    // far-bank skyline: curved shikharas, chhatris, havelis with lit windows,
    // the odd temple flag — generated once, rendered to a cached layer
    this.skyline = [];
    let flags = 0;
    for (let x = 0; x < 1; ) {
      const r = Math.random();
      const type = r < 0.22 ? 'shikhara' : r < 0.38 ? 'chhatri' : r < 0.72 ? 'haveli' : 'flat';
      const bw = type === 'chhatri' ? 0.012 + Math.random() * 0.008
               : type === 'shikhara' ? 0.016 + Math.random() * 0.012
               : 0.025 + Math.random() * 0.045;
      const bh = type === 'shikhara' ? 0.055 + Math.random() * 0.03
               : type === 'chhatri' ? 0.022 + Math.random() * 0.01
               : type === 'haveli' ? 0.04 + Math.random() * 0.045
               : 0.014 + Math.random() * 0.012;
      const b = { x0: x, x1: Math.min(1, x + bw), h: bh, type, windows: [], flag: false };
      if (type === 'haveli') {
        const rows = 2 + Math.floor(Math.random() * 3);
        for (let ry = 0; ry < rows; ry++) {
          for (let cx = 0; cx < 3; cx++) {
            if (Math.random() < 0.3) b.windows.push({ fx: 0.2 + cx * 0.3, fy: 0.25 + ry * 0.22 });
          }
        }
      }
      if (type === 'shikhara' && flags < 2 && Math.random() < 0.5) { b.flag = true; flags++; }
      this.skyline.push(b);
      x += bw + (Math.random() < 0.3 ? 0.008 + Math.random() * 0.025 : 0.002);
    }
    // a few elevated lamps among the far buildings
    this.skylineLamps = Array.from({ length: 5 }, () => ({
      x: 0.05 + Math.random() * 0.9,
      dy: 0.008 + Math.random() * 0.022,   // height above waterline, fraction of h
      b: 0.5 + Math.random() * 0.5,
      ph: Math.random() * Math.PI * 2,
    }));

    // shore lamps at the waterline: uneven spacing, warm, varied
    this.ghatLights = [];
    for (let x = 0.03; x < 0.97; x += 0.05 + Math.random() * 0.13) {
      this.ghatLights.push({
        x: x + (Math.random() - 0.5) * 0.03,
        warm: Math.random(),
        b: 0.45 + Math.random() * 0.6,
        r: 1.0 + Math.random() * 1.2,
        ph: Math.random() * Math.PI * 2,
      });
    }

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

    this.ripples = [];   // {x, y, r, maxR, alpha}
    this.ink = [];       // {x, y, vx, vy, r, alpha}
    this._lastRipple = 0;
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

  addRipple(px, py, big = false) {
    const v = this.vs;
    this.ripples.push({ x: px, y: py, r: 6 * v, maxR: (big ? 90 : 46) * v, alpha: big ? 0.16 : 0.10 });
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

  draw(now, s) {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    const waterY = this.waterY;
    const t = now / 1000;
    const v = this.vs;

    // ---- sky ----
    const sky = ctx.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, '#060713');
    sky.addColorStop(0.7, '#0c1130');
    sky.addColorStop(1, '#141a3e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, waterY);

    for (const st of this.stars) {
      const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(t * st.tw + st.ph));
      ctx.fillStyle = `rgba(214,220,255,${a})`;
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * waterY, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- full moon, low over the far bank, off to one side ----
    const mx = MOON.x * w;
    const my = waterY - h * 0.095;        // roughly a third above the rooftops
    const mr = 21 * v;
    const mglow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 2.1);
    mglow.addColorStop(0, 'rgba(236,228,206,0.12)');
    mglow.addColorStop(1, 'rgba(236,228,206,0)');
    ctx.fillStyle = mglow;
    ctx.fillRect(mx - mr * 2.1, my - mr * 2.1, mr * 4.2, mr * 4.2);
    ctx.globalAlpha = 0.8;
    // sprite is drawn larger than the disc so its feathered edge isn't clipped
    ctx.drawImage(this.moonSprite, mx - mr * 1.25, my - mr * 1.25, mr * 2.5, mr * 2.5);
    ctx.globalAlpha = 1;

    // ---- far-bank skyline silhouette (static → cached layer) ----
    ctx.drawImage(this._layer('skyline', w, h, (c) => {
      c.fillStyle = '#0a0d1e';
      c.beginPath();
      c.moveTo(0, waterY);
      for (const b of this.skyline) {
        const x0 = b.x0 * w, x1 = b.x1 * w, bh = b.h * h;
        const xm = (x0 + x1) / 2, bw2 = (x1 - x0) / 2;
        c.lineTo(x0, waterY);
        if (b.type === 'shikhara') {
          // curved spire: base block, then concave taper to a finial
          const baseT = waterY - bh * 0.32;
          c.lineTo(x0, baseT);
          c.quadraticCurveTo(x0 + bw2 * 0.25, waterY - bh * 0.75, xm - bw2 * 0.12, waterY - bh * 0.96);
          c.lineTo(xm - bw2 * 0.12, waterY - bh);        // finial
          c.lineTo(xm + bw2 * 0.12, waterY - bh);
          c.lineTo(xm + bw2 * 0.12, waterY - bh * 0.96);
          c.quadraticCurveTo(x1 - bw2 * 0.25, waterY - bh * 0.75, x1, baseT);
        } else if (b.type === 'chhatri') {
          // domed pavilion on slim pillars
          const pT = waterY - bh * 0.5;                   // pillar tops / slab
          c.lineTo(x0, waterY - bh * 0.06);
          c.lineTo(x0 + bw2 * 0.15, waterY - bh * 0.06);
          c.lineTo(x0 + bw2 * 0.15, pT);
          c.lineTo(x0, pT);
          c.lineTo(x0, pT - bh * 0.08);                   // slab
          c.arc(xm, pT - bh * 0.08, bw2, Math.PI, 0);     // dome
          c.lineTo(x1, pT);
          c.lineTo(x1 - bw2 * 0.15, pT);
          c.lineTo(x1 - bw2 * 0.15, waterY - bh * 0.06);
          c.lineTo(x1, waterY - bh * 0.06);
        } else if (b.type === 'haveli') {
          // tall block, sometimes with a stepped-back upper storey
          const stepBack = bh > 0.06 * 1 ? 0.3 : 0;
          c.lineTo(x0, waterY - bh * (1 - stepBack));
          if (stepBack) {
            c.lineTo(x0 + bw2 * 0.4, waterY - bh * (1 - stepBack));
            c.lineTo(x0 + bw2 * 0.4, waterY - bh);
            c.lineTo(x1 - bw2 * 0.4, waterY - bh);
            c.lineTo(x1 - bw2 * 0.4, waterY - bh * (1 - stepBack));
          } else {
            c.lineTo(x1, waterY - bh);
          }
          c.lineTo(x1, waterY - bh * (1 - stepBack));
        } else {
          c.lineTo(x0, waterY - bh);
          c.lineTo(x1, waterY - bh);
        }
        c.lineTo(x1, waterY);
      }
      c.lineTo(w, waterY);
      c.closePath();
      c.fill();
      // temple flags: small pennants off the shikhara finials
      for (const b of this.skyline) {
        if (!b.flag) continue;
        const xm = ((b.x0 + b.x1) / 2) * w, top = waterY - b.h * h;
        c.strokeStyle = 'rgba(16,20,40,0.9)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(xm, top);
        c.lineTo(xm, top - 7);
        c.stroke();
        c.fillStyle = 'rgba(140,80,60,0.55)';
        c.beginPath();
        c.moveTo(xm, top - 7);
        c.lineTo(xm + 8, top - 5);
        c.lineTo(xm, top - 3);
        c.closePath();
        c.fill();
      }
      // warm lit windows on the havelis
      for (const b of this.skyline) {
        for (const win of b.windows) {
          const wx = (b.x0 + (b.x1 - b.x0) * win.fx) * w;
          const wy = waterY - b.h * h * win.fy;
          c.fillStyle = 'rgba(255,190,110,0.45)';
          c.fillRect(wx, wy, 1.6, 2.4);
        }
      }
    }), 0, 0, w, h);

    // elevated lamps among the buildings
    for (const L of this.skylineLamps) {
      const lx = L.x * w, ly = waterY - L.dy * h;
      const f = (0.7 + 0.3 * Math.sin(t * 2.3 + L.ph)) * L.b;
      ctx.fillStyle = `rgba(255,196,120,${0.8 * f})`;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.1 * v, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- water ----
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, '#101634');
    water.addColorStop(0.25, '#0a0e22');
    water.addColorStop(1, '#040510');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    ctx.fillStyle = 'rgba(150,160,210,0.12)';
    ctx.fillRect(0, waterY - 0.5, w, 1);

    // slow horizontal wave bands: tight and small near the horizon, broader
    // and looser near the viewer. Around the floating diya the lines bow away,
    // so the water reads as parting around it rather than running through it.
    const diyaOn = s.diya.alpha > 0.2;
    const dpx = s.diya.x * w, dpy = s.diya.y * h;
    for (let k = 1; k <= 12; k++) {
      const d = (k / 12) ** 2;                     // perspective depth 0..1
      const y = waterY + d * (h - waterY - 8) + 4;
      const amp = (0.5 + d * 3.0) * v;
      const lambda = (46 + d * 190) * v;
      const phase = t * (0.12 + d * 0.38);         // nearer waves drift faster
      ctx.strokeStyle = `rgba(150,170,220,${0.024 + d * 0.030})`;
      ctx.lineWidth = 0.8 + d * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 18) {
        let yy = y + Math.sin((x / lambda) * Math.PI * 2 + phase * Math.PI * 2 + k * 1.7) * amp;
        if (diyaOn) {
          const fx = Math.exp(-(((x - dpx) / (85 * v * s.diya.scale)) ** 2));
          const ddy = y - dpy;
          const fy = Math.exp(-((ddy / (60 * v * s.diya.scale)) ** 2));
          yy += Math.sign(ddy || 1) * 15 * v * s.diya.scale * fx * fy * s.diya.alpha;
        }
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // ---- shore lamps + their reflections ----
    for (const g of this.ghatLights) {
      const gx = g.x * w, gy = waterY - 3;
      const flick = (0.75 + 0.25 * Math.sin(t * (1.7 + g.b) + g.ph)) * g.b;
      const col = g.warm > 0.35 ? '255,186,100' : '255,214,150';
      ctx.fillStyle = `rgba(${col},${flick})`;
      ctx.beginPath();
      ctx.arc(gx, gy, g.r * v, 0, Math.PI * 2);
      ctx.fill();
      const len = (24 + 34 * flick) * g.b * v;
      for (let yy = 0; yy <= len; yy += 3) {
        const off = Math.sin(t * 1.6 + yy * 0.1 + g.ph) * (0.8 + yy * 0.05);
        const fade = 1 - yy / len;
        const ripple = 0.55 + 0.45 * Math.sin(t * 1.1 + yy * 0.12 + g.ph * 2);
        ctx.fillStyle = `rgba(${col},${0.10 * flick * fade * ripple})`;
        ctx.fillRect(gx + off - g.r * v, gy + 3 + yy, 2 * g.r * v, 7);
      }
    }

    // moonlight on the water: a long, soft, broken streak — two interfering
    // sines make patches that come and go; dimmer than the diya's reflection
    const mlen = 0.38 * (h - waterY);
    for (let yy = 0; yy <= mlen; yy += 4) {
      const off = Math.sin(t * 1.1 + yy * 0.06) * (2 + yy * 0.08);
      const fade = 1 - yy / mlen;
      const patch = (0.5 + 0.5 * Math.sin(t * 0.8 + yy * 0.11))
                  * (0.4 + 0.6 * Math.sin(t * 0.33 + yy * 0.045 + 2));
      const a = 0.055 * fade * Math.max(0, patch);
      if (a < 0.004) continue;
      const bw2 = (5 + yy * 0.05) * v;      // streak widens as it nears the viewer
      ctx.fillStyle = `rgba(226,220,200,${a})`;
      ctx.fillRect(mx + off - bw2 / 2, waterY + 2 + yy, bw2, 9);
    }

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
      ctx.fillStyle = `rgba(190,200,240,${a})`;
      ctx.fillRect(px, y, (3 + sp.d * 14) * v, 1);
    }

    // ---- ripples ----
    this.ripples = this.ripples.filter((r) => r.alpha > 0.008);
    for (const r of this.ripples) {
      r.r += 0.35 + r.r * 0.012;
      r.alpha *= 0.972;                    // fade well before the ring gets large
      const edgeFade = Math.max(0, 1 - r.r / r.maxR);
      ctx.strokeStyle = `rgba(180,195,240,${r.alpha * edgeFade})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ---- ghat steps ----
    this._drawSteps(ctx, t, w, h, s);

    // ---- diya ----
    if (s.diya.alpha > 0.01) this._drawDiya(now, s, w, h);

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
        // nosing highlight along the tread's front edge
        c.fillStyle = 'rgba(236,206,158,0.14)';
        c.fillRect(0, y + treadT - 1, e, 1.2);
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
        // right end fades into dark water
        const sg = c.createLinearGradient(e - 16, 0, e, 0);
        sg.addColorStop(0, 'rgba(0,0,0,0)');
        sg.addColorStop(1, 'rgba(4,5,16,0.5)');
        c.fillStyle = sg;
        c.fillRect(e - 16, y, 16, yn - y);
      }
      for (const n of this.stoneNoise) {
        c.fillStyle = n.warm
          ? `rgba(226,190,140,${n.a})`
          : `rgba(0,0,0,${n.a * 1.4})`;
        c.fillRect(n.x * edge(N - 1), topY + n.y * (h - topY), 1.5, 1.5);
      }
      c.restore();
      // submerged portion: translucent water over the lowest steps
      const wg = c.createLinearGradient(0, waterline, 0, h);
      wg.addColorStop(0, 'rgba(10,14,34,0.30)');
      wg.addColorStop(1, 'rgba(4,5,16,0.72)');
      c.fillStyle = wg;
      c.fillRect(0, waterline, edge(N - 1) + 4, h - waterline);
    }), 0, 0, w, h);

    // warm breathing light from the diya on the lower stone (live)
    if (diyaGlow > 0.02) {
      const gl = ctx.createRadialGradient(s.diya.x * w, s.diya.y * h, 10, s.diya.x * w, s.diya.y * h, w * 0.22);
      gl.addColorStop(0, `rgba(255,170,80,${0.07 * diyaGlow})`);
      gl.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(0, topY, edge(N - 1) + 4, h - topY);
    }

    // lapping waterline + small ripples against the stone (live)
    for (let x = 0; x <= edge(N - 1); x += 10) {
      const yy = waterline + Math.sin(t * 1.3 + x * 0.04) * 1.6;
      const a = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.1 + x * 0.09));
      ctx.fillStyle = `rgba(165,190,238,${a})`;
      ctx.fillRect(x, yy, 7, 1.2);
    }
    // slow ripples breathing against the submerged stone
    for (let k = 0; k < 2; k++) {
      const ph = (t * 0.35 + k * 0.5) % 1;          // 0..1 expanding cycle
      const rr = 8 + ph * 26;
      const a = 0.09 * Math.sin(Math.PI * ph);      // fade in, fade out
      ctx.strokeStyle = `rgba(165,190,238,${a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(edge(N - 1) * (0.55 + k * 0.3), waterline + 3, rr, rr * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
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
    const bob = Math.sin(t * 0.8) * 2.6 * sc + Math.sin(t * 1.9 + 1.3) * 0.9 * sc;
    const dx = s.diya.x * w;
    const dy = s.diya.y * h + bob;
    ctx.save();
    ctx.globalAlpha = s.diya.alpha;

    if (now - this._lastRipple > 2600 && sc > 0.3) {
      this._lastRipple = now;
      this.addRipple(dx, dy + 10 * sc);
    }

    const calm = s.calm;
    const energy = s.flameEnergy;
    const jitter = calm ? 0 : (Math.random() - 0.5) * 16 * (1 - energy);
    const flameH = sc * (16 + 30 * energy + (s.trace ?? 0) * 9) + jitter * 0.4;
    const sway = Math.sin(t * 3.1) * 1.6 * sc + (calm ? 0 : jitter * 0.5);
    const fx = dx, fy = dy - 9 * sc;

    // water glow under the diya
    const wg = ctx.createRadialGradient(dx, dy + 14 * sc, 2, dx, dy + 14 * sc, 110 * sc);
    wg.addColorStop(0, `rgba(255,170,70,${0.17 * energy})`);
    wg.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = wg;
    ctx.save();
    ctx.scale(1, 0.45);
    ctx.beginPath();
    ctx.arc(dx, (dy + 14 * sc) / 0.45, 110 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // reflection: soft stretched streak, broken by ripples, wobbling with waves
    const reflLen = flameH * 2.4 + 30 * sc;
    const reflTop = dy + 15 * sc;
    const backing = ctx.createLinearGradient(0, reflTop, 0, reflTop + reflLen);
    backing.addColorStop(0, `rgba(255,150,60,${0.10 * energy})`);
    backing.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = backing;
    ctx.fillRect(dx - 5 * sc, reflTop, 10 * sc, reflLen);
    for (let yy = 0; yy < reflLen; yy += 3) {
      const off = Math.sin(t * 1.9 + yy * 0.09) * (1 + yy * 0.045);
      const fade = 1 - yy / reflLen;
      const ripple = 0.5 + 0.5 * Math.sin(t * 1.3 + yy * 0.1);
      ctx.fillStyle = `rgba(255,160,70,${0.16 * energy * fade * ripple})`;
      ctx.fillRect(dx + off - 2 * sc, reflTop + yy, 4 * sc, 8);
    }

    // air glow
    const glow = ctx.createRadialGradient(fx, fy - flameH * 0.5, 2, fx, fy - flameH * 0.5, 95 * sc);
    glow.addColorStop(0, `rgba(255,190,90,${0.30 + 0.2 * energy})`);
    glow.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fx - 95 * sc, fy - flameH * 0.5 - 95 * sc, 190 * sc, 190 * sc);

    // bowl
    const bowl = ctx.createLinearGradient(dx, dy - 10 * sc, dx, dy + 12 * sc);
    bowl.addColorStop(0, '#7a4428');
    bowl.addColorStop(1, '#2e1709');
    ctx.fillStyle = bowl;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 32 * sc, 12 * sc, 0, 0, Math.PI, false);
    ctx.ellipse(dx, dy, 32 * sc, 7 * sc, 0, Math.PI, 0, false);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,180,100,${0.35 + 0.3 * energy})`;
    ctx.lineWidth = 1.2 * sc;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 32 * sc, 7 * sc, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = i % 2 ? '#d98a2b' : '#e8a93c';
      ctx.beginPath();
      ctx.arc(dx + i * 9 * sc, dy + 5 * sc, 2.6 * sc, 0, Math.PI * 2);
      ctx.fill();
    }

    // flame — outer
    const outer = ctx.createLinearGradient(fx, fy, fx, fy - flameH);
    outer.addColorStop(0, 'rgba(255,120,40,0.95)');
    outer.addColorStop(0.65, '#ff9c3f');
    outer.addColorStop(1, 'rgba(255,200,120,0.9)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(fx - 5.5 * sc, fy);
    ctx.quadraticCurveTo(fx - 7 * sc, fy - flameH * 0.55, fx + sway, fy - Math.max(7 * sc, flameH));
    ctx.quadraticCurveTo(fx + 7 * sc, fy - flameH * 0.55, fx + 5.5 * sc, fy);
    ctx.fill();
    // flame — inner core
    ctx.fillStyle = 'rgba(255,240,190,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx - 2.4 * sc, fy);
    ctx.quadraticCurveTo(fx - 3 * sc, fy - flameH * 0.35, fx + sway * 0.5, fy - flameH * 0.62);
    ctx.quadraticCurveTo(fx + 3 * sc, fy - flameH * 0.35, fx + 2.4 * sc, fy);
    ctx.fill();

    // worry text, written above the diya
    if (s.worry.text && s.worry.alpha > 0.01) {
      ctx.globalAlpha = s.diya.alpha * s.worry.alpha;
      ctx.font = `italic 500 ${Math.max(11, 16 * sc)}px 'Cormorant Garamond', Georgia`;
      ctx.textAlign = 'center';
      const lines = wrapText(s.worry.text, 28);
      ctx.shadowColor = 'rgba(255,200,120,0.6)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(243,233,201,0.92)';
      lines.forEach((ln, i) => {
        ctx.fillText(ln, fx, fy - flameH - (lines.length - i) * 19 * sc - 10 * sc);
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
