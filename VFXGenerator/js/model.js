'use strict';
// The document: layers and the texture settings, with their defaults and limits, cleanup of
// anything opened from a file or storage, the frame layout of flipbooks, and the color ramp.
//
// Settings are described by small schemas (lists of { k, label, min, max, def, … }). The same
// lists build the panels, fill in defaults and check opened files, so a setting is declared once.

const APP_KEY = 'vfx-generator';
const DOC_VERSION = 1;
const MAX_FRAME = 2048;    // px per side of one frame
const MAX_SHEET = 4096;    // px per side of a whole flipbook sheet
const MAX_LAYERS = 24;

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const CH = { r: 0, g: 1, b: 2, a: 3 };

/* ---------- schemas. show(obj, doc, layer) hides a setting that does not apply. */
const LAYER_DEFS = [
  { k: 'blend', label: 'Blend', type: 'select', def: 'add',
    options: [['add', 'Add'], ['screen', 'Screen'], ['max', 'Lighten'], ['mask', 'Mask (multiply)'], ['sub', 'Subtract']],
    hint: 'How this layer combines with the layers below it' },
  { k: 'opacity', label: 'Opacity', min: 0, max: 100, def: 100, unit: '%' },
  { k: 'invert', label: 'Invert', type: 'check', def: false },
  { k: 'ch', label: 'Channel', type: 'select', def: 'r', options: [['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['a', 'Alpha']],
    show: (L, doc) => doc.color.mode === 'pack', hint: 'Which channel of the texture this layer goes into' },
];
const XFORM_DEFS = [
  { k: 'x', label: 'X', min: -150, max: 150, step: 0.5, def: 0, unit: '%' },
  { k: 'y', label: 'Y', min: -150, max: 150, step: 0.5, def: 0, unit: '%' },
  { k: 'scale', label: 'Scale', min: 5, max: 400, def: 100, unit: '%', log: true },
  { k: 'stretch', label: 'Stretch', min: 10, max: 1000, def: 100, unit: '%', log: true, hint: 'Widens (above 100 %) or narrows the layer sideways, before rotating' },
  { k: 'rot', label: 'Rotation', min: -180, max: 180, def: 0, unit: '°' },
];
// Per-layer flipbook motion: values at the first and last frame.
const MOTION_DEFS = [
  { k: 'scA', label: 'Scale from', min: 0, max: 400, def: 100, unit: '%', show: (a, d, L) => !GEN[L.type].full },
  { k: 'scB', label: 'Scale to', min: 0, max: 400, def: 100, unit: '%', show: (a, d, L) => !GEN[L.type].full },
  { k: 'opA', label: 'Opacity from', min: 0, max: 100, def: 100, unit: '%' },
  { k: 'opB', label: 'Opacity to', min: 0, max: 100, def: 100, unit: '%' },
  { k: 'rot', label: 'Turn', min: -1080, max: 1080, def: 0, unit: '°', show: (a, d, L) => !GEN[L.type].full, hint: 'Degrees turned over the whole animation' },
  { k: 'evo', label: 'Noise motion', min: 0, max: 8, step: 0.5, def: 0, show: (a, d, L) => !!GEN[L.type].evolve,
    hint: 'How far the noise drifts over the animation. In a loop it is rounded to whole steps so it joins up' },
  { k: 'reseed', label: 'New random shape each frame', type: 'check', def: false, show: (a, d, L) => !!GEN[L.type].seeded },
];

const SIZE_DEFS = [
  { k: 'w', label: 'Width', type: 'number', min: 8, max: MAX_FRAME, def: 256, unit: 'px' },
  { k: 'h', label: 'Height', type: 'number', min: 8, max: MAX_FRAME, def: 256, unit: 'px' },
  { k: 'ss', label: 'Anti-aliasing', type: 'select', def: 2, options: [[1, 'Off'], [2, '2× supersampling'], [4, '4× supersampling']],
    hint: 'Computes several samples per pixel for clean edges. 4× is slower' },
];
const COLOR_DEFS = [
  { k: 'mode', label: 'Output', type: 'select', def: 'alpha',
    options: [['alpha', 'White + alpha'], ['gray', 'Grayscale on black'], ['ramp', 'Color ramp'], ['pack', 'Pack channels']] },
  { k: 'gain', label: 'Intensity', min: 0, max: 400, def: 100, unit: '%' },
  { k: 'gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01, def: 1, log: true, hint: 'Above 1 tightens the bright areas, below 1 spreads them' },
  { k: 'rampAlpha', label: 'Alpha from brightness', type: 'check', def: true, show: (c) => c.mode === 'ramp',
    hint: 'Dark parts become transparent. Off: alpha comes from the ramp alone' },
];
const EDGE_DEFS = [
  { k: 'mode', label: 'Edge fade', type: 'select', def: 'round',
    options: [['off', 'Off'], ['round', 'Round'], ['box', 'Square'], ['tb', 'Top and bottom']],
    hint: 'Fades the texture to nothing at the frame edges, so the square never shows in game' },
  { k: 'width', label: 'Fade width', min: 0, max: 100, def: 15, unit: '%', show: (e) => e.mode !== 'off' },
];
const COL_OPTIONS = [[0, 'Auto'], ...Array.from({ length: 16 }, (_, i) => [i + 1, String(i + 1)])];
const ANIM_DEFS = [
  { k: 'on', label: 'Animate as a flipbook', type: 'check', def: false },
  { k: 'frames', label: 'Frames', min: 2, max: 64, def: 16, show: (a) => a.on },
  { k: 'cols', label: 'Columns', type: 'select', def: 0, options: COL_OPTIONS, show: (a) => a.on },
  { k: 'loop', label: 'Seamless loop', type: 'check', def: false, show: (a) => a.on,
    hint: 'The last frame leads back into the first: values go to their end and back, turns and noise wrap around' },
  { k: 'ease', label: 'Timing', type: 'select', def: 'linear', show: (a) => a.on && !a.loop,
    options: [['linear', 'Linear'], ['out', 'Ease out'], ['in', 'Ease in'], ['inout', 'Ease in and out']] },
  { k: 'fps', label: 'Preview speed', min: 1, max: 60, def: 24, unit: 'fps', show: (a) => a.on },
];
const OUT_DEFS = [
  { k: 'depth', label: 'Bit depth', type: 'select', def: 8, options: [[8, '8-bit'], [16, '16-bit']], hint: '16-bit removes banding from soft glows; files are bigger' },
  { k: 'dither', label: 'Dither (hides banding)', type: 'check', def: true, show: (o) => o.depth === 8 },
  { k: 'premul', label: 'Premultiplied alpha', type: 'check', def: false, show: (o, d) => d.color.mode === 'alpha' || d.color.mode === 'ramp',
    hint: 'Color already multiplied by alpha. Leave off unless your engine or shader asks for it' },
];

const EASE = { linear: (t) => t, out: (t) => 1 - (1 - t) * (1 - t), in: (t) => t * t, inout: smooth01 };

/* ---------- defaults and cleanup */
function cleanVal(def, v) {
  switch (def.type) {
    case 'select': { const o = def.options.find((x) => x[0] === v); return o ? o[0] : def.def; }
    case 'check': return typeof v === 'boolean' ? v : def.def;
    case 'seed': return isNum(v) ? clamp(Math.round(v), 0, 999999) : def.def;
    default: {
      if (!isNum(v)) return def.def;
      const x = clamp(v, def.min, def.max), step = def.step || 1;
      return step >= 1 ? Math.round(x) : +x.toFixed(decimalsOf(step));
    }
  }
}
function cleanBy(defs, raw) {
  const o = {}, src = raw && typeof raw === 'object' ? raw : {};
  for (const d of defs) o[d.k] = cleanVal(d, src[d.k]);
  return o;
}
const defaultsOf = (defs) => cleanBy(defs, null);

function cleanLayer(raw, ids) {
  const g = GEN[raw.type];
  const id = typeof raw.id === 'string' && /^[\w-]{1,20}$/.test(raw.id) && !ids.has(raw.id) ? raw.id : uid();
  ids.add(id);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : g.label;
  return { id, type: raw.type, name, on: raw.on !== false, ...cleanBy(LAYER_DEFS, raw), ...cleanBy(XFORM_DEFS, raw),
    p: cleanBy(g.params, raw.p), a: cleanBy(MOTION_DEFS, raw.a) };
}
// over: any layer fields, with p (generator settings) and a (motion) as partial objects.
const makeLayer = (type, over = {}) => cleanLayer({ name: GEN[type].label, ...over, type }, new Set());

function newDoc() {
  return { app: APP_KEY, v: DOC_VERSION, name: 'Untitled effect', ...defaultsOf(SIZE_DEFS),
    color: { ...defaultsOf(COLOR_DEFS), ramp: copyStops(RAMP_PRESETS.Fire) },
    edge: defaultsOf(EDGE_DEFS), anim: defaultsOf(ANIM_DEFS), out: defaultsOf(OUT_DEFS), layers: [makeLayer('glow')] };
}

// Anything parsed from a file or storage -> a valid document. Throws if it is not one at all.
function cleanDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) throw new Error('this is not a VFX Texture Generator file');
  const d = newDoc(), ids = new Set();
  if (typeof raw.name === 'string' && raw.name.trim()) d.name = raw.name.trim().slice(0, 60);
  Object.assign(d, cleanBy(SIZE_DEFS, raw));
  d.color = { ...cleanBy(COLOR_DEFS, raw.color), ramp: cleanStops(raw.color && raw.color.ramp) };
  d.edge = cleanBy(EDGE_DEFS, raw.edge);
  d.anim = cleanBy(ANIM_DEFS, raw.anim);
  d.out = cleanBy(OUT_DEFS, raw.out);
  d.layers = raw.layers.filter((L) => L && typeof L === 'object' && has(GEN, L.type)).slice(0, MAX_LAYERS).map((L) => cleanLayer(L, ids));
  return d;
}

/* ---------- flipbook layout */
// Columns for "Auto": the squarest grid with no empty cells, if there is one near square.
function autoCols(n) {
  const s = Math.ceil(Math.sqrt(n));
  for (let c = s; c <= Math.min(n, s * 2); c++) if (n % c === 0) return c;
  return s;
}
function sheetOf(doc) {
  const a = doc.anim, n = a.on ? a.frames : 1;
  const cols = a.on ? (a.cols > 0 ? Math.min(a.cols, n) : autoCols(n)) : 1, rows = Math.ceil(n / cols);
  return { n, cols, rows, w: doc.w, h: doc.h, sw: cols * doc.w, sh: rows * doc.h };
}
const sheetTooBig = (sh) => sh.sw > MAX_SHEET || sh.sh > MAX_SHEET;

// Everything that changes the pixels, as text: when it matches, a finished render can be reused.
function renderKey(doc) {
  const a = doc.anim;
  return JSON.stringify([doc.w, doc.h, doc.ss, doc.color, doc.edge, a.on && [a.frames, a.cols, a.loop, a.ease],
    doc.layers.map((L) => ({ ...L, name: 0 }))]);
}

/* ---------- color ramp: stops { p: 0..100 position, c: '#rrggbb', a: 0..100 alpha } */
const RAMP_PRESETS = {
  Fire: [[0, '#2a0300'], [30, '#a31b00'], [55, '#ff5a00'], [80, '#ffc23d'], [100, '#fffbe8']],
  Ice: [[0, '#001833'], [40, '#1f6fd1'], [75, '#8fe3ff'], [100, '#ffffff']],
  Electric: [[0, '#0a0638'], [45, '#3a4dff'], [80, '#9fe8ff'], [100, '#ffffff']],
  Magic: [[0, '#1a0036'], [35, '#7a1fd1'], [70, '#ff5ad8'], [100, '#fff0ff']],
  Toxic: [[0, '#001a05'], [40, '#1f9e2a'], [75, '#b8ff3d'], [100, '#f6ffe0']],
  Gold: [[0, '#2b1600'], [45, '#b0700d'], [80, '#ffd257'], [100, '#fffbe6']],
  Smoke: [[0, '#1b1b1f'], [60, '#6b6f78'], [100, '#d9dce2']],
  Blood: [[0, '#140000'], [55, '#6e0008'], [100, '#d0102a']],
  Heal: [[0, '#00241a'], [45, '#12b886'], [80, '#9dffc8'], [100, '#ffffff']],
};
for (const k in RAMP_PRESETS) RAMP_PRESETS[k] = RAMP_PRESETS[k].map(([p, c]) => ({ p, c, a: 100 }));

const copyStops = (stops) => stops.map((s) => ({ p: s.p, c: s.c, a: s.a }));
const sortStops = (stops) => stops.slice().sort((a, b) => a.p - b.p);
function cleanStops(raw) {
  if (!Array.isArray(raw)) return copyStops(RAMP_PRESETS.Fire);
  const out = raw.filter((s) => s && isNum(s.p) && isHex(s.c)).slice(0, 64)
    .map((s) => ({ p: clamp(+s.p.toFixed(1), 0, 100), c: s.c.toLowerCase(), a: isNum(s.a) ? clamp(Math.round(s.a), 0, 100) : 100 }));
  return out.length >= 2 ? sortStops(out) : copyStops(RAMP_PRESETS.Fire);
}

// The ramp as n RGBA entries in 0..1, blended in sRGB like most engines' gradients.
function rampLut(stops, n = 1024) {
  const s = sortStops(stops).map((x) => [x.p / 100, ...hexToRgb(x.c), x.a / 100]), lut = new Float32Array(n * 4);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    while (j < s.length - 2 && t > s[j + 1][0]) j++;
    const a = s[j], b = s[j + 1];
    const f = t <= a[0] ? 0 : t >= b[0] ? 1 : (t - a[0]) / Math.max(b[0] - a[0], 1e-9);
    for (let c = 0; c < 4; c++) lut[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  return lut;
}

// Evenly spaced RGBA samples (0..1) -> as few stops as rebuild them closely. Keeps the end points,
// then repeatedly adds the sample that straight lines between kept stops miss the most.
function stopsFromSamples(px, n) {
  const err = (i, a, b) => {
    const t = (i - a) / (b - a);
    let e = 0;
    for (let c = 0; c < 4; c++) e = Math.max(e, Math.abs(px[i * 4 + c] - lerp(px[a * 4 + c], px[b * 4 + c], t)));
    return e;
  };
  for (let tol = 1.5 / 255; ; tol *= 1.6) {
    const keep = [0, n - 1], stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = 0, wi = -1;
      for (let i = a + 1; i < b; i++) { const e = err(i, a, b); if (e > worst) { worst = e; wi = i; } }
      if (worst > tol) { keep.push(wi); stack.push([a, wi], [wi, b]); }
    }
    if (keep.length <= 32 || tol > 0.5) {
      return keep.sort((a, b) => a - b).map((i) => ({
        p: +((i / (n - 1)) * 100).toFixed(1), c: rgbToHex(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), a: Math.round(px[i * 4 + 3] * 100),
      }));
    }
  }
}
