'use strict';
// Side panels: the gradient list, interpolation and adjustment settings, presets (left),
// and the texture, shape and quality settings (right).

const pn = {
  list: $('#glist'), count: $('#g-count'), add: $('#g-add'), dup: $('#g-dup'), up: $('#g-up'), down: $('#g-down'), del: $('#g-del'),
  space: $('#g-space'), hue: $('#g-hue'), steps: $('#g-steps'), stepsOut: $('#g-steps-out'),
  rev: $('#g-rev'), mirror: $('#g-mirror'), even: $('#g-even'), rand: $('#g-rand'),
  adjReset: $('#adj-reset'), presets: $('#presets'), pSave: $('#p-save'),
  shapes: $('#shapes'), dirs: $('#dirs'), sizePreset: $('#size-preset'), sizeSwap: $('#size-swap'), sizeHint: $('#size-hint'),
};

/* ---------- gradient list */
let listKey = '';
function renderList() {
  const key = state.grads.map((g) => g.id + ':' + g.name).join('|');
  if (key !== listKey) {
    listKey = key;
    pn.list.textContent = '';
    state.grads.forEach((g, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'gitem'; b.dataset.id = g.id;
      const n = document.createElement('span'); n.className = 'gi'; n.textContent = i + 1;
      const c = mk(128, 36);
      const name = document.createElement('span'); name.className = 'gn'; name.textContent = g.name;
      b.append(n, c, name);
      li.appendChild(b);
      pn.list.appendChild(li);
    });
  }
  for (const b of pn.list.querySelectorAll('.gitem')) {
    const g = state.grads.find((x) => x.id === +b.dataset.id);
    const on = g.id === state.sel;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-current', on ? 'true' : 'false');
    const c = b.querySelector('canvas'), k = lutKey(g);
    if (c.dataset.key !== k) { c.dataset.key = k; drawStrip(c, g, 6); }
  }
  pn.count.textContent = state.grads.length;
  const i = selIndex();
  pn.up.disabled = i === 0;
  pn.down.disabled = i === state.grads.length - 1;
  pn.del.disabled = state.grads.length <= 1;
  pn.add.disabled = pn.dup.disabled = state.grads.length >= MAX_GRADS;
}
pn.list.addEventListener('click', (e) => {
  const b = e.target.closest('.gitem');
  if (!b) return;
  state.sel = +b.dataset.id;
  fixSelection();
  schedule();
  autosave();
});
function addGradient(g, at = selIndex() + 1) {
  if (state.grads.length >= MAX_GRADS) { toast(`Up to ${MAX_GRADS} gradients.`); return; }
  state.grads.splice(at, 0, g);
  state.sel = g.id;
  fixSelection();
  commit(); schedule();
}
const nextName = () => { let n = state.grads.length + 1; while (state.grads.some((g) => g.name === `Gradient ${n}`)) n++; return `Gradient ${n}`; };
pn.add.addEventListener('click', () => addGradient(mkGradient(nextName(), randomStops())));
pn.dup.addEventListener('click', () => {
  const src = selGrad(), copy = gradIn(gradOut(src));
  copy.name = (src.name + ' copy').slice(0, 60);
  addGradient(copy);
});
pn.del.addEventListener('click', () => {
  if (state.grads.length <= 1) return;
  const i = selIndex();
  state.grads.splice(i, 1);
  state.sel = state.grads[Math.min(i, state.grads.length - 1)].id;
  fixSelection();
  commit(); schedule();
  toast('Gradient deleted. Ctrl+Z brings it back.');
});
function moveGradient(d) {
  const i = selIndex(), j = i + d;
  if (j < 0 || j >= state.grads.length) return;
  [state.grads[i], state.grads[j]] = [state.grads[j], state.grads[i]];
  commit(); schedule();
}
pn.up.addEventListener('click', () => moveGradient(-1));
pn.down.addEventListener('click', () => moveGradient(1));

