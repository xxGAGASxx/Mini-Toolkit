'use strict';
// The views under the editor: the texture as it will export, a lit sphere using the gradient as a
// lighting ramp, channel curves, and generated code.

const vw = {
  tabs: $$('.vbar [role="tab"]'), tools: $$('.vtools'),
  texView: $('#view-texture'), texWrap: $('#tex-wrap'), tex: $('#tex'), texNote: $('#tx-note'), zoom: $('#tx-zoom'), tile: $('#tx-tile'), texRead: $('#tx-read'),
  sphView: $('#view-sphere'), sph: $('#sphere'), spMode: $('#sp-mode'), spTint: $('#sp-tint'),
  cvView: $('#view-curves'), cv: $('#curves'), cvRead: $('#cv-read'),
  cdView: $('#view-code'), cdOut: $('#cd-out'), cdFmt: $('#cd-fmt'), cdMode: $('#cd-mode'), cdModeL: $('#cd-mode-l'),
  cdN: $('#cd-n'), cdNL: $('#cd-n-l'), cdNName: $('#cd-n-name'), cdAll: $('#cd-all'), cdAllL: $('#cd-all-l'), cdCopy: $('#cd-copy'), cdDl: $('#cd-dl'),
};
const VIEWS = { texture: vw.texView, sphere: vw.sphView, curves: vw.cvView, code: vw.cdView };

function setView(mode, focus) {
  state.view.mode = mode;
  for (const t of vw.tabs) {
    const on = t.dataset.view === mode;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const el of vw.tools) el.hidden = el.dataset.tools !== mode;
  for (const [k, el] of Object.entries(VIEWS)) el.hidden = k !== mode;
  autosave();
  schedule();
}
$('.vbar .tabs').addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) setView(t.dataset.view); });
$('.vbar .tabs').addEventListener('keydown', (e) => {
  const i = vw.tabs.findIndex((t) => t.dataset.view === state.view.mode), n = vw.tabs.length;
  const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  setView(vw.tabs[j].dataset.view, true);
});

/* ---------- texture */
const tex = { key: '', data: null, tw: 1, th: 1, L: null, off: mk(1, 1) };
function renderTextureView() {
  const L = texLayout(), [tw, th] = previewSize(L);
  const key = JSON.stringify([state.out, L.grads.map(lutKey), tw, th]);
  if (key !== tex.key) {
    tex.key = key;
    tex.data = renderTexture(L, tw, th, 8);
    tex.tw = tw; tex.th = th; tex.L = L;
    tex.off.width = tw; tex.off.height = th;
    tex.off.getContext('2d').putImageData(new ImageData(tex.data, tw, th), 0, 0);
    tex.drawn = '';
  }
  const tile = state.view.tile, n = tile ? 3 : 1, cw = tw * n, chh = th * n;
  const drawKey = tex.key + tile;
  if (tex.drawn !== drawKey) {
    tex.drawn = drawKey;
    vw.tex.width = cw; vw.tex.height = chh;
    const x = vw.tex.getContext('2d');
    x.clearRect(0, 0, cw, chh);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) x.drawImage(tex.off, i * tw, j * th);
  }
  // Display size: fit or a fixed zoom, measured in texture pixels (a reduced preview still shows full size).
  const sx = L.W / tw, availW = Math.max(40, vw.texView.clientWidth - 56), availH = Math.max(40, vw.texView.clientHeight - 56);
  let dw, dh;
  if (state.view.zoom === 'fit') {
    const k = Math.min(availW / (L.W * n), availH / (L.H * n));
    dw = L.W * n * k; dh = L.H * n * k;
    if (dh < 40) dh = Math.min(40, availH);   // very thin ramps get stretched tall enough to see
  } else {
    const z = +state.view.zoom;
    dw = L.W * n * z; dh = L.H * n * z;
  }
  vw.tex.style.width = Math.max(1, Math.round(dw)) + 'px';
  vw.tex.style.height = Math.max(1, Math.round(dh)) + 'px';
  vw.tex.classList.toggle('px', dw / cw >= 1);
  const notes = [];
  if (sx > 1.0001) notes.push(`Preview at ${Math.round(100 / sx)}% of ${L.W} × ${L.H}; the export is full size`);
  if (state.out.layout !== 'single' && state.grads.length < 2) notes.push('Add more gradients to fill the atlas');
  vw.texNote.hidden = !notes.length;
  vw.texNote.textContent = notes.join(' · ');
}
vw.zoom.addEventListener('change', () => { state.view.zoom = vw.zoom.value; autosave(); schedule(); });
vw.tile.addEventListener('change', () => { state.view.tile = vw.tile.checked; autosave(); schedule(); });
vw.tex.addEventListener('pointermove', (e) => {
  if (!tex.data) return;
  const r = vw.tex.getBoundingClientRect(), n = state.view.tile ? 3 : 1;
  const u = ((e.clientX - r.left) / r.width) * n, v = ((e.clientY - r.top) / r.height) * n;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const px = Math.min(tex.tw - 1, Math.floor(fu * tex.tw)), py = Math.min(tex.th - 1, Math.floor(fv * tex.th));
  const i = (py * tex.tw + px) * 4, d = tex.data;
  const X = Math.min(tex.L.W - 1, Math.floor(fu * tex.L.W)), Y = Math.min(tex.L.H - 1, Math.floor(fv * tex.L.H));
  vw.texRead.textContent = `${X}, ${Y}  ${toHexA(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255)}`;
});
vw.tex.addEventListener('pointerleave', () => { vw.texRead.textContent = ''; });

