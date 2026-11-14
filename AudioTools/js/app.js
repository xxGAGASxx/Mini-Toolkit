'use strict';
// Startup, the render loop, long jobs, tools (apply and preview), opening files, export, keyboard.

const ui = {
  undo: $('#btn-undo'), redo: $('#btn-redo'), open: $('#btn-open'), stats: $('#stats'), file: $('#file'), drop: $('#drop'),
  empty: $('#empty'), play: $('#t-play'), loop: $('#t-loop'), pos: $('#t-pos'), selTxt: $('#t-sel'), hover: $('#t-hover'),
  job: $('#job'), jobLabel: $('#job-label'), jobBar: $('#job-bar'), jobCancel: $('#job-cancel'),
  exSave: $('#ex-save'), exSize: $('#ex-size'), exExt: $('#ex-ext'), exName: $('#ex-name'), exNote: $('#ex-note'), exWhat: $('#ex-what'),
};

/* ---------- render loop: schedule() syncs and redraws everything, drawSoon() only the waveform */
let frameReq = 0, needFull = false, busy = false;
function schedule() { needFull = true; if (!frameReq) frameReq = requestAnimationFrame(frame); }
function drawSoon() { if (!frameReq) frameReq = requestAnimationFrame(frame); }
function frame() {
  frameReq = 0;
  if (needFull) { needFull = false; render(); } else { drawView(); syncReadout(); }
  if (player.playing) {
    const ph = playheadPos();
    if (ph !== null && !drag && !ovDrag) reveal(ph);
    drawSoon();
  }
}
onHistory = schedule;
// When playback ends on its own, a finished preview is over too (so its button starts a new one).
onPlayChange = () => { if (!player.playing && !pv.rendering) pv.id = null; schedule(); };

function render() {
  layout();
  syncPanels();
  renderTop();
  renderExport();
  ui.empty.hidden = !!state.audio;
  drawView();
  syncReadout();
}

const peakCacheDb = new WeakMap();
function filePeak(a) { let p = peakCacheDb.get(a); if (p === undefined) { p = peakOf(a.ch); peakCacheDb.set(a, p); } return p; }
function renderTop() {
  ui.undo.disabled = !hist.past.length || busy;
  ui.redo.disabled = !hist.future.length || busy;
  ui.open.disabled = busy;
  const a = state.audio;
  ui.play.disabled = ui.loop.disabled = !a;
  ui.loop.setAttribute('aria-pressed', String(state.loop));
  const playing = player.playing && !player.preview;
  ui.play.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  ui.play.classList.toggle('on', playing);
  if (!a) { ui.stats.textContent = 'No audio'; ui.stats.classList.remove('warn'); return; }
  const pk = filePeak(a);
  ui.stats.textContent = [state.name, fmtRate(a.sr), chanName(a.ch.length), fmtTime(durOf(a), 2), `peak ${fmtDb(gainToDb(pk))}`].join(' · ');
  ui.stats.classList.toggle('warn', pk > 1);
  ui.stats.title = pk > 1 ? 'Some samples go past full scale and will clip when saved as 16 or 24-bit, MP3, FLAC or Opus. Normalize (Edit tab) to fix.' : '';
}
// Position, selection and pointer time above the waveform. hover: a sample under the pointer, null when it
// leaves, undefined to keep the last one.
let hoverAt = null;
function syncReadout(hover) {
  if (hover !== undefined) hoverAt = hover;
  const a = state.audio;
  if (!a) { ui.pos.textContent = '0:00.000'; ui.selTxt.textContent = ''; ui.hover.textContent = ''; return; }
  const ph = playheadPos();
  ui.pos.textContent = fmtTime((ph !== null ? ph : state.cursor) / a.sr);
  ui.selTxt.textContent = hasSel() ? `${fmtTime(state.sel.a / a.sr)} – ${fmtTime(state.sel.b / a.sr)}  (${fmtSecs((state.sel.b - state.sel.a) / a.sr)})` : '';
  ui.hover.textContent = hoverAt !== null && hoverAt >= 0 && hoverAt <= lenOf(a) ? `pointer ${fmtTime(hoverAt / a.sr)}` : '';
}

