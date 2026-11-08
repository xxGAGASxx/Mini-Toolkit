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

// Whether the focused control uses this key itself, in which case the shortcut leaves it alone.
// Text and number fields keep every key (typing, Del, their own Ctrl+Z); other controls only
// the keys they react to, so e.g. Del or Ctrl+D still work right after ticking a checkbox.
function controlOwnsKey(el, e) {
  if (!el || !el.matches) return false;
  if (el.matches('textarea, input:not([type]), input[type=text], input[type=number], input[type=search]')) return true;
  const k = e.key, nav = /^(Arrow|Page|Home$|End$)/.test(k), plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (el.matches('input[type=range]')) return nav;
  if (el.matches('select')) return nav || k === ' ' || k === 'Enter' || (k.length === 1 && plain);   // incl. type-to-pick
  if (el.matches('input[type=checkbox], input[type=radio], input[type=color], button')) return k === ' ' || k === 'Enter';
  return false;
}

document.addEventListener('keydown', (e) => {
  if (modalOpen()) return;   // the dialog handles its own keys (Esc closes it); nothing reaches the sheet behind
  const t = e.target, k = e.key.toLowerCase();
  if (controlOwnsKey(t, e)) return;
  // Undo / redo work in both tabs (number boxes keep their own text undo, see above).
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
    e.preventDefault();
    if (!drag) (k === 'y' || e.shiftKey ? redo : undo)();   // not mid-drag: the drop needs the order it started with
    return;
  }
  if (state.tab === 'main') {
    // Like undo, Delete and Ctrl+D wait until no sprite is being dragged.
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel != null) { e.preventDefault(); if (!drag) removeSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (!drag) duplicate(); }
    else if (e.key === 'Escape') select(null);
    return;
  }
  const s = cur(), step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key] && s) { e.preventDefault(); s.ox += moves[e.key][0]; s.oy += moves[e.key][1]; schedule(); }
  else if (e.key === ' ') { e.preventDefault(); state.playing ? pause() : play(); }
  else if (e.key === ',') { pause(); setFrame(state.frame - 1); }
  else if (e.key === '.') { pause(); setFrame(state.frame + 1); }
  else if (e.key === 'Home') { pause(); setFrame(0); }
  else if (e.key === 'End') { pause(); setFrame(state.sprites.length - 1); }
});
window.addEventListener('resize', schedule);

loadSample();
