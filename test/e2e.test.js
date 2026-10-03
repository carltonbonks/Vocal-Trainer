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
