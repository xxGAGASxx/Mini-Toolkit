'use strict';
// Editor state, history, live rendering and all canvas interactions.

const MARGIN = 400;   // scrollable space around the page, in canvas units
const MIN_SIZE = 8;
const STORAGE = { doc: 'diagram-editor:autosave', prefs: 'diagram-editor:prefs', icons: 'diagram-editor:user-icons' };

function blankDoc() {
  return { name: 'Untitled diagram', canvas: { w: 1200, h: 800, bg: '#ffffff', transparent: false, grid: 20 }, elements: [], assets: {} };
}

const state = {
  doc: blankDoc(),
  sel: [],            // selected element ids
  zoom: 1,
  prefs: { grid: true, snapGrid: true, snapObjects: true },
  hoverId: null,      // box under the pointer (shows its snap points)
  drag: null,         // current pointer interaction
  guides: [],         // alignment guides while moving
  editingId: null,    // element whose text is being edited
  spaceDown: false,
  dirty: false,
};

const svg = $('#svg'), stage = $('#stage'), workspace = $('#workspace');
const layers = { defs: $('#defs'), page: $('#page'), elements: $('#elements'), overlay: $('#overlay') };

const els = () => state.doc.elements;
const byId = id => state.doc.elements.find(e => e.id === id);
const selected = () => state.sel.map(byId).filter(Boolean);
const isSelected = id => state.sel.includes(id);
const isIconOnly = el => el.type === 'box' && !!el.icon && !el.text && !el.image && el.shape === 'none';
const bboxOf = el => el.type === 'box' ? { x: el.x, y: el.y, w: el.w, h: el.h } : arrowGeom(el, byId).bbox;
const snapValue = v => { const g = state.doc.canvas.grid || 1; return Math.round(v / g) * g; };

function unionBox(boxes) {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}
const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
const contains = (r, b) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;

/* ---------- Assets (icons & images, stored once per document as data URLs) ---------- */

let userIcons = [];
const iconLibrary = () => [...(window.ICON_LIBRARY || []), ...userIcons];
const blobUrls = new Map();

function addAsset(dataURL) {
  const id = 'a' + hashString(dataURL);
  if (!state.doc.assets[id]) state.doc.assets[id] = dataURL;
  return id;
}
// Live canvas uses short blob: URLs so re-rendering never re-parses large data URLs.
function assetHref(id) {
  const src = state.doc.assets[id];
  if (!src) return '';
  if (!blobUrls.has(id)) blobUrls.set(id, URL.createObjectURL(dataURLToBlob(src)));
  return blobUrls.get(id);
}
function clearBlobUrls() {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
}
function usedAssets(list) {
  const out = {};
  for (const el of list) for (const k of ['icon', 'image']) if (el[k] && state.doc.assets[el[k]]) out[el[k]] = state.doc.assets[el[k]];
  return out;
}

/* ---------- History & autosave ---------- */

const history = { undo: [], redo: [], last: '' };
const snapshot = () => { const { name, canvas, elements } = state.doc; return JSON.stringify({ name, canvas, elements }); };

function resetHistory() {
  history.undo = [];
  history.redo = [];
  history.last = snapshot();
  updateChrome();
}
// Call after every finished user action; records an undo step if anything changed.
function commit() {
  const snap = snapshot();
  if (snap === history.last) return;
  history.undo.push(history.last);
  if (history.undo.length > 150) history.undo.shift();
  history.redo = [];
  history.last = snap;
  state.dirty = true;
  scheduleAutosave();
  updateChrome();
}
function restore(snap) {
  Object.assign(state.doc, JSON.parse(snap));
  history.last = snap;
  state.sel = state.sel.filter(id => byId(id));
  $('#docName').value = state.doc.name;
  applyZoom();
  buildPanel();
  render();
  scheduleAutosave();
  updateChrome();
}
function undo() {
  finishTextEdit();
  if (!history.undo.length) return;
  history.redo.push(history.last);
  restore(history.undo.pop());
}
function redo() {
  finishTextEdit();
  if (!history.redo.length) return;
  history.undo.push(history.last);
  restore(history.redo.pop());
}

let autosaveTimer = 0, autosaveWarned = false;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE.doc, serialize(false));
    } catch (e) {
      if (!autosaveWarned) toast('This diagram is too large for browser storage, so it is not autosaved. Use File › Save.');
      autosaveWarned = true;
    }
  }, 600);
}
function savePrefs() {
  try { localStorage.setItem(STORAGE.prefs, JSON.stringify(state.prefs)); } catch (e) { /* private mode */ }
}
function togglePref(key) {
  state.prefs[key] = !state.prefs[key];
  savePrefs();
  updateChrome();
  syncPanel(true);
  render();
}

