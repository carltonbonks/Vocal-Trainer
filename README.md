# Vocal Trainer

A hobby project: singing practice software I'm building for myself while I learn to sing.

I'm not a professional developer or a vocal coach. I wanted a practice tool shaped around my own habits, so I'm building it with [Claude](https://claude.com/claude-code), Anthropic's AI assistant. I describe what I want and test it with my own voice. Claude writes and changes the code. Expect rough edges. It's shared in case it's useful or interesting to someone else learning to sing, or curious about building software this way.

**Try it:** https://carltonbonks.github.io/Vocal-Trainer/ (Chrome or Edge on a computer, with a microphone; headphones help in song mode). Click **Start mic** and allow microphone access.

## What it does

- **Live pitch view:** see the note you're singing as you sing it.
- **Drills:** pitch matching (single notes or intervals), sustained notes and scales. A miss says whether you were simply off, singing a harmony note, or in the wrong octave.
- **Song mode:** a melody scrolls past a sing line with a guide tone, and each line gets a score. You can change the key and slow it down. It ships with Beethoven's *Ode to Joy* (public domain).
- **Range test:** find your lowest and highest comfortable notes.
- **Daily skills and progress:** a short daily routine whose skills fade if you skip them, plus progress tracking.

Your practice data stays on your computer: in the browser, and optionally as CSV files in a folder you pick (Progress → Your data). Nothing is sent anywhere.

## Install

- **As an app:** open the link above in Edge or Chrome and use the browser's *Install app* option. It works offline after that and updates itself.
- **Windows shortcut bundle:** download [vocal-trainer-windows.zip](https://carltonbonks.github.io/Vocal-Trainer/vocal-trainer-windows.zip), extract it, and run `Install-Vocal-Trainer.bat`. It adds Desktop and Start menu shortcuts that open the app in an Edge window.

## How it's built

Plain HTML and JavaScript, with no framework and no dependencies. Every push to `main` runs the unit tests, builds the page and publishes it to GitHub Pages (`.github/workflows/pages.yml`).

- `src/core.js`: pitch detection (YIN), scoring and skill freshness, with no DOM
- `src/songs.js`: song melodies as timed target notes, with no lyrics; public-domain songs only
- `src/csv.js`: lossless conversion between stored data and the four CSV files, plus merging
- `src/app.js`: UI and audio
- `src/pwa/`: manifest, service worker and icons; `node scripts/render_icons.js` re-renders the PNG icons from `icon.svg` (needs Playwright)
- `src/windows/`: the Windows installer script
- `python3 build.py` builds `dist/` (not committed): the single-file page, the PWA files and `vocal-trainer-windows.zip`
- `node test/core.test.js` and `node test/csv.test.js` are the unit tests; `node test/e2e.test.js` drives the page in Chromium with a fake microphone singing A3
