'use strict';
// The image view: zoom and pan, the tiled preview, the crop box, the rotation preview and the pixel readout.

const vp = $('#vp'), cv = $('#view'), vx = cv.getContext('2d');
const view = { z: 1, cx: 0, cy: 0, fit: true, before: false };   // zoom (screen px per image px), center in content px
const shown = { out: null, base: null, outC: mk(1, 1), baseC: mk(1, 1), outId: 0, baseId: 0 };
let vW = 1, vH = 1, spaceDown = false, drag = null;

// Copies the processed and original images into canvases for drawing (only when they change).
function setShown(out, base) {
  if (out.id !== shown.outId) { imgToCanvas(out, shown.outC); shown.outId = out.id; }
  if (base.id !== shown.baseId) { imgToCanvas(base, shown.baseC); shown.baseId = base.id; }
  shown.out = out; shown.base = base;
}

// The content on screen: one image, or n × n copies in the tiled view.
function layout() {
  const img = state.base;
  if (!img) return null;
  const n = state.view.tiled && !crop.on ? state.view.reps : 1;
  return { w: img.w, h: img.h, n, W: img.w * n, H: img.h * n };
}

/* ---------- zoom and pan */
const ZOOMS = [0.02, 0.03, 0.05, 0.0625, 0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
function fitZoom(L) {
  let z = Math.min((vW - 40) / L.W, (vH - 40) / L.H);
  if (z > 1) z = Math.min(32, Math.floor(z));   // whole steps when enlarging keep pixels square
  return Math.max(0.02, z);
}
function zoomAt(z, sx, sy) {
  if (!state.base) return;
  z = clamp(z, 0.02, 64);
  const px = (sx - vW / 2) / view.z + view.cx, py = (sy - vH / 2) / view.z + view.cy;
  view.z = z;
  view.cx = px - (sx - vW / 2) / z; view.cy = py - (sy - vH / 2) / z;
  view.fit = false;
  drawSoon();
}
function stepZoom(dir) {
  const z = view.z, next = dir > 0 ? ZOOMS.find((v) => v > z * 1.001) : [...ZOOMS].reverse().find((v) => v < z / 1.001);
  if (next) zoomAt(next, vW / 2, vH / 2);
}
function fitView() { view.fit = true; drawSoon(); }

// Screen position of the content's top-left corner, snapped to device pixels so 1:1 stays sharp.
function origin() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return { ox: Math.round((vW / 2 - view.cx * view.z) * dpr) / dpr, oy: Math.round((vH / 2 - view.cy * view.z) * dpr) / dpr };
}
function toContent(sx, sy) { const { ox, oy } = origin(); return { x: (sx - ox) / view.z, y: (sy - oy) / view.z }; }

/* ---------- drawing */
let checkerPat = null, checkerKey = '';
function checker() {
  const a = cssVar('--chk-a'), b = cssVar('--chk-b');
  if (a + b !== checkerKey) {
    const c = mk(16, 16), x = c.getContext('2d');
    x.fillStyle = a; x.fillRect(0, 0, 16, 16);
    x.fillStyle = b; x.fillRect(8, 0, 8, 8); x.fillRect(0, 8, 8, 8);
    checkerPat = vx.createPattern(c, 'repeat');
    checkerKey = a + b;
  }
  return checkerPat;
}