/* ---------- Selection ---------- */

function setSelection(ids) {
  state.sel = [...new Set(ids)].filter(id => byId(id));
  buildPanel();
  updateChrome();
  render();
}

/* ---------- Rendering ---------- */

let frame = 0;
function render() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderNow(); });
}
function renderNow() {
  renderPage();
  renderElements();
  renderOverlay();
  syncPanel();
}

function applyZoom() {
  const { w, h } = state.doc.canvas, z = state.zoom;
  svg.setAttribute('viewBox', `${-MARGIN} ${-MARGIN} ${w + MARGIN * 2} ${h + MARGIN * 2}`);
  svg.setAttribute('width', fmt((w + MARGIN * 2) * z));
  svg.setAttribute('height', fmt((h + MARGIN * 2) * z));
  $('#zoomLabel').textContent = Math.round(z * 100) + '%';
}

let pageKey = '';
function renderPage() {
  const c = state.doc.canvas, z = state.zoom;
  const key = [c.w, c.h, c.bg, c.transparent, c.grid, state.prefs.grid, z].join('|');
  if (key === pageKey) return;
  pageKey = key;
  const g = Math.max(2, c.grid), major = g * 5, lw = fmt(1 / z);
  const dark = !c.transparent && luminance(c.bg) < 0.45;
  const minor = dark ? 'rgba(255,255,255,.07)' : 'rgba(30,50,80,.07)';
  const majorC = dark ? 'rgba(255,255,255,.15)' : 'rgba(30,50,80,.14)';
  layers.defs.innerHTML = `
    <pattern id="gridMinor" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M0 0h${g}v${lw}H0zM0 0h${lw}v${g}H0z" fill="${minor}"/></pattern>
    <pattern id="gridMajor" width="${major}" height="${major}" patternUnits="userSpaceOnUse"><rect width="${major}" height="${major}" fill="url(#gridMinor)"/><path d="M0 0h${major}v${lw}H0zM0 0h${lw}v${major}H0z" fill="${majorC}"/></pattern>
    <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#e6e9ee"/></pattern>
    <filter id="pageShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="${fmt(3 / z)}" stdDeviation="${fmt(10 / z)}" flood-color="#08121f" flood-opacity=".35"/></filter>`;
  layers.page.innerHTML = `<rect width="${c.w}" height="${c.h}" fill="${c.transparent ? 'url(#checker)' : esc(c.bg)}" filter="url(#pageShadow)"/>`
    + (state.prefs.grid ? `<rect width="${c.w}" height="${c.h}" fill="url(#gridMajor)"/>` : '');
}

// Keyed update: only elements whose markup changed are touched, moves only change a transform.
const nodeCache = new Map();
function renderElements() {
  const layer = layers.elements, ctx = { getEl: byId, href: assetHref, editing: state.editingId };
  els().forEach((el, i) => {
    let c = nodeCache.get(el.id);
    if (!c) {
      const g = document.createElementNS(SVGNS, 'g');
      g.dataset.id = el.id;
      c = { g, tf: null, html: null };
      nodeCache.set(el.id, c);
    }
    const tf = el.type === 'box' ? `translate(${fmt(el.x)},${fmt(el.y)})` : '';
    const html = el.type === 'box' ? boxMarkup(el, ctx) : arrowMarkup(el, ctx);
    if (c.tf !== tf) { tf ? c.g.setAttribute('transform', tf) : c.g.removeAttribute('transform'); c.tf = tf; }
    if (c.html !== html) { c.g.innerHTML = html; c.html = html; }
    if (layer.children[i] !== c.g) layer.insertBefore(c.g, layer.children[i] || null);
  });
  const live = new Set(els().map(e => e.id));
  for (const [id, c] of nodeCache) if (!live.has(id)) { c.g.remove(); nodeCache.delete(id); }
}

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

