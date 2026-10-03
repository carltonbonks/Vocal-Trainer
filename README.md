# Vocal Trainer

A browser-based singing practice tool: live pitch view, pitch-matching drills that flag harmony and wrong-octave errors, a range test, and progress tracking. Phase 1 of the plan in the project's requirements doc.

Open `dist/vocal-trainer.html` in Chrome or Edge, click **Start mic**, and allow microphone access. Data stays in the browser (localStorage); use Progress → Export to back it up.

- `src/core.js` pitch detection (YIN) and scoring, no DOM
- `src/app.js` UI and audio
- `python3 build.py` inlines both into `dist/vocal-trainer.html`
- `node test/core.test.js` unit tests; `node test/e2e.test.js` drives the page in Chromium with a fake mic (needs Playwright)
