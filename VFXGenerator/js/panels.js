'use strict';
// The side panels: setting rows built from the schemas, the layer list and the selected layer's
// settings on the left; presets, size, color, edge, flipbook and export on the right.

/* ---------- one settings row per schema entry */
// get() reads the current value, set(v, commit) writes it. visible() hides rows that do not apply.
function control(def, get, set, visible) {
  const type = def.type || 'range', id = `c-${uid()}`;
  const label = h('label', { for: id, text: def.label, title: def.hint || null });
  let el, sync;
  switch (type) {
    case 'check': {
      const box = h('input', { type: 'checkbox', id });
      box.addEventListener('change', () => set(box.checked, true));
      el = h('label.check', { title: def.hint || null }, box, h('span', { text: def.label }));
      sync = () => { box.checked = get(); };
      break;
    }
    case 'select': {
      const sel = h('select', { id }, def.options.map(([v, t]) => h('option', { value: String(v), text: t })));
      sel.addEventListener('change', () => {
        const o = def.options.find((x) => String(x[0]) === sel.value);
        if (o) set(o[0], true);
      });
      el = h('div.row', null, label, sel);
      sync = () => { sel.value = String(get()); };
      break;
    }
    case 'seed': {
      const num = h('input.num', { type: 'number', id, min: 0, max: 999999, step: 1 });
      const dice = h('button.btn.icon', { type: 'button', title: 'Random seed (R)', 'aria-label': 'Random seed' }, icon('dice'));
      num.addEventListener('change', () => {
        const v = parseInt(num.value, 10);
        if (isNum(v)) set(clamp(v, 0, 999999), true); else sync();
      });
      dice.addEventListener('click', () => set(Math.floor(Math.random() * 1e6), true));
      el = h('div.row', null, label, h('div.seedrow', null, num, dice));
      sync = () => { if (document.activeElement !== num) num.value = get(); };
      break;
    }
    case 'number': {
      const num = h('input.num', { type: 'number', id, min: def.min, max: def.max, step: def.step || 1 });
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        if (isNum(v)) set(cleanVal(def, v), true); else sync();
      });
      el = h('div.row', null, label, h('span.numbox', null, num, def.unit && h('span.unit', { text: def.unit })));
      sync = () => { if (document.activeElement !== num) num.value = get(); };
      break;
    }
    default: {
      // A slider plus a number box. Log sliders spread wide ranges (0.2 .. 8) evenly by ratio.
      const step = def.step || 1, log = !!def.log;
      const toPos = (v) => (log ? (Math.log(v / def.min) / Math.log(def.max / def.min)) * 1000 : v);
      const fromPos = (p) => (log ? def.min * Math.pow(def.max / def.min, p / 1000) : p);
      const fix = (v) => +clamp(v, def.min, def.max).toFixed(decimalsOf(step));
      const range = h('input', { type: 'range', id, min: log ? 0 : def.min, max: log ? 1000 : def.max, step: log ? 1 : step });
      const num = h('input.num', { type: 'number', min: def.min, max: def.max, step, 'aria-label': `${def.label}, value` });
      let dragging = false;
      range.addEventListener('pointerdown', () => { dragging = true; });
      range.addEventListener('pointerup', () => { dragging = false; });
      range.addEventListener('input', () => { set(fix(fromPos(+range.value)), false); });
      range.addEventListener('change', () => { dragging = false; set(fix(fromPos(+range.value)), true); });
      range.addEventListener('dblclick', () => set(def.def, true));
      range.title = `${def.hint ? `${def.hint}. ` : ''}Double-click to reset`;
      num.addEventListener('input', () => {
        const v = parseFloat(num.value);
        if (isNum(v) && v >= def.min && v <= def.max) set(fix(v), false);
      });
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        set(isNum(v) ? fix(v) : get(), true);
        num.value = fmtNum(get(), step);
      });
      el = h('div.sl', null, label, range, h('span.numbox', null, num, def.unit && h('span.unit', { text: def.unit })));
      sync = () => {
        const v = get();
        if (!dragging) range.value = toPos(v);
        if (document.activeElement !== num) num.value = fmtNum(v, step);
      };
    }
  }
  return {
    el,
    sync() {
      const vis = !visible || visible();
      el.hidden = !vis;
      if (vis) sync();
    },
  };
}

