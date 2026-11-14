'use strict';
// What is open, the tool settings, undo / redo, and remembered preferences.

const EX_DEF = {
  fmt: 'wav', wavBits: '16', flacBits: '16', mp3Kbps: '192', opusKbps: '128',
  rate: '0', chans: 'same', what: 'all', dither: true, name: '',
};
// Settings of every tool, by section. The panels edit these (data-p="reverb.decay").
const FX_DEF = {
  sel: { start: 0, end: 0 },
  silence: { len: 1 },
  split: { thresh: -45, minSil: 300, remove: false, pad: 30 },
  trim: { thresh: -50, pad: 20 },
  fade: { curve: 'smooth', len: 1 },
  gain: { db: 0 },
  norm: { peak: -1, sep: false },
  reverb: { preset: 'hall', ...REVERB_PRESETS.hall, reverse: false },
  delay: { mode: 'regular', time: 350, feedback: 45, pitch: 0, tone: 9000, mix: 35 },
  echo: { time: 280, decay: 50, count: 4, tone: 12000, mix: 50 },
  dist: { type: 'overdrive', drive: 18, tone: 9000, out: 0, mix: 100, bits: 6, rate: 6000, level: true },
  comp: { preset: 'gentle', ...COMP_PRESETS.gentle, makeup: 0 },
  speed: { pct: 100, keep: true },
  pitch: { semis: 0, cents: 0, formants: false },
  nr: { reduce: 15, sens: 6, smooth: 3, release: 100, residual: false },
  hum: { base: 'auto', harmonics: 5, width: 3 },
  filt: { lowOn: true, low: 80, highOn: false, high: 12000, slope: 24 },
};
const TABS = ['edit', 'effects', 'time', 'clean'];
const clonePar = (o) => JSON.parse(JSON.stringify(o));

const state = {
  audio: null,             // { sr, ch }
  name: 'audio',           // opened file's name, without extension
  markers: [],             // split points (samples)
  sel: null,               // { a, b } in samples, a < b, or null
  cursor: 0,               // samples
  clip: null,              // copied audio, for Paste
  profile: null,           // learned noise profile
  fx: clonePar(FX_DEF),
  ex: { ...EX_DEF },
  tab: 'edit', fxTab: 'reverb', cleanTab: 'nr', loop: false,
};

/* ---------- undo / redo
   A snapshot holds the audio, the markers and where the selection was. Audio objects are never changed,
   so snapshots share them. */
const hist = { past: [], future: [], cur: null };
let onHistory = () => {};
let dirty = false;           // edited since opening or the last export
const snapshot = () => ({ audio: state.audio, markers: state.markers, name: state.name, sel: state.sel, cursor: state.cursor });
const sameSnap = (a, b) => !!a && !!b && a.audio === b.audio && a.markers === b.markers && a.name === b.name;

function commit() {
  const s = snapshot();
  if (sameSnap(s, hist.cur)) { hist.cur = s; return; }
  if (hist.cur) hist.past.push(hist.cur);
  hist.cur = s;
  hist.future = [];
  dirty = true;
  trimHistory();
  onHistory();
}
function restore(s) {
  Object.assign(state, { audio: s.audio, markers: s.markers, name: s.name, sel: s.sel, cursor: s.cursor });
  dirty = true;
  onHistory();
}
function undo() {
  if (!hist.past.length) return false;
  hist.future.push(hist.cur);
  hist.cur = hist.past.pop();
  restore(hist.cur);
  return true;
}
function redo() {
  if (!hist.future.length) return false;
  hist.past.push(hist.cur);
  hist.cur = hist.future.pop();
  restore(hist.cur);
  return true;
}
function resetHistory() { hist.past = []; hist.future = []; hist.cur = snapshot(); dirty = false; }

// Keeps at most 100 steps, and drops the oldest while the audio they hold passes 1.2 GB.
function trimHistory() {
  while (hist.past.length > 100) hist.past.shift();
  for (;;) {
    const seen = new Set();
    let bytes = 0;
    for (const s of [...hist.past, hist.cur, ...hist.future]) {
      if (s && s.audio) for (const d of s.audio.ch) if (!seen.has(d)) { seen.add(d); bytes += d.byteLength; }
    }
    if (bytes <= 1.2e9 || !hist.past.length) break;
    hist.past.shift();
  }
}

/* ---------- preferences: tool settings, export settings and the open tabs survive a reload */
const PREFS_KEY = 'audio-tools';
function loadPrefs() {
  const s = store.get(PREFS_KEY);
  if (!s || typeof s !== 'object') return;
  const take = (into, from, defs) => {
    if (!from || typeof from !== 'object') return;
    for (const k of Object.keys(defs)) if (typeof from[k] === typeof defs[k]) into[k] = from[k];
  };
  take(state.ex, s.ex, EX_DEF);
  state.ex.name = '';
  if (!FORMATS[state.ex.fmt]) state.ex.fmt = 'wav';
  if (s.fx && typeof s.fx === 'object') for (const k of Object.keys(FX_DEF)) take(state.fx[k], s.fx[k], FX_DEF[k]);
  if (TABS.includes(s.tab)) state.tab = s.tab;
  if (typeof s.fxTab === 'string') state.fxTab = s.fxTab;
  if (typeof s.cleanTab === 'string') state.cleanTab = s.cleanTab;
  state.loop = !!s.loop;
}
let prefsT = 0;
function savePrefs() {
  clearTimeout(prefsT);
  prefsT = setTimeout(() => store.set(PREFS_KEY, {
    ex: { ...state.ex, name: '' }, fx: { ...state.fx, sel: undefined }, tab: state.tab, fxTab: state.fxTab, cleanTab: state.cleanTab, loop: state.loop,
  }), 200);
}
