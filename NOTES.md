# MannDaan — build notes

Measured numbers and honest debugging log, kept while building. Feeds the DEV post.

## Measurements

First successful end-to-end live session, 2026-11-17 11:42 IST. Dell Integrated
Webcam (0bda:5574), Ubuntu, Electron 38, `@smartspectra/node-sdk` 3.5.0,
daylight indoors, seated at arm's length with head and chest in frame.

| Measurement | Value | Conditions |
|---|---|---|
| `sdk.start()` resolves | **2.6 s** | includes acquiring the camera |
| Camera actually delivered | **640x480 @ 30 fps** | we request this ourselves; the SDK's 1280x720 default sagged below its own 25 fps floor |
| First `metrics` event | **42.8 s** after start | inflated: the first ~40 s were rejected as `kChestNotVisible`. Once framing was right, metrics flowed immediately |
| Metrics event cadence | **27–29 events/s** steady state (19.9/s averaged over the whole 184 s session, including the dead first 40 s) | undocumented in the SDK docs — measured here |
| First **stable** breathing rate | **52.8 s** after start | `stable` = confidence >= 45 (+/-1 br/min) |
| First **stable** pulse | **82.4 s** after start | `stable` = confidence >= 40 (+/-3 bpm) |
| Breathing-rate values seen | 4.9 – 69.2 /min | wide: includes unstable warm-up readings. Settled around 11–16 /min |
| Pulse values seen | 46 – 104 bpm | settled around 72–91 bpm |
| Breathing trace samples | 3609 over 184 s | raw values range **-58.2 to +93.8** — arbitrary units, which is why the trace is normalized adaptively before it drives the flame |
| Renderer FPS during measurement | median **24.1**, min 20.9 | "lite" effects auto-engaged; full effects run 60–110 fps when not measuring |
| CPU during measurement | main process (SDK pipeline) **46.9%**, renderer 9.6%, GPU 6.3% | the native pipeline dominates; the artwork is cheap by comparison |
| Validation states observed | kOk 65, kChestNotVisible 25, kFrameRateTooLow 8, kFaceTooHigh 4, kExcessiveMotion 3, kFaceTooLow 2, kNoFaceFound 1, kFaceTooClose 1, kFaceNotCentered 1 | the chest-framing complaint dominates for first-time users |
| Real breath cycles at the gate | calm breaths measured **5.6 – 6.9 s**; a rushed one 1.9 s; "between" ones 2.7–2.8 s | thresholds (calm >= 5 s, rushed < 2.5 s) tuned on a mock sine wave held up unchanged on real breathing |
| Ritual completed | **7/7 calm breaths**, diya released | |

Honest limitations, measured rather than guessed:
- The signal needs ~50 s before the breathing rate is trustworthy, and ~80 s for pulse. The ritual's pacing has to absorb that, which it does: the flame responds to the *trace* immediately while the averaged rate is still settling.
- The chest must be in frame. At normal laptop distance it is not, and the SDK rejects every frame with `kChestNotVisible` — that alone cost 40 s of this session.
- The SDK's default 1280x720 capture cannot be sustained by this webcam; it stops the session with error 14 ("frame rate stayed too low"). 640x480 holds 30 fps.

Note: we measure cadence/lag ourselves; other entrants' numbers are not used.

Optional during a webcam session: capture outbound traffic to Presage hosts and log the volume here, to back up the on-device claim with our own numbers, e.g.
`sudo tcpdump -i any -w /tmp/manndaan.pcap host cont-api.physiology.presagetech.com` (or `nethogs` for a per-process live view) while running one full ritual.

## Free tier limits (from the Presage developer dashboard, 2026-11-17)

Free tier: **100 credits, 1 credit = 30 seconds of live measurement — about 50
minutes total**, renewing monthly. Not documented in the SDK repo or the docs
site; only visible on the dashboard at physiology.presagetech.com. Budget
accordingly: a four-minute test session costs ~8 credits, so there is room for
roughly a dozen sessions plus the demo video takes.

## Live session procedure (one run, to spend trial credits once)

1. `cp .env.example .env` and paste the key from physiology.presagetech.com.
2. Sit facing a lamp — the SDK needs light on your face and chest, not behind you.
3. `npm start` (in an Electron-based IDE terminal, prefix `env -u ELECTRON_RUN_AS_NODE`).
4. Open DevTools (Ctrl+Shift+I) **before** clicking "Light the diya" — the first
   measurements are logged in the seconds right after the camera starts.
5. Consent, type a worry, press Enter.
6. Breathe normally for ~30 s and let the readout fill in (breath/min, pulse, stable dots).
7. Breathe deliberately fast for ~20 s — the river should push the diya back.
8. Then breathe slowly (cycles of 5 s or longer) until the diya is released.
9. The session report prints automatically on release; `mdReport()` prints it again any time.
10. Copy the whole `=== MannDaan session report ===` JSON block, plus any `[gate]`
    and `[sdk error]` lines, into the table below.

