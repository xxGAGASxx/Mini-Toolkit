'use strict';
// Tabs, keyboard shortcuts and startup. Loaded last.

/* ================= tabs & keyboard ================= */
function setTab(t) {
  state.tab = t;
  els.tabMain.setAttribute('aria-selected', t === 'main');
  els.tabPrev.setAttribute('aria-selected', t === 'preview');
  els.sideMain.hidden = els.viewMain.hidden = t !== 'main';
  els.sidePrev.hidden = els.viewPrev.hidden = t !== 'preview';
  if (t === 'preview') { const i = selIdx(); if (i >= 0) state.frame = i; }
  else pause();
  schedule();
}
els.tabMain.addEventListener('click', () => setTab('main'));
els.tabPrev.addEventListener('click', () => setTab('preview'));

document.addEventListener('keydown', (e) => {
  if (modalOpen()) return;   // the dialog handles its own keys (Esc closes it); nothing reaches the sheet behind
  const t = e.target, k = e.key.toLowerCase();
  // Undo / redo work in both tabs, also with a slider focused. Number boxes keep their own text undo.
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y') && !(t.closest && t.closest('input[type=number], textarea'))) {
    e.preventDefault();
    if (!drag) (k === 'y' || e.shiftKey ? redo : undo)();   // not mid-drag: the drop needs the order it started with
    return;
  }
  if (t.closest && t.closest('input, select, textarea')) return;
  if (state.tab === 'main') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel != null) { e.preventDefault(); removeSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (e.key === 'Escape') select(null);
    return;
  }
  const s = cur(), step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key] && s) { e.preventDefault(); s.ox += moves[e.key][0]; s.oy += moves[e.key][1]; schedule(); }
  else if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); state.playing ? pause() : play(); }
  else if (e.key === ',') { pause(); setFrame(state.frame - 1); }
  else if (e.key === '.') { pause(); setFrame(state.frame + 1); }
  else if (e.key === 'Home') { pause(); setFrame(0); }
  else if (e.key === 'End') { pause(); setFrame(state.sprites.length - 1); }
});
window.addEventListener('resize', schedule);

loadSample();