function renderOverlay() {
  const z = state.zoom, k = n => fmt(n / z), d = state.drag, out = [];
  const rect = (cls, b) => `<rect class="${cls}" x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}"/>`;
  const dot = (cls, p, r, attr = '') => `<circle class="${cls}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${k(r)}"${attr}/>`;

  // Selection outlines
  const handles = [];
  for (const el of selected()) {
    if (el.type === 'box') { out.push(rect('sel', el)); continue; }
    const G = arrowGeom(el, byId);
    out.push(`<path class="sel-arrow" d="${arrowPath(G)}" stroke-width="${fmt(el.strokeWidth + 8 / z)}"/>`);
    handles.push(dot('ep' + (el.start.id ? ' linked' : ''), G.start, 6, ` data-ep="${el.id}:start"`));
    G.ends.forEach((p, i) => handles.push(dot('ep' + (el.ends[i].id ? ' linked' : ''), p, 6, ` data-ep="${el.id}:e${i}"`)));
  }
  if (state.sel.length > 1) out.push(rect('group', unionBox(selected().map(bboxOf))));

  const one = state.sel.length === 1 && selected()[0];
  if (one && one.type === 'box' && !isIconOnly(one) && !state.editingId && (!d || d.type === 'resize')) {
    const s = 8 / z;
    for (const [key, [fx, fy]] of Object.entries(HANDLES)) {
      if ((key === 'n' || key === 's') && one.w * z < 36) continue;
      if ((key === 'e' || key === 'w') && one.h * z < 36) continue;
      handles.push(`<rect class="handle" data-handle="${key}" x="${fmt(one.x + one.w * fx - s / 2)}" y="${fmt(one.y + one.h * fy - s / 2)}" width="${fmt(s)}" height="${fmt(s)}" rx="${k(1.5)}"/>`);
    }
  }

  // Snap points: on the hovered (unselected) box, or on the link target while dragging an arrow end.
  // They are drawn below the handles so an arrow end sitting on a snap point can still be grabbed.
  if (d && d.type === 'endpoint' && d.target) {
    const t = d.target.el;
    out.push(rect('target', t));
    for (const p of snapPoints(t)) {
      const on = d.target.snap && dist(p, d.target.snap) < 0.5;
      out.push(dot('snap' + (on ? ' on' : ''), p, on ? 6 : 4.5));
    }
  } else if (!d && state.hoverId && !isSelected(state.hoverId) && !state.editingId && !state.spaceDown) {
    const el = byId(state.hoverId);
    if (el) snapPoints(el).forEach((p, i) => out.push(dot('snap', p, 5, ` data-snap="${el.id}:${i}"`)));
  }

  for (const g of state.guides) out.push(`<line class="guide" x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" x2="${fmt(g.x2)}" y2="${fmt(g.y2)}"/>`);
  if (d && d.type === 'marquee') out.push(rect('marquee', rectFrom(d.start, d.cur)));
  layers.overlay.innerHTML = out.join('') + handles.join('');
}

/* ---------- Zoom ---------- */

