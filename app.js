/* Roadie — Phase 1: core practice runner
   Plain JavaScript, no build step. */
'use strict';

/* =========================================================
   Storage
   ========================================================= */
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem('roadie.' + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('roadie.' + key, JSON.stringify(value)); }
    catch (e) { toast('Could not save — storage full?'); }
  }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =========================================================
   Built-in drills and defaults
   ========================================================= */
const BUILTIN_EXERCISES = [
  { id: 'b-spider', name: 'Chromatic Spider', bpm: 80, duration: 120, tip: 'One finger per fret. Keep your fingers hovering close to the strings.' },
  { id: 'b-single', name: 'Single-String Picking', bpm: 90, duration: 120, tip: 'Strict alternate picking. Keep the motion small and from the wrist.' },
  { id: 'b-skip', name: 'String Skipping', bpm: 70, duration: 120, tip: 'Keep the pick close to the strings and mute the ones you skip.' },
  { id: 'b-chords', name: 'Chord Changes', bpm: 60, duration: 120, tip: 'Change on beat one. Look ahead to the next shape before you need it.' },
  { id: 'b-power', name: 'Power Chords', bpm: 90, duration: 120, tip: 'Lock the shape and slide it. Mute the strings you are not playing.' },
  { id: 'b-chug', name: 'Palm-Muted Chugging', bpm: 100, duration: 120, tip: 'Rest the edge of your picking hand right where the strings meet the bridge.' },
  { id: 'b-penta', name: 'Minor Pentatonic Box 1', bpm: 80, duration: 120, tip: 'Up and down the box, one note per click. Clean before fast.' }
];

const DEFAULT_SETTINGS = {
  sound: 'woodblock',     // woodblock | beep | hihat
  volume: 0.8,
  beatsPerBar: 4,
  flash: true,
  voiceOn: true,
  cueNext: true,
  cueTip: true,
  cue30: true,
  cueLadder: true,
  cueDone: true,
  voiceURI: '',
  voiceRate: 1,
  firstBreak: 5
};

function starterRoutines() {
  return [
    {
      id: uid(), name: 'Quick Test', breakSec: 5,
      items: [
        { exId: 'b-spider', name: 'Chromatic Spider', bpm: 80, duration: 40, ladder: null },
        { exId: 'b-single', name: 'Single-String Picking', bpm: 80, duration: 20,
          ladder: { start: 70, end: 90, step: 10, mode: 'time', amount: 15, breakSec: 2 } }
      ]
    },
    {
      id: uid(), name: 'Daily Warm-up', breakSec: 15,
      items: [
        { exId: 'b-spider', name: 'Chromatic Spider', bpm: 80, duration: 120, ladder: null },
        { exId: 'b-single', name: 'Single-String Picking', bpm: 90, duration: 60,
          ladder: { start: 70, end: 100, step: 10, mode: 'time', amount: 45, breakSec: 3 } },
        { exId: 'b-power', name: 'Power Chords', bpm: 90, duration: 120, ladder: null },
        { exId: 'b-chug', name: 'Palm-Muted Chugging', bpm: 100, duration: 90, ladder: null },
        { exId: 'b-penta', name: 'Minor Pentatonic Box 1', bpm: 80, duration: 180, ladder: null }
      ]
    }
  ];
}

/* =========================================================
   App data
   ========================================================= */
let settings = Object.assign({}, DEFAULT_SETTINGS, LS.get('settings', {}));
let exercises = LS.get('exercises', null);
let routines = LS.get('routines', null);
if (!exercises) { exercises = BUILTIN_EXERCISES.map(e => Object.assign({}, e)); LS.set('exercises', exercises); }
if (!routines) { routines = starterRoutines(); LS.set('routines', routines); }

const saveSettings = () => LS.set('settings', settings);
const saveExercises = () => LS.set('exercises', exercises);
const saveRoutines = () => LS.set('routines', routines);
const findEx = id => exercises.find(e => e.id === id);

/* =========================================================
   Time formatting
   ========================================================= */
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function fmtShort(sec) {
  sec = Math.round(sec);
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? m + 'm ' + s + 's' : m + ' min';
}
function fmtSpoken(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  const parts = [];
  if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
  if (s) parts.push(s + (s === 1 ? ' second' : ' seconds'));
  return parts.join(' ') || '0 seconds';
}

/* =========================================================
   Audio: metronome with look-ahead scheduling
   ========================================================= */
let ctx = null, master = null, noiseBuf = null;

function ensureAudio() {
  // Must be called from inside a tap so iOS lets audio start.
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // White noise buffer for the hi-hat sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // Play through the silent switch on newer iOS (Safari 17+)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (ctx.state !== 'running') ctx.resume();
  // A tiny silent blip fully unlocks audio on iOS
  const o = ctx.createOscillator(), g = ctx.createGain();
  g.gain.value = 0; o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.01);
  master.gain.value = settings.volume;
}

