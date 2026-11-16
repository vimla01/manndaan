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

## Run (live mode) — coming in step 3

```bash
cp .env.example .env   # add your key from https://physiology.presagetech.com
npm start
```

## Consent and Data Handling

(To be completed with the final build — commitments:)

- The camera stays **off** until you explicitly consent in-app.
- Your worry text lives **only in memory** — never written to disk, logs, localStorage, or any server — and is wiped after the release.
- No video or frames are recorded or stored by this app; signals are used live and discarded.
- No accounts, no analytics, no AI/LLM services.
- SmartSpectra SDK telemetry is **disabled** (`enableTelemetry: false`). See Presage's [Telemetry and Privacy](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md) page for what it would otherwise send.
- TODO: document the SDK's measurement processing path (on-device vs. cloud) once confirmed with Presage.

MannDaan is a ritual, not a health tool. It measures nothing about you worth keeping — that's the point.

## License

MIT (this app's code only; the SmartSpectra SDK is a dependency under its own license).
