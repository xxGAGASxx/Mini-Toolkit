'use strict';
// The waveform: a time ruler, one lane per channel, the selection, split markers, the cursor and the playhead,
// and an overview strip of the whole file below. Drag to select, wheel to zoom, Shift+wheel to scroll,
// middle-drag to pan.

const vp = $('#vp'), cv = $('#wave'), g2 = cv.getContext('2d'), ovc = $('#ovw'), og = ovc.getContext('2d');
const RULER = 24;                                  // ruler height, CSS px
const view = { start: 0, spp: 1, W: 1, H: 1, dpr: 1, fit: true };
let colors = null;
function readColors() {
  const v = (n) => cssVar(n);
  colors = {
    wave: v('--wave'), rms: v('--wave-rms'), sel: v('--sel'), edge: v('--accent'), lane: v('--lane'), line: v('--line'),
    muted: v('--muted'), fg: v('--fg'), ruler: v('--panel-2'), marker: v('--marker'), head: v('--head'), clip: v('--warn'),
    win: v('--accent-soft'), font: v('--mono'),
  };
  baseKey = ovKey = '';
}

/* ---------- peak pyramid: min, max and mean square per block of 64 samples, then per 128, 256, … */
const PB = 64, peakCache = new WeakMap();
function peaksOf(audio) {
  let p = peakCache.get(audio);
  if (p) return p;
  const n = lenOf(audio), levels = [];
  let cnt = Math.ceil(n / PB);
  levels.push(audio.ch.map((d) => {
    const mn = new Float32Array(cnt), mx = new Float32Array(cnt), ms = new Float32Array(cnt);
    for (let b = 0; b < cnt; b++) {
      const e = Math.min(n, (b + 1) * PB);
      let lo = Infinity, hi = -Infinity, s = 0;
      for (let i = b * PB; i < e; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; s += v * v; }
      mn[b] = lo; mx[b] = hi; ms[b] = s / (e - b * PB);
    }
    return { mn, mx, ms };
  }));
  while (cnt > 1) {
    const prev = levels[levels.length - 1], c2 = Math.ceil(cnt / 2), last = cnt - 1;
    levels.push(prev.map(({ mn, mx, ms }) => {
      const a = new Float32Array(c2), b = new Float32Array(c2), q = new Float32Array(c2);
      for (let i = 0; i < c2; i++) {
        const j = 2 * i, k = Math.min(last, j + 1);
        a[i] = Math.min(mn[j], mn[k]); b[i] = Math.max(mx[j], mx[k]); q[i] = (ms[j] + ms[k]) / 2;
      }
      return { mn: a, mx: b, ms: q };
    }));
    cnt = c2;
  }
  p = { levels };
  peakCache.set(audio, p);
  return p;
}
// min, max, rms of channel c over samples [s0, s1) into out; false when the range is empty.
function colStats(audio, pk, c, s0, s1, out) {
  const n = lenOf(audio);
  s0 = Math.max(0, Math.floor(s0)); s1 = Math.min(n, Math.ceil(s1));
  if (s1 <= s0) return false;
  if (s1 - s0 >= PB * 2) {
    const l = clamp(Math.floor(Math.log2((s1 - s0) / PB)) - 1, 0, pk.levels.length - 1), B = PB << l, L = pk.levels[l][c];
    const b0 = Math.floor(s0 / B), b1 = Math.min(L.mn.length, Math.max(b0 + 1, Math.ceil(s1 / B)));
    let lo = Infinity, hi = -Infinity, q = 0;
    for (let b = b0; b < b1; b++) { if (L.mn[b] < lo) lo = L.mn[b]; if (L.mx[b] > hi) hi = L.mx[b]; q += L.ms[b]; }
    out[0] = lo; out[1] = hi; out[2] = Math.sqrt(q / (b1 - b0));
    return true;
  }
  const d = audio.ch[c];
  let lo = Infinity, hi = -Infinity, q = 0;
  for (let i = s0; i < s1; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; q += v * v; }
  out[0] = lo; out[1] = hi; out[2] = Math.sqrt(q / (s1 - s0));
  return true;
}

