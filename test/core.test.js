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

test('scoreSequence scores each slot of a 5-note scale', () => {
  const targets = [48, 50, 52, 53, 55];
  const slot = 0.7;
  // Sings the first four correctly, then lands a third below the last note.
  const sung = [48, 50, 52, 53, 52];
  const fr = frames((t) => sung[Math.min(4, Math.floor(t / slot))] + 0.05, slot * 5);
  const r = VT.scoreSequence(fr, targets, slot);
  assert.strictEqual(r.score, 80);
  assert.deepStrictEqual(r.notes.map((n) => n.hit), [true, true, true, true, false]);
  assert.strictEqual(r.notes[4].kind, 'harmony');
});

test('scoreSequence marks silent slots as missed', () => {
  const r = VT.scoreSequence(frames(() => 48, 0.7), [48, 50], 0.7);
  assert.strictEqual(r.notes[1].kind, 'missed');
  assert.strictEqual(r.score, 50);
});

test('freshness rises with daily practice and fades when skipped', () => {
  const days = (n, from = '2026-10-10') => [...Array(n)].map((_, i) => new Date(Date.parse(from) - i * 864e5).toISOString().slice(0, 10));
  assert.strictEqual(VT.freshness([], '2026-10-10'), 0);
  assert.ok(VT.freshness(days(14), '2026-10-10') > 0.95);
  const afterBreak = VT.freshness(days(14), '2026-10-14');
  assert.ok(afterBreak > 0.3 && afterBreak < 0.5, String(afterBreak));
  assert.ok(VT.freshness(['2026-10-10'], '2026-10-10') < 0.4);
});

require('../src/songs.js');
const holland = globalThis.VTsongs.find((s) => s.id === 'holland-1945');

test('Holland, 1945 parses, every bar adds up and no notes overlap', () => {
  const notes = VT.parseSongNotes(holland.notes);
  assert.ok(notes.length > 300, `only ${notes.length} notes`);
  const abs = notes.map((n) => ({ ...n, a: (n.bar - 1) * 16 + n.pos }));
  for (let i = 1; i < abs.length; i++) {
    const p = abs[i - 1], n = abs[i];
    assert.ok(n.pos < 16, `bar ${n.bar} position ${n.pos}`);
    assert.ok(p.a + p.len <= n.a, `bar ${p.bar}+${p.pos} overlaps bar ${n.bar}+${n.pos}`);
  }
  const lo = Math.min(...notes.map((n) => n.midi)), hi = Math.max(...notes.map((n) => n.midi));
  assert.strictEqual(VT.noteName(lo), 'F#3');
  assert.strictEqual(VT.noteName(hi), 'G4');
});

test('song phrases are named by section and line', () => {
  const ph = VT.songPhrases(holland);
  assert.strictEqual(ph[0].label, 'Verse 1, line 1');
  assert.strictEqual(ph.find((p) => p.bar === 20).label, 'Pre-chorus 1');
  assert.strictEqual(ph.find((p) => p.bar === 25).label, 'Chorus 1, line 3');
  assert.strictEqual(ph.at(-1).label, 'Verse 3, line 8');
});

test('song timeline: tempo, transpose and bar range', () => {
  const tl = VT.songTimeline(holland, { fromBar: 21, toBar: 23, bpm: 60, transpose: -12 });
  assert.strictEqual(tl[0].midi, VT.parseNote('G3'));
  assert.strictEqual(tl[0].start, 0);
  assert.strictEqual(tl[0].dur, 1); // a quarter note at 60 bpm
  assert.strictEqual(tl[1].start, 1);
  assert.ok(tl.every((n) => n.label === 'Chorus 1, line 1'));
  assert.strictEqual(tl.length, 7);
});

test('timed notes: on, harmony, octave, missed, and length-weighted phrase scores', () => {
  const notes = [
    { midi: 60, start: 0, dur: 1, phrase: 0, label: 'A' },
    { midi: 62, start: 1, dur: 0.25, phrase: 0, label: 'A' },
    { midi: 64, start: 2, dur: 1, phrase: 1, label: 'B' },
    { midi: 65, start: 3, dur: 1, phrase: 1, label: 'B' },
  ];
  const frames = [];
  const sing = (a, b, m) => { for (let t = a; t < b; t += 0.016) frames.push({ t, midi: m }); };
  sing(0, 1, 60.1);   // on
  sing(1, 1.25, 59);  // a minor third below: harmony
  sing(2, 3, 52);     // an octave below
  const r = notes.map((n) => VT.scoreTimedNote(frames, n));
  assert.deepStrictEqual(r.map((x) => x.kind), ['on', 'harmony', 'octave', 'missed']);
  const ph = VT.phraseScores(notes, r);
  assert.strictEqual(ph[0].score, 80); // 1 s hit out of 1.25 s
  assert.strictEqual(ph[1].score, 0);
  assert.deepStrictEqual(ph[1].kinds, { octave: 1, missed: 1 });
});

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passed');