/* ---------- long jobs, with a progress bar and Cancel */
let currentJob = null;
async function runJob(label, fn) {
  if (busy) return;
  busy = true;
  const job = new Job((f) => { ui.jobBar.style.width = `${Math.round(f * 100)}%`; });
  currentJob = job;
  ui.jobLabel.textContent = label;
  ui.jobBar.style.width = '0%';
  ui.job.hidden = false;
  schedule();
  await nextPaint();
  try { await fn(job); }
  catch (err) {
    if (err && err.cancelled) toast('Cancelled.');
    else { console.error(err); toast(`${label.replace(/…$/, '')} failed: ${err.message || err}.`); }
  } finally {
    busy = false; currentJob = null; ui.job.hidden = true;
    schedule();
  }
}
ui.jobCancel.addEventListener('click', () => { if (currentJob) currentJob.cancelled = true; });

/* ---------- tools: what each Apply / Preview runs */
async function runSpeed({ sr, ch }, p, job) {
  const rate = p.pct / 100;
  if (Math.abs(rate - 1) < 1e-4) throw new Error('set a speed other than 100%');
  return { ch: p.keep ? await stretch(ch, sr, rate, 0, false, job) : await varispeed(ch, rate, job), pre: 0 };
}
async function runPitch({ sr, ch }, p, job) {
  const semis = p.semis + p.cents / 100;
  if (Math.abs(semis) < 1e-3) throw new Error('set a pitch change first');
  return { ch: await stretch(ch, sr, 1, semis, p.formants, job), pre: 0 };
}
function runFilter(input, p, job) {
  if (!p.lowOn && !p.highOn) throw new Error('turn on Low cut or High cut');
  return fxFilter(input, p, job);
}
const TOOLS = {
  reverb: { label: 'Reverb', run: fxReverb, mode: 'mix' },
  delay: { label: 'Delay', run: fxDelay, mode: 'mix' },
  echo: { label: 'Echo', run: fxEcho, mode: 'mix' },
  dist: { label: 'Distortion', run: fxDistortion, mode: 'replace', xfade: true },
  comp: { label: 'Compressor', run: fxCompressor, mode: 'replace', xfade: true },
  speed: { label: 'Speed change', run: runSpeed, mode: 'replace' },
  pitch: { label: 'Pitch change', run: runPitch, mode: 'replace', xfade: true },
  nr: { label: 'Noise reduction', run: (i, p, j) => fxNoise(i, p, j, state.profile), mode: 'replace', xfade: true },
  hum: { label: 'Hum removal', run: fxHum, mode: 'replace', xfade: true },
  filt: { label: 'Filter', run: runFilter, mode: 'replace', xfade: true },
};
const inputOf = (s, e) => ({ sr: state.audio.sr, ch: state.audio.ch.map((d) => d.subarray(s, e)) });

function applyTool(id) {
  const T = TOOLS[id];
  if (!state.audio || busy) return;
  stopAll();
  const [s, e] = range(), sel = hasSel(), p = clonePar(state.fx[id]);
  runJob(`${T.label}…`, async (job) => {
    const res = await T.run(inputOf(s, e), p, job);
    const r = placeResult(state.audio, state.markers, s, e, res, T.mode, T.xfade ? Math.round(0.004 * state.audio.sr) : 0);
    const m = res.ch[0].length, newSel = sel ? (T.mode === 'replace' ? [s, s + m] : [s + r.shift, e + r.shift]) : null;
    const cursor = state.cursor >= e ? state.cursor + (T.mode === 'replace' ? m - (e - s) : r.shift) : state.cursor + r.shift;
    const loud = peakOf(res.ch) > 1 ? ' Some samples now go past full scale: Normalize (Edit tab) brings them back.' : '';
    setDoc(r.audio, r.markers, newSel, cursor, `${T.label} applied to ${sel ? 'the selection' : 'the whole file'}.${res.note ? ` ${res.note}.` : ''}${loud}`);
  });
}