/* ---------- coordinates (CSS px) */
const sampleAt = (x) => view.start + x * view.spp;
const xOf = (s) => (s - view.start) / view.spp;
const minSpp = () => 1 / 64;
const fitSpp = () => Math.max(minSpp(), lenOf(state.audio) / Math.max(1, view.W));
function clampView() {
  if (!state.audio) return;
  view.spp = clamp(view.spp, minSpp(), fitSpp());
  view.start = clamp(view.start, 0, Math.max(0, lenOf(state.audio) - view.W * view.spp));
}
function fitView() { view.fit = true; view.spp = fitSpp(); view.start = 0; drawSoon(); }
function zoomAt(f, x) {
  if (!state.audio) return;
  const s = sampleAt(x);
  view.spp *= f; view.fit = false;
  clampView();
  view.start = s - x * view.spp;
  clampView();
  view.fit = view.spp >= fitSpp() - 1e-9;
  drawSoon();
}
// Zooms around the playhead (or the cursor) when it's on screen, else around the middle.
function stepZoom(dir) {
  const x = xOf(player.playing ? playheadPos() : state.cursor);
  zoomAt(dir > 0 ? 0.5 : 2, x >= 0 && x <= view.W ? x : view.W / 2);
}
function zoomToSel() {
  if (!hasSel()) { toast('Select something to zoom to it.'); return; }
  const { a, b } = state.sel, pad = (b - a) * 0.05;
  view.fit = false;
  view.spp = (b - a + 2 * pad) / view.W;
  view.start = a - pad;
  clampView();
  drawSoon();
}
// Keeps a position on screen, paging the view when it runs off.
function reveal(s) {
  const x = xOf(s);
  if (x < 0 || x > view.W) { view.start = s - view.W * view.spp * 0.05; clampView(); }
}

/* ---------- drawing */
let base = null, baseKey = '', ov = null, ovKey = '', audioIds = new WeakMap(), nextId = 1;
const idOf = (a) => { let i = audioIds.get(a); if (!i) { i = nextId++; audioIds.set(a, i); } return i; };

function layout() {
  const r = vp.getBoundingClientRect();
  view.W = Math.max(1, Math.floor(r.width)); view.H = Math.max(1, Math.floor(r.height));
  [, , view.dpr] = fitCanvas(cv, view.W, view.H);
  const wrap = ovc.parentElement;   // inner size: the wrapper has a border
  fitCanvas(ovc, Math.max(1, wrap.clientWidth), Math.max(1, wrap.clientHeight));
  if (view.fit) { view.spp = fitSpp(); view.start = 0; }
  clampView();
}

function drawBase() {
  const a = state.audio, W = cv.width, H = cv.height, dpr = view.dpr;
  const key = [idOf(a), view.start, view.spp, W, H].join();
  if (key === baseKey && base) return;
  baseKey = key;
  if (!base) base = document.createElement('canvas');
  if (base.width !== W || base.height !== H) { base.width = W; base.height = H; }
  const g = base.getContext('2d'), top = RULER * dpr, C = a.ch.length, laneH = (H - top) / C, pk = peaksOf(a), st = new Float32Array(3);
  const sppD = view.spp / dpr, n = lenOf(a);
  g.clearRect(0, 0, W, H);
  g.fillStyle = colors.lane;
  g.fillRect(0, top, W, H - top);
  for (let c = 0; c < C; c++) {
    const y0 = top + laneH * c, mid = y0 + laneH / 2, amp = laneH / 2 * 0.9;
    g.fillStyle = colors.line;
    g.fillRect(0, Math.round(mid), W, Math.max(1, Math.round(dpr * 0.75)));
    if (c) g.fillRect(0, Math.round(y0), W, Math.max(1, Math.round(dpr)));
    if (sppD >= 1) {
      for (let x = 0; x < W; x++) {
        const s0 = view.start + x * sppD;
        if (s0 >= n) break;
        if (!colStats(a, pk, c, s0, s0 + sppD, st)) continue;
        const hi = Math.min(1, st[1]), lo = Math.max(-1, st[0]);
        let yt = mid - hi * amp, yb = mid - lo * amp;
        if (yb - yt < 1) { const m = (yt + yb) / 2; yt = m - 0.5; yb = m + 0.5; }
        g.fillStyle = colors.wave;
        g.fillRect(x, yt, 1, yb - yt);
        // The RMS band (average loudness) inside the peak bar, in a deeper shade.
        const up = Math.min(Math.max(hi, 0), st[2]), dn = Math.min(Math.max(-lo, 0), st[2]);
        if (up + dn > 0) { g.fillStyle = colors.rms; g.fillRect(x, mid - up * amp, 1, (up + dn) * amp); }
        if (st[1] >= 0.9999 || st[0] <= -0.9999) { g.fillStyle = colors.clip; if (st[1] >= 0.9999) g.fillRect(x, y0 + 1, 1, 3 * dpr); if (st[0] <= -0.9999) g.fillRect(x, y0 + laneH - 3 * dpr - 1, 1, 3 * dpr); }
      }
    } else {
      // Zoomed in past one sample per pixel: a line through the samples, with dots when they're far apart.
      const d = a.ch[c], i0 = Math.max(0, Math.floor(view.start) - 1), i1 = Math.min(n - 1, Math.ceil(view.start + W * sppD) + 1);
      g.strokeStyle = colors.wave; g.lineWidth = Math.max(1, dpr * 1.25); g.lineJoin = 'round';
      g.beginPath();
      for (let i = i0; i <= i1; i++) { const x = (i - view.start) / sppD, y = mid - clamp(d[i], -1, 1) * amp; if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      if (sppD < 1 / 6) {
        g.fillStyle = colors.wave;
        for (let i = i0; i <= i1; i++) { const x = (i - view.start) / sppD, y = mid - clamp(d[i], -1, 1) * amp; g.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr); }
      }
    }
    if (C > 1) {
      g.fillStyle = colors.muted; g.font = `${10 * dpr}px ${colors.font}`; g.textBaseline = 'top';
      g.fillText(C === 2 ? (c ? 'R' : 'L') : String(c + 1), 6 * dpr, y0 + 5 * dpr);
    }
  }
}

