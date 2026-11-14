'use strict';
// Transform tab: resize, crop (with the box on the image), trim, rotate / flip, canvas size.
// Each step replaces the image and is one undo step.

const crop = { on: false, x: 0, y: 0, w: 0, h: 0, aspect: 0 };   // aspect: width / height, 0 = free
let toolsBaseId = 0, csAnchor = [1, 1];

const tl = {
  rsW: $('#rs-w'), rsH: $('#rs-h'), rsLock: $('#rs-lock'), rsFilter: $('#rs-filter'), rsApply: $('#rs-apply'),
  crEdit: $('#cr-edit'), crAspect: $('#cr-aspect'), crApply: $('#cr-apply'), crCancel: $('#cr-cancel'),
  trMode: $('#tr-mode'), trTol: $('#tr-tol'), trTolOut: $('#tr-tol-out'), trPad: $('#tr-pad'), trApply: $('#tr-apply'),
  roAngle: $('#ro-angle'), roOut: $('#ro-angle-out'), roExpand: $('#ro-expand'), roSmooth: $('#ro-smooth'), roApply: $('#ro-apply'),
  csW: $('#cs-w'), csH: $('#cs-h'), csFill: $('#cs-fill'), csColor: $('#cs-color'), csColorRow: $('#cs-color-row'), csApply: $('#cs-apply'),
};
const intIn = (el) => { const v = Math.round(parseFloat(el.value)); return Number.isFinite(v) ? v : 0; };
const sideOk = (v) => v >= 1 && v <= MAX_SIDE;
const pot = (v) => clamp(2 ** Math.round(Math.log2(Math.max(1, v))), 1, MAX_SIDE);
const potUp = (v) => clamp(2 ** Math.ceil(Math.log2(Math.max(1, v))), 1, MAX_SIDE);

// Called on every render: when the image changed (opened, transformed, undone), the forms start
// again from its size and the crop box covers all of it.
function syncTools() {
  const img = state.base;
  if (img && img.id !== toolsBaseId) {
    toolsBaseId = img.id;
    tl.rsW.value = tl.csW.value = img.w;
    tl.rsH.value = tl.csH.value = img.h;
    Object.assign(crop, { x: 0, y: 0, w: img.w, h: img.h });
    if (crop.aspect) setCropRect(fitAspect(img.w / 2, img.h / 2, 0, 0, img.w, img.h, crop.aspect, img.w, img.h));
    for (const k of ['x', 'y', 'w', 'h']) { $(`[data-crop="${k}"]`).max = k === 'x' || k === 'w' ? img.w : img.h; }
  }
  for (const b of $$('#pan-transform button')) b.disabled = !img;
  tl.crEdit.setAttribute('aria-pressed', String(crop.on));
  syncCropInputs();
  tl.roOut.textContent = `${+tl.roAngle.value}°`;
  tl.trTolOut.textContent = tl.trTol.value;
  tl.csColorRow.hidden = tl.csFill.value !== 'color';
  for (const b of $$('#cs-anchor button')) b.setAttribute('aria-checked', String(b.dataset.a === csAnchor.join(',')));
}
function syncCropInputs() {
  for (const k of ['x', 'y', 'w', 'h']) {
    const el = $(`[data-crop="${k}"]`);
    if (el !== document.activeElement) el.value = crop[k];
  }
}

// Runs a transform on the image. Large images get a "Working…" note first, since it blocks briefly.
async function applyTransform(fn, msg) {
  const img = state.base;
  if (!img) return;
  try {
    if (img.w * img.h > 4e6) { toast('Working…'); await nextPaint(); }
    const out = fn(img);
    if (!out || out === img) return;
    state.base = out;
    if (out.w !== img.w || out.h !== img.h) view.fit = true;
    commit(); schedule();
    if (msg) toast(msg(out));
  } catch (err) {
    console.error(err);
    toast(`Failed: ${err.message || err}`);
  }
}
const sizeMsg = (verb) => (o) => `${verb} to ${o.w} × ${o.h}.`;

