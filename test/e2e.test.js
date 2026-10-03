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

  await page.click('nav button[data-tab=progress]');
  await page.screenshot({ path: path.join(__dirname, 'progress.png'), fullPage: true });
  assert.deepStrictEqual(errors, []);
  console.log('ok   no page errors');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
