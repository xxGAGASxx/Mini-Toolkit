'use strict';
// Startup, keeping the picture up to date, files (new, open, save, export) and keyboard shortcuts.
//
// Picture updates: when a render is cheap it happens straight away. Otherwise a small draft is
// shown at once (sized to take about 30 ms, so sliders stay smooth) and the full render runs in
// the background once the settings stop changing for a moment.

const SYNC_COST = 6e5;       // renders below this much work (renderCost, about 25 ms) are done at once
const img = { shownKey: '', full: null, fullKey: '', task: null, timer: 0, budget: 120000, progress: 0, info: null, dims: '' };
let busy = false;            // exporting
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- redraw everything that depends on the document, once per frame */
let uiReq = 0;
function schedule() { if (!uiReq) uiReq = requestAnimationFrame(renderUI); }
function renderUI() {
  uiReq = 0;
  fixSel();
  renderLayers();
  renderLayerPanel();
  renderRamp();
  updateImage();
  renderDocPanel(img.info);
  renderStats();
  syncViewBar();
  const i = selIndex(), n = state.doc.layers.length;
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  $('#l-dup').disabled = $('#l-del').disabled = i < 0;
  $('#l-up').disabled = i < 0 || i === n - 1;
  $('#l-down').disabled = i <= 0;
  $('#l-add').disabled = n >= MAX_LAYERS;
  const name = $('#doc-name');
  if (document.activeElement !== name) name.value = state.doc.name;
  if (state.view.tab === 'texture') drawTex();
}

/* ---------- the picture */
function updateImage() {
  const doc = state.doc, key = renderKey(doc), sh = sheetOf(doc);
  if (key === img.shownKey) return;
  const dims = `${sh.sw}x${sh.sh}`;
  if (dims !== img.dims) { img.dims = dims; tv.fit = true; }
  cancelFull();
  if (sheetTooBig(sh)) {
    img.shownKey = key;
    img.info = null;
    clearResult();
    stageMsg(`The flipbook sheet would be ${sh.sw} × ${sh.sh} px, over the ${MAX_SHEET} px limit. Use smaller frames or fewer frames.`);
    return;
  }
  stageMsg('');
  img.shownKey = key;
  if (img.fullKey === key) { show(img.full, false); return; }
  const cost = renderCost(doc, doc.w, doc.h, doc.ss, sh.n);
  if (cost <= SYNC_COST) {
    setFull(key, runSync(renderDoc(doc, { w: doc.w, h: doc.h, ss: doc.ss })));
    return;
  }
  const f = Math.min(1, Math.sqrt(img.budget / renderCost(doc, doc.w, doc.h, 1, sh.n)));
  const t0 = performance.now();
  const draft = runSync(renderDoc(doc, { w: Math.max(4, Math.round(doc.w * f)), h: Math.max(4, Math.round(doc.h * f)), ss: 1 }));
  img.budget = clamp(img.budget * clamp(30 / Math.max(performance.now() - t0, 1), 0.5, 1.5), 15000, 600000);
  show(draft, true);
  img.timer = setTimeout(() => startFull(key), 220);
}
function show(res, draft) {
  img.info = res;
  showResult(res, draft);
}
function setFull(key, res) {
  img.full = res;
  img.fullKey = key;
  if (renderKey(state.doc) === key) { img.shownKey = key; show(res, false); }
}
function startFull(key) {
  const doc = clone(state.doc);
  if (renderKey(doc) !== key) return;
  img.progress = 0;
  img.task = runSliced(renderDoc(doc, { w: doc.w, h: doc.h, ss: doc.ss }), {
    progress: (p) => { img.progress = p; progressBar(p); renderStats(); },
    done: (res) => { img.task = null; progressBar(-1); setFull(key, res); renderDocPanel(img.info); renderStats(); },
    fail: (err) => { img.task = null; progressBar(-1); console.error(err); toast(`Render failed: ${err.message || err}`); renderStats(); },
  });
  renderStats();
}
function cancelFull() {
  clearTimeout(img.timer);
  if (img.task) img.task.cancel();
  img.task = null;
  progressBar(-1);
}
function progressBar(p) {
  const el = $('#progress');
  el.hidden = p < 0;
  if (p >= 0) el.firstElementChild.style.width = `${Math.round(p * 100)}%`;
}
function stageMsg(text) {
  const el = $('#stage-msg');
  el.hidden = !text;
  el.textContent = text;
}

