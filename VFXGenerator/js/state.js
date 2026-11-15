'use strict';
// What is open: the document, the selected layer and the view settings. Undo / redo, autosave
// and the presets saved in this browser.

const KEY_DOC = `${APP_KEY}:doc`, KEY_PRESETS = `${APP_KEY}:presets`, KEY_VIEW = `${APP_KEY}:view`;

const VIEW_DEF = {
  tab: 'texture', presets: 'still',
  bg: 'checker', bgColor: '#202329', channel: 'rgba', grid: true,                 // texture view
  emitter: 'single', blend: 'add', tint: '#ffffff', size: 60, fxBg: 'dark', fxColor: '#16181d', playing: true,  // preview
};

const state = {
  doc: newDoc(),
  sel: null,                              // id of the selected layer
  view: { ...VIEW_DEF, ...store.get(KEY_VIEW, {}) },
};

const selLayer = () => state.doc.layers.find((L) => L.id === state.sel) || null;
const selIndex = () => state.doc.layers.findIndex((L) => L.id === state.sel);
// Keeps a valid selection after layers come and go: the top layer when the old one is gone.
function fixSel() {
  if (!selLayer()) state.sel = state.doc.layers.length ? state.doc.layers[state.doc.layers.length - 1].id : null;
}

/* ---------- undo / redo
   Each step is the document as JSON, plus the layer selected before and after the change, so
   undoing a delete selects the layer that comes back, and undoing an edit selects its layer. */
const hist = { past: [], future: [], cur: null, sel: null };   // sel: selected when the current change began
const HIST_MAX = 200;
let onChange = () => {};

// Something changed: redraw. With commit, it also becomes one step of undo history.
function changed(commit = false) {
  onChange();
  if (commit) commitHistory();
}
function resetHistory() {
  hist.past = [];
  hist.future = [];
  hist.cur = { doc: JSON.stringify(state.doc), before: state.sel, after: state.sel };
  hist.sel = state.sel;
}
function commitHistory() {
  const s = JSON.stringify(state.doc);
  if (s === hist.cur.doc) return;
  hist.past.push(hist.cur);
  if (hist.past.length > HIST_MAX) hist.past.shift();
  hist.cur = { doc: s, before: hist.sel, after: state.sel };
  hist.sel = state.sel;
  hist.future = [];
  autosave();
}
// Picking a layer by hand (not as a side effect of adding or deleting one).
function selectLayer(id) {
  state.sel = id;
  hist.sel = id;
  changed();
}
function restore(entry, sel) {
  state.doc = JSON.parse(entry.doc);
  hist.cur = entry;
  if (sel !== undefined) state.sel = sel;
  fixSel();
  hist.sel = state.sel;
  autosave();
  onChange();
}
function undo() {
  if (JSON.stringify(state.doc) !== hist.cur.doc) { restore(hist.cur); return; }   // a slider mid-drag: back to the last step
  if (!hist.past.length) return;
  const undone = hist.cur;
  hist.future.push(undone);
  restore(hist.past.pop(), undone.before);
}
function redo() {
  if (!hist.future.length) return;
  hist.past.push(hist.cur);
  const e = hist.future.pop();
  restore(e, e.after);
}
const canUndo = () => hist.past.length > 0 || JSON.stringify(state.doc) !== hist.cur.doc;
const canRedo = () => hist.future.length > 0;

// Replaces the whole document (open, new, preset) as one undoable step.
function setDoc(doc) {
  state.doc = doc;
  state.sel = null;
  fixSel();
  changed(true);
}

/* ---------- storage */
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(KEY_DOC, state.doc), 400);
}
let viewTimer = 0;
function saveView() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => store.set(KEY_VIEW, state.view), 400);
}
function loadSaved() {
  const raw = store.get(KEY_DOC, null);
  if (!raw) return false;
  try { state.doc = cleanDoc(raw); return true; } catch { return false; }
}

// Presets saved in this browser: [{ name, doc }].
function userPresets() {
  const list = store.get(KEY_PRESETS, []);
  return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string' && p.doc && Array.isArray(p.doc.layers)) : [];
}
function saveUserPreset() {
  const list = userPresets(), name = state.doc.name || 'My preset';
  const i = list.findIndex((p) => p.name === name), entry = { name, doc: JSON.parse(JSON.stringify(state.doc)) };
  if (i >= 0) list[i] = entry; else list.push(entry);
  return store.set(KEY_PRESETS, list) ? (i >= 0 ? 'replaced' : 'added') : '';
}
function deleteUserPreset(name) {
  store.set(KEY_PRESETS, userPresets().filter((p) => p.name !== name));
}
