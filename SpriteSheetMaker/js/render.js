'use strict';
// Render scheduling, sidebar sync, sheet and preview drawing, anchor pickers.

let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

function render() {
  const n = state.sprites.length;
  if (state.frame >= n) state.frame = Math.max(0, n - 1);
  updateUI();
  if (state.tab === 'main') renderSheet(); else renderPreview();
}

function updateUI() {
  const n = state.sprites.length, s = selected();
  const [cw, ch, aw, ah] = cell(), cols = effCols(), rows = Math.ceil(n / cols);
  const sw = cols * cw + (cols - 1) * state.pad, sh = rows * ch + (rows - 1) * state.pad;
  els.stats.textContent = n
    ? `${n} sprite${n > 1 ? 's' : ''} · ${cols}×${rows} cells of ${cw}×${ch} · sheet ${sw}×${sh} px`
    : 'No sprites yet';
  els.cw.placeholder = n ? `auto (${aw})` : 'auto';
  els.ch.placeholder = n ? `auto (${ah})` : 'auto';
  els.empty.hidden = n > 0;
  els.sheetWrap.hidden = n === 0;
  els.sample.hidden = !(state.tab === 'main' && n > 0 && state.sprites.every((x) => x.sample));
  els.dup.disabled = els.del.disabled = !s;
  els.rev.disabled = n < 2;
  els.clear.disabled = !n;
  const u = hist.undo[hist.undo.length - 1], r = hist.redo[hist.redo.length - 1];
  els.undo.disabled = !u;
  els.redo.disabled = !r;
  els.undo.title = u ? `Undo ${u.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  els.redo.title = r ? `Redo ${r.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
  els.exportBtns.forEach((b) => (b.disabled = !n || busy));
  els.exNote.textContent = `Frames export at cell size${state.scale > 1 ? ` ×${state.scale}` : ''}. JPEG always fills the background. GIF plays at ${state.fps} fps.`
    + (state.json ? ' Sheet .png and .jpg also save spritesheet.json with each frame\'s rectangle.' : '');
  markAnchor(els.alignAll, state.align[0], state.align[1]);
  // color panel follows the selection
  const a = s ? s.adj : state.global;
  for (const k of 'hsbc') {
    const inp = $('#adj-' + k);
    if (+inp.value !== a[k]) inp.value = a[k];
    $('#out-' + k).textContent = fmtAdj(k, a[k]);
  }
  els.adjTarget.textContent = s ? `Sprite ${selIdx() + 1} only ✕` : 'All sprites';
  els.adjTarget.classList.toggle('one', !!s);
  els.adjTarget.title = s ? 'Clear selection to adjust all sprites' : '';
}
const fmtAdj = (k, v) => (k === 'h' ? `${v > 0 ? '+' : ''}${v}°` : `${v}%`);

function renderSheet() {
  const n = state.sprites.length;
  if (!n) { els.sheet.replaceChildren(); return; }
  const [cw, ch] = cell(), z = state.zoom, sh = els.sheet;
  sh.style.gridTemplateColumns = `repeat(${effCols()}, ${cw * z}px)`;
  sh.style.gap = `${state.pad * z}px`;
  sh.classList.toggle('px', z >= 1);
  sh.classList.toggle('big', Math.min(cw, ch) * z >= 56);
  while (sh.children.length > n) sh.lastChild.remove();
  while (sh.children.length < n) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.innerHTML = '<canvas></canvas><span class="idx"></span>';
    sh.appendChild(d);
  }
  state.sprites.forEach((s, i) => {
    const el = sh.children[i], c = el.firstChild;
    el.dataset.i = i;
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    c.style.width = cw * z + 'px';
    c.style.height = ch * z + 'px';
    const x = c.getContext('2d');
    x.clearRect(0, 0, cw, ch);
    const [px, py] = pos(s, cw, ch);
    x.drawImage(procOf(s), px, py);
    el.lastChild.textContent = i + 1;
    el.title = `${i + 1}. ${s.name} (${s.w}×${s.h})`;
    el.classList.toggle('sel', s.id === state.sel);
    el.classList.toggle('adj', !isId(s.adj));
  });
}

function renderPreview() {
  const n = state.sprites.length, c = els.pv, s = cur();
  els.frame.max = Math.max(1, n);
  els.frame.value = state.frame + 1;
  els.frame.disabled = n < 2;
  els.frameLabel.textContent = n ? `${state.frame + 1} / ${n}` : '0 / 0';
  [els.prev, els.next, els.play].forEach((b) => (b.disabled = n < 2));
  els.play.classList.toggle('on', state.playing);
  els.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  els.pvWrap.classList.toggle('none', !n);
  c.hidden = !n;
  els.pvEmpty.hidden = !!n;
  [els.offX, els.offY, els.offReset].forEach((e) => (e.disabled = !n));
  if (!n) { els.frameTitle.textContent = 'Frame'; els.frameInfo.textContent = ''; return; }

  const [cw, ch] = cell();
  if (c.width !== cw) c.width = cw;
  if (c.height !== ch) c.height = ch;
  const aw = els.pvWrap.clientWidth - 48, ah = els.pvWrap.clientHeight - 48;
  let z = Math.min(aw / cw, ah / ch);
  z = z >= 1 ? Math.min(Math.floor(z), 32) : Math.max(z, 0.05);
  c.style.width = cw * z + 'px';
  c.style.height = ch * z + 'px';
  c.classList.toggle('px', z >= 1);

  const x = c.getContext('2d');
  x.clearRect(0, 0, cw, ch);
  const sides = [state.onionPrev && -1, state.onionNext && 1].filter(Boolean);
  if (sides.length && !state.playing) {
    const k = state.onionN, a = state.onionA / 100;
    for (let d = k; d >= 1; d--) {            // farthest first, fading with distance
      x.globalAlpha = a * (1 - (d - 1) / k);
      for (const side of sides) {
        const j = state.frame + side * d;
        if (j < 0 || j >= n) continue;
        const o = state.sprites[j], [px, py] = pos(o, cw, ch);
        x.drawImage(procOf(o), px, py);
      }
    }
    x.globalAlpha = 1;
  }
  const [px, py] = pos(s, cw, ch);
  x.drawImage(procOf(s), px, py);

  els.frameTitle.textContent = `Frame ${state.frame + 1}`;
  els.frameInfo.textContent = `${s.name} · ${s.w}×${s.h}`;
  els.frameInfo.title = s.name;
  if (document.activeElement !== els.offX) els.offX.value = s.ox;
  if (document.activeElement !== els.offY) els.offY.value = s.oy;
  markAnchor(els.alignFrame, s.ax, s.ay);
}

/* ================= anchors ================= */
function buildAnchor(el, onPick) {
  for (const [ax, ay, label] of ANCHORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'anc'; b.title = label;
    b.setAttribute('aria-label', label);
    b.dataset.ax = ax; b.dataset.ay = ay;
    b.addEventListener('click', () => onPick(ax, ay, label));
    el.appendChild(b);
  }
}
function markAnchor(el, ax, ay) {
  for (const b of el.children) {
    const on = +b.dataset.ax === ax && +b.dataset.ay === ay;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
}
