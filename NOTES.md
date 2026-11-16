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
- **2026-11-16 — scene rework tanked FPS, fixed with layer caching.** Adding the far-bank skyline, perspective wave bands, and textured sandstone steps dropped the renderer from ~100 to ~40 fps: ~25 `createLinearGradient` calls per frame plus a 240-speckle stone-grain pass behind a `clip()` every frame. Fix: bake static layers (skyline silhouette, full stonework incl. grain and submerged tint) into offscreen canvases rebuilt only on resize, draw them with one `drawImage` each; waves thinned from 16 strokes @14 px sampling to 12 @18 px. Back to ~102–112 fps. Dynamic stone lighting kept via a single live radial gradient (diya glow on the lower steps).
- **2026-11-16 — breath gate.** Breath cycles detected with hysteresis zero-crossings (±0.18) on the smoothed normalized trace, with a minimum peak-to-trough swing of 0.5 so shallow noise never counts as a breath. Calm = cycle ≥ 5 s, rushed = < 2.5 s; a rushed breath erodes one earned breath, 3 in a row → the river refuses; breaths in between neither add nor reset. Smoke test drives the real gate through the mock signal (fast → pushback, slow → release). Caught a self-inflicted bug first: ran electron without rebuilding the bundle and debugged phantom old behavior — `start`/`dev`/`smoke` npm scripts rebuild automatically, lesson: never launch `npx electron .` bare.
- **2026-11-16 — SDK wiring (v3.5.0).** Our renderer used plain ES modules, but `@smartspectra/node-sdk/renderer` is CommonJS meant for bundlers — added esbuild (331 KB bundle, 143 ms build). The renderer/messages modules deliberately avoid the FFI layer, so they bundle cleanly. Second snag: the SDK preload must occupy the single `webPreferences.preload` slot, so our own config preload moved to `session.registerPreloadScript` (Electron 35+). Native runtime loads fine on Linux x64. Trace units are unspecified, so `live.js` normalizes `upperTrace` adaptively (EMA mean + amplitude → ~[-1,1]). `[measure]` console lines log first-metrics latency, cadence, first-stable times, FPS for this table. Renderer FPS in mock: ~99–111.
- **2026-11-16 — scene + ritual flow.** Night ghat (Canvas 2D: stars, ghat-light reflections, pulse-driven shimmer specks, ripples), diya with two-layer flame + water glow, worry text inked above the flame, full state machine (opening → consent → write → breathe → pushback/release → closing). Release overwrites then clears the worry string. `--smoke` autopilot walks the whole ritual unattended and confirms the wipe — used as a regression check before each change.
- **2026-11-16 — scaffold.** Mock mode built first (`npm run dev`) so every visual/mechanic is tuned without spending SDK credits. Mock emits the same event shape the live adapter will.

## Known limitations (to keep honest)

- (expected) needs decent, steady lighting; readings take time to stabilize — quantify in step 3.