function renderStats() {
  const doc = state.doc, sh = sheetOf(doc), on = doc.layers.filter((L) => L.on).length, big = sheetTooBig(sh);
  let s = doc.anim.on ? `${sh.n} frames of ${doc.w} × ${doc.h} · sheet ${sh.sw} × ${sh.sh} px` : `${doc.w} × ${doc.h} px`;
  s += ` · ${on} layer${on === 1 ? '' : 's'}`;
  if (img.task) s += ` · rendering ${Math.round(img.progress * 100)} %`;
  else if (busy) s += ' · exporting…';
  const el = $('#stats');
  el.textContent = s;
  el.classList.toggle('warn', big);
  $('#ex-png').disabled = $('#ex-copy').disabled = big || busy;
}

/* ---------- export */
// The full-quality render of the document as it is now: the finished one if it is current,
// otherwise a fresh render of a copy, so later edits do not change what gets exported.
function finalResult(doc) {
  const key = renderKey(doc);
  if (img.fullKey === key) return Promise.resolve(img.full);
  return new Promise((resolve, reject) => {
    runSliced(renderDoc(doc, { w: doc.w, h: doc.h, ss: doc.ss }), {
      progress: (p) => progressBar(p),
      done: (res) => { progressBar(-1); setFull(key, res); resolve(res); },
      fail: (err) => { progressBar(-1); reject(err); },
    });
  });
}
async function pngOf(doc, forClipboard) {
  const sh = sheetOf(doc), res = await finalResult(doc);
  const premul = doc.out.premul && (doc.color.mode === 'alpha' || doc.color.mode === 'ramp');
  if (forClipboard) return encodePng(sh.sw, sh.sh, to8(res, false, doc.out.dither), 8);
  const depth = doc.out.depth, px = depth === 16 ? to16(res, premul) : to8(res, premul, doc.out.dither);
  return encodePng(sh.sw, sh.sh, px, depth, { [APP_KEY]: JSON.stringify(doc), Software: 'VFX Texture Generator' });
}
function fileBase(doc) {
  const sh = sheetOf(doc);
  return doc.anim.on ? `${slug(doc.name)}-${sh.n}f-${sh.cols}x${sh.rows}` : `${slug(doc.name)}-${doc.w}x${doc.h}`;
}
async function runBusy(fn) {
  if (busy) return;
  if (sheetTooBig(sheetOf(state.doc))) { toast('The flipbook sheet is too large to export.'); return; }
  busy = true;
  renderStats();
  try { await fn(clone(state.doc)); } catch (err) { console.error(err); toast(`Failed: ${err.message || err}`); }
  finally { busy = false; renderStats(); }
}
const exportPng = () => runBusy(async (doc) => {
  const name = `${fileBase(doc)}.png`;
  saveBlob(await pngOf(doc, false), name);
  toast(`Exported ${name}`);
});
const copyImage = () => runBusy(async (doc) => {
  if (!navigator.clipboard || typeof ClipboardItem !== 'function') throw new Error('this browser cannot copy images');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(doc, true) })]);
  toast('Copied as an 8-bit PNG.');
});

/* ---------- files */
function saveJson() {
  const doc = state.doc;
  saveText(JSON.stringify(doc, null, 2), `${slug(doc.name)}.json`);
  toast(`Saved ${slug(doc.name)}.json`);
}
async function openFile(file) {
  try {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      setDoc(cleanDoc(JSON.parse(await file.text())));
      toast(`Opened ${file.name}`);
      return;
    }
    const text = readPngText(await file.arrayBuffer());
    if (text && has(text, APP_KEY)) {
      setDoc(cleanDoc(JSON.parse(text[APP_KEY])));
      toast(`Opened ${file.name}`);
    } else if (text || file.type.startsWith('image/')) {
      toast(`${file.name} was not made here, so it has no settings to open. To use its colors, pick Color ramp, then From image…`, 5000);
    } else toast(`${file.name} is not a .json file or a PNG from this tool.`);
  } catch (err) {
    console.error(err);
    toast(`Could not open ${file.name}: ${err.message || err}`);
  }
}
function newTexture() {
  const d = newDoc();
  d.out = { ...state.doc.out };
  d.ss = state.doc.ss;
  setDoc(d);
  toast('New texture. Ctrl+Z brings the last one back.');
}