/* ---------- preview: render the tool on (up to 20 s of) the selection or from the cursor, and play it.
   Moving a setting while it plays renders again and carries on from the same point. */
const pv = { id: null, rendering: null, job: null, timer: 0 };
function stopAll() {
  if (pv.job) pv.job.cancelled = true;
  clearTimeout(pv.timer);
  pv.id = pv.rendering = pv.job = null;
  stopPlayback();
  schedule();
}
function previewTool(id) {
  if (!state.audio || busy) return;
  if (pv.id === id) { stopAll(); return; }
  stopAll();
  pv.id = id;
  renderPreview(0);
}
function previewChanged(sec) {
  if (pv.id !== sec) return;
  clearTimeout(pv.timer);
  pv.timer = setTimeout(() => {
    const p = playedPos(), f = p !== null && player.to > player.from ? (p - player.from) / (player.to - player.from) : 0;
    renderPreview(f);
  }, 220);
}
async function renderPreview(frac) {
  const id = pv.id, T = TOOLS[id], a = state.audio, sr = a.sr, n = lenOf(a);
  if (!T || !a) return;
  let [s, e] = hasSel() ? range() : [state.cursor, n];
  if (e - s < sr * 0.3) { s = 0; e = n; }
  e = Math.min(e, s + 20 * sr);
  if (pv.job) pv.job.cancelled = true;
  const job = new Job(null);
  pv.job = job; pv.rendering = id;
  schedule();
  try {
    const res = await T.run(inputOf(s, e), clonePar(state.fx[id]), job);
    if (pv.job !== job) return;
    const audio = makeAudio(sr, adaptChannels(res.ch, a.ch.length)), m = lenOf(audio), pre = res.pre || 0, span = e - s;
    const map = T.mode === 'replace' && m !== span ? (x) => s + x * span / m : (x) => s - pre + x;
    pv.rendering = null;
    startPlayback(audio, Math.round(clamp(frac, 0, 0.98) * m), m, { loop: state.loop, map, preview: id });
  } catch (err) {
    if (pv.job !== job) return;
    pv.id = pv.rendering = null;
    if (!(err && err.cancelled)) toast(`${T.label}: ${err.message || err}.`);
    schedule();
  }
}

/* ---------- playback */
function playFromCursor() {
  const a = state.audio;
  if (!a) return;
  pv.id = null;
  if (hasSel()) { startPlayback(a, state.sel.a, state.sel.b, { loop: state.loop }); return; }
  let from = state.cursor;
  if (from >= lenOf(a) - a.sr * 0.05) from = state.cursor = 0;
  startPlayback(a, from, lenOf(a), { loop: state.loop });
}
function togglePlay() {
  if (!state.audio) return;
  if (player.playing) stopAll(); else { stopAll(); playFromCursor(); }
}
ui.play.addEventListener('click', togglePlay);
ui.loop.addEventListener('click', () => {
  state.loop = !state.loop;
  savePrefs();
  if (player.playing) { if (player.preview) previewChanged(player.preview); else playFromCursor(); }
  schedule();
});
ui.undo.addEventListener('click', () => { stopAll(); undo(); });
ui.redo.addEventListener('click', () => { stopAll(); redo(); });
$('#t-start').addEventListener('click', () => { if (!state.audio) return; state.cursor = 0; state.sel = null; reveal(0); if (player.playing && !player.preview) playFromCursor(); schedule(); });
$('#z-fit').addEventListener('click', fitView);
$('#z-sel').addEventListener('click', zoomToSel);
$('#z-in').addEventListener('click', () => stepZoom(1));
$('#z-out').addEventListener('click', () => stepZoom(-1));