function playClick(time, accent) {
  const type = settings.sound;
  if (type === 'hihat') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = accent ? 6000 : 8000;
    const g = ctx.createGain();
    const len = accent ? 0.09 : 0.05;
    g.gain.setValueAtTime(accent ? 1.0 : 0.6, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + len);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(time); src.stop(time + len + 0.02);
  } else if (type === 'beep') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1100;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, time + 0.002);
    g.gain.setValueAtTime(accent ? 0.35 : 0.22, time + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    o.connect(g); g.connect(master);
    o.start(time); o.stop(time + 0.08);
  } else { // woodblock
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    const f = accent ? 1250 : 850;
    o.frequency.setValueAtTime(f * 1.5, time);
    o.frequency.exponentialRampToValueAtTime(f, time + 0.01);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(accent ? 1.0 : 0.7, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    o.connect(g); g.connect(master);
    o.start(time); o.stop(time + 0.09);
  }
}

const Metro = {
  running: false, bpm: 80, nextTime: 0, beat: 0, countIn: 4, timer: null,
  queue: [],              // scheduled beats for the visual flash: {time, beat, accent}
  onBeat: null,           // called when a beat is actually heard
  start(bpm, startTime, countIn) {
    this.stop();
    this.bpm = bpm; this.nextTime = startTime; this.countIn = countIn;
    this.beat = -countIn;  // negative beats = count-in
    this.running = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  },
  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.queue = [];
  },
  schedule() {
    if (!this.running) return;
    const ahead = 0.12, interval = 60 / this.bpm, bpb = settings.beatsPerBar;
    while (this.nextTime < ctx.currentTime + ahead) {
      const accent = this.beat < 0 ? this.beat === -this.countIn : (this.beat % bpb === 0);
      playClick(this.nextTime, accent);
      this.queue.push({ time: this.nextTime, beat: this.beat, accent });
      this.nextTime += interval;
      this.beat++;
    }
  },
  // Called every animation frame: fires onBeat for beats that have now sounded
  poll() {
    if (!ctx) return;
    while (this.queue.length && this.queue[0].time <= ctx.currentTime) {
      const b = this.queue.shift();
      if (this.onBeat) this.onBeat(b);
    }
  }
};

/* =========================================================
   Voice
   ========================================================= */
