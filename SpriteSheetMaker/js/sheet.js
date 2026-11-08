'use strict';
// Main tab: zoom, selection, drag to swap or insert, arrange, grid and color inputs, align all.

function autoZoom() {
  const [cw, ch] = cell(), m = Math.max(cw, ch), cols = effCols();
  const avail = Math.max(200, els.viewMain.clientWidth - 80);
  let z = ZOOMS[0];
  for (const v of ZOOMS) if (v * m <= 160 && (cols * cw + (cols - 1) * state.pad) * v <= avail) z = v;
  state.zoom = z;
  els.zoom.value = String(z);
}

/* ================= selection, drag to swap or insert ================= */
function select(id) { state.sel = id; schedule(); }

// Where a dragged sprite would land, worked out from the grid geometry.
// Over the middle of a cell it swaps with that sprite: { i, side: 0 }.
// Near a cell's left or right border, or in the gap beside it, it is inserted on that side
// and the sprites in between shift over: { i, side: -1 | 1 }. Past the last sprite it moves to the end.
// Drops that would change nothing give null.
function dropTarget(cx, cy, from) {
  const n = state.sprites.length, cols = effCols(), rows = Math.ceil(n / cols), z = state.zoom, [cw, ch] = cell();
  const w = cw * z, h = ch * z, g = state.pad * z, edge = Math.min(w / 3, Math.max(6, w / 4));
  const r = els.sheet.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  const row = Math.floor((y + g / 2) / (h + g));
  if (row < 0 || row >= rows || x < -g / 2 - edge || x > r.width + g / 2 + edge) return null;
  const col = clamp(Math.floor((x + g / 2) / (w + g)), 0, cols - 1), lx = x - col * (w + g);
  let t = { i: row * cols + col, side: lx < edge ? -1 : lx > w - edge ? 1 : 0 };
  if (t.i >= n) t = { i: n - 1, side: 1 };
  const at = t.side > 0 ? t.i + 1 : t.i;
  if (t.side ? at === from || at === from + 1 : t.i === from) return null;
  return t;
}
// Swap: outline the target cell. Insert: a bar centered in the gap on that side of the cell.
function showTarget(d, t) {
  const cells = els.sheet.children, over = t && !t.side ? t.i : null;
  if (over !== d.over) {
    if (d.over != null && cells[d.over]) cells[d.over].classList.remove('over');
    if (over != null) cells[over].classList.add('over');
    d.over = over;
  }
  d.ins.hidden = !(t && t.side);
  if (d.ins.hidden) return;
  const r = cells[t.i].getBoundingClientRect(), g = state.pad * state.zoom;
  d.ins.style.transform = `translate(${t.side < 0 ? r.left - g / 2 : r.right + g / 2}px, ${r.top}px)`;
  d.ins.style.height = r.height + 8 + 'px';
}

