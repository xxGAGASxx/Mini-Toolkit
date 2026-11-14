'use strict';
// The tabs, and the settings inputs. Every input carries the name of the value it edits:
//   data-k  live Color / Effects / Tiling settings (state.p, undoable), e.g. data-k="bc.bri"
//   data-v  the tiled view (state.view)
//   data-x  export settings (state.ex)
// Elements with data-show="k:path=a,b" (or != for "not") are shown only while the value matches.

const BIND = { k: () => state.p, v: () => state.view, x: () => state.ex };
const DEFS = { k: () => DEFAULTS, v: () => VIEW_DEF, x: () => EX_DEF };
const nsOf = (el) => (el.dataset.k ? 'k' : el.dataset.v ? 'v' : el.dataset.x ? 'x' : null);
const pathGet = (root, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
function pathSet(root, path, v) {
  const ks = path.split('.'), last = ks.pop(), o = ks.reduce((r, k) => r[k], root);
  o[last] = v;
  return o;
}

/* ---------- tabs */
const tabBtns = $$('[role="tab"][data-tab]');
function setTab(id) {
  state.tab = TABS.includes(id) ? id : 'transform';
  for (const b of tabBtns) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $('#' + b.getAttribute('aria-controls')).hidden = !on;
  }
  $('.side-scroll').scrollTop = 0;
  savePrefs();
  drawSoon();   // the rotation preview only shows on the Transform tab
}
for (const b of tabBtns) b.addEventListener('click', () => setTab(b.dataset.tab));
$('.ttabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(state.tab), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  setTab(TABS[mod(i + step, TABS.length)]);
  tabBtns.find((b) => b.dataset.tab === state.tab).focus();
});

/* ---------- blend mode lists */
const BLEND_NAMES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['softlight', 'Soft light'], ['hardlight', 'Hard light'], ['add', 'Add'], ['subtract', 'Subtract'],
  ['difference', 'Difference'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color', 'Color'],
];
for (const sel of $$('.blend-sel')) for (const [v, label] of BLEND_NAMES) sel.add(new Option(label, v));

/* ---------- reading and writing inputs */
function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number' || el.hasAttribute('data-num')) {
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) return null;
    if (el.min !== '' && el.min !== undefined) v = Math.max(v, parseFloat(el.min));
    if (el.max !== '' && el.max !== undefined) v = Math.min(v, parseFloat(el.max));
    return v;
  }
  return el.value;
}

const FMT = {
  signed: (v) => (v > 0 ? '+' : '') + v,
  pct: (v) => v + '%',
  deg: (v) => v + '°',
  px: (v) => v + ' px',
  levels: (v) => (v < 2 ? 'Off' : String(v)),
};
function setInput(el, v) {
  if (v === undefined) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else if (el !== document.activeElement || el.type === 'range' || el.tagName === 'SELECT') {
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

function syncPanels() {
  for (const el of $$('[data-k],[data-v],[data-x]')) {
    const ns = nsOf(el);
    setInput(el, pathGet(BIND[ns](), el.dataset[ns]));
  }
  for (const sec of $$('[data-sec]')) sec.classList.toggle('off', !state.p[sec.dataset.sec].on);
  for (const el of $$('[data-show]')) el.hidden = !showMatch(el.dataset.show);
  $('#pat-name').textContent = assets.pattern ? `${assets.pattern.name} · ${assets.pattern.w} × ${assets.pattern.h}` : 'none';
}

/* ---------- edits */
function onField(el, done) {
  const ns = el.dataset ? nsOf(el) : null;
  if (!ns) return;
  const v = readInput(el);
  if (v === null) return;
  const path = el.dataset[ns], obj = pathSet(BIND[ns](), path, v);
  if (ns === 'k') {
    // Touching a setting turns its section on (except its own on/off box).
    if (!path.endsWith('.on') && obj !== state.p && 'on' in obj) obj.on = true;
    if (done && path === 'pat.type' && v === 'image' && !assets.pattern) $('#pat-file').click();
    if (done) commit();
  } else if (ns === 'v') {
    if (path === 'tiled' || path === 'reps') { view.fit = true; if (state.view.tiled) crop.on = false; }
    savePrefs();
  } else if (done && path !== 'name') savePrefs();
  schedule();
}
addEventListener('input', (e) => onField(e.target, false));
addEventListener('change', (e) => onField(e.target, true));

// Double-click a slider: back to its default.
addEventListener('dblclick', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'range') return;
  const ns = nsOf(el);
  if (!ns) return;
  const def = pathGet(DEFS[ns](), el.dataset[ns]);
  if (def === undefined) return;
  pathSet(BIND[ns](), el.dataset[ns], def);
  if (ns === 'k') commit(); else savePrefs();
  schedule();
});

addEventListener('click', (e) => {
  const reset = e.target.closest('[data-reset]');
  if (reset) {
    const id = reset.dataset.reset;
    state.p[id] = clonePar(DEFAULTS[id]);
    commit(); schedule();
    return;
  }
  const seed = e.target.closest('[data-seed]');
  if (seed) {
    const obj = pathSet(state.p, seed.dataset.seed, 1 + Math.floor(Math.random() * 99999));
    obj.on = true;
    commit(); schedule();
  }
});

$('#off-half').addEventListener('click', () => {
  state.p.off = { on: true, x: 50, y: 50 };
  commit(); schedule();
});

// A custom tile image for the pattern overlay.
$('#pat-load').addEventListener('click', () => $('#pat-file').click());
$('#pat-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const img = await decodeFile(f);
    img.name = f.name;
    assets.pattern = img;
    Object.assign(state.p.pat, { type: 'image', on: true });
    commit(); schedule();
  } catch (err) {
    console.error(err);
    toast(`Could not open ${f.name}: ${err.message || 'unknown format'}.`);
  }
});