/* ---------- buttons */
const ACTIONS = {
  selall: () => { setSel(0, lenOf(state.audio)); schedule(); },
  selnone: () => { state.sel = null; schedule(); },
  selregion: () => { const r = regionsOf(state.markers, lenOf(state.audio)).find(([a, b]) => state.cursor >= a && state.cursor < b); if (r) { setSel(r[0], r[1]); schedule(); } },
  zoomsel: zoomToSel,
  cut: doCut, copy: doCopy, paste: doPaste, delete: () => doDelete(), trim: doTrim, silence: doSilence, insert: doInsertSilence,
  split: doSplit, unsplit: doClearSplits, autosplit: doAutoSplit, trimsil: doTrimSilence,
  reverse: doReverse, fadein: () => doFade(false), fadeout: () => doFade(true), gain: doGain, normalize: doNormalize,
  mono: doMono, stereo: doStereo, swap: doSwap,
  learn: () => {
    if (!needSel('learn the noise from')) return;
    const [s, e] = range();
    runJob('Learning the noise…', async (job) => {
      state.profile = await learnNoise(inputOf(s, e), job);
      toast(`Learned the noise from ${fmtSecs((e - s) / state.audio.sr)}. Now select what to clean (or nothing, for the whole file) and Apply.`);
    });
  },
  forget: () => { state.profile = null; previewChanged('nr'); schedule(); },
};
addEventListener('click', (e) => {
  const b = e.target.closest('[data-act],[data-apply],[data-preview]');
  if (!b || b.disabled) return;
  if (b.dataset.act) ACTIONS[b.dataset.act]();
  else if (b.dataset.apply) applyTool(b.dataset.apply);
  else previewTool(b.dataset.preview);
});

/* ---------- opening */
function setAudio(audio, markers, name) {
  stopAll();
  state.audio = audio; state.markers = markers || []; state.name = stripExt(name) || 'audio';
  state.sel = null; state.cursor = 0; state.profile = null; state.ex.name = '';
  view.fit = true;
  resetHistory();
  schedule();
  toast(`Opened ${name}: ${fmtTime(durOf(audio), 2)}, ${fmtRate(audio.sr)}, ${chanName(audio.ch.length).toLowerCase()}${markers && markers.length ? `, ${markers.length} cue markers as splits` : ''}.`);
}
async function openFile(file) {
  if (!file || busy) return;
  if (state.audio && dirty && !confirm('Open another file? Your edits to this one are not exported, and undo history is cleared.')) return;
  if (file.size > 1024 * 1024 * 1024) { toast('That file is too large (over 1 GB).'); return; }
  await runJob(`Opening ${file.name}…`, async () => {
    const { audio, markers } = await decodeAudioFile(file);
    if (lenOf(audio) > audio.sr * 60 * 60) throw new Error('files over an hour long are not supported');
    setAudio(audio, markers, file.name);
  });
}
ui.open.addEventListener('click', () => ui.file.click());
$('#e-open').addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { const f = ui.file.files[0]; ui.file.value = ''; openFile(f); });
$('#e-beat').addEventListener('click', () => setAudio(sampleBeat(), [], 'sample-beat.wav'));
$('#e-noisy').addEventListener('click', () => setAudio(sampleNoisy(), [], 'sample-noisy-voice.wav'));

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

