(function () {
  const { detectPitch, freqToMidi, midiToFreq, noteName, median, scoreAttempt, stableNote, scoreSequence, freshness, songPhrases, songTimeline, scoreTimedNote, phraseScores } = window.VT;
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('vt.' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('vt.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
      if (DATA_KEYS.includes(key)) scheduleFolderSave();
    },
  };
  const DATA_KEYS = ['sessions', 'ranges', 'minutes', 'done'];
  const allData = () => ({ sessions: store.get('sessions', []), ranges: store.get('ranges', []), minutes: store.get('minutes', {}), done: store.get('done', {}) });
  const today = () => new Date().toLocaleDateString('en-CA');

  // ---------- tabs ----------
  $('nav').addEventListener('click', (e) => {
    const tab = e.target.dataset.tab;
    if (!tab) return;
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('section.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
    if (tab === 'progress') renderProgress();
    if (tab === 'today') renderToday();
    if (tab === 'song' && !song) drawSongLane();
  });

  // ---------- audio ----------
  let ctx = null, analyser = null, stream = null, buf = null;
  const history = []; // {t, midi|null}
  const HISTORY_SECONDS = 12;
  let ignoreMicUntil = 0; // seconds (ctx time) while a reference tone plays through speakers
  let lastActiveTick = null;

  async function listDevices() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const sel = $('device'), keep = sel.value || store.get('device', '');
      sel.innerHTML = '<option value="">Default microphone</option>' + devs.map((d) => `<option value="${d.deviceId}">${d.label || 'Microphone'}</option>`).join('');
      if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    } catch { /* not allowed yet */ }
  }

  async function startMic() {
    $('micError').hidden = true;
    try {
      if (!ctx) ctx = new AudioContext();
      await ctx.resume();
      const deviceId = $('device').value;
      // Browser voice processing distorts pitch, so turn it off.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      src.connect(analyser);
      $('micBtn').textContent = 'Stop mic';
      store.set('device', deviceId);
      listDevices();
      requestAnimationFrame(tick);
    } catch (err) {
      $('micError').hidden = false;
      $('micError').textContent = 'Could not open the microphone: ' + (err.message || err.name) + '. Check that the browser has mic permission and your microphone is plugged in.';
    }
  }

  function stopMic() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; analyser = null;
    $('micBtn').textContent = 'Start mic';
    $('level').style.width = '0';
    stopDrill();
    stopSong();
  }

  $('micBtn').addEventListener('click', () => (stream ? stopMic() : startMic()));
  $('device').addEventListener('change', () => { if (stream) { stopMic(); startMic(); } });
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener?.('devicechange', listDevices);
  listDevices();

  // A soft piano-ish reference tone.
  function playNote(midi, start, dur, dest = ctx.destination) {
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.25, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.08, start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, start + dur);
    g.connect(dest);
    [[1, 'triangle', 1], [2, 'sine', 0.3]].forEach(([mult, type, amp]) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type; o.frequency.value = f * mult; og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(start); o.stop(start + dur + 0.05);
    });
    return g;
  }

  let drone = null;
  function startDrone(midi) {
    stopDroneNow();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.1);
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = midiToFreq(midi);
    o.connect(g).connect(ctx.destination);
    o.start();
    drone = { o, g };
  }
  function stopDroneNow() {
    if (!drone) return;
    const { o, g } = drone;
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
    o.stop(ctx.currentTime + 0.1);
    drone = null;
  }

  // ---------- main loop ----------
  const recent = [];
  function tick() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const t = ctx.currentTime;
    let level = 0;
    for (let i = 0; i < buf.length; i++) level = Math.max(level, Math.abs(buf[i]));
    $('level').style.width = Math.min(100, level * 140) + '%';

    let midi = null;
    if (t >= ignoreMicUntil) {
      const p = detectPitch(buf, ctx.sampleRate);
      if (p && p.freq > 60 && p.freq < 1100) {
        recent.push(freqToMidi(p.freq));
        if (recent.length > 3) recent.shift();
        midi = median(recent);
      } else {
        recent.length = 0;
      }
    }
    history.push({ t, midi });
    while (history.length && t - history[0].t > HISTORY_SECONDS) history.shift();

    // Count practice time: any second with voiced input.
    if (midi !== null) {
      if (lastActiveTick !== null && t - lastActiveTick < 1) addPracticeSeconds(t - lastActiveTick);
      lastActiveTick = t;
    }

    updateLive(midi);
    if (drill) drillTick(t, midi);
    if (rangeMode) rangeTick(t, midi);
    if (song) songTick(t, midi);
    else if ($('tab-song').classList.contains('active')) drawSongLane();
    requestAnimationFrame(tick);
  }

  let pendingSeconds = 0;
  function addPracticeSeconds(s) {
    pendingSeconds += s;
    if (pendingSeconds < 5) return;
    const mins = store.get('minutes', {});
    mins[today()] = (mins[today()] || 0) + pendingSeconds / 60;
    store.set('minutes', mins);
    pendingSeconds = 0;
  }

  // ---------- live view ----------
  const centreOf = (m) => m - Math.round(m);
  function updateLive(midi) {
    if (!$('tab-live').classList.contains('active') && !$('tab-drills').classList.contains('active')) return;
    if (midi !== null) {
      const c = Math.round(centreOf(midi) * 100);
      $('liveNote').textContent = noteName(midi);
      $('liveCents').textContent = (c > 0 ? '+' : '') + c + ' cents';
      $('liveCents').className = 'cents ' + (Math.abs(c) <= 25 ? 'k-on' : 'k-sharp');
      $('liveMeter').style.left = 50 + c + '%';
      $('liveFreq').textContent = midiToFreq(midi).toFixed(1) + ' Hz';
    }
    if ($('tab-live').classList.contains('active')) drawRoll($('roll'), { seconds: 8 });
    if ($('tab-drills').classList.contains('active')) drawRoll($('drillRoll'), { seconds: 6, target: drill?.target ?? null });
  }

  let viewCentre = 52;
  function drawRoll(canvas, { seconds, target }) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    g.clearRect(0, 0, w, h);

    const now = history.length ? history[history.length - 1].t : 0;
    const voiced = history.filter((p) => p.midi !== null && now - p.t < 2).map((p) => p.midi);
    const want = target ?? (voiced.length ? median(voiced) : viewCentre);
    viewCentre += (want - viewCentre) * 0.08;
    const span = 20, lo = viewCentre - span / 2, hi = viewCentre + span / 2;
    const Y = (m) => h - ((m - lo) / (hi - lo)) * h;
    const X = (t) => w - ((now - t) / seconds) * (w - 44) ;

    g.font = '11px system-ui, sans-serif';
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      g.strokeStyle = isC ? col('--gridC') : col('--grid');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(44, Y(m)); g.lineTo(w, Y(m)); g.stroke();
      const natural = !noteName(m).includes('#');
      if (natural) { g.fillStyle = col('--quiet'); g.fillText(noteName(m), 6, Y(m) + 4); }
    }
    if (target !== null && target !== undefined) {
      g.fillStyle = col('--accent'); g.globalAlpha = 0.15;
      g.fillRect(44, Y(target + 0.5), w - 44, Y(target - 0.5) - Y(target + 0.5));
      g.globalAlpha = 1;
    }
    g.lineWidth = 3; g.lineCap = 'round';
    let prev = null;
    for (const p of history) {
      if (now - p.t > seconds || p.midi === null) { prev = null; continue; }
      const ref = target ?? Math.round(p.midi);
      const dev = Math.abs(p.midi - ref) * 100;
      g.strokeStyle = dev <= 25 ? col('--good') : dev <= 50 ? col('--warn') : col('--bad');
      if (prev) { g.beginPath(); g.moveTo(X(prev.t), Y(prev.midi)); g.lineTo(X(p.t), Y(p.midi)); g.stroke(); }
      prev = p;
    }
  }

  // ---------- drill note range ----------
  function fillNoteSelect(sel, value) {
    sel.innerHTML = '';
    for (let m = 36; m <= 84; m++) sel.add(new Option(noteName(m), m));
    sel.value = value;
  }
  function defaultDrillRange() {
    const r = store.get('ranges', []).at(-1);
    if (r && r.low && r.highChest) return [Math.round(r.low) + 2, Math.round(r.highChest) - 2];
    return [47, 62]; // B2 to D4 until a range test is saved
  }
  const savedDrill = store.get('drillRange', null) || defaultDrillRange();
  fillNoteSelect($('drillLo'), savedDrill[0]);
  fillNoteSelect($('drillHi'), savedDrill[1]);
  ['drillLo', 'drillHi'].forEach((id) => $(id).addEventListener('change', () => store.set('drillRange', [+$('drillLo').value, +$('drillHi').value])));

  // ---------- drills ----------
  let drill = null;
  const NOTE_DUR = 0.9, GAP = 0.15;
  const SCALE_NOTE = 0.45, SCALE_GAP = 0.05, SLOT = 0.7, LEAD_IN = 0.8;
  const SCALES = {
    five: [0, 2, 4, 5, 7, 5, 4, 2, 0],
    octave: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0],
    arpeggio: [0, 4, 7, 12, 7, 4, 0],
  };
  const SKILL_FOR_MODE = { single: 'match', interval: 'match', sustain: 'sustain', scale: 'scales' };
  const syncPatternVisibility = () => { $('scalePatternWrap').hidden = $('drillMode').value !== 'scale'; };
  $('drillMode').addEventListener('change', syncPatternVisibility);
  syncPatternVisibility();

  function pickRound(mode, lo, hi, last) {
    const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    if (mode === 'interval') {
      const steps = [2, 3, 4, 5, 7, 12, -2, -3, -4, -5, -7, -12];
      for (let i = 0; i < 50; i++) {
        const ref = rand(lo, hi), iv = steps[rand(0, steps.length - 1)], target = ref + iv;
        if (target >= lo && target <= hi) return { refs: [ref, target], target };
      }
    }
    let target;
    do { target = rand(lo, hi); } while (target === last && hi > lo);
    return { refs: [target], target };
  }

  function startDrill() {
    if (!analyser) { $('drillPhase').textContent = 'Start the mic first (top right).'; return; }
    const lo = Math.min(+$('drillLo').value, +$('drillHi').value), hi = Math.max(+$('drillLo').value, +$('drillHi').value);
    drill = {
      mode: $('drillMode').value, rounds: Math.max(3, Math.min(30, +$('drillRounds').value || 10)),
      lo, hi, drone: $('drillDrone').checked, round: 0, results: [], target: null, phase: 'idle', frames: [], until: 0,
      startedAt: Date.now(),
    };
    if (drill.mode === 'scale') {
      // Classic warmup ladder: the same pattern, starting a semitone higher each round.
      drill.pattern = SCALES[$('scalePattern').value];
      const top = Math.max(...drill.pattern);
      drill.roots = [];
      for (let r = lo; r + top <= hi; r++) drill.roots.push(r);
      if (!drill.roots.length) drill.roots = [lo];
      drill.rounds = Math.min(drill.rounds, drill.roots.length);
    }
    $('drillSummary').hidden = true;
    $('drillStart').disabled = true; $('drillStop').disabled = false; $('drillReplay').disabled = false;
    nextRound();
  }

  function nextRound() {
    if (!drill) return;
    if (drill.round >= drill.rounds) return finishDrill();
    drill.round++;
    if (drill.mode === 'scale') {
      const root = drill.roots[drill.round - 1];
      drill.refs = drill.pattern.map((p) => root + p);
      drill.target = drill.refs[0];
    } else {
      const r = pickRound(drill.mode, drill.lo, drill.hi, drill.target);
      drill.refs = r.refs; drill.target = r.target;
    }
    $('drillResult').textContent = ''; $('drillResult').className = 'result';
    $('drillCount').textContent = `Round ${drill.round} of ${drill.rounds}`;
    playRefs();
  }

  function playRefs() {
    const t0 = ctx.currentTime + 0.1;
    const scale = drill.mode === 'scale';
    const dur = scale ? SCALE_NOTE : NOTE_DUR, gap = scale ? SCALE_GAP : GAP;
    drill.refs.forEach((m, i) => playNote(m, t0 + i * (dur + gap), dur));
    const end = t0 + drill.refs.length * (dur + gap);
    ignoreMicUntil = end + 0.05; // don't score the speaker
    drill.phase = 'listen'; drill.until = end; drill.frames = [];
    drill.target = drill.mode === 'scale' ? drill.refs[0] : drill.target;
    $('drillPhase').textContent = scale ? 'Listen to the pattern. Then sing it back, one note per beat, following the blue band.'
      : drill.mode === 'interval' ? 'Listen to both notes, then sing the second one.' : 'Listen...';
    $('drillTarget').textContent = scale ? `Pattern from ${noteName(drill.refs[0])}` : drill.mode === 'interval' ? `${noteName(drill.refs[0])} then ?` : '?';
    $('drillNotes').innerHTML = '';
  }

  function scaleTick(t, midi) {
    if (drill.phase === 'listen' && t >= drill.until) {
      drill.phase = 'sing';
      drill.singStart = t + LEAD_IN;
      drill.until = drill.singStart + SLOT * drill.refs.length + 0.15;
      drill.slot = -1;
      $('drillPhase').textContent = 'Get ready...';
      return;
    }
    if (drill.phase !== 'sing') return;
    const rel = t - drill.singStart;
    if (midi !== null && rel >= 0) drill.frames.push({ t: rel, midi });
    const slot = Math.min(drill.refs.length - 1, Math.floor(rel / SLOT));
    if (rel >= 0 && slot !== drill.slot) {
      drill.slot = slot;
      drill.target = drill.refs[slot];
      $('drillPhase').textContent = `Your turn: note ${slot + 1} of ${drill.refs.length}`;
      $('drillTarget').textContent = noteName(drill.target);
      if (drill.drone) { if (!drone) startDrone(drill.target); else drone.o.frequency.setValueAtTime(midiToFreq(drill.target), ctx.currentTime); }
    }
    if (t >= drill.until) evaluateScale();
  }

  function evaluateScale() {
    stopDroneNow();
    drill.phase = 'result';
    const r = scoreSequence(drill.frames, drill.refs, SLOT);
    const misses = r.notes.filter((n) => !n.hit);
    const worst = misses.find((n) => n.kind === 'harmony' || n.kind === 'octave') || misses[0];
    $('drillTarget').textContent = `Score ${r.score}`;
    $('drillResult').textContent = !misses.length ? 'Every note on pitch.' : worst.kind === 'missed' ? `${misses.length} note${misses.length > 1 ? 's' : ''} missed or off. Try to keep singing through the whole pattern.` : `${misses.length} note${misses.length > 1 ? 's' : ''} off. ${noteName(worst.target)}: ${worst.label.toLowerCase()}.`;
    $('drillResult').className = 'result k-' + (!misses.length ? 'on' : worst.kind === 'missed' ? 'off' : worst.kind);
    $('drillNotes').innerHTML = r.notes.map((n) => `<span class="pill k-${n.hit ? 'on' : n.kind === 'missed' ? 'off' : n.kind}" title="${n.voiced ? n.label + ', ' + (n.cents > 0 ? '+' : '') + n.cents + ' cents' : 'not heard'}">${noteName(n.target)} ${n.hit ? '✓' : n.voiced ? '✗' : '–'}</span>`).join('');
    drill.results.push({ root: drill.refs[0], voiced: r.notes.some((n) => n.voiced), score: r.score, notes: r.notes.map((n) => ({ target: n.target, kind: n.hit ? 'on' : n.kind, cents: n.cents })) });
    $('drillPhase').textContent = drill.round < drill.rounds ? 'Next pattern, a semitone higher...' : '';
    setTimeout(() => { if (drill && drill.phase === 'result') nextRound(); }, 2600);
  }

  function drillTick(t, midi) {
    if (drill.mode === 'scale') return scaleTick(t, midi);
    if (drill.phase === 'listen' && t >= drill.until) {
      drill.phase = 'sing';
      drill.singStart = t;
      drill.until = t + (drill.mode === 'sustain' ? 6 : 3);
      if (drill.drone) startDrone(drill.target);
      $('drillPhase').textContent = drill.mode === 'sustain' ? 'Your turn: hold the note steady.' : 'Your turn: sing it.';
    } else if (drill.phase === 'sing') {
      if (midi !== null) drill.frames.push({ t: t - drill.singStart, midi });
      // Sustain mode: stop 5 s after the voice starts, or at the window end.
      const voicedFor = drill.frames.length ? t - drill.singStart - drill.frames[0].t : 0;
      if (t >= drill.until || (drill.mode === 'sustain' && voicedFor >= 5) || (drill.mode !== 'sustain' && voicedFor >= 2)) evaluateRound();
    }
  }

  function evaluateRound() {
    stopDroneNow();
    drill.phase = 'result';
    const r = scoreAttempt(drill.frames, drill.target);
    $('drillTarget').textContent = noteName(drill.target);
    if (!r.voiced) {
      $('drillResult').textContent = "Didn't hear you. Try a little louder or closer to the mic.";
      $('drillResult').className = 'result k-off';
      drill.results.push({ target: drill.target, voiced: false });
    } else {
      const parts = [`${r.offset.label}`, `score ${r.score}`];
      if (r.offset.kind === 'on' || r.offset.kind === 'sharp' || r.offset.kind === 'flat') parts.push(`${r.medianCents > 0 ? '+' : ''}${r.medianCents} cents`);
      else parts.push(`you sang ${noteName(r.sungMidi)}`);
      if (drill.mode === 'sustain') parts.push(`wobble ±${r.spreadCents} cents`);
      else if (r.settle !== null) parts.push(`settled in ${r.settle.toFixed(1)} s`);
      $('drillResult').textContent = parts.join(' · ');
      $('drillResult').className = 'result k-' + r.offset.kind;
      drill.results.push({ target: drill.target, voiced: true, score: r.score, cents: r.medianCents, kind: r.offset.kind, sung: Math.round(r.sungMidi), spread: r.spreadCents, settle: r.settle });
    }
    $('drillPhase').textContent = 'Next note coming...';
    setTimeout(() => { if (drill && drill.phase === 'result') nextRound(); }, 1800);
  }

  function finishDrill() {
    const res = drill.results;
    const sung = res.filter((r) => r.voiced);
    const avg = sung.length ? Math.round(sung.reduce((a, r) => a + r.score, 0) / sung.length) : 0;
    // Scales are counted per note; the other drills per attempt.
    const items = drill.mode === 'scale' ? res.flatMap((r) => r.notes) : sung;
    const count = (k) => items.filter((r) => r.kind === k).length;
    const session = {
      date: new Date().toISOString(), mode: drill.mode, rounds: res.length, total: items.length, avgScore: avg,
      onPitch: count('on'), harmony: count('harmony'), octave: count('octave'), off: items.length - count('on') - count('harmony') - count('octave'),
      range: [drill.lo, drill.hi], results: res,
    };
    if (drill.mode === 'scale') session.pattern = $('scalePattern').value;
    markDone(SKILL_FOR_MODE[drill.mode]);
    const all = store.get('sessions', []); all.push(session); store.set('sessions', all);
    const s = $('drillSummary');
    s.hidden = false;
    s.innerHTML = `<h2>Drill done: average score ${avg}</h2>
      <p><span class="pill k-on">${session.onPitch} on pitch</span><span class="pill k-harmony">${session.harmony} on a harmony note</span><span class="pill k-octave">${session.octave} wrong octave</span><span class="pill k-off">${session.off} ${drill.mode === 'scale' ? 'missed or ' : ''}otherwise off</span></p>
      <p class="quiet">${adviceFor(session)}</p>`;
    $('drillPhase').textContent = 'Done. Saved to Progress.';
    resetDrillButtons();
    drill = null;
  }

  function adviceFor(s) {
    if (s.harmony >= 2) return 'You landed on harmony notes several times. Before singing, hum the reference quietly in your head, then start softly and slide to the note while watching the line.';
    if (s.octave >= 2) return 'Several notes were in the wrong octave. Try the "keep the note playing" option with headphones so you can hear when you lock in.';
    if (s.avgScore >= 80) return s.mode === 'scale' ? 'Strong round. Try the next pattern up: octave scale or arpeggio.' : 'Strong round. Try widening the note range or switching to intervals.';
    return 'Keep going. Accuracy usually improves within a couple of weeks of daily drills.';
  }

  function stopDrill() {
    if (!drill) return;
    stopDroneNow();
    $('drillNotes').innerHTML = '';
    drill = null;
    ignoreMicUntil = 0;
    $('drillPhase').textContent = 'Stopped.';
    resetDrillButtons();
  }
  function resetDrillButtons() { $('drillStart').disabled = false; $('drillStop').disabled = true; $('drillReplay').disabled = true; }

  $('drillStart').addEventListener('click', startDrill);
  $('drillStop').addEventListener('click', stopDrill);
  $('drillReplay').addEventListener('click', () => { if (drill && drill.phase !== 'listen') { stopDroneNow(); playRefs(); } });

  // ---------- song mode ----------
  // Sing along to a transcribed melody: note bars scroll towards a line, the
  // guide tone and click play on headphones, and every note is scored as it passes.
  const SONG = window.VTsongs[0];
  const SONG_PHRASES = songPhrases(SONG);
  const LATENCY = 0.05; // mic frames describe audio from slightly earlier
  const BEHIND = 2.5, AHEAD = 6; // seconds of lane shown either side of the line
  let song = null;

  function fillSongControls() {
    $('songTitle').textContent = `${SONG.title} (${SONG.artist})`;
    const sel = $('songPart');
    sel.add(new Option('Whole song', `0-${Infinity}`));
    const sections = SONG.sections.map((s, i) => ({ ...s, end: SONG.sections[i + 1]?.bar ?? Infinity }));
    const sg = document.createElement('optgroup'); sg.label = 'Sections';
    sections.forEach((s) => sg.append(new Option(s.name, `${s.bar}-${s.end}`)));
    const pg = document.createElement('optgroup'); pg.label = 'One line at a time';
    SONG_PHRASES.forEach((p) => pg.append(new Option(p.label, `${p.bar}-${p.end}`)));
    sel.append(sg, pg);
    for (let k = 12; k >= -12; k--) $('songKey').add(new Option(k === 0 ? 'Original key' : k === -12 ? 'An octave lower' : k === 12 ? 'An octave higher' : `${k > 0 ? '+' : ''}${k} semitone${Math.abs(k) > 1 ? 's' : ''}`, k));
    const saved = store.get('song', {});
    if (saved.part && [...sel.options].some((o) => o.value === saved.part)) sel.value = saved.part;
    $('songKey').value = saved.key ?? 0;
    $('songTempo').value = saved.tempo ?? 80;
    ['songPart', 'songKey', 'songTempo'].forEach((id) => $(id).addEventListener('input', onSongSettings));
    onSongSettings();
  }

  function songSettings() {
    const [from, to] = $('songPart').value.split('-').map(Number);
    const firstBar = Math.min(...SONG.phrases);
    const fromBar = Math.max(from, firstBar);
    const bpm = Math.round((SONG.bpm * +$('songTempo').value) / 100);
    return { fromBar, toBar: to, bpm, transpose: +$('songKey').value };
  }

  function onSongSettings() {
    store.set('song', { part: $('songPart').value, key: +$('songKey').value, tempo: +$('songTempo').value });
    const st = songSettings();
    $('songTempoLabel').textContent = `${st.bpm} bpm${+$('songTempo').value === 100 ? ' (original)' : ''}`;
    const tl = songTimeline(SONG, st);
    const ms = tl.map((n) => n.midi);
    $('songRange').textContent = tl.length ? `Notes from ${noteName(Math.min(...ms))} to ${noteName(Math.max(...ms))}` : '';
    if (!song) drawSongLane();
  }

  function startSong() {
    if (!analyser) { $('songPhase').textContent = 'Start the mic first (top right).'; return; }
    stopDrill();
    const st = songSettings();
    const notes = songTimeline(SONG, st);
    if (!notes.length) return;
    const beat = 60 / st.bpm;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);
    song = {
      ...st, notes, beat, out, pass: 0, passes: [],
      guide: $('songGuide').checked, click: $('songClick').checked, loop: $('songLoop').checked,
      lo: Math.min(...notes.map((n) => n.midi)) - 3, hi: Math.max(...notes.map((n) => n.midi)) + 3,
      length: notes.at(-1).start + notes.at(-1).dur,
    };
    $('songSummary').hidden = true;
    $('songStart').disabled = true; $('songStop').disabled = false;
    startPass(ctx.currentTime + 0.2);
  }

  // One run through the chosen part, after a bar of count-in clicks.
  function startPass(at) {
    song.pass++;
    song.t0 = at + 4 * song.beat;
    song.frames = []; song.results = []; song.scored = 0; song.scheduled = 0; song.clicks = -4;
    $('songPass').textContent = song.loop ? `Pass ${song.pass}` : '';
    $('songPhase').textContent = 'Count in: 1, 2, 3, 4...';
  }

  function click(at, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(0.12, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    o.connect(g).connect(song.out); o.start(at); o.stop(at + 0.06);
  }

  function songTick(t, midi) {
    const rel = t - LATENCY - song.t0; // seconds into the part, on the singer's clock
    const ahead = t + 0.3 - song.t0;   // schedule audio a little ahead of time
    // Guide tone and click.
    while (song.scheduled < song.notes.length && song.notes[song.scheduled].start < ahead) {
      const n = song.notes[song.scheduled++];
      if (song.guide) playNote(n.midi, song.t0 + n.start, Math.max(0.12, n.dur * 0.95), song.out);
    }
    while (song.clicks * song.beat < Math.min(ahead, song.length + 0.01)) {
      if (song.click || song.clicks < 0) click(song.t0 + song.clicks * song.beat, ((song.clicks % 4) + 4) % 4 === 0);
      song.clicks++;
    }
    if (midi !== null && rel >= -0.5) song.frames.push({ t: rel, midi });
    // Score each note once its window has passed.
    while (song.scored < song.notes.length) {
      const n = song.notes[song.scored];
      if (rel < n.start + n.dur + 0.1) break;
      song.results.push(scoreTimedNote(song.frames, n));
      song.scored++;
    }
    const cur = song.notes.find((n) => rel < n.start + n.dur) || null;
    if (rel >= 0) {
      $('songPhase').textContent = cur ? cur.label : 'Finishing...';
      $('songNow').textContent = cur ? (rel >= cur.start ? noteName(cur.midi) : `Next: ${noteName(cur.midi)}`) : ' ';
    }
    if ($('tab-song').classList.contains('active')) drawSongLane(rel);
    if (song.scored === song.notes.length && rel > song.length + 0.3) finishPass();
  }

  function finishPass() {
    const phrases = phraseScores(song.notes, song.results);
    const voiced = song.results.some((r) => r.voiced);
    song.passes.push({ phrases, results: song.results });
    renderSongSummary(phrases);
    if (voiced) saveSongPass(phrases);
    if (song.loop) startPass(ctx.currentTime + 0.6);
    else endSong('Done. Saved to Progress.');
  }

  const KIND_TEXT = { harmony: 'on a harmony note', octave: 'in the wrong octave', off: 'off', sharp: 'a little sharp', flat: 'a little flat', missed: 'not heard' };
  function renderSongSummary(phrases) {
    const time = phrases.reduce((a, p) => a + p.time, 0), hit = phrases.reduce((a, p) => a + p.hitTime, 0);
    const overall = Math.round((hit / time) * 100);
    const issues = (p) => Object.entries(p.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="pill k-${k === 'missed' ? 'off' : k}">${n} ${KIND_TEXT[k] || k}</span>`).join('');
    const worst = phrases.filter((p) => p.score < 70).sort((a, b) => a.score - b.score)[0];
    const harm = phrases.reduce((a, p) => a + (p.kinds.harmony || 0), 0);
    let advice = overall >= 80 ? 'Strong run. Try a faster tempo, or the next section.' : worst ? `Work on ${worst.label}: pick it under "One line at a time", turn on Repeat, and sing it until it scores above 70.` : 'Keep going.';
    if (harm >= 3) advice = `You landed on harmony notes ${harm} times. That is your known habit: hum the guide melody first, then sing it softly and watch the bars.`;
    const s = $('songSummary');
    s.hidden = false;
    s.innerHTML = `<h2>${song.pass > 1 ? `Pass ${song.pass}: ` : ''}score ${overall}</h2>
      <table><tr><th>Line</th><th>Score</th><th>Notes hit</th><th>Misses</th></tr>
      ${phrases.map((p) => `<tr><td>${p.label}</td><td class="score k-${p.score >= 80 ? 'on' : p.score >= 50 ? 'sharp' : 'off'}">${p.score}</td><td>${p.hits}/${p.total}</td><td>${issues(p)}</td></tr>`).join('')}</table>
      <p class="quiet">${advice}</p>`;
    song.overall = overall;
  }

  // Saved like a drill session: each line of the song is one round, each note an attempt.
  function saveSongPass(phrases) {
    const items = song.results.map((r) => ({ kind: r.hit ? 'on' : r.kind }));
    const count = (k) => items.filter((r) => r.kind === k).length;
    const results = phrases.map((p) => {
      const idx = song.notes.map((n, i) => (n.phrase === p.phrase ? i : -1)).filter((i) => i >= 0);
      const rs = idx.map((i) => song.results[i]);
      return { root: song.notes[idx[0]].midi, voiced: rs.some((r) => r.voiced), score: p.score, notes: rs.map((r) => ({ target: r.target, kind: r.hit ? 'on' : r.kind, cents: r.cents })) };
    });
    const part = $('songPart').selectedOptions[0].textContent;
    const session = {
      date: new Date().toISOString(), mode: 'song', pattern: `${SONG.title} | ${part} | key ${song.transpose > 0 ? '+' : ''}${song.transpose} | ${song.bpm} bpm`,
      rounds: results.length, total: items.length, avgScore: song.overall,
      onPitch: count('on'), harmony: count('harmony'), octave: count('octave'), off: items.length - count('on') - count('harmony') - count('octave'),
      range: [song.lo + 3, song.hi - 3], results,
    };
    const all = store.get('sessions', []); all.push(session); store.set('sessions', all);
    markDone('song');
  }

  function endSong(msg) {
    if (!song) return;
    const out = song.out;
    out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
    setTimeout(() => out.disconnect(), 200);
    song = null;
    $('songPhase').textContent = msg;
    $('songNow').textContent = ' ';
    $('songStart').disabled = false; $('songStop').disabled = true;
    drawSongLane();
  }
  function stopSong() {
    if (!song) return;
    // A pass stopped part-way still counts for the lines already finished.
    const done = song.notes.slice(0, song.scored).filter((n, i, a) => {
      const next = song.notes[song.scored];
      return !next || n.phrase !== next.phrase;
    });
    if (done.length && song.results.slice(0, done.length).some((r) => r.voiced)) {
      const notes = song.notes;
      song.notes = done; song.results = song.results.slice(0, done.length);
      const phrases = phraseScores(song.notes, song.results);
      renderSongSummary(phrases);
      saveSongPass(phrases);
      song.notes = notes;
      return endSong('Stopped. The lines you finished are saved to Progress.');
    }
    endSong('Stopped.');
  }

  // The note lane: time runs right to left; notes are sung as they cross the line.
  function drawSongLane(rel = null) {
    const canvas = $('songLane');
    if (!canvas.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    g.clearRect(0, 0, w, h);

    const notes = song ? song.notes : songTimeline(SONG, songSettings());
    if (!notes.length) return;
    const lo = song ? song.lo : Math.min(...notes.map((n) => n.midi)) - 3;
    const hi = song ? song.hi : Math.max(...notes.map((n) => n.midi)) + 3;
    const now = rel ?? -1.5;
    const left = 44, lineX = left + (w - left) * (BEHIND / (BEHIND + AHEAD));
    const pps = (w - left) / (BEHIND + AHEAD);
    const X = (t) => lineX + (t - now) * pps;
    const Y = (m) => h - ((m - lo) / (hi - lo)) * h;
    const rowH = h / (hi - lo);

    g.font = '11px system-ui, sans-serif';
    for (let m = Math.ceil(lo); m <= hi; m++) {
      g.strokeStyle = ((m % 12) + 12) % 12 === 0 ? col('--gridC') : col('--grid');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(left, Y(m)); g.lineTo(w, Y(m)); g.stroke();
      if (!noteName(m).includes('#')) { g.fillStyle = col('--quiet'); g.fillText(noteName(m), 6, Y(m) + 4); }
    }
    // Phrase labels along the top.
    g.fillStyle = col('--quiet');
    let lastPhrase = null;
    notes.forEach((n) => {
      if (n.phrase === lastPhrase) return;
      lastPhrase = n.phrase;
      const x = X(n.start);
      if (x > left - 200 && x < w) { g.fillText(n.label, Math.max(left + 4, x), 14); }
    });
    // Note bars.
    const KIND_COL = { on: '--good', harmony: '--harm', octave: '--accent', off: '--bad', sharp: '--warn', flat: '--warn' };
    notes.forEach((n, i) => {
      const x0 = X(n.start), x1 = X(n.start + n.dur);
      if (x1 < left || x0 > w) return;
      const r = song && song.results[i];
      g.fillStyle = r ? (r.hit ? col('--good') : r.kind === 'missed' ? col('--line') : col(KIND_COL[r.kind] || '--bad')) : col('--accent');
      g.globalAlpha = r ? 0.85 : 0.35;
      const y = Y(n.midi + 0.5), hh = Math.max(6, rowH);
      g.beginPath(); g.roundRect(Math.max(left, x0 + 1), y, Math.max(3, Math.min(x1, w) - Math.max(left, x0 + 1) - 2), hh, 4); g.fill();
      g.globalAlpha = 1;
    });
    // The sing line.
    g.strokeStyle = col('--ink'); g.globalAlpha = 0.5; g.lineWidth = 2;
    g.beginPath(); g.moveTo(lineX, 0); g.lineTo(lineX, h); g.stroke(); g.globalAlpha = 1;
    // Your voice, coloured by distance from the note being sung at that moment.
    if (!song) return;
    g.lineWidth = 3; g.lineCap = 'round';
    let prev = null, k = 0;
    for (const p of song.frames) {
      if (p.t < now - BEHIND) { prev = null; continue; }
      while (k < notes.length - 1 && notes[k].start + notes[k].dur <= p.t) k++;
      const n = notes[k];
      const inNote = p.t >= n.start && p.t < n.start + n.dur;
      const dev = Math.abs(p.midi - (inNote ? n.midi : Math.round(p.midi))) * 100;
      g.strokeStyle = dev <= 25 ? col('--good') : dev <= 50 ? col('--warn') : col('--bad');
      if (prev && p.t - prev.t < 0.15) { g.beginPath(); g.moveTo(X(prev.t), Y(prev.midi)); g.lineTo(X(p.t), Y(p.midi)); g.stroke(); }
      prev = p;
    }
  }

  $('songStart').addEventListener('click', startSong);
  $('songStop').addEventListener('click', stopSong);
  window.addEventListener('resize', () => { if (!song) drawSongLane(); });
  fillSongControls();

  // ---------- range test ----------
  let rangeMode = null, rangeFrames = [];
  const rangeResult = {};
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    if (!analyser) { $('rangeLive').textContent = 'Start the mic first (top right).'; return; }
    if (rangeMode === b.dataset.range) { rangeMode = null; b.classList.remove('primary'); renderRangeSummary(); return; }
    document.querySelectorAll('[data-range]').forEach((x) => x.classList.remove('primary'));
    b.classList.add('primary');
    rangeMode = b.dataset.range; rangeFrames = [];
    $('rangeLive').textContent = 'Listening... click the button again when done.';
  }));

  function rangeTick(t, midi) {
    if (midi === null) return;
    rangeFrames.push({ t, midi });
    if (rangeFrames.length > 120) rangeFrames.shift();
    const held = stableNote(rangeFrames);
    if (held === null) return;
    const cur = rangeResult[rangeMode];
    const better = cur === undefined || (rangeMode === 'low' ? held < cur : held > cur);
    if (better) rangeResult[rangeMode] = held;
    $('rangeLive').textContent = `Holding ${noteName(held)} · best so far ${noteName(rangeResult[rangeMode])}`;
    $('rangeSave').disabled = false;
  }

  function renderRangeSummary() {
    const f = (k) => (rangeResult[k] !== undefined ? noteName(rangeResult[k]) : '--');
    $('rangeSummary').textContent = `Lowest ${f('low')} · highest normal voice ${f('highChest')} · highest falsetto ${f('highFalsetto')}`;
  }

  $('rangeSave').addEventListener('click', () => {
    rangeMode = null;
    document.querySelectorAll('[data-range]').forEach((x) => x.classList.remove('primary'));
    const all = store.get('ranges', []);
    all.push({ date: new Date().toISOString(), ...rangeResult });
    store.set('ranges', all);
    renderRangeSummary();
    if (rangeResult.low !== undefined && rangeResult.highChest !== undefined) {
      const [lo, hi] = defaultDrillRange();
      $('drillLo').value = lo; $('drillHi').value = hi; store.set('drillRange', [lo, hi]);
    }
    $('rangeLive').textContent = 'Saved. Drills now use this range.';
    renderRangeHistory();
  });

  function renderRangeHistory() {
    const all = store.get('ranges', []);
    if (!all.length) return;
    const n = (m) => (m !== undefined ? noteName(m) : '--');
    $('rangeHistory').innerHTML = '<table><tr><th>Date</th><th>Lowest</th><th>Highest normal</th><th>Highest falsetto</th><th>Span</th></tr>' +
      [...all].reverse().map((r) => `<tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${n(r.low)}</td><td>${n(r.highChest)}</td><td>${n(r.highFalsetto)}</td><td>${r.low !== undefined ? Math.round(Math.max(r.highChest ?? -1e9, r.highFalsetto ?? -1e9) - r.low) + ' semitones' : '--'}</td></tr>`).join('') + '</table>';
  }
  renderRangeHistory();

  // ---------- today: skills that fade without practice ----------
  const SKILLS = [
    {
      key: 'warmup', mins: 3, name: 'Warmup', what: 'Gets your voice moving gently before any real singing.',
      how: ['Hum through a drinking straw, or do lip trills (blow air through loose lips so they buzz like a motorboat).', 'Slide slowly from a low note to a high one and back, like a siren. Stay quiet and easy.', 'Nothing should feel pushed. If it scratches, stop for today.'],
      why: 'Straw and lip-trill exercises balance air pressure on your vocal folds. Voice teachers use them first, especially for a tired voice.',
      action: { label: 'Start 3-minute timer', timer: 180 },
    },
    {
      key: 'sustain', mins: 2, name: 'Steady notes', what: 'Hold one note without it wobbling or drifting.',
      how: ['The app plays a note. Sing it on "ah" and hold it for 5 seconds.', 'Watch the line: you want it flat and inside the blue band.', 'Breathe in low (belly moves out) before each note.'],
      why: 'A steady tone is the base for pitch accuracy. If the note drifts while you hold it, it will drift in songs too.',
      action: { label: 'Go to Sustain drill', mode: 'sustain' },
    },
    {
      key: 'scales', mins: 3, name: 'Scales', what: 'Sing short note patterns up and down, a step higher each round.',
      how: ['The app plays a pattern, like do-re-mi-fa-so-fa-mi-re-do.', 'Sing it back, one note per beat, following the moving blue band.', 'Each round starts a semitone higher. Stop before it strains.'],
      why: 'Scales train your ear to move between notes accurately, which is exactly what a melody asks of you. They also widen your range gradually.',
      action: { label: 'Go to Scales drill', mode: 'scale' },
    },
    {
      key: 'match', mins: 3, name: 'Pitch matching', what: 'Hear a note, then sing that exact note back.',
      how: ['Listen to the note. Hear it in your head before you open your mouth.', 'Start softly and let your voice settle onto the note.', 'Watch for "harmony" or "octave" results. Those are your habit to break.'],
      why: 'This targets your main habit: landing on a harmony note instead of the melody. Interval mode is the harder version.',
      action: { label: 'Go to Pitch drill', mode: 'single' },
    },
    {
      key: 'song', mins: 4, name: 'Song phrase', what: 'Sing one or two lines of your current song.',
      how: ['In the Song tab, pick one line of Ode to Joy under "One line at a time" and turn on Repeat.', 'Listen to the guide melody once, then sing along as the bars cross the line. Check you are in the right octave.', 'Stay on the same line until it scores above 70, then move to the next one. Slow the tempo down if it rushes past.'],
      why: 'Songs are the goal. A phrase a day is enough to make steady progress without tiring your voice.',
      action: { label: 'Go to Song', tab: 'song' },
    },
  ];

  function doneDates(skill) {
    const all = store.get('done', {});
    return Object.keys(all).filter((d) => all[d][skill]);
  }
  function markDone(skill, value = true) {
    if (!skill) return;
    const all = store.get('done', {});
    all[today()] = { ...(all[today()] || {}), [skill]: value };
    store.set('done', all);
    renderToday();
  }
  function daysAgo(dateStr) {
    return Math.round((Date.parse(today() + 'T00:00:00Z') - Date.parse(dateStr + 'T00:00:00Z')) / 864e5);
  }
  function freshLabel(f, last) {
    if (last === undefined) return 'Not started';
    if (f >= 0.75) return 'Strong';
    if (f >= 0.45) return 'Holding';
    if (f >= 0.2) return 'Fading';
    return 'Rusty';
  }
  function streak() {
    const all = store.get('done', {});
    const any = (d) => all[d] && Object.values(all[d]).some(Boolean);
    let n = 0;
    const d = new Date();
    if (!any(d.toLocaleDateString('en-CA'))) d.setDate(d.getDate() - 1); // today not done yet keeps yesterday's streak
    while (any(d.toLocaleDateString('en-CA'))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  let timer = null;
  function renderToday() {
    const doneToday = store.get('done', {})[today()] || {};
    const last14 = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return d.toLocaleDateString('en-CA'); });
    const allDone = store.get('done', {});
    $('skills').innerHTML = SKILLS.map((sk) => {
      const dates = doneDates(sk.key);
      const f = freshness(dates, today());
      const last = dates.sort().at(-1);
      const lastText = last === undefined ? 'Never practised' : daysAgo(last) === 0 ? 'Done today' : daysAgo(last) === 1 ? 'Last done yesterday' : `Last done ${daysAgo(last)} days ago`;
      const running = timer && timer.skill === sk.key;
      return `<div class="skill ${doneToday[sk.key] ? 'done' : ''}" style="--f:${f.toFixed(3)}">
        <label class="tick" title="Mark done today"><input type="checkbox" data-skill="${sk.key}" ${doneToday[sk.key] ? 'checked' : ''}><span></span></label>
        <div class="skill-body">
          <div class="skill-head"><b>${sk.name}</b><span class="quiet">${sk.mins} min</span></div>
          <div class="quiet">${sk.what}</div>
          <details><summary>How to do it</summary><ol>${sk.how.map((h) => `<li>${h}</li>`).join('')}</ol><p class="quiet">${sk.why}</p></details>
          <button class="btn small" data-action="${sk.key}">${running ? `Stop timer (${fmt(timer.left)})` : sk.action.label}</button>
        </div>
        <div class="fresh">
          <div class="fresh-label"><span>${freshLabel(f, last)}</span><span class="quiet">${lastText}</span></div>
          <div class="fresh-bar"><div></div></div>
          <div class="dots">${last14.map((d) => `<i class="${allDone[d] && allDone[d][sk.key] ? 'on' : ''}" title="${d}"></i>`).join('')}</div>
        </div>
      </div>`;
    }).join('');
    const n = streak();
    $('streak').textContent = n ? `${n}-day streak` : 'Start a streak today';
    const doneCount = SKILLS.filter((sk) => doneToday[sk.key]).length;
    $('todayCount').textContent = `${doneCount} of ${SKILLS.length} done today`;
    const mins = store.get('minutes', {})[today()] || 0;
    $('minutesToday').textContent = `You've sung for about ${Math.round(mins)} minute${Math.round(mins) === 1 ? '' : 's'} today (counted while the mic hears your voice).`;
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function chime() {
    try {
      if (!ctx) ctx = new AudioContext();
      const t0 = ctx.currentTime + 0.05;
      [72, 76, 79].forEach((m, i) => playNote(m, t0 + i * 0.18, 0.5));
    } catch { /* audio unavailable */ }
  }

  $('skills').addEventListener('change', (e) => {
    const k = e.target.dataset.skill;
    if (k) markDone(k, e.target.checked);
  });
  $('skills').addEventListener('click', (e) => {
    const k = e.target.dataset.action;
    if (!k) return;
    const sk = SKILLS.find((x) => x.key === k);
    if (sk.action.tab) { document.querySelector(`nav button[data-tab=${sk.action.tab}]`).click(); return; }
    if (sk.action.mode) {
      $('drillMode').value = sk.action.mode;
      syncPatternVisibility();
      document.querySelector('nav button[data-tab=drills]').click();
      return;
    }
    if (timer && timer.skill === k) { clearInterval(timer.id); timer = null; renderToday(); return; }
    if (timer) clearInterval(timer.id);
    timer = { skill: k, left: sk.action.timer };
    timer.id = setInterval(() => {
      timer.left--;
      if (timer.left <= 0) { clearInterval(timer.id); timer = null; chime(); markDone(k); return; }
      const b = document.querySelector(`[data-action="${k}"]`);
      if (b) b.textContent = `Stop timer (${fmt(timer.left)})`;
    }, 1000);
    renderToday();
  });
  renderToday();

  // ---------- progress ----------
  const MODE_NAMES = { single: 'Single notes', interval: 'Intervals', sustain: 'Sustain', scale: 'Scales', song: 'Song' };
  function renderProgress() {
    const mins = store.get('minutes', {});
    const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return d.toLocaleDateString('en-CA'); });
    const max = Math.max(15, ...days.map((d) => mins[d] || 0));
    $('bars').innerHTML = days.map((d) => `<div title="${d}: ${Math.round(mins[d] || 0)} min" style="height:${((mins[d] || 0) / max) * 100}%"></div>`).join('');
    $('barlabels').innerHTML = days.map((d) => `<span>${Number(d.slice(8))}</span>`).join('');

    const sessions = store.get('sessions', []);
    if (sessions.length) {
      $('sessions').innerHTML = '<table><tr><th>Date</th><th>Drill</th><th>Notes</th><th>Avg score</th><th>On pitch</th><th>Harmony</th><th>Octave</th></tr>' +
        [...sessions].reverse().slice(0, 50).map((s) => `<tr><td>${new Date(s.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td><td>${MODE_NAMES[s.mode] || s.mode}${s.mode === 'song' && s.pattern ? ': ' + s.pattern.split(' | ')[1] : ''}</td><td>${noteName(s.range[0])}–${noteName(s.range[1])}</td><td><b>${s.avgScore}</b></td><td>${s.onPitch}/${s.total ?? s.rounds}</td><td>${s.harmony}</td><td>${s.octave}</td></tr>`).join('') + '</table>';
    }
  }


  // ---------- data folder (CSV files) ----------
  // The browser stores data itself; when a folder is connected, every change is
  // also written there as CSV. If the browser's copy is ever empty, connecting the
  // same folder restores from the CSVs.
  const CSV_NAMES = ['sessions.csv', 'attempts.csv', 'ranges.csv', 'daily.csv'];
  var dataDir = null, saveTimer = null, lastSaved = null, folderNote = ''; // var: store.set may run before this line

  const idb = (mode, fn) => new Promise((resolve, reject) => {
    const open = indexedDB.open('vocal-trainer', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      } catch (err) { reject(err); }
    };
  });
  const saveHandle = (h) => idb('readwrite', (st) => st.put(h, 'dataDir')).catch(() => {});
  const loadHandle = () => idb('readonly', (st) => st.get('dataDir')).catch(() => null);

  async function readFolder(dir) {
    const files = {};
    for (const name of CSV_NAMES) {
      try { files[name] = await (await (await dir.getFileHandle(name)).getFile()).text(); } catch { /* not there yet */ }
    }
    return files;
  }

  async function writeFolder() {
    if (!dataDir) return;
    try {
      const tables = window.VTcsv.exportTables(allData());
      for (const [name, text] of Object.entries(tables)) {
        const w = await (await dataDir.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      }
      lastSaved = new Date();
      if (folderNote.startsWith('Could not save')) folderNote = '';
    } catch (err) {
      folderNote = 'Could not save: ' + (err.message || err.name);
    }
    renderFolder();
  }

  function scheduleFolderSave() {
    if (!dataDir) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeFolder, 1500);
  }

  // Merge the folder's CSVs with the browser's copy, keep the result in both.
  async function useFolder(dir) {
    dataDir = dir;
    const fromFolder = window.VTcsv.importTables(await readFolder(dir));
    const local = allData();
    const merged = window.VTcsv.mergeData(local, fromFolder);
    const added = merged.sessions.length - local.sessions.length;
    try {
      for (const k of DATA_KEYS) localStorage.setItem('vt.' + k, JSON.stringify(merged[k]));
    } catch { /* storage unavailable */ }
    folderNote = added > 0 ? `Restored ${added} drill session${added === 1 ? '' : 's'} from the folder.` : '';
    renderToday(); renderRangeHistory(); renderProgress();
    await writeFolder();
  }

  async function chooseFolder() {
    try {
      const dir = await window.showDirectoryPicker({ id: 'vocal-trainer-data', mode: 'readwrite', startIn: 'documents' });
      await saveHandle(dir);
      await useFolder(dir);
    } catch (err) {
      if (err.name !== 'AbortError') { folderNote = 'Could not open that folder: ' + (err.message || err.name); renderFolder(); }
    }
  }

  let pendingHandle = null;
  async function reconnectFolder() {
    if (!pendingHandle) return;
    if ((await pendingHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
      const h = pendingHandle; pendingHandle = null;
      await useFolder(h);
    }
    renderFolder();
  }

  function renderFolder() {
    const supported = 'showDirectoryPicker' in window;
    let status;
    if (!supported) status = 'This browser cannot save to a folder. Use Export below to back up.';
    else if (dataDir) status = `Saving to the folder "${dataDir.name}"` + (lastSaved ? `, last saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '.');
    else if (pendingHandle) status = `Your data folder "${pendingHandle.name}" needs permission again before the app can save to it.`;
    else status = 'Not saving to a folder yet. Choose one (the data folder inside your VocalTrainer folder is a good spot) to keep your history as CSV files you can open in Excel.';
    $('folderStatus').textContent = status;
    $('folderNote').textContent = folderNote;
    $('folderChoose').hidden = !supported;
    $('folderChoose').textContent = dataDir || pendingHandle ? 'Change folder' : 'Choose folder';
    $('folderReconnect').hidden = !pendingHandle;
    $('folderBanner').hidden = !pendingHandle;
  }

  $('folderChoose').addEventListener('click', chooseFolder);
  $('folderReconnect').addEventListener('click', reconnectFolder);
  $('folderBannerBtn').addEventListener('click', reconnectFolder);

  (async () => {
    renderFolder();
    if (!('showDirectoryPicker' in window)) return;
    const h = await loadHandle();
    if (!h) return;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') await useFolder(h);
    else { pendingHandle = h; renderFolder(); }
  })();

  $('exportBtn').addEventListener('click', () => {
    const data = { exported: new Date().toISOString(), sessions: store.get('sessions', []), ranges: store.get('ranges', []), minutes: store.get('minutes', {}), done: store.get('done', {}) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `vocal-trainer-${today()}.json`;
    a.click();
  });

  window.addEventListener('beforeunload', () => {
    if (pendingSeconds <= 0) return;
    const mins = store.get('minutes', {});
    mins[today()] = (mins[today()] || 0) + pendingSeconds / 60;
    store.set('minutes', mins);
  });
})();