/* ---------- keyboard */
const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const isTextField = (el) => isField(el) && !(el.tagName === 'INPUT' && ['checkbox', 'radio', 'range', 'color', 'button'].includes(el.type));
function setTab(tab) {
  const t = $(`#view-tabs [data-view="${tab}"]`);
  if (t) t.click();
}
function onKey(e) {
  const el = document.activeElement, k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (isTextField(el) && (k === 'z' || k === 'y')) return;   // the field's own undo
    const act = { z: e.shiftKey ? redo : undo, y: redo, s: saveJson, e: exportPng, o: () => $('#file').click(), d: dupLayer }[k];
    if (!act) return;
    e.preventDefault();
    act();
    return;
  }
  if (isField(el) || e.altKey || e.ctrlKey || e.metaKey) return;
  const L = selLayer();
  switch (e.key) {
    case 'Delete': case 'Backspace': deleteLayer(); break;
    case 'r': case 'R':
      if (L && GEN[L.type].seeded) { L.p.seed = Math.floor(Math.random() * 1e6); changed(true); }
      break;
    case 'h': case 'H': if (L) toggleLayer(L.id); break;
    case 'f': case 'F': fitTex(); drawTex(); break;
    case '1': setTab('texture'); break;
    case '2': setTab('preview'); break;
    case ' ':
      if (el !== document.body && el.tagName !== 'CANVAS') return;
      if (state.view.tab === 'texture') tv.space = true;
      else { state.view.playing = !state.view.playing; saveView(); syncViewBar(); }
      break;
    default: return;
  }
  e.preventDefault();
}

/* ---------- startup */
function init() {
  for (const b of $$('[data-icon]')) b.prepend(icon(b.dataset.icon));
  const restored = loadSaved();
  fixSel();
  resetHistory();
  onChange = schedule;

  initTexView();
  initPreview();
  initViewBar();
  initLayerList();
  initDocPanel();
  initRamp($('#ramp'));
  renderPresets();

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-new').addEventListener('click', newTexture);
  $('#btn-open').addEventListener('click', () => $('#file').click());
  $('#btn-save').addEventListener('click', saveJson);
  $('#ex-png').addEventListener('click', exportPng);
  $('#ex-copy').addEventListener('click', copyImage);
  $('#p-save').addEventListener('click', () => {
    const r = saveUserPreset();
    if (!r) { toast('This browser does not allow saving presets here.'); return; }
    renderPresets();
    toast(r === 'replaced' ? `Updated preset ${state.doc.name}.` : `Saved preset ${state.doc.name}. Rename the texture to save another.`);
  });
  const name = $('#doc-name');
  name.addEventListener('input', () => { state.doc.name = name.value.trim().slice(0, 60) || 'Untitled effect'; changed(); });
  name.addEventListener('change', () => changed(true));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  $('#file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) openFile(f);
  });

  // Drop a file anywhere: an image over the ramp becomes the ramp, anything else is opened.
  const drop = $('#drop');
  let depth = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; drop.hidden = false; } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    const overRamp = document.elementsFromPoint(e.clientX, e.clientY).some((x) => x.id === 'sec-color');
    if (overRamp && state.doc.color.mode === 'ramp' && f.type.startsWith('image/')) rampFromImage(f);
    else openFile(f);
  });

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', (e) => { if (e.key === ' ') tv.space = false; });
  new ResizeObserver(() => { if (tv.fit) fitTex(); drawTex(); }).observe($('#stage'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawTex());

  schedule();
  if (restored) toast('Restored your last texture.');
}
init();
