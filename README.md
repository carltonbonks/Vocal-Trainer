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

## Install

- **As an app (recommended):** open the link above in Edge or Chrome and use the browser's *Install app* option. You get a Desktop/Start menu shortcut and an app window, it works offline, and it picks up new versions on its own.
- **Windows shortcut bundle:** download [vocal-trainer-windows.zip](https://carltonbonks.github.io/Vocal-Trainer/vocal-trainer-windows.zip), extract it, and run `Install-Vocal-Trainer.bat`. It adds Desktop and Start menu shortcuts that open a local copy of the page in an Edge window. This copy does **not** update itself; download a newer zip and run the installer again to update.

## Privacy, data and performance

**What's sent where.** The app has no accounts, analytics, cookies, ads, or third-party scripts or fonts. Its only network traffic is loading its own files from GitHub Pages. Microphone audio is analysed live in your browser; it is never recorded, saved, or uploaded. GitHub hosts the page, and like any web host it sees your IP address when you load it (see [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)). I don't get any visitor data from it.

**Where your practice history lives.** It's in your browser's storage for this site, on your computer only. The browser keeps each site separate, so the installed app and the Windows bundle (which opens a local file) each have their own history. To keep one history, or to protect it, use Progress → Your data → Choose folder. The app then also saves your history as four CSV files in a folder you pick. Point every copy you use at the same folder. Each one merges the folder's history in when it connects (it may ask you to allow the folder again after a restart). Clearing your browser's data for the site erases the browser copy, but not the folder or an Export file.

**Performance.** Nothing runs when the app is closed. While it's open with the mic off, it's idle. While the mic is on, it measures pitch once per screen refresh (usually 60 times a second) on a short slice of audio (2048 samples). That's light work for a modern computer, but it hasn't been formally benchmarked. It keeps going until you click **Stop mic**, though browsers pause it while the tab is hidden. The mic stays open, and Windows shows its microphone indicator, until you click Stop mic or close the app.

**Updates.** There is no background polling. Each time you open the installed app, it starts instantly from its saved copy and checks GitHub once for newer files (about 100 KB). A new version takes effect the next time you open it.

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