## Debugging log

- **2026-11-17 — first complete live ritual.** Seven calm breaths, measured from a real chest trace, released the diya. Getting there took four distinct failures, each with a different cause and each initially looking like "the camera is broken": a metric bundle that pulled in a model we never received, a capture size the webcam could not sustain, our own artwork starving the pipeline of CPU, and finally the exposure lock described below. Worth remembering that none of them produced an error message that named the real cause — the diagnosis came from the native log, the validation codes, and a camera-free reproduction.

- **2026-11-17 — we left the user's webcam stuck in manual exposure.** After a session, the camera looked dark in *every other app* (Google Meet included) until the machine was restarted. Cause: the SmartSpectra SDK locks auto-exposure, white balance and focus once its graph reaches Running (its README says so), and on Linux those are device-level V4L2 controls that outlive the process. We stopped the tracks but never restored the controls, so the webcam stayed frozen at the exposure chosen for a dark room. Confirmed by reading the track settings afterwards: `exposureMode: "manual"`. Fix: `LiveSignal.stop()` now re-applies `exposureMode/whiteBalanceMode/focusMode: 'continuous'` before stopping the tracks, and `npm run camera:reset` does the same for a camera already left locked. Lesson: releasing a device is not the same as restoring it — if an SDK changes hardware state, you own putting it back.

- **2026-11-17 — first live session died 11 seconds in, and the cause was a metric we never used.** The camera started fine, then every frame was dropped with `SmartSpectra is not in a valid state for this operation` behind a terminal error. Two clues in the native log: `Unable to resolve configured model path. Falling back to remote delivery if available`, and an empty `~/.cache/SmartSpectraSDK/`. A camera-free reproduction (custom input, synthetic grey frames) ran 25 s clean through Running and back — no error, but also no metrics, because grey frames contain no face. That mismatch was the clue: the failure needs a face, i.e. it happens once physiology inference actually runs. The SDK's own source explains why — `ARTERIAL_PRESSURE_TRACE`, EDA and micromotion need an encrypted model delivered into that cache directory, and "without it their encrypted-model load fails downstream". We were requesting `[...breathingMetrics, ...cardioMetrics]`, and `cardioMetrics` is not just pulse: it is `PULSE_RATE(15), ARTERIAL_PRESSURE_TRACE(16), HRV(17)`. Fix: request `[...breathingMetrics, MetricType.PULSE_RATE]` — the minimum the ritual actually uses, which is also a smaller privacy surface. Lesson: the convenience metric bundles pull in metrics with heavier runtime requirements than the docs' quickstart implies.