let voices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices() || [];
  const sel = document.getElementById('voiceSel');
  if (sel) fillVoiceSelect(sel);
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener ? speechSynthesis.addEventListener('voiceschanged', loadVoices)
                                   : (speechSynthesis.onvoiceschanged = loadVoices);
}
function pickVoice() {
  if (!voices.length) voices = speechSynthesis.getVoices() || [];
  return voices.find(v => v.voiceURI === settings.voiceURI) || null;
}
let speechToken = 0;
function speak(text, onDone) {
  const token = ++speechToken;
  const finish = () => { if (token === speechToken && onDone) { const f = onDone; onDone = null; f(); } };
  if (!settings.voiceOn || !text || !('speechSynthesis' in window)) { setTimeout(finish, 0); return; }
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
  u.rate = settings.voiceRate;
  u.onend = finish; u.onerror = finish;
  speechSynthesis.speak(u);
}
function stopSpeech() {
  speechToken++;
  if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
function unlockSpeech() {
  // iOS needs the first utterance to come from a tap
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

/* =========================================================
   Wake lock
   ========================================================= */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  wakeLock = null;
}

/* =========================================================
   Building a session plan from a routine
   ========================================================= */
function ladderSteps(l) {
  const out = [];
  const start = Math.round(num(l.start, 60)), end = Math.round(num(l.end, start));
  let step = Math.abs(Math.round(num(l.step, 5))) || 5;
  if (end < start) step = -step;
  for (let b = start; (step > 0 ? b <= end : b >= end) && out.length < 60; b += step) out.push(b);
  if (out[out.length - 1] !== end && out.length < 60) out.push(end);
  return out;
}
function barsToSec(bars, bpm) { return bars * settings.beatsPerBar * 60 / bpm; }

function buildSegments(routine) {
  const segs = [];
  routine.items.forEach((item, idx) => {
    const ex = findEx(item.exId);
    const name = ex ? ex.name : (item.name || 'Exercise');
    const tip = ex ? (ex.tip || '') : '';
    const brk = num(routine.breakSec, 15);
    if (item.ladder) {
      const l = item.ladder;
      const steps = ladderSteps(l);
      steps.forEach((bpm, k) => {
        const amt = Math.max(1, num(l.amount, 30));
        const dur = l.mode === 'bars' ? barsToSec(amt, bpm) : amt;
        const durText = l.mode === 'bars' ? amt + (amt === 1 ? ' bar' : ' bars') : fmtSpoken(amt);
        segs.push({
          item: idx, name, tip, bpm, duration: dur, durText,
          ladder: { k: k + 1, n: steps.length, start: steps[0], end: steps[steps.length - 1] },
          breakBefore: k === 0 ? brk : num(l.breakSec, 3)
        });
      });
    } else {
      const bpm = clamp(Math.round(num(item.bpm, 80)), 20, 400);
      const dur = Math.max(5, num(item.duration, 60));
      segs.push({ item: idx, name, tip, bpm, duration: dur, durText: fmtSpoken(dur), ladder: null, breakBefore: brk });
    }
  });
  if (segs.length) segs[0].breakBefore = num(settings.firstBreak, 5);
  return segs;
}

function routineTotalSec(routine) {
  const segs = buildSegments(routine);
  return segs.reduce((t, s) => t + s.duration + s.breakBefore + 4 * 60 / s.bpm, 0);
}

function announcement(seg) {
  const parts = [];
  if (seg.ladder && seg.ladder.k > 1) {
    if (settings.cueLadder) parts.push(`${seg.name}, step ${seg.ladder.k} of ${seg.ladder.n}, ${seg.bpm} BPM, ${seg.durText}.`);
    return parts.join(' ');
  }
  if (settings.cueNext) {
    if (seg.ladder) {
      parts.push(`Next up: ${seg.name}. Speed ladder, ${seg.ladder.n} steps, ${seg.ladder.start} to ${seg.ladder.end} BPM.`);
      if (settings.cueLadder) parts.push(`Step 1, ${seg.bpm} BPM, ${seg.durText}.`);
    } else {
      parts.push(`Next up: ${seg.name}, ${seg.bpm} BPM, ${seg.durText}.`);
    }
  }
  if (settings.cueTip && seg.tip) parts.push(seg.tip);
  return parts.join(' ');
}

/* =========================================================
   Session engine
   ========================================================= */
const S = {
  active: false, routine: null, segs: [], i: 0,
  phase: 'idle',            // break | countin | play | paused | done
  breakEnd: 0, speechDone: true,
  countStart: 0, playStart: 0, segRemaining: 0,
  cue30Done: false, pausedFrom: null,
  undoSnap: null, undoTimer: null,
  raf: 0, ticker: 0
};
const $ = id => document.getElementById(id);
const now = () => ctx ? ctx.currentTime : performance.now() / 1000;

function startSession(routineId) {
  const routine = routines.find(r => r.id === routineId);
  if (!routine || !routine.items.length) { toast('Add some exercises to this routine first'); return; }
  ensureAudio();
  unlockSpeech();
  requestWakeLock();
  S.active = true; S.routine = routine; S.segs = buildSegments(routine);
  $('app').hidden = true;
  $('session').hidden = false;
  $('done').hidden = true; $('paused').hidden = true; $('undo').hidden = true;
  buildBeatDots();
  Metro.onBeat = onBeat;
  enterBreak(0);
  cancelAnimationFrame(S.raf);
  const loop = () => { tick(); S.raf = requestAnimationFrame(loop); };
  S.raf = requestAnimationFrame(loop);
  clearInterval(S.ticker);
  S.ticker = setInterval(tick, 200);   // backup in case animation frames stall
}

function enterBreak(i) {
  Metro.stop(); stopSpeech();
  S.i = i; S.phase = 'break';
  const seg = S.segs[i];
  S.breakEnd = now() + Math.max(1, seg.breakBefore);
  S.speechDone = false;
  S.breakStartedAt = now();
  const text = announcement(seg);
  speak(text, () => { S.speechDone = true; });
  render();
}

function enterCountIn(remaining) {
  Metro.stop(); stopSpeech();
  const seg = S.segs[S.i];
  S.phase = 'countin';
  S.segRemaining = remaining;
  S.cue30Done = remaining <= 31;
  S.countStart = ctx.currentTime + 0.15;
  S.playStart = S.countStart + 4 * 60 / seg.bpm;
  Metro.start(seg.bpm, S.countStart, 4);
  render();
}

function currentRemaining() {
  const seg = S.segs[S.i];
  if (!seg) return 0;
  if (S.phase === 'play') return S.segRemaining - (ctx.currentTime - S.playStart);
  if (S.phase === 'countin') return S.segRemaining;
  if (S.phase === 'paused' && S.pausedFrom) return S.pausedFrom.rem;
  return seg.duration;
}

function tick() {
  if (!S.active) return;
  Metro.poll();
  const t = now();
  if (S.phase === 'break') {
    // Wait for both the break timer and the voice cue, so we never talk over the count-in
    const speechTimeout = t > S.breakEnd + 20;
    if (t >= S.breakEnd && (S.speechDone || speechTimeout)) {
      enterCountIn(S.segs[S.i].duration);
      return;
    }
  } else if (S.phase === 'countin') {
    if (t >= S.playStart) { S.phase = 'play'; }
  } else if (S.phase === 'play') {
    if (currentRemaining() <= 0) {
      Metro.stop();
      if (S.i + 1 < S.segs.length) enterBreak(S.i + 1);
      else finish();
      return;
    }
  }
  renderLive();
}

function onBeat(b) {
  // Visual flash
  if (settings.flash) {
    const f = $('flash');
    f.className = 'hit' + (b.accent ? ' accent' : '');
    requestAnimationFrame(() => requestAnimationFrame(() => { f.className = ''; }));
  }
  const dots = $('s-beats').children;
  const bpb = settings.beatsPerBar;
  const pos = b.beat < 0 ? (b.beat + 4) : (b.beat % bpb);
  for (let k = 0; k < dots.length; k++) dots[k].className = k === pos ? ('on' + (b.accent ? ' accent' : '')) : '';
  // "30 seconds left" — spoken right after a beat, never during count-in
  if (S.phase === 'play' && settings.cue30 && !S.cue30Done && S.segs[S.i].duration >= 45 && currentRemaining() <= 30) {
    S.cue30Done = true;
    speak('30 seconds left');
  }
}

function buildBeatDots() {
  const n = Math.max(settings.beatsPerBar, 4);
  $('s-beats').innerHTML = Array.from({ length: n }, () => '<span></span>').join('');
}

function finish() {
  Metro.stop();
  S.phase = 'done';
  const total = S.segs.reduce((t, s) => t + s.duration, 0);
  $('done-sub').textContent = `${S.routine.name} · ${fmtShort(total)} of playing`;
  $('done').hidden = false;
  $('paused').hidden = true;
  if (settings.cueDone) speak('Session complete.'); else stopSpeech();
  releaseWakeLock();
  render();
}

function pause() {
  if (!['break', 'countin', 'play'].includes(S.phase)) return;
  S.pausedFrom = { phase: S.phase, rem: currentRemaining() };
  Metro.stop(); stopSpeech();
  S.phase = 'paused';
  render();
}

function resume() {
  if (S.phase !== 'paused') return;
  ensureAudio();
  requestWakeLock();
  const p = S.pausedFrom; S.pausedFrom = null;
  if (p.phase === 'break') enterBreak(S.i);
  else enterCountIn(p.rem);
}

function snapshot() {
  return { i: S.i, phase: S.phase === 'paused' ? S.pausedFrom.phase : S.phase, rem: currentRemaining() };
}

function restartCurrent() {
  if (!S.active || S.phase === 'done') return;
  ensureAudio();
  const snap = snapshot();
  enterCountIn(S.segs[S.i].duration);
  showUndo('Restarted — tap to undo', snap);
}

function skipCurrent() {
  if (!S.active || S.phase === 'done') return;
  ensureAudio();
  const snap = snapshot();
  if (S.i + 1 < S.segs.length) enterBreak(S.i + 1);
  else finish();
  showUndo('Skipped — tap to undo', snap);
}

function previousExercise() {
  if (!S.active) return;
  ensureAudio();
  $('done').hidden = true;
  // Jump to the start of the previous exercise (whole ladder counts as one exercise)
  const curItem = S.segs[S.i].item;
  let target = S.i;
  const firstOfCur = S.segs.findIndex(s => s.item === curItem);
  if (S.phase === 'break' || S.i === firstOfCur) {
    const prevItem = curItem - 1;
    target = prevItem >= 0 ? S.segs.findIndex(s => s.item === prevItem) : 0;
  } else {
    target = firstOfCur;
  }
  enterBreak(Math.max(0, target));
  toast('Previous exercise');
}

function showUndo(text, snap) {
  S.undoSnap = snap;
  const u = $('undo');
  u.textContent = text; u.hidden = false;
  clearTimeout(S.undoTimer);
  S.undoTimer = setTimeout(() => { u.hidden = true; S.undoSnap = null; }, 4500);
}

function doUndo() {
  const snap = S.undoSnap;
  $('undo').hidden = true; clearTimeout(S.undoTimer); S.undoSnap = null;
  if (!snap) return;
  ensureAudio();
  if (S.phase === 'done') { $('done').hidden = true; requestWakeLock(); }
  S.i = snap.i;
  if (snap.phase === 'break') enterBreak(snap.i);
  else enterCountIn(Math.max(1, snap.rem));
}

function endSession() {
  S.active = false;
  Metro.stop(); stopSpeech(); releaseWakeLock();
  cancelAnimationFrame(S.raf); clearInterval(S.ticker);
  clearTimeout(S.undoTimer);
  S.phase = 'idle';
  $('session').hidden = true;
  $('app').hidden = false;
  showTab('routines');
}

/* ---------- Session rendering ---------- */
function render() {
  const seg = S.segs[S.i];
  if (!seg) return;
  const itemCount = S.routine.items.length;
  $('s-progress').textContent = `Exercise ${seg.item + 1} of ${itemCount}`;
  $('s-name').textContent = seg.name;
  $('s-sub').textContent = `${seg.bpm} BPM` + (seg.ladder ? ` · step ${seg.ladder.k}/${seg.ladder.n}` : '');
  const next = S.segs[S.i + 1];
  $('s-next').textContent = next ? `Next: ${next.name} · ${next.bpm} BPM` : 'Last one!';
  const paused = S.phase === 'paused';
  $('paused').hidden = !paused;
  if (paused) {
    $('paused-msg').textContent = `Resume ${seg.name}, ${fmtClock(currentRemaining())} left?`;
  }
  if (S.phase !== 'countin' && S.phase !== 'play') {
    for (const d of $('s-beats').children) d.className = '';
  }
  renderLive();
}

function renderLive() {
  const big = $('s-big');
  const seg = S.segs[S.i];
  if (!seg) return;
  let html = '', cls = '';
  if (S.phase === 'break') {
    const left = Math.max(0, S.breakEnd - now());
    cls = 'break';
    html = `${left > 0 ? Math.ceil(left) : '…'}<span class="lbl">get ready · ${fmtClock(seg.duration)}</span>`;
  } else if (S.phase === 'countin') {
    const interval = 60 / seg.bpm;
    const n = Math.floor((ctx.currentTime - S.countStart) / interval);
    cls = 'countin';
    html = n < 0 ? '4' : String(clamp(4 - n, 1, 4));
    html += '<span class="lbl">count-in</span>';
  } else if (S.phase === 'play' || S.phase === 'paused') {
    html = fmtClock(currentRemaining());
  } else if (S.phase === 'done') {
    html = '0:00';
  }
  if (big.className !== cls) big.className = cls;
  if (big.innerHTML !== html) big.innerHTML = html;
}

/* ---------- Session tap zones ---------- */
(function setupZones() {
  const zones = $('zones');
  let pressTimer = null, longFired = false, startZone = null, active = false;
  const zoneAt = x => {
    const w = window.innerWidth;
    return x < w / 3 ? 'left' : x > 2 * w / 3 ? 'right' : 'center';
  };
  zones.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S.phase === 'done') return;
    active = true; longFired = false;
    startZone = zoneAt(e.clientX);
    clearTimeout(pressTimer);
    if (startZone === 'left') {
      pressTimer = setTimeout(() => { longFired = true; previousExercise(); }, 650);
    }
  });
  zones.addEventListener('pointerup', e => {
    e.preventDefault();
    clearTimeout(pressTimer);
    if (!active) return;
    active = false;
    if (longFired || S.phase === 'done') return;
    if (startZone === 'left') restartCurrent();
    else if (startZone === 'right') skipCurrent();
    else { if (S.phase === 'paused') resume(); else pause(); }
  });
  zones.addEventListener('pointercancel', () => { clearTimeout(pressTimer); active = false; });
  zones.addEventListener('contextmenu', e => e.preventDefault());

  $('undo').addEventListener('pointerup', e => { e.stopPropagation(); doUndo(); });
  $('btn-resume').addEventListener('click', e => { e.stopPropagation(); resume(); });
  $('btn-end').addEventListener('click', e => { e.stopPropagation(); endSession(); });
  $('btn-done').addEventListener('click', endSession);
})();

