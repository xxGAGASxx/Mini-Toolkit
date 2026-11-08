'use strict';
// Import sheet: cut one image into frames along a grid set in a dialog.
// Columns and cell width follow each other, as do rows and cell height: whichever of the pair was
// typed last leads, and a padding or margin change recomputes the other one.
// The first grid is guessed from the image. Frames are trimmed to their non-transparent pixels
// by default; untrimmed, a sheet exported here comes back exactly as it was.

const SL_MAX = 256;   // most columns or rows, like the main Columns field
const slEls = {
  dlg: $('#slice-dlg'), form: $('#slice-form'), file: $('#sheet-file'),
  info: $('#slice-info'), box: $('#slice-box'), pv: $('#slice-pv'), sum: $('#slice-sum'), ok: $('#slice-ok'),
  cols: $('#sl-cols'), rows: $('#sl-rows'), cw: $('#sl-cw'), ch: $('#sl-ch'), pad: $('#sl-pad'), margin: $('#sl-margin'),
  skip: $('#sl-skip'), trim: $('#sl-trim'),
};
let sl = null;   // the open sheet: { src, data, W, H, name, base, driveX, driveY, g, boxes }

// Guess the grid. Fully transparent columns and rows separate the sprites, so the runs of
// content between them give the counts. One run (or an opaque image) falls back to a strip
// of square frames. The padding is the smallest gap that makes the cells come out whole.
function guessGrid(W, H, d) {
  const colHas = new Uint8Array(W), rowHas = new Uint8Array(H);
  for (let y = 0, i = 3; y < H; y++) for (let x = 0; x < W; x++, i += 4) if (d[i]) colHas[x] = rowHas[y] = 1;
  const runs = (a) => a.reduce((n, v, i) => n + (v && !a[i - 1] ? 1 : 0), 0);
  let cols = runs(colHas) || 1, rows = runs(rowHas) || 1;
  if (cols === 1 && rows === 1) {
    if (W % H === 0) cols = W / H; else if (H % W === 0) rows = H / W;
  }
  cols = Math.min(cols, SL_MAX); rows = Math.min(rows, SL_MAX);
  for (let p = 0; p <= 64; p++) {
    const iw = W - (cols - 1) * p, ih = H - (rows - 1) * p;
    if (iw < cols || ih < rows) break;
    if (iw % cols === 0 && ih % rows === 0) return { cols, rows, pad: p };
  }
  return { cols, rows, pad: 0 };
}

async function openSlicer(file) {
  let src;
  try { src = await loadImage(file); } catch (e) { toast(`${file.name} could not be read as an image.`); return; }
  const W = src.width, H = src.height, data = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
  const g = guessGrid(W, H, data.data);
  sl = { src, data, W, H, name: file.name, base: file.name.replace(/\.[^.]+$/, '') || 'sheet', driveX: 'cols', driveY: 'rows' };
  slEls.info.textContent = `${file.name} · ${W}×${H} px`;
  slEls.info.title = file.name;
  slEls.cols.value = g.cols; slEls.rows.value = g.rows; slEls.pad.value = g.pad; slEls.margin.value = 0;
  slEls.skip.checked = true;
  slEls.trim.checked = true;
  slEls.dlg.showModal();
  sliceUpdate();
}

// Re-derives the grid after a field changed (`from` names it), then redraws and recounts.
function sliceUpdate(from) {
  const { W, H } = sl, num = (el, lo) => Math.max(lo, parseInt(el.value, 10) || 0);
  if (from === 'cols' || from === 'cw') sl.driveX = from;
  if (from === 'rows' || from === 'ch') sl.driveY = from;
  const pad = num(slEls.pad, 0), m = num(slEls.margin, 0);
  const axis = (drive, countEl, sizeEl, total) => {
    let n, size;
    if (drive === 'cw' || drive === 'ch') {
      size = num(sizeEl, 1);
      n = clamp(Math.floor((total - 2 * m + pad) / (size + pad)), 1, SL_MAX);
      countEl.value = n;
    } else {
      n = clamp(num(countEl, 1), 1, SL_MAX);
      size = Math.max(1, Math.floor((total - 2 * m - (n - 1) * pad) / n));
      sizeEl.value = size;
    }
    return [n, size];
  };
  const [cols, cw] = axis(sl.driveX, slEls.cols, slEls.cw, W);
  const [rows, ch] = axis(sl.driveY, slEls.rows, slEls.ch, H);
  sl.g = { cols, rows, cw, ch, pad, m };
  sl.boxes = cellBoxes(sl.g);

  const skip = slEls.skip.checked, trim = slEls.trim.checked;
  const nEmpty = sl.boxes.filter((b) => !b).length, n = cols * rows - (skip ? nEmpty : 0);
  const over = 2 * m + cols * cw + (cols - 1) * pad > W || 2 * m + rows * ch + (rows - 1) * pad > H;
  let size = `of ${cw}×${ch}`;
  if (trim) {
    let mw = 1, mh = 1;
    for (const b of sl.boxes) if (b) { mw = Math.max(mw, b[2] - b[0]); mh = Math.max(mh, b[3] - b[1]); }
    size = `trimmed, largest ${mw}×${mh}`;
  }
  slEls.sum.textContent = `${n} frame${n === 1 ? '' : 's'} ${size}`
    + (skip && nEmpty ? ` · ${nEmpty} empty skipped` : '')
    + (over ? ' · the grid runs past the image' : '');
  slEls.ok.textContent = n ? `Import ${n} frame${n === 1 ? '' : 's'}` : 'Import';
  slEls.ok.disabled = !n;
  drawSlice();
}