/* ---------- interpolation and adjustments */
function renderGradSettings() {
  const g = selGrad();
  pn.space.value = g.space;
  pn.hue.value = g.hue;
  pn.hue.disabled = !has(HUE_AT, g.space);
  pn.steps.value = g.steps;
  pn.stepsOut.textContent = g.steps >= 2 ? g.steps : 'Smooth';
  for (const el of $$('[data-adj]')) {
    const k = el.dataset.adj, v = g.adj[k];
    el.value = v;
    $(`output[data-for="${k}"]`).textContent = k === 'hue' ? `${v > 0 ? '+' : ''}${v}°` : `${v}%`;
  }
  pn.adjReset.disabled = adjIsDefault(g.adj);
}
pn.space.addEventListener('change', () => { selGrad().space = pn.space.value; commit(); schedule(); });
pn.hue.addEventListener('change', () => { selGrad().hue = pn.hue.value; commit(); schedule(); });
pn.steps.addEventListener('input', () => {
  const v = +pn.steps.value;
  selGrad().steps = v === 1 ? 0 : v;   // one step would be a flat color: treat it as smooth
  schedule();
});
pn.steps.addEventListener('change', () => commit());
pn.steps.addEventListener('dblclick', () => { selGrad().steps = 0; commit(); schedule(); });
pn.rev.addEventListener('click', () => { const g = selGrad(); g.stops = reversedStops(g.stops); commit(); schedule(); });
pn.mirror.addEventListener('click', () => {
  const g = selGrad();
  if (g.stops.length * 2 > MAX_STOPS) { toast('Too many stops to mirror.'); return; }
  g.stops = mirroredStops(g.stops);
  fixSelection(); commit(); schedule();
});
pn.even.addEventListener('click', () => {
  const g = selGrad(), n = g.stops.length;
  sortStops(g.stops).forEach((s, i) => { s.pos = roundTo(i / (n - 1), 5); });
  commit(); schedule();
});
function randomize() { const g = selGrad(); g.stops = randomStops(); fixSelection(); commit(); schedule(); }
pn.rand.addEventListener('click', randomize);

for (const el of $$('[data-adj]')) {
  const k = el.dataset.adj;
  el.addEventListener('input', () => { selGrad().adj[k] = +el.value; schedule(); });
  el.addEventListener('change', () => commit());
  el.addEventListener('dblclick', () => { selGrad().adj[k] = DEF_ADJ[k]; commit(); schedule(); });
}
pn.adjReset.addEventListener('click', () => { selGrad().adj = { ...DEF_ADJ }; commit(); schedule(); });

/* ---------- presets */
let presetKey = '';
function renderPresets() {
  const key = JSON.stringify(state.userPresets);
  if (key === presetKey) return;
  presetKey = key;
  pn.presets.textContent = '';
  const tile = (g, i, user) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'preset' + (user ? ' user' : '');
    b.dataset.i = i; b.dataset.user = user ? 1 : '';
    b.title = g.name;
    const c = mk(160, 32);
    drawStrip(c, g, 6);
    const n = document.createElement('span'); n.textContent = g.name;
    b.append(c, n);
    if (user) {
      const x = document.createElement('span');
      x.className = 'px'; x.textContent = '×'; x.title = 'Remove this preset'; x.setAttribute('role', 'button');
      b.appendChild(x);
    }
    pn.presets.appendChild(b);
  };
  PRESETS.forEach((p, i) => tile(presetGradient(p), i, false));
  state.userPresets.forEach((p, i) => { const g = gradIn(p); if (g) tile(g, i, true); });
}
pn.presets.addEventListener('click', (e) => {
  const b = e.target.closest('.preset');
  if (!b) return;
  const user = !!b.dataset.user, i = +b.dataset.i;
  if (user && e.target.closest('.px')) {
    const name = state.userPresets[i]?.name;
    state.userPresets.splice(i, 1);
    saveUserPresets(); renderPresets();
    toast(`Removed preset "${name}".`);
    return;
  }
  const src = user ? gradIn(state.userPresets[i]) : presetGradient(PRESETS[i]);
  if (!src) return;
  if (e.shiftKey) { addGradient(src); return; }
  const g = selGrad();
  // Apply the look, keep the name and adjustments of the gradient being edited.
  g.stops = src.stops; g.space = src.space; g.hue = src.hue; g.steps = src.steps;
  if (user) g.adj = src.adj;
  fixSelection(); commit(); schedule();
});
pn.pSave.addEventListener('click', () => {
  const g = gradOut(selGrad());
  if (state.userPresets.length >= 100) { toast('Up to 100 saved presets. Remove one first.'); return; }
  state.userPresets.push(g);
  saveUserPresets(); renderPresets();
  toast(`Saved "${g.name}" as a preset.`);
});

