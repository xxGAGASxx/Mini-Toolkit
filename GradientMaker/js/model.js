'use strict';
// App state, the gradient model, built-in presets, file validation, undo history and autosave.

const SPACES = { oklab: 'OKLab', oklch: 'OKLCH', srgb: 'sRGB', linear: 'Linear RGB', hsl: 'HSL' };
const HUE_PATHS = { shorter: 'Shorter', longer: 'Longer', increasing: 'Increasing', decreasing: 'Decreasing' };
const BLENDS = { linear: 'Linear', smooth: 'Smooth', easein: 'Ease in', easeout: 'Ease out', hard: 'Hard edge' };
const MAX_STOPS = 64, MAX_GRADS = 64, MAX_SIDE = 8192;

// Output settings and the rules a loaded file must follow: [min, max] for numbers, a list for choices.
const OUT_SPEC = {
  layout: ['single', 'rows', 'cols'], w: [1, MAX_SIDE], h: [1, MAX_SIDE], pad: [0, 256], padFill: ['extend', 'clear'],
  pot: 'bool', shape: ['linear', 'reflect', 'radial', 'angular', 'diamond', 'square'],
  angle: [-180, 180], scale: [5, 400], cx: [-50, 150], cy: [-50, 150], repeat: ['clamp', 'repeat', 'mirror'],
  circle: 'bool', ends: 'bool', depth: [8, 16], dither: ['none', 'ordered', 'noise'], bgOn: 'bool', bg: 'color',
};
const INT_OUT = new Set(['w', 'h', 'pad']);
const DEF_OUT = {
  layout: 'single', w: 256, h: 16, pad: 2, padFill: 'extend', pot: false,
  shape: 'linear', angle: 0, scale: 100, cx: 50, cy: 50, repeat: 'clamp', circle: false, ends: false,
  depth: 8, dither: 'none', bgOn: false, bg: '#000000',
};
const DEF_VIEW = {
  mode: 'texture', zoom: 'fit', tile: false,
  light: [-0.45, 0.55, 0.7], lookup: 'half', tint: '#ffffff',
  ch: { r: true, g: true, b: true, a: true, l: true },
  fmt: 'css', cmode: 'native', n: 16, all: false,
};

let uid = 1;
const newId = () => uid++;

function mkStop(pos, c, a = 1, blend = 'linear', mid = 0.5) { return { id: newId(), pos, c, a, blend, mid }; }
function mkGradient(name, stops, o = {}) {
  return { id: newId(), name, stops, space: o.space || 'oklab', hue: o.hue || 'shorter', steps: o.steps || 0, adj: { ...DEF_ADJ, ...o.adj } };
}
const sortStops = (stops) => stops.sort((a, b) => a.pos - b.pos);   // stable, so equal positions keep their order
const stopsOf = (list) => list.map(([p, c, a = 1, blend = 'linear', mid = 0.5]) => mkStop(p, c, a, blend, mid));

// Built-in presets, as [position, color, alpha, blend to next, midpoint].
const PRESETS = [
  { name: 'Toon 2 band', stops: [[0, '#3d3b5e', 1, 'hard'], [1, '#f4efe3']] },
  { name: 'Toon 3 band', stops: [[0, '#2f2c4f', 1, 'hard'], [0.5, '#8d84a8', 1, 'hard'], [1, '#f6f1e4']] },
  { name: 'Toon soft edge', stops: [[0, '#41395f'], [0.42, '#41395f', 1, 'smooth'], [0.58, '#f3ece0'], [1, '#fffaf0']] },
  { name: 'Skin', stops: [[0, '#3c1a26'], [0.3, '#9a3f43'], [0.55, '#e0927a'], [1, '#fde6d4']] },
  { name: 'Sunset', stops: [[0, '#1c1b3f'], [0.3, '#6d2c6e'], [0.6, '#e2525c'], [0.82, '#ffae4a'], [1, '#ffe8a3']] },
  { name: 'Ocean', stops: [[0, '#021627'], [0.45, '#05496d'], [0.78, '#1595ad'], [1, '#97ece2']] },
  { name: 'Fire', stops: [[0, '#000000', 0], [0.2, '#5c0a00', 0.9], [0.45, '#d83a00'], [0.72, '#ffa21f'], [1, '#fff6c4']] },
  { name: 'Heat', stops: [[0, '#0c0b3a'], [0.28, '#4a1f8f'], [0.55, '#c42f6c'], [0.8, '#f88330'], [1, '#fbe85a']] },
  { name: 'Forest', stops: [[0, '#0b1d12'], [0.35, '#1e4a2b'], [0.7, '#4f8a3a'], [1, '#c4dc72']] },
  { name: 'Ice', stops: [[0, '#132f78'], [0.4, '#2f8bcf'], [0.75, '#97def2'], [1, '#effcff']] },
  { name: 'Metal', space: 'srgb', stops: [[0, '#1b1b21'], [0.38, '#686b76'], [0.52, '#dcdfe6'], [0.66, '#4c4e58'], [1, '#f4f5f9']] },
  { name: 'Candy', space: 'oklch', stops: [[0, '#ff6fc6'], [0.5, '#7b5cff'], [1, '#43d6ff']] },
  { name: 'Spectrum', space: 'hsl', hue: 'longer', stops: [[0, '#ff4040'], [1, '#ff4040']] },
  { name: 'Rim light', stops: [[0, '#000000'], [0.55, '#000000', 1, 'smooth'], [1, '#ffffff']] },
  { name: 'Black to white', space: 'srgb', stops: [[0, '#000000'], [1, '#ffffff']] },
  { name: 'Fade out', space: 'srgb', stops: [[0, '#ffffff', 1], [1, '#ffffff', 0]] },
];
const presetGradient = (p) => mkGradient(p.name, stopsOf(p.stops), { space: p.space, hue: p.hue, steps: p.steps });