function toCanvas(e) {
  const r = svg.getBoundingClientRect();
  return P((e.clientX - r.left) / state.zoom - MARGIN, (e.clientY - r.top) / state.zoom - MARGIN);
}
function viewCenter() {
  const r = workspace.getBoundingClientRect();
  return toCanvas({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
}
// Keeps the canvas point under (cx, cy) in place while zooming.
function setZoom(z, cx, cy) {
  finishTextEdit();
  const r = workspace.getBoundingClientRect();
  if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const p = toCanvas({ clientX: cx, clientY: cy });
  state.zoom = clamp(z, 0.1, 5);
  applyZoom();
  const s = svg.getBoundingClientRect();
  workspace.scrollLeft += s.left + (p.x + MARGIN) * state.zoom - cx;
  workspace.scrollTop += s.top + (p.y + MARGIN) * state.zoom - cy;
  render();
}
function zoomFit() {
  finishTextEdit();
  const r = workspace.getBoundingClientRect(), { w, h } = state.doc.canvas;
  state.zoom = clamp(Math.min((r.width - 64) / w, (r.height - 64) / h), 0.1, 5);
  applyZoom();
  const s = svg.getBoundingClientRect();
  workspace.scrollLeft += s.left + (w / 2 + MARGIN) * state.zoom - (r.left + r.width / 2);
  workspace.scrollTop += s.top + (h / 2 + MARGIN) * state.zoom - (r.top + r.height / 2);
  render();
}

/* ---------- Pointer interactions ---------- */

workspace.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
workspace.addEventListener('dblclick', onDoubleClick);
workspace.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(state.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
}, { passive: false });

function onPointerDown(e) {
  const t = e.target;
  if (t.closest('.text-edit')) return;
  if (t === workspace && (e.offsetX >= workspace.clientWidth || e.offsetY >= workspace.clientHeight)) return; // scrollbar
  finishTextEdit();
  if (e.button === 1 || (e.button === 0 && state.spaceDown)) {
    e.preventDefault();
    state.drag = { type: 'pan', x: e.clientX, y: e.clientY, sl: workspace.scrollLeft, st: workspace.scrollTop };
    workspace.classList.add('grabbing');
    return;
  }
  if (e.button !== 0) return;
  const p = toCanvas(e);
  const handle = t.closest('[data-handle]'), ep = t.closest('[data-ep]'), snap = t.closest('[data-snap]');
  const node = t.closest('#elements > g[data-id]');
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;

  if (handle) {
    const el = selected()[0];
    state.drag = { type: 'resize', id: el.id, handle: handle.dataset.handle, orig: { x: el.x, y: el.y, w: el.w, h: el.h } };
  } else if (ep) {
    const [id, which] = ep.dataset.ep.split(':');
    state.drag = { type: 'endpoint', id, which, start: p };
  } else if (snap) { // drag a new arrow out of a snap point
    const [id, i] = snap.dataset.snap.split(':');
    const sp = snapPoints(byId(id))[+i];
    const a = makeArrow({ start: { id, ax: sp.ax, ay: sp.ay, x: sp.x, y: sp.y }, ends: [{ x: p.x, y: p.y }] });
    state.doc.elements.push(a);
    state.sel = [a.id];
    state.hoverId = null;
    state.drag = { type: 'endpoint', id: a.id, which: 'e0', start: p, created: true };
  } else if (node) {
    const id = node.dataset.id;
    if (additive) {
      if (isSelected(id)) { setSelection(state.sel.filter(s => s !== id)); return; }
      state.sel = [...state.sel, id];
    } else if (!isSelected(id)) state.sel = [id];
    buildPanel();
    state.drag = startMove(p);
  } else {
    if (!additive && state.sel.length) { state.sel = []; buildPanel(); }
    state.drag = { type: 'marquee', start: p, cur: p, base: additive ? [...state.sel] : [] };
  }
  updateChrome();
  render();
}

function onPointerMove(e) {
  const d = state.drag;
  if (!d) return updateHover(e);
  if (d.type === 'pan') {
    workspace.scrollLeft = d.sl - (e.clientX - d.x);
    workspace.scrollTop = d.st - (e.clientY - d.y);
    return;
  }
  const p = toCanvas(e);
  if (d.type === 'move') doMove(d, p, e);
  else if (d.type === 'resize') doResize(d, p, e);
  else if (d.type === 'endpoint') doEndpoint(d, p, e);
  else if (d.type === 'marquee') {
    d.cur = p;
    const r = rectFrom(d.start, p);
    state.sel = [...new Set([...d.base, ...els().filter(el => contains(r, bboxOf(el))).map(el => el.id)])];
  }
  render();
}

function onPointerUp() {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  state.guides = [];
  workspace.classList.remove('grabbing');
  if (d.type === 'pan') return;
  if (d.type === 'endpoint' && d.created && !d.moved) { // a click on a snap point, not a drag
    state.doc.elements = els().filter(el => el.id !== d.id);
    state.sel = [];
  }
  if (d.type === 'marquee' || d.created) buildPanel();
  commit();
  updateChrome();
  render();
}

function updateHover(e) {
  const t = e.target;
  let id = null;
  if (t && t.closest) {
    if (t.closest('[data-snap]')) id = state.hoverId;
    else {
      const node = t.closest('#elements > g[data-id]'), el = node && byId(node.dataset.id);
      if (el && el.type === 'box') id = el.id;
    }
  }
  if (id !== state.hoverId) { state.hoverId = id; render(); }
}

function startMove(p) {
  const orig = {};
  for (const el of selected()) {
    orig[el.id] = el.type === 'box' ? { x: el.x, y: el.y } : { start: { ...el.start }, ends: el.ends.map(q => ({ ...q })) };
  }
  const boxes = selected().filter(el => el.type === 'box');
  return { type: 'move', start: p, orig, bbox: boxes.length ? unionBox(boxes) : null, moved: false };
}

function doMove(d, p, e) {
  let dx = p.x - d.start.x, dy = p.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * state.zoom < 3) return;
  d.moved = true;
  ({ dx, dy } = snapMove(d.bbox, dx, dy, e.altKey));
  for (const el of selected()) {
    const o = d.orig[el.id];
    if (!o) continue;
    if (el.type === 'box') { el.x = o.x + dx; el.y = o.y + dy; continue; }
    const shift = (ep, oe) => { if (!ep.id) { ep.x = oe.x + dx; ep.y = oe.y + dy; } };
    shift(el.start, o.start);
    el.ends.forEach((ep, i) => shift(ep, o.ends[i]));
  }
}

