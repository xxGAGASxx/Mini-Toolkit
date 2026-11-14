'use strict';
// Startup, the render loop, opening files (button, drop, paste), export, Bake / Reset, keyboard shortcuts.

const ui = {
  undo: $('#btn-undo'), redo: $('#btn-redo'), open: $('#btn-open'), bake: $('#btn-bake'), reset: $('#btn-reset'),
  stats: $('#stats'), file: $('#file'), drop: $('#drop'), empty: $('#empty'),
  exSave: $('#ex-save'), exCopy: $('#ex-copy'), exSize: $('#ex-size'), exExt: $('#ex-ext'), exName: $('#ex-name'),
  exAlpha: $('#ex-alpha'), exMatteRow: $('#ex-matte-row'), exNote: $('#ex-note'),
};

/* ---------- render loop: schedule() reprocesses and redraws everything, drawSoon() only the view */
let frameReq = 0, needFull = false, busy = false;
function schedule() { needFull = true; if (!frameReq) frameReq = requestAnimationFrame(frame); }
function drawSoon() { if (!frameReq) frameReq = requestAnimationFrame(frame); }
function frame() {
  frameReq = 0;
  if (needFull) { needFull = false; render(); } else drawView();
}
onHistory = schedule;

const currentOutput = () => (state.base ? runPipeline(state.base, state.p) : null);

function render() {
  const out = currentOutput();
  if (out) setShown(out, state.base);
  else shown.out = shown.base = null;
  syncPanels();
  syncTools();
  renderTop(out);
  renderExport(out);
  ui.empty.hidden = !!state.base;
  drawView();
}

function renderTop(out) {
  ui.undo.disabled = !canUndo();
  ui.redo.disabled = !hist.future.length;
  ui.bake.disabled = ui.reset.disabled = !state.base;
  const img = state.base;
  if (!img) { ui.stats.textContent = 'No image'; ui.stats.classList.remove('warn'); return; }
  const parts = [state.name, `${img.w} × ${img.h}`, imgHasAlpha(out) ? 'RGBA' : 'RGB'];
  if (out !== img) parts.push(`${Math.round(lastRun.ms)} ms`);
  if (lastRun.failed) parts.push(`${lastRun.failed} failed, skipped`);
  ui.stats.textContent = parts.join(' · ');
  ui.stats.classList.toggle('warn', !!lastRun.failed);
}

function renderExport(out) {
  const f = FORMATS[state.ex.fmt], mode = alphaModeFor(state.ex);
  ui.exExt.textContent = '.' + f.ext;
  ui.exName.placeholder = state.name;
  ui.exAlpha.options[0].disabled = !f.alpha;
  ui.exMatteRow.hidden = mode !== 'matte';
  ui.exSize.textContent = out ? `${out.w} × ${out.h}` : '';
  ui.exSave.disabled = ui.exCopy.disabled = !out || busy;
  // Say so when the export won't look like the view.
  let note = '';
  if (out && !f.alpha && imgHasAlpha(out)) note = 'JPEG has no transparency: see-through parts are filled with the background color.';
  else if (out && mode === 'drop' && imgHasAlpha(out)) note = 'Drop alpha makes every pixel opaque, showing the colors stored under transparent areas.';
  else if (state.p.off.on && (state.p.off.x % 100 || state.p.off.y % 100)) note = 'Offset (Tiling tab) is on, so the export is shifted.';
  ui.exNote.textContent = note;
  ui.exNote.hidden = !note;
}

/* ---------- export */
async function runBusy(fn) {
  if (busy) return;
  busy = true; schedule();
  await nextPaint();
  try { await fn(); } catch (err) { console.error(err); toast(`Failed: ${err.message || err}`); } finally { busy = false; schedule(); }
}
const exportImage = () => runBusy(async () => {
  const img = currentOutput();
  if (!img) return;
  const blob = await encodeImage(img, state.ex), name = `${fileSafe(state.ex.name || state.name)}.${FORMATS[state.ex.fmt].ext}`;
  saveBlob(blob, name);
  toast(`Saved ${name} (${img.w} × ${img.h}, ${fmtBytes(blob.size)}).`);
});
const copyImage = () => runBusy(async () => {
  if (!navigator.clipboard || typeof ClipboardItem !== 'function') throw new Error('this browser cannot copy images');
  const img = currentOutput();
  if (!img) return;
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': encodePng(img, true) })]);
  toast('Copied to the clipboard as PNG.');
});
ui.exSave.addEventListener('click', exportImage);
ui.exCopy.addEventListener('click', copyImage);

