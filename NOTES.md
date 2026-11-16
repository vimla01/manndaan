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

## Debugging log

- **2026-11-16 — `app` undefined on launch.** `require('electron')` returned no API when launched from inside an Electron-based IDE terminal: the IDE exports `ELECTRON_RUN_AS_NODE=1`, which makes our Electron run as plain Node. Fix: `env -u ELECTRON_RUN_AS_NODE npx electron .` (only needed in such terminals; a normal shell is fine).
- **2026-11-16 — scaffold.** Mock mode built first (`npm run dev`) so every visual/mechanic is tuned without spending SDK credits. Mock emits the same event shape the live adapter will.

## Known limitations (to keep honest)

- (expected) needs decent, steady lighting; readings take time to stabilize — quantify in step 3.
