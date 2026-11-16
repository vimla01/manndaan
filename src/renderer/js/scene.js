// The night ghat. Pure rendering: everything it draws is driven by the state
// object passed to draw() — no ritual logic lives here.
//
// draw(now, s) where s = {
//   trace,          // breathing displacement ~[-1,1]
//   calm,           // boolean — smooth signal right now
//   flameEnergy,    // 0..1 — how alive the flame is
//   shimmer,        // 0..1 — water shimmer intensity (pulse-driven later)
//   diya: { x, y, scale, alpha },   // in [0..1] fractions of w/h
//   worry: { text, alpha },
// }

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
    this.ghatLights = Array.from({ length: 9 }, (_, i) => ({
      x: 0.04 + (i / 9) * 0.92 + (Math.random() - 0.5) * 0.05,
      warm: Math.random(),
      ph: Math.random() * Math.PI * 2,
    }));
    this.shimmerSpecks = Array.from({ length: 70 }, () => ({
      x: Math.random(), d: Math.random(),          // d: depth 0 (horizon) .. 1 (near)
      sp: 0.004 + Math.random() * 0.012,
      ph: Math.random() * Math.PI * 2,
    }));
    this.ripples = [];   // {x, y, r, maxR, alpha}
    this.ink = [];       // {x, y, vx, vy, r, alpha}
    this._lastRipple = 0;
  }

  get waterY() { return window.innerHeight * 0.62; }

  addRipple(px, py, big = false) {
    this.ripples.push({ x: px, y: py, r: 4, maxR: big ? 90 : 46, alpha: big ? 0.3 : 0.18 });
  }

  spawnInk(px, py) {
    for (let i = 0; i < 26; i++) {
      this.ink.push({
        x: px + (Math.random() - 0.5) * 60,
        y: py + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 6,
        vy: 12 + Math.random() * 22,
        r: 1 + Math.random() * 2.2,
        alpha: 0.5 + Math.random() * 0.3,
      });
    }
  }

  draw(now, s) {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    const waterY = this.waterY;
    const t = now / 1000;

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

    // ---- water ----
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, '#101634');
    water.addColorStop(0.25, '#0a0e22');
    water.addColorStop(1, '#040510');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    // horizon line, barely there
    ctx.fillStyle = 'rgba(150,160,210,0.12)';
    ctx.fillRect(0, waterY - 0.5, w, 1);

    // ---- distant ghat lights + reflections ----
    for (const g of this.ghatLights) {
      const gx = g.x * w, gy = waterY - 3;
      const flick = 0.75 + 0.25 * Math.sin(t * 2.1 + g.ph);
      const col = g.warm > 0.4 ? '255,190,110' : '255,225,170';
      ctx.fillStyle = `rgba(${col},${0.75 * flick})`;
      ctx.beginPath();
      ctx.arc(gx, gy, 1.6, 0, Math.PI * 2);
      ctx.fill();
      // wavering reflection streak
      const len = 30 + 26 * flick;
      const grad = ctx.createLinearGradient(0, gy + 3, 0, gy + 3 + len);
      grad.addColorStop(0, `rgba(${col},${0.22 * flick})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let yy = 0; yy <= len; yy += 4) {
        const off = Math.sin(t * 1.8 + yy * 0.22 + g.ph) * (1 + yy * 0.08);
        ctx.rect(gx + off - 0.8, gy + 3 + yy, 1.6, 3);
      }
      ctx.fill();
    }

    // ---- shimmer specks (pulse-driven intensity) ----
    const sh = 0.35 + 0.65 * (s.shimmer ?? 0.5);
    for (const sp of this.shimmerSpecks) {
      sp.x += sp.sp * (0.3 + sp.d) * 0.016;
      if (sp.x > 1.02) sp.x = -0.02;
      const y = waterY + sp.d * sp.d * (h - waterY) * 0.9 + 6;
      const a = sh * 0.14 * (0.5 + 0.5 * Math.sin(t * 2.4 + sp.ph));
      ctx.fillStyle = `rgba(170,185,235,${a})`;
      const len = 3 + sp.d * 14;
      ctx.fillRect(sp.x * w, y, len, 1);
    }

    // ---- ripples ----
    this.ripples = this.ripples.filter((r) => r.alpha > 0.01);
    for (const r of this.ripples) {
      r.r += 0.35 + r.r * 0.012;
      r.alpha *= 0.985;
      ctx.strokeStyle = `rgba(180,195,240,${r.alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ---- ghat steps (foreground, bottom-left silhouette) ----
    ctx.fillStyle = '#060504';
    ctx.beginPath();
    ctx.moveTo(0, h);
    const steps = 5;
    const stepW = w * 0.34 / steps, baseY = h * 0.995, topY = h * 0.80;
    for (let i = 0; i <= steps; i++) {
      const sx = w * 0.34 - i * stepW;
      const sy = baseY - ((baseY - topY) / steps) * (steps - i);
      ctx.lineTo(sx + stepW, sy);
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(0, topY);
    ctx.closePath();
    ctx.fill();
    // faint warm edge on the lowest step, lit by the diya
    if (s.diya.alpha > 0.1) {
      ctx.strokeStyle = `rgba(232,160,80,${0.10 * s.diya.alpha * s.flameEnergy})`;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h * 0.955);
      ctx.lineTo(w * 0.34, h * 0.955);
      ctx.stroke();
    }

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

  _drawDiya(now, s, w, h) {
    const ctx = this.ctx;
    const t = now / 1000;
    const sc = s.diya.scale;
    const bob = Math.sin(t * 0.9) * 2.4 * sc;
    const dx = s.diya.x * w;
    const dy = s.diya.y * h + bob;
    ctx.save();
    ctx.globalAlpha = s.diya.alpha;

    // occasional ripple around the floating diya
    if (now - this._lastRipple > 2600 && sc > 0.3) {
      this._lastRipple = now;
      this.addRipple(dx, dy + 10 * sc);
    }

    // flame geometry
    const calm = s.calm;
    const energy = s.flameEnergy;
    const jitter = calm ? 0 : (Math.random() - 0.5) * 16 * (1 - energy);
    const flameH = sc * (16 + 30 * energy + (s.trace ?? 0) * 9) + jitter * 0.4;
    const sway = Math.sin(t * 3.1) * 1.6 * sc + (calm ? 0 : jitter * 0.5);
    const fx = dx, fy = dy - 9 * sc;

    // water glow (reflection of the flame)
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
    ctx.ellipse(dx, dy, 32 * sc, 12 * sc, 0, 0, Math.PI, false);  // lower half
    ctx.ellipse(dx, dy, 32 * sc, 7 * sc, 0, Math.PI, 0, false);   // rim
    ctx.fill();
    // rim highlight
    ctx.strokeStyle = `rgba(255,180,100,${0.35 + 0.3 * energy})`;
    ctx.lineWidth = 1.2 * sc;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 32 * sc, 7 * sc, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // marigold petals on the rim
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
      ctx.font = `italic ${Math.max(11, 15 * sc)}px Georgia`;
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