// Rows for a whole schema. obj() returns the object holding the values (looked up fresh, since
// undo replaces the document); ctx() returns [doc, layer] for the show() rules.
function controls(defs, obj, ctx = () => [state.doc, null]) {
  return defs.map((def) => control(def,
    () => obj()[def.k],
    (v, commit) => { const o = obj(); if (!o) return; o[def.k] = v; changed(commit); },
    def.show ? () => { const o = obj(); return !!o && def.show(o, ...ctx()); } : null));
}

/* ---------- thumbnails, drawn a few at a time when the page is idle */
const thumbQueue = new Map();   // canvas -> function returning [doc, w, h, frame]
let thumbTimer = 0;
function queueThumb(canvas, make) {
  thumbQueue.set(canvas, make);
  if (!thumbTimer) thumbTimer = setTimeout(drawThumbs, 30);
}
function drawThumbs() {
  thumbTimer = 0;
  const t0 = performance.now();
  for (const [canvas, make] of thumbQueue) {
    thumbQueue.delete(canvas);
    if (!canvas.isConnected) continue;
    try {
      const [doc, w, h, at] = make(), res = runSync(renderDoc(doc, { w, h, ss: 2, single: true, at }));
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').putImageData(new ImageData(to8(res, false, false), w, h), 0, 0);
    } catch (err) { console.error(err); }
    if (performance.now() - t0 > 12) break;
  }
  if (thumbQueue.size) thumbTimer = setTimeout(drawThumbs, 16);
}
// Thumbnail size keeping the frame's aspect inside a box of `box` pixels.
function fitBox(w, h, box) {
  const k = box / Math.max(w, h);
  return [Math.max(4, Math.round(w * k)), Math.max(4, Math.round(h * k))];
}

/* ---------- layer list */
const lst = { key: '', thumbs: new Map() };   // thumbs: layer id -> what was last drawn