// Snaps a move: edges/centers to other elements and the page first, then the grid.
function snapMove(bb, dx, dy, off) {
  state.guides = [];
  if (off) return { dx, dy };
  if (!bb) return state.prefs.snapGrid ? { dx: snapValue(dx), dy: snapValue(dy) } : { dx, dy };
  let bx = null, by = null;
  if (state.prefs.snapObjects) {
    const tol = 6 / state.zoom, c = state.doc.canvas;
    const targets = els().filter(o => o.type === 'box' && !isSelected(o.id)).concat({ x: 0, y: 0, w: c.w, h: c.h });
    const nx = bb.x + dx, ny = bb.y + dy;
    for (const o of targets) {
      for (const tv of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mv of [nx, nx + bb.w / 2, nx + bb.w]) {
        const diff = tv - mv;
        if (Math.abs(diff) <= tol && (!bx || Math.abs(diff) < Math.abs(bx.diff))) bx = { diff, v: tv, o };
      }
      for (const tv of [o.y, o.y + o.h / 2, o.y + o.h]) for (const mv of [ny, ny + bb.h / 2, ny + bb.h]) {
        const diff = tv - mv;
        if (Math.abs(diff) <= tol && (!by || Math.abs(diff) < Math.abs(by.diff))) by = { diff, v: tv, o };
      }
    }
    if (bx) dx += bx.diff;
    if (by) dy += by.diff;
  }
  if (state.prefs.snapGrid) {
    if (!bx) dx = snapValue(bb.x + dx) - bb.x;
    if (!by) dy = snapValue(bb.y + dy) - bb.y;
  }
  const nb = { x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h };
  if (bx) state.guides.push({ x1: bx.v, y1: Math.min(nb.y, bx.o.y), x2: bx.v, y2: Math.max(nb.y + nb.h, bx.o.y + bx.o.h) });
  if (by) state.guides.push({ x1: Math.min(nb.x, by.o.x), y1: by.v, x2: Math.max(nb.x + nb.w, by.o.x + by.o.w), y2: by.v });
  return { dx, dy };
}

function doResize(d, p, e) {
  const el = byId(d.id);
  if (!el) return;
  const o = d.orig, hd = d.handle;
  const q = state.prefs.snapGrid && !e.altKey ? P(snapValue(p.x), snapValue(p.y)) : p;
  let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (hd.includes('w')) x0 = Math.min(q.x, x1 - MIN_SIZE);
  if (hd.includes('e')) x1 = Math.max(q.x, x0 + MIN_SIZE);
  if (hd.includes('n')) y0 = Math.min(q.y, y1 - MIN_SIZE);
  if (hd.includes('s')) y1 = Math.max(q.y, y0 + MIN_SIZE);
  let w = x1 - x0, h = y1 - y0;
  if (!!el.lockRatio !== e.shiftKey && o.w && o.h) { // Shift flips the aspect-ratio lock
    if (hd.length === 2) { const s = Math.max(w / o.w, h / o.h); w = o.w * s; h = o.h * s; }
    else if (hd === 'e' || hd === 'w') h = w * o.h / o.w;
    else w = h * o.w / o.h;
    x0 = hd.includes('w') ? o.x + o.w - w : hd.includes('e') ? o.x : o.x + (o.w - w) / 2;
    y0 = hd.includes('n') ? o.y + o.h - h : hd.includes('s') ? o.y : o.y + (o.h - h) / 2;
  }
  Object.assign(el, { x: x0, y: y0, w, h });
}

function doEndpoint(d, p, e) {
  const a = byId(d.id);
  if (!a) return;
  if (!d.moved && dist(p, d.start) * state.zoom < 3) return;
  d.moved = true;
  const ep = d.which === 'start' ? a.start : a.ends[+d.which.slice(1)];
  delete ep.id; delete ep.ax; delete ep.ay;
  d.target = e.altKey ? null : linkTarget(p);
  if (d.target) {
    Object.assign(ep, { id: d.target.el.id, x: p.x, y: p.y });
    if (d.target.snap) Object.assign(ep, { ax: d.target.snap.ax, ay: d.target.snap.ay });
  } else {
    const q = state.prefs.snapGrid ? P(snapValue(p.x), snapValue(p.y)) : p;
    Object.assign(ep, { x: q.x, y: q.y });
  }
}

// Topmost box under p. Near one of its snap points = pinned link, elsewhere = floating link.
function linkTarget(p) {
  const tol = 8 / state.zoom, list = els();
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (el.type !== 'box' || p.x < el.x - tol || p.x > el.x + el.w + tol || p.y < el.y - tol || p.y > el.y + el.h + tol) continue;
    let snap = null, best = 14 / state.zoom;
    for (const sp of snapPoints(el)) { const dd = dist(sp, p); if (dd <= best) { best = dd; snap = sp; } }
    return { el, snap };
  }
  return null;
}