/* Auto-pause when the app is backgrounded or the phone locks */
document.addEventListener('visibilitychange', () => {
  if (!S.active) return;
  if (document.hidden) {
    pause();
  } else {
    if (S.phase !== 'done') requestWakeLock();
    render();
  }
});
window.addEventListener('pagehide', () => { if (S.active) pause(); });

/* =========================================================
   Setup screens
   ========================================================= */
let currentTab = 'routines';
let draft = null;       // routine being edited
let exDraft = null;     // exercise being edited

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'routines') renderRoutines();
  else if (tab === 'exercises') renderExercises();
  else if (tab === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Routines list ---------- */
function renderRoutines() {
  const v = $('view');
  let html = `<h1><span class="logo">Roadie</span></h1>`;
  if (!routines.length) html += `<div class="empty">No routines yet.</div>`;
  for (const r of routines) {
    const n = r.items.length;
    html += `<div class="card">
      <div class="title">${esc(r.name)}</div>
      <div class="meta">${n} exercise${n === 1 ? '' : 's'} · about ${fmtShort(routineTotalSec(r))} · ${esc(r.breakSec)}s breaks</div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary start" data-start="${r.id}">▶ Start</button>
        <span class="spacer"></span>
        <button class="btn" data-edit="${r.id}">Edit</button>
      </div>
    </div>`;
  }
  html += `<button class="btn wide" id="newRoutine">+ New routine</button>
    <p class="muted" style="margin-top:20px">Tip: turn your phone sideways once a session starts. Tap the middle to pause, the left side to restart, hold the left side to go back, the right side to skip.</p>`;
  v.innerHTML = html;
  v.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => startSession(b.dataset.start)));
  v.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editRoutine(b.dataset.edit)));
  $('newRoutine').addEventListener('click', () => editRoutine(null));
}