function drawView() {
  vW = Math.max(1, vp.clientWidth); vH = Math.max(1, vp.clientHeight);
  const [pw, ph, dpr] = fitCanvas(cv, vW, vH);
  vx.setTransform(1, 0, 0, 1, 0, 0);
  vx.clearRect(0, 0, pw, ph);
  const L = layout();
  $('#z-val').textContent = L ? `${+(view.z * 100).toFixed(view.z < 0.1 ? 1 : 0)}%` : '–';
  if (!L || !shown.out) return;
  if (view.fit) { view.z = fitZoom(L); view.cx = L.W / 2; view.cy = L.H / 2; $('#z-val').textContent = `${+(view.z * 100).toFixed(view.z < 0.1 ? 1 : 0)}%`; }
  view.cx = clamp(view.cx, 0, L.W); view.cy = clamp(view.cy, 0, L.H);

  vx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const z = view.z, { ox, oy } = origin(), W = L.W * z, H = L.H * z;
  vx.fillStyle = checker();
  vx.fillRect(ox, oy, W, H);
  const src = view.before ? shown.baseC : shown.outC;
  vx.imageSmoothingEnabled = z < 1;
  vx.imageSmoothingQuality = 'high';
  if (L.n === 1) vx.drawImage(src, ox, oy, W, H);
  else {
    // A repeating pattern rather than n × n drawImage calls: no hairline gaps between copies,
    // which would look like seams.
    const pat = vx.createPattern(src, 'repeat');
    pat.setTransform(new DOMMatrix([z, 0, 0, z, ox, oy]));
    vx.fillStyle = pat;
    vx.fillRect(ox, oy, W, H);
    if (state.view.grid) gridLines(ox, oy, W, H, L.w * z, L.h * z, 'rgba(255, 64, 160, .75)', dpr, [5, 4]);
  }
  if (z >= 12) gridLines(ox, oy, W, H, z, z, 'rgba(128, 128, 128, .3)', dpr, null);
  if (crop.on && L.n === 1) drawCrop(ox, oy, z);
  else if (L.n === 1) { const r = rotPreview(); if (r) drawRotPreview(L, ox, oy, z, r); }
}

// Lines every `stepX` / `stepY` screen px across the content, only over the visible part.
function gridLines(ox, oy, W, H, stepX, stepY, color, dpr, dash) {
  const x0 = Math.max(ox, 0), x1 = Math.min(ox + W, vW), y0 = Math.max(oy, 0), y1 = Math.min(oy + H, vH);
  if (x1 <= x0 || y1 <= y0) return;
  const snap = (v) => Math.round(v * dpr) / dpr + 0.5 / dpr;
  vx.beginPath();
  for (let k = Math.ceil((x0 - ox) / stepX); ox + k * stepX <= x1; k++) { const x = snap(ox + k * stepX); vx.moveTo(x, y0); vx.lineTo(x, y1); }
  for (let k = Math.ceil((y0 - oy) / stepY); oy + k * stepY <= y1; k++) { const y = snap(oy + k * stepY); vx.moveTo(x0, y); vx.lineTo(x1, y); }
  vx.save();
  vx.lineWidth = 1 / dpr;
  vx.strokeStyle = color;
  if (dash) vx.setLineDash(dash);
  vx.stroke();
  vx.restore();
}

const HANDLES = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
function cropScreen() {
  const { ox, oy } = origin(), z = view.z;
  return { x: ox + crop.x * z, y: oy + crop.y * z, w: crop.w * z, h: crop.h * z };
}
function drawCrop(ox, oy, z) {
  const img = state.base, r = cropScreen();
  vx.save();
  vx.fillStyle = 'rgba(8, 10, 16, .58)';
  vx.beginPath();
  vx.rect(ox, oy, img.w * z, img.h * z);
  vx.rect(r.x, r.y, r.w, r.h);
  vx.fill('evenodd');
  vx.lineWidth = 1;
  vx.strokeStyle = 'rgba(255, 255, 255, .35)';
  vx.beginPath();
  for (const t of [1 / 3, 2 / 3]) {
    vx.moveTo(r.x + r.w * t, r.y); vx.lineTo(r.x + r.w * t, r.y + r.h);
    vx.moveTo(r.x, r.y + r.h * t); vx.lineTo(r.x + r.w, r.y + r.h * t);
  }
  vx.stroke();
  vx.strokeStyle = 'rgba(0, 0, 0, .6)';
  vx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
  vx.strokeStyle = '#fff';
  vx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
  for (const [, fx, fy] of HANDLES) {
    const hx = r.x + r.w * fx, hy = r.y + r.h * fy;
    vx.fillStyle = '#fff'; vx.fillRect(hx - 4, hy - 4, 8, 8);
    vx.strokeStyle = 'rgba(0, 0, 0, .7)'; vx.strokeRect(hx - 4.5, hy - 4.5, 9, 9);
  }
  const label = `${crop.w} × ${crop.h}`;
  vx.font = '600 11px ' + cssVar('--mono');
  const tw = vx.measureText(label).width + 12, ly = r.y > 26 ? r.y - 24 : r.y + 6;
  vx.fillStyle = 'rgba(8, 10, 16, .8)'; vx.fillRect(r.x, ly, tw, 18);
  vx.fillStyle = '#fff'; vx.textBaseline = 'middle'; vx.fillText(label, r.x + 6, ly + 9);
  vx.restore();
}