/* ---------- opening */
function setImage(img, name) {
  const first = !state.base;
  state.base = img;
  state.name = stripExt(name) || 'texture';
  state.ex.name = '';
  crop.on = false;
  view.fit = true;
  commit();
  if (first) hist.past = [];   // undo goes back to earlier images, never to the empty start screen
  schedule();
  const live = anyStageOn(state.p) ? ' The current settings apply to it too (Reset all clears them).' : '';
  toast(`Opened ${name}: ${img.w} × ${img.h}.${live}`);
}
async function openFile(file) {
  if (!file) return;
  if (file.size > 300 * 1024 * 1024) { toast('That file is too large.'); return; }
  try {
    setImage(await decodeFile(file), file.name);
  } catch (err) {
    console.error(err);
    toast(`Could not open ${file.name}: ${err.message || 'unknown format'}.`);
  }
}
ui.open.addEventListener('click', () => ui.file.click());
$('#e-open').addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { const f = ui.file.files[0]; ui.file.value = ''; openFile(f); });
$('#e-bricks').addEventListener('click', () => setImage(sampleBricks(), 'sample-bricks.png'));
$('#e-sprite').addEventListener('click', () => setImage(sampleSprite(), 'sample-gem.png'));

// Drop an image anywhere on the page.
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; ui.drop.hidden = false; } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; ui.drop.hidden = true; } });
addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; ui.drop.hidden = true;
  openFile(e.dataTransfer?.files?.[0]);
});

// Paste an image (a screenshot, or one copied from another app).
addEventListener('paste', (e) => {
  if (isTyping(document.activeElement)) return;
  const item = [...(e.clipboardData?.items || [])].find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  const f = item && item.getAsFile();
  if (!f) return;
  e.preventDefault();
  openFile(new File([f], f.name && f.name !== 'image.png' ? f.name : 'pasted.png', { type: f.type }));
});

/* ---------- Bake and Reset all */
ui.bake.addEventListener('click', () => {
  const out = currentOutput();
  if (!out) return;
  if (out === state.base) { toast('Nothing to bake: no Color, Effects or Tiling setting changes the image.'); return; }
  const wrap = state.p.wrap;
  state.base = out;
  state.p = clonePar(DEFAULTS);
  state.p.wrap = wrap;
  commit(); schedule();
  toast('Settings baked into the image and reset. Ctrl+Z undoes.');
});
ui.reset.addEventListener('click', () => {
  const wrap = state.p.wrap;
  state.p = clonePar(DEFAULTS);
  state.p.wrap = wrap;
  if (sameSnap(snapshot(), hist.cur)) { toast('Nothing to reset.'); return; }
  commit(); schedule();
  toast('All Color, Effects and Tiling settings reset. Ctrl+Z brings them back.');
});
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

/* ---------- keyboard */
addEventListener('keydown', (e) => {
  const cmd = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), typing = isTyping(document.activeElement);
  if (cmd && k === 'z' && !e.shiftKey) { if (typing) return; e.preventDefault(); undo(); return; }
  if (cmd && (k === 'y' || (k === 'z' && e.shiftKey))) { if (typing) return; e.preventDefault(); redo(); return; }
  if (cmd && k === 'o') { e.preventDefault(); ui.file.click(); return; }
  if (cmd && k === 'e') { e.preventDefault(); if (state.base) exportImage(); return; }
  if (k === 'enter' && crop.on && document.activeElement?.dataset?.crop) { e.preventDefault(); applyCrop(); return; }
  if (cmd || e.altKey || typing || e.defaultPrevented) return;
  if (k === 'escape' && crop.on) { cancelCrop(); return; }
  if (k === 'enter' && crop.on) { e.preventDefault(); applyCrop(); return; }
  const onPage = document.activeElement === document.body || document.activeElement === cv;
  if (e.key === ' ' && onPage) { e.preventDefault(); if (!spaceDown) { spaceDown = true; cv.style.cursor = 'grab'; } return; }
  if (e.key === '\\') { if (!e.repeat) setBefore(true); return; }
  if (k === 'f') fitView();
  else if (k === '1') zoomAt(1, vW / 2, vH / 2);
  else if (e.key === '+' || e.key === '=') stepZoom(1);
  else if (e.key === '-' || e.key === '_') stepZoom(-1);
  else if (k === 't') {
    state.view.tiled = !state.view.tiled;
    if (state.view.tiled) crop.on = false;
    view.fit = true; savePrefs(); schedule();
  }
});
addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
  if (e.key === '\\') setBefore(false);
});
addEventListener('blur', () => { spaceDown = false; setBefore(false); });

/* ---------- size and theme changes */
new ResizeObserver(() => drawSoon()).observe(vp);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { checkerKey = ''; drawSoon(); });

/* ---------- start */
loadPrefs();
resetHistory();
setTab(state.tab);
schedule();