/* ---------- Routine editor ---------- */
function editRoutine(id) {
  const r = id ? routines.find(x => x.id === id) : null;
  draft = r ? JSON.parse(JSON.stringify(r)) : { id: null, name: 'New routine', breakSec: 15, items: [] };
  renderRoutineEditor();
}

function defaultLadder(bpm) {
  return { start: Math.max(40, bpm - 20), end: bpm, step: 5, mode: 'time', amount: 30, breakSec: 3 };
}

function renderRoutineEditor() {
  const v = $('view');
  const exOptions = exercises.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  let html = `<div class="row"><button class="btn small" data-act="cancel">‹ Back</button></div>
    <h1>${draft.id ? 'Edit routine' : 'New routine'}</h1>
    <label class="field"><span>Routine name</span><input type="text" data-f="name" value="${esc(draft.name)}"></label>
    <label class="field"><span>Break between exercises (seconds)</span><input type="number" inputmode="numeric" data-f="breakSec" value="${esc(draft.breakSec)}"></label>
    <div class="muted">Total: about <b id="totalTime">${fmtShort(routineTotalSec(draft))}</b></div>
    <h2>Exercises</h2>`;
  if (!draft.items.length) html += `<div class="empty">No exercises yet — add one below.</div>`;
  draft.items.forEach((it, i) => {
    const ex = findEx(it.exId);
    const name = ex ? ex.name : (it.name || 'Missing exercise');
    const mins = Math.floor(num(it.duration, 60) / 60), secs = Math.round(num(it.duration, 60) % 60);
    html += `<div class="item">
      <div class="head">
        <div class="name">${i + 1}. ${esc(name)}</div>
        <button class="btn small" data-act="up" data-i="${i}" aria-label="Move up">▲</button>
        <button class="btn small" data-act="down" data-i="${i}" aria-label="Move down">▼</button>
        <button class="btn small danger" data-act="remove" data-i="${i}" aria-label="Remove">✕</button>
      </div>`;
    if (!it.ladder) {
      html += `<div class="inline-fields">
        <label class="field"><span>BPM</span><input type="number" inputmode="numeric" data-i="${i}" data-f="bpm" value="${esc(it.bpm)}"></label>
        <label class="field"><span>Min</span><input type="number" inputmode="numeric" data-i="${i}" data-f="min" value="${mins}"></label>
        <label class="field"><span>Sec</span><input type="number" inputmode="numeric" data-i="${i}" data-f="sec" value="${secs}"></label>
      </div>
      <button class="btn small" data-act="ladderOn" data-i="${i}">+ Speed ladder</button>`;
    } else {
      const l = it.ladder;
      const steps = ladderSteps(l);
      html += `<div class="ladder-box">
        <div class="row"><b>Speed ladder</b><span class="spacer"></span><button class="btn small" data-act="ladderOff" data-i="${i}">Remove ladder</button></div>
        <div class="inline-fields">
          <label class="field"><span>Start BPM</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.start" value="${esc(l.start)}"></label>
          <label class="field"><span>End BPM</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.end" value="${esc(l.end)}"></label>
          <label class="field"><span>Step</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.step" value="${esc(l.step)}"></label>
        </div>
        <div class="inline-fields">
          <label class="field"><span>Each step lasts</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.amount" value="${esc(l.amount)}"></label>
          <label class="field"><span>Measured in</span><select data-i="${i}" data-f="ladder.mode">
            <option value="time" ${l.mode === 'time' ? 'selected' : ''}>seconds</option>
            <option value="bars" ${l.mode === 'bars' ? 'selected' : ''}>bars (loops)</option>
          </select></label>
          <label class="field"><span>Break (s)</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.breakSec" value="${esc(l.breakSec)}"></label>
        </div>
        <div class="muted" id="ladderInfo${i}">${steps.length} steps: ${steps.join(' → ')}</div>
      </div>`;
    }
    html += `</div>`;
  });
  html += `<h2>Add an exercise</h2>
    <div class="row"><select id="addSel" style="flex:1">${exOptions}</select><button class="btn primary" data-act="add">Add</button></div>
    <div class="row" style="margin-top:28px">
      <button class="btn primary" data-act="save" style="flex:1">Save routine</button>
    </div>
    ${draft.id ? `<button class="btn wide" data-act="duplicate">Duplicate routine</button>
    <button class="btn wide danger" data-act="delete">Delete routine</button>` : ''}`;
  v.innerHTML = html;
}