/* ---------- resize */
tl.rsW.addEventListener('input', () => {
  if (tl.rsLock.getAttribute('aria-pressed') === 'true' && state.base) tl.rsH.value = Math.max(1, Math.round((intIn(tl.rsW) * state.base.h) / state.base.w));
});
tl.rsH.addEventListener('input', () => {
  if (tl.rsLock.getAttribute('aria-pressed') === 'true' && state.base) tl.rsW.value = Math.max(1, Math.round((intIn(tl.rsH) * state.base.w) / state.base.h));
});
tl.rsLock.addEventListener('click', () => {
  tl.rsLock.setAttribute('aria-pressed', String(tl.rsLock.getAttribute('aria-pressed') !== 'true'));
});
for (const chip of $$('[data-rs]')) {
  chip.addEventListener('click', () => {
    const img = state.base;
    if (!img) return;
    const k = chip.dataset.rs;
    tl.rsW.value = k === 'pot' ? pot(img.w) : clamp(Math.round(img.w * k), 1, MAX_SIDE);
    tl.rsH.value = k === 'pot' ? pot(img.h) : clamp(Math.round(img.h * k), 1, MAX_SIDE);
  });
}
tl.rsApply.addEventListener('click', () => {
  const w = intIn(tl.rsW), h = intIn(tl.rsH), img = state.base;
  if (!img) return;
  if (!sideOk(w) || !sideOk(h)) { toast(`Width and height must be 1 to ${MAX_SIDE} px.`); return; }
  if (w === img.w && h === img.h) { toast(`The image is already ${w} × ${h}.`); return; }
  applyTransform((i) => resize(i, w, h, tl.rsFilter.value, state.p.wrap), sizeMsg('Resized'));
});

/* ---------- crop */
function setCropRect(r) {
  const img = state.base;
  if (!img) return;
  const x = clamp(Math.round(r.x), 0, img.w - 1), y = clamp(Math.round(r.y), 0, img.h - 1);
  const x2 = clamp(Math.round(r.x + r.w), x + 1, img.w), y2 = clamp(Math.round(r.y + r.h), y + 1, img.h);
  Object.assign(crop, { x, y, w: x2 - x, h: y2 - y });
  syncCropInputs();
  drawSoon();
}
function startCrop() {
  if (!state.base || crop.on) return;
  crop.on = true;
  if (state.view.tiled) { state.view.tiled = false; view.fit = true; savePrefs(); }
  schedule();
}
function cancelCrop() {
  const img = state.base;
  crop.on = false;
  if (img) Object.assign(crop, { x: 0, y: 0, w: img.w, h: img.h });
  schedule();
}
function applyCrop() {
  const img = state.base;
  if (!img) return;
  if (crop.x === 0 && crop.y === 0 && crop.w === img.w && crop.h === img.h) { toast('The crop box covers the whole image. Drag on the image to choose an area.'); startCrop(); return; }
  const { x, y, w, h } = crop;
  crop.on = false;
  applyTransform((i) => cropImg(i, x, y, w, h), sizeMsg('Cropped'));
}
tl.crEdit.addEventListener('click', () => (crop.on ? cancelCrop() : startCrop()));
tl.crApply.addEventListener('click', applyCrop);
tl.crCancel.addEventListener('click', cancelCrop);
tl.crAspect.addEventListener('change', () => {
  crop.aspect = parseFloat(tl.crAspect.value) || 0;
  const img = state.base;
  if (img && crop.aspect) {
    // Keep the box's center and fit the new shape around it.
    setCropRect(fitAspect(crop.x + crop.w / 2, crop.y + crop.h / 2, 0, 0, crop.w, crop.h, crop.aspect, img.w, img.h));
    startCrop();
  }
});
for (const el of $$('[data-crop]')) {
  el.addEventListener('input', () => {
    const img = state.base, v = intIn(el), key = el.dataset.crop;
    if (!img) return;
    const r = { ...crop, [key]: v };
    r.x = clamp(r.x, 0, img.w - 1); r.y = clamp(r.y, 0, img.h - 1);
    // With a fixed aspect, typing one side sets the other.
    if (crop.aspect && key === 'w') r.h = Math.round(r.w / crop.aspect);
    if (crop.aspect && key === 'h') r.w = Math.round(r.h * crop.aspect);
    r.w = clamp(r.w, 1, img.w - r.x); r.h = clamp(r.h, 1, img.h - r.y);
    Object.assign(crop, r);
    startCrop();
    drawSoon();
  });
  el.addEventListener('change', syncCropInputs);
}

