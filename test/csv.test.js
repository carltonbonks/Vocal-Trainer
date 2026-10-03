const assert = require('assert');
require('../src/core.js');
require('../src/csv.js');
const { exportTables, importTables, parseCsv } = globalThis.VTcsv;

// Realistic stored data covering every shape the app writes.
const data = {
  sessions: [
    { date: '2026-10-03T18:01:02.345Z', mode: 'single', rounds: 3, total: 2, avgScore: 50, onPitch: 1, harmony: 1, octave: 0, off: 0, range: [47, 62],
      results: [
        { target: 57, voiced: true, score: 100, cents: -3, kind: 'on', sung: 57, spread: 4, settle: 0.12 },
        { target: 61, voiced: true, score: 0, cents: -405, kind: 'harmony', sung: 57, spread: 6, settle: null },
        { target: 50, voiced: false },
      ] },
    { date: '2026-10-03T18:10:00.000Z', mode: 'scale', rounds: 1, total: 3, avgScore: 33, onPitch: 1, harmony: 1, octave: 0, off: 1, range: [55, 64], pattern: 'five',
      results: [{ root: 55, voiced: true, score: 33, notes: [{ target: 55, kind: 'on', cents: 2 }, { target: 57, kind: 'harmony', cents: -310 }, { target: 59, kind: 'missed', cents: undefined }] }] },
    // An older session written before the "total" field existed.
    { date: '2026-10-02T09:00:00.000Z', mode: 'sustain', rounds: 0, avgScore: 0, onPitch: 0, harmony: 0, octave: 0, off: 0, range: [48, 60], results: [] },
  ],
  ranges: [{ date: '2026-10-03T17:00:00.000Z', low: 40.123456789, highChest: 64.5, highFalsetto: 76.25 }, { date: '2026-10-03T17:30:00.000Z', low: 41 }],
  minutes: { '2026-10-02': 3.25, '2026-10-03': 11.123456 },
  done: { '2026-10-03': { warmup: true, sustain: false, scales: true, futureSkill: true }, '2026-10-01': { match: true } },
};

const strip = (o) => JSON.parse(JSON.stringify(o)); // undefined fields vanish in localStorage too
const files = exportTables(data);
const back = importTables(files);
assert.deepStrictEqual(strip(back), strip(data));
console.log('ok   export then import returns identical data');

assert.deepStrictEqual(importTables(exportTables(back)), back);
console.log('ok   second round trip is stable');

assert.deepStrictEqual(parseCsv('a,b\r\n"x, ""y""",2\r\n'), [{ a: 'x, "y"', b: '2' }]);
console.log('ok   CSV quoting handled');

const att = parseCsv(files['attempts.csv']);
assert.strictEqual(att.length, 6);
assert.strictEqual(att[1].target, 'C#4');
assert.strictEqual(att[1].result, 'harmony');
console.log('ok   attempts.csv has one row per attempt or scale note, with readable note names');

assert.deepStrictEqual(importTables({}), { sessions: [], ranges: [], minutes: {}, done: {} });
console.log('ok   empty folder imports as empty data');
const { mergeData } = globalThis.VTcsv;
const local = { sessions: [data.sessions[0]], ranges: [], minutes: { '2026-10-03': 2, '2026-10-04': 1 }, done: { '2026-10-03': { song: true, sustain: false } } };
const merged = mergeData(local, data);
assert.strictEqual(merged.sessions.length, 3);
assert.deepStrictEqual(merged.sessions.map((x) => x.date), [...data.sessions.map((x) => x.date)].sort());
assert.strictEqual(merged.ranges.length, 2);
assert.deepStrictEqual(merged.minutes, { '2026-10-02': 3.25, '2026-10-03': 11.123456, '2026-10-04': 1 });
assert.deepStrictEqual(merged.done['2026-10-03'], { warmup: true, sustain: false, scales: true, futureSkill: true, song: true });
assert.deepStrictEqual(mergeData(data, { sessions: [], ranges: [], minutes: {}, done: {} }).sessions.length, 3);
console.log('ok   merging a partial browser copy with the folder keeps everything from both');
console.log('\nall passed');