$('view').addEventListener('input', e => {
  const el = e.target;
  if (draft && el.dataset.f && $('view').contains(el)) updateDraftField(el);
});
$('view').addEventListener('change', e => {
  const el = e.target;
  if (draft && el.dataset.f && el.tagName === 'SELECT') { updateDraftField(el); }
});

function updateDraftField(el) {
  const f = el.dataset.f, i = el.dataset.i;
  if (i === undefined) {
    if (f === 'name') draft.name = el.value;
    if (f === 'breakSec') draft.breakSec = Math.max(0, num(el.value, 0));
  } else {
    const it = draft.items[+i];
    if (!it) return;
    if (f === 'bpm') it.bpm = clamp(num(el.value, 80), 20, 400);
    else if (f === 'min' || f === 'sec') {
      const box = el.closest('.item');
      const m = num(box.querySelector('[data-f=min]').value, 0);
      const s = num(box.querySelector('[data-f=sec]').value, 0);
      it.duration = Math.max(5, m * 60 + s);
    } else if (f.startsWith('ladder.')) {
      const k = f.slice(7);
      it.ladder[k] = k === 'mode' ? el.value : num(el.value, it.ladder[k]);
      const info = document.getElementById('ladderInfo' + i);
      if (info) { const st = ladderSteps(it.ladder); info.textContent = `${st.length} steps: ${st.join(' → ')}`; }
    }
  }
  const tt = $('totalTime');
  if (tt) tt.textContent = fmtShort(routineTotalSec(draft));
}

