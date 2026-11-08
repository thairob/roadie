/* Roadie — music theory and fretboard drawing (Phase 3)
   Scales, the 5 positions, triad shapes, and the SVG fretboard.
   Strings are numbered internally from low E (0) to high E (5);
   the fretboard is always drawn with high E on top, like tab. */
'use strict';

const Theory = (() => {
  const OPEN = [40, 45, 50, 55, 59, 64];            // MIDI notes of the open strings, low E → high E
  const MAX_FRET = 17;        // scales
  const TRIAD_MAX = 19;       // triads can climb a little higher to reach the octave
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SPOKEN = ['C', 'C sharp', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat', 'A', 'B flat', 'B'];
  const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];   // circle of fifths, for the key picker
  const DEGREE = { 0: '1', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♭5', 7: '5', 8: '♭6', 9: '6', 10: '♭7', 11: '7' };
  const MIN_PENT = [0, 3, 5, 7, 10], MAJ_PENT = [0, 2, 4, 7, 9];

  const SCALES = {
    minPent:  { name: 'minor pentatonic', iv: MIN_PENT,                 pent: MIN_PENT },
    majPent:  { name: 'major pentatonic', iv: MAJ_PENT,                 pent: MAJ_PENT },
    minBlues: { name: 'minor blues',      iv: [0, 3, 5, 6, 7, 10],      pent: MIN_PENT },
    majBlues: { name: 'major blues',      iv: [0, 2, 3, 4, 7, 9],       pent: MAJ_PENT },
    minor:    { name: 'natural minor',    iv: [0, 2, 3, 5, 7, 8, 10],   pent: MIN_PENT },
    major:    { name: 'major',            iv: [0, 2, 4, 5, 7, 9, 11],   pent: MAJ_PENT },
    dorian:   { name: 'Dorian',           iv: [0, 2, 3, 5, 7, 9, 10],   pent: MIN_PENT },
    mixo:     { name: 'Mixolydian',       iv: [0, 2, 4, 5, 7, 9, 10],   pent: MAJ_PENT }
  };
  const SCALE_ORDER = ['minPent', 'majPent', 'minBlues', 'majBlues', 'minor', 'major', 'dorian', 'mixo'];

  const STRING_SETS = {
    gbe: { strings: [3, 4, 5], label: 'G-B-E (top 3)', spoken: 'G, B and high E strings' },
    dgb: { strings: [2, 3, 4], label: 'D-G-B', spoken: 'D, G and B strings' },
    adg: { strings: [1, 2, 3], label: 'A-D-G', spoken: 'A, D and G strings' },
    ead: { strings: [0, 1, 2], label: 'E-A-D', spoken: 'low E, A and D strings' }
  };
  const INV_NAMES = ['root position', 'first inversion', 'second inversion'];
  const INV_SHORT = ['Root', '1st inv', '2nd inv'];

  const pcOf = m => ((m % 12) + 12) % 12;
  const noteName = pc => NOTE_NAMES[pcOf(pc)];
  const spokenNote = pc => SPOKEN[pcOf(pc)];

  /* ---------- Scales and the 5 positions ---------- */

  // One position: start from the 2-notes-per-string pentatonic box, then fill in
  // the scale's extra notes (blues notes, or the 2 extra notes of a 7-note scale).
  function position(rootPc, scaleId, p) {
    const sc = SCALES[scaleId] || SCALES.minPent;
    const rootFret = pcOf(rootPc - 4);                // root on the low E string
    const box = [];
    for (let k = 0; k < 12; k++) {
      const idx = (p - 1 + k) % 5, oct = Math.floor((p - 1 + k) / 5);
      const midi = OPEN[0] + rootFret + sc.pent[idx] + 12 * oct;
      const s = Math.floor(k / 2);
      box.push({ s, f: midi - OPEN[s], midi });
    }
    let minF = Math.min(...box.map(n => n.f)), maxF = Math.max(...box.map(n => n.f));
    const scalePcs = new Set(sc.iv.map(i => pcOf(rootPc + i)));
    const notes = box.slice();
    for (let k = 0; k < box.length - 1; k++) {
      const a = box[k], b = box[k + 1];
      for (let m = a.midi + 1; m < b.midi; m++) {
        if (!scalePcs.has(pcOf(m))) continue;
        if (a.s === b.s) { notes.push({ s: a.s, f: m - OPEN[a.s], midi: m }); continue; }
        const fa = m - OPEN[a.s], fb = m - OPEN[b.s];
        const out = f => f < minF ? minF - f : f > maxF ? f - maxF : 0;
        // Keep the note inside the box if possible; otherwise put it on the higher string
        const useA = fb < 0 || out(fa) < out(fb);
        notes.push(useA ? { s: a.s, f: fa, midi: m } : { s: b.s, f: fb, midi: m });
      }
    }
    // Keep everything on a normal neck
    let hi = Math.max(...notes.map(n => n.f)), lo = Math.min(...notes.map(n => n.f));
    if (lo < 0) notes.forEach(n => { n.f += 12; n.midi += 12; });
    else if (hi > MAX_FRET && lo - 12 >= 0) notes.forEach(n => { n.f -= 12; n.midi -= 12; });
    notes.sort((x, y) => x.midi - y.midi);
    notes.forEach(n => { n.pc = pcOf(n.midi); n.iv = pcOf(n.midi - rootPc); n.root = n.iv === 0; });
    lo = Math.min(...notes.map(n => n.f)); hi = Math.max(...notes.map(n => n.f));
    return { notes, lo, hi };
  }

  // Up and down the position: the first round goes up and back down, later rounds repeat
  function scalePath(notes, rounds) {
    const up = notes, path = [];
    for (let r = 0; r < rounds; r++) {
      path.push(...(r === 0 ? up : up.slice(1)));
      path.push(...up.slice(0, -1).reverse());
    }
    return path;
  }

  // Every note of the scale on the whole neck (for the mini-map)
  function wholeNeck(rootPc, scaleId) {
    const sc = SCALES[scaleId] || SCALES.minPent;
    const pcs = new Set(sc.iv.map(i => pcOf(rootPc + i)));
    const out = [];
    for (let s = 0; s < 6; s++) for (let f = 0; f <= MAX_FRET; f++) {
      const pc = pcOf(OPEN[s] + f);
      if (pcs.has(pc)) out.push({ s, f, root: pc === pcOf(rootPc) });
    }
    return out;
  }

  /* ---------- Triads ---------- */
  function triadTones(quality) { return quality === 'minor' ? [0, 3, 7] : [0, 4, 7]; }

  // All close-voiced shapes of one triad on a 3-string set, low to high on the neck
  function triadShapes(rootPc, quality, setId) {
    const set = (STRING_SETS[setId] || STRING_SETS.gbe).strings;
    const tones = triadTones(quality);
    const shapes = [];
    for (let inv = 0; inv < 3; inv++) {
      const order = [tones[inv % 3], tones[(inv + 1) % 3], tones[(inv + 2) % 3]];
      for (let f0 = 0; f0 <= TRIAD_MAX; f0++) {
        const m0 = OPEN[set[0]] + f0;
        if (pcOf(m0) !== pcOf(rootPc + order[0])) continue;
        const notes = [{ s: set[0], f: f0, midi: m0, iv: order[0] }];
        let ok = true, prev = m0;
        for (let j = 1; j < 3; j++) {
          let m = prev + 1;
          while (pcOf(m) !== pcOf(rootPc + order[j])) m++;
          const f = m - OPEN[set[j]];
          if (f < 0 || f > TRIAD_MAX) { ok = false; break; }
          notes.push({ s: set[j], f, midi: m, iv: order[j] });
          prev = m;
        }
        if (!ok) continue;
        const fr = notes.map(n => n.f);
        shapes.push({ inv, notes, minF: Math.min(...fr), maxF: Math.max(...fr) });
      }
    }
    shapes.sort((a, b) => (a.minF + a.maxF) - (b.minF + b.maxF));
    return shapes;
  }

  // Walk the neck: root position → 1st → 2nd → root an octave up, then back down
  function triadWalk(rootPc, quality, setId, invs) {
    const all = triadShapes(rootPc, quality, setId);
    if (invs && invs.length && invs.length < 3) {
      // Only some shapes chosen: every place those shapes appear, up the neck and back
      const up = all.filter(sh => invs.includes(sh.inv));
      return up.concat(up.slice(0, -1).reverse());
    }
    let start = all.findIndex(sh => sh.inv === 0);
    if (start < 0) start = 0;
    if (start + 3 >= all.length) start = Math.max(0, all.length - 4);
    const up = all.slice(start, start + 4);
    return up.concat(up.slice(0, -1).reverse());
  }

  // Every place one inversion appears on the neck (for the quiz answer)
  function triadInstances(rootPc, quality, setId, inv) {
    return triadShapes(rootPc, quality, setId).filter(sh => sh.inv === inv);
  }

  function triadLabel(iv, quality) {
    if (iv === 0) return 'R';
    if (iv === 7) return '5';
    return quality === 'minor' ? '♭3' : '3';
  }

  /* ---------- Fretboard drawing (SVG) ---------- */
  // opts: { lo, hi, notes:[{s,f,label,cls,key}], activeStrings:[...]|null }
  function drawBoard(opts) {
    const W = 1000, H = 400, lo = opts.lo, hi = opts.hi;
    const n = hi - lo + 1, sw = W / n, top = 26, bottom = H - 56, gap = (bottom - top) / 5;
    const y = s => top + (5 - s) * gap;                 // high E (5) on top
    const x = f => (f - lo + 0.5) * sw;
    const r = Math.min(sw, gap) * 0.43;
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect x="0" y="${top - 14}" width="${W}" height="${bottom - top + 28}" rx="10" class="fb-wood"/>`;
    // inlay dots
    for (let f = Math.max(lo, 1); f <= hi; f++) {
      const cx = x(f), mid = (y(2) + y(3)) / 2;
      if ([3, 5, 7, 9, 15, 17].includes(f)) svg += `<circle cx="${cx}" cy="${mid}" r="${Math.min(sw, gap) * 0.13}" class="fb-inlay"/>`;
      if (f === 12) {
        svg += `<circle cx="${cx}" cy="${(y(1) + y(2)) / 2}" r="${Math.min(sw, gap) * 0.13}" class="fb-inlay"/>`;
        svg += `<circle cx="${cx}" cy="${(y(3) + y(4)) / 2}" r="${Math.min(sw, gap) * 0.13}" class="fb-inlay"/>`;
      }
    }
    // frets (and the nut when the open strings are showing)
    for (let k = 0; k <= n; k++) {
      const fret = lo + k;                               // line on the right-hand side of fret slot k-1
      const xx = k * sw;
      if (k === 0 && lo > 0) svg += `<line x1="${xx}" y1="${top - 10}" x2="${xx}" y2="${bottom + 10}" class="fb-fret"/>`;
      else if (k > 0) svg += `<line x1="${xx}" y1="${top - 10}" x2="${xx}" y2="${bottom + 10}" class="${fret === 1 ? 'fb-nut' : 'fb-fret'}"/>`;
    }
    // strings
    for (let s = 0; s < 6; s++) {
      const chosen = opts.activeStrings && opts.activeStrings.includes(s);
      const active = !opts.activeStrings || chosen;
      const w = 1.6 + (5 - s) * 0.7;
      if (chosen && opts.activeStrings.length < 6) {
        // the strings you're working on: a soft amber glow under a brighter, thicker string
        svg += `<line x1="0" y1="${y(s)}" x2="${W}" y2="${y(s)}" class="fb-glow" stroke-width="${w + 14}"/>`;
        svg += `<line x1="0" y1="${y(s)}" x2="${W}" y2="${y(s)}" class="fb-string on" stroke-width="${w + 2.5}"/>`;
      } else {
        svg += `<line x1="0" y1="${y(s)}" x2="${W}" y2="${y(s)}" class="fb-string${active ? '' : ' off'}" stroke-width="${w}"/>`;
      }
    }
    // fret numbers
    for (let f = lo; f <= hi; f++) {
      if (f === 0 || [1, 3, 5, 7, 9, 12, 15, 17].includes(f) || n <= 8) {
        svg += `<text x="${x(f)}" y="${H - 14}" class="fb-num">${f === 0 ? 'open' : f}</text>`;
      }
    }
    // notes
    for (const nt of opts.notes) {
      if (nt.f < lo || nt.f > hi) continue;
      svg += `<g class="n ${nt.cls || ''}" data-key="${nt.key != null ? nt.key : ''}">` +
        `<circle cx="${x(nt.f)}" cy="${y(nt.s)}" r="${r}"/>` +
        `<text x="${x(nt.f)}" y="${y(nt.s)}" dy="0.36em" font-size="${r * (nt.label && nt.label.length > 1 ? 0.82 : 1.0)}">${nt.label || ''}</text></g>`;
    }
    return svg + '</svg>';
  }

  // Small whole-neck map with the current position outlined
  function drawMini(notes, lo, hi) {
    const W = 1000, H = 120, n = MAX_FRET + 1, sw = W / n, top = 14, bottom = H - 14, gap = (bottom - top) / 5;
    const y = s => top + (5 - s) * gap, x = f => (f + 0.5) * sw;
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect x="${lo * sw}" y="2" width="${(hi - lo + 1) * sw}" height="${H - 4}" rx="8" class="mini-win"/>`;
    for (let s = 0; s < 6; s++) svg += `<line x1="0" y1="${y(s)}" x2="${W}" y2="${y(s)}" class="mini-string"/>`;
    for (let k = 1; k <= n; k++) svg += `<line x1="${k * sw}" y1="${top}" x2="${k * sw}" y2="${bottom}" class="${k === 1 ? 'mini-nut' : 'mini-fret'}"/>`;
    for (const nt of notes) svg += `<circle cx="${x(nt.f)}" cy="${y(nt.s)}" r="${nt.root ? 7 : 4.5}" class="${nt.root ? 'mini-root' : 'mini-note'}"/>`;
    return svg + '</svg>';
  }

  /* ---------- Note finder ---------- */
  const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E'];
  const STRING_SHORT = ['E', 'A', 'D', 'G', 'B', 'e'];

  // Every place a note appears on the chosen strings, up to a fret
  function notePlaces(pc, strings, maxFret) {
    const out = [];
    for (const s of strings) for (let f = 0; f <= maxFret; f++) if (pcOf(OPEN[s] + f) === pcOf(pc)) out.push({ s, f });
    return out;
  }

  /* ---------- Call and response phrases ---------- */
  // Short phrases inside one scale position: mostly steps, the odd small leap,
  // and phrases of 3+ notes end on a root so they sound finished.
  function makePhrases(rootPc, scaleId, p, count, startLen, maxLen, growEvery) {
    const notes = position(rootPc, scaleId, p).notes;          // low → high
    const roots = notes.map((n, k) => n.root ? k : -1).filter(k => k >= 0);
    const phrases = [];
    let prevStart = -1;
    for (let k = 0; k < count; k++) {
      const len = Math.min(maxLen, startLen + Math.floor(k / Math.max(1, growEvery)));
      // start near a root (or anywhere in the middle of the box), but not the same start twice
      let idx;
      do {
        idx = Math.random() < 0.5 && roots.length
          ? roots[Math.floor(Math.random() * roots.length)]
          : 2 + Math.floor(Math.random() * Math.max(1, notes.length - 4));
      } while (idx === prevStart && notes.length > 3 && Math.random() < 0.8);
      prevStart = idx;
      const seq = [idx];
      let dir = Math.random() < 0.5 ? -1 : 1;
      const body = len >= 3 ? len - 1 : len;          // the last note is added below
      for (let j = 1; j < body; j++) {
        if (Math.random() < 0.25) dir = -dir;
        const step = Math.random() < 0.75 ? 1 : 2;
        let nx = seq[seq.length - 1] + dir * step;
        if (nx < 0 || nx >= notes.length) { dir = -dir; nx = seq[seq.length - 1] + dir * step; }
        seq.push(clampIdx(nx, notes.length));
      }
      if (len >= 3 && roots.length) {
        // the note before the end shouldn't already be a root, so the ending moves somewhere
        let cur = seq[seq.length - 1];
        if (notes[cur].root) {
          const alt = cur + dir >= 0 && cur + dir < notes.length ? cur + dir : cur - dir;
          seq[seq.length - 1] = cur = clampIdx(alt, notes.length);
        }
        let best = roots[0];
        for (const r of roots) if (Math.abs(r - cur) < Math.abs(best - cur)) best = r;
        seq.push(best);
      }
      phrases.push(seq.map(i => notes[i]));
    }
    return { notes, phrases };
  }
  const clampIdx = (i, n) => Math.max(0, Math.min(n - 1, i));

  /* ---------- Micro-lessons: one-sentence tips, easy to harder ---------- */
  const TIPS = [
    'The musical alphabet has only seven letters, A to G, and then it starts over.',
    'There is a sharp or flat between most natural notes, except between B and C, and between E and F.',
    'One fret is a half step, and two frets is a whole step.',
    'The 12th fret is the same note as the open string, one octave higher.',
    'The low E and high E strings have the same notes, two octaves apart.',
    'The 5th fret of each string matches the next open string, except on the G string, where it is the 4th fret.',
    'Sharps and flats can be two names for the same note, like C sharp and D flat.',
    'For an octave from the low E or A string, go up two strings and two frets.',
    'When you learn a riff, say the note names as you play them. It builds fretboard knowledge fast.',
    'Playing a scale up and down a single string shows how its notes are laid out along the neck.',
    'The major scale follows the pattern whole, whole, half, whole, whole, whole, half.',
    'The minor pentatonic has five notes: the root, flat 3, 4, 5 and flat 7.',
    'Learn where the roots are in each scale position. They are your home base when you improvise.',
    'The five pentatonic positions link together: the top of one position is the bottom of the next.',
    'Every major key has a relative minor three frets below its root, and they share the same notes, like C major and A minor.',
    'A minor pentatonic and C major pentatonic use exactly the same notes and shapes.',
    'The blues scale is the minor pentatonic plus one extra note, the flat 5, often called the blue note.',
    'Bending the flat 3 of the minor pentatonic up a little gives that classic bluesy sound.',
    'An interval is the distance between two notes: a fourth is five frets, and a fifth is seven.',
    'A power chord is just the root and the fifth. With no third, it is neither major nor minor.',
    'A triad is three notes stacked in thirds: the root, the third and the fifth.',
    'A major chord has a major third, four frets above the root. A minor chord has a minor third, just three frets above.',
    'To turn a major chord into a minor chord, lower its third by one fret.',
    'In first inversion the third is the lowest note. In second inversion the fifth is the lowest note.',
    'Learning one triad shape in every key is a great way to learn the whole neck.',
    'Chords in a key are numbered with Roman numerals: capitals for major chords, lower case for minor.',
    'In any major key, the one, four and five chords are major, and the two, three and six chords are minor.',
    'In the key of G, the one, four and five chords are G, C and D.',
    'A 12-bar blues uses just three chords: the one, the four and the five.',
    'The five chord builds tension that wants to resolve back to the one chord.',
    'The progression minor one, flat seven, flat six is the sound of a lot of rock and metal.',
    'Landing on the root, third or fifth of the chord that is playing sounds strong and settled.',
    'The natural minor scale is the major scale started from its sixth note.',
    'Dorian is a minor scale with a raised sixth, which gives minor a brighter, funkier sound.',
    'Mixolydian is a major scale with a flat seventh. It is the sound of a lot of classic rock riffs.',
    'The circle of fifths puts each key a fifth above the last, and neighbouring keys share all but one note.',
    'Play a short phrase, then leave some space. Solos sound better as a conversation.',
    'Repeat a short idea and change one note each time. It is a simple way to build a solo.',
    'Ending a phrase on the root sounds finished, and ending on another note leaves it hanging.',
    'Slow and clean beats fast and sloppy. Speed comes from accuracy.'
  ];

  /* ---------- Chord progressions ---------- */
  // Each chord: semitones above the key's root, major/minor, and its Roman numeral
  const CH = {
    I: { iv: 0, q: 'major', num: 'I' }, IV: { iv: 5, q: 'major', num: 'IV' }, V: { iv: 7, q: 'major', num: 'V' },
    i: { iv: 0, q: 'minor', num: 'i' }, bVII: { iv: 10, q: 'major', num: '♭VII' }, bVI: { iv: 8, q: 'major', num: '♭VI' }
  };
  const PROGRESSIONS = {
    rock:  { name: 'Classic rock (I–IV–V)', short: 'Classic rock', chords: ['I', 'IV', 'V', 'IV'], minor: false, scale: 'majPent', bpm: 90 },
    blues: { name: '12-bar blues', short: '12-bar blues', chords: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'], minor: false, oneBar: true, scale: 'minPent', bpm: 80 },
    minor: { name: 'Minor rock (i–♭VII–♭VI)', short: 'Minor rock', chords: ['i', 'bVII', 'bVI', 'bVII'], minor: true, scale: 'minor', bpm: 90 }
  };
  const PROG_ORDER = ['rock', 'blues', 'minor'];

  function progChords(keyPc, progId) {
    const pr = PROGRESSIONS[progId] || PROGRESSIONS.rock;
    return pr.chords.map(c => {
      const ch = CH[c], root = pcOf(keyPc + ch.iv);
      return { root, quality: ch.q, num: ch.num, name: noteName(root) + (ch.q === 'minor' ? 'm' : ''), spoken: spokenNote(root) + (ch.q === 'minor' ? ' minor' : '') };
    });
  }
  // The different chords of a progression, in order of first appearance (for summaries)
  function progChordList(keyPc, progId) {
    const seen = new Set(), out = [];
    for (const c of progChords(keyPc, progId)) if (!seen.has(c.name)) { seen.add(c.name); out.push(c); }
    return out;
  }

  // Power chord (root, 5th, octave) with its root on the low E or A string —
  // whichever keeps the hand closest to where it was
  function powerChord(rootPc, prevFret) {
    const opts = [0, 1].map(s => {
      let f = pcOf(rootPc - OPEN[s]);
      return { s, f };
    });
    const target = prevFret == null ? 5 : prevFret;
    opts.sort((a, b) => Math.abs(a.f - target) - Math.abs(b.f - target) || a.s - b.s);
    const { s, f } = opts[0];
    return {
      fret: f,
      notes: [
        { s, f, midi: OPEN[s] + f, iv: 0 },
        { s: s + 1, f: f + 2, midi: OPEN[s + 1] + f + 2, iv: 7 },
        { s: s + 2, f: f + 2, midi: OPEN[s + 2] + f + 2, iv: 0 }
      ]
    };
  }

  // Triad shapes that stay in one area of the neck (around the first chord's shape),
  // so the hand barely moves and the progression loops back smoothly
  function triadPath(chords, setId, around) {
    const centre = sh => (sh.minF + sh.maxF) / 2;
    const pick = (c, target) => {
      const shapes = triadShapes(c.root, c.quality, setId).filter(sh => sh.maxF <= 15);
      let best = shapes[0];
      for (const sh of shapes) if (Math.abs(centre(sh) - target) < Math.abs(centre(best) - target)) best = sh;
      return best;
    };
    const first = pick(chords[0], around == null ? 7 : around);
    const anchor = centre(first);
    return chords.map((c, k) => k === 0 ? first : pick(c, anchor));
  }

  /* ---------- Chords for chord-change prompts ---------- */
  // A chord id is "root:type", e.g. "2:min" = Dm. Types: major, minor, power (5), dominant 7, minor 7.
  const CHORD_TYPES = {
    maj: { suffix: '', label: 'Major', tones: [0, 4, 7] },
    min: { suffix: 'm', label: 'Minor', tones: [0, 3, 7] },
    '5': { suffix: '5', label: 'Power (5)', tones: [0, 7] },
    '7': { suffix: '7', label: '7th', tones: [0, 4, 7, 10] },
    m7: { suffix: 'm7', label: 'Minor 7th', tones: [0, 3, 7, 10] }
  };
  const CHORD_TYPE_ORDER = ['maj', 'min', '5', '7', 'm7'];
  const parseChord = id => { const [r, t] = String(id).split(':'); return { root: pcOf(+r || 0), type: CHORD_TYPES[t] ? t : 'maj' }; };
  const chordName = id => { const c = parseChord(id); return noteName(c.root) + CHORD_TYPES[c.type].suffix; };
  const chordId = (root, type) => `${pcOf(root)}:${type}`;

  // Open-position shapes, low E → high E (-1 = don't play that string)
  const OPEN_SHAPES = {
    C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], Dm: [-1, -1, 0, 2, 3, 1], E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0],
    G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0], Am: [-1, 0, 2, 2, 1, 0], F: [1, 3, 3, 2, 1, 1],
    A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2], C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0],
    G7: [3, 2, 0, 0, 0, 1], Am7: [-1, 0, 2, 0, 1, 0], Dm7: [-1, -1, 0, 2, 1, 1], Em7: [0, 2, 0, 0, 0, 0]
  };
  // Movable barre shapes, as frets above the barre (root on low E = "E shape", on A = "A shape")
  const E_SHAPE = { maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0] };
  const A_SHAPE = { maj: [-1, 0, 2, 2, 2, 0], min: [-1, 0, 2, 2, 1, 0], '7': [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0] };

  const CHORD_POOLS = {
    open:   { label: 'Open chords (C, D, Dm, E, Em, G, A, Am, F)', ids: ['0:maj', '2:maj', '2:min', '4:maj', '4:min', '7:maj', '9:maj', '9:min', '5:maj'] },
    open7:  { label: 'Open 7th chords (A7, B7, C7, D7, E7, G7, Am7, Dm7, Em7)', ids: ['9:7', '11:7', '0:7', '2:7', '4:7', '7:7', '9:m7', '2:m7', '4:m7'] },
    power:  { label: 'Power chords in any key', ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(r => r + ':5') },
    list:   { label: 'Only the chords in my list', ids: null }
  };

  function frets2notes(frets, rootPc) {
    const notes = [];
    frets.forEach((f, s) => { if (f >= 0) { const midi = OPEN[s] + f; notes.push({ s, f, midi, iv: pcOf(midi - rootPc) }); } });
    return notes;
  }
  // The shape to show for a chord: its open shape if it has one, otherwise a barre chord near the last one
  function chordShape(id, prevFret) {
    const c = parseChord(id), name = chordName(id);
    let notes;
    if (c.type === '5') {
      notes = powerChord(c.root, prevFret).notes;
    } else if (OPEN_SHAPES[name]) {
      notes = frets2notes(OPEN_SHAPES[name], c.root);
    } else {
      let e = pcOf(c.root - OPEN[0]), a = pcOf(c.root - OPEN[1]);
      if (e === 0) e = 12; if (a === 0) a = 12;
      const target = prevFret == null ? 5 : prevFret;
      const useE = Math.abs(e - target) <= Math.abs(a - target);
      const base = useE ? E_SHAPE[c.type] : A_SHAPE[c.type], at = useE ? e : a;
      notes = frets2notes(base.map(f => f < 0 ? -1 : f + at), c.root);
    }
    const fr = notes.map(n => n.f).filter(f => f > 0);
    return { id, name, notes, minF: fr.length ? Math.min(...fr) : 0, maxF: fr.length ? Math.max(...fr) : 0 };
  }
  const chordLabel = iv => ({ 0: 'R', 3: '♭3', 4: '3', 7: '5', 10: '♭7' }[iv] || '');

  return {
    CHORD_TYPES, CHORD_TYPE_ORDER, CHORD_POOLS, parseChord, chordName, chordId, chordShape, chordLabel,
    PROGRESSIONS, PROG_ORDER, progChords, progChordList, powerChord, triadPath,
    STRING_NAMES, STRING_SHORT, notePlaces, makePhrases, TIPS,
    OPEN, MAX_FRET, TRIAD_MAX, NOTE_NAMES, CIRCLE, DEGREE, SCALES, SCALE_ORDER, STRING_SETS, INV_NAMES, INV_SHORT,
    pcOf, noteName, spokenNote, position, scalePath, wholeNeck,
    triadShapes, triadWalk, triadInstances, triadLabel, drawBoard, drawMini
  };
})();