/* ---------- texture, shape, quality: inputs bound to state.out by data-out */
function readOut(el) {
  const k = el.dataset.out, spec = OUT_SPEC[k];
  if (spec === 'bool') return el.checked;
  if (spec === 'color') return el.value.toLowerCase();
  if (k === 'depth') return +el.value;
  if (typeof spec[0] === 'string') return el.value;
  const v = parseFloat(el.value);
  if (!Number.isFinite(v)) return state.out[k];
  return INT_OUT.has(k) ? Math.round(clamp(v, spec[0], spec[1])) : clamp(v, spec[0], spec[1]);
}
for (const el of $$('[data-out]')) {
  const k = el.dataset.out, live = el.type === 'range' || el.type === 'color';
  el.addEventListener(live ? 'input' : 'change', () => { state.out[k] = readOut(el); schedule(); if (!live) commit(); });
  if (live) el.addEventListener('change', () => commit());
  if (el.type === 'range') el.addEventListener('dblclick', () => { state.out[k] = DEF_OUT[k]; commit(); schedule(); });
}
pn.shapes.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shape]');
  if (b) { state.out.shape = b.dataset.shape; commit(); schedule(); }
});
pn.shapes.addEventListener('keydown', (e) => {
  const order = OUT_SPEC.shape, i = order.indexOf(state.out.shape);
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  state.out.shape = order[(i + d + order.length) % order.length];
  commit(); schedule();
  requestAnimationFrame(() => $(`[data-shape="${state.out.shape}"]`).focus());
});
pn.dirs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-angle]');
  if (b) { state.out.angle = +b.dataset.angle; commit(); schedule(); }
});
pn.sizePreset.addEventListener('change', () => {
  const [w, h] = pn.sizePreset.value.split('x').map(Number);
  pn.sizePreset.value = '';
  if (!w || !h) return;
  state.out.w = w; state.out.h = h;
  commit(); schedule();
});
pn.sizeSwap.addEventListener('click', () => { const o = state.out; [o.w, o.h] = [o.h, o.w]; commit(); schedule(); });

const OUT_FMT = {
  angle: (v) => `${fmt(v, 1)}°`, scale: (v) => `${fmt(v, 1)}%`, cx: (v) => `${fmt(v, 1)}%`, cy: (v) => `${fmt(v, 1)}%`,
};
function renderOutPanel() {
  const o = state.out, act = document.activeElement;
  for (const el of $$('[data-out]')) {
    const k = el.dataset.out;
    if (el.type === 'checkbox') el.checked = o[k];
    else if (el !== act || el.type === 'range') el.value = o[k];
  }
  for (const out of $$('output[data-for]')) {
    const k = out.dataset.for;
    if (has(OUT_FMT, k)) out.textContent = OUT_FMT[k](o[k]);
  }
  for (const b of pn.shapes.querySelectorAll('[data-shape]')) {
    const on = b.dataset.shape === o.shape;
    b.setAttribute('aria-checked', on);
    b.tabIndex = on ? 0 : -1;
  }
  const atlas = o.layout !== 'single' && state.grads.length > 1;
  const show = {
    pad: atlas || o.pot,
    circle: ['radial', 'diamond', 'square'].includes(o.shape),
    ends: o.shape === 'linear' || o.shape === 'reflect',
    dither: o.depth === 8,
    bg: o.bgOn,
  };
  for (const el of $$('[data-show]')) el.hidden = !show[el.dataset.show];
  $('[data-out="pad"]').disabled = !atlas;
  $('[data-size-label="w"]').textContent = o.layout === 'cols' ? 'Column width' : 'Width';
  $('[data-size-label="h"]').textContent = o.layout === 'rows' ? 'Row height' : 'Height';
}
