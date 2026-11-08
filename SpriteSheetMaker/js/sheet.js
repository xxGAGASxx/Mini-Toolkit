'use strict';
// Main tab: zoom, selection, drag to swap, arrange, grid and color inputs, align all.

function autoZoom() {
  const [cw, ch] = cell(), m = Math.max(cw, ch), cols = effCols();
  const avail = Math.max(200, els.viewMain.clientWidth - 80);
  let z = ZOOMS[0];
  for (const v of ZOOMS) if (v * m <= 160 && (cols * cw + (cols - 1) * state.pad) * v <= avail) z = v;
  state.zoom = z;
  els.zoom.value = String(z);
}

/* ================= selection, drag to swap ================= */
function select(id) { state.sel = id; schedule(); }

let drag = null;
els.sheet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  e.preventDefault();
  drag = { from: +cellEl.dataset.i, x: e.clientX, y: e.clientY, active: false, ghost: null, over: null, pid: e.pointerId };
});
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.active = true;
    const srcEl = els.sheet.children[drag.from], src = srcEl.firstChild;
    const g = document.createElement('div'), gc = mk(src.width, src.height);
    gc.getContext('2d').drawImage(src, 0, 0);
    const k = Math.min(1, 120 / Math.max(parseFloat(src.style.width), parseFloat(src.style.height)));
    gc.style.width = parseFloat(src.style.width) * k + 'px';
    gc.style.height = parseFloat(src.style.height) * k + 'px';
    if (state.zoom >= 1) gc.className = 'px';
    g.className = 'ghost'; g.appendChild(gc); document.body.appendChild(g);
    drag.ghost = g;
    srcEl.classList.add('lift');
    document.body.classList.add('dragging');
  }
  drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const tc = t && t.closest('.cell');
  const over = tc && tc.parentNode === els.sheet ? +tc.dataset.i : null;
  if (over !== drag.over) {
    if (drag.over != null && els.sheet.children[drag.over]) els.sheet.children[drag.over].classList.remove('over');
    drag.over = over;
    if (over != null && over !== drag.from) els.sheet.children[over].classList.add('over');
  }
});
function endDrag(e, cancel) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null;
  if (d.active) {
    d.ghost.remove();
    document.body.classList.remove('dragging');
    $$('.cell.lift, .cell.over').forEach((c) => c.classList.remove('lift', 'over'));
    if (!cancel && d.over != null && d.over !== d.from) {
      const a = state.sprites;
      [a[d.from], a[d.over]] = [a[d.over], a[d.from]];
      toast(`Swapped ${d.from + 1} and ${d.over + 1}`);
    }
    schedule();
  } else if (!cancel && state.sprites[d.from]) {
    select(state.sprites[d.from].id);
  }
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
els.viewMain.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.cell') && !e.target.closest('button')) select(null);
});
els.sheet.addEventListener('dblclick', (e) => {
  const c = e.target.closest('.cell'); if (!c) return;
  setTab('preview'); state.frame = +c.dataset.i; schedule();
});

/* ================= arrange ================= */
function duplicate() {
  const i = selIdx(); if (i < 0) return;
  const s = state.sprites[i];
  const copy = { ...s, id: uid++, adj: { ...s.adj }, proc: null, dirty: true };
  state.sprites.splice(i + 1, 0, copy);
  state.sel = copy.id;
  schedule();
}
function removeSel() {
  const i = selIdx(); if (i < 0) return;
  state.sprites.splice(i, 1);
  const nx = state.sprites[Math.min(i, state.sprites.length - 1)];
  state.sel = nx ? nx.id : null;
  schedule();
}
els.dup.addEventListener('click', duplicate);
els.del.addEventListener('click', removeSel);
els.rev.addEventListener('click', () => { state.sprites.reverse(); toast('Reversed the order'); schedule(); });
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
  schedule();
});
function disarmClear() { clearTimeout(clearArmed); clearArmed = 0; els.clear.textContent = 'Clear all'; els.clear.classList.remove('armed'); }

/* ================= grid inputs ================= */
els.cols.addEventListener('input', () => { const v = parseInt(els.cols.value, 10); if (v >= 1) { state.cols = Math.min(v, 256); schedule(); } });
els.pad.addEventListener('input', () => { const v = parseInt(els.pad.value, 10); state.pad = isNaN(v) ? 0 : clamp(v, 0, 512); schedule(); });
els.cw.addEventListener('input', () => { const v = parseInt(els.cw.value, 10); state.cellW = v > 0 ? Math.min(v, 4096) : 0; schedule(); });
els.ch.addEventListener('input', () => { const v = parseInt(els.ch.value, 10); state.cellH = v > 0 ? Math.min(v, 4096) : 0; schedule(); });
els.zoom.addEventListener('change', () => { state.zoom = +els.zoom.value; schedule(); });

/* ================= color inputs ================= */
function applyAdj(k, v) {
  const s = selected();
  if (s) { s.adj[k] = v; s.dirty = true; }
  else { state.global[k] = v; markAllDirty(); }
  schedule();
}
for (const k of 'hsbc') {
  const inp = $('#adj-' + k);
  inp.addEventListener('input', () => applyAdj(k, +inp.value));
  inp.addEventListener('dblclick', () => { inp.value = DEF[k]; applyAdj(k, DEF[k]); });
}
els.adjReset.addEventListener('click', () => {
  const s = selected();
  if (s) { s.adj = { ...DEF }; s.dirty = true; toast(`Reset color of sprite ${selIdx() + 1}`); }
  else { state.global = { ...DEF }; state.sprites.forEach((x) => (x.adj = { ...DEF })); markAllDirty(); toast('Reset color of all sprites'); }
  schedule();
});
els.adjTarget.addEventListener('click', () => { if (state.sel != null) select(null); });

/* ================= align all ================= */
buildAnchor(els.alignAll, (ax, ay, label) => {
  state.align = [ax, ay];
  for (const s of state.sprites) { s.ax = ax; s.ay = ay; s.ox = 0; s.oy = 0; }
  toast(`Aligned all sprites: ${label.toLowerCase()}`);
  schedule();
});