/* ---------- export */
function exportParts() {
  const a = state.audio, n = lenOf(a), ex = state.ex;
  if (ex.what === 'regions' && state.markers.length) return regionsOf(state.markers, n);
  if (ex.what === 'sel' && hasSel()) return [[state.sel.a, state.sel.b]];
  return [[0, n]];
}
function renderExport() {
  const ex = state.ex, f = FORMATS[ex.fmt], a = state.audio;
  ui.exExt.textContent = '.' + (ex.what === 'regions' && a && state.markers.length ? 'zip' : f.ext);
  ui.exName.placeholder = state.name;
  ui.exWhat.options[1].disabled = !hasSel();
  ui.exWhat.options[2].disabled = !state.markers.length;
  $('#ex-fmt').options[3].disabled = opusOk === false;
  $('#ex-dither-row').hidden = !((ex.fmt === 'wav' && ex.wavBits === '16') || (ex.fmt === 'flac' && ex.flacBits === '16'));
  ui.exSave.disabled = !a || busy;
  if (!a) { ui.exSize.textContent = ''; ui.exNote.hidden = true; return; }
  const parts = exportParts(), samples = parts.reduce((t, [s, e]) => t + e - s, 0);
  const C = ex.chans === 'mono' ? 1 : ex.chans === 'stereo' ? 2 : Math.min(ex.fmt === 'mp3' || ex.fmt === 'opus' ? 2 : 99, a.ch.length);
  const sr = outRate(ex.fmt, Number(ex.rate) || a.sr), secs = samples / a.sr;
  const bytes = ex.fmt === 'wav' ? secs * sr * C * Number(ex.wavBits) / 8 : ex.fmt === 'flac' ? secs * sr * C * Number(ex.flacBits) / 8 * 0.6
    : secs * Number(ex.fmt === 'mp3' ? ex.mp3Kbps : ex.opusKbps) * 125;
  ui.exSize.textContent = `${parts.length > 1 ? `${parts.length} files, ` : ''}${fmtSecs(secs)}, ${ex.fmt === 'flac' ? 'about ' : '~'}${fmtBytes(Math.round(bytes))}`;
  const notes = [];
  if (ex.what === 'sel' && !hasSel()) notes.push('Nothing is selected, so the whole file is exported.');
  if (ex.what === 'regions' && !state.markers.length) notes.push('There are no splits, so the whole file is exported. Add splits in the Edit tab.');
  if (ex.what === 'regions' && state.markers.length) notes.push(`Each region becomes its own file, numbered, in one ZIP.`);
  if (ex.fmt === 'mp3') notes.push('MP3 adds a few milliseconds of silence at the start, so it can\'t loop seamlessly. For game loops, use WAV, FLAC or Opus.');
  if (ex.fmt === 'opus') notes.push(opusOk === false ? 'This browser has no Opus encoder.' : 'Opus always plays at 48 kHz; most game engines import Ogg Vorbis rather than Opus, so check yours.');
  const wanted = Number(ex.rate) || a.sr;
  if (sr !== wanted && ex.fmt !== 'opus') notes.push(`${f.label} can't store ${fmtRate(wanted)}: saved at ${fmtRate(sr)}.`);
  if (filePeak(a) > 1 && !(ex.fmt === 'wav' && ex.wavBits === '32')) notes.push('Some samples go past full scale and will clip. Normalize first (Edit tab), or use 32-bit float WAV.');
  ui.exNote.textContent = notes.join(' ');
  ui.exNote.hidden = !notes.length;
}
function doExport() {
  if (!state.audio || busy) return;
  stopAll();
  const ex = clonePar(state.ex), f = FORMATS[ex.fmt], base = fileSafe(ex.name || state.name), parts = exportParts(), a = state.audio, n = lenOf(a);
  runJob('Exporting…', async (job) => {
    const blobs = [];
    for (let i = 0; i < parts.length; i++) {
      const [s, e] = parts[i], whole = s === 0 && e === n;
      const piece = whole ? a : sliceAudio(a, s, e), markers = parts.length > 1 ? [] : state.markers.filter((m) => m > s && m < e).map((m) => m - s);
      blobs.push(await encodeAudio(piece, ex, job.part(i / parts.length, 1 / parts.length), markers));
    }
    let blob, name;
    if (parts.length > 1) {
      const w = String(parts.length).length;
      blob = await makeZip(blobs.map((b, i) => ({ name: `${base}-${String(i + 1).padStart(Math.max(2, w), '0')}.${f.ext}`, blob: b })));
      name = `${base}.zip`;
    } else { blob = blobs[0]; name = `${base}.${f.ext}`; }
    saveBlob(blob, name);
    dirty = false;
    toast(`Saved ${name} (${parts.length > 1 ? `${parts.length} files, ` : ''}${fmtBytes(blob.size)}).`);
  });
}
ui.exSave.addEventListener('click', doExport);

