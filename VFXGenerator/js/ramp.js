'use strict';
// The color ramp editor: a bar with a handle per stop. Click the bar to add a stop, drag a handle
// to move it, drag it down off the bar (or press Delete) to remove it. The selected stop's color,
// alpha and position are edited below the bar.

const ramp = { sel: 0, barKey: '', drag: null, el: {} };
const rampStops = () => state.doc.color.ramp;

function initRamp(root) {
  const e = ramp.el;
  e.canvas = h('canvas', { width: 256, height: 1 });
  e.bar = h('div.ramp-bar', { title: 'Click to add a stop' }, e.canvas);
  e.handles = h('div.ramp-handles');
  e.color = h('input', { type: 'color', 'aria-label': 'Stop color' });
  e.hex = h('input.hex', { type: 'text', spellcheck: false, maxLength: 7, 'aria-label': 'Stop color as hex' });
  e.alpha = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Stop alpha' });
  e.alphaOut = h('output.mono');
  e.pos = h('input', { type: 'number', min: 0, max: 100, step: 0.1, 'aria-label': 'Stop position, percent' });
  e.del = h('button.btn.icon', { type: 'button', title: 'Delete this stop (Delete)', 'aria-label': 'Delete stop' }, icon('trash'));
  e.preset = h('select', { 'aria-label': 'Ramp presets' }, h('option', { value: '', text: 'Presets…' }),
    Object.keys(RAMP_PRESETS).map((k) => h('option', { value: k, text: k })));
  e.reverse = h('button.btn', { type: 'button', text: 'Reverse', title: 'Flip the ramp end to end' });
  e.fromImg = h('button.btn', { type: 'button', text: 'From image…', title: 'Use the colors across an image, such as a gradient PNG' });
  e.file = h('input', { type: 'file', accept: 'image/*', hidden: true });

  root.append(
    h('div.ramp-wrap', null, e.bar, e.handles),
    h('div.ramp-edit', null,
      h('div.colorrow', null, e.color, e.hex),
      h('label.mini', null, 'Alpha', e.alpha, e.alphaOut),
      h('label.mini', null, 'At', e.pos, '%'),
      e.del),
    h('div.ramp-tools', null, e.preset, e.reverse, e.fromImg, e.file));

  e.bar.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const r = e.bar.getBoundingClientRect(), p = +clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100).toFixed(1);
    const lut = rampLut(rampStops(), 101), i = Math.round(p) * 4;
    const stop = { p, c: rgbToHex(lut[i], lut[i + 1], lut[i + 2]), a: Math.round(lut[i + 3] * 100) };
    if (rampStops().length >= 64) return toast('A ramp can have up to 64 stops.');
    rampStops().push(stop);
    sortRamp(stop);
    changed(true);
  });

  e.handles.addEventListener('pointerdown', (ev) => {
    const hd = ev.target.closest('.ramp-handle');
    if (!hd || ev.button !== 0) return;
    ev.preventDefault();
    ramp.sel = +hd.dataset.i;
    const stop = rampStops()[ramp.sel];
    ramp.drag = { stop, y0: ev.clientY, moved: false, off: false };
    try { hd.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    hd.focus();
    changed();
  });
  e.handles.addEventListener('pointermove', (ev) => {
    const d = ramp.drag;
    if (!d) return;
    const r = e.bar.getBoundingClientRect();
    d.stop.p = +clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100).toFixed(1);
    d.off = ev.clientY - d.y0 > 28 && rampStops().length > 2;
    d.moved = true;
    sortRamp(d.stop);
    changed();
  });
  const endDrag = () => {
    const d = ramp.drag;
    if (!d) return;
    ramp.drag = null;
    if (d.off) removeStop(rampStops().indexOf(d.stop));
    changed(d.moved || d.off);
  };
  e.handles.addEventListener('pointerup', endDrag);
  e.handles.addEventListener('pointercancel', endDrag);
  e.handles.addEventListener('keydown', (ev) => {
    const hd = ev.target.closest('.ramp-handle');
    if (!hd) return;
    const stop = rampStops()[+hd.dataset.i], step = ev.shiftKey ? 10 : 1;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      stop.p = clamp(+(stop.p + (ev.key === 'ArrowLeft' ? -step : step)).toFixed(1), 0, 100);
      sortRamp(stop);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') removeStop(+hd.dataset.i);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    changed(true);
  });

  const cur = () => rampStops()[ramp.sel];
  e.color.addEventListener('input', () => { cur().c = e.color.value; changed(); });
  e.color.addEventListener('change', () => changed(true));
  e.hex.addEventListener('change', () => {
    const c = parseHex(e.hex.value);
    if (c) cur().c = c;
    changed(!!c);
  });
  e.alpha.addEventListener('input', () => { cur().a = +e.alpha.value; changed(); });
  e.alpha.addEventListener('change', () => changed(true));
  e.pos.addEventListener('change', () => {
    const v = parseFloat(e.pos.value);
    if (isNum(v)) { const s = cur(); s.p = clamp(+v.toFixed(1), 0, 100); sortRamp(s); }
    changed(true);
  });
  e.del.addEventListener('click', () => { removeStop(ramp.sel); changed(true); });
  e.preset.addEventListener('change', () => {
    const k = e.preset.value;
    e.preset.value = '';
    if (!has(RAMP_PRESETS, k)) return;
    state.doc.color.ramp = copyStops(RAMP_PRESETS[k]);
    ramp.sel = 0;
    changed(true);
  });
  e.reverse.addEventListener('click', () => {
    state.doc.color.ramp = sortStops(rampStops().map((s) => ({ ...s, p: +(100 - s.p).toFixed(1) })));
    ramp.sel = rampStops().length - 1 - ramp.sel;
    changed(true);
  });
  e.fromImg.addEventListener('click', () => e.file.click());
  e.file.addEventListener('change', () => {
    const f = e.file.files[0];
    e.file.value = '';
    if (f) rampFromImage(f);
  });
}

