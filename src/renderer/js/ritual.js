// The ritual: screens, state machine, and the diya's journey.
// Owns the worry string (memory only — wiped on release) and the diya's
// position/alpha, which it hands to the Scene each frame via getDrawState().
//
// States: opening → title → consent → write → settle → breathe
//         breathe → pushback → breathe        (rushed)
//         breathe → release → closing         (7 calm breaths — step 4 wires
//                                              the real gate; for now debug keys)
// Debug (mock only): r = release, p = pushback.

const GHAT = { x: 0.40, y: 0.80 };          // where the diya rests by the steps

export class Ritual {
  constructor({ overlay, hintline, readout, scene, mock, onConsent, isFramed }) {
    this.overlay = overlay;
    this.hintline = hintline;
    this.readout = readout;
    this.scene = scene;
    this.mock = mock;
    this.onConsent = onConsent;   // async: starts the signal source (camera in live mode)
    this.isFramed = isFramed ?? (() => true);

    this.state = 'opening';
    this.worry = '';              // memory only; never persisted anywhere
    this.worryAlpha = 0;
    this.diya = { x: GHAT.x, y: GHAT.y, scale: 1, alpha: 0 };
    this._anim = null;            // {from:{..}, to:{..}, t0, dur, ease, then}
    this._hintTimer = null;

    if (mock) {
      window.addEventListener('keydown', (e) => {
        if (this.state !== 'breathe') return;
        if (e.key === 'r') this.release();
        if (e.key === 'p') this.pushback();
      });
    }
    this._enterOpening();
  }

  // ---------- per-frame ----------
  update(now) {
    if (this._anim) {
      const a = this._anim;
      const k = Math.min(1, (now - a.t0) / a.dur);
      const e = a.ease(k);
      for (const key of Object.keys(a.to)) {
        this.diya[key] = a.from[key] + (a.to[key] - a.from[key]) * e;
      }
      if (a.path) a.path(e, this.diya);
      if (k >= 1) {
        this._anim = null;
        a.then?.();
      }
    }
  }

  getDrawState() {
    return {
      diya: this.diya,
      worry: { text: this.worry, alpha: this.worryAlpha },
    };
  }

