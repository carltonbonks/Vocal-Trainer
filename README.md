# Vocal Trainer

A browser-based singing practice tool: live pitch view, pitch-matching, sustain and scales drills that flag harmony and wrong-octave errors, a range test, daily skills that fade without practice, and progress tracking.

Open `dist/vocal-trainer.html` in Chrome or Edge, or serve `dist/` over https (e.g. GitHub Pages) to install it as an app with offline support. Click **Start mic** and allow microphone access. Data stays in the browser (localStorage); use Progress → Export to back it up.

- `src/core.js` pitch detection (YIN), scoring, freshness; no DOM
- `src/app.js` UI and audio
- `src/pwa/` manifest, service worker, icon
- `python3 build.py` builds `dist/`; `node render_icons.js` renders the PNG icons (needs Playwright)
- `node test/core.test.js` unit tests; `node test/e2e.test.js` drives the page in Chromium with a fake mic singing A3
