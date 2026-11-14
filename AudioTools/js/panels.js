'use strict';
// Tabs and the settings inputs. Every input carries the name of the value it edits:
//   data-p  tool settings (state.fx), e.g. data-p="reverb.decay"
//   data-x  export settings (state.ex)
// Sliders with data-log="lo,hi" run on a logarithmic scale between lo and hi (the input itself goes 0..1000).
// Elements with data-show="p:dist.type=crush" (or != for "not"; alternatives joined by |) show only while it matches.

const BIND = { p: () => state.fx, x: () => state.ex };
const DEFS = { p: () => FX_DEF, x: () => EX_DEF };
const nsOf = (el) => (el.dataset.p ? 'p' : el.dataset.x ? 'x' : null);
const pathGet = (root, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
function pathSet(root, path, v) {
  const ks = path.split('.'), last = ks.pop(), o = ks.reduce((r, k) => r[k], root);
  o[last] = v;
  return o;
}

/* ---------- tabs and sub-tabs */
const tabBtns = $$('[role="tab"][data-tab]');
function setTab(id) {
  state.tab = TABS.includes(id) ? id : 'edit';
  for (const b of tabBtns) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $('#' + b.getAttribute('aria-controls')).hidden = !on;
  }
  $('.side-scroll').scrollTop = 0;
  savePrefs();
}
for (const b of tabBtns) b.addEventListener('click', () => setTab(b.dataset.tab));
$('.ttabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(state.tab), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  setTab(TABS[(i + step + TABS.length) % TABS.length]);
  tabBtns.find((b) => b.dataset.tab === state.tab).focus();
});
function syncSubtabs() {
  for (const grp of $$('[data-group]')) {
    const key = grp.dataset.group, btns = $$('[data-sub]', grp);
    if (!btns.some((b) => b.dataset.sub === state[key])) state[key] = btns[0].dataset.sub;
    for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.sub === state[key]));
    for (const p of $$('[data-subpanel]', grp.parentElement)) p.hidden = p.dataset.subpanel !== state[key];
  }
}
addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]');
  if (!b) return;
  state[b.closest('[data-group]').dataset.group] = b.dataset.sub;
  savePrefs();
  schedule();
});

