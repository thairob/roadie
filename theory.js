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
  function triadWalk(rootPc, quality, setId) {
    const all = triadShapes(rootPc, quality, setId);
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
      const active = !opts.activeStrings || opts.activeStrings.includes(s);
      svg += `<line x1="0" y1="${y(s)}" x2="${W}" y2="${y(s)}" class="fb-string${active ? '' : ' off'}" stroke-width="${1.6 + (5 - s) * 0.7}"/>`;
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

  return {
    OPEN, MAX_FRET, TRIAD_MAX, NOTE_NAMES, CIRCLE, DEGREE, SCALES, SCALE_ORDER, STRING_SETS, INV_NAMES, INV_SHORT,
    pcOf, noteName, spokenNote, position, scalePath, wholeNeck,
    triadShapes, triadWalk, triadInstances, triadLabel, drawBoard, drawMini
  };
})();
