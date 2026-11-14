'use strict';
// What is open and how it is set up, undo / redo, and remembered preferences.

const EX_DEF = { fmt: 'png', alpha: 'keep', matte: '#ffffff', quality: 92, rle: true, name: '' };
const VIEW_DEF = { tiled: false, reps: 3, grid: false };
const TABS = ['transform', 'color', 'effects', 'tiling'];

const state = {
  base: null,              // the image, with Transform steps applied
  name: 'texture',         // opened file's name, without extension
  p: clonePar(DEFAULTS),   // live Color / Effects / Tiling settings
  ex: { ...EX_DEF },       // export settings
  view: { ...VIEW_DEF },   // tiled preview
  tab: 'transform',
};

/* ---------- undo / redo
   A snapshot is the image plus the settings as JSON. Images are never modified, so snapshots share
   them; only Transform steps (and opening files) add a new image to the history. */
const hist = { past: [], future: [], cur: null };
let onHistory = () => {};
const snapshot = () => ({ base: state.base, name: state.name, p: JSON.stringify(state.p) });
const sameSnap = (a, b) => !!a && !!b && a.base === b.base && a.name === b.name && a.p === b.p;

function commit() {
  const s = snapshot();
  if (sameSnap(s, hist.cur)) return;
  if (hist.cur) hist.past.push(hist.cur);
  hist.cur = s;
  hist.future = [];
  trimHistory();
  onHistory();
}
function restore(s) {
  state.base = s.base; state.name = s.name; state.p = JSON.parse(s.p);
  onHistory();
}
function undo() {
  // Settings moved but not yet committed (a slider mid-drag): go back to the last committed state.
  if (!sameSnap(snapshot(), hist.cur)) { restore(hist.cur); return; }
  if (!hist.past.length) return;
  hist.future.push(hist.cur);
  hist.cur = hist.past.pop();
  restore(hist.cur);
}
function redo() {
  if (!hist.future.length) return;
  hist.past.push(hist.cur);
  hist.cur = hist.future.pop();
  restore(hist.cur);
}
const canUndo = () => hist.past.length > 0 || !sameSnap(snapshot(), hist.cur);
function resetHistory() { hist.past = []; hist.future = []; hist.cur = snapshot(); }

// Keeps at most 100 steps, and drops the oldest while the images they hold pass 1.5 GB.
function trimHistory() {
  while (hist.past.length > 100) hist.past.shift();
  for (;;) {
    const seen = new Set();
    let bytes = 0;
    for (const s of [...hist.past, hist.cur, ...hist.future]) {
      if (s && s.base && !seen.has(s.base)) { seen.add(s.base); bytes += s.base.d.length; }
    }
    if (bytes <= 1.5e9 || !hist.past.length) break;
    hist.past.shift();
  }
}

/* ---------- preferences: export settings, tiled view and the open tab survive a reload */
const PREFS_KEY = 'texture-tools';
function loadPrefs() {
  const s = store.get(PREFS_KEY);
  if (!s || typeof s !== 'object') return;
  const take = (into, from, defs) => {
    if (!from || typeof from !== 'object') return;
    for (const k of Object.keys(defs)) if (typeof from[k] === typeof defs[k]) into[k] = from[k];
  };
  take(state.ex, s.ex, EX_DEF);
  take(state.view, s.view, VIEW_DEF);
  state.ex.name = '';
  if (!['png', 'jpeg', 'webp', 'bmp', 'tga'].includes(state.ex.fmt)) state.ex.fmt = 'png';
  if (!['keep', 'drop', 'matte'].includes(state.ex.alpha)) state.ex.alpha = 'keep';
  state.view.reps = clamp(Math.round(state.view.reps) || 3, 2, 5);
  if (TABS.includes(s.tab)) state.tab = s.tab;
}
function savePrefs() {
  store.set(PREFS_KEY, { ex: { ...state.ex, name: '' }, view: state.view, tab: state.tab });
}