- **2026-11-16 — `app` undefined on launch.** `require('electron')` returned no API when launched from inside an Electron-based IDE terminal: the IDE exports `ELECTRON_RUN_AS_NODE=1`, which makes our Electron run as plain Node. Fix: `env -u ELECTRON_RUN_AS_NODE npx electron .` (only needed in such terminals; a normal shell is fine).
- **2026-11-17 — where you blur matters more than how much.** Soft water called for a real blur, so rings and reflection moved to an offscreen layer composited back with `ctx.filter = 'blur(4px)'`. That halved the frame rate (20–42 fps): canvas `filter` costs scale with the **destination** area, so blurring an 820x340 composite is far worse than blurring the small source. Blurring the half-resolution layer into a second small canvas, then compositing with no filter at all, restored 57–69 fps with the same softness.
- **2026-11-17 — the "dark rectangle beside the steps", finally.** Reported three times; the first two fixes (clipping the submerged overlay, then clipping the diya's stone glow) were real bugs but not this one. The actual cause was the staircase silhouette itself: each step ended in a straight vertical edge against the water with only a 16 px fade, so the flight read as a solid block with a hard right side. Widening that fade to 64 px and taking it to near-opaque makes each step dissolve into the river. Three different bugs produced the same visual symptom, which is why it kept "coming back".

- **2026-11-17 — any effect with a boundary needs a fade.** Warm wave crests drawn only inside the diya's glow ended abruptly at the edge of their x-range and read as bright stripes laid over the water. Fixed with a horizontal gradient stroke (transparent -> full -> transparent) rather than a clipped solid colour. Same root cause as the rectangular glow seam on the steps earlier: a soft fill inside a hard boundary still shows the boundary.

- **2026-11-17 — per-frame canvas filters are expensive.** The reflection spec called for 2 px blurred strokes, so the first pass set `ctx.filter = 'blur(2px)'` on the main canvas each frame, and the breath dots used `shadowBlur`. Renderer fell from ~100 fps to 33–49. Fix: bake the blur into small sprites once at startup and `drawImage` them with `globalCompositeOperation = 'lighter'` — same look, 62–95 fps. Rule of thumb for this project: blur at sprite-creation time, never in the frame loop.
- **2026-11-17 — the "dark rectangle" beside the steps.** Reported twice, and the first fix (clipping the submerged-water overlay) missed it. The real source was the diya's warm light on the stone: a radial gradient painted with `fillRect(0, topY, edge+4, …)`, whose rectangle ended while the gradient still had alpha — a hard vertical seam at ~0.31 of the width, right where the water starts. Fixed by clipping that fill to the staircase silhouette. Lesson: a gradient fill is only as soft as the shape you paint it into.
- **2026-11-17 — scene geometry is specified at 1080p.** Hand-tuned numbers (reflection stroke widths 40–110 px, 8 px spacing, dots 90 px below the diya) are multiplied by `vs / 1.5` and the diya's own scale, so they hold at 1080p and shrink correctly as the diya floats away downstream.

- **2026-11-16 — worry text shivered on video.** The text was positioned relative to the flame height, which includes per-frame noise/flicker by design — so the words inherited the shake. Fix: anchor the text to a heavily low-passed copy of the diya's bob (α=0.03) at a fixed height, with x/y snapped to whole pixels. Lesson: text must never be driven by anything with per-frame randomness.
- **2026-11-16 — depth-of-field far bank.** Dropped the detailed skyline (procedural buildings read as "rockets and warehouses" at a glance) for a blurred dark band (`ctx.filter: blur(9px)` into a cached layer) + warm bokeh discs with soft reflections and a few drifting distant diyas. Bokeh drawn from pre-rendered sprites with `globalAlpha` — per-frame radial gradients for ~15 lights measurably cost frames. Also regraded: desaturated near-black sky with amber horizon haze, near-black water, warmer/brighter diya glow. ~50–90 fps (machine-load dependent), full flow still passes.
- **2026-11-16 — scene rework tanked FPS, fixed with layer caching.** Adding the far-bank skyline, perspective wave bands, and textured sandstone steps dropped the renderer from ~100 to ~40 fps: ~25 `createLinearGradient` calls per frame plus a 240-speckle stone-grain pass behind a `clip()` every frame. Fix: bake static layers (skyline silhouette, full stonework incl. grain and submerged tint) into offscreen canvases rebuilt only on resize, draw them with one `drawImage` each; waves thinned from 16 strokes @14 px sampling to 12 @18 px. Back to ~102–112 fps. Dynamic stone lighting kept via a single live radial gradient (diya glow on the lower steps).
- **2026-11-16 — breath gate.** Breath cycles detected with hysteresis zero-crossings (±0.18) on the smoothed normalized trace, with a minimum peak-to-trough swing of 0.5 so shallow noise never counts as a breath. Calm = cycle ≥ 5 s, rushed = < 2.5 s; a rushed breath erodes one earned breath, 3 in a row → the river refuses; breaths in between neither add nor reset. Smoke test drives the real gate through the mock signal (fast → pushback, slow → release). Caught a self-inflicted bug first: ran electron without rebuilding the bundle and debugged phantom old behavior — `start`/`dev`/`smoke` npm scripts rebuild automatically, lesson: never launch `npx electron .` bare.
- **2026-11-16 — SDK wiring (v3.5.0).** Our renderer used plain ES modules, but `@smartspectra/node-sdk/renderer` is CommonJS meant for bundlers — added esbuild (331 KB bundle, 143 ms build). The renderer/messages modules deliberately avoid the FFI layer, so they bundle cleanly. Second snag: the SDK preload must occupy the single `webPreferences.preload` slot, so our own config preload moved to `session.registerPreloadScript` (Electron 35+). Native runtime loads fine on Linux x64. Trace units are unspecified, so `live.js` normalizes `upperTrace` adaptively (EMA mean + amplitude → ~[-1,1]). `[measure]` console lines log first-metrics latency, cadence, first-stable times, FPS for this table. Renderer FPS in mock: ~99–111.
- **2026-11-16 — scene + ritual flow.** Night ghat (Canvas 2D: stars, ghat-light reflections, pulse-driven shimmer specks, ripples), diya with two-layer flame + water glow, worry text inked above the flame, full state machine (opening → consent → write → breathe → pushback/release → closing). Release overwrites then clears the worry string. `--smoke` autopilot walks the whole ritual unattended and confirms the wipe — used as a regression check before each change.
- **2026-11-16 — scaffold.** Mock mode built first (`npm run dev`) so every visual/mechanic is tuned without spending SDK credits. Mock emits the same event shape the live adapter will.

## Known limitations (to keep honest)

- (expected) needs decent, steady lighting; readings take time to stabilize — quantify in step 3.