const state = {
  grads: [],
  sel: 0,          // id of the gradient being edited
  stop: 0,         // id of the selected stop in it
  out: { ...DEF_OUT },
  view: structuredClone(DEF_VIEW),
  userPresets: [], // portable gradient objects, see gradOut()
};

const selGrad = () => state.grads.find((g) => g.id === state.sel) || state.grads[0];
const selIndex = () => Math.max(0, state.grads.findIndex((g) => g.id === state.sel));
const selStop = () => { const g = selGrad(); return (g && g.stops.find((s) => s.id === state.stop)) || null; };
function fixSelection() {
  if (!state.grads.some((g) => g.id === state.sel)) state.sel = state.grads[0].id;
  const g = selGrad();
  if (!g.stops.some((s) => s.id === state.stop)) state.stop = g.stops[0].id;
}

/* ---------- portable format: what .json files and PNG metadata hold (no internal ids) */
function gradOut(g) {
  return {
    name: g.name, space: g.space, hue: g.hue, steps: g.steps, adjust: { ...g.adj },
    stops: g.stops.map((s) => ({ pos: roundTo(s.pos, 5), color: s.c, alpha: roundTo(s.a, 4), blend: s.blend, mid: roundTo(s.mid, 4) })),
  };
}
const docOut = () => ({ app: 'gradient-maker', version: 1, gradients: state.grads.map(gradOut), output: { ...state.out } });

// Builds a model gradient from untrusted data (a file, storage); returns null if it isn't usable.
function gradIn(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.stops)) return null;
  const stops = [];
  for (const s of o.stops.slice(0, MAX_STOPS)) {
    if (!s || typeof s !== 'object') continue;
    const c = typeof s.color === 'string' ? parseColor(s.color) : null;
    if (!c) continue;
    stops.push(mkStop(clamp(num(s.pos, 0), 0, 1), toHex(c.r, c.g, c.b), clamp(num(s.alpha, c.a), 0, 1),
      has(BLENDS, s.blend) ? s.blend : 'linear', clamp(num(s.mid, 0.5), 0.01, 0.99)));
  }
  if (!stops.length) return null;
  if (stops.length === 1) stops.push(mkStop(1, stops[0].c, stops[0].a));
  sortStops(stops);
  const a = o.adjust && typeof o.adjust === 'object' ? o.adjust : {};
  return mkGradient(typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : 'Gradient', stops, {
    space: has(SPACES, o.space) ? o.space : 'oklab',
    hue: has(HUE_PATHS, o.hue) ? o.hue : 'shorter',
    steps: Math.round(clamp(num(o.steps, 0), 0, 32)),
    adj: {
      hue: clamp(num(a.hue, 0), -180, 180), sat: clamp(num(a.sat, 100), 0, 200), bri: clamp(num(a.bri, 100), 0, 200),
      con: clamp(num(a.con, 100), 0, 200), op: clamp(num(a.op, 100), 0, 100),
    },
  });
}
function outIn(o) {
  const out = { ...DEF_OUT };
  if (!o || typeof o !== 'object') return out;
  for (const [k, spec] of Object.entries(OUT_SPEC)) {
    const v = o[k];
    if (spec === 'bool') { if (typeof v === 'boolean') out[k] = v; }
    else if (spec === 'color') { if (typeof v === 'string' && parseHex(v)) out[k] = toHex(...rgbOfHex(v)); }
    else if (k === 'depth') { if (v === 8 || v === 16) out[k] = v; }
    else if (typeof spec[0] === 'string') { if (spec.includes(v)) out[k] = v; }
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = INT_OUT.has(k) ? Math.round(clamp(v, spec[0], spec[1])) : clamp(v, spec[0], spec[1]);
  }
  return out;
}
// Accepts a whole document, one gradient, or a list of gradients. Returns { grads, out } or null.
function docIn(data) {
  if (!data || typeof data !== 'object') return null;
  const list = Array.isArray(data) ? data : Array.isArray(data.gradients) ? data.gradients : data.stops ? [data] : null;
  if (!list) return null;
  const grads = list.slice(0, MAX_GRADS).map(gradIn).filter(Boolean);
  if (!grads.length) return null;
  return { grads, out: data.output ? outIn(data.output) : null };
}