$('view').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, i = +b.dataset.i;
  if (draft) {
    if (act === 'cancel') { draft = null; showTab('routines'); return; }
    if (act === 'up' && i > 0) { [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]]; }
    if (act === 'down' && i < draft.items.length - 1) { [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]]; }
    if (act === 'remove') draft.items.splice(i, 1);
    if (act === 'ladderOn') draft.items[i].ladder = defaultLadder(num(draft.items[i].bpm, 80));
    if (act === 'ladderOff') draft.items[i].ladder = null;
    if (act === 'add') {
      const ex = findEx($('addSel').value);
      if (ex) draft.items.push({ exId: ex.id, name: ex.name, bpm: ex.bpm, duration: ex.duration, ladder: null });
    }
    if (act === 'save') {
      if (!draft.name.trim()) { toast('Give the routine a name'); return; }
      draft.items.forEach(it => { const ex = findEx(it.exId); if (ex) it.name = ex.name; });
      if (draft.id) { const k = routines.findIndex(r => r.id === draft.id); routines[k] = draft; }
      else { draft.id = uid(); routines.push(draft); }
      saveRoutines(); draft = null; toast('Routine saved'); showTab('routines'); return;
    }
    if (act === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(draft)); copy.id = uid(); copy.name += ' (copy)';
      routines.push(copy); saveRoutines(); draft = null; toast('Duplicated'); showTab('routines'); return;
    }
    if (act === 'delete') {
      if (!confirm(`Delete "${draft.name}"?`)) return;
      routines = routines.filter(r => r.id !== draft.id); saveRoutines(); draft = null; showTab('routines'); return;
    }
    renderRoutineEditor();
  }
});

/* ---------- Exercise library ---------- */
function renderExercises() {
  draft = null;
  const v = $('view');
  let html = `<h1>Exercises</h1>`;
  if (!exercises.length) html += `<div class="empty">No exercises.</div>`;
  for (const e of exercises) {
    html += `<div class="card">
      <div class="row"><div class="title" style="flex:1">${esc(e.name)}</div><button class="btn small" data-exedit="${e.id}">Edit</button></div>
      <div class="meta">${esc(e.bpm)} BPM · ${fmtShort(e.duration)}</div>
      ${e.tip ? `<div class="meta" style="margin-top:6px">💬 ${esc(e.tip)}</div>` : ''}
    </div>`;
  }
  html += `<button class="btn wide primary" id="newEx">+ New exercise</button>
    <button class="btn wide" id="restoreEx">Restore built-in drills</button>`;
  v.innerHTML = html;
  v.querySelectorAll('[data-exedit]').forEach(b => b.addEventListener('click', () => editExercise(b.dataset.exedit)));
  $('newEx').addEventListener('click', () => editExercise(null));
  $('restoreEx').addEventListener('click', () => {
    let added = 0;
    for (const b of BUILTIN_EXERCISES) if (!findEx(b.id)) { exercises.push(Object.assign({}, b)); added++; }
    saveExercises(); toast(added ? `Restored ${added} drill${added === 1 ? '' : 's'}` : 'All built-in drills are already here');
    renderExercises();
  });
}

function editExercise(id) {
  const e = id ? findEx(id) : null;
  exDraft = e ? Object.assign({}, e) : { id: null, name: '', bpm: 80, duration: 120, tip: '' };
  const v = $('view');
  const m = Math.floor(exDraft.duration / 60), s = Math.round(exDraft.duration % 60);
  v.innerHTML = `<div class="row"><button class="btn small" id="exBack">‹ Back</button></div>
    <h1>${id ? 'Edit exercise' : 'New exercise'}</h1>
    <label class="field"><span>Name</span><input type="text" id="exName" value="${esc(exDraft.name)}" placeholder="e.g. Alternate picking on G string"></label>
    <div class="inline-fields">
      <label class="field"><span>Default BPM</span><input type="number" inputmode="numeric" id="exBpm" value="${esc(exDraft.bpm)}"></label>
      <label class="field"><span>Min</span><input type="number" inputmode="numeric" id="exMin" value="${m}"></label>
      <label class="field"><span>Sec</span><input type="number" inputmode="numeric" id="exSec" value="${s}"></label>
    </div>
    <label class="field"><span>Spoken tip (optional)</span><textarea id="exTip" placeholder="Said out loud before the exercise starts">${esc(exDraft.tip)}</textarea></label>
    <button class="btn wide primary" id="exSave">Save exercise</button>
    ${id ? `<button class="btn wide danger" id="exDel">Delete exercise</button>` : ''}`;
  $('exBack').addEventListener('click', renderExercises);
  $('exSave').addEventListener('click', () => {
    const name = $('exName').value.trim();
    if (!name) { toast('Give it a name'); return; }
    exDraft.name = name;
    exDraft.bpm = clamp(Math.round(num($('exBpm').value, 80)), 20, 400);
    exDraft.duration = Math.max(5, num($('exMin').value, 0) * 60 + num($('exSec').value, 0));
    exDraft.tip = $('exTip').value.trim();
    if (exDraft.id) { const k = exercises.findIndex(x => x.id === exDraft.id); exercises[k] = exDraft; }
    else { exDraft.id = uid(); exercises.push(exDraft); }
    saveExercises(); toast('Exercise saved'); renderExercises();
  });
  if (id) $('exDel').addEventListener('click', () => {
    const used = routines.filter(r => r.items.some(it => it.exId === id)).map(r => r.name);
    const msg = used.length ? `"${exDraft.name}" is used in: ${used.join(', ')}. Delete it and remove it from those routines?` : `Delete "${exDraft.name}"?`;
    if (!confirm(msg)) return;
    exercises = exercises.filter(x => x.id !== id);
    routines.forEach(r => { r.items = r.items.filter(it => it.exId !== id); });
    saveExercises(); saveRoutines(); renderExercises();
  });
}

