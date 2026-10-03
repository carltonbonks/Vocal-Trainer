const assert = require('assert');
require('../src/core.js');
const VT = globalThis.VT;

const SR = 48000;
// Voice-like test tone: harmonics with falling amplitude, optional vibrato and noise.
function tone(freq, { n = 2048, vibCents = 0, noise = 0, phase0 = 0 } = {}) {
  const buf = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const f = freq * Math.pow(2, (vibCents / 1200) * Math.sin((2 * Math.PI * 5.5 * i) / SR));
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(h * ph) / h;
    buf[i] = 0.3 * s + noise * (Math.random() * 2 - 1);
  }
  return buf;
}

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.message); }
};

test('note helpers round-trip', () => {
  assert.strictEqual(VT.noteName(69), 'A4');
  assert.strictEqual(VT.noteName(60), 'C4');
  assert.strictEqual(VT.parseNote('C#3'), 49);
  assert.ok(Math.abs(VT.freqToMidi(VT.midiToFreq(47.3)) - 47.3) < 1e-9);
});

test('YIN detects pitch within 5 cents across a vocal range (E2 to C6)', () => {
  for (let m = 40; m <= 84; m += 1) {
    const f = VT.midiToFreq(m);
    const r = VT.detectPitch(tone(f), SR);
    assert.ok(r, `no pitch at ${VT.noteName(m)}`);
    const err = (VT.freqToMidi(r.freq) - m) * 100;
    assert.ok(Math.abs(err) < 5, `${VT.noteName(m)} off by ${err.toFixed(1)} cents`);
  }
});

test('YIN has no octave errors with noise added', () => {
  for (const m of [43, 48, 55, 60, 67, 72]) {
    const r = VT.detectPitch(tone(VT.midiToFreq(m), { noise: 0.05 }), SR);
    assert.ok(r);
    assert.ok(Math.abs(VT.freqToMidi(r.freq) - m) < 0.3, `${VT.noteName(m)} -> ${VT.noteName(VT.freqToMidi(r.freq))}`);
  }
});

test('silence and white noise are unvoiced', () => {
  assert.strictEqual(VT.detectPitch(new Float32Array(2048), SR), null);
  const nz = new Float32Array(2048).map(() => 0.3 * (Math.random() * 2 - 1));
  assert.strictEqual(VT.detectPitch(nz, SR), null);
});

test('classifyOffset names octave and harmony errors', () => {
  assert.strictEqual(VT.classifyOffset(0.1).kind, 'on');
  assert.strictEqual(VT.classifyOffset(0.4).kind, 'sharp');
  assert.strictEqual(VT.classifyOffset(-12.1).kind, 'octave');
  assert.match(VT.classifyOffset(-12.1).label, /octave below/);
  assert.strictEqual(VT.classifyOffset(-3.9).kind, 'harmony');
  assert.match(VT.classifyOffset(-3.9).label, /major third below/);
  assert.strictEqual(VT.classifyOffset(-7).kind, 'harmony');
  assert.strictEqual(VT.classifyOffset(2).kind, 'off');
  assert.match(VT.classifyOffset(2).label, /2 semitones sharp/);
});

const frames = (fn, dur = 2.5, dt = 1 / 60) => {
  const out = [];
  for (let t = 0; t < dur; t += dt) out.push({ t, midi: fn(t) });
  return out;
};

test('scoreAttempt: accurate attempt scores high and settles fast', () => {
  const r = VT.scoreAttempt(frames((t) => 57 + (t < 0.15 ? -0.8 : 0.05)), 57);
  assert.ok(r.score >= 95, `score ${r.score}`);
  assert.ok(r.settle !== null && r.settle < 0.25, `settle ${r.settle}`);
  assert.strictEqual(r.offset.kind, 'on');
});

test('scoreAttempt: singing a third below is flagged as harmony', () => {
  const r = VT.scoreAttempt(frames(() => 57 - 4.05), 57);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.offset.kind, 'harmony');
});

test('scoreAttempt: octave below is flagged', () => {
  const r = VT.scoreAttempt(frames(() => 45), 57);
  assert.strictEqual(r.offset.kind, 'octave');
});

test('scoreAttempt: too few frames counts as not sung', () => {
  assert.strictEqual(VT.scoreAttempt([{ t: 0, midi: 57 }], 57).voiced, false);
});

test('stableNote finds a held note and ignores a slide', () => {
  assert.ok(Math.abs(VT.stableNote(frames(() => 45.1, 1)) - 45.1) < 1e-9);
  assert.strictEqual(VT.stableNote(frames((t) => 45 + 4 * t, 1)), null);
});

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passed');