function renderLayers() {
  const doc = state.doc, list = $('#layer-list'), order = doc.layers.slice().reverse();   // top layer first
  const key = order.map((L) => L.id).join();
  if (key !== lst.key) {
    lst.key = key;
    list.replaceChildren(...order.map((L) => h('li.layer', { dataset: { id: L.id } },
      h('button.lmain', { type: 'button' }, h('span.lthumb', null, h('canvas')), h('span.ltext', null, h('span.lname'), h('span.ltype'))),
      h('button.ibtn.eye', { type: 'button' }))));
  }
  $('#layer-empty').hidden = doc.layers.length > 0;
  for (const li of list.children) {
    const L = doc.layers.find((x) => x.id === li.dataset.id);
    if (!L) continue;
    const g = GEN[L.type], eye = li.querySelector('.eye');
    li.classList.toggle('sel', L.id === state.sel);
    li.classList.toggle('off', !L.on);
    li.querySelector('.lmain').setAttribute('aria-pressed', L.id === state.sel);
    li.querySelector('.lname').textContent = L.name;
    const blend = LAYER_DEFS[0].options.find((o) => o[0] === L.blend)[1].replace(/ \(.*/, '');
    li.querySelector('.ltype').textContent = doc.color.mode === 'pack'
      ? `${g.label} · ${L.ch.toUpperCase()}` : `${g.label} · ${blend}${L.opacity < 100 ? ` ${L.opacity}%` : ''}`;
    if (eye.dataset.on !== String(L.on)) {
      eye.dataset.on = L.on;
      eye.replaceChildren(icon(L.on ? 'eye' : 'eyeOff'));
      eye.setAttribute('aria-label', L.on ? `Hide ${L.name}` : `Show ${L.name}`);
      eye.title = L.on ? 'Hide layer (H)' : 'Show layer (H)';
    }
    // The layer drawn alone, white on dark, at the frame's aspect.
    const tkey = JSON.stringify([doc.w, doc.h, L.type, L.p, L.x, L.y, L.scale, L.stretch, L.rot, L.invert]);
    if (lst.thumbs.get(L.id) !== tkey) {
      lst.thumbs.set(L.id, tkey);
      const canvas = li.querySelector('canvas');
      queueThumb(canvas, () => {
        const d = state.doc, [w, hh] = fitBox(d.w, d.h, 44);
        return [{ ...d, color: { ...d.color, mode: 'alpha', gain: 100, gamma: 1 }, edge: { mode: 'off', width: 0 }, anim: { ...d.anim, on: false },
          layers: [{ ...L, on: true, opacity: 100, blend: 'add' }] }, w, hh];
      });
    }
  }
}

function initLayerList() {
  const list = $('#layer-list');
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.layer');
    if (!li) return;
    if (e.target.closest('.eye')) { toggleLayer(li.dataset.id); return; }
    selectLayer(li.dataset.id);
  });
  list.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.layer');
    if (!li || e.target.closest('.eye')) return;
    selectLayer(li.dataset.id);
    requestAnimationFrame(() => { const n = $('#layer-name'); if (n) { n.focus(); n.select(); } });
  });

  const menu = $('#add-menu'), addBtn = $('#l-add');
  menu.replaceChildren(...GEN_ORDER.map((t) => h('button.menu-item', { type: 'button', role: 'menuitem', dataset: { type: t } },
    h('strong', { text: GEN[t].label }), h('span', { text: GEN[t].hint }))));
  const close = () => { menu.hidden = true; addBtn.setAttribute('aria-expanded', 'false'); };
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    addBtn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('button').focus();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    close();
    addLayer(b.dataset.type);
  });
  menu.addEventListener('keydown', (e) => {
    const items = $$('.menu-item', menu), i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); addBtn.focus(); }
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== addBtn) close(); });

  $('#l-dup').addEventListener('click', dupLayer);
  $('#l-up').addEventListener('click', () => moveLayer(1));
  $('#l-down').addEventListener('click', () => moveLayer(-1));
  $('#l-del').addEventListener('click', deleteLayer);
}