/* ---------- Settings ---------- */
function fillVoiceSelect(sel) {
  const list = (voices.length ? voices : (window.speechSynthesis ? speechSynthesis.getVoices() : [])) || [];
  const en = list.filter(v => /^en/i.test(v.lang)), other = list.filter(v => !/^en/i.test(v.lang));
  const opt = v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === settings.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`;
  sel.innerHTML = `<option value="">System default</option>` + en.map(opt).join('') +
    (other.length ? `<optgroup label="Other languages">${other.map(opt).join('')}</optgroup>` : '');
}

function renderSettings() {
  draft = null;
  const v = $('view');
  const chk = (k, label) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-s="${k}" ${settings[k] ? 'checked' : ''}></label>`;
  v.innerHTML = `<h1>Settings</h1>
    <h2>Metronome</h2>
    <div class="card">
      <label class="field"><span>Click sound</span>
        <div class="row"><select data-s="sound" style="flex:1">
          <option value="woodblock" ${settings.sound === 'woodblock' ? 'selected' : ''}>Woodblock</option>
          <option value="beep" ${settings.sound === 'beep' ? 'selected' : ''}>Digital beep</option>
          <option value="hihat" ${settings.sound === 'hihat' ? 'selected' : ''}>Hi-hat</option>
        </select><button class="btn" id="testClick">▶ Test</button></div></label>
      <label class="field"><span>Volume</span><input type="range" min="0.1" max="1" step="0.05" data-s="volume" value="${settings.volume}"></label>
      <label class="field"><span>Beats per bar (beat 1 is accented)</span><input type="number" inputmode="numeric" data-s="beatsPerBar" value="${settings.beatsPerBar}"></label>
      ${chk('flash', 'Flash the screen on each beat')}
    </div>
    <h2>Voice cues</h2>
    <div class="card">
      ${chk('voiceOn', 'Voice cues on')}
      ${chk('cueNext', '"Next up: name, BPM, length"')}
      ${chk('cueTip', 'Read the exercise tip')}
      ${chk('cue30', '"30 seconds left"')}
      ${chk('cueLadder', 'Speed ladder steps')}
      ${chk('cueDone', '"Session complete"')}
      <label class="field"><span>Voice</span><select id="voiceSel" data-s="voiceURI"></select></label>
      <label class="field"><span>Speaking speed</span><input type="range" min="0.6" max="1.4" step="0.05" data-s="voiceRate" value="${settings.voiceRate}"></label>
      <button class="btn wide" id="testVoice">▶ Test voice</button>
    </div>
    <h2>Session</h2>
    <div class="card">
      <label class="field"><span>Get-ready time before the first exercise (seconds)</span><input type="number" inputmode="numeric" data-s="firstBreak" value="${settings.firstBreak}"></label>
    </div>
    <h2>Backup</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Save your exercises, routines and settings to a small file, or load them back.</p>
      <button class="btn wide" id="exportBtn">Export backup</button>
      <button class="btn wide" id="importBtn">Import backup</button>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>
    <p class="muted" style="text-align:center;margin-top:24px">Roadie · Phase 1</p>`;
  fillVoiceSelect($('voiceSel'));

  v.querySelectorAll('[data-s]').forEach(el => {
    const handler = () => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (el.type === 'range') settings[k] = num(el.value, settings[k]);
      else if (k === 'beatsPerBar') settings[k] = clamp(Math.round(num(el.value, 4)), 1, 12);
      else if (k === 'firstBreak') settings[k] = clamp(num(el.value, 5), 1, 60);
      else settings[k] = el.value;
      if (k === 'volume' && master) master.gain.value = settings.volume;
      saveSettings();
    };
    el.addEventListener('change', handler);
    if (el.type === 'range') el.addEventListener('input', handler);
  });

  $('testClick').addEventListener('click', () => {
    ensureAudio();
    const t = ctx.currentTime + 0.1, iv = 60 / 100;
    for (let k = 0; k < settings.beatsPerBar; k++) playClick(t + k * iv, k === 0);
  });
  $('testVoice').addEventListener('click', () => {
    unlockSpeech();
    const was = settings.voiceOn; settings.voiceOn = true;
    speak('Next up: Chromatic Spider, 80 BPM, 2 minutes.');
    settings.voiceOn = was;
  });
  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importBackup);
}

/* ---------- Export / import ---------- */
async function exportBackup() {
  const data = { app: 'roadie', version: 1, exported: new Date().toISOString(), settings, exercises, routines };
  const json = JSON.stringify(data, null, 2);
  const name = `roadie-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Roadie backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== 'roadie' || !Array.isArray(data.exercises) || !Array.isArray(data.routines)) throw new Error('bad');
      if (!confirm(`Replace your current exercises, routines and settings with this backup (${data.exercises.length} exercises, ${data.routines.length} routines)?`)) return;
      exercises = data.exercises; routines = data.routines;
      settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      saveExercises(); saveRoutines(); saveSettings();
      toast('Backup imported');
      renderSettings();
    } catch (err) {
      toast("That file doesn't look like a Roadie backup");
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   Start up
   ========================================================= */
showTab('routines');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