/* ---------- trim */
tl.trTol.addEventListener('input', () => { tl.trTolOut.textContent = tl.trTol.value; });
tl.trApply.addEventListener('click', () => {
  const img = state.base;
  if (!img) return;
  const b = trimBounds(img, tl.trMode.value, intIn(tl.trTol)), pad = clamp(intIn(tl.trPad), 0, 1024);
  if (!b) { toast('Nothing would be left: every pixel counts as background.'); return; }
  const r = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  if (r.x === 0 && r.y === 0 && r.w === img.w && r.h === img.h) { toast('Nothing to trim.'); return; }
  if (!sideOk(r.w) || !sideOk(r.h)) { toast('That padding makes the image too large.'); return; }
  applyTransform((i) => cropImg(i, r.x, r.y, r.w, r.h), sizeMsg('Trimmed'));
});

/* ---------- rotate and flip */
const ROT = {
  ccw: [(i) => rotate90(i, false), 'Rotated 90° counter-clockwise.'],
  cw: [(i) => rotate90(i, true), 'Rotated 90° clockwise.'],
  180: [rotate180, 'Rotated 180°.'],
  fh: [flipH, 'Flipped horizontally.'],
  fv: [flipV, 'Flipped vertically.'],
};
for (const b of $$('[data-rot]')) {
  b.addEventListener('click', () => { const [fn, msg] = ROT[b.dataset.rot]; applyTransform(fn, () => msg); });
}
// The dashed preview outline the viewer draws while an angle is set.
function rotPreview() {
  const deg = parseFloat(tl.roAngle.value) || 0;
  return state.tab === 'transform' && deg !== 0 && state.base ? { deg, expand: tl.roExpand.checked } : null;
}
tl.roAngle.addEventListener('input', () => { tl.roOut.textContent = `${+tl.roAngle.value}°`; drawSoon(); });
tl.roAngle.addEventListener('dblclick', () => { tl.roAngle.value = 0; tl.roOut.textContent = '0°'; drawSoon(); });
tl.roExpand.addEventListener('change', () => drawSoon());   // drawSoon lives in app.js, loaded later
tl.roApply.addEventListener('click', () => {
  const deg = parseFloat(tl.roAngle.value) || 0;
  if (mod(deg, 360) === 0) { toast('Set an angle first.'); return; }
  applyTransform((i) => rotateFree(i, deg, tl.roExpand.checked, tl.roSmooth.checked), (o) => `Rotated ${deg}° (${o.w} × ${o.h}).`);
  tl.roAngle.value = 0;
  tl.roOut.textContent = '0°';
});

/* ---------- canvas size */
for (const b of $$('#cs-anchor button')) {
  b.addEventListener('click', () => { csAnchor = b.dataset.a.split(',').map(Number); syncTools(); });
}
tl.csFill.addEventListener('change', syncTools);
for (const chip of $$('[data-cs]')) {
  chip.addEventListener('click', () => {
    const img = state.base;
    if (!img) return;
    const k = chip.dataset.cs, m = Math.max(img.w, img.h);
    const [w, h] = k === 'square' ? [m, m] : k === 'pot' ? [potUp(img.w), potUp(img.h)] : [img.w + 4, img.h + 4];
    tl.csW.value = clamp(w, 1, MAX_SIDE); tl.csH.value = clamp(h, 1, MAX_SIDE);
  });
}
tl.csApply.addEventListener('click', () => {
  const img = state.base, w = intIn(tl.csW), h = intIn(tl.csH);
  if (!img) return;
  if (!sideOk(w) || !sideOk(h)) { toast(`Width and height must be 1 to ${MAX_SIDE} px.`); return; }
  if (w === img.w && h === img.h) { toast(`The canvas is already ${w} × ${h}.`); return; }
  const [ax, ay] = csAnchor, fill = tl.csFill.value, color = tl.csColor.value;
  applyTransform((i) => canvasSize(i, w, h, ax, ay, fill, color), sizeMsg('Canvas changed'));
});
