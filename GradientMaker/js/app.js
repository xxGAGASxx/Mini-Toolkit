'use strict';
// Startup, the render loop, PNG export, opening and saving files, drag and drop, keyboard shortcuts.

const ui = {
  undo: $('#btn-undo'), redo: $('#btn-redo'), stats: $('#stats'), file: $('#file'), drop: $('#drop'),
  exPng: $('#ex-png'), exCopy: $('#ex-copy'), newDoc: $('#btn-new'), open: $('#btn-open'), save: $('#btn-save'),
};

/* ---------- render loop: every change calls schedule(); one render per frame redraws what's visible */
let frameReq = 0, busy = false;
function schedule() { if (!frameReq) frameReq = requestAnimationFrame(render); }
function render() {
  frameReq = 0;
  fixSelection();
  renderList();
  renderGradSettings();
  renderEditor();
  renderOutPanel();
  renderPresets();
  renderStats();
  renderView();
  ui.undo.disabled = !hist.past.length && snapshot() === hist.cur;
  ui.redo.disabled = !hist.future.length;
}
onHistory = schedule;

function renderStats() {
  const L = texLayout(), o = state.out, big = L.W > MAX_SIDE || L.H > MAX_SIDE;
  const grown = L.W !== L.cw || L.H !== L.ch;
  ui.stats.textContent = `${L.W} × ${L.H} px${grown ? ` (content ${L.cw} × ${L.ch})` : ''} · ${o.depth}-bit · ${L.n} gradient${L.n === 1 ? '' : 's'}`;
  ui.stats.classList.toggle('warn', big);
  if (big) ui.stats.textContent += ` · over ${MAX_SIDE} px, too large to export`;
  ui.exPng.disabled = ui.exCopy.disabled = big || busy;
}

/* ---------- export */
async function renderPng(depth, withSettings) {
  const L = texLayout();
  if (L.W > MAX_SIDE || L.H > MAX_SIDE) throw new Error(`textures are limited to ${MAX_SIDE} px per side`);
  const data = renderTexture(L, L.W, L.H, depth);
  const settings = withSettings ? JSON.stringify({ ...docOut(), selected: selIndex() }) : '';
  return { L, blob: await encodePng(L.W, L.H, data, depth, hasAlpha(data, depth), settings) };
}
async function runBusy(fn) {
  if (busy) return;
  busy = true; renderStats();
  await new Promise((r) => setTimeout(r, 30));   // let the disabled buttons paint before the heavy work
  try { await fn(); } catch (err) { console.error(err); toast(`Failed: ${err.message || err}`); }
  finally { busy = false; schedule(); }
}
const exportPng = () => runBusy(async () => {
  const depth = state.out.depth, { L, blob } = await renderPng(depth, true);
  const base = state.out.layout === 'single' || state.grads.length < 2 ? slug(selGrad().name) : 'gradient-atlas';
  saveBlob(blob, `${base}-${L.W}x${L.H}${depth === 16 ? '-16bit' : ''}.png`);
});
const copyImage = () => runBusy(async () => {
  if (!navigator.clipboard || typeof ClipboardItem !== 'function') throw new Error('this browser cannot copy images');
  const { blob } = await renderPng(8, false);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  toast('Texture copied as an 8-bit PNG.');
});
ui.exPng.addEventListener('click', exportPng);
ui.exCopy.addEventListener('click', copyImage);

/* ---------- files */
function saveJson() {
  saveText(JSON.stringify({ ...docOut(), selected: selIndex() }, null, 2) + '\n', 'gradients.json', 'application/json');
}
async function openFile(file) {
  if (file.size > 50 * 1024 * 1024) { toast('That file is too large.'); return; }
  try {
    let text;
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      text = readPngSettings(await file.arrayBuffer());
      if (!text) { toast('This PNG has no Gradient Maker settings in it. Only PNGs exported here can be opened.'); return; }
    } else text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch { toast(`${file.name} is not valid JSON.`); return; }
    const d = docIn(data);
    if (!d) { toast(`No gradients found in ${file.name}.`); return; }
    state.grads = d.grads;
    if (d.out) state.out = d.out;
    const sel = Number.isInteger(data.selected) ? data.selected : 0;
    state.sel = (state.grads[sel] || state.grads[0]).id;
    state.stop = 0;
    fixSelection(); commit(); schedule();
    toast(`Opened ${file.name}: ${d.grads.length} gradient${d.grads.length === 1 ? '' : 's'}. Ctrl+Z goes back.`);
  } catch (err) {
    console.error(err);
    toast(`Could not open ${file.name}.`);
  }
}
ui.open.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { const f = ui.file.files[0]; ui.file.value = ''; if (f) openFile(f); });
ui.save.addEventListener('click', saveJson);
ui.newDoc.addEventListener('click', () => {
  state.grads = [presetGradient(PRESETS[4])];
  state.grads[0].name = 'Gradient 1';
  state.out = { ...DEF_OUT };
  state.sel = state.grads[0].id; state.stop = 0;
  fixSelection(); commit(); schedule();
  toast('Started over. Ctrl+Z brings the previous gradients back.');
});
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

// Drag and drop a .json or exported .png anywhere on the page.
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; ui.drop.hidden = false; } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; ui.drop.hidden = true; } });
addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; ui.drop.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

/* ---------- keyboard */
addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), typing = isTyping(document.activeElement);
  if (mod && k === 'z' && !e.shiftKey) { if (typing) return; e.preventDefault(); undo(); return; }
  if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { if (typing) return; e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveJson(); return; }
  if (mod && k === 'e') { e.preventDefault(); exportPng(); return; }
  if (mod || e.altKey || typing || e.defaultPrevented) return;
  const g = selGrad(), i = g.stops.findIndex((s) => s.id === state.stop);
  if (k === 'r') randomize();
  else if (e.key === '[' || e.key === ']') {
    const j = clamp(i + (e.key === '[' ? -1 : 1), 0, g.stops.length - 1);
    selectStop(g.stops[j].id, true);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && (document.activeElement === document.body || e.target.closest?.('.editor'))) {
    if (state.stop && removeStop(state.stop)) { commit(); schedule(); }
    e.preventDefault();
  }
});

/* ---------- size and theme changes */
const resizeWatch = new ResizeObserver(() => schedule());
resizeWatch.observe($('.center'));
resizeWatch.observe($('.gbar-frame'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  // Thumbnails and presets have the checkerboard baked in; redraw them in the new colors.
  listKey = ''; presetKey = '';
  schedule();
});
addEventListener('pagehide', flushSave);

/* ---------- start */
loadSaved();
resetHistory();
setView(state.view.mode);