const TICKS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
function drawRuler(g, W, dpr) {
  const sr = state.audio.sr, top = RULER * dpr, secPerPx = view.spp / sr;
  g.fillStyle = colors.ruler; g.fillRect(0, 0, W, top);
  g.fillStyle = colors.line; g.fillRect(0, top - dpr, W, dpr);
  const step = TICKS.find((t) => t / secPerPx >= 76) || 3600, minor = step / (String(step)[0] === '2' ? 4 : 5);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  const t0 = view.start / sr, t1 = (view.start + view.W * view.spp) / sr;
  g.font = `${10.5 * dpr}px ${colors.font}`; g.textBaseline = 'middle';
  for (let k = Math.floor(t0 / minor); k * minor <= t1; k++) {
    const t = k * minor, x = Math.round((t * sr - view.start) / view.spp * dpr), major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    g.fillStyle = major ? colors.muted : colors.line;
    g.fillRect(x, major ? top * 0.45 : top * 0.72, dpr, top);
    if (major) { g.fillStyle = colors.muted; g.fillText(fmtTime(t, digits), x + 4 * dpr, top * 0.36); }
  }
}

function drawView() {
  const W = cv.width, H = cv.height, dpr = view.dpr, g = g2;
  g.clearRect(0, 0, W, H);
  if (!state.audio) { drawOverview(); return; }
  drawBase();
  g.drawImage(base, 0, 0);
  const top = RULER * dpr, X = (s) => Math.round(xOf(s) * dpr);
  if (hasSel()) {
    const xa = X(state.sel.a), xb = X(state.sel.b);
    g.fillStyle = colors.sel; g.fillRect(xa, 0, Math.max(1, xb - xa), H);
  }
  drawRuler(g, W, dpr);
  if (hasSel()) {
    const xa = X(state.sel.a), xb = X(state.sel.b);
    g.fillStyle = colors.sel; g.fillRect(xa, 0, Math.max(1, xb - xa), top);
    g.fillStyle = colors.edge; g.fillRect(xa, 0, dpr, H); g.fillRect(xb - dpr, 0, dpr, H);
  }
  // Split markers: a dashed line and a handle on the ruler.
  g.fillStyle = colors.marker; g.strokeStyle = colors.marker; g.lineWidth = dpr; g.setLineDash([4 * dpr, 3 * dpr]);
  for (const m of state.markers) {
    const x = X(m) + 0.5;
    if (x < -10 || x > W + 10) continue;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x, H); g.stroke();
    g.beginPath(); g.moveTo(x - 5 * dpr, 2 * dpr); g.lineTo(x + 5 * dpr, 2 * dpr); g.lineTo(x + 5 * dpr, 9 * dpr); g.lineTo(x, 14 * dpr); g.lineTo(x - 5 * dpr, 9 * dpr); g.closePath(); g.fill();
  }
  g.setLineDash([]);
  const xc = X(state.cursor);
  g.fillStyle = colors.fg; g.globalAlpha = player.playing ? 0.35 : 0.85; g.fillRect(xc, top, dpr, H - top); g.globalAlpha = 1;
  const ph = playheadPos();
  if (ph !== null) {
    const xp = X(ph);
    g.fillStyle = colors.head; g.fillRect(xp - dpr, 0, 2 * dpr, H);
    g.beginPath(); g.moveTo(xp - 5 * dpr, 0); g.lineTo(xp + 5 * dpr, 0); g.lineTo(xp, 7 * dpr); g.closePath(); g.fill();
  }
  drawOverview();
}