// The drag holds the sprite's id, not its index: a file import that finishes mid-drag can still
// change the list (replacing the sample frames removes the dragged sprite), so the index is looked
// up again whenever it is needed, and the drag is cancelled if the sprite is gone.
let drag = null;
const dragFrom = (d) => state.sprites.findIndex((s) => s.id === d.id);
els.sheet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const cellEl = e.target.closest('.cell'), s = cellEl && state.sprites[+cellEl.dataset.i];
  if (!s) return;
  e.preventDefault();
  drag = { id: s.id, x: e.clientX, y: e.clientY, active: false, ghost: null, ins: null, over: null, target: null, pid: e.pointerId };
});
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const from = dragFrom(drag);
  if (from < 0) { endDrag(null, true); return; }
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.active = true;
    const srcEl = els.sheet.children[from], src = srcEl.firstChild;
    const g = document.createElement('div'), gc = mk(src.width, src.height);
    gc.getContext('2d').drawImage(src, 0, 0);
    const k = Math.min(1, 120 / Math.max(parseFloat(src.style.width), parseFloat(src.style.height)));
    gc.style.width = parseFloat(src.style.width) * k + 'px';
    gc.style.height = parseFloat(src.style.height) * k + 'px';
    if (state.zoom >= 1) gc.className = 'px';
    g.className = 'ghost'; g.appendChild(gc); document.body.appendChild(g);
    drag.ghost = g;
    drag.ins = document.createElement('div');
    drag.ins.className = 'ins'; drag.ins.hidden = true;
    document.body.appendChild(drag.ins);
    srcEl.classList.add('lift');
    document.body.classList.add('dragging');
  }
  drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  drag.target = dropTarget(e.clientX, e.clientY, from);
  showTarget(drag, drag.target);
});
function endDrag(e, cancel) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag, from = dragFrom(d); drag = null;
  if (from < 0) cancel = true;   // the dragged sprite is gone
  if (d.active) {
    d.ghost.remove(); d.ins.remove();
    document.body.classList.remove('dragging');
    $$('.cell.lift, .cell.over').forEach((c) => c.classList.remove('lift', 'over'));
    const t = cancel ? null : d.target;
    if (t && !t.side) {
      record('swap', ['order'], () => { const a = state.sprites; [a[from], a[t.i]] = [a[t.i], a[from]]; });
      toast(`Swapped ${from + 1} and ${t.i + 1}`);
    } else if (t) {
      const at = t.side > 0 ? t.i + 1 : t.i, to = at > from ? at - 1 : at;
      record('move', ['order'], () => { const a = state.sprites; a.splice(to, 0, a.splice(from, 1)[0]); });
      toast(`Moved ${from + 1} to position ${to + 1}`);
    }
    schedule();
  } else if (!cancel) {
    select(d.id);
  }
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
els.viewMain.addEventListener('pointerdown', (e) => {
  // Cells cancel pointerdown (for dragging), which also stops the browser moving focus. Leave a
  // focused sidebar field explicitly, so the sheet's keys (Del, Ctrl+D, Esc) go to the sheet.
  const f = document.activeElement;
  if (f && f !== document.body && !els.viewMain.contains(f)) f.blur();
  if (e.button !== 1 && !e.target.closest('.cell') && !e.target.closest('button')) select(null);   // middle button pans
});
els.sheet.addEventListener('dblclick', (e) => {
  const c = e.target.closest('.cell'); if (!c) return;
  setTab('preview'); state.frame = +c.dataset.i; schedule();
});

/* ================= arrange ================= */
function duplicate() {
  const i = selIdx(); if (i < 0) return;
  record('duplicate', ['order'], () => {
    const s = state.sprites[i];
    const copy = { ...s, id: uid++, adj: { ...s.adj }, proc: null, dirty: true };
    state.sprites.splice(i + 1, 0, copy);
    state.sel = copy.id;
  });
}
function removeSel() {
  const i = selIdx(); if (i < 0) return;
  record('delete', ['order'], () => {
    state.sprites.splice(i, 1);
    const nx = state.sprites[Math.min(i, state.sprites.length - 1)];
    state.sel = nx ? nx.id : null;
  });
}
els.dup.addEventListener('click', duplicate);
els.del.addEventListener('click', removeSel);
els.rev.addEventListener('click', () => { record('reverse order', ['order'], () => { state.sprites.reverse(); }); toast('Reversed the order'); });

/* ================= clear all ================= */
// Two clicks, since it can't be undone: it also empties the undo history, so the cleared
// sprites' pixels aren't kept alive by old steps.
let clearArmed = 0;
els.clear.addEventListener('click', () => {
  if (!clearArmed) {
    els.clear.textContent = 'Click again to clear';
    els.clear.classList.add('armed');
    clearArmed = setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  state.sprites = []; state.sel = null; state.frame = 0;
  clearHistory();
  toast('Cleared all sprites');
});
function disarmClear() { clearTimeout(clearArmed); clearArmed = 0; els.clear.textContent = 'Clear all'; els.clear.classList.remove('armed'); }

/* ================= grid inputs ================= */
els.cols.addEventListener('input', () => { const v = parseInt(els.cols.value, 10); if (v >= 1) { state.cols = Math.min(v, 256); schedule(); } });
els.pad.addEventListener('input', () => { const v = parseInt(els.pad.value, 10); state.pad = isNaN(v) ? 0 : clamp(v, 0, 512); schedule(); });
els.cw.addEventListener('input', () => { const v = parseInt(els.cw.value, 10); state.cellW = v > 0 ? Math.min(v, 4096) : 0; schedule(); });
els.ch.addEventListener('input', () => { const v = parseInt(els.ch.value, 10); state.cellH = v > 0 ? Math.min(v, 4096) : 0; schedule(); });
els.zoom.addEventListener('change', () => { state.zoom = +els.zoom.value; schedule(); });

/* ================= wheel zoom ================= */
// Each wheel notch steps through ZOOMS, keeping the point under the cursor in place.
// Trackpad deltas are small, so they add up until they make one step. Shift + wheel and
// sideways swipes are left to the browser, so the sheet can still scroll sideways.
let wheelAcc = 0, wheelT = 0;
els.viewMain.addEventListener('wheel', (e) => {
  if (!state.sprites.length || e.shiftKey || !e.deltaY) return;
  e.preventDefault();
  const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);   // lines / pages to px
  if (e.timeStamp - wheelT > 300 || Math.sign(d) !== Math.sign(wheelAcc)) wheelAcc = 0;
  wheelT = e.timeStamp;
  wheelAcc += d;
  if (Math.abs(wheelAcc) < 50) return;
  const i = clamp(ZOOMS.indexOf(state.zoom) + (wheelAcc < 0 ? 1 : -1), 0, ZOOMS.length - 1);
  wheelAcc = 0;
  zoomAt(ZOOMS[i], e.clientX, e.clientY);
}, { passive: false });