/* ---------- sphere: the gradient as a lighting ramp, looked up by N·L */
function renderSphere() {
  const box = vw.sphView, size = Math.max(80, Math.min(box.clientWidth - 40, box.clientHeight - 40, 640));
  const [W, H] = fitCanvas(vw.sph, size, size);
  const x = vw.sph.getContext('2d'), img = x.createImageData(W, H), d = img.data;
  const lut = lutOf(selGrad()), c = [0, 0, 0, 0], tint = rgbOfHex(state.view.tint);
  const R = W / 2 - 2, cx = W / 2, cy = H / 2, half = state.view.lookup === 'half';
  let [lx, ly, lz] = state.view.light;
  const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const nx = (px + 0.5 - cx) / R, ny = (cy - py - 0.5) / R, r2 = nx * nx + ny * ny;
      const edge = (1 - Math.sqrt(r2)) * R + 0.5;   // antialiased rim, in pixels
      if (edge <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - r2)), ndl = nx * lx + ny * ly + nz * lz;
      lutAt(lut, half ? ndl * 0.5 + 0.5 : Math.max(0, ndl), c);
      const i = (py * W + px) * 4;
      d[i] = c[0] * tint[0] * 255 + 0.5; d[i + 1] = c[1] * tint[1] * 255 + 0.5; d[i + 2] = c[2] * tint[2] * 255 + 0.5;
      d[i + 3] = c[3] * Math.min(1, edge) * 255 + 0.5;
    }
  }
  x.clearRect(0, 0, W, H);
  x.save();
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
  fillChecker(x, W, H, Math.round(12 * (W / size)));
  x.restore();
  const tmp = mk(W, H);
  tmp.getContext('2d').putImageData(img, 0, 0);
  x.drawImage(tmp, 0, 0);
  // Light direction marker.
  const mx = cx + lx * R, my = cy - ly * R;
  x.lineWidth = Math.max(1.5, W / size * 1.5);
  x.strokeStyle = lz >= 0 ? '#ffffff' : 'rgba(255,255,255,.5)';
  x.fillStyle = cssVar('--accent');
  x.beginPath(); x.arc(mx, my, 6 * (W / size), 0, Math.PI * 2); x.fill(); x.stroke();
}
let lightDrag = false;
function setLight(e) {
  const r = vw.sph.getBoundingClientRect(), R = r.width / 2 - 2;
  let nx = (e.clientX - r.left - r.width / 2) / R, ny = (r.top + r.height / 2 - e.clientY) / R;
  const l = Math.hypot(nx, ny);
  if (l > 1) { nx /= l; ny /= l; }
  state.view.light = [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))];
  schedule();
}
vw.sph.addEventListener('pointerdown', (e) => {
  lightDrag = true;
  try { vw.sph.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  setLight(e);
});
vw.sph.addEventListener('pointermove', (e) => { if (lightDrag) setLight(e); });
const endLight = () => { if (lightDrag) { lightDrag = false; autosave(); } };
vw.sph.addEventListener('pointerup', endLight);
vw.sph.addEventListener('pointercancel', endLight);
vw.spMode.addEventListener('change', () => { state.view.lookup = vw.spMode.value; autosave(); schedule(); });
vw.spTint.addEventListener('input', () => { state.view.tint = vw.spTint.value; autosave(); schedule(); });

/* ---------- curves: each channel and OKLab lightness across the gradient */
let cvHover = -1;
function renderCurves() {
  const r = vw.cvView.getBoundingClientRect();
  const cssW = Math.max(100, r.width - 40), cssH = Math.max(120, r.height - 36);
  const [W, H, dpr] = fitCanvas(vw.cv, cssW, cssH);
  const x = vw.cv.getContext('2d'), g = selGrad(), lut = lutOf(g), c = [0, 0, 0, 0];
  const strip = Math.round(18 * dpr), gap = Math.round(10 * dpr), plotH = H - strip - gap, top = Math.round(6 * dpr);
  const ph = plotH - top;
  x.clearRect(0, 0, W, H);
  // grid
  x.strokeStyle = cssVar('--grid'); x.lineWidth = 1;
  x.font = `${11 * dpr}px ${cssVar('--mono')}`; x.fillStyle = cssVar('--muted');
  for (let k = 0; k <= 4; k++) {
    const y = Math.round(top + ph * (1 - k / 4)) + 0.5;
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
    const xx = Math.round((W - 1) * (k / 4)) + 0.5;
    x.beginPath(); x.moveTo(xx, top); x.lineTo(xx, top + ph); x.stroke();
  }
  // stop positions
  x.setLineDash([3 * dpr, 4 * dpr]);
  for (const s of g.stops) { const xx = Math.round(s.pos * (W - 1)) + 0.5; x.beginPath(); x.moveTo(xx, top); x.lineTo(xx, top + ph); x.stroke(); }
  x.setLineDash([]);
  // channel lines
  const ch = state.view.ch, cols = { r: cssVar('--ch-r'), g: cssVar('--ch-g'), b: cssVar('--ch-b'), a: cssVar('--ch-a'), l: cssVar('--fg') };
  const val = { r: (q) => q[0], g: (q) => q[1], b: (q) => q[2], a: (q) => q[3], l: (q) => rgbToLab(q[0], q[1], q[2])[0] };
  for (const k of ['a', 'r', 'g', 'b', 'l']) {
    if (!ch[k]) continue;
    x.strokeStyle = cols[k]; x.lineWidth = (k === 'l' ? 2 : 1.5) * dpr;
    x.setLineDash(k === 'a' ? [5 * dpr, 4 * dpr] : []);
    x.beginPath();
    for (let i = 0; i < W; i++) {
      lutAt(lut, i / (W - 1), c);
      const y = top + ph * (1 - val[k](c));
      if (i) x.lineTo(i, y); else x.moveTo(i, y);
    }
    x.stroke();
  }
  x.setLineDash([]);
  // gradient strip under the plot
  const sc = mk(W, strip);
  drawStrip(sc, g, Math.round(6 * dpr));
  x.drawImage(sc, 0, H - strip);
  // hover readout
  if (cvHover >= 0) {
    const t = cvHover, xx = Math.round(t * (W - 1)) + 0.5;
    x.strokeStyle = cssVar('--accent'); x.lineWidth = 1;
    x.beginPath(); x.moveTo(xx, top); x.lineTo(xx, H); x.stroke();
    lutAt(lut, t, c);
    const L = rgbToLab(c[0], c[1], c[2])[0];
    vw.cvRead.textContent = `${fmt(t * 100, 1)}%  R ${Math.round(c[0] * 255)} G ${Math.round(c[1] * 255)} B ${Math.round(c[2] * 255)} A ${Math.round(c[3] * 255)}  L ${fmt(L, 3)}`;
  } else vw.cvRead.textContent = '';
}
vw.cv.addEventListener('pointermove', (e) => { const r = vw.cv.getBoundingClientRect(); cvHover = clamp((e.clientX - r.left) / r.width, 0, 1); schedule(); });
vw.cv.addEventListener('pointerleave', () => { cvHover = -1; schedule(); });
for (const el of $$('[data-ch]')) el.addEventListener('change', () => { state.view.ch[el.dataset.ch] = el.checked; autosave(); schedule(); });

/* ---------- code */
let codeKey = '', code = null;
function renderCode() {
  const v = state.view, F = FORMATS[v.fmt];
  vw.cdModeL.hidden = v.fmt !== 'css';
  vw.cdNL.hidden = !(F.samples || F.keys);
  vw.cdNName.textContent = F.keys ? 'Max stops' : 'Samples';
  vw.cdAllL.hidden = v.fmt === 'svg';
  const key = JSON.stringify([v.fmt, v.cmode, v.n, v.all, state.out, v.all || v.fmt === 'svg' ? state.grads : selGrad()]);
  if (key === codeKey) return;
  codeKey = key;
  code = generateCode();
  vw.cdOut.value = code.text;
}
vw.cdFmt.addEventListener('change', () => { state.view.fmt = vw.cdFmt.value; autosave(); schedule(); });
vw.cdMode.addEventListener('change', () => { state.view.cmode = vw.cdMode.value; autosave(); schedule(); });
vw.cdN.addEventListener('change', () => {
  const n = Math.round(clamp(parseFloat(vw.cdN.value) || 16, 2, 256));
  state.view.n = n; vw.cdN.value = n; autosave(); schedule();
});
vw.cdAll.addEventListener('change', () => { state.view.all = vw.cdAll.checked; autosave(); schedule(); });
vw.cdCopy.addEventListener('click', async () => { if (code) toast((await copyText(code.text)) ? 'Code copied.' : 'Copy failed: select the text and copy it by hand.'); });
vw.cdDl.addEventListener('click', () => { if (code) saveText(code.text, code.name, code.mime); });

function syncViewTools() {
  const v = state.view;
  vw.zoom.value = v.zoom; vw.tile.checked = v.tile;
  vw.spMode.value = v.lookup; vw.spTint.value = v.tint;
  for (const el of $$('[data-ch]')) el.checked = v.ch[el.dataset.ch];
  vw.cdFmt.value = v.fmt; vw.cdMode.value = v.cmode; vw.cdAll.checked = v.all;
  if (document.activeElement !== vw.cdN) vw.cdN.value = v.n;
}

function renderView() {
  syncViewTools();
  switch (state.view.mode) {
    case 'sphere': renderSphere(); break;
    case 'curves': renderCurves(); break;
    case 'code': renderCode(); break;
    default: renderTextureView();
  }
}
