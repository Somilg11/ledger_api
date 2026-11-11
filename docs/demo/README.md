# Recorded Ledger walkthrough

[Watch or download the captioned MP4](ledger-demo.mp4).

Updated on 2026-11-12: 1 minute 30 seconds, H.264 MP4, 1440 × 900, approximately 2.2 MB.

The walkthrough follows the current Ledger interface: manual demo sign-in, account reconciliation, the data-flow playground, collapsed navigation, a transfer and its journal pair, safe retry, hold capture and void, an overdraft rejection, administrative reconciliation and reversal.

The video uses simulated money and real API requests. Captions are burned into the video; there is no audio track. The recording contains only the desktop interface.

## Record a new version

Requirements: Node.js 22, Docker Desktop, Google Chrome, `ffmpeg`, and `ffprobe`.

```bash
npm ci
npm --prefix web ci
npm run demo:up
npm run demo
```

Override the console URL with `BASE_URL`, Chrome executable with `CHROME_PATH`, or the seeded password with `DEMO_PASSWORD` when needed.

The recorder creates actual simulated transactions in the existing demo database. It does not reset data. Successful scenes assert the balance changes, retry behavior, hold state, rejection, and reversal before encoding. The existing MP4 is replaced only after every scene and the H.264 encoding checks pass. Raw captures live under ignored `docs/demo/raw/`; successful runs remove their own temporary capture directory.

Stop the project while preserving its data:

```bash
npm run stack:stop
```

The MP4 is committed to the repository. Recording screenshots are not written over the separate UI-test screenshots.
