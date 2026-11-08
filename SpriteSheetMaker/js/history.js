'use strict';
// Undo / redo for Align all sprites, Arrange and Color. Nothing else is recorded.
//
// Each step keeps before/after snapshots of only the parts it changes:
//   order  the sprite list (sprites are shared, not copied: their pixels never change)
//   align  state.align and every sprite's anchor and nudge
//   color  state.global and every sprite's color adjustment
// plus the selection. Undo and redo leave alone what unrecorded edits did in the meantime:
// sprites added since stay (at the end), and a sprite nudged or aligned in Preview since keeps
// its position. Replacing or removing the sample frames starts a new history (clearHistory).

const HISTORY_MAX = 100;
const hist = { undo: [], redo: [], open: null };   // open: the newest step, while it can still absorb changes

function snap(parts) {
  const o = { sel: state.sel };
  if (parts.includes('order')) o.order = state.sprites.slice();
  if (parts.includes('align')) {
    o.align = state.align.slice();
    o.pos = new Map(state.sprites.map((s) => [s.id, [s.ax, s.ay, s.ox, s.oy]]));
  }
  if (parts.includes('color')) {
    o.global = { ...state.global };
    o.adj = new Map(state.sprites.map((s) => [s.id, { ...s.adj }]));
  }
  return o;
}

// Runs fn as one undoable step. fn returns false when it changed nothing.
// Changes with the same key less than a second apart join one step, so a slider drag undoes in one go.
function record(label, parts, fn, key) {
  const top = hist.open, now = performance.now();
  const merge = !!key && !!top && top.key === key && now - top.t < 1000;
  const before = merge ? null : snap(parts);
  if (fn() === false) return;
  const step = merge ? top : { label, parts, key, before };
  step.after = snap(parts);
  step.t = now;
  if (!merge) {
    hist.undo.push(step);
    if (hist.undo.length > HISTORY_MAX) hist.undo.shift();
    hist.open = step;
  }
  hist.redo.length = 0;
  schedule();
}

// Puts back snapshot `to`. `from` is the snapshot on the other side of the step,
// which is how things should still look unless an unrecorded edit changed them since.
function restore(from, to) {
  if (to.order) {
    const known = new Set([...from.order, ...to.order]);
    state.sprites = to.order.concat(state.sprites.filter((s) => !known.has(s)));
  }
  if (to.pos) {
    state.align = to.align.slice();
    for (const s of state.sprites) {
      const a = from.pos.get(s.id), b = to.pos.get(s.id);
      if (a && b && s.ax === a[0] && s.ay === a[1] && s.ox === a[2] && s.oy === a[3]) [s.ax, s.ay, s.ox, s.oy] = b;
    }
  }
  if (to.adj) {
    state.global = { ...to.global };
    for (const s of state.sprites) { const b = to.adj.get(s.id); if (b) s.adj = { ...b }; }
    markAllDirty();
  }
  const has = (id) => state.sprites.some((s) => s.id === id);
  state.sel = to.sel == null || has(to.sel) ? to.sel : has(state.sel) ? state.sel : null;
  schedule();
}

function undo() {
  const step = hist.undo.pop(); if (!step) return;
  hist.open = null;
  restore(step.after, step.before);
  hist.redo.push(step);
  toast(`Undone: ${step.label}`);
}
function redo() {
  const step = hist.redo.pop(); if (!step) return;
  hist.open = null;
  restore(step.before, step.after);
  hist.undo.push(step);
  toast(`Redone: ${step.label}`);
}
function clearHistory() { hist.undo.length = 0; hist.redo.length = 0; hist.open = null; schedule(); }

els.undo.addEventListener('click', undo);
els.redo.addEventListener('click', redo);
