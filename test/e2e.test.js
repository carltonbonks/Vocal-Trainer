// Drives the built page in Chromium with a fake mic that sings a steady A3.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const wav = path.join(__dirname, 'a3.wav');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  // Stand-in for the folder picker: an in-memory folder kept in sessionStorage so it survives reloads.
  await page.addInitScript(() => {
    const load = () => JSON.parse(sessionStorage.getItem('fakeDir') || '{}');
    const save = (f) => sessionStorage.setItem('fakeDir', JSON.stringify(f));
    const dir = {
      name: 'VocalTrainerData',
      async getFileHandle(name, opts = {}) {
        const f = load();
        if (!(name in f)) { if (!opts.create) throw new DOMException('missing', 'NotFoundError'); f[name] = ''; save(f); }
        return {
          async getFile() { return { text: async () => load()[name] }; },
          async createWritable() { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { const g = load(); g[name] = buf; save(g); } }; },
        };
      },
      async queryPermission() { return 'granted'; },
    };
    window.showDirectoryPicker = async () => dir;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'vocal-trainer.html'));

  await page.click('#micBtn');
  await page.click('nav button[data-tab=live]');
  await page.waitForFunction(() => document.getElementById('liveNote').textContent === 'A3', null, { timeout: 8000 });
  console.log('ok   live view reads A3 from the fake mic');

  async function drill(note, expect) {
    await page.click('nav button[data-tab=drills]');
    await page.selectOption('#drillLo', String(note));
    await page.selectOption('#drillHi', String(note));
    await page.fill('#drillRounds', '3');
    await page.click('#drillStart');
    await page.waitForFunction(() => /score/.test(document.getElementById('drillResult').textContent), null, { timeout: 10000 });
    const text = await page.textContent('#drillResult');
    assert.match(text, expect, text);
    console.log('ok  ', `target ${note}:`, text);
    await page.click('#drillStop');
  }
  await drill(57, /On pitch/);                  // A3 target, singing A3
  await drill(61, /major third below \(a harmony note\)/); // C#4 target
  await drill(69, /octave below/);               // A4 target

  // Scales: a 5-note pattern from A3 while the fake mic holds A3 hits only the first and last notes.
  await page.click('nav button[data-tab=drills]');
  await page.selectOption('#drillMode', 'scale');
  await page.selectOption('#scalePattern', 'five');
  await page.selectOption('#drillLo', '57');
  await page.selectOption('#drillHi', '64');
  await page.fill('#drillRounds', '3');
  await page.click('#drillStart');
  await page.waitForFunction(() => /Score/.test(document.getElementById('drillTarget').textContent), null, { timeout: 15000 });
  const chips = await page.$$eval('#drillNotes .pill', (els) => els.map((e) => e.textContent.trim()));
  assert.strictEqual(chips.length, 9, chips.join(' '));
  assert.ok(chips[0].endsWith('✓') && chips[8].endsWith('✓') && chips[4].endsWith('✗'), chips.join(' '));
  assert.strictEqual(await page.textContent('#drillTarget'), 'Score 22');
  console.log('ok   scales drill scores per note:', chips.join(' '));
  // Only one root fits (A3 + 7 semitones = E4), so the drill ends after one round and ticks off Scales.
  await page.waitForSelector('#drillSummary:not([hidden])', { timeout: 8000 });
  await page.click('nav button[data-tab=today]');
  assert.ok(await page.isChecked('[data-skill=scales]'), 'scales not ticked');
  assert.match(await page.textContent('#streak'), /1-day streak/);
  const fresh = await page.$eval('.skill:nth-child(3)', (el) => getComputedStyle(el).getPropertyValue('--f'));
  assert.ok(Number(fresh) > 0.3 && Number(fresh) < 0.4, fresh);
  console.log('ok   finishing a drill ticks the skill, starts a streak and fills its freshness bar');

  // Range test picks up the held note.
  await page.click('nav button[data-tab=range]');
  await page.click('[data-range=low]');
  await page.waitForFunction(() => /Holding A3/.test(document.getElementById('rangeLive').textContent), null, { timeout: 8000 });
  await page.click('#rangeSave');
  assert.match(await page.textContent('#rangeHistory'), /A3/);
  console.log('ok   range test records A3');

  // Song mode: one line of Holland, 1945 at the original tempo. The fake mic holds A3,
  // so the A3 notes are hits and the G3/B3 notes are two semitones off.
  await page.click('nav button[data-tab=song]');
  await page.selectOption('#songPart', '12-15');
  await page.fill('#songTempo', '100');
  await page.dispatchEvent('#songTempo', 'input');
  assert.match(await page.textContent('#songRange'), /Notes from G3 to B3/);
  await page.click('#songStart');
  await page.waitForFunction(() => /Verse 1, line 4/.test(document.getElementById('songPhase').textContent), null, { timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(__dirname, 'song.png') });
  await page.waitForSelector('#songSummary:not([hidden])', { timeout: 15000 });
  const songRow = await page.$$eval('#songSummary tr', (rows) => rows.slice(1).map((r) => r.textContent));
  assert.strictEqual(songRow.length, 1, songRow.join(' / '));
  assert.match(songRow[0], /^Verse 1, line 4/);
  const songScore = Number(await page.$eval('#songSummary td.score', (e) => e.textContent));
  assert.ok(songScore > 15 && songScore < 60, `song score ${songScore}`);
  assert.match(songRow[0], /off/);
  await page.click('nav button[data-tab=today]');
  assert.ok(await page.isChecked('[data-skill=song]'), 'song skill not ticked');
  console.log(`ok   song mode scores a line (${songScore}) and ticks the song skill`);

  // Data folder: connect, check the CSVs, then wipe the browser copy and restore from them.
  await page.click('nav button[data-tab=progress]');
  await page.click('#folderChoose');
  await page.waitForFunction(() => /Saving to the folder "VocalTrainerData"/.test(document.getElementById('folderStatus').textContent));
  const csv = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fakeDir')));
  assert.deepStrictEqual(Object.keys(csv).sort(), ['attempts.csv', 'daily.csv', 'ranges.csv', 'sessions.csv']);
  assert.match(csv['sessions.csv'], /,scale,five,1,9,22,/);
  assert.match(csv['ranges.csv'], /,A3,/);
  assert.match(csv['sessions.csv'], /,song,"Holland, 1945 \| Verse 1, line 4 \| key 0 \| 99 bpm",1,\d+,/);
  console.log('ok   choosing a folder writes four CSV files');
  const before = await page.evaluate(() => ['sessions', 'ranges', 'minutes', 'done'].map((k) => localStorage.getItem('vt.' + k)));
  // A new range test saves to the folder automatically.
  await page.click('nav button[data-tab=range]');
  await page.click('[data-range=highChest]');
  await page.waitForFunction(() => /Holding A3/.test(document.getElementById('rangeLive').textContent), null, { timeout: 8000 });
  await page.click('#rangeSave');
  await page.waitForFunction(() => (JSON.parse(sessionStorage.getItem('fakeDir'))['ranges.csv'].match(/\r\n/g) || []).length === 3, null, { timeout: 5000 });
  console.log('ok   new results save to the folder automatically');
  const saved = await page.evaluate(() => ['sessions', 'ranges', 'minutes', 'done'].map((k) => localStorage.getItem('vt.' + k)));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('nav button[data-tab=progress]');
  await page.click('#folderChoose');
  await page.waitForFunction(() => /Restored 2 drill sessions from the folder/.test(document.getElementById('folderNote').textContent));
  const restored = await page.evaluate(() => ['sessions', 'ranges', 'minutes', 'done'].map((k) => JSON.parse(localStorage.getItem('vt.' + k))));
  const norm = (a) => a.map((v) => JSON.parse(v));
  assert.deepStrictEqual(restored.slice(0, 2), norm(saved).slice(0, 2));
  assert.deepStrictEqual(restored[3], norm(saved)[3]);
  // Minutes may tick up between snapshots while the fake mic sings, so compare days only.
  assert.deepStrictEqual(Object.keys(restored[2]), Object.keys(norm(saved)[2]));
  assert.ok(before);
  console.log('ok   wiping the browser copy and choosing the folder restores everything');
  await page.click('nav button[data-tab=progress]');
  await page.screenshot({ path: path.join(__dirname, 'progress.png'), fullPage: true });
  assert.deepStrictEqual(errors, []);
  console.log('ok   no page errors');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