// For each cell (row by row), the box around its non-transparent pixels as [left, top, right, bottom]
// in image pixels, right and bottom exclusive. null when the cell is empty or outside the image.
function cellBoxes(g) {
  const { W, H } = sl, d = sl.data.data, out = new Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const x0 = g.m + c * (g.cw + g.pad), y0 = g.m + r * (g.ch + g.pad);
    const x1 = Math.min(W, x0 + g.cw), y1 = Math.min(H, y0 + g.ch);
    let left = x1, top = y1, right = x0, bottom = y0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = (y * W + x) * 4 + 3; x < x1; x++, i += 4) {
        if (!d[i]) continue;
        if (x < left) left = x;
        if (x >= right) right = x + 1;
        if (y < top) top = y;
        bottom = y + 1;
      }
    }
    out[r * g.cols + c] = right > left ? [left, top, right, bottom] : null;
  }
  return out;
}

// The sheet scaled to fit (whole-number zoom when enlarging, so pixels stay square) with each cell
// outlined. Everything that won't be imported is dimmed: margin, padding, skipped cells and, with
// trimming, the empty border around each sprite. Drawn at device resolution for crisp lines.
function drawSlice() {
  const { W, H, g } = sl, c = slEls.pv, dpr = window.devicePixelRatio || 1;
  const maxW = slEls.box.clientWidth - 24, maxH = Math.min(window.innerHeight * 0.45, 440) - 24;
  let z = Math.min(maxW / W, maxH / H);
  z = z >= 1 ? Math.min(Math.floor(z), 16) : z;
  const dw = Math.max(1, Math.round(W * z)), dh = Math.max(1, Math.round(H * z)), k = (dw * dpr) / W;
  c.style.width = dw + 'px'; c.style.height = dh + 'px';
  c.width = Math.round(dw * dpr); c.height = Math.round(dh * dpr);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = z < 1;
  x.drawImage(sl.src, 0, 0, c.width, c.height);
  const css = getComputedStyle(document.documentElement), skip = slEls.skip.checked, trim = slEls.trim.checked;
  const px = (v) => Math.round(v * k);
  x.fillStyle = css.getPropertyValue('--scrim').trim();
  x.fillRect(0, 0, c.width, c.height);   // dim it all, then uncover what will be imported
  const cells = [];
  for (let r = 0; r < g.rows; r++) for (let col = 0; col < g.cols; col++) {
    const cx = g.m + col * (g.cw + g.pad), cy = g.m + r * (g.ch + g.pad), b = sl.boxes[r * g.cols + col];
    cells.push([cx, cy]);
    const keep = trim ? b : !b && skip ? null : [cx, cy, Math.min(W, cx + g.cw), Math.min(H, cy + g.ch)];
    if (!keep || keep[2] <= keep[0] || keep[3] <= keep[1]) continue;
    const L = px(keep[0]), T = px(keep[1]), R = px(keep[2]), B = px(keep[3]);
    x.clearRect(L, T, R - L, B - T);
    x.drawImage(sl.src, keep[0], keep[1], keep[2] - keep[0], keep[3] - keep[1], L, T, R - L, B - T);
  }
  const lw = Math.max(1, Math.round(dpr)), o = lw / 2;
  x.lineWidth = lw;
  x.strokeStyle = css.getPropertyValue('--accent').trim();
  for (const [cx, cy] of cells) {
    const X = px(cx), Y = px(cy);
    x.strokeRect(X + o, Y + o, px(cx + g.cw) - X - lw, px(cy + g.ch) - Y - lw);
  }
}

// Each frame is its cell, or with trimming just the box around its pixels. A kept empty cell,
// trimmed, becomes a 1×1 transparent frame.
function sliceImport() {
  const g = sl.g, skip = slEls.skip.checked, trim = slEls.trim.checked, added = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const b = sl.boxes[r * g.cols + c];
    if (skip && !b) continue;
    let sx = g.m + c * (g.cw + g.pad), sy = g.m + r * (g.ch + g.pad), w = g.cw, h = g.ch;
    if (trim) [sx, sy, w, h] = b ? [b[0], b[1], b[2] - b[0], b[3] - b[1]] : [0, 0, 1, 1];
    const cv = mk(w, h);
    if (b || !trim) cv.getContext('2d', { willReadFrequently: true }).drawImage(sl.src, sx, sy, w, h, 0, 0, w, h);
    added.push(makeSprite(cv, `${sl.base}_${added.length + 1}`));
  }
  const n = added.length;
  insertSprites(added, `Imported ${n} frame${n === 1 ? '' : 's'} from ${sl.name}`, { cols: g.cols, pad: g.pad });
}

$('#btn-sheet').addEventListener('click', () => slEls.file.click());
$('#empty-sheet').addEventListener('click', () => slEls.file.click());
slEls.file.addEventListener('change', () => { const f = slEls.file.files[0]; slEls.file.value = ''; if (f) openSlicer(f); });
for (const k of ['cols', 'rows', 'cw', 'ch', 'pad', 'margin']) slEls[k].addEventListener('input', () => sliceUpdate(k));
slEls.skip.addEventListener('change', () => sliceUpdate());
slEls.trim.addEventListener('change', () => sliceUpdate());
slEls.form.addEventListener('submit', (e) => { e.preventDefault(); if (!sl || slEls.ok.disabled) return; sliceImport(); slEls.dlg.close(); });
$('#slice-cancel').addEventListener('click', () => slEls.dlg.close());
slEls.dlg.addEventListener('close', () => { sl = null; });
window.addEventListener('resize', () => { if (sl) drawSlice(); });