/* ---------- layer operations */
function addLayer(type) {
  const d = state.doc;
  if (d.layers.length >= MAX_LAYERS) { toast(`Up to ${MAX_LAYERS} layers.`); return; }
  const L = makeLayer(type);
  if (d.color.mode === 'pack') {
    const used = new Set(d.layers.map((x) => x.ch));
    L.ch = ['r', 'g', 'b', 'a'].find((c) => !used.has(c)) || 'r';
  }
  const i = selIndex();
  d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L);
  state.sel = L.id;
  changed(true);
}
function dupLayer() {
  const d = state.doc, i = selIndex();
  if (i < 0) return;
  if (d.layers.length >= MAX_LAYERS) { toast(`Up to ${MAX_LAYERS} layers.`); return; }
  const c = JSON.parse(JSON.stringify(d.layers[i]));
  c.id = uid();
  c.name = `${c.name} copy`.slice(0, 40);
  d.layers.splice(i + 1, 0, c);
  state.sel = c.id;
  changed(true);
}
// dir +1 moves the layer up (drawn later, over the others).
function moveLayer(dir) {
  const d = state.doc, i = selIndex(), j = i + dir;
  if (i < 0 || j < 0 || j >= d.layers.length) return;
  [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
  changed(true);
}
function deleteLayer() {
  const d = state.doc, i = selIndex();
  if (i < 0) return;
  d.layers.splice(i, 1);
  state.sel = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null;
  changed(true);
}
function toggleLayer(id) {
  const L = state.doc.layers.find((x) => x.id === id);
  if (!L) return;
  L.on = !L.on;
  changed(true);
}

/* ---------- selected layer's settings */
const lp = { key: '', ctrls: [] };

function renderLayerPanel() {
  const L = selLayer(), root = $('#layer-props'), animOn = state.doc.anim.on;
  const key = L ? `${L.id}|${L.type}|${animOn}` : '';
  if (key !== lp.key) {
    lp.key = key;
    lp.ctrls = [];
    root.replaceChildren();
    if (L) buildLayerPanel(root, L.id, L.type, animOn);
  }
  for (const c of lp.ctrls) c.sync();
  const name = $('#layer-name');
  if (L && name && document.activeElement !== name) name.value = L.name;
}

function buildLayerPanel(root, id, type, animOn) {
  const g = GEN[type], cur = () => state.doc.layers.find((x) => x.id === id);
  const ctx = () => [state.doc, cur()];
  const section = (title, extra, ...kids) => h('section.sec', null, h('div.sec-head', null, h('h2', { text: title }), extra), ...kids);
  const rows = (list) => { lp.ctrls.push(...list); return list.map((c) => c.el); };

  const name = h('input.name', { id: 'layer-name', type: 'text', maxLength: 40, spellcheck: false, 'aria-label': 'Layer name' });
  name.addEventListener('input', () => { const L = cur(); if (L) { L.name = name.value.trim() || g.label; changed(); } });
  name.addEventListener('change', () => changed(true));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

  root.append(section(g.label, null,
    name,
    h('p.hint', { text: g.hint }),
    rows(controls(g.params, () => cur() && cur().p, ctx))));

  root.append(section('Blend', null, rows(controls(LAYER_DEFS, cur, ctx))));

  if (!g.full) {
    const reset = h('button.chip', { type: 'button', text: 'Reset', title: 'Back to the center, no scale, stretch or rotation' });
    reset.addEventListener('click', () => {
      const L = cur();
      if (L) { Object.assign(L, defaultsOf(XFORM_DEFS)); changed(true); }
    });
    root.append(section('Placement', reset,
      rows(controls(XFORM_DEFS, cur, ctx)),
      h('p.hint', { text: 'Drag in the texture view to move the layer. Shift+drag turns it, Alt+drag scales it.' })));
  }

  if (animOn) {
    const reset = h('button.chip', { type: 'button', text: 'Reset', title: 'No motion for this layer' });
    reset.addEventListener('click', () => {
      const L = cur();
      if (L) { L.a = defaultsOf(MOTION_DEFS); changed(true); }
    });
    root.append(section('Motion', reset,
      rows(controls(MOTION_DEFS, () => cur() && cur().a, ctx)),
      h('p.hint', { text: 'Values at the first and last frame of the flipbook, for this layer.' })));
  }
}

/* ---------- document settings (right side) */
const dp = { ctrls: [] };

function initDocPanel() {
  const add = (sel, list) => { dp.ctrls.push(...list); $(sel).append(...list.map((c) => c.el)); };
  const d = () => state.doc;

  add('#size-ctrls', controls(SIZE_DEFS, d));
  $('#size-chips').append(...[64, 128, 256, 512, 1024, 2048].map((n) => {
    const b = h('button.chip', { type: 'button', text: String(n), title: `${n} × ${n} px` });
    b.addEventListener('click', () => { state.doc.w = state.doc.h = n; changed(true); });
    return b;
  }));
  add('#color-ctrls', controls(COLOR_DEFS, () => d().color));
  add('#edge-ctrls', controls(EDGE_DEFS, () => d().edge));
  add('#anim-ctrls', controls(ANIM_DEFS, () => d().anim));
  add('#out-ctrls', controls(OUT_DEFS, () => d().out));
}

function renderDocPanel(info) {
  for (const c of dp.ctrls) c.sync();
  const doc = state.doc, sh = sheetOf(doc), mode = doc.color.mode;
  $('#ramp').hidden = mode !== 'ramp';
  $('#color-hint').textContent = {
    alpha: 'White everywhere, with the shape in alpha: tint it in the engine. The usual choice for particles.',
    gray: 'Brightness in the color, no transparency: for additive materials, or as a mask.',
    ramp: 'Brightness picks a color from the ramp. Dark ends of the ramp suit additive blending.',
    pack: 'Each layer goes into the channel picked in its Blend settings. Channels with no layers stay black (alpha: opaque).',
  }[mode];

  const anim = $('#anim-info');
  anim.hidden = !doc.anim.on;
  if (doc.anim.on) {
    anim.textContent = `${sh.n} frames in ${sh.cols} × ${sh.rows} · sheet ${sh.sw} × ${sh.sh} px`;
    anim.classList.toggle('warn', sheetTooBig(sh));
    if (sheetTooBig(sh)) anim.textContent += ` · over ${MAX_SHEET} px, make the frames smaller`;
  }

  const edge = $('#edge-info');
  if (info && info.border >= 0) {
    const pct = Math.round(info.border * 100), bad = info.border > 1 / 255;
    edge.hidden = false;
    edge.classList.toggle('warn', bad);
    edge.textContent = bad
      ? `Pixels at the frame edge reach ${pct || '<1'} %, so the square may show in game. Raise the edge fade, or shrink the layers.`
      : 'The frame edges are fully transparent.';
  } else edge.hidden = true;

  $('#ex-note').textContent = doc.anim.on
    ? `Flipbook: ${sh.cols} columns × ${sh.rows} rows, ${sh.n} frames (Unity: Texture Sheet Animation, Tiles X ${sh.cols}, Y ${sh.rows}). The PNG keeps its settings; open it here again to edit.`
    : 'The PNG keeps its settings. Open it here again to keep editing.';
}

/* ---------- presets */
function renderPresets() {
  const grid = $('#presets'), base = state.doc;
  const tile = (name, title, make, onPick, onDelete) => {
    const canvas = h('canvas');
    const b = h('button.preset', { type: 'button', title }, h('span.pthumb', null, canvas), h('span.pname', { text: name }));
    b.addEventListener('click', (e) => onPick(e.shiftKey));
    queueThumb(canvas, () => {
      // Animated presets show a frame a third of the way in, where most have taken shape.
      const d = make(), [w, hh] = fitBox(d.w, d.h, 72);
      return [d, w, hh, d.anim.on ? Math.round(d.anim.frames / 3) : 0];
    });
    if (!onDelete) return b;
    const del = h('button.pdel', { type: 'button', title: `Delete ${name}`, 'aria-label': `Delete preset ${name}`, text: '×' });
    del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
    return h('div.pwrap', null, b, del);
  };
  const pick = (make) => (append) => {
    const d = make();
    if (append) appendLayers(d.layers);
    else setDoc(d);
  };
  const hint = 'Click to open · Shift+click to add its layers to the current texture';
  const tiles = PRESETS.map((pr) => {
    const make = () => presetDoc(pr, state.doc);
    return tile(pr.name, hint, () => presetDoc(pr, base), pick(make));
  });
  const mine = userPresets().map((up) => {
    const make = () => userPresetDoc(up.doc, state.doc);
    return tile(up.name, `${hint} (saved in this browser)`, () => userPresetDoc(up.doc, base), pick(make), () => {
      deleteUserPreset(up.name);
      renderPresets();
      toast(`Deleted preset ${up.name}.`);
    });
  });
  grid.replaceChildren(...tiles, ...(mine.length ? [h('div.pdiv', { text: 'Saved in this browser' }), ...mine] : []));
}

function appendLayers(layers) {
  const d = state.doc, room = MAX_LAYERS - d.layers.length;
  if (room <= 0) { toast(`Up to ${MAX_LAYERS} layers.`); return; }
  const add = layers.slice(0, room).map((L) => ({ ...JSON.parse(JSON.stringify(L)), id: uid() }));
  d.layers.push(...add);
  state.sel = add[add.length - 1].id;
  changed(true);
  if (add.length < layers.length) toast(`Added ${add.length} of ${layers.length} layers (up to ${MAX_LAYERS}).`);
}
