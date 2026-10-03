// Converts the app's stored data to CSV tables and back, without loss.
// Four files: sessions.csv (one row per drill), attempts.csv (one row per sung
// attempt, or per note for scales), ranges.csv and daily.csv.
(function (root) {
  const { noteName } = root.VT;

  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', i = 0, quoted = false;
    while (i < text.length) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { quoted = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { quoted = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const [header, ...body] = rows;
    return body.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
  }

  const num = (s) => (s === '' || s === undefined ? undefined : Number(s));
  const bool = (s) => (s === '1' ? true : s === '0' ? false : undefined);
  const flag = (b) => (b === true ? 1 : b === false ? 0 : '');
  const nn = (m) => (m === undefined || m === null ? '' : noteName(m));
  const SKILL_KEYS = ['warmup', 'sustain', 'scales', 'match', 'song'];

  function exportTables(data) {
    const sessions = data.sessions || [];
    const sessRows = sessions.map((s) => [s.date, s.mode, s.pattern, s.rounds, s.total, s.avgScore, s.onPitch, s.harmony, s.octave, s.off,
      s.range?.[0], s.range?.[1], nn(s.range?.[0]), nn(s.range?.[1])]);

    const attRows = [];
    for (const s of sessions) {
      (s.results || []).forEach((r, round) => {
        if (r.notes) {
          r.notes.forEach((n, k) => attRows.push([s.date, round + 1, k + 1, r.root, flag(r.voiced), r.score, n.target, nn(n.target), n.kind, n.cents, '', '', '', '']));
        } else {
          attRows.push([s.date, round + 1, '', '', flag(r.voiced), r.score, r.target, nn(r.target), r.kind, r.cents, r.sung, nn(r.sung), r.spread, r.settle]);
        }
      });
    }

    const rangeRows = (data.ranges || []).map((r) => [r.date, r.low, nn(r.low), r.highChest, nn(r.highChest), r.highFalsetto, nn(r.highFalsetto)]);

    const minutes = data.minutes || {}, done = data.done || {};
    const days = [...new Set([...Object.keys(minutes), ...Object.keys(done)])].sort();
    const dayRows = days.map((d) => [d, minutes[d], ...SKILL_KEYS.map((k) => flag(done[d]?.[k]))]);
    // Skills not in the list above are kept in an extra column so nothing is dropped.
    const extra = days.map((d) => Object.fromEntries(Object.entries(done[d] || {}).filter(([k]) => !SKILL_KEYS.includes(k))));
    dayRows.forEach((row, i) => row.push(Object.keys(extra[i]).length ? JSON.stringify(extra[i]) : ''));

    return {
      'sessions.csv': toCsv(['session', 'drill', 'pattern', 'rounds', 'items', 'avg_score', 'on_pitch', 'harmony', 'octave', 'off', 'range_low_midi', 'range_high_midi', 'range_low', 'range_high'], sessRows),
      'attempts.csv': toCsv(['session', 'round', 'note_in_pattern', 'pattern_root_midi', 'voiced', 'round_score', 'target_midi', 'target', 'result', 'cents', 'sung_midi', 'sung', 'wobble_cents', 'settle_s'], attRows),
      'ranges.csv': toCsv(['date', 'lowest_midi', 'lowest', 'highest_normal_midi', 'highest_normal', 'highest_falsetto_midi', 'highest_falsetto'], rangeRows),
      'daily.csv': toCsv(['date', 'minutes_sung', ...SKILL_KEYS, 'other_skills'], dayRows),
    };
  }

  function importTables(files) {
    const sessions = parseCsv(files['sessions.csv'] || '').map((r) => {
      const s = { date: r.session, mode: r.drill, rounds: num(r.rounds), total: num(r.items), avgScore: num(r.avg_score), onPitch: num(r.on_pitch), harmony: num(r.harmony), octave: num(r.octave), off: num(r.off), range: [num(r.range_low_midi), num(r.range_high_midi)], results: [] };
      if (r.pattern) s.pattern = r.pattern;
      if (s.total === undefined) delete s.total;
      return s;
    });
    const byId = new Map(sessions.map((s) => [s.date, s]));
    for (const r of parseCsv(files['attempts.csv'] || '')) {
      const s = byId.get(r.session);
      if (!s) continue;
      const i = num(r.round) - 1;
      if (r.note_in_pattern !== '') {
        const round = s.results[i] || (s.results[i] = { root: num(r.pattern_root_midi), voiced: bool(r.voiced), score: num(r.round_score), notes: [] });
        round.notes[num(r.note_in_pattern) - 1] = { target: num(r.target_midi), kind: r.result, cents: num(r.cents) };
      } else if (bool(r.voiced) === false) {
        s.results[i] = { target: num(r.target_midi), voiced: false };
      } else {
        s.results[i] = { target: num(r.target_midi), voiced: true, score: num(r.round_score), cents: num(r.cents), kind: r.result, sung: num(r.sung_midi), spread: num(r.wobble_cents), settle: r.settle_s === '' ? null : num(r.settle_s) };
      }
    }
    const ranges = parseCsv(files['ranges.csv'] || '').map((r) => {
      const o = { date: r.date };
      if (r.lowest_midi !== '') o.low = num(r.lowest_midi);
      if (r.highest_normal_midi !== '') o.highChest = num(r.highest_normal_midi);
      if (r.highest_falsetto_midi !== '') o.highFalsetto = num(r.highest_falsetto_midi);
      return o;
    });
    const minutes = {}, done = {};
    for (const r of parseCsv(files['daily.csv'] || '')) {
      if (r.minutes_sung !== '') minutes[r.date] = num(r.minutes_sung);
      const d = {};
      for (const k of SKILL_KEYS) if (bool(r[k]) !== undefined) d[k] = bool(r[k]);
      if (r.other_skills) Object.assign(d, JSON.parse(r.other_skills));
      if (Object.keys(d).length) done[r.date] = d;
    }
    return { sessions, ranges, minutes, done };
  }

  // Combine two copies of the data without dropping anything from either.
  // Sessions and range tests are matched by timestamp; minutes take the larger
  // value for a day; a skill ticked in either copy stays ticked.
  function mergeData(a, b) {
    const byDate = (xs, ys) => {
      const m = new Map();
      for (const x of [...ys, ...xs]) m.set(x.date, x);
      return [...m.values()].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
    };
    const minutes = { ...b.minutes };
    for (const [d, v] of Object.entries(a.minutes)) minutes[d] = Math.max(v, minutes[d] ?? 0);
    const done = {};
    for (const d of new Set([...Object.keys(a.done), ...Object.keys(b.done)])) {
      const x = a.done[d] || {}, y = b.done[d] || {};
      done[d] = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) done[d][k] = Boolean(x[k] || y[k]);
    }
    return { sessions: byDate(a.sessions, b.sessions), ranges: byDate(a.ranges, b.ranges), minutes, done };
  }

  root.VTcsv = { toCsv, parseCsv, exportTables, importTables, mergeData };
})(typeof window !== 'undefined' ? window : globalThis);
