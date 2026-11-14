'use strict';
// The stop editor: the gradient bar, stop handles below it, midpoint diamonds above it,
// and the fields for the selected stop.

const ed = {
  wrap: $('#gbar-wrap'), frame: $('.gbar-frame'), bar: $('#gbar'), stops: $('#stops'), mids: $('#mids'),
  name: $('#g-name'), color: $('#st-color'), hex: $('#st-hex'), pick: $('#st-pick'),
  alpha: $('#st-alpha'), alphaOut: $('#st-alpha-out'), pos: $('#st-pos'), blend: $('#st-blend'), mid: $('#st-mid'),
  dup: $('#st-dup'), del: $('#st-del'),
};
const stopEls = new Map(), midEls = new Map();   // stop id -> element (mid: keyed by the segment's left stop)
let drag = null;

const posAt = (clientX) => { const r = ed.bar.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0, 1); };
const rgbaCss = (s) => { const [r, g, b] = rgbOfHex(s.c); return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${s.a})`; };

function drawBar() {
  // CSS sizes the canvas to its frame; only the backing store follows it, so the bar never
  // holds the layout at an old width.
  const r = ed.frame.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (ed.bar.width !== w || ed.bar.height !== h) { ed.bar.width = w; ed.bar.height = h; }
  drawStrip(ed.bar, selGrad(), Math.round(8 * dpr));
}

// Creates, moves and removes handle elements in place, so a handle being dragged keeps its pointer.
function syncHandles() {
  const g = selGrad(), S = g.stops, seen = new Set(), seenMid = new Set();
  S.forEach((s, i) => {
    seen.add(s.id);
    let el = stopEls.get(s.id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button'; el.className = 'stop'; el.dataset.id = s.id;
      el.appendChild(document.createElement('i'));
      ed.stops.appendChild(el);
      stopEls.set(s.id, el);
    }
    el.style.left = s.pos * 100 + '%';
    el.style.setProperty('--c', rgbaCss(s));
    el.classList.toggle('sel', s.id === state.stop);
    el.classList.toggle('removing', !!(drag && drag.removing && drag.id === s.id));
    el.setAttribute('aria-label', `Stop ${i + 1} at ${fmt(s.pos * 100, 1)}%, ${s.c}${s.a < 1 ? `, alpha ${Math.round(s.a * 100)}%` : ''}`);
    el.tabIndex = s.id === state.stop ? 0 : -1;

    const B = S[i + 1];
    if (B && B.pos - s.pos > 0.004) {
      seenMid.add(s.id);
      let m = midEls.get(s.id);
      if (!m) {
        m = document.createElement('button');
        m.type = 'button'; m.className = 'mid'; m.dataset.id = s.id; m.tabIndex = -1;
        m.title = 'Midpoint: drag to move where the blend is half way, double-click to reset';
        ed.mids.appendChild(m);
        midEls.set(s.id, m);
      }
      m.style.left = (s.pos + s.mid * (B.pos - s.pos)) * 100 + '%';
      m.classList.toggle('sel', s.id === state.stop);
      m.classList.toggle('hard', s.blend === 'hard');
      m.setAttribute('aria-label', `Midpoint ${fmt(s.mid * 100, 1)}%`);
    }
  });
  for (const [id, el] of stopEls) if (!seen.has(id)) { el.remove(); stopEls.delete(id); }
  for (const [id, el] of midEls) if (!seenMid.has(id)) { el.remove(); midEls.delete(id); }
}

function syncStopPanel() {
  const g = selGrad(), s = selStop(), act = document.activeElement;
  if (act !== ed.name) ed.name.value = g.name;
  if (!s) return;
  const S = g.stops, last = S[S.length - 1] === s;
  ed.color.value = s.c;
  if (act !== ed.hex) ed.hex.value = s.a < 1 ? toHexA(...rgbOfHex(s.c), s.a) : s.c;
  ed.alpha.value = Math.round(s.a * 100);
  ed.alphaOut.textContent = Math.round(s.a * 100) + '%';
  if (act !== ed.pos) ed.pos.value = fmt(s.pos * 100, 2);
  ed.blend.value = s.blend;
  if (act !== ed.mid) ed.mid.value = fmt(s.mid * 100, 2);
  ed.blend.disabled = ed.mid.disabled = last;
  ed.blend.title = ed.mid.title = last ? 'The last stop has no segment after it' : '';
  ed.del.disabled = S.length <= 2;
  ed.dup.disabled = S.length >= MAX_STOPS;
}

function renderEditor() { drawBar(); syncHandles(); syncStopPanel(); }

/* ---------- editing operations */
function selectStop(id, focus) {
  state.stop = id;
  schedule();
  if (focus) requestAnimationFrame(() => stopEls.get(id)?.focus());
}
function removeStop(id) {
  const g = selGrad();
  if (g.stops.length <= 2) { toast('A gradient needs at least two stops.'); return false; }
  const i = g.stops.findIndex((s) => s.id === id);
  if (i < 0) return false;
  g.stops.splice(i, 1);
  if (state.stop === id) state.stop = g.stops[Math.min(i, g.stops.length - 1)].id;
  return true;
}
// A new stop at x takes the color already shown there, so the gradient doesn't change.
function addStopAt(x) {
  const g = selGrad();
  if (g.stops.length >= MAX_STOPS) { toast(`Up to ${MAX_STOPS} stops per gradient.`); return null; }
  const c = sampleRaw(prep(g), x, [0, 0, 0, 0]);
  const left = [...g.stops].reverse().find((s) => s.pos <= x);
  const s = mkStop(roundTo(x, 4), toHex(...c.slice(0, 3).map((v) => clamp(v, 0, 1))), roundTo(clamp(c[3], 0, 1), 3), left ? left.blend : 'linear');
  g.stops.push(s);
  sortStops(g.stops);
  state.stop = s.id;
  return s;
}
function duplicateStop() {
  const g = selGrad(), s = selStop();
  if (!s || g.stops.length >= MAX_STOPS) return;
  const i = g.stops.indexOf(s), next = g.stops[i + 1], prev = g.stops[i - 1];
  const pos = next ? (s.pos + next.pos) / 2 : prev ? (s.pos + prev.pos) / 2 : clamp(s.pos + 0.1, 0, 1);
  const copy = mkStop(roundTo(pos, 4), s.c, s.a, s.blend, s.mid);
  g.stops.push(copy);
  sortStops(g.stops);
  state.stop = copy.id;
  commit(); schedule();
}

/* ---------- pointer: add, drag, remove stops and midpoints */
const DRAG_PX = 3, REMOVE_PX = 44, DBL_MS = 380;
let lastDown = null;
const openPicker = () => { try { ed.color.showPicker(); } catch { ed.color.click(); } };

ed.wrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const stopEl = e.target.closest('.stop'), midEl = e.target.closest('.mid');
  const g = selGrad();
  // Double-clicks are spotted here: with the pointer captured, dblclick events land on the wrapper.
  const hit = stopEl || midEl, now = performance.now();
  const dbl = hit && lastDown && lastDown.el === hit && now - lastDown.t < DBL_MS;
  lastDown = hit ? { el: hit, t: now } : null;
  if (dbl) {
    e.preventDefault();
    lastDown = null;
    if (midEl) {
      const s = g.stops.find((t) => t.id === +midEl.dataset.id);
      if (s) { s.mid = 0.5; commit(); schedule(); }
    } else openPicker();
    return;
  }
  if (midEl) {
    state.stop = +midEl.dataset.id;
    drag = { kind: 'mid', id: +midEl.dataset.id, x0: e.clientX, y0: e.clientY, moved: false };
    document.body.classList.add('dragging-mid');
  } else if (stopEl) {
    let id = +stopEl.dataset.id;
    if (e.altKey) {   // Alt+drag drags a copy
      const s = g.stops.find((t) => t.id === id), copy = mkStop(s.pos, s.c, s.a, s.blend, s.mid);
      g.stops.splice(g.stops.indexOf(s) + 1, 0, copy);
      id = copy.id;
    }
    state.stop = id;
    drag = { kind: 'stop', id, x0: e.clientX, y0: e.clientY, moved: e.altKey, removing: false };
    document.body.classList.add('dragging');
  } else if (e.target.closest('.gbar-frame, .stops')) {
    const s = addStopAt(posAt(e.clientX));
    if (!s) return;
    drag = { kind: 'stop', id: s.id, x0: e.clientX, y0: e.clientY, moved: true, removing: false };
    document.body.classList.add('dragging');
  } else return;
  e.preventDefault();
  try { ed.wrap.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  syncHandles();   // a new stop needs its element now, to take focus
  syncStopPanel();
  stopEls.get(state.stop)?.focus({ preventScroll: true });
  schedule();
});

ed.wrap.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
  drag.moved = true;
  const g = selGrad();
  if (drag.kind === 'mid') {
    const i = g.stops.findIndex((s) => s.id === drag.id), A = g.stops[i], B = g.stops[i + 1];
    if (!A || !B || B.pos <= A.pos) return;
    A.mid = roundTo(clamp((posAt(e.clientX) - A.pos) / (B.pos - A.pos), 0.01, 0.99), 4);
  } else {
    const s = g.stops.find((t) => t.id === drag.id);
    if (!s) return;
    let x = posAt(e.clientX);
    if (e.shiftKey) x = Math.round(x * 20) / 20;   // Shift snaps to 5%
    s.pos = roundTo(x, 4);
    sortStops(g.stops);
    const below = e.clientY - ed.bar.getBoundingClientRect().bottom;
    drag.removing = g.stops.length > 2 && below > REMOVE_PX;
  }
  schedule();
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging', 'dragging-mid');
  if (d.kind === 'stop' && d.removing) removeStop(d.id);
  commit();
  schedule();
}
ed.wrap.addEventListener('pointerup', endDrag);
ed.wrap.addEventListener('pointercancel', endDrag);
ed.wrap.addEventListener('lostpointercapture', endDrag);

// Keyboard on a focused stop: arrows move it, Delete removes it, Enter edits its color.
ed.stops.addEventListener('keydown', (e) => {
  const el = e.target.closest('.stop');
  if (!el) return;
  const g = selGrad(), s = g.stops.find((t) => t.id === +el.dataset.id);
  if (!s) return;
  const step = e.shiftKey ? 0.1 : e.altKey ? 0.001 : 0.01;
  const i = g.stops.indexOf(s);
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowDown': s.pos = roundTo(clamp(s.pos - step, 0, 1), 4); break;
    case 'ArrowRight': case 'ArrowUp': s.pos = roundTo(clamp(s.pos + step, 0, 1), 4); break;
    case 'Home': s.pos = 0; break;
    case 'End': s.pos = 1; break;
    case 'Delete': case 'Backspace': if (removeStop(s.id)) { commit(); schedule(); selectStop(state.stop, true); } e.preventDefault(); return;
    case 'Enter': openPicker(); e.preventDefault(); return;
    case 'Tab': {
      const j = i + (e.shiftKey ? -1 : 1);
      if (j < 0 || j >= g.stops.length) return;   // leave the stops, as Tab normally would
      selectStop(g.stops[j].id, true);
      e.preventDefault();
      return;
    }
    default: return;
  }
  e.preventDefault();
  sortStops(g.stops);
  commit();
  schedule();
  requestAnimationFrame(() => stopEls.get(s.id)?.focus());
});

/* ---------- stop fields */
const withStop = (fn) => () => { const s = selStop(); if (s) { fn(s); schedule(); } };
ed.color.addEventListener('input', withStop((s) => { s.c = ed.color.value.toLowerCase(); }));
ed.color.addEventListener('change', () => commit());
ed.hex.addEventListener('change', withStop((s) => {
  const c = parseColor(ed.hex.value);
  if (!c) { toast('Not a color. Try #ff8800, #ff880080, rgb(255 136 0) or a color name.'); ed.hex.value = s.c; return; }
  s.c = toHex(c.r, c.g, c.b);
  if (c.hasAlpha) s.a = roundTo(c.a, 3);
  commit();
}));
ed.hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') ed.hex.blur(); });
ed.alpha.addEventListener('input', withStop((s) => { s.a = +ed.alpha.value / 100; }));
ed.alpha.addEventListener('change', () => commit());
ed.alpha.addEventListener('dblclick', withStop((s) => { s.a = 1; commit(); }));
ed.pos.addEventListener('change', withStop((s) => {
  const v = parseFloat(ed.pos.value);
  if (Number.isFinite(v)) { s.pos = roundTo(clamp(v / 100, 0, 1), 5); sortStops(selGrad().stops); commit(); }
  ed.pos.value = fmt(s.pos * 100, 2);
}));
ed.blend.addEventListener('change', withStop((s) => { s.blend = ed.blend.value; commit(); }));
ed.mid.addEventListener('change', withStop((s) => {
  const v = parseFloat(ed.mid.value);
  if (Number.isFinite(v)) { s.mid = roundTo(clamp(v / 100, 0.01, 0.99), 4); commit(); }
  ed.mid.value = fmt(s.mid * 100, 2);
}));
ed.dup.addEventListener('click', duplicateStop);
ed.del.addEventListener('click', () => { const s = selStop(); if (s && removeStop(s.id)) { commit(); schedule(); } });
ed.name.addEventListener('input', () => { selGrad().name = ed.name.value.slice(0, 60); schedule(); });
ed.name.addEventListener('change', () => {
  const g = selGrad();
  g.name = ed.name.value.trim().slice(0, 60) || `Gradient ${selIndex() + 1}`;
  ed.name.value = g.name;
  commit(); schedule();
});
ed.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ed.name.blur(); });

// The EyeDropper API exists in Chromium browsers only; the button stays hidden elsewhere.
if ('EyeDropper' in window) {
  ed.pick.hidden = false;
  ed.pick.addEventListener('click', async () => {
    try {
      const r = await new window.EyeDropper().open();
      const c = parseColor(r.sRGBHex), s = selStop();
      if (c && s) { s.c = toHex(c.r, c.g, c.b); commit(); schedule(); }
    } catch { /* cancelled */ }
  });
}