/* ---------- undo history: whole-document snapshots, taken after each finished change */
const hist = { past: [], future: [], cur: '' };
const snapshot = () => JSON.stringify({ g: state.grads, o: state.out });
let onHistory = () => {};   // set by app.js: refreshes the page after undo / redo

function commit() {
  const s = snapshot();
  if (s === hist.cur) return;
  hist.past.push(hist.cur);
  if (hist.past.length > 200) hist.past.shift();
  hist.cur = s;
  hist.future.length = 0;
  autosave();
}
function resetHistory() { hist.past = []; hist.future = []; hist.cur = snapshot(); }
function restore(s) {
  const d = JSON.parse(s);
  state.grads = d.g; state.out = d.o;
  fixSelection();
  autosave();
  onHistory();
}
function undo() {
  commit();   // keep any change still in progress, so undo steps back over it
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

/* ---------- autosave: the document, view and selection come back on the next visit */
const SAVE_KEY = 'gradient-maker:doc', PRESET_KEY = 'gradient-maker:presets';
let saveT = 0;
function flushSave() { clearTimeout(saveT); store.set(SAVE_KEY, { doc: docOut(), view: state.view, sel: selIndex() }); }
function autosave() { clearTimeout(saveT); saveT = setTimeout(flushSave, 300); }
function viewIn(v) {
  const view = structuredClone(DEF_VIEW);
  if (!v || typeof v !== 'object') return view;
  if (['texture', 'sphere', 'curves', 'code'].includes(v.mode)) view.mode = v.mode;
  if (['fit', '0.5', '1', '2', '4', '8', '16'].includes(v.zoom)) view.zoom = v.zoom;
  if (typeof v.tile === 'boolean') view.tile = v.tile;
  if (Array.isArray(v.light) && v.light.length === 3 && v.light.every((n) => Number.isFinite(n))) view.light = v.light;
  if (['half', 'lambert'].includes(v.lookup)) view.lookup = v.lookup;
  if (typeof v.tint === 'string' && parseHex(v.tint)) view.tint = v.tint;
  if (v.ch && typeof v.ch === 'object') for (const k of Object.keys(view.ch)) if (typeof v.ch[k] === 'boolean') view.ch[k] = v.ch[k];
  if (['css', 'svg', 'unity', 'glsl', 'hlsl', 'hex', 'json'].includes(v.fmt)) view.fmt = v.fmt;
  if (['native', 'sampled'].includes(v.cmode)) view.cmode = v.cmode;
  if (Number.isFinite(v.n)) view.n = Math.round(clamp(v.n, 2, 256));
  if (typeof v.all === 'boolean') view.all = v.all;
  return view;
}
function loadSaved() {
  const s = store.get(SAVE_KEY);
  const d = s && docIn(s.doc);
  if (d) {
    state.grads = d.grads;
    state.out = d.out || { ...DEF_OUT };
    state.view = viewIn(s.view);
    state.sel = (state.grads[s.sel] || state.grads[0]).id;
  } else {
    state.grads = [presetGradient(PRESETS[4])];
    state.sel = state.grads[0].id;
  }
  const p = store.get(PRESET_KEY);
  state.userPresets = Array.isArray(p) ? p.filter((x) => gradIn(x)).slice(0, 100) : [];
  state.stop = 0;
  fixSelection();
}
const saveUserPresets = () => store.set(PRESET_KEY, state.userPresets);