function drawOverview() {
  const W = ovc.width, H = ovc.height, g = og;
  g.clearRect(0, 0, W, H);
  if (!state.audio) return;
  const a = state.audio, n = lenOf(a), dpr = view.dpr, key = [idOf(a), W, H].join();
  if (key !== ovKey || !ov) {
    ovKey = key;
    if (!ov) ov = document.createElement('canvas');
    ov.width = W; ov.height = H;
    const o = ov.getContext('2d'), pk = peaksOf(a), st = new Float32Array(3), spx = n / W, mid = H / 2, amp = H / 2 * 0.9;
    o.fillStyle = colors.wave; o.globalAlpha = 0.75;
    for (let x = 0; x < W; x++) {
      let hi = -1, lo = 1;
      for (let c = 0; c < a.ch.length; c++) if (colStats(a, pk, c, x * spx, (x + 1) * spx, st)) { hi = Math.max(hi, st[1]); lo = Math.min(lo, st[0]); }
      if (hi < lo) continue;
      const yt = mid - clamp(hi, -1, 1) * amp, yb = mid - clamp(lo, -1, 1) * amp;
      o.fillRect(x, yt, 1, Math.max(1, yb - yt));
    }
  }
  g.drawImage(ov, 0, 0);
  const X = (s) => s / n * W;
  if (hasSel()) { g.fillStyle = colors.sel; g.fillRect(X(state.sel.a), 0, Math.max(dpr, X(state.sel.b) - X(state.sel.a)), H); }
  g.fillStyle = colors.marker;
  for (const m of state.markers) g.fillRect(Math.round(X(m)), 0, dpr, H);
  const wa = X(view.start), wb = X(view.start + view.W * view.spp);
  if (!view.fit) {
    g.fillStyle = colors.win; g.fillRect(wa, 0, wb - wa, H);
    g.strokeStyle = colors.edge; g.lineWidth = dpr; g.strokeRect(wa + dpr / 2, dpr / 2, Math.max(dpr, wb - wa - dpr), H - dpr);
  }
  const ph = playheadPos();
  if (ph !== null) { g.fillStyle = colors.head; g.fillRect(Math.round(X(ph)) - dpr / 2, 0, dpr * 1.5, H); }
}