/* ---------- reading and writing inputs */
const nice = (v) => (v < 10 ? Math.round(v * 10) / 10 : v < 100 ? Math.round(v) : v < 1000 ? Math.round(v / 5) * 5 : Math.round(v / 50) * 50);
const logRange = (el) => el.dataset.log.split(',').map(Number);
function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.log) { const [lo, hi] = logRange(el); return nice(lo * Math.pow(hi / lo, clamp(parseFloat(el.value) / 1000, 0, 1))); }
  if (el.type === 'range' || el.type === 'number' || el.hasAttribute('data-num')) {
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) return null;
    if (el.min !== '') v = Math.max(v, parseFloat(el.min));
    if (el.max !== '') v = Math.min(v, parseFloat(el.max));
    return v;
  }
  return el.value;
}
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const FMT = {
  db: (v) => `${sign(v)}${Math.abs(v)} dB`,
  dbu: (v) => `${v} dB`,                 // an amount, not a level: no sign
  ms: (v) => `${v} ms`,
  s: (v) => `${v} s`,
  pct: (v) => `${v}%`,
  int: (v) => String(v),
  hz: (v) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} kHz` : `${v} Hz`),
  tone: (v) => (v >= 20000 ? 'Off' : FMT.hz(v)),
  st: (v) => `${sign(v)}${Math.abs(v)} st`,
  ct: (v) => `${sign(v)}${Math.abs(v)} ct`,
  ratio: (v) => (v >= 20 ? '∞ : 1' : `${v} : 1`),
  speed: (v) => `${+v.toFixed(1)}%`,
  bands: (v) => (v ? String(v) : 'Off'),
  bits: (v) => `${v} bit`,
};
function setInput(el, v) {
  if (v === undefined) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else if (el.dataset.log) {
    const [lo, hi] = logRange(el), raw = String(Math.round(1000 * Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo)));
    if (el.value !== raw && document.activeElement !== el) el.value = raw;
  } else if (el !== document.activeElement || el.type === 'range' || el.tagName === 'SELECT') {
    if (el.value !== String(v)) el.value = v;
  }
  if (el.type === 'range') {
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = (FMT[out.dataset.f] || String)(v);
  }
}
function showMatch(expr) {
  return expr.split('|').some((part) => {
    const m = /^(\w):([\w.]+)(!=|=)(.*)$/.exec(part.trim());
    if (!m) return true;
    const v = String(pathGet(BIND[m[1]](), m[2])), list = m[4].split(',');
    return m[3] === '=' ? list.includes(v) : !list.includes(v);
  });
}

// Changing a preset fills in its values; changing a value by hand makes the preset "Custom".
const PRESETS = { reverb: REVERB_PRESETS, comp: COMP_PRESETS };
function onField(el, done) {
  const ns = nsOf(el);
  if (!ns) return;
  const v = readInput(el);
  if (v === null) return;
  const path = el.dataset[ns], [sec, key] = path.split('.');
  pathSet(BIND[ns](), path, v);
  if (ns === 'p' && PRESETS[sec]) {
    const presetKeys = Object.keys(Object.values(PRESETS[sec])[0]);
    if (key === 'preset' && PRESETS[sec][v]) Object.assign(state.fx[sec], PRESETS[sec][v]);
    else if (presetKeys.includes(key)) state.fx[sec].preset = 'custom';
  }
  if (ns === 'p' && sec === 'comp' && key === 'makeup') state.fx.comp.auto = false;
  if (ns === 'p') previewChanged(sec);
  if (done || el.type === 'range') savePrefs();
  schedule();
}
addEventListener('input', (e) => { if (e.target.dataset && !e.target.dataset.time) onField(e.target, false); });
addEventListener('change', (e) => { if (e.target.dataset && !e.target.dataset.time) onField(e.target, true); });

// Double-click a slider: back to its default.
addEventListener('dblclick', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'range') return;
  const ns = nsOf(el);
  if (!ns) return;
  const def = pathGet(DEFS[ns](), el.dataset[ns]);
  if (def === undefined) return;
  pathSet(BIND[ns](), el.dataset[ns], def);
  if (ns === 'p') previewChanged(el.dataset.p.split('.')[0]);
  savePrefs();
  schedule();
});

// Quick-set chips: data-set="speed.pct=50"
addEventListener('click', (e) => {
  const b = e.target.closest('[data-set]');
  if (!b) return;
  const [path, val] = b.dataset.set.split('=');
  pathSet(state.fx, path, Number.isNaN(Number(val)) ? val : Number(val));
  previewChanged(path.split('.')[0]);
  savePrefs();
  schedule();
});

/* ---------- selection fields: type a start, end or length */
for (const el of $$('[data-time]')) {
  el.addEventListener('change', () => {
    if (!state.audio) return;
    const t = parseTime(el.value), sr = state.audio.sr;
    if (!Number.isFinite(t) || t < 0) { toast('Type a time like 1:23.4, 83.4 or 500ms.'); schedule(); return; }
    const s = Math.round(t * sr), [a, b] = hasSel() ? [state.sel.a, state.sel.b] : [state.cursor, state.cursor];
    if (el.dataset.time === 'a') setSel(s, Math.max(s, b));
    else if (el.dataset.time === 'b') setSel(Math.min(a, s), s);
    else setSel(a, a + s);
    if (hasSel()) reveal(state.sel.a);
    schedule();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
}
$('#speed-target').addEventListener('change', (e) => {
  if (!state.audio) return;
  const t = parseTime(e.target.value), [s, en] = range(), cur = (en - s) / state.audio.sr;
  if (!Number.isFinite(t) || t <= 0) { toast('Type a length like 2.5 or 0:02.5.'); return; }
  const pct = cur / t * 100;
  if (pct < 25 || pct > 400) { toast('That is more than 4× faster or slower: pick a length closer to the current one.'); return; }
  state.fx.speed.pct = pct;
  e.target.value = '';
  previewChanged('speed');
  schedule();
});

/* ---------- compressor curve */
function drawCompCurve() {
  const c = $('#comp-curve');
  if (!c || c.offsetParent === null) return;
  const size = c.clientWidth, [W, H, dpr] = fitCanvas(c, size, size), g = c.getContext('2d'), p = state.fx.comp;
  const X = (db) => (db + 60) / 60 * W, Y = (db) => H - (db + 60) / 60 * H;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = cssVar('--line'); g.lineWidth = dpr;
  for (let db = -48; db < 0; db += 12) { g.beginPath(); g.moveTo(X(db), 0); g.lineTo(X(db), H); g.moveTo(0, Y(db)); g.lineTo(W, Y(db)); g.stroke(); }
  g.setLineDash([3 * dpr, 3 * dpr]); g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke(); g.setLineDash([]);
  g.strokeStyle = cssVar('--accent'); g.lineWidth = 2 * dpr; g.beginPath();
  for (let i = 0; i <= 120; i++) { const x = -60 + i / 2, y = compCurve(x, p); if (i) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); }
  g.stroke();
  g.fillStyle = cssVar('--muted'); g.font = `${9.5 * dpr}px ${cssVar('--mono')}`;
  g.fillText('in →', W - 30 * dpr, H - 5 * dpr); g.fillText('out', 4 * dpr, 11 * dpr);
}

/* ---------- everything shown in the panels */
function syncPanels() {
  for (const el of $$('[data-p],[data-x]')) { const ns = nsOf(el); setInput(el, pathGet(BIND[ns](), el.dataset[ns])); }
  for (const el of $$('[data-show]')) el.hidden = !showMatch(el.dataset.show);
  syncSubtabs();
  const a = state.audio, sr = a ? a.sr : 1, sel = hasSel();
  // selection fields
  const [s, e] = a ? (sel ? [state.sel.a, state.sel.b] : [state.cursor, state.cursor]) : [0, 0];
  const put = (id, v) => { const el = $(id); if (el !== document.activeElement) el.value = a ? v : ''; };
  put('#sel-start', fmtTime(s / sr)); put('#sel-end', fmtTime(e / sr)); put('#sel-len', fmtTime((e - s) / sr));
  // what the tools work on
  $('#target').innerHTML = !a ? 'Open a file to start.'
    : sel ? `Tools work on the <b>selection</b>: ${fmtTime(s / sr)} – ${fmtTime(e / sr)} (${fmtSecs((e - s) / sr)}).`
      : `Nothing selected: tools work on the <b>whole file</b> (${fmtSecs(lenOf(a) / sr)}).`;
  // buttons
  for (const b of $$('[data-act],[data-apply],[data-preview]')) {
    const need = b.dataset.need;
    b.disabled = !a || busy || (need === 'sel' && !sel) || (need === 'clip' && !state.clip);
  }
  for (const b of $$('[data-preview]')) {
    const on = player.preview === b.dataset.preview || pv.rendering === b.dataset.preview;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('span').textContent = on ? 'Stop' : 'Preview';
  }
  $('#clip-info').textContent = state.clip ? `Clipboard: ${fmtSecs(lenOf(state.clip) / state.clip.sr)}. Paste inserts it at the cursor, or over the selection.` : 'Paste inserts at the cursor, or over the selection.';
  $('#split-info').textContent = a ? (state.markers.length ? `${state.markers.length} split${state.markers.length > 1 ? 's' : ''}, ${state.markers.length + 1} regions.` : 'No splits yet.') : '';
  if (a) {
    const [rs, re] = range(), pk = peakOf(a.ch, rs, re);
    $('#level-info').textContent = `${sel ? 'Selection' : 'File'} peak: ${fmtDb(gainToDb(pk))}${pk > 1 ? ' (clipping)' : ''}.`;
    const sp = state.fx.speed, cur = (re - rs) / sr, rate = sp.pct / 100;
    $('#speed-info').textContent = `${fmtSecs(cur)} → ${fmtSecs(cur / rate)}${sp.keep ? '' : `; pitch ${fmtSemis(12 * Math.log2(rate))}, like a tape`}.`;
  } else { $('#level-info').textContent = ''; $('#speed-info').textContent = ''; }
  const pr = state.profile;
  $('#nr-profile').textContent = pr ? `Noise profile: learned from ${fmtSecs(pr.secs)} of noise.` : 'No noise profile: the noise is estimated from the quietest moments.';
  $('#nr-forget').hidden = !pr;
  drawCompCurve();
}
const fmtSemis = (st) => `${sign(Math.round(st * 10) / 10)}${Math.abs(Math.round(st * 10) / 10)} semitones`;