function drawRotPreview(L, ox, oy, z, r) {
  const t = (r.deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const cx = ox + (L.w * z) / 2, cy = oy + (L.h * z) / 2, hw = (L.w * z) / 2, hh = (L.h * z) / 2;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  vx.save();
  vx.lineWidth = 1.5;
  vx.setLineDash([6, 4]);
  vx.strokeStyle = cssVar('--accent');
  vx.beginPath();
  pts.forEach(([x, y], i) => (i ? vx.lineTo(x, y) : vx.moveTo(x, y)));
  vx.closePath();
  vx.stroke();
  if (r.expand) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    vx.globalAlpha = 0.45;
    vx.setLineDash([2, 4]);
    vx.strokeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  vx.restore();
}

/* ---------- crop box editing */
function hitCrop(sx, sy) {
  const r = cropScreen();
  for (const [id, fx, fy] of HANDLES) if (Math.abs(sx - (r.x + r.w * fx)) <= 8 && Math.abs(sy - (r.y + r.h * fy)) <= 8) return id;
  const inX = sx >= r.x && sx <= r.x + r.w, inY = sy >= r.y && sy <= r.y + r.h;
  if (inY && Math.abs(sx - r.x) <= 5) return 'w';
  if (inY && Math.abs(sx - r.x - r.w) <= 5) return 'e';
  if (inX && Math.abs(sy - r.y) <= 5) return 'n';
  if (inX && Math.abs(sy - r.y - r.h) <= 5) return 's';
  return inX && inY ? 'move' : 'new';
}
const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move', new: 'crosshair' };

const rectFrom = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

// A box with aspect ar (w / h) growing from (ax, ay) in direction (dx, dy): +1 right/down, -1 left/up,
// 0 centered on that point. w and h are what the drag asks for; the larger demand wins, then the box
// shrinks to stay inside the W × H image.
function fitAspect(ax, ay, dx, dy, w, h, ar, W, H) {
  if (h === 0 || w / h > ar) h = w / ar; else w = h * ar;
  const maxW = dx > 0 ? W - ax : dx < 0 ? ax : 2 * Math.min(ax, W - ax);
  const maxH = dy > 0 ? H - ay : dy < 0 ? ay : 2 * Math.min(ay, H - ay);
  const k = Math.min(1, w ? maxW / w : 1, h ? maxH / h : 1);
  w *= k; h *= k;
  return { x: dx > 0 ? ax : dx < 0 ? ax - w : ax - w / 2, y: dy > 0 ? ay : dy < 0 ? ay - h : ay - h / 2, w, h };
}

function cropDrag(d, p) {
  const W = state.base.w, H = state.base.h, ar = crop.aspect, r0 = d.r0;
  const px = clamp(p.x, 0, W), py = clamp(p.y, 0, H), sgn = (v) => (v < 0 ? -1 : 1);
  let r;
  if (d.h === 'move') {
    r = { x: clamp(r0.x + p.x - d.p0.x, 0, W - r0.w), y: clamp(r0.y + p.y - d.p0.y, 0, H - r0.h), w: r0.w, h: r0.h };
  } else if (d.h === 'new') {
    const ax = clamp(d.p0.x, 0, W), ay = clamp(d.p0.y, 0, H);
    r = ar ? fitAspect(ax, ay, sgn(px - ax), sgn(py - ay), Math.abs(px - ax), Math.abs(py - ay), ar, W, H) : rectFrom(ax, ay, px, py);
  } else {
    const L = r0.x, T = r0.y, R = r0.x + r0.w, B = r0.y + r0.h;
    const hw = d.h.includes('w'), he = d.h.includes('e'), hn = d.h.includes('n'), hs = d.h.includes('s');
    if (ar) {
      if ((hw || he) && (hn || hs)) {
        const ax = hw ? R : L, ay = hn ? B : T;
        r = fitAspect(ax, ay, sgn(px - ax), sgn(py - ay), Math.abs(px - ax), Math.abs(py - ay), ar, W, H);
      } else if (hw || he) {
        const ax = hw ? R : L;
        r = fitAspect(ax, (T + B) / 2, sgn(px - ax), 0, Math.abs(px - ax), 0, ar, W, H);
      } else {
        const ay = hn ? B : T;
        r = fitAspect((L + R) / 2, ay, 0, sgn(py - ay), 0, Math.abs(py - ay), ar, W, H);
      }
    } else {
      r = rectFrom(hw ? px : L, hn ? py : T, he ? px : R, hs ? py : B);
    }
  }
  setCropRect(r);
}

/* ---------- pointer, wheel and readout */
function readout(sx, sy) {
  const el = $('#readout'), L = layout(), img = view.before ? shown.base : shown.out;
  if (!L || !img) { el.textContent = ''; return; }
  const p = toContent(sx, sy);
  if (p.x < 0 || p.y < 0 || p.x >= L.W || p.y >= L.H) { el.textContent = ''; return; }
  const x = Math.floor(p.x) % L.w, y = Math.floor(p.y) % L.h, i = (y * img.w + x) * 4, d = img.d;
  const pad = (v) => String(v).padStart(3, ' ');
  el.textContent = `${x}, ${y}   R${pad(d[i])} G${pad(d[i + 1])} B${pad(d[i + 2])} A${pad(d[i + 3])}`;
}

function setCursor(sx, sy) {
  const L = layout();
  if (drag) cv.style.cursor = drag.mode === 'pan' ? 'grabbing' : CURSORS[drag.h];
  else if (!L) cv.style.cursor = 'default';
  else if (crop.on && L.n === 1 && !spaceDown) cv.style.cursor = CURSORS[hitCrop(sx, sy)];
  else cv.style.cursor = 'grab';
}

cv.addEventListener('pointerdown', (e) => {
  const L = layout();
  if (!L || (e.button !== 0 && e.button !== 1)) return;
  e.preventDefault();
  cv.setPointerCapture(e.pointerId);
  const pan = e.button === 1 || spaceDown || !crop.on || L.n > 1;
  drag = pan ? { mode: 'pan', x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }
    : { mode: 'crop', h: hitCrop(e.offsetX, e.offsetY), p0: toContent(e.offsetX, e.offsetY), r0: { ...crop } };
  setCursor(e.offsetX, e.offsetY);
});
cv.addEventListener('pointermove', (e) => {
  if (drag && drag.mode === 'pan') {
    view.cx = drag.cx - (e.clientX - drag.x) / view.z;
    view.cy = drag.cy - (e.clientY - drag.y) / view.z;
    view.fit = false;
    drawSoon();
  } else if (drag) cropDrag(drag, toContent(e.offsetX, e.offsetY));
  else setCursor(e.offsetX, e.offsetY);
  readout(e.offsetX, e.offsetY);
});
const endDrag = (e) => { if (!drag) return; drag = null; setCursor(e.offsetX, e.offsetY); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { if (!drag) $('#readout').textContent = ''; });
cv.addEventListener('dblclick', () => { if (!crop.on) fitView(); });
cv.addEventListener('wheel', (e) => {
  if (!state.base) return;
  e.preventDefault();
  const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  zoomAt(view.z * k, e.offsetX, e.offsetY);
}, { passive: false });

const beforeBtn = $('#v-before');
const setBefore = (on) => { if (view.before !== on) { view.before = on; beforeBtn.setAttribute('aria-pressed', String(on)); drawSoon(); } };
beforeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setBefore(true); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) beforeBtn.addEventListener(ev, () => setBefore(false));

$('#z-fit').addEventListener('click', fitView);
$('#z-100').addEventListener('click', () => zoomAt(1, vW / 2, vH / 2));
$('#z-in').addEventListener('click', () => stepZoom(1));
$('#z-out').addEventListener('click', () => stepZoom(-1));
