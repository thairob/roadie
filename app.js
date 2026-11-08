/* Roadie — Phase 2: core practice runner + songs
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
const round1 = n => Math.round(n * 10) / 10;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Song audio lives in IndexedDB (too big for localStorage) */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('roadie', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('audio')) r.result.createObjectStore('audio'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('audio', mode);
      const req = fn(tx.objectStore('audio'));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  put(key, val) { return this.run('readwrite', s => s.put(val, key)); },
  get(key) { return this.run('readonly', s => s.get(key)); },
  del(key) { return this.run('readwrite', s => s.delete(key)); },
  keys() { return this.run('readonly', s => s.getAllKeys()); }
};

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
let songs = LS.get('songs', []);
if (!exercises) { exercises = BUILTIN_EXERCISES.map(e => Object.assign({}, e)); LS.set('exercises', exercises); }
if (!routines) { routines = starterRoutines(); LS.set('routines', routines); }

const saveSettings = () => LS.set('settings', settings);
const saveExercises = () => LS.set('exercises', exercises);
const saveRoutines = () => LS.set('routines', routines);
const saveSongs = () => LS.set('songs', songs);
const findEx = id => exercises.find(e => e.id === id);
const findSong = id => songs.find(s => s.id === id);
const findSection = (song, id) => song ? song.sections.find(s => s.id === id) : null;
const isSongItem = it => it && it.type === 'song';

let audioIds = new Set();   // songs whose audio file is stored on the phone