  showHint(message) {
    this.hintline.textContent = message;
    this.hintline.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hintline.classList.remove('show'), 4200);
  }

  // ---------- screens ----------
  _show(html, scrim = true) {
    this.overlay.innerHTML = html;
    this.overlay.classList.toggle('scrim', scrim);
    this.overlay.classList.remove('hidden');
  }

  _hide() { this.overlay.classList.add('hidden'); }

  _enterOpening() {
    this.state = 'opening';
    this._show(`<p class="line" id="l1">It's 2 AM. The ghat is far. The river isn't.</p>`);
    setTimeout(() => document.getElementById('l1')?.classList.add('show'), 600);
    setTimeout(() => this._enterTitle(), 5200);
  }

  _enterTitle() {
    this.state = 'title';
    this._show(`
      <div class="line title" id="t1">MannDaan</div>
      <div class="line title" id="t2"><span class="hindi">मन दान</span></div>
      <div class="line tagline" id="t3">Offer what weighs on your mann. Seven breaths. One diya.</div>
      <div class="btnrow line" id="t4"><button id="begin">Begin</button></div>
    `);
    setTimeout(() => document.getElementById('t1')?.classList.add('show'), 400);
    setTimeout(() => document.getElementById('t2')?.classList.add('show'), 1600);
    setTimeout(() => document.getElementById('t3')?.classList.add('show'), 2800);
    setTimeout(() => document.getElementById('t4')?.classList.add('show'), 3800);
    document.getElementById('begin').onclick = () => this._enterConsent();
  }

  _enterConsent() {
    this.state = 'consent';
    this._show(`
      <div class="consent-box line show">
        <h2>Before the river listens</h2>
        <p class="subtitle">To carry your diya, the river needs to hear you breathe.</p>
        <ul>
          <li><b>Your camera watches only your breath and heartbeat.</b> Nothing is recorded, nothing is kept.</li>
          <li><b>Your words stay with you.</b> They live only in this moment, and they're gone when the river takes them.</li>
          <li><b>No one else is here.</b> No accounts, no tracking, no AI reading your words.</li>
        </ul>
        <p class="closing">Nothing you offer here will be saved. That's the point.</p>
        <div class="btnrow">
          <button id="consent-yes">Light the diya</button>
          <button id="consent-no" class="quiet">Not tonight</button>
        </div>
        <details>
          <summary>How this works</summary>
          <p>MannDaan uses the Presage SmartSpectra SDK to read breathing and pulse
          from your camera, live. All measurements are computed on this device
          ("on-device processing", per Presage's documentation); the SDK contacts
          Presage's servers only to validate the API key and report usage statistics.
          Optional SDK telemetry is turned off, so this app sends no diagnostics to
          Presage. MannDaan is a ritual, not a health tool. It measures nothing about
          you worth keeping. Full details are in the README.</p>
        </details>
      </div>
    `);
    document.getElementById('consent-yes').onclick = () => {
      // The camera takes a couple of seconds to wake. Move on at once rather
      // than holding the consent card up while it does — otherwise the preview
      // appears underneath a screen that is still asking for permission.
      this._enterWrite();
      Promise.resolve(this.onConsent()).catch((err) => {
        this.showHint('The river could not reach you. (camera error — see console)');
        console.error('signal start failed:', err);
      });
    };
    document.getElementById('consent-no').onclick = () => this._enterOpening();
  }

  _enterWrite() {
    this.state = 'write';
    this._show(`
      <p class="line show" style="margin-bottom:2em">What weighs on your mann tonight?</p>
      <input id="worry-input" maxlength="80" autocomplete="off" spellcheck="false"
             placeholder="write it, then press Enter" />
    `);
    const input = document.getElementById('worry-input');
    input.focus();
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.worry = input.value.trim();
        input.value = '';
        if (this.mock) this._enterSettle();
        else this._enterFraming();
      }
    };
  }

  // Breathing is read from chest movement, and at laptop distance the chest is
  // not in frame — the SDK rejects every frame until it is. Rather than let
  // people sit through that as unexplained dead air, ask for the framing once,
  // with the camera visible, and move on as soon as the SDK is content.
  _enterFraming() {
    this.state = 'framing';
    this._show(`
      <p class="line show" style="margin-bottom:0.5em">Let the lamp find you.</p>
      <ol class="framing-steps line show">
        <li>Sit back until your <b>head and chest</b> are both in the picture —
            your breath is read from your chest, not your face.</li>
        <li>Face a window or a lamp. The camera needs light to see you move.</li>
        <li>Settle, and be still.</li>
      </ol>
      <p class="line show framing-wait" id="f1">waiting for the lamp to find you…</p>
      <div class="btnrow line" id="f2"><button id="skip-framing" class="quiet">Continue anyway</button></div>
    `);
    document.body.classList.add('framing');
    setTimeout(() => document.getElementById('f2')?.classList.add('show'), 9000);
    document.getElementById('skip-framing').onclick = () => this._leaveFraming();

    const t0 = performance.now();
    this._framingTimer = setInterval(() => {
      // move on once the SDK is happy, or after 25 s so nobody is ever stuck
      const waiting = document.getElementById('f1');
      if (this.isFramed()) {
        clearInterval(this._framingTimer);
        if (waiting) waiting.textContent = 'There you are.';
        setTimeout(() => this._leaveFraming(), 900);
      } else if (performance.now() - t0 > 25000) {
        this._leaveFraming();
      }
    }, 250);
  }

  _leaveFraming() {
    if (this.state !== 'framing') return;
    clearInterval(this._framingTimer);
    document.body.classList.remove('framing');
    this._enterSettle();
  }

  _enterSettle() {
    this.state = 'settle';
    this._hide();
    // diya fades in at the ghat, worry text inks itself on
    this.diya = { x: GHAT.x, y: GHAT.y, scale: 1, alpha: 0 };
    this.worryAlpha = 0;
    this._animate({ alpha: 1 }, 2400, easeInOut, () => {
      this.scene.addRipple(this.diya.x * innerWidth, this.diya.y * innerHeight + 10, true);
      this._enterBreathe();
    });
    // worry fades in slightly behind the diya
    const fade = setInterval(() => {
      this.worryAlpha = Math.min(1, this.worryAlpha + 0.02);
      if (this.worryAlpha >= 1) clearInterval(fade);
    }, 40);
  }

  _enterBreathe() {
    this.state = 'breathe';
    this.readout.classList.add('show');
    // Breathing is read from the chest, not the face: people sit too close to
    // a laptop for the camera to see it, so say that before anything else.
    this.showHint(this.mock
      ? 'Breathe with the flame. Slowly.'
      : 'Sit back so your head and chest are both in frame.');
    if (!this.mock) setTimeout(() => this.showHint('Breathe with the flame. Slowly.'), 7000);
  }

  // ---------- journeys ----------
  pushback() {
    if (this.state !== 'breathe') return;
    this.state = 'pushback';
    // drift out…
    this._animate({ x: 0.58, y: 0.72, scale: 0.8 }, 3600, easeInOut, () => {
      this.showHint("Ganga doesn't take what you're still holding.");
      // …and the current brings it home
      this._animate({ x: GHAT.x, y: GHAT.y, scale: 1 }, 4600, easeInOut, () => {
        this.scene.addRipple(this.diya.x * innerWidth, this.diya.y * innerHeight + 10);
        this._enterBreathe();
      });
    });
  }

  release() {
    if (this.state !== 'breathe') return;
    this.state = 'release';
    this.readout.classList.remove('show');
    const fx = this.diya.x * innerWidth;
    const fy = this.diya.y * innerHeight - 60;
    // worry dissolves into the water like ink
    this.scene.spawnInk(fx, fy);
    const fade = setInterval(() => {
      this.worryAlpha = Math.max(0, this.worryAlpha - 0.012);
      if (this.worryAlpha <= 0) clearInterval(fade);
    }, 40);
    // the diya floats away downstream and stays: a tiny flame on the horizon
    this._animate({ x: 0.84, y: 0.635, scale: 0.09 }, 16000, easeInOutLong, () => {
      this._wipeWorry();
      this._enterClosing();
    });
  }

  _wipeWorry() {
    // overwrite before release — the string existed only here
    this.worry = '\0'.repeat(this.worry.length);
    this.worry = '';
    this.worryAlpha = 0;
  }

  _enterClosing() {
    this.state = 'closing';
    this._show(`
      <p class="line" id="c1">Nothing was saved. That was the point.</p>
      <p class="line" id="c2" style="margin-top:1.4em; color: var(--dim)">The river was always within you.</p>
      <div class="btnrow line" id="c3">
        <button id="again" class="soft">Offer another</button>
        <button id="close" class="soft">Close</button>
      </div>
    `, false);
    setTimeout(() => document.getElementById('c1')?.classList.add('show'), 800);
    setTimeout(() => document.getElementById('c2')?.classList.add('show'), 3400);
    setTimeout(() => document.getElementById('c3')?.classList.add('show'), 5600);
    document.getElementById('again').onclick = () => this._enterWrite();
    document.getElementById('close').onclick = () => window.close();
  }

  // ---------- tween helper ----------
  _animate(to, dur, ease, then) {
    this._anim = {
      from: { ...this.diya }, to, t0: performance.now(), dur, ease, then,
    };
  }
}

const easeInOut = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
// slow start, long gentle tail — for the final float downstream
const easeInOutLong = (k) => 1 - Math.pow(1 - k, 2.2);