function onDoubleClick(e) {
  if (e.target.closest('.text-edit, #overlay [data-handle], #overlay [data-ep], #overlay [data-snap]')) return;
  const node = e.target.closest('#elements > g[data-id]');
  if (node) return startTextEdit(node.dataset.id);
  if (e.target !== workspace && !e.target.closest('#svg')) return;
  const el = placeAt(makeBox(TEXT_ONLY), toCanvas(e));
  addElements([el]);
  startTextEdit(el.id);
}

/* ---------- Inline text editing ---------- */

let textEditor = null;

function startTextEdit(id) {
  const el = byId(id);
  if (!el) return;
  finishTextEdit();
  if (isIconOnly(el)) { // make room for a caption under the icon
    const w = Math.max(120, el.iconSize + 16);
    Object.assign(el, { x: el.x - (w - el.w) / 2, w, h: el.iconSize + ICON_GAP + el.fontSize * LINE_HEIGHT + 8, iconPos: 'top', padding: 4 });
  }
  state.sel = [id];
  state.editingId = id;
  buildPanel();
  updateChrome();
  let r, align = 'center', valign = 'middle';
  if (el.type === 'box') {
    const cb = contentBox(el), pad = el.padding || 0;
    r = { x: el.x + cb.x + pad, y: el.y + cb.y + pad, w: cb.w - 2 * pad, h: cb.h - 2 * pad };
    if (el.icon) {
      const s = el.iconSize + ICON_GAP;
      if (el.iconPos === 'left') { r.x += s; r.w -= s; }
      else if (el.iconPos === 'right') r.w -= s;
      else if (el.iconPos === 'bottom') r.h -= s;
      else { r.y += s; r.h -= s; }
    }
    align = el.hAlign;
    valign = el.vAlign;
  } else {
    const c = arrowGeom(el, byId).label;
    r = { x: c.x - 110, y: c.y - el.fontSize, w: 220, h: el.fontSize * 2 };
  }
  r.w = Math.max(r.w, 40);
  r.h = Math.max(r.h, el.fontSize * LINE_HEIGHT);
  const z = state.zoom, ta = document.createElement('textarea');
  ta.className = 'text-edit';
  ta.value = el.text || '';
  ta.spellcheck = false;
  Object.assign(ta.style, {
    left: (r.x + MARGIN) * z + 'px', width: r.w * z + 'px', font: fontCSS(el, el.fontSize * z),
    lineHeight: String(LINE_HEIGHT), color: el.textColor, textAlign: align,
  });
  stage.appendChild(ta);
  const fit = () => {
    ta.style.height = '0px';
    const sh = ta.scrollHeight, bh = r.h * z;
    ta.style.height = sh + 'px';
    ta.style.top = (r.y + MARGIN) * z + (valign === 'top' ? 0 : valign === 'bottom' ? bh - sh : (bh - sh) / 2) + 'px';
  };
  ta.addEventListener('input', () => { el.text = ta.value; fit(); render(); });
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishTextEdit(); }
  });
  ta.addEventListener('blur', finishTextEdit);
  textEditor = ta;
  fit();
  render();
  ta.focus();
  ta.select();
}

function finishTextEdit() {
  if (!textEditor) return;
  const ta = textEditor, el = byId(state.editingId);
  textEditor = null;
  state.editingId = null;
  ta.remove();
  if (el && isIconOnly(el) && (el.w !== el.iconSize || el.h !== el.iconSize)) { // no caption after all
    Object.assign(el, { x: el.x + (el.w - el.iconSize) / 2, w: el.iconSize, h: el.iconSize });
  }
  commit();
  buildPanel();
  render();
}

/* ---------- Element operations ---------- */

function addElements(list) {
  state.doc.elements.push(...list);
  state.sel = list.map(el => el.id);
  commit();
  buildPanel();
  updateChrome();
  render();
}

// Centers a new element on p (snapped to the grid when snapping is on).
function placeAt(el, p) {
  if (el.type === 'box') {
    el.x = p.x - el.w / 2;
    el.y = p.y - el.h / 2;
    if (state.prefs.snapGrid) { el.x = snapValue(el.x); el.y = snapValue(el.y); }
    return el;
  }
  const b = arrowGeom(el, () => null).bbox;
  let dx = p.x - (b.x + b.w / 2), dy = p.y - (b.y + b.h / 2);
  if (state.prefs.snapGrid) { dx = snapValue(b.x + dx) - b.x; dy = snapValue(b.y + dy) - b.y; }
  for (const ep of [el.start, ...el.ends]) { ep.x += dx; ep.y += dy; }
  return el;
}