/* =========================================================
   Time formatting
   ========================================================= */
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function fmtPos(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function fmtTenths(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
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

function ensureAudio(rebuild) {
  // Must be called from inside a tap so iOS lets audio start.
  // Play through the silent switch on newer iOS (set before audio starts)
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
  // If iPhone has shut the sound off, throw the old sound engine away and make a fresh one
  if (ctx && rebuild && ctx.state !== 'running') {
    try { ctx.close(); } catch (e) {}
    ctx = null;
  }
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    // If iPhone interrupts the click sound, try to bring it straight back —
    // but never while the voice is talking, or iPhone silences the voice
    ctx.onstatechange = () => {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && S.active && clicksNeededNow() && !speechBusy()) {
        try { ctx.resume(); } catch (e) {}
      }
    };
    // A silent sound that plays the whole time keeps iPhone from putting the audio to sleep
    const silent = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const keep = ctx.createBufferSource();
    keep.buffer = silent; keep.loop = true;
    keep.connect(ctx.destination);
    keep.start();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // White noise buffer for the hi-hat sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
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

// Soft tone for the scale guide (an octave up so it's clear on a phone speaker)
function playTone(time, midi) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 440 * Math.pow(2, (midi + 12 - 69) / 12);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(0.3, time + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
  o.connect(g); g.connect(master);
  o.start(time); o.stop(time + 0.6);
}

const Metro = {
  running: false, bpm: 80, nextTime: 0, beat: 0, countIn: 4, countOnly: false, timer: null,
  queue: [],              // scheduled beats for the visual flash: {time, beat, accent}
  onBeat: null,           // called when a beat is actually heard
  start(bpm, startTime, countIn, countOnly) {
    this.stop();
    this.bpm = bpm; this.nextTime = startTime; this.countIn = countIn;
    this.countOnly = !!countOnly;   // songs: click the count-in only, then go quiet
    this.beat = -countIn;           // negative beats = count-in
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
    if (!this.running || !ctx) return;
    const ahead = 0.12, interval = 60 / this.bpm, bpb = settings.beatsPerBar;
    while (this.nextTime < ctx.currentTime + ahead) {
      if (this.countOnly && this.beat >= 0) {
        this.running = false; clearInterval(this.timer); this.timer = null;
        return;
      }
      const accent = this.beat < 0 ? this.beat === -this.countIn : (this.beat % bpb === 0);
      playClick(this.nextTime, accent);
      if (this.onSchedule) this.onSchedule(this.beat, this.nextTime);
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
   Song player (one audio element, reused everywhere)
   ========================================================= */
const songEl = new Audio();
songEl.preload = 'auto';
songEl.setAttribute('playsinline', '');
songEl.setAttribute('webkit-playsinline', '');
const songUrls = {};       // song id -> object URL

function setPreservePitch() {
  try { songEl.preservesPitch = true; } catch (e) {}
  try { songEl.webkitPreservesPitch = true; } catch (e) {}
  try { songEl.mozPreservesPitch = true; } catch (e) {}
}
setPreservePitch();

// A tiny silent sound used to "unlock" the song player from a tap
const SILENT_URL = (() => {
  const rate = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
})();

let unlockPromise = Promise.resolve();
function unlockSongPlayer() {
  // Called inside a tap: iPhone only lets an audio player start if it was first started by a tap
  songEl.muted = true;
  songEl.src = SILENT_URL;
  songEl.dataset.song = '';
  let p;
  try { p = songEl.play(); } catch (e) { p = null; }
  unlockPromise = Promise.resolve(p)
    .then(() => { if (songEl.src === SILENT_URL) songEl.pause(); })
    .catch(() => {})
    .then(() => { songEl.muted = false; });
}

async function getSongUrl(id) {
  if (songUrls[id]) return songUrls[id];
  const rec = await DB.get(id);
  if (!rec) return null;
  const blob = rec instanceof Blob ? rec : new Blob([rec.data], { type: rec.type || 'audio/mpeg' });
  songUrls[id] = URL.createObjectURL(blob);
  return songUrls[id];
}
function forgetSongUrl(id) {
  if (songUrls[id]) { URL.revokeObjectURL(songUrls[id]); delete songUrls[id]; }
  if (songEl.dataset.song === id) { songEl.pause(); songEl.removeAttribute('src'); songEl.dataset.song = ''; }
}

function waitForMetadata(el, ms) {
  return new Promise(res => {
    if (el.readyState >= 1) return res();
    let done = false;
    const fin = () => { if (done) return; done = true; el.removeEventListener('loadedmetadata', fin); res(); };
    el.addEventListener('loadedmetadata', fin);
    setTimeout(fin, ms || 5000);
  });
}

// Load a song into the player (if it isn't already) and park it at a position
async function loadSongInto(songId) {
  await unlockPromise;
  if (songEl.dataset.song !== songId) {
    const url = await getSongUrl(songId);
    if (!url) return false;
    songEl.src = url;
    songEl.dataset.song = songId;
    try { songEl.load(); } catch (e) {}
  }
  await waitForMetadata(songEl, 5000);
  return true;
}
function seekSong(t) { try { songEl.currentTime = Math.max(0, t); } catch (e) {} }

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
let speechToken = 0, speaking = false;
function speechBusy() {
  return speaking || ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending));
}
function speak(text, onDone) {
  const token = ++speechToken;
  const finish = () => {
    if (token === speechToken) speaking = false;
    if (token === speechToken && onDone) { const f = onDone; onDone = null; f(); }
  };
  if (!settings.voiceOn || !text || !('speechSynthesis' in window)) { setTimeout(finish, 0); return; }
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
  u.rate = settings.voiceRate;
  u.onend = finish; u.onerror = finish;
  speaking = true;
  setTimeout(() => { if (token === speechToken) speaking = false; }, 15000);  // safety net
  speechSynthesis.speak(u);
}
function stopSpeech() {
  speechToken++;
  speaking = false;
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
function ladderSteps(l, lo, hi) {
  lo = lo || 20; hi = hi || 400;
  const out = [];
  const start = clamp(Math.round(num(l.start, 60)), lo, hi), end = clamp(Math.round(num(l.end, start)), lo, hi);
  let step = Math.abs(Math.round(num(l.step, 5))) || 5;
  if (end < start) step = -step;
  for (let b = start; (step > 0 ? b <= end : b >= end) && out.length < 60; b += step) out.push(b);
  if (out[out.length - 1] !== end && out.length < 60) out.push(end);
  return out;
}
function barsToSec(bars, bpm) { return bars * settings.beatsPerBar * 60 / bpm; }
const loopsText = n => n + (n === 1 ? ' loop' : ' loops');

function songSegment(item, idx, song, sec, pct, mode, amount) {
  const rate = clamp(pct, 25, 150) / 100;
  const len = Math.max(0.5, sec.end - sec.start);
  amount = Math.max(1, Math.round(num(amount, mode === 'loops' ? 4 : 60)));
  return {
    kind: 'song', item: idx, name: song.name, section: sec.name, songId: song.id,
    start: sec.start, end: sec.end, len, pct: Math.round(rate * 100), rate, mode, amount,
    duration: mode === 'loops' ? amount * len / rate : amount,
    durText: mode === 'loops' ? loopsText(amount) : fmtSpoken(amount),
    rewind: num(item.rewind, 15),
    bpm: song.bpm ? Math.round(song.bpm * rate) : null,
    tip: ''
  };
}

/* ---------- Scale guide and triad segments (Phase 3) ---------- */
const isBoardSeg = seg => !!seg && (seg.kind === 'scale' || seg.kind === 'triadWalk' || seg.kind === 'triadQuiz');
function itemKeys(it) { return Array.isArray(it.keys) && it.keys.length ? it.keys.slice() : [0]; }
function itemQualities(it) { return it.quality === 'both' ? ['major', 'minor'] : [it.quality === 'minor' ? 'minor' : 'major']; }
function shuffleList(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function scaleSegments(item, idx, brk) {
  const scale = Theory.SCALES[item.scale] ? item.scale : 'minPent';
  const key = Theory.pcOf(num(item.key, 9));
  const bpm = clamp(Math.round(num(item.bpm, 80)), 20, 300);
  const rounds = clamp(Math.round(num(item.rounds, 2)), 1, 8);
  const list = item.positions === 'all' || item.positions == null ? [1, 2, 3, 4, 5] : [clamp(Math.round(num(item.positions, 1)), 1, 5)];
  return list.map((p, k) => {
    const pos = Theory.position(key, scale, p);
    const path = Theory.scalePath(pos.notes, rounds);
    const dur = path.length * 60 / bpm;
    return {
      kind: 'scale', item: idx, key, scale, p, posIdx: k, all: list.length > 1, bpm, rounds,
      name: `${Theory.noteName(key)} ${Theory.SCALES[scale].name}`,
      spokenName: `${Theory.spokenNote(key)} ${Theory.SCALES[scale].name}`,
      pos, path, tones: item.tones !== false, labels: item.labels === 'names' ? 'names' : 'degrees',
      duration: dur, durText: fmtSpoken(dur), ladder: null, tip: '',
      breakBefore: k === 0 ? brk : num(item.posBreak, 4)
    };
  });
}

function triadSegments(item, idx, brk) {
  const set = Theory.STRING_SETS[item.strings] ? item.strings : 'gbe';
  const bpm = clamp(Math.round(num(item.bpm, 70)), 20, 300);
  const bpb = settings.beatsPerBar;
  const labels = item.labels === 'names' ? 'names' : 'degrees';
  let keys = itemKeys(item);
  const quals = itemQualities(item);
  if (item.mode === 'quiz') {
    const n = clamp(Math.round(num(item.prompts, 10)), 1, 100);
    const findB = clamp(Math.round(num(item.findBars, 2)), 1, 8), showB = clamp(Math.round(num(item.revealBars, 1)), 1, 8);
    const cycle = (findB + showB) * bpb;
    const prompts = [];
    let last = '';
    for (let k = 0; k < n; k++) {
      let pr, tries = 0;
      do {
        pr = { key: keys[Math.floor(Math.random() * keys.length)], quality: quals[Math.floor(Math.random() * quals.length)], inv: Math.floor(Math.random() * 3) };
        tries++;
      } while (tries < 12 && `${pr.key}${pr.quality}${pr.inv}` === last);
      last = `${pr.key}${pr.quality}${pr.inv}`;
      prompts.push(pr);
    }
    const dur = n * cycle * 60 / bpm;
    return [{
      kind: 'triadQuiz', item: idx, name: 'Triad quiz', set, bpm, prompts, cycle, findBeats: findB * bpb, labels,
      duration: dur, durText: `${n} triads`, ladder: null, tip: '', breakBefore: brk
    }];
  }
  if (item.shuffle) keys = shuffleList(keys);
  const bars = clamp(Math.round(num(item.bars, 2)), 1, 8);
  const bps = bars * bpb;
  const combos = [];
  keys.forEach(k => quals.forEach(q => combos.push({ k, q })));
  return combos.map((c, j) => {
    const shapes = Theory.triadWalk(c.k, c.q, set);
    const dur = shapes.length * bps * 60 / bpm;
    return {
      kind: 'triadWalk', item: idx, name: `${Theory.noteName(c.k)} ${c.q} triads`, key: c.k, quality: c.q, set, bpm, shapes, bps,
      sayNames: item.sayNames !== false, labels, comboIdx: j,
      duration: dur, durText: fmtSpoken(dur), ladder: null, tip: '', breakBefore: j === 0 ? brk : 4
    };
  });
}

function boardAnnouncement(seg) {
  if (!settings.cueNext) return '';
  if (seg.kind === 'scale') {
    if (seg.posIdx > 0) return `Position ${seg.p}.`;
    return `Next up: ${seg.spokenName}, ${seg.all ? 'all 5 positions' : 'position ' + seg.p}, ${seg.bpm} BPM.`;
  }
  const strings = Theory.STRING_SETS[seg.set].spoken;
  if (seg.kind === 'triadQuiz') return `Next up: triad quiz, ${seg.prompts.length} triads on the ${strings}. Find each one before it appears.`;
  const name = `${Theory.spokenNote(seg.key)} ${seg.quality}`;
  const first = Theory.INV_NAMES[seg.shapes[0].inv];
  if (seg.comboIdx > 0) return `Next: ${name} triads, starting with ${first}.`;
  return `Next up: ${name} triads on the ${strings}, ${seg.bpm} BPM. Starting with ${first}.`;
}

function buildSegments(routine) {
  const segs = [];
  const brk = num(routine.breakSec, 15);
  routine.items.forEach((item, idx) => {
    if (item.type === 'scale') { scaleSegments(item, idx, brk).forEach(x => segs.push(x)); return; }
    if (item.type === 'triad') { triadSegments(item, idx, brk).forEach(x => segs.push(x)); return; }
    if (isSongItem(item)) {
      const song = findSong(item.songId), sec = findSection(song, item.sectionId);
      if (!song || !sec) return;
      if (item.ladder) {
        const l = item.ladder, steps = ladderSteps(l, 25, 150);
        steps.forEach((pct, k) => {
          const seg = songSegment(item, idx, song, sec, pct, l.mode === 'time' ? 'time' : 'loops', l.amount);
          seg.ladder = { k: k + 1, n: steps.length, start: steps[0], end: steps[steps.length - 1] };
          seg.breakBefore = k === 0 ? brk : num(l.breakSec, 3);
          segs.push(seg);
        });
      } else {
        const seg = songSegment(item, idx, song, sec, num(item.speed, 100), item.mode === 'time' ? 'time' : 'loops', item.amount);
        seg.ladder = null; seg.breakBefore = brk;
        segs.push(seg);
      }
      return;
    }
    const ex = findEx(item.exId);
    const name = ex ? ex.name : (item.name || 'Exercise');
    const tip = ex ? (ex.tip || '') : '';
    if (item.ladder) {
      const l = item.ladder;
      const steps = ladderSteps(l);
      steps.forEach((bpm, k) => {
        const amt = Math.max(1, num(l.amount, 30));
        const dur = l.mode === 'bars' ? barsToSec(amt, bpm) : amt;
        const durText = l.mode === 'bars' ? amt + (amt === 1 ? ' bar' : ' bars') : fmtSpoken(amt);
        segs.push({
          kind: 'exercise', item: idx, name, tip, bpm, duration: dur, durText,
          ladder: { k: k + 1, n: steps.length, start: steps[0], end: steps[steps.length - 1] },
          breakBefore: k === 0 ? brk : num(l.breakSec, 3)
        });
      });
    } else {
      const bpm = clamp(Math.round(num(item.bpm, 80)), 20, 400);
      const dur = Math.max(5, num(item.duration, 60));
      segs.push({ kind: 'exercise', item: idx, name, tip, bpm, duration: dur, durText: fmtSpoken(dur), ladder: null, breakBefore: brk });
    }
  });
  if (segs.length) segs[0].breakBefore = num(settings.firstBreak, 5);
  return segs;
}

function routineTotalSec(routine) {
  const segs = buildSegments(routine);
  return segs.reduce((t, s) => t + s.duration + s.breakBefore + (s.bpm ? 4 * 60 / s.bpm : 2), 0);
}

function announcement(seg) {
  if (isBoardSeg(seg)) return boardAnnouncement(seg);
  const parts = [];
  const speed = seg.kind === 'song' ? `${seg.pct} percent` : `${seg.bpm} BPM`;
  const label = seg.kind === 'song' ? seg.section : seg.name;
  if (seg.ladder && seg.ladder.k > 1) {
    if (settings.cueLadder) parts.push(`${label}, step ${seg.ladder.k} of ${seg.ladder.n}, ${speed}, ${seg.durText}.`);
    return parts.join(' ');
  }
  if (settings.cueNext) {
    const title = seg.kind === 'song' ? `${seg.name}, ${seg.section}` : seg.name;
    if (seg.ladder) {
      const unit = seg.kind === 'song' ? 'percent' : 'BPM';
      parts.push(`Next up: ${title}. Speed ladder, ${seg.ladder.n} steps, ${seg.ladder.start} to ${seg.ladder.end} ${unit}.`);
      if (settings.cueLadder) parts.push(`Step 1, ${speed}, ${seg.durText}.`);
    } else {
      parts.push(`Next up: ${title}, ${speed}, ${seg.durText}.`);
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
  countStart: 0, countBpm: 80, playStart: 0, segRemaining: 0,
  cue30Done: false, pausedFrom: null,
  undoSnap: null, undoTimer: null,
  raf: 0, ticker: 0,
  // song state
  loop: 0, songStartPos: 0, songReady: false, songEnded: false, lastLoopAt: 0,
  spoken: false, countDone: false, countSpeakAt: 0, prepToken: 0
};
const $ = id => document.getElementById(id);
// Session timing uses the phone's normal clock. The audio clock can freeze on iPhone
// (for example while the voice is talking), so it is only used to schedule clicks.
const now = () => performance.now() / 1000;
const curSeg = () => S.segs[S.i];
const isSongSeg = seg => !!seg && seg.kind === 'song';

// Does this segment's count-in (and playing) use the click sound?
function needsClicks(seg) {
  if (!seg) return false;
  if (seg.kind !== 'song') return true;
  return !!seg.bpm || !settings.voiceOn;
}
function clicksNeededNow() {
  const seg = curSeg();
  if (!seg) return false;
  if (seg.kind !== 'song') return S.phase === 'countin' || S.phase === 'play';
  return S.phase === 'countin' && !S.spoken;
}

async function startSession(routineId) {
  const routine = routines.find(r => r.id === routineId);
  if (!routine || !routine.items.length) { toast('Add something to this routine first'); return; }
  // Check every song still has its audio on this phone
  for (const it of routine.items) {
    if (!isSongItem(it)) continue;
    const song = findSong(it.songId);
    if (!song || !findSection(song, it.sectionId)) { toast('A song in this routine was deleted — edit the routine'); return; }
    if (!audioIds.has(song.id)) { toast(`"${song.name}" needs its audio file — open it in Songs and tap Replace audio`); return; }
  }
  const segs = buildSegments(routine);
  if (!segs.length) { toast('Nothing to play in this routine'); return; }
  stopEditor();
  // Everything that needs a tap to unlock happens right here
  ensureAudio();
  unlockSpeech();
  if (segs.some(isSongSeg)) unlockSongPlayer();
  requestWakeLock();
  S.active = true; S.routine = routine; S.segs = segs;
  $('app').hidden = true;
  $('session').hidden = false;
  $('done').hidden = true; $('paused').hidden = true; $('undo').hidden = true; $('nosound').hidden = true;
  buildBeatDots();
  Metro.onBeat = onBeat;
  Metro.onSchedule = onSchedule;
  Board.key = '';
  enterBreak(0);
  cancelAnimationFrame(S.raf);
  const loop = () => { tick(); S.raf = requestAnimationFrame(loop); };
  S.raf = requestAnimationFrame(loop);
  clearInterval(S.ticker);
  S.ticker = setInterval(tick, 200);   // backup in case animation frames stall
}

function enterBreak(i) {
  Metro.stop(); stopSpeech();
  songEl.pause();
  S.i = i; S.phase = 'break';
  const seg = S.segs[i];
  S.breakEnd = now() + Math.max(1, seg.breakBefore);
  S.speechDone = false;
  S.speechStartedAt = now();
  S.audioWaitUntil = 0;
  if (isSongSeg(seg)) prepareSong(seg, seg.start);
  if (isBoardSeg(seg)) { S.stepBase = 0; S.boardStep = 0; }
  const text = announcement(seg);
  // Take turns: pause Roadie's own sound so iPhone lets the voice through,
  // then the sound is switched back on before the count-in.
  const breakToken = S.breakToken = (S.breakToken || 0) + 1;
  const talk = () => {
    if (S.breakToken !== breakToken || S.phase !== 'break') return;
    S.speechStartedAt = now();
    speak(text, () => { S.speechDone = true; });
  };
  if (text && settings.voiceOn && ctx && ctx.state === 'running') {
    ctx.suspend().then(talk, talk);
  } else {
    talk();
  }
  render();
}

function prepareSong(seg, pos) {
  const token = ++S.prepToken;
  S.songReady = false;
  loadSongInto(seg.songId).then(ok => {
    if (token !== S.prepToken) return;
    if (!ok) { toast('Could not load the song audio'); return; }
    if (S.phase !== 'play') seekSong(pos);
    S.songReady = true;
  });
}

function enterCountIn(remaining, songState) {
  Metro.stop(); stopSpeech();
  const seg = curSeg();
  S.phase = 'countin';
  S.segRemaining = remaining;
  S.cue30Done = remaining <= 31;
  S.spoken = false;
  if (isSongSeg(seg)) {
    songEl.pause();
    S.loop = songState ? songState.loop : 0;
    S.songStartPos = songState ? songState.pos : seg.start;
    prepareSong(seg, S.songStartPos);
    if (!needsClicks(seg)) {
      // No song BPM: a spoken "3, 2, 1" instead of clicks
      S.spoken = true; S.countDone = false; S.countSpeakAt = now();
      const talk = () => {
        if (S.phase !== 'countin' || curSeg() !== seg) return;
        S.countSpeakAt = now();
        speak('Three. Two. One.', () => { S.countDone = true; });
      };
      if (ctx && ctx.state === 'running') ctx.suspend().then(talk, talk); else talk();
      render();
      return;
    }
  }
  const bpm = isSongSeg(seg) ? (seg.bpm || 90) : seg.bpm;
  if (isBoardSeg(seg)) {
    S.stepBase = Math.max(0, Math.floor((seg.duration - remaining) * seg.bpm / 60 + 0.05));
    S.boardStep = S.stepBase;
  }
  if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
  S.countBpm = bpm;
  S.countStart = now() + 0.15;
  S.playStart = S.countStart + 4 * 60 / bpm;
  Metro.start(bpm, ctx.currentTime + 0.15, 4, isSongSeg(seg));
  render();
}

function startSongPlay() {
  const seg = curSeg();
  S.phase = 'play';
  S.playStart = now();
  S.songEnded = false; S.lastLoopAt = now();
  S.loopStartedAt = now(); S.loopStartPos = S.songStartPos;
  S.seekTarget = null; S.seekTries = 0;
  songEl.defaultPlaybackRate = seg.rate;
  songEl.playbackRate = seg.rate;
  setPreservePitch();
  if (Math.abs(songEl.currentTime - S.songStartPos) > 0.05) seekSong(S.songStartPos);
  const want = S.songStartPos;
  const fix = () => {
    songEl.removeEventListener('playing', fix);
    // Some iPhones ignore a jump made before playback; make it again once playing
    if (Math.abs(songEl.currentTime - want) > 0.4 && S.phase === 'play') sessionSeek(want);
    songEl.playbackRate = seg.rate;
  };
  songEl.addEventListener('playing', fix);
  try { const p = songEl.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  render();
}

songEl.addEventListener('ended', () => { if (S.active && S.phase === 'play') S.songEnded = true; });

// Jump the song during a session. iPhone can take a moment to actually get there,
// so remember the target and don't judge the position until the jump has landed.
function sessionSeek(target, resetTries) {
  if (resetTries !== false) S.seekTries = 0;
  S.seekTarget = target;
  S.seekIssuedAt = now();
  seekSong(target);
  if (S.phase === 'play' && songEl.paused) {
    try { const p = songEl.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
}

function songLoopDone() {
  const seg = curSeg();
  S.songEnded = false;
  S.lastLoopAt = now();
  S.loop++;
  if (seg.mode === 'loops' && S.loop >= seg.amount) { endSegment(); return; }
  S.loopStartedAt = now();
  S.loopStartPos = seg.start;
  sessionSeek(seg.start);
}

function endSegment() {
  Metro.stop();
  songEl.pause();
  if (S.i + 1 < S.segs.length) enterBreak(S.i + 1);
  else finish();
}

function currentRemaining() {
  const seg = curSeg();
  if (!seg) return 0;
  if (S.phase === 'play') return S.segRemaining - (now() - S.playStart);
  if (S.phase === 'countin') return S.segRemaining;
  if (S.phase === 'paused' && S.pausedFrom) return S.pausedFrom.rem;
  return seg.duration;
}

function tick() {
  if (!S.active) return;
  Metro.poll();
  const t = now();
  const seg = curSeg();

  // Keep the click sound alive when it's needed (never while the voice talks)
  const soundOff = !!ctx && ctx.state !== 'running' && clicksNeededNow() && !speechBusy();
  if (soundOff && t - (S.lastResume || 0) > 1) {
    S.lastResume = t;
    try { ctx.resume(); } catch (e) {}
  }
  // A song that should be playing but isn't (iPhone blocked it)
  const songStalled = isSongSeg(seg) && S.phase === 'play' && songEl.paused && !S.songEnded && t - S.playStart > 1;
  const problem = soundOff || songStalled;
  if (problem) { if (!S.soundOffSince) S.soundOffSince = t; } else S.soundOffSince = 0;
  const showBanner = problem && t - S.soundOffSince > 1;
  const nb = $('nosound');
  if (nb.hidden === showBanner) nb.hidden = !showBanner;

  if (S.phase === 'break') {
    // Wait for both the break timer and the voice cue, so we never talk over the count-in
    // Backups in case iPhone never reports that the voice finished
    const speechSilent = 'speechSynthesis' in window && !speechSynthesis.speaking && !speechSynthesis.pending
                         && t > S.speechStartedAt + 1.5;
    const speechTimeout = t > S.breakEnd + 8;
    if (t >= S.breakEnd && (S.speechDone || speechSilent || speechTimeout)) {
      // Give the click sound a moment to come back after the voice before counting in
      if (needsClicks(seg) && ctx && ctx.state !== 'running') {
        if (!S.audioWaitUntil) S.audioWaitUntil = t + 2.5;
        try { ctx.resume(); } catch (e) {}
        if (t < S.audioWaitUntil) { renderLive(); return; }
      }
      S.audioWaitUntil = 0;
      enterCountIn(seg.duration);
      return;
    }
  } else if (S.phase === 'countin') {
    if (isSongSeg(seg)) {
      let countFinished;
      if (S.spoken) {
        const silent = !speechBusy() && t > S.countSpeakAt + 1.2;
        countFinished = S.countDone || silent || t > S.countSpeakAt + 6;
      } else {
        countFinished = t >= S.playStart;
      }
      if (countFinished && S.songReady) { startSongPlay(); return; }
      if (countFinished && !S.songReady && t > S.countSpeakAt + 10 && t > S.playStart + 8) {
        toast('Song is taking a while to load…');
      }
    } else if (t >= S.playStart) {
      S.phase = 'play';
    }
  } else if (S.phase === 'play') {
    if (isSongSeg(seg)) {
      if (seg.mode === 'time' && currentRemaining() <= 0) { endSegment(); return; }
      const pos = songEl.currentTime;
      if (S.seekTarget != null) {
        // Wait for a jump to land before checking for the end of the section
        if (Math.abs(pos - S.seekTarget) < 0.6) {
          S.seekTarget = null;
        } else if (t - S.seekIssuedAt > 1.5) {
          // The jump didn't take: try again a couple of times, then trust the player
          if (S.seekTries < 3) { S.seekTries++; sessionSeek(S.seekTarget, false); }
          else S.seekTarget = null;
        }
        renderLive();
        return;
      }
      if (pos < seg.start - 0.5 || pos > seg.end + 1.5) {
        // Playing outside the section (iPhone started in the wrong place): go to the start, don't count a loop
        S.loopStartedAt = t; S.loopStartPos = seg.start;
        sessionSeek(seg.start);
      } else if (S.songEnded || pos >= seg.end - 0.04) {
        // Only count a loop if enough of it was really played
        const needed = 0.5 * Math.max(0, seg.end - S.loopStartPos) / seg.rate;
        if (t - S.loopStartedAt >= needed) {
          songLoopDone();
          if (!S.active || S.phase !== 'play') return;
        } else {
          S.songEnded = false;
          S.loopStartedAt = t; S.loopStartPos = seg.start;
          sessionSeek(seg.start);
        }
      }
    } else if (currentRemaining() <= 0) {
      endSegment();
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
  const seg = curSeg();
  if (isBoardSeg(seg) && b.beat >= 0) {
    if (S.phase === 'countin') S.phase = 'play';
    S.boardStep = S.stepBase + b.beat;
    boardCue(seg, S.boardStep);
    showBoard(seg);
  }
  // "30 seconds left" — spoken right after a beat, never during count-in, never over a song
  if (seg && seg.kind === 'exercise' && S.phase === 'play' && settings.cue30 && !S.cue30Done && seg.duration >= 45 && currentRemaining() <= 30) {
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
  songEl.pause();
  S.phase = 'done';
  const total = S.segs.reduce((t, s) => t + s.duration, 0);
  $('done-sub').textContent = `${S.routine.name} · about ${fmtShort(total)} of playing`;
  $('done').hidden = false;
  $('paused').hidden = true;
  if (settings.cueDone) speak('Session complete.'); else stopSpeech();
  releaseWakeLock();
  render();
}

function pause() {
  if (!['break', 'countin', 'play'].includes(S.phase)) return;
  const seg = curSeg();
  S.pausedFrom = { phase: S.phase, rem: currentRemaining() };
  if (isSongSeg(seg)) {
    S.pausedFrom.loop = S.loop;
    S.pausedFrom.pos = S.phase === 'play' ? songEl.currentTime : S.songStartPos;
  }
  Metro.stop(); stopSpeech(); songEl.pause();
  S.phase = 'paused';
  render();
}

function resume() {
  if (S.phase !== 'paused') return;
  ensureAudio();
  requestWakeLock();
  const p = S.pausedFrom; S.pausedFrom = null;
  if (p.phase === 'break') enterBreak(S.i);
  else enterCountIn(p.rem, isSongSeg(curSeg()) ? { loop: p.loop, pos: p.pos } : null);
}

function snapshot() {
  const seg = curSeg();
  const snap = { i: S.i, phase: S.phase === 'paused' ? S.pausedFrom.phase : S.phase, rem: currentRemaining() };
  if (isSongSeg(seg)) {
    if (S.phase === 'paused') { snap.loop = S.pausedFrom.loop; snap.pos = S.pausedFrom.pos; }
    else { snap.loop = S.loop; snap.pos = S.phase === 'play' ? songEl.currentTime : S.songStartPos; }
  }
  return snap;
}

function restartCurrent() {
  if (!S.active || S.phase === 'done') return;
  ensureAudio();
  const snap = snapshot();
  enterCountIn(curSeg().duration);
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
  const curItem = curSeg().item;
  let target;
  const firstOfCur = S.segs.findIndex(s => s.item === curItem);
  if (S.phase === 'break' || S.i === firstOfCur) {
    let k = firstOfCur - 1;
    target = k >= 0 ? S.segs.findIndex(s => s.item === S.segs[k].item) : 0;
  } else {
    target = firstOfCur;
  }
  enterBreak(Math.max(0, target));
  toast('Previous');
}

function rewindSong() {
  const seg = curSeg();
  if (!isSongSeg(seg)) return;
  const amt = seg.rewind;
  if (S.phase === 'play') {
    // never goes before the section start, so the loop count is unchanged
    const from = S.seekTarget != null ? S.seekTarget : songEl.currentTime;
    sessionSeek(Math.max(seg.start, from - amt));
  } else if (S.phase === 'paused' && S.pausedFrom && S.pausedFrom.phase !== 'break') {
    S.pausedFrom.pos = Math.max(seg.start, S.pausedFrom.pos - amt);
    render();
  } else {
    return;
  }
  const f = $('rwflash');
  f.textContent = `⟲ ${amt}`;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
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
  else enterCountIn(Math.max(1, snap.rem), isSongSeg(curSeg()) ? { loop: snap.loop || 0, pos: snap.pos } : null);
}

function endSession() {
  S.active = false;
  Metro.stop(); stopSpeech(); releaseWakeLock();
  songEl.pause();
  cancelAnimationFrame(S.raf); clearInterval(S.ticker);
  clearTimeout(S.undoTimer);
  S.phase = 'idle';
  $('session').hidden = true;
  $('app').hidden = false;
  showTab('routines');
}

/* ---------- Fretboard in sessions (Phase 3) ---------- */
const Board = { key: '', els: [], cur: -1 };

// Called as each beat is scheduled: the scale guide's soft tone lands exactly on the click
function onSchedule(beat, time) {
  const seg = curSeg();
  if (!seg || beat < 0 || seg.kind !== 'scale' || !seg.tones) return;
  const step = S.stepBase + beat;
  if (step < seg.path.length) playTone(time, seg.path[step].midi);
}

// Spoken cues during triad items, always right after a beat
function boardCue(seg, step) {
  const bpb = settings.beatsPerBar;
  if (seg.kind === 'triadWalk' && seg.sayNames && settings.voiceOn) {
    const si = Math.floor(step / seg.bps), inShape = step % seg.bps;
    if (inShape === Math.max(0, seg.bps - bpb) && si + 1 < seg.shapes.length) {
      speak(`Next: ${Theory.INV_NAMES[seg.shapes[si + 1].inv]}`);
    }
  } else if (seg.kind === 'triadQuiz' && step % seg.cycle === 0) {
    const pr = seg.prompts[Math.floor(step / seg.cycle)];
    if (pr) speak(`${Theory.spokenNote(pr.key)} ${pr.quality}, ${Theory.INV_NAMES[pr.inv]}`);
  }
}

function showBoard(seg, force) {
  const host = $('s-board');
  const step = S.boardStep || 0;
  const playing = S.phase === 'play' || (S.phase === 'paused' && S.pausedFrom && S.pausedFrom.phase === 'play');
  if (seg.kind === 'scale') {
    const key = 'scale' + S.i;
    if (Board.key !== key || force) {
      const notes = seg.pos.notes.map((n, k) => ({
        s: n.s, f: n.f, key: k, cls: n.root ? 'root' : '',
        label: seg.labels === 'names' ? Theory.noteName(n.pc) : Theory.DEGREE[n.iv]
      }));
      const lo = Math.max(0, seg.pos.lo - 1), hi = Math.max(lo + 5, seg.pos.hi + 1);
      host.innerHTML = Theory.drawBoard({ lo, hi, notes });
      $('s-mini').innerHTML = Theory.drawMini(Theory.wholeNeck(seg.key, seg.scale), lo, hi);
      Board.key = key; Board.els = [...host.querySelectorAll('g.n')]; Board.cur = -1;
    }
    const idx = seg.pos.notes.indexOf(seg.path[clamp(step, 0, seg.path.length - 1)]);
    if (Board.cur !== idx) {
      if (Board.els[Board.cur]) Board.els[Board.cur].classList.remove('cur');
      if (Board.els[idx]) Board.els[idx].classList.add('cur');
      Board.cur = idx;
    }
    const roundLen = 2 * (seg.pos.notes.length - 1);
    const round = Math.min(seg.rounds, Math.floor(Math.max(0, step - 1) / roundLen) + 1);
    const cap = playing ? `Position ${seg.p} · round ${round} of ${seg.rounds}` : `Position ${seg.p} — start on the glowing note`;
    if ($('s-caption').textContent !== cap) $('s-caption').textContent = cap;
    return;
  }
  const active = Theory.STRING_SETS[seg.set].strings;
  if (seg.kind === 'triadWalk') {
    const si = clamp(Math.floor(step / seg.bps), 0, seg.shapes.length - 1);
    const inLast = playing && (step % seg.bps) >= seg.bps - settings.beatsPerBar && si + 1 < seg.shapes.length;
    const key = `walk${S.i}:${si}:${inLast ? 1 : 0}`;
    if (Board.key !== key || force) {
      const sh = seg.shapes[si];
      const lab = n => seg.labels === 'names' ? Theory.noteName(n.midi) : Theory.triadLabel(n.iv, seg.quality);
      const notes = sh.notes.map(n => ({ s: n.s, f: n.f, cls: n.iv === 0 ? 'root cur' : 'tri', label: lab(n) }));
      if (inLast) seg.shapes[si + 1].notes.forEach(n => notes.push({ s: n.s, f: n.f, cls: 'ghost', label: lab(n) }));
      const lo = Math.max(0, Math.min(...seg.shapes.map(x => x.minF)) - 1);
      const hi = Math.max(lo + 6, Math.max(...seg.shapes.map(x => x.maxF)) + 1);
      host.innerHTML = Theory.drawBoard({ lo, hi, notes, activeStrings: active });
      $('s-mini').innerHTML = '';
      Board.key = key;
      $('s-caption').textContent = Theory.INV_NAMES[sh.inv].replace(/^./, c => c.toUpperCase()) +
        (inLast ? `   →   next: ${Theory.INV_NAMES[seg.shapes[si + 1].inv]}` : '');
    }
    return;
  }
  // Triad quiz: blank neck while you find it, then every place it lives
  const pi = clamp(Math.floor(step / seg.cycle), 0, seg.prompts.length - 1);
  const pr = seg.prompts[pi];
  const reveal = playing && (step % seg.cycle) >= seg.findBeats;
  const key = `quiz${S.i}:${pi}:${reveal ? 1 : 0}:${playing ? 1 : 0}`;
  if (Board.key !== key || force) {
    const notes = [];
    if (reveal) {
      const lab = n => seg.labels === 'names' ? Theory.noteName(n.midi) : Theory.triadLabel(n.iv, pr.quality);
      Theory.triadInstances(pr.key, pr.quality, seg.set, pr.inv)
        .forEach(sh => sh.notes.forEach(n => notes.push({ s: n.s, f: n.f, cls: n.iv === 0 ? 'root cur' : 'tri', label: lab(n) })));
    }
    host.innerHTML = Theory.drawBoard({ lo: 0, hi: Theory.TRIAD_MAX, notes, activeStrings: active });
    $('s-mini').innerHTML = '';
    Board.key = key;
    const title = `${Theory.noteName(pr.key)} ${pr.quality} · ${Theory.INV_NAMES[pr.inv]}`;
    $('s-caption').textContent = playing ? `${pi + 1}/${seg.prompts.length}   ${title}${reveal ? '' : '   — find it!'}` : 'Get ready…';
  }
}

/* ---------- Session rendering ---------- */
function render() {
  const seg = curSeg();
  if (!seg) return;
  const song = isSongSeg(seg), board = isBoardSeg(seg);
  $('session').classList.toggle('song', song);
  $('session').classList.toggle('board', board);
  const itemCount = S.routine.items.length;
  const kindLabel = song ? 'Song' : seg.kind === 'scale' ? 'Scale' : board ? 'Triads' : 'Exercise';
  $('s-progress').textContent = `${kindLabel} · ${seg.item + 1} of ${itemCount}`;
  $('s-name').textContent = seg.name;
  const step = seg.ladder ? ` · step ${seg.ladder.k}/${seg.ladder.n}` : '';
  if (seg.kind === 'scale') $('s-sub').textContent = `Position ${seg.p}${seg.all ? ' of 5' : ''} · ${seg.bpm} BPM`;
  else if (board) $('s-sub').textContent = `${Theory.STRING_SETS[seg.set].label} strings · ${seg.bpm} BPM`;
  else $('s-sub').textContent = song ? `${seg.section} · ${seg.pct}%${step}` : `${seg.bpm} BPM${step}`;
  if (board) showBoard(seg);
  $('s-rwhint').textContent = `tap anywhere up here to rewind ${seg.rewind || 15}s`;
  const next = S.segs[S.i + 1];
  $('s-next').textContent = next
    ? `Next: ${next.kind === 'song' ? next.name + ' – ' + next.section + ' · ' + next.pct + '%' : next.name + ' · ' + next.bpm + ' BPM'}`
    : 'Last one!';
  const paused = S.phase === 'paused';
  $('paused').hidden = !paused;
  if (paused) {
    let msg;
    if (song && S.pausedFrom.phase !== 'break' && seg.mode === 'loops') {
      msg = `Resume ${seg.name} – ${seg.section}, loop ${Math.min(S.pausedFrom.loop + 1, seg.amount)} of ${seg.amount}?`;
    } else if (song) {
      msg = `Resume ${seg.name} – ${seg.section}, ${fmtClock(currentRemaining())} left?`;
    } else {
      msg = `Resume ${seg.name}, ${fmtClock(currentRemaining())} left?`;
    }
    $('paused-msg').textContent = msg;
  }
  // Beat dots only when clicks are playing
  $('s-beats').style.visibility = (song && !(S.phase === 'countin' && !S.spoken)) ? 'hidden' : 'visible';
  if (!(S.phase === 'countin' && !S.spoken) && !(S.phase === 'play' && !song)) {
    for (const d of $('s-beats').children) d.className = '';
  }
  renderLive();
}

function renderLive() {
  const big = $('s-big');
  const seg = curSeg();
  if (!seg) return;
  const song = isSongSeg(seg);
  let html = '', cls = '';
  if (S.phase === 'break') {
    const left = Math.max(0, S.breakEnd - now());
    cls = 'break';
    const len = song ? (seg.mode === 'loops' ? seg.durText : fmtClock(seg.duration)) : fmtClock(seg.duration);
    html = `${left > 0 ? Math.ceil(left) : '…'}<span class="lbl">get ready · ${len}</span>`;
  } else if (S.phase === 'countin') {
    cls = 'countin';
    if (S.spoken) {
      html = '3·2·1<span class="lbl">count-in</span>';
    } else {
      const n = Math.floor((now() - S.countStart) / (60 / S.countBpm));
      html = (n < 0 ? '4' : String(clamp(4 - n, 1, 4))) + '<span class="lbl">count-in</span>';
    }
  } else if (S.phase === 'play' || S.phase === 'paused') {
    if (song) {
      const pos = S.phase === 'play' ? songEl.currentTime : (S.pausedFrom && S.pausedFrom.pos != null ? S.pausedFrom.pos : seg.start);
      const loop = S.phase === 'play' ? S.loop : (S.pausedFrom && S.pausedFrom.loop) || 0;
      const where = `${fmtPos(pos - seg.start)} / ${fmtPos(seg.len)}`;
      if (seg.mode === 'loops') {
        html = `${Math.min(loop + 1, seg.amount)}<small>/${seg.amount}</small><span class="lbl">loop · ${where}</span>`;
      } else {
        html = `${fmtClock(currentRemaining())}<span class="lbl">left · loop ${loop + 1} · ${where}</span>`;
      }
    } else {
      html = fmtClock(currentRemaining());
    }
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
  const zoneAt = (x, y) => {
    if (isSongSeg(curSeg())) return y > window.innerHeight * 0.8 ? 'pause' : 'rewind';
    const w = window.innerWidth;
    return x < w / 3 ? 'left' : x > 2 * w / 3 ? 'right' : 'center';
  };
  zones.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S.phase === 'done') return;
    active = true; longFired = false;
    startZone = zoneAt(e.clientX, e.clientY);
    clearTimeout(pressTimer);
    if (startZone === 'rewind') { rewindSong(); active = false; return; }   // instant
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
  $('nosound').addEventListener('pointerup', e => {
    e.stopPropagation();
    ensureAudio(true);
    $('nosound').hidden = true;
    S.soundOffSince = 0;
    const seg = curSeg();
    if (isSongSeg(seg) && S.phase === 'play') {
      try { const p = songEl.play(); if (p && p.catch) p.catch(() => {}); } catch (err) {}
    } else if (S.phase === 'countin' || S.phase === 'play') {
      enterCountIn(Math.max(1, currentRemaining()), isSongSeg(seg) ? { loop: S.loop, pos: S.songStartPos } : null);
    }
  });
  $('btn-resume').addEventListener('click', e => { e.stopPropagation(); resume(); });
  $('btn-restart').addEventListener('click', e => { e.stopPropagation(); restartCurrent(); });
  $('btn-skip').addEventListener('click', e => { e.stopPropagation(); skipCurrent(); });
  $('btn-end').addEventListener('click', e => { e.stopPropagation(); endSession(); });
  $('btn-done').addEventListener('click', endSession);
})();

/* Auto-pause when the app is backgrounded or the phone locks */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (S.active) pause();
    else songEl.pause();
  } else if (S.active) {
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
let songDraft = null;   // song being edited

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function showTab(tab) {
  stopEditor();
  draft = null; songDraft = null;
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'routines') renderRoutines();
  else if (tab === 'exercises') renderExercises();
  else if (tab === 'songs') renderSongs();
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
      <div class="meta">${n} item${n === 1 ? '' : 's'} · about ${fmtShort(routineTotalSec(r))} · ${esc(r.breakSec)}s breaks</div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary start" data-start="${r.id}">▶ Start</button>
        <span class="spacer"></span>
        <button class="btn" data-edit="${r.id}">Edit</button>
      </div>
    </div>`;
  }
  html += `<button class="btn wide" id="newRoutine">+ New routine</button>
    <p class="muted" style="margin-top:20px">Tip: turn your phone sideways once a session starts. Exercises: tap the middle to pause, the left side to restart, hold the left side to go back, the right side to skip. Songs: tap anywhere to rewind, the bottom strip to pause.</p>`;
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
function defaultSongLadder() {
  return { start: 60, end: 100, step: 10, mode: 'loops', amount: 2, breakSec: 3 };
}

const isBoardItem = it => it && (it.type === 'scale' || it.type === 'triad');
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);

function itemName(it) {
  if (it.type === 'scale') {
    const sc = Theory.SCALES[it.scale] || Theory.SCALES.minPent;
    return `🎼 ${Theory.noteName(num(it.key, 9))} ${sc.name}`;
  }
  if (it.type === 'triad') {
    const q = it.quality === 'both' ? 'major & minor' : (it.quality || 'major');
    const keys = itemKeys(it).map(Theory.noteName).join(', ');
    return it.mode === 'quiz' ? `🔺 Triad quiz – ${keys}` : `🔺 Triads – ${keys} ${q}`;
  }
  if (isSongItem(it)) {
    const song = findSong(it.songId), sec = findSection(song, it.sectionId);
    return song && sec ? `🎵 ${song.name} – ${sec.name}` : '🎵 Missing song';
  }
  const ex = findEx(it.exId);
  return ex ? ex.name : (it.name || 'Missing exercise');
}

function sectionLen(it) {
  const sec = findSection(findSong(it.songId), it.sectionId);
  return sec ? Math.max(0.5, sec.end - sec.start) : 30;
}
const timesText = n => n === 1 ? 'once' : n + ' times';

// Plain-English description of what a song item will do
// Tappable circle of 12 keys (circle of fifths order)
function keyCircle(i, selected, multi) {
  let h = '<div class="keycircle">';
  Theory.CIRCLE.forEach((pc, k) => {
    const a = (k / 12) * 2 * Math.PI - Math.PI / 2;
    const x = 50 + 40 * Math.cos(a), y = 50 + 40 * Math.sin(a);
    h += `<button class="kc${selected.includes(pc) ? ' on' : ''}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-act="key" data-i="${i}" data-pc="${pc}">${Theory.noteName(pc)}</button>`;
  });
  h += multi
    ? `<div class="kc-mid"><b>${selected.length}</b>${selected.length === 1 ? 'key' : 'keys'} · tap to add or remove</div>`
    : `<div class="kc-mid"><b>${Theory.noteName(selected[0])}</b>key</div>`;
  return h + '</div>';
}

function boardItemFields(it, i) {
  const opt = (v, cur, label) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const chk = (f, on, label) => `<label class="toggle compact"><span>${label}</span><input type="checkbox" data-i="${i}" data-f="b.${f}" ${on ? 'checked' : ''}></label>`;
  const numF = (f, label, v) => `<label class="field"><span>${label}</span><input type="number" inputmode="numeric" data-i="${i}" data-f="b.${f}" value="${esc(v)}"></label>`;
  const sel = (f, label, options) => `<label class="field"><span>${label}</span><select data-i="${i}" data-f="b.${f}">${options}</select></label>`;
  const oneToFour = cur => [1, 2, 3, 4].map(n => opt(n, cur, n)).join('');
  let h = '';
  if (it.type === 'scale') {
    h += keyCircle(i, [Theory.pcOf(num(it.key, 9))], false);
    h += sel('scale', 'Scale', Theory.SCALE_ORDER.map(id => opt(id, it.scale, capFirst(Theory.SCALES[id].name))).join(''));
    h += `<div class="inline-fields">
      ${numF('bpm', 'BPM', it.bpm)}
      ${sel('positions', 'Positions', opt('all', it.positions, 'All 5') + [1, 2, 3, 4, 5].map(p => opt(p, it.positions, 'Only ' + p)).join(''))}
      ${sel('rounds', 'Up & down', oneToFour(it.rounds))}
    </div>
    <div class="inline-fields">
      ${sel('labels', 'Labels', opt('degrees', it.labels, 'Degrees') + opt('names', it.labels, 'Note names'))}
      ${numF('posBreak', 'Break (s)', it.posBreak)}
    </div>
    ${chk('tones', it.tones !== false, 'Soft tone on each note')}`;
  } else {
    h += keyCircle(i, itemKeys(it), true);
    h += `<div class="inline-fields">
      ${sel('quality', 'Chords', opt('major', it.quality, 'Major') + opt('minor', it.quality, 'Minor') + opt('both', it.quality, 'Both'))}
      ${sel('strings', 'Strings', Object.keys(Theory.STRING_SETS).map(k => opt(k, it.strings, Theory.STRING_SETS[k].label)).join(''))}
    </div>`;
    if (it.mode === 'quiz') {
      h += `<div class="inline-fields">${numF('bpm', 'BPM', it.bpm)}${numF('prompts', 'How many', it.prompts)}</div>
      <div class="inline-fields">${sel('findBars', 'Bars to find it', oneToFour(it.findBars))}${sel('revealBars', 'Bars to check', oneToFour(it.revealBars))}</div>`;
    } else {
      h += `<div class="inline-fields">${numF('bpm', 'BPM', it.bpm)}${sel('bars', 'Bars per shape', oneToFour(it.bars))}</div>
      ${chk('sayNames', it.sayNames !== false, 'Voice names the next shape')}
      ${itemKeys(it).length > 1 ? chk('shuffle', !!it.shuffle, 'Mix up the key order') : ''}`;
    }
    h += sel('labels', 'Labels', opt('degrees', it.labels, 'Chord tones (R, 3, 5)') + opt('names', it.labels, 'Note names'));
  }
  return h + `<div class="muted sum" id="songSum${i}">${esc(itemSummary(it))}</div>`;
}

function boardSummary(it) {
  const segs = it.type === 'scale' ? scaleSegments(it, 0, 0) : triadSegments(it, 0, 0);
  const total = fmtShort(segs.reduce((t, x, k) => t + x.duration + (k ? x.breakBefore : 0), 0));
  if (it.type === 'scale') {
    const r = clamp(Math.round(num(it.rounds, 2)), 1, 8);
    return `${segs[0].name}: ${segs.length === 5 ? 'all 5 positions' : 'position ' + segs[0].p}, up and down ${timesText(r)} each — about ${total}.`;
  }
  const keys = itemKeys(it).map(Theory.noteName).join(', ');
  const q = it.quality === 'both' ? 'major and minor' : (it.quality || 'major');
  if (it.mode === 'quiz') {
    const fb = num(it.findBars, 2);
    return `${num(it.prompts, 10)} random ${q} triads in ${keys}. ${fb} bar${fb === 1 ? '' : 's'} to find each one, then it's shown — about ${total}.`;
  }
  const bars = num(it.bars, 2);
  return `${keys} ${q}: 7 shapes up the neck and back, ${bars} bar${bars === 1 ? '' : 's'} each — about ${total}.`;
}
function itemSummary(it) { return isBoardItem(it) ? boardSummary(it) : songSummary(it); }

function songSummary(it) {
  const sec = findSection(findSong(it.songId), it.sectionId);
  if (!sec) return '';
  const len = sectionLen(it);
  if (it.ladder) {
    const l = it.ladder, steps = ladderSteps(l, 25, 150);
    const amt = Math.max(1, Math.round(num(l.amount, 2)));
    if (l.mode === 'time') {
      return `Each step loops ${sec.name} for ${fmtClock(amt)}. ${steps.length} steps, about ${fmtShort(steps.length * amt)} of playing.`;
    }
    const total = steps.reduce((t, p) => t + amt * len / (p / 100), 0);
    return `Each step plays ${sec.name} ${timesText(amt)}. ${steps.length} steps, about ${fmtShort(total)} of playing.`;
  }
  const rate = clamp(num(it.speed, 100), 25, 150) / 100;
  const amt = Math.max(1, Math.round(num(it.amount, 4)));
  const loopLen = len / rate;
  if (it.mode === 'time') {
    const times = amt / loopLen;
    return `Keeps looping ${sec.name} for ${fmtClock(amt)} — about ${times < 1 ? 'part of it once' : timesText(Math.round(times))}.`;
  }
  return `Plays ${sec.name} ${timesText(amt)} — about ${fmtClock(amt * loopLen)}.`;
}

function ladderInfoText(it) {
  if (isSongItem(it)) return `${ladderSteps(it.ladder, 25, 150).length} steps: ${ladderSteps(it.ladder, 25, 150).map(p => p + '%').join(' → ')}`;
  const st = ladderSteps(it.ladder);
  return `${st.length} steps: ${st.join(' → ')}`;
}

function renderRoutineEditor() {
  const v = $('view');
  let addOptions = `<optgroup label="Exercises">${exercises.map(e => `<option value="ex:${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>`;
  addOptions += `<optgroup label="Scales & triads">
      <option value="scale:new">🎼 Scale guide</option>
      <option value="triad:walk">🔺 Triads – walk the neck</option>
      <option value="triad:quiz">🔺 Triads – name it, find it</option>
    </optgroup>`;
  if (songs.length) {
    addOptions += `<optgroup label="Songs">${songs.map(s => s.sections.map(sec =>
      `<option value="song:${s.id}:${sec.id}">🎵 ${esc(s.name)} – ${esc(sec.name)}</option>`).join('')).join('')}</optgroup>`;
  }
  let html = `<div class="row"><button class="btn small" data-act="cancel">‹ Back</button></div>
    <h1>${draft.id ? 'Edit routine' : 'New routine'}</h1>
    <label class="field"><span>Routine name</span><input type="text" data-f="name" value="${esc(draft.name)}"></label>
    <label class="field"><span>Break between items (seconds)</span><input type="number" inputmode="numeric" data-f="breakSec" value="${esc(draft.breakSec)}"></label>
    <div class="muted">Total: about <b id="totalTime">${fmtShort(routineTotalSec(draft))}</b></div>
    <h2>Exercises and songs</h2>`;
  if (!draft.items.length) html += `<div class="empty">Nothing here yet — add something below.</div>`;
  draft.items.forEach((it, i) => {
    const song = isSongItem(it);
    html += `<div class="item${song ? ' songitem' : isBoardItem(it) ? ' boarditem' : ''}">
      <div class="head">
        <div class="name">${i + 1}. ${esc(itemName(it))}</div>
        <button class="btn small" data-act="up" data-i="${i}" aria-label="Move up">▲</button>
        <button class="btn small" data-act="down" data-i="${i}" aria-label="Move down">▼</button>
        <button class="btn small danger" data-act="remove" data-i="${i}" aria-label="Remove">✕</button>
      </div>`;
    if (isBoardItem(it)) { html += boardItemFields(it, i) + '</div>'; return; }
    if (song) {
      const rw = num(it.rewind, 15);
      const rewindSel = `<label class="field"><span>Rewind button</span><select data-i="${i}" data-f="rewind">
          ${[5, 10, 15].map(s => `<option value="${s}" ${rw === s ? 'selected' : ''}>${s} seconds</option>`).join('')}
        </select></label>`;
      if (!it.ladder) {
        html += `<div class="inline-fields">
          <label class="field"><span>Speed %</span><input type="number" inputmode="numeric" data-i="${i}" data-f="speed" value="${esc(it.speed)}"></label>
          <label class="field"><span>Play for</span><input type="number" inputmode="numeric" data-i="${i}" data-f="amount" value="${esc(it.amount)}"></label>
          <label class="field"><span>Measured in</span><select data-i="${i}" data-f="mode">
            <option value="loops" ${it.mode !== 'time' ? 'selected' : ''}>loops</option>
            <option value="time" ${it.mode === 'time' ? 'selected' : ''}>secs</option>
          </select></label>
        </div>
        <div class="muted sum" id="songSum${i}">${esc(songSummary(it))}</div>
        ${rewindSel}
        <button class="btn small" data-act="ladderOn" data-i="${i}">+ Speed ladder</button>`;
      } else {
        const l = it.ladder;
        html += `<div class="ladder-box">
          <div class="row"><b>Speed ladder</b><span class="spacer"></span><button class="btn small" data-act="ladderOff" data-i="${i}">Remove ladder</button></div>
          <div class="inline-fields">
            <label class="field"><span>Start %</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.start" value="${esc(l.start)}"></label>
            <label class="field"><span>End %</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.end" value="${esc(l.end)}"></label>
            <label class="field"><span>Step %</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.step" value="${esc(l.step)}"></label>
          </div>
          <div class="inline-fields">
            <label class="field"><span>Each step</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.amount" value="${esc(l.amount)}"></label>
            <label class="field"><span>Measured in</span><select data-i="${i}" data-f="ladder.mode">
              <option value="loops" ${l.mode !== 'time' ? 'selected' : ''}>loops</option>
              <option value="time" ${l.mode === 'time' ? 'selected' : ''}>secs</option>
            </select></label>
            <label class="field"><span>Break (s)</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.breakSec" value="${esc(l.breakSec)}"></label>
          </div>
          <div class="muted" id="ladderInfo${i}">${ladderInfoText(it)}</div>
          <div class="muted sum" id="songSum${i}">${esc(songSummary(it))}</div>
        </div>
        ${rewindSel}`;
      }
    } else if (!it.ladder) {
      const mins = Math.floor(num(it.duration, 60) / 60), secs = Math.round(num(it.duration, 60) % 60);
      html += `<div class="inline-fields">
        <label class="field"><span>BPM</span><input type="number" inputmode="numeric" data-i="${i}" data-f="bpm" value="${esc(it.bpm)}"></label>
        <label class="field"><span>Min</span><input type="number" inputmode="numeric" data-i="${i}" data-f="min" value="${mins}"></label>
        <label class="field"><span>Sec</span><input type="number" inputmode="numeric" data-i="${i}" data-f="sec" value="${secs}"></label>
      </div>
      <button class="btn small" data-act="ladderOn" data-i="${i}">+ Speed ladder</button>`;
    } else {
      const l = it.ladder;
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
            <option value="time" ${l.mode === 'time' ? 'selected' : ''}>secs</option>
            <option value="bars" ${l.mode === 'bars' ? 'selected' : ''}>bars</option>
          </select></label>
          <label class="field"><span>Break (s)</span><input type="number" inputmode="numeric" data-i="${i}" data-f="ladder.breakSec" value="${esc(l.breakSec)}"></label>
        </div>
        <div class="muted" id="ladderInfo${i}">${ladderInfoText(it)}</div>
      </div>`;
    }
    html += `</div>`;
  });
  html += `<h2>Add to routine</h2>
    <div class="row"><select id="addSel" style="flex:1">${addOptions}</select><button class="btn primary" data-act="add">Add</button></div>
    ${songs.length ? '' : '<p class="muted">Import songs in the Songs tab to add them here.</p>'}
    <div class="row" style="margin-top:28px">
      <button class="btn primary" data-act="save" style="flex:1">Save routine</button>
    </div>
    ${draft.id ? `<button class="btn wide" data-act="duplicate">Duplicate routine</button>
    <button class="btn wide danger" data-act="delete">Delete routine</button>` : ''}`;
  v.innerHTML = html;
}

$('view').addEventListener('input', e => {
  const el = e.target;
  if (draft && el.dataset.f) updateDraftField(el);
  else if (songDraft && (el.dataset.sf || el.dataset.si !== undefined)) updateSongField(el);
});
$('view').addEventListener('change', e => {
  const el = e.target;
  if (draft && el.dataset.f && el.type === 'checkbox') updateDraftField(el);
  if (draft && el.dataset.f && el.tagName === 'SELECT') {
    updateDraftField(el);
    if (/mode$|^b\.(scale|quality)$/.test(el.dataset.f)) {   // redraw to show the converted number / new name
      const y = window.scrollY; renderRoutineEditor(); window.scrollTo(0, y);
    }
  }
});

function updateDraftField(el) {
  const f = el.dataset.f, i = el.dataset.i;
  if (i === undefined) {
    if (f === 'name') draft.name = el.value;
    if (f === 'breakSec') draft.breakSec = Math.max(0, num(el.value, 0));
  } else {
    const it = draft.items[+i];
    if (!it) return;
    if (f.startsWith('b.')) {
      // Scale guide and triad settings
      const k = f.slice(2);
      if (el.type === 'checkbox') it[k] = el.checked;
      else if (['bpm', 'rounds', 'posBreak', 'prompts', 'findBars', 'revealBars', 'bars'].includes(k)) it[k] = Math.max(k === 'posBreak' ? 0 : 1, num(el.value, it[k]));
      else if (k === 'positions') it[k] = el.value === 'all' ? 'all' : num(el.value, 1);
      else it[k] = el.value;
    }
    else if (f === 'bpm') it.bpm = clamp(num(el.value, 80), 20, 400);
    else if (f === 'speed') it.speed = clamp(num(el.value, 100), 25, 150);
    else if (f === 'amount') it.amount = Math.max(1, Math.round(num(el.value, 4)));
    else if (f === 'mode') {
      // Switching loops <-> seconds converts the number so the length stays about the same
      const len = sectionLen(it), rate = clamp(num(it.speed, 100), 25, 150) / 100;
      if (el.value === 'time' && it.mode !== 'time') it.amount = Math.max(5, Math.round(num(it.amount, 4) * len / rate));
      if (el.value === 'loops' && it.mode === 'time') it.amount = Math.max(1, Math.round(num(it.amount, 60) * rate / len));
      it.mode = el.value;
    }
    else if (f === 'rewind') it.rewind = num(el.value, 15);
    else if (f === 'min' || f === 'sec') {
      const box = el.closest('.item');
      const m = num(box.querySelector('[data-f=min]').value, 0);
      const s = num(box.querySelector('[data-f=sec]').value, 0);
      it.duration = Math.max(5, m * 60 + s);
    } else if (f.startsWith('ladder.')) {
      const k = f.slice(7);
      if (k === 'mode' && el.value !== it.ladder.mode) {
        const l = it.ladder, amt = num(l.amount, 1);
        if (isSongItem(it)) {
          const len = sectionLen(it);
          if (el.value === 'time') l.amount = Math.max(5, Math.round(amt * len));
          else l.amount = Math.max(1, Math.round(amt / len));
        } else {
          const bpm = Math.max(20, num(l.start, 80)), barSec = settings.beatsPerBar * 60 / bpm;
          if (el.value === 'bars') l.amount = Math.max(1, Math.round(amt / barSec));
          else l.amount = Math.max(5, Math.round(amt * barSec));
        }
      }
      it.ladder[k] = k === 'mode' ? el.value : num(el.value, it.ladder[k]);
      const info = document.getElementById('ladderInfo' + i);
      if (info) info.textContent = ladderInfoText(it);
    }
  }
  if (i !== undefined) {
    const sum = document.getElementById('songSum' + i);
    if (sum && draft.items[+i]) sum.textContent = itemSummary(draft.items[+i]);
  }
  const tt = $('totalTime');
  if (tt) tt.textContent = fmtShort(routineTotalSec(draft));
}

$('view').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !draft) return;
  const act = b.dataset.act, i = +b.dataset.i;
  if (act === 'cancel') { draft = null; showTab('routines'); return; }
  if (act === 'up' && i > 0) { [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]]; }
  if (act === 'down' && i < draft.items.length - 1) { [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]]; }
  if (act === 'remove') draft.items.splice(i, 1);
  if (act === 'ladderOn') draft.items[i].ladder = isSongItem(draft.items[i]) ? defaultSongLadder() : defaultLadder(num(draft.items[i].bpm, 80));
  if (act === 'ladderOff') draft.items[i].ladder = null;
  if (act === 'key') {
    const it = draft.items[i], pc = +b.dataset.pc;
    if (it.type === 'scale') it.key = pc;
    else {
      const ks = itemKeys(it), at = ks.indexOf(pc);
      if (at >= 0) {
        if (ks.length === 1) { toast('Keep at least one key'); return; }
        ks.splice(at, 1);
      } else ks.push(pc);
      it.keys = ks;
    }
    const y = window.scrollY; renderRoutineEditor(); window.scrollTo(0, y);
    return;
  }
  if (act === 'add') {
    const val = $('addSel').value || '';
    if (val.startsWith('ex:')) {
      const ex = findEx(val.slice(3));
      if (ex) draft.items.push({ exId: ex.id, name: ex.name, bpm: ex.bpm, duration: ex.duration, ladder: null });
    } else if (val === 'scale:new') {
      draft.items.push({ type: 'scale', key: 9, scale: 'minPent', bpm: 80, positions: 'all', rounds: 2, posBreak: 4, labels: 'degrees', tones: true });
    } else if (val === 'triad:walk') {
      draft.items.push({ type: 'triad', mode: 'walk', keys: [0], quality: 'major', strings: 'gbe', bpm: 70, bars: 2, sayNames: true, shuffle: false, labels: 'degrees' });
    } else if (val === 'triad:quiz') {
      draft.items.push({ type: 'triad', mode: 'quiz', keys: [0, 7, 9, 4], quality: 'both', strings: 'gbe', bpm: 70, prompts: 10, findBars: 2, revealBars: 1, labels: 'degrees' });
    } else if (val.startsWith('song:')) {
      const [, songId, sectionId] = val.split(':');
      const song = findSong(songId), sec = findSection(song, sectionId);
      if (song && sec) {
        const full = sec.end - sec.start > 90;
        draft.items.push({ type: 'song', songId, sectionId, speed: 100, mode: full ? 'time' : 'loops', amount: full ? 120 : 4, rewind: 15, ladder: null });
      }
    }
  }
  if (act === 'save') {
    if (!draft.name.trim()) { toast('Give the routine a name'); return; }
    draft.items.forEach(it => { if (!isSongItem(it)) { const ex = findEx(it.exId); if (ex) it.name = ex.name; } });
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
});

/* ---------- Exercise library ---------- */
function renderExercises() {
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
    const used = routines.filter(r => r.items.some(it => !isSongItem(it) && it.exId === id)).map(r => r.name);
    const msg = used.length ? `"${exDraft.name}" is used in: ${used.join(', ')}. Delete it and remove it from those routines?` : `Delete "${exDraft.name}"?`;
    if (!confirm(msg)) return;
    exercises = exercises.filter(x => x.id !== id);
    routines.forEach(r => { r.items = r.items.filter(it => isSongItem(it) || it.exId !== id); });
    saveExercises(); saveRoutines(); renderExercises();
  });
}

/* ---------- Songs ---------- */
function renderSongs() {
  const v = $('view');
  let html = `<h1>Songs</h1>`;
  if (!songs.length) html += `<div class="empty">No songs yet. Import an MP3 from your Files or iCloud Drive.</div>`;
  for (const s of songs) {
    const missing = !audioIds.has(s.id);
    html += `<div class="card">
      <div class="row"><div class="title" style="flex:1">🎵 ${esc(s.name)}</div><button class="btn small" data-songedit="${s.id}">Edit</button></div>
      <div class="meta">${fmtPos(s.duration)} · ${s.sections.length} section${s.sections.length === 1 ? '' : 's'}${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}</div>
      <div class="meta">${s.sections.map(x => esc(x.name)).join(' · ')}</div>
      ${missing ? '<div class="meta warn">⚠ Audio file missing — tap Edit, then Replace audio file</div>' : ''}
    </div>`;
  }
  html += `<button class="btn wide primary" id="importSong">+ Import song</button>
    <input type="file" id="songFile" accept="audio/*,.mp3,.m4a,.aac,.wav" hidden>
    <p class="muted" style="margin-top:16px">Songs are stored on this phone only. Backups save your song sections and settings, but not the audio files themselves.</p>`;
  v.innerHTML = html;
  v.querySelectorAll('[data-songedit]').forEach(b => b.addEventListener('click', () => editSong(b.dataset.songedit)));
  $('importSong').addEventListener('click', () => $('songFile').click());
  $('songFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) await importSongFile(file);
  });
}

async function storeAudio(id, file) {
  const data = await file.arrayBuffer();
  await DB.put(id, { type: file.type || 'audio/mpeg', data, name: file.name });
  audioIds.add(id);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}

function probeDuration(id) {
  return getSongUrl(id).then(url => new Promise(res => {
    if (!url) return res(0);
    const a = new Audio();
    a.preload = 'metadata';
    let done = false;
    const fin = d => { if (done) return; done = true; res(isFinite(d) && d > 0 ? d : 0); a.removeAttribute('src'); };
    a.addEventListener('loadedmetadata', () => fin(a.duration));
    a.addEventListener('error', () => fin(0));
    setTimeout(() => fin(a.duration), 6000);
    a.src = url;
    try { a.load(); } catch (e) {}
  }));
}

async function importSongFile(file) {
  toast('Importing…');
  try {
    const id = uid();
    await storeAudio(id, file);
    const dur = round1(await probeDuration(id));
    const song = {
      id, name: file.name.replace(/\.[^.]+$/, ''), bpm: null, duration: dur,
      sections: [{ id: uid(), name: 'Full track', start: 0, end: dur }]
    };
    songs.push(song); saveSongs();
    toast('Song imported');
    editSong(id);
  } catch (err) {
    toast('Could not import that file — the phone may be out of space');
  }
}

let edRaf = 0, previewEnd = null, scrubbing = false;
function stopEditor() {
  cancelAnimationFrame(edRaf); edRaf = 0;
  previewEnd = null;
  if (!S.active) songEl.pause();
}

async function editSong(id) {
  const s = findSong(id);
  if (!s) return;
  stopEditor();
  draft = null;
  songDraft = JSON.parse(JSON.stringify(s));
  renderSongEditor();
  if (audioIds.has(id)) {
    songEl.muted = false;
    const ok = await loadSongInto(id);
    if (ok && songDraft && songDraft.id === id) {
      const d = songEl.duration;
      if (isFinite(d) && d > 0 && Math.abs(d - songDraft.duration) > 0.2) {
        // Fix up the length if it wasn't known at import
        const old = songDraft.duration;
        songDraft.duration = round1(d);
        songDraft.sections.forEach(x => { if (!x.end || x.end > d || (x.end === old && x.start === 0)) x.end = round1(d); });
        renderSongEditor();
      }
    }
  }
  const loop = () => { editorTick(); edRaf = requestAnimationFrame(loop); };
  edRaf = requestAnimationFrame(loop);
}

function timeFields(prefix, j, t) {
  const m = Math.floor(t / 60), s = round1(t - m * 60);
  return `<label class="field"><span>Min</span><input type="number" inputmode="numeric" data-si="${j}" data-f="${prefix}m" value="${m}"></label>
          <label class="field"><span>Sec</span><input type="number" inputmode="decimal" step="0.1" data-si="${j}" data-f="${prefix}s" value="${s}"></label>`;
}

function renderSongEditor() {
  const s = songDraft, v = $('view');
  const has = audioIds.has(s.id);
  const dur = s.duration || 0;
  let html = `<div class="row"><button class="btn small" data-sact="back">‹ Back</button></div>
    <h1>Edit song</h1>
    <label class="field"><span>Song name</span><input type="text" data-sf="name" value="${esc(s.name)}"></label>
    <label class="field"><span>Song BPM (optional)</span><input type="number" inputmode="numeric" data-sf="bpm" value="${s.bpm || ''}" placeholder="Leave blank for a spoken 3, 2, 1"></label>
    <p class="muted">With a BPM, the count-in clicks at the song's tempo (adjusted for the speed you choose). Without one, the voice counts "3, 2, 1".</p>
    <h2>Player</h2>`;
  if (has) {
    html += `<div class="card">
      <div class="ptime" id="pTime">0:00.0 / ${fmtTenths(dur)}</div>
      <input type="range" id="pScrub" min="0" max="${dur}" step="0.1" value="0">
      <div class="row player-btns">
        <button class="btn" data-sact="back5">⏪ 5s</button>
        <button class="btn primary" data-sact="play" id="pPlay">▶ Play</button>
        <button class="btn" data-sact="fwd5">5s ⏩</button>
      </div>
      <p class="muted" style="margin-bottom:0">Play the song, then use "Start here" and "End here" to mark each section.</p>
    </div>`;
  } else {
    html += `<div class="card"><div class="meta warn">⚠ This song's audio file isn't on this phone. Tap "Replace audio file" below to add it.</div></div>`;
  }
  html += `<h2>Sections</h2>`;
  s.sections.forEach((sec, j) => {
    html += `<div class="item songitem">
      <div class="head">
        <input type="text" class="secname" data-si="${j}" data-f="name" value="${esc(sec.name)}">
        <button class="btn small danger" data-sact="delSec" data-j="${j}" aria-label="Delete section">✕</button>
      </div>
      <div class="muted" style="margin-top:8px">Start</div>
      <div class="inline-fields">${timeFields('s', j, sec.start)}
        ${has ? `<button class="btn small fit" data-sact="setStart" data-j="${j}">Start here</button>` : ''}</div>
      <div class="muted">End</div>
      <div class="inline-fields">${timeFields('e', j, sec.end)}
        ${has ? `<button class="btn small fit" data-sact="setEnd" data-j="${j}">End here</button>` : ''}</div>
      <div class="row">
        <span class="muted" id="secLen${j}">Length ${fmtTenths(Math.max(0, sec.end - sec.start))}</span>
        <span class="spacer"></span>
        ${has ? `<button class="btn small" data-sact="playSec" data-j="${j}">▶ Play section</button>` : ''}
      </div>
    </div>`;
  });
  html += `${has ? '<button class="btn wide" data-sact="addSec">+ Add section (starts where the player is)</button>' : ''}
    <button class="btn wide primary" data-sact="save" style="margin-top:20px">Save song</button>
    <button class="btn wide" data-sact="replace">Replace audio file</button>
    <input type="file" id="replaceFile" accept="audio/*,.mp3,.m4a,.aac,.wav" hidden>
    <button class="btn wide danger" data-sact="delete">Delete song</button>`;
  v.innerHTML = html;

  const scrub = $('pScrub');
  if (scrub) {
    scrub.addEventListener('pointerdown', () => { scrubbing = true; });
    scrub.addEventListener('pointerup', () => { scrubbing = false; });
    scrub.addEventListener('input', () => { previewEnd = null; seekSong(num(scrub.value, 0)); });
    scrub.addEventListener('change', () => { scrubbing = false; });
  }
  $('replaceFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      forgetSongUrl(songDraft.id);
      await storeAudio(songDraft.id, file);
      const d = round1(await probeDuration(songDraft.id));
      if (d > 0) {
        songDraft.duration = d;
        songDraft.sections.forEach(x => { x.end = Math.min(x.end || d, d); if (x.start >= x.end) x.start = 0; });
      }
      toast('Audio replaced — remember to save');
      editSongAfterReplace();
    } catch (err) { toast('Could not load that file'); }
  });
}

async function editSongAfterReplace() {
  // keep unsaved edits, just reload the player
  const keep = songDraft;
  stopEditor();
  songDraft = keep;
  renderSongEditor();
  await loadSongInto(keep.id);
  const loop = () => { editorTick(); edRaf = requestAnimationFrame(loop); };
  edRaf = requestAnimationFrame(loop);
}

function editorTick() {
  if (!songDraft) return;
  const t = songEl.currentTime || 0;
  if (previewEnd != null && t >= previewEnd) { songEl.pause(); previewEnd = null; }
  const pt = $('pTime');
  if (pt) {
    const txt = `${fmtTenths(t)} / ${fmtTenths(songDraft.duration)}`;
    if (pt.textContent !== txt) pt.textContent = txt;
  }
  const sc = $('pScrub');
  if (sc && !scrubbing) sc.value = t;
  const pb = $('pPlay');
  if (pb) {
    const lbl = songEl.paused ? '▶ Play' : '❚❚ Pause';
    if (pb.textContent !== lbl) pb.textContent = lbl;
  }
}

function updateSongField(el) {
  if (el.dataset.sf === 'name') { songDraft.name = el.value; return; }
  if (el.dataset.sf === 'bpm') { const b = Math.round(num(el.value, 0)); songDraft.bpm = b >= 30 && b <= 300 ? b : null; return; }
  const j = +el.dataset.si, sec = songDraft.sections[j], f = el.dataset.f;
  if (!sec) return;
  if (f === 'name') { sec.name = el.value; return; }
  const box = el.closest('.item');
  const read = p => num(box.querySelector(`[data-f=${p}m]`).value, 0) * 60 + num(box.querySelector(`[data-f=${p}s]`).value, 0);
  if (f === 'sm' || f === 'ss') sec.start = round1(clamp(read('s'), 0, songDraft.duration || 1e6));
  if (f === 'em' || f === 'es') sec.end = round1(clamp(read('e'), 0, songDraft.duration || 1e6));
  const L = $('secLen' + j);
  if (L) L.textContent = `Length ${fmtTenths(Math.max(0, sec.end - sec.start))}`;
}

$('view').addEventListener('click', async e => {
  const b = e.target.closest('[data-sact]');
  if (!b || !songDraft) return;
  const act = b.dataset.sact, j = +b.dataset.j;
  const s = songDraft, sec = s.sections[j];
  const dur = s.duration || songEl.duration || 0;
  const pos = round1(songEl.currentTime || 0);
  const play = () => { try { const p = songEl.play(); if (p && p.catch) p.catch(() => {}); } catch (err) {} };
  if (act === 'back') { showTab('songs'); return; }
  if (act === 'play') {
    songEl.playbackRate = 1;
    if (songEl.paused) { previewEnd = null; play(); } else songEl.pause();
    return;
  }
  if (act === 'back5') { seekSong(Math.max(0, songEl.currentTime - 5)); return; }
  if (act === 'fwd5') { seekSong(Math.min(dur, songEl.currentTime + 5)); return; }
  if (act === 'playSec' && sec) {
    songEl.playbackRate = 1;
    seekSong(sec.start); previewEnd = sec.end; play();
    return;
  }
  if (act === 'setStart' && sec) {
    sec.start = pos;
    if (sec.end <= sec.start) sec.end = round1(Math.min(dur, sec.start + 10));
  }
  if (act === 'setEnd' && sec) {
    if (pos <= sec.start) { toast('The end has to be after the start'); return; }
    sec.end = pos;
  }
  if (act === 'addSec') {
    s.sections.push({ id: uid(), name: 'Section ' + (s.sections.length + 1), start: pos, end: round1(Math.min(dur, pos + 30)) });
  }
  if (act === 'delSec') {
    if (s.sections.length <= 1) { toast('A song needs at least one section'); return; }
    const used = routines.some(r => r.items.some(it => isSongItem(it) && it.sectionId === sec.id));
    if (!confirm(used ? `"${sec.name}" is used in a routine. Delete it and remove it from routines when you save?` : `Delete section "${sec.name}"?`)) return;
    s.sections.splice(j, 1);
  }
  if (act === 'save') {
    if (!s.name.trim()) { toast('Give the song a name'); return; }
    for (const x of s.sections) {
      if (!x.name.trim()) x.name = 'Section';
      if (x.end - x.start < 0.5) { toast(`"${x.name}" needs an end after its start`); return; }
    }
    const k = songs.findIndex(x => x.id === s.id);
    songs[k] = s;
    const ids = new Set(s.sections.map(x => x.id));
    routines.forEach(r => { r.items = r.items.filter(it => !(isSongItem(it) && it.songId === s.id && !ids.has(it.sectionId))); });
    saveSongs(); saveRoutines();
    toast('Song saved');
    showTab('songs');
    return;
  }
  if (act === 'replace') { $('replaceFile').click(); return; }
  if (act === 'delete') {
    const used = routines.filter(r => r.items.some(it => isSongItem(it) && it.songId === s.id)).map(r => r.name);
    if (!confirm(used.length ? `"${s.name}" is used in: ${used.join(', ')}. Delete it and remove it from those routines?` : `Delete "${s.name}"?`)) return;
    songs = songs.filter(x => x.id !== s.id);
    routines.forEach(r => { r.items = r.items.filter(it => !(isSongItem(it) && it.songId === s.id)); });
    forgetSongUrl(s.id);
    try { await DB.del(s.id); } catch (err) {}
    audioIds.delete(s.id);
    saveSongs(); saveRoutines();
    showTab('songs');
    return;
  }
  // structural change: redraw, keeping the scroll position
  const y = window.scrollY;
  renderSongEditor();
  window.scrollTo(0, y);
});

/* ---------- Settings ---------- */
function fillVoiceSelect(sel) {
  const list = (voices.length ? voices : (window.speechSynthesis ? speechSynthesis.getVoices() : [])) || [];
  const en = list.filter(v => /^en/i.test(v.lang)), other = list.filter(v => !/^en/i.test(v.lang));
  const opt = v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === settings.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`;
  sel.innerHTML = `<option value="">System default</option>` + en.map(opt).join('') +
    (other.length ? `<optgroup label="Other languages">${other.map(opt).join('')}</optgroup>` : '');
}

function renderSettings() {
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
      ${chk('cueNext', '"Next up: name, speed, length"')}
      ${chk('cueTip', 'Read the exercise tip')}
      ${chk('cue30', '"30 seconds left" (exercises)')}
      ${chk('cueLadder', 'Speed ladder steps')}
      ${chk('cueDone', '"Session complete"')}
      <label class="field"><span>Voice</span><select id="voiceSel" data-s="voiceURI"></select></label>
      <label class="field"><span>Speaking speed</span><input type="range" min="0.6" max="1.4" step="0.05" data-s="voiceRate" value="${settings.voiceRate}"></label>
      <button class="btn wide" id="testVoice">▶ Test voice</button>
    </div>
    <h2>Session</h2>
    <div class="card">
      <label class="field"><span>Get-ready time before the first item (seconds)</span><input type="number" inputmode="numeric" data-s="firstBreak" value="${settings.firstBreak}"></label>
    </div>
    <h2>Backup</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Save your exercises, routines, song sections and settings to a small file, or load them back. Song audio files aren't included.</p>
      <button class="btn wide" id="exportBtn">Export backup</button>
      <button class="btn wide" id="importBtn">Import backup</button>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>
    <p class="muted" style="text-align:center;margin-top:24px">Roadie · Phase 3</p>`;
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
    if (ctx && ctx.state === 'running') ctx.suspend();
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
  const data = { app: 'roadie', version: 2, exported: new Date().toISOString(), settings, exercises, routines, songs };
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
      const incomingSongs = Array.isArray(data.songs) ? data.songs : [];
      if (!confirm(`Replace your current exercises, routines, songs and settings with this backup (${data.exercises.length} exercises, ${data.routines.length} routines, ${incomingSongs.length} songs)?`)) return;
      exercises = data.exercises; routines = data.routines; songs = incomingSongs;
      settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      saveExercises(); saveRoutines(); saveSongs(); saveSettings();
      const missing = songs.filter(s => !audioIds.has(s.id)).length;
      toast(missing ? `Backup imported — ${missing} song${missing === 1 ? ' needs its' : 's need their'} audio re-added in Songs` : 'Backup imported');
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
DB.keys().then(keys => {
  audioIds = new Set(keys);
  if (currentTab === 'songs' && !songDraft) renderSongs();
}).catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
