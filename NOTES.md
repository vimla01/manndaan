# MannDaan — build notes

Measured numbers and honest debugging log, kept while building. Feeds the DEV post.

## Measurements (to fill during step 3 webcam sessions)

| Measurement | Value | Conditions |
|---|---|---|
| Time from camera start to first `metrics` event | — | |
| `metrics` event cadence (events/s) | — | |
| Breathing trace latency (breath → flame reaction) | — | measured by breathing on cue vs. flame response, screen recording frame count |
| Time to first `stable` breathing rate | — | |
| Time to first `stable` pulse | — | |
| Renderer FPS during measurement | — | |
| CPU usage during measurement | — | |

Note: we measure cadence/lag ourselves; other entrants' numbers are not used.

Optional during a webcam session: capture outbound traffic to Presage hosts and log the volume here, to back up the on-device claim with our own numbers, e.g.
`sudo tcpdump -i any -w /tmp/manndaan.pcap host cont-api.physiology.presagetech.com` (or `nethogs` for a per-process live view) while running one full ritual.

## Debugging log

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