/* ---------- pointer: select, adjust, move markers, pan, zoom */
let drag = null, lastX = 0;
const localX = (e, el) => e.clientX - el.getBoundingClientRect().left;
function markerAt(x) {
  let best = -1, bd = 7;
  state.markers.forEach((m, i) => { const d = Math.abs(xOf(m) - x); if (d < bd) { bd = d; best = i; } });
  return best;
}
// Lets a drag snap onto split markers, the file's ends and the cursor when it comes within 6 px.
function snap(s) {
  const n = lenOf(state.audio);
  let best = s, bd = 6;
  for (const t of [0, n, state.cursor, ...state.markers]) { const d = Math.abs(xOf(t) - xOf(s)); if (d < bd) { bd = d; best = t; } }
  return clamp(Math.round(best), 0, n);
}
cv.addEventListener('pointerdown', (e) => {
  if (!state.audio || busy) return;
  cv.focus({ preventScroll: true });
  const x = localX(e, cv), y = e.clientY - cv.getBoundingClientRect().top;
  lastX = x;
  if (e.button === 1) {
    e.preventDefault();
    drag = { kind: 'pan', x0: x, start0: view.start };
  } else if (e.button === 0) {
    const mi = y < RULER ? markerAt(x) : -1;
    if (mi >= 0) drag = { kind: 'marker', i: mi, moved: false };
    else if (hasSel() && !e.shiftKey && Math.abs(x - xOf(state.sel.a)) <= 5) drag = { kind: 'edge', fixed: state.sel.b };
    else if (hasSel() && !e.shiftKey && Math.abs(x - xOf(state.sel.b)) <= 5) drag = { kind: 'edge', fixed: state.sel.a };
    else if (e.shiftKey) {
      const s = snap(sampleAt(x));
      const fixed = hasSel() ? (Math.abs(s - state.sel.a) < Math.abs(s - state.sel.b) ? state.sel.b : state.sel.a) : state.cursor;
      drag = { kind: 'edge', fixed };
      setSel(fixed, s);
    } else drag = { kind: 'select', anchor: snap(sampleAt(x)), x0: x, moved: false };
  } else return;
  cv.setPointerCapture(e.pointerId);
  cv.classList.add('dragging');
  dragMove();
});
function dragMove() {
  if (!drag) return;
  const x = lastX, s = sampleAt(x);
  if (drag.kind === 'pan') { view.start = drag.start0 - (x - drag.x0) * view.spp; view.fit = false; clampView(); }
  else if (drag.kind === 'select') {
    if (Math.abs(x - drag.x0) > 3) drag.moved = true;
    if (drag.moved) setSel(drag.anchor, snap(s));
  } else if (drag.kind === 'edge') setSel(drag.fixed, snap(s));
  else if (drag.kind === 'marker') {
    const ms = state.markers.slice();
    ms[drag.i] = clamp(Math.round(s), 1, lenOf(state.audio) - 1);
    state.markers = ms; drag.moved = true;
  }
  drawSoon();
  syncReadout();
}
cv.addEventListener('pointermove', (e) => {
  lastX = localX(e, cv);
  if (drag) { dragMove(); return; }
  if (!state.audio) return;
  const y = e.clientY - cv.getBoundingClientRect().top;
  const near = (y < RULER && markerAt(lastX) >= 0) || (hasSel() && (Math.abs(lastX - xOf(state.sel.a)) <= 5 || Math.abs(lastX - xOf(state.sel.b)) <= 5));
  cv.style.cursor = near ? 'ew-resize' : 'text';
  syncReadout(sampleAt(lastX));
});
cv.addEventListener('pointerleave', () => { if (!drag) syncReadout(null); });
function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  cv.classList.remove('dragging');
  if (d.kind === 'select' && !d.moved) {
    state.sel = null;
    state.cursor = d.anchor;
    if (player.playing && !player.preview) playFromCursor();
  } else if (d.kind === 'marker' && d.moved) {
    state.markers = cleanMarkers(state.markers, lenOf(state.audio));
    commit();
  }
  schedule();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('lostpointercapture', endDrag);
cv.addEventListener('dblclick', (e) => {
  if (!state.audio) return;
  const x = localX(e, cv), y = e.clientY - cv.getBoundingClientRect().top;
  const mi = y < RULER ? markerAt(x) : -1;
  if (mi >= 0) {
    state.markers = state.markers.filter((_, i) => i !== mi);
    commit(); schedule();
    toast('Split removed.');
    return;
  }
  const s = sampleAt(x), r = regionsOf(state.markers, lenOf(state.audio)).find(([a, b]) => s >= a && s < b);
  if (r) { setSel(r[0], r[1]); schedule(); }
});
cv.addEventListener('wheel', (e) => {
  if (!state.audio) return;
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.W : 1, dx = e.deltaX * k, dy = e.deltaY * k;
  if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
    view.start += (Math.abs(dx) > Math.abs(dy) ? dx : dy) * view.spp; view.fit = false; clampView(); drawSoon();
  } else zoomAt(Math.exp(clamp(dy, -200, 200) * 0.002), localX(e, cv));
}, { passive: false });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

// While dragging past the left or right edge, scroll that way.
function autoScroll() {
  if (drag && drag.kind !== 'pan' && (lastX < 0 || lastX > view.W)) {
    const over = lastX < 0 ? lastX : lastX - view.W;
    view.start += clamp(over, -80, 80) * view.spp * 0.35; view.fit = false;
    clampView(); dragMove();
  }
  requestAnimationFrame(autoScroll);
}
requestAnimationFrame(autoScroll);

// Overview: click or drag to move the view there.
let ovDrag = false;
function ovMove(e) {
  if (!state.audio) return;
  const r = ovc.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
  if (view.fit) return;
  view.start = f * lenOf(state.audio) - view.W * view.spp / 2;
  clampView(); drawSoon();
}
ovc.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; ovDrag = true; ovc.setPointerCapture(e.pointerId); ovMove(e); });
ovc.addEventListener('pointermove', (e) => { if (ovDrag) ovMove(e); });
ovc.addEventListener('pointerup', () => { ovDrag = false; });
ovc.addEventListener('lostpointercapture', () => { ovDrag = false; });
ovc.addEventListener('wheel', (e) => { if (!state.audio) return; e.preventDefault(); zoomAt(Math.exp(clamp(e.deltaY, -200, 200) * 0.002), view.W / 2); }, { passive: false });
