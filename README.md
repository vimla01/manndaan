# MannDaan (मन दान)

*An offering from the heart. Offer what weighs on your mann. Seven breaths. One diya.*

A digital deepdaan: you type one worry onto a diya at a night ghat, and your **live breathing** (read from your webcam by the [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra)) decides whether the river accepts it. Calm, slow breath keeps the flame tall and lets the diya float away; rushed breath and the current pushes it back.

> Status: work in progress — mock mode works, SDK integration in progress.

## Run (mock mode, no camera, no API key)

```bash
npm install
npm run dev
```

Mock controls: ↑/↓ breath speed, `e` erratic breathing, `h` fake validation hint.

## Run (live mode)

```bash
cp .env.example .env   # add your key from https://physiology.presagetech.com
npm start
```

The camera stays off until you click "I consent" on the consent screen.

How SmartSpectra is used: [main.js](main.js) binds the SDK IPC (`bindSmartSpectraIpc`) and the SDK preload; [src/renderer/js/signals/live.js](src/renderer/js/signals/live.js) constructs the renderer SDK with `enableTelemetry: false`, decodes `metrics.breathing.rate` / `upperTrace` and `metrics.cardio.pulseRate`, and maps `validationStatus` codes to on-screen hints. The breathing trace drives the flame; the averaged rate + `stable` flag gate the release.

## Consent and Data Handling

(To be completed with the final build — commitments:)

- The camera stays **off** until you explicitly consent in-app.
- Your worry text lives **only in memory** — never written to disk, logs, localStorage, or any server — and is wiped after the release.
- No video or frames are recorded or stored by this app; signals are used live and discarded.
- No accounts, no analytics, no AI/LLM services.
- SmartSpectra SDK telemetry is **disabled** (`enableTelemetry: false`). See Presage's [Telemetry and Privacy](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md) page for what it would otherwise send.
- Measurement processing is **on-device**. Presage's documentation states: *"On-device processing for iOS, Android, C++ and Node.js"* ([smartspectra.presagetech.com](https://smartspectra.presagetech.com/)), and the [SDK README](https://github.com/Presage-Security/SmartSpectra) refers to *"the vitals the SDK computes on-device"*. The SDK's network traffic is for API-key authentication/subscription and usage reporting; with telemetry disabled, Presage's docs state *"the SDK starts no telemetry session and transmits nothing"* beyond that.

MannDaan is a ritual, not a health tool. It measures nothing about you worth keeping — that's the point.

## Credits

- **Fonts** (bundled in `src/renderer/fonts/`, all under the [SIL Open Font License 1.1](https://openfontlicense.org/) — license texts alongside the font files):
  - [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) © the Cormorant Project Authors
  - [Inter](https://fonts.google.com/specimen/Inter) © the Inter Project Authors
  - [Tiro Devanagari Hindi](https://fonts.google.com/specimen/Tiro+Devanagari+Hindi) © the Indigo Project Authors (Tiro Typeworks)
- **SmartSpectra SDK** © Presage Technologies, used under its own license as an npm dependency.

## License

MIT (this app's code only; the SmartSpectra SDK is a dependency under its own license).
