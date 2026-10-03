# Vocal Trainer

Singing practice app for the user (Windows 11, Edge). Plain HTML/JS, no framework or npm dependencies.

- Edit `src/`; never edit `dist/` by hand. `python3 build.py` rebuilds `dist/` (single-file page, PWA files, and `vocal-trainer-windows.zip`). Run `node scripts/render_icons.js` first if the icon changed.
- Tests: `node test/core.test.js`, `node test/csv.test.js`, and `NODE_PATH=$(npm root -g) node test/e2e.test.js` (Playwright with a fake mic singing A3; uses /opt/pw-browsers chromium).
- Stored data shapes (localStorage keys `vt.sessions`, `vt.ranges`, `vt.minutes`, `vt.done`) must stay round-trippable through `src/csv.js`. If you add a field, add it to `exportTables`/`importTables` and the round-trip test.
- Delivery: the user installs from the zip. The installer copies the page to `%LOCALAPPDATA%\VocalTrainer`; the extracted folder on their PC is `%USERPROFILE%\Claude\VocalTrainer`, with CSV data in its `Data\` subfolder (confirmed 2026-10-03).
- The shared project copy lives at `/mnt/project-files/singing-trainer` (including `.git`). Copy the repo there after committing.
- The shared folder adds content-credential metadata to images and audio when they are written, so `git status` there shows icons and `test/a3.wav` as modified. That is expected; commit from a clean clone rather than committing those changes.
