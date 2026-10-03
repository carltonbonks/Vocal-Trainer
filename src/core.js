// Pure pitch and scoring logic. No DOM, so it can be tested in Node.
(function (root) {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noteName = (m) => {
    const n = Math.round(m);
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  };
  const parseNote = (s) => {
    const m = /^([A-G])(#?)(-?\d)$/.exec(s.trim());
    if (!m) return null;
    return NOTE_NAMES.indexOf(m[1] + m[2]) + 12 * (Number(m[3]) + 1);
  };

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // YIN pitch detection (de Cheveigné & Kawahara, 2002).
  // Returns {freq, clarity} or null when the frame is unvoiced or too quiet.
  function detectPitch(buf, sampleRate, opts = {}) {
    const threshold = opts.threshold ?? 0.15;
    const fmin = opts.fmin ?? 60;
    const fmax = opts.fmax ?? 1100;
    const minRms = opts.minRms ?? 0.01;
    if (rms(buf) < minRms) return null;

    const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
    const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(buf.length / 2));
    const W = buf.length - tauMax;
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalized difference.
    const cmnd = new Float32Array(tauMax + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (cmnd[t] < threshold) {
        while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;
    // Parabolic interpolation around the minimum.
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
      const denom = a + c - 2 * b;
      if (denom !== 0) better = tau + (a - c) / (2 * denom);
    }
    return { freq: sampleRate / better, clarity: 1 - cmnd[tau] };
  }

  const median = (xs) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };

  // Describe how a sung pitch relates to the target, in plain words.
  // The important cases for this user: wrong octave and landing on a harmony.
  function classifyOffset(semis) {
    const cents = Math.round(semis * 100);
    if (Math.abs(semis) <= 0.25) return { kind: 'on', label: 'On pitch', cents };
    if (Math.abs(semis) <= 0.5) {
      return { kind: semis > 0 ? 'sharp' : 'flat', label: semis > 0 ? 'Slightly sharp' : 'Slightly flat', cents };
    }
    const n = Math.round(semis);
    const dir = n > 0 ? 'above' : 'below';
    const a = Math.abs(n);
    const names = { 12: 'an octave', 24: 'two octaves', 7: 'a fifth', 5: 'a fourth', 3: 'a minor third', 4: 'a major third', 8: 'a minor sixth', 9: 'a major sixth' };
    let kind = 'off';
    if (a === 12 || a === 24) kind = 'octave';
    else if (a === 3 || a === 4 || a === 5 || a === 7 || a === 8 || a === 9) kind = 'harmony';
    let label;
    if (names[a]) {
      label = `${names[a][0].toUpperCase()}${names[a].slice(1)} ${dir}`;
      if (kind === 'harmony') label += ' (a harmony note)';
      if (kind === 'octave') label += ' (right note, wrong octave)';
    } else {
      label = `${a} semitone${a > 1 ? 's' : ''} ${n > 0 ? 'sharp' : 'flat'}`;
    }
    return { kind, label, cents };
  }

  // Score one sung attempt against a target note.
  // frames: [{t: seconds since sing window opened, midi}] for voiced frames only.
  function scoreAttempt(frames, targetMidi, opts = {}) {
    const settleSkip = opts.settleSkip ?? 0.3;
    if (frames.length < 5) return { voiced: false };
    const onset = frames[0].t;
    const body = frames.filter((f) => f.t - onset >= settleSkip);
    const use = body.length >= 5 ? body : frames;
    const devs = use.map((f) => f.midi - targetMidi);
    const med = median(devs);
    const within = (c) => devs.filter((d) => Math.abs(d) * 100 <= c).length / devs.length;

    // Settle time: first run of 5 frames within 50 cents of target.
    let settle = null;
    for (let i = 0; i + 5 <= frames.length; i++) {
      if (frames.slice(i, i + 5).every((f) => Math.abs(f.midi - targetMidi) <= 0.5)) {
        settle = frames[i].t - onset;
        break;
      }
    }
    // Stability: spread of the sung pitch around its own centre, in cents.
    const own = use.map((f) => f.midi);
    const centre = median(own);
    const spread = median(own.map((m) => Math.abs(m - centre))) * 100;

    return {
      voiced: true,
      medianCents: Math.round(med * 100),
      within25: within(25),
      within50: within(50),
      score: Math.round(within(50) * 100),
      settle,
      spreadCents: Math.round(spread),
      sungMidi: centre,
      offset: classifyOffset(med),
    };
  }

  // Track stable held notes (for the range test).
  // Returns the median midi of the latest stable segment of at least minDur seconds.
  function stableNote(frames, minDur = 0.6, maxSpread = 0.6) {
    if (frames.length < 5) return null;
    const end = frames[frames.length - 1].t;
    const seg = frames.filter((f) => end - f.t <= minDur);
    if (seg.length < 5 || end - seg[0].t < minDur * 0.8) return null;
    const ms = seg.map((f) => f.midi);
    if (Math.max(...ms) - Math.min(...ms) > maxSpread * 2) return null;
    return median(ms);
  }

  // Score a sung sequence (scales) where each target note has a fixed time slot.
  // frames: [{t, midi}] with t measured from the start of the first slot.
  // lead skips the start of each slot (the voice moving onto the note); lag allows for late singing.
  function scoreSequence(frames, targets, slotDur, opts = {}) {
    const lead = opts.lead ?? 0.2, lag = opts.lag ?? 0.1;
    const notes = targets.map((target, i) => {
      const a = i * slotDur + lead, b = (i + 1) * slotDur + lag;
      const ms = frames.filter((f) => f.t >= a && f.t < b).map((f) => f.midi);
      if (ms.length < 3) return { target, voiced: false, kind: 'missed', hit: false };
      const dev = median(ms) - target;
      const offset = classifyOffset(dev);
      return { target, voiced: true, sung: median(ms), cents: Math.round(dev * 100), kind: offset.kind, label: offset.label, hit: Math.abs(dev) <= 0.5 };
    });
    const score = Math.round((notes.filter((n) => n.hit).length / targets.length) * 100);
    return { notes, score };
  }

  // How fresh a skill is, from 0 to 1, given the dates it was practised.
  // Each day of practice counts less as it ages (x0.75 per day), so daily practice
  // approaches 1 and a skill left alone fades by about a quarter a day.
  function freshness(doneDates, todayStr, decay = 0.75, full = 3) {
    const day = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
    const now = day(todayStr);
    let sum = 0;
    for (const d of doneDates) {
      const age = now - day(d);
      if (age >= 0 && age <= 60) sum += Math.pow(decay, age);
    }
    return Math.min(1, sum / full);
  }

  root.VT = { NOTE_NAMES, freqToMidi, midiToFreq, noteName, parseNote, rms, detectPitch, median, classifyOffset, scoreAttempt, stableNote, scoreSequence, freshness };
})(typeof window !== 'undefined' ? window : globalThis);