function zoomAt(z, x, y) {
  if (z === state.zoom) return;
  const r = els.sheet.getBoundingClientRect(), k = z / state.zoom;
  state.zoom = z;
  els.zoom.value = String(z);
  render();   // now rather than next frame, so the new size can be measured
  const r2 = els.sheet.getBoundingClientRect();
  els.viewMain.scrollLeft += r2.left + (x - r.left) * k - x;
  els.viewMain.scrollTop += r2.top + (y - r.top) * k - y;
}

/* ================= middle-drag pan ================= */
// Moves are applied as deltas, so zooming with the wheel mid-pan doesn't make the view jump.
let pan = null;
// Cancelling mousedown (not pointerdown) is what stops the browser's middle-click autoscroll.
els.viewMain.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
els.viewMain.addEventListener('pointerdown', (e) => {
  if (e.button !== 1 || pan) return;
  els.viewMain.setPointerCapture(e.pointerId);
  pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
  document.body.classList.add('panning');
});
els.viewMain.addEventListener('pointermove', (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  if (!(e.buttons & 4)) { endPan(); return; }   // middle released while another button is still down
  els.viewMain.scrollLeft -= e.clientX - pan.x;
  els.viewMain.scrollTop -= e.clientY - pan.y;
  pan.x = e.clientX; pan.y = e.clientY;
});
function endPan() { pan = null; document.body.classList.remove('panning'); }
els.viewMain.addEventListener('lostpointercapture', endPan);

/* ================= color inputs ================= */
const ADJ_NAMES = { h: 'hue', s: 'saturation', b: 'brightness', c: 'contrast' };
function applyAdj(k, v) {
  const s = selected();
  record(ADJ_NAMES[k], ['color'], () => {
    if ((s ? s.adj : state.global)[k] === v) return false;
    if (s) { s.adj[k] = v; s.dirty = true; }
    else { state.global[k] = v; markAllDirty(); }
  }, `${k}:${s ? s.id : 'all'}`);
}
for (const k of 'hsbc') {
  const inp = $('#adj-' + k);
  inp.addEventListener('input', () => applyAdj(k, +inp.value));
  inp.addEventListener('dblclick', () => { inp.value = DEF[k]; applyAdj(k, DEF[k]); });
}
els.adjReset.addEventListener('click', () => {
  const s = selected();
  record('reset color', ['color'], () => {
    if (s) {
      if (isId(s.adj)) return false;
      s.adj = { ...DEF }; s.dirty = true;
    } else {
      if (isId(state.global) && state.sprites.every((x) => isId(x.adj))) return false;
      state.global = { ...DEF }; state.sprites.forEach((x) => (x.adj = { ...DEF })); markAllDirty();
    }
  });
  toast(s ? `Reset color of sprite ${selIdx() + 1}` : 'Reset color of all sprites');
});
els.adjTarget.addEventListener('click', () => { if (state.sel != null) select(null); });

/* ================= align all ================= */
buildAnchor(els.alignAll, (ax, ay, label) => {
  record('align all', ['align'], () => {
    const done = (s) => s.ax === ax && s.ay === ay && !s.ox && !s.oy;
    if (state.align[0] === ax && state.align[1] === ay && state.sprites.every(done)) return false;
    state.align = [ax, ay];
    for (const s of state.sprites) { s.ax = ax; s.ay = ay; s.ox = 0; s.oy = 0; }
  });
  toast(`Aligned all sprites: ${label.toLowerCase()}`);
});