function detach(ep, p) {
  delete ep.id; delete ep.ax; delete ep.ay;
  ep.x = p.x;
  ep.y = p.y;
}

function deleteSelection() {
  const ids = new Set(state.sel);
  if (!ids.size) return;
  for (const a of els()) { // arrows attached to deleted shapes keep their current position
    if (a.type !== 'arrow' || ids.has(a.id)) continue;
    const G = arrowGeom(a, byId);
    if (ids.has(a.start.id)) detach(a.start, G.start);
    a.ends.forEach((ep, i) => { if (ids.has(ep.id)) detach(ep, G.ends[i]); });
  }
  state.doc.elements = els().filter(el => !ids.has(el.id));
  state.sel = [];
  commit();
  buildPanel();
  updateChrome();
  render();
}

function nudge(dx, dy) {
  for (const el of selected()) {
    if (el.type === 'box') { el.x += dx; el.y += dy; }
    else for (const ep of [el.start, ...el.ends]) if (!ep.id) { ep.x += dx; ep.y += dy; }
  }
  commit();
  render();
}

function reorder(mode) {
  const sel = new Set(state.sel);
  if (!sel.size) return;
  let list = els();
  if (mode === 'front') list = [...list.filter(e => !sel.has(e.id)), ...list.filter(e => sel.has(e.id))];
  else if (mode === 'back') list = [...list.filter(e => sel.has(e.id)), ...list.filter(e => !sel.has(e.id))];
  else if (mode === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (sel.has(list[i].id) && !sel.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else {
    for (let i = 1; i < list.length; i++) if (sel.has(list[i].id) && !sel.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
  }
  state.doc.elements = list;
  commit();
  render();
}

function align(mode) {
  const boxes = selected().filter(e => e.type === 'box');
  if (boxes.length < 2) return;
  const b = unionBox(boxes);
  for (const el of boxes) {
    if (mode === 'left') el.x = b.x;
    if (mode === 'center') el.x = b.x + (b.w - el.w) / 2;
    if (mode === 'right') el.x = b.x + b.w - el.w;
    if (mode === 'top') el.y = b.y;
    if (mode === 'middle') el.y = b.y + (b.h - el.h) / 2;
    if (mode === 'bottom') el.y = b.y + b.h - el.h;
  }
  commit();
  render();
}

function distribute(axis) {
  const [pos, size] = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
  const boxes = selected().filter(e => e.type === 'box').sort((a, b) => a[pos] - b[pos]);
  if (boxes.length < 3) return;
  const first = boxes[0], last = boxes[boxes.length - 1];
  const used = boxes.reduce((s, b) => s + b[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - used) / (boxes.length - 1);
  let at = first[pos];
  for (const b of boxes) { b[pos] = at; at += b[size] + gap; }
  commit();
  render();
}

/* ---------- Clipboard ---------- */

const CLIP_TAG = 'diagram-editor/v1:';
let clipboard = null, pasteCount = 0;

// Copies elements; arrow ends linked to elements outside the copy become free points.
function copyPayload(list = selected()) {
  const ids = new Set(list.map(el => el.id));
  const elements = list.map(el => {
    const c = clone(el);
    if (c.type === 'arrow') {
      const G = arrowGeom(el, byId);
      if (c.start.id && !ids.has(c.start.id)) detach(c.start, G.start);
      c.ends.forEach((ep, i) => { if (ep.id && !ids.has(ep.id)) detach(ep, G.ends[i]); });
    }
    return c;
  });
  return { elements, assets: usedAssets(elements) };
}

function pastePayload(data, offset) {
  if (!data || !Array.isArray(data.elements) || !data.elements.length) return;
  for (const [id, src] of Object.entries(data.assets || {})) if (!state.doc.assets[id]) state.doc.assets[id] = src;
  const ids = new Map();
  const list = data.elements.map(el => {
    const c = normalizeElement(clone(el));
    ids.set(el.id, c.id = uid());
    return c;
  });
  for (const c of list) {
    if (c.type === 'box') { c.x += offset; c.y += offset; continue; }
    for (const ep of [c.start, ...c.ends]) {
      if (ep.id && ids.has(ep.id)) ep.id = ids.get(ep.id);
      else { delete ep.id; delete ep.ax; delete ep.ay; ep.x += offset; ep.y += offset; }
    }
  }
  addElements(list);
}

function copySelection() {
  if (!state.sel.length) return null;
  clipboard = copyPayload();
  pasteCount = 0;
  updateChrome();
  return clipboard;
}
function pasteClipboard() { if (clipboard) pastePayload(clipboard, 20 * ++pasteCount); }
function duplicateSelection() { if (state.sel.length) pastePayload(copyPayload(), 20); }
function cutSelection() { if (copySelection()) deleteSelection(); }

/* ---------- Files: save, open, export, images, icon folders ---------- */

function serialize(pretty = true) {
  const { name, canvas, elements } = state.doc;
  return JSON.stringify({ app: 'diagram-editor', version: 1, name, canvas, elements, assets: usedAssets(elements) }, null, pretty ? 2 : 0);
}

function normalizeElement(el) {
  const out = { ...clone(el.type === 'arrow' ? ARROW_DEFAULTS : BOX_DEFAULTS), ...el };
  if (!out.id) out.id = uid();
  if (out.type === 'arrow' && (!Array.isArray(out.ends) || !out.ends.length)) out.ends = [{ x: out.start.x + 100, y: out.start.y }];
  return out;
}

function loadDocument(data) {
  if (!data || !Array.isArray(data.elements)) throw new Error('This file is not a diagram saved by this editor.');
  finishTextEdit();
  clearBlobUrls();
  const blank = blankDoc();
  state.doc = {
    name: data.name || blank.name,
    canvas: { ...blank.canvas, ...(data.canvas || {}) },
    elements: data.elements.map(normalizeElement),
    assets: { ...(data.assets || {}) },
  };
  state.sel = [];
  state.hoverId = null;
  state.dirty = false;
  $('#docName').value = state.doc.name;
  resetHistory();
  buildPanel();
  zoomFit();
  scheduleAutosave();
}

const fileBase = () => (state.doc.name || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'diagram';

function saveFile() {
  finishTextEdit();
  downloadBlob(new Blob([serialize()], { type: 'application/json' }), fileBase() + '.json');
  state.dirty = false;
  toast(`Saved ${fileBase()}.json to your downloads`);
}

async function openFile(file) {
  try {
    loadDocument(JSON.parse(await readFile(file, 'Text')));
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast(err instanceof SyntaxError ? `${file.name} is not a valid diagram file.` : err.message);
  }
}

function exportSVGFile() {
  finishTextEdit();
  downloadBlob(new Blob([buildSVG(state.doc)], { type: 'image/svg+xml' }), fileBase() + '.svg');
}

async function exportRaster(type = 'png', scale = 2) {
  finishTextEdit();
  try {
    const { w, h, transparent, bg } = state.doc.canvas;
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildSVG(state.doc, scale)));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext('2d');
    if (type === 'jpeg') { g.fillStyle = transparent ? '#ffffff' : bg; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/' + type, 0.92));
    if (!blob) throw new Error('the browser could not encode the image');
    downloadBlob(blob, fileBase() + (type === 'jpeg' ? '.jpg' : '.png'));
  } catch (err) {
    toast('Export failed: ' + err.message);
  }
}

async function addImageFiles(files, at) {
  const list = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const src = await readFile(f);
      const img = await loadImage(src);
      let w = img.naturalWidth || 240, h = img.naturalHeight || 240;
      const k = Math.min(1, 480 / Math.max(w, h));
      w = Math.round(w * k);
      h = Math.round(h * k);
      const n = list.length * 24;
      list.push(placeAt(makeBox({ shape: 'none', image: addAsset(src), w, h, lockRatio: true }), P(at.x + n, at.y + n)));
    } catch (err) {
      toast(`Could not read ${f.name}`);
    }
  }
  if (list.length) addElements(list);
}

// Puts an image into the selected element (new image, or replaces the current one).
async function setElementImage(file) {
  const el = selected().find(e => e.type === 'box');
  if (!el || !file) return;
  try {
    const src = await readFile(file), img = await loadImage(src);
    if (!el.image && el.shape === 'none' && img.naturalWidth) el.h = el.w * img.naturalHeight / img.naturalWidth;
    el.image = addAsset(src);
    commit();
    buildPanel();
    render();
  } catch (err) {
    toast(`Could not read ${file.name}`);
  }
}

async function loadIconFolder(fileList) {
  const files = [...fileList].filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name));
  if (!files.length) return toast('That folder has no .png or .jpg files.');
  const icons = [];
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    icons.push({ name: f.name.replace(/\.[^.]+$/, ''), folder: parts.length > 1 ? parts[parts.length - 2] : 'My icons', src: await readFile(f) });
  }
  icons.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  userIcons = icons;
  renderPalette();
  try {
    localStorage.setItem(STORAGE.icons, JSON.stringify(icons));
    toast(`Loaded ${icons.length} icons`);
  } catch (e) {
    toast(`Loaded ${icons.length} icons for this session (too large to remember next time)`);
  }
}