// Keeps stops in order after one moved; the selection follows that stop.
function sortRamp(stop) {
  state.doc.color.ramp = sortStops(rampStops());
  ramp.sel = rampStops().indexOf(stop);
}
function removeStop(i) {
  const s = rampStops();
  if (s.length <= 2 || i < 0) { if (i >= 0) toast('A ramp needs at least two stops.'); return; }
  s.splice(i, 1);
  ramp.sel = Math.min(i, s.length - 1);
}

// Samples across the middle of an image (down it, if it is taller than wide) and turns the
// colors into stops.
async function rampFromImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const across = bmp.width >= bmp.height, n = 256;
    const c = h('canvas', { width: across ? n : 1, height: across ? 1 : n });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    if (across) g.drawImage(bmp, 0, Math.floor(bmp.height / 2), bmp.width, 1, 0, 0, n, 1);
    else g.drawImage(bmp, Math.floor(bmp.width / 2), 0, 1, bmp.height, 0, 0, 1, n);
    bmp.close();
    const px = g.getImageData(0, 0, c.width, c.height).data, f = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) f[i] = px[i] / 255;
    state.doc.color.ramp = stopsFromSamples(f, n);
    if (state.doc.color.mode !== 'ramp') state.doc.color.mode = 'ramp';
    ramp.sel = 0;
    changed(true);
    toast(`Ramp made from ${file.name}: ${rampStops().length} stops.`);
  } catch (err) {
    console.error(err);
    toast(`Could not read ${file.name} as an image.`);
  }
}

function renderRamp() {
  const e = ramp.el, stops = rampStops();
  if (!e.bar) return;
  ramp.sel = clamp(ramp.sel, 0, stops.length - 1);
  const key = JSON.stringify(stops);
  if (key !== ramp.barKey) {
    ramp.barKey = key;
    const lut = rampLut(stops, 256), img = new ImageData(256, 1);
    for (let i = 0; i < 1024; i++) img.data[i] = Math.round(lut[i] * 255);
    e.canvas.getContext('2d').putImageData(img, 0, 0);
  }
  while (e.handles.children.length > stops.length) e.handles.lastChild.remove();
  while (e.handles.children.length < stops.length) {
    e.handles.append(h('button.ramp-handle', { type: 'button', title: 'Drag to move · drag down to remove' }, h('span')));
  }
  stops.forEach((s, i) => {
    const hd = e.handles.children[i];
    hd.dataset.i = i;
    hd.style.left = `${s.p}%`;
    hd.firstChild.style.background = s.c;
    hd.classList.toggle('sel', i === ramp.sel);
    hd.classList.toggle('off', !!ramp.drag && ramp.drag.off && ramp.drag.stop === s);
    hd.setAttribute('aria-label', `Stop at ${s.p} %, ${s.c}, alpha ${s.a} %`);
  });
  const s = stops[ramp.sel], focus = document.activeElement;
  if (focus !== e.color) e.color.value = s.c;
  if (focus !== e.hex) e.hex.value = s.c;
  if (focus !== e.alpha) e.alpha.value = s.a;
  e.alphaOut.textContent = `${s.a}%`;
  if (focus !== e.pos) e.pos.value = s.p;
  e.del.disabled = stops.length <= 2;
}