/* ---------- keyboard */
addEventListener('keydown', (e) => {
  const cmd = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), typing = isTyping(document.activeElement);
  if (e.key === 'Escape' && busy && currentJob) { currentJob.cancelled = true; return; }
  if (cmd && k === 'o') { e.preventDefault(); ui.file.click(); return; }
  if (!state.audio) return;
  if (cmd && k === 'e') { e.preventDefault(); doExport(); return; }
  if (typing || busy) return;
  if (cmd && k === 'z' && !e.shiftKey) { e.preventDefault(); stopAll(); undo(); return; }
  if (cmd && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); stopAll(); redo(); return; }
  if (cmd && k === 'a') { e.preventDefault(); ACTIONS.selall(); return; }
  if (cmd && k === 'x') { e.preventDefault(); doCut(); return; }
  if (cmd && k === 'c') { if (hasSel()) { e.preventDefault(); doCopy(); } return; }
  if (cmd && k === 'v') { e.preventDefault(); doPaste(); return; }
  if (cmd && k === 't') { e.preventDefault(); doTrim(); return; }
  if (cmd && k === 'l') { e.preventDefault(); doSilence(); return; }
  if (cmd || e.altKey) return;
  const ae = document.activeElement, onPage = !ae || ae === document.body || ae === cv || ae.tagName === 'BUTTON';
  if (e.key === ' ') {
    // Space plays and stops, unless a control has focus and needs it (a button or checkbox to press).
    if (ae && ae !== document.body && ae !== cv && ae !== ui.play && ['BUTTON', 'INPUT', 'SELECT'].includes(ae.tagName)) return;
    e.preventDefault();
    if (!e.repeat) togglePlay();
    return;
  }
  if (!onPage && !['Escape', 'Delete', 'Backspace'].includes(e.key)) return;
  if (e.key === 'Escape') { if (player.playing || pv.id) stopAll(); else { state.sel = null; schedule(); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (hasSel()) { e.preventDefault(); doDelete(); } return; }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : lenOf(state.audio);
    if (e.shiftKey) setSel(hasSel() ? (to === 0 ? state.sel.b : state.sel.a) : state.cursor, to); else { state.cursor = to; state.sel = null; }
    reveal(to); schedule();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1, step = Math.max(1, Math.round(view.spp * (e.shiftKey ? 1 : 10)));
    state.cursor = clamp(state.cursor + dir * step, 0, lenOf(state.audio));
    state.sel = null; reveal(state.cursor);
    if (player.playing && !player.preview) playFromCursor();
    schedule();
    return;
  }
  if (k === 's') doSplit();
  else if (k === 'l') ui.loop.click();
  else if (k === 'f') fitView();
  else if (k === 'z') zoomToSel();
  else if (e.key === '+' || e.key === '=') stepZoom(1);
  else if (e.key === '-' || e.key === '_') stepZoom(-1);
});
addEventListener('beforeunload', (e) => { if (state.audio && dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- size and theme changes */
new ResizeObserver(() => { layout(); baseKey = ovKey = ''; drawSoon(); }).observe(vp);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawSoon(); });

/* ---------- start */
for (const [v, label] of DIST_TYPES) $('#dist-type').add(new Option(label, v));
loadPrefs();
readColors();
resetHistory();
setTab(state.tab);
checkOpus().then(() => schedule());
schedule();
