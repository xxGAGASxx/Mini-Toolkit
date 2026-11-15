'use strict';
// The center views. Texture: the image (or the whole flipbook sheet) with zoom and pan, and
// dragging moves, turns or scales the selected layer. Preview: the texture on sprites, alone or
// as particles, tinted and blended over a background, the way it will look in a game.

const tv = { canvas: null, g: null, img: null, chan: null, res: null, draft: false, zoom: 1, ox: 0, oy: 0, fit: true, drag: null, space: false };
const fx = { canvas: null, g: null, sprite: null, spriteFor: null, tint: '', parts: [], raf: 0, last: 0, time: 0, acc: 0, burstT: 0 };

const EMITTERS = {
  single: { label: 'Single sprite' },
  burst: { label: 'Burst', every: 1.2, count: 26, life: [0.5, 1.0], speed: [0.3, 0.85], spread: 360, dir: 90, gravity: 0, size: [0.35, 0.6], grow: [0.7, 1.5], spin: [-3, 3], at: [0.5, 0.5], fadeIn: 0.02 },
  fountain: { label: 'Fountain', rate: 45, life: [0.9, 1.5], speed: [0.9, 1.3], spread: 26, dir: 90, gravity: 1.6, size: [0.18, 0.3], grow: [1, 0.5], spin: [-2, 2], at: [0.5, 0.8], fadeIn: 0.05 },
  rising: { label: 'Rising', rate: 9, life: [2.2, 3.2], speed: [0.1, 0.22], spread: 30, dir: 90, gravity: -0.05, size: [0.35, 0.55], grow: [0.6, 1.8], spin: [-0.5, 0.5], at: [0.5, 0.75], fadeIn: 0.25 },
};

/* ---------- shared */
function sizeCanvas(c) {
  const r = c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; return true; }
  return false;
}
// Backgrounds behind the texture. These stay the same in light and dark themes: most effect
// textures are white or bright, so the default checker is a dark one in both.
const CHECKERS = { checker: ['#2b2e36', '#1f2127'], 'checker-light': ['#ffffff', '#d9dce3'] };
const FILLS = { dark: '#16181d', black: '#000000', gray: '#7f7f7f', white: '#ffffff' };
const checkerTiles = {};
function paintBg(g, kind, color, x, y, w, hh) {
  if (has(CHECKERS, kind)) {
    if (!checkerTiles[kind]) {
      const t = h('canvas', { width: 16, height: 16 }), tg = t.getContext('2d'), [a, b] = CHECKERS[kind];
      tg.fillStyle = a; tg.fillRect(0, 0, 16, 16);
      tg.fillStyle = b; tg.fillRect(0, 0, 8, 8); tg.fillRect(8, 8, 8, 8);
      checkerTiles[kind] = t;
    }
    g.fillStyle = g.createPattern(checkerTiles[kind], 'repeat');
  } else g.fillStyle = has(FILLS, kind) ? FILLS[kind] : color;
  g.fillRect(x, y, w, hh);
}
const toCanvas = (img) => {
  const c = h('canvas', { width: img.width, height: img.height });
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
};

// A new render (draft or final) to show.
function showResult(res, draft) {
  tv.res = res;
  tv.draft = draft;
  tv.img = toCanvas(resultImage(res, state.doc.out, true, 'rgba'));
  tv.chan = null;
  if (tv.fit) fitTex();
  drawTex();
  fx.sprite = null;
}
function clearResult() {
  tv.res = tv.img = tv.chan = fx.sprite = null;
  drawTex();
}

/* ---------- texture view */
function sheetPx() {
  const sh = sheetOf(state.doc);
  return [sh.sw, sh.sh];
}
function fitTex() {
  const c = tv.canvas, dpr = window.devicePixelRatio || 1, W = c.width / dpr, H = c.height / dpr, [sw, sh] = sheetPx();
  tv.zoom = clamp(Math.min((W - 40) / sw, (H - 40) / sh), 0.02, 8);
  tv.ox = (W - sw * tv.zoom) / 2;
  tv.oy = (H - sh * tv.zoom) / 2;
  tv.fit = true;
}
function zoomAt(k, mx, my) {
  const z = clamp(tv.zoom * k, 0.02, 32);
  tv.ox = mx - ((mx - tv.ox) * z) / tv.zoom;
  tv.oy = my - ((my - tv.oy) * z) / tv.zoom;
  tv.zoom = z;
  tv.fit = false;
  drawTex();
}

function drawTex() {
  const c = tv.canvas;
  if (!c || state.view.tab !== 'texture') return;
  sizeCanvas(c);
  const g = tv.g, dpr = window.devicePixelRatio || 1, W = c.width / dpr, H = c.height / dpr, v = state.view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const [sw, sh] = sheetPx(), dw = sw * tv.zoom, dh = sh * tv.zoom;
  paintBg(g, v.channel === 'rgba' ? v.bg : 'black', v.bgColor, tv.ox, tv.oy, dw, dh);
  let img = tv.img;
  if (img && v.channel !== 'rgba') {
    if (!tv.chan) tv.chan = toCanvas(resultImage(tv.res, state.doc.out, state.doc.color.mode === 'alpha' || state.doc.color.mode === 'ramp', v.channel));
    img = tv.chan;
  }
  if (img) {
    g.imageSmoothingEnabled = tv.draft || tv.zoom < 3;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, tv.ox, tv.oy, dw, dh);
  }
  const doc = state.doc, s = sheetOf(doc);
  g.lineWidth = 1;
  if (doc.anim.on && v.grid && s.n > 1) {
    g.strokeStyle = 'rgba(255, 140, 60, .55)';
    g.beginPath();
    for (let i = 1; i < s.cols; i++) { const x = Math.round(tv.ox + i * doc.w * tv.zoom) + 0.5; g.moveTo(x, tv.oy); g.lineTo(x, tv.oy + dh); }
    for (let i = 1; i < s.rows; i++) { const y = Math.round(tv.oy + i * doc.h * tv.zoom) + 0.5; g.moveTo(tv.ox, y); g.lineTo(tv.ox + dw, y); }
    g.stroke();
  }
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#888';
  g.strokeRect(Math.round(tv.ox) - 0.5, Math.round(tv.oy) - 0.5, Math.round(dw) + 1, Math.round(dh) + 1);
  // While dragging a layer: a crosshair at its center.
  const d = tv.drag;
  if (d && d.mode !== 'pan') {
    const L = selLayer();
    if (L) {
      const [cx, cy] = layerScreenPos(L, d.cell);
      g.strokeStyle = '#ff8c3c';
      g.beginPath();
      g.moveTo(cx - 9, cy); g.lineTo(cx + 9, cy); g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 9);
      g.stroke();
    }
  }
  $('#zoom-out').textContent = `${Math.round(tv.zoom * 100)}%`;
}

// Screen position of a layer's center, in frame `cell` of the sheet.
function layerScreenPos(L, cell) {
  const doc = state.doc, s = sheetOf(doc), m = Math.min(doc.w, doc.h);
  const fx0 = (cell % s.cols) * doc.w, fy0 = Math.floor(cell / s.cols) * doc.h;
  return [tv.ox + (fx0 + doc.w / 2 + (L.x / 100) * (m / 2)) * tv.zoom, tv.oy + (fy0 + doc.h / 2 - (L.y / 100) * (m / 2)) * tv.zoom];
}
const movable = () => { const L = selLayer(); return !!L && !GEN[L.type].full; };

function initTexView() {
  const c = tv.canvas = $('#tex-canvas');
  tv.g = c.getContext('2d');
  const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), mx, my);
  }, { passive: false });

  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    c.focus();
    const [mx, my] = local(e), L = selLayer(), doc = state.doc, s = sheetOf(doc);
    const pan = e.button === 1 || tv.space || !movable();
    let mode = pan ? 'pan' : e.shiftKey ? 'turn' : e.altKey ? 'scale' : 'move';
    // Which frame the pointer is over, so the crosshair and turning use that frame's center.
    const fxi = clamp(Math.floor((mx - tv.ox) / tv.zoom / doc.w), 0, s.cols - 1), fyi = clamp(Math.floor((my - tv.oy) / tv.zoom / doc.h), 0, s.rows - 1);
    const cell = Math.min(fyi * s.cols + fxi, s.n - 1);
    tv.drag = { mode, x0: mx, y0: my, ox: tv.ox, oy: tv.oy, cell, moved: false, start: L && { x: L.x, y: L.y, rot: L.rot, scale: L.scale } };
    if (mode === 'turn') {
      const [cx, cy] = layerScreenPos(L, cell);
      tv.drag.a0 = Math.atan2(-(my - cy), mx - cx);
    }
    try { c.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    c.style.cursor = pan ? 'grabbing' : mode === 'move' ? 'move' : mode === 'turn' ? 'alias' : 'ns-resize';
  });
  c.addEventListener('pointermove', (e) => {
    const d = tv.drag;
    if (!d) { c.style.cursor = tv.space || !movable() ? 'grab' : 'move'; return; }
    const [mx, my] = local(e), dx = mx - d.x0, dy = my - d.y0;
    if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;
    if (d.mode === 'pan') {
      tv.ox = d.ox + dx;
      tv.oy = d.oy + dy;
      tv.fit = false;
      drawTex();
      return;
    }
    const L = selLayer();
    if (!L || !d.start) return;
    const unit = (Math.min(state.doc.w, state.doc.h) / 2) * tv.zoom;   // screen px per layer unit
    if (d.mode === 'move') {
      L.x = clamp(Math.round((d.start.x + (dx / unit) * 100) * 2) / 2, -150, 150);
      L.y = clamp(Math.round((d.start.y - (dy / unit) * 100) * 2) / 2, -150, 150);
    } else if (d.mode === 'turn') {
      const [cx, cy] = layerScreenPos({ ...L, x: d.start.x, y: d.start.y }, d.cell);
      let r = d.start.rot + (Math.atan2(-(my - cy), mx - cx) - d.a0) / DEG;
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      L.rot = clamp(Math.round(r), -180, 180);
    } else {
      L.scale = clamp(Math.round(d.start.scale * Math.exp(-dy * 0.006)), 5, 400);
    }
    changed();
  });
  const end = () => {
    const d = tv.drag;
    if (!d) return;
    tv.drag = null;
    c.style.cursor = '';
    if (d.mode !== 'pan' && d.moved) changed(true);
    drawTex();
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('dblclick', () => { fitTex(); drawTex(); });

  $('#zoom-fit').addEventListener('click', () => { fitTex(); drawTex(); });
  $('#zoom-1').addEventListener('click', () => {
    const dpr = window.devicePixelRatio || 1;
    zoomAt(1 / tv.zoom, tv.canvas.width / dpr / 2, tv.canvas.height / dpr / 2);
  });
  $('#zoom-in').addEventListener('click', () => { const dpr = window.devicePixelRatio || 1; zoomAt(1.25, c.width / dpr / 2, c.height / dpr / 2); });
  $('#zoom-minus').addEventListener('click', () => { const dpr = window.devicePixelRatio || 1; zoomAt(0.8, c.width / dpr / 2, c.height / dpr / 2); });
}

/* ---------- preview */
// The texture tinted: multiplied by the tint color, keeping its alpha.
function fxSprite() {
  const v = state.view;
  if (!tv.img) return null;
  if (fx.sprite && fx.spriteFor === tv.img && fx.tint === v.tint) return fx.sprite;
  const src = tv.img, c = h('canvas', { width: src.width, height: src.height }), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  if (v.tint.toLowerCase() !== '#ffffff') {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = v.tint;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
  }
  fx.sprite = c;
  fx.spriteFor = src;
  fx.tint = v.tint;
  return c;
}

const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);
function spawn(E, S, W, H) {
  const a = (E.dir + (Math.random() - 0.5) * E.spread) * DEG, sp = rnd(E.speed) * S;
  fx.parts.push({
    x: E.at[0] * W, y: E.at[1] * H, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp, age: 0, life: rnd(E.life),
    size: rnd(E.size), grow: rnd(E.grow), rot: Math.random() * TAU, spin: rnd(E.spin), phase: Math.random(),
  });
}

function fxFrame(now) {
  fx.raf = 0;
  const v = state.view, c = fx.canvas;
  if (v.tab !== 'preview' || document.hidden) return;
  sizeCanvas(c);
  const dt = fx.last ? Math.min((now - fx.last) / 1000, 0.1) : 0;
  fx.last = now;
  if (v.playing) fx.time += dt;
  const g = fx.g, dpr = window.devicePixelRatio || 1, W = c.width / dpr, H = c.height / dpr, S = Math.min(W, H);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  paintBg(g, v.fxBg, v.fxColor, 0, 0, W, H);

  const sprite = fxSprite(), res = tv.res, doc = state.doc;
  if (sprite && res) {
    const n = res.n, cols = res.cols, fw = sprite.width / cols, fh = sprite.height / res.rows;
    const aspect = res.w / res.h, fps = doc.anim.fps, loop = doc.anim.loop;
    g.globalCompositeOperation = v.blend === 'add' ? 'lighter' : 'source-over';
    const draw = (x, y, size, rot, alpha, frame) => {
      const w = aspect >= 1 ? size : size * aspect, hh = aspect >= 1 ? size / aspect : size;
      const cs = Math.cos(rot) * dpr, sn = Math.sin(rot) * dpr;
      g.setTransform(cs, sn, -sn, cs, x * dpr, y * dpr);
      g.globalAlpha = clamp01(alpha);
      g.drawImage(sprite, (frame % cols) * fw, Math.floor(frame / cols) * fh, fw, fh, -w / 2, -hh / 2, w, hh);
    };
    const E = EMITTERS[v.emitter] || EMITTERS.single;
    if (v.emitter === 'single') {
      fx.parts.length = 0;
      draw(W / 2, H / 2, S * (v.size / 100) * 1.4, 0, 1, n > 1 ? Math.floor(fx.time * fps) % n : 0);
    } else {
      if (v.playing) {
        if (E.rate) {
          fx.acc += dt * E.rate;
          while (fx.acc >= 1) { fx.acc -= 1; spawn(E, S, W, H); }
        } else {
          fx.burstT -= dt;
          if (fx.burstT <= 0) { fx.burstT = E.every; for (let i = 0; i < E.count; i++) spawn(E, S, W, H); }
        }
        for (const p of fx.parts) {
          p.age += dt;
          p.vy += E.gravity * S * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.spin * dt;
        }
        fx.parts = fx.parts.filter((p) => p.age < p.life).slice(-600);
      }
      for (const p of fx.parts) {
        const f = p.age / p.life;
        const alpha = clamp01(f / E.fadeIn) * (1 - smooth01(clamp01((f - 0.35) / 0.65)));
        const frame = n <= 1 ? 0 : loop ? Math.floor(p.age * fps + p.phase * n) % n : Math.min(n - 1, Math.floor(f * n));
        draw(p.x, p.y, S * (v.size / 100) * p.size * lerp(1, p.grow, f), p.rot, alpha, frame);
      }
    }
  }
  fxTick();
}
function fxTick() {
  if (!fx.raf && state.view.tab === 'preview') fx.raf = requestAnimationFrame(fxFrame);
}
function fxRestart() {
  fx.parts.length = 0;
  fx.time = 0;
  fx.acc = 0;
  fx.burstT = 0;
}

function initPreview() {
  fx.canvas = $('#fx-canvas');
  fx.g = fx.canvas.getContext('2d');
  document.addEventListener('visibilitychange', () => { fx.last = 0; fxTick(); });
}

/* ---------- toolbar: view tabs and the settings of each view */
function initViewBar() {
  const v = state.view;
  const bind = (sel, key, ev = 'change', after) => {
    const el = $(sel);
    el.addEventListener(ev, () => {
      v[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      saveView();
      if (after) after();
      syncViewBar();
      drawTex();
    });
  };
  bind('#v-bg', 'bg');
  bind('#v-bgcolor', 'bgColor', 'input');
  bind('#v-channel', 'channel', 'change', () => { tv.chan = null; });
  bind('#v-grid', 'grid');
  bind('#fx-emitter', 'emitter', 'change', fxRestart);
  bind('#fx-blend', 'blend');
  bind('#fx-tint', 'tint', 'input');
  bind('#fx-size', 'size', 'input');
  bind('#fx-bg', 'fxBg');
  bind('#fx-color', 'fxColor', 'input');
  $('#fx-emitter').replaceChildren(...Object.entries(EMITTERS).map(([k, e]) => h('option', { value: k, text: e.label })));
  $('#fx-play').addEventListener('click', () => { v.playing = !v.playing; saveView(); syncViewBar(); });
  $('#fx-restart').addEventListener('click', fxRestart);

  const tabs = $$('[role="tab"]', $('#view-tabs'));
  const select = (tab) => {
    v.tab = tab.dataset.view;
    saveView();
    syncViewBar();
    if (v.tab === 'texture') drawTex(); else { fx.last = 0; fxTick(); }
  };
  for (const t of tabs) t.addEventListener('click', () => select(t));
  $('#view-tabs').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    const next = { ArrowRight: tabs[(i + 1) % tabs.length], ArrowLeft: tabs[(i - 1 + tabs.length) % tabs.length] }[e.key];
    if (!next) return;
    e.preventDefault();
    next.focus();
    select(next);
  });
  syncViewBar();
}

function syncViewBar() {
  const v = state.view, tex = v.tab === 'texture';
  for (const t of $$('#view-tabs [role="tab"]')) {
    const on = t.dataset.view === v.tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
  }
  $('#bar-tex').hidden = !tex;
  $('#bar-fx').hidden = tex;
  $('#tex-canvas').hidden = !tex;
  $('#fx-canvas').hidden = tex;
  $('#view-hint').textContent = tex
    ? (movable() ? 'Drag: move layer · Shift+drag: turn · Alt+drag: scale · Middle-drag or Space+drag: pan · Wheel: zoom · Double-click: fit' : 'Drag: pan · Wheel: zoom · Double-click: fit')
    : 'The texture on sprites, tinted and blended the way a game engine would draw it.';
  const set = (sel, val) => { const el = $(sel); if (el.type === 'checkbox') el.checked = val; else el.value = val; };
  set('#v-bg', v.bg); set('#v-bgcolor', v.bgColor); set('#v-channel', v.channel); set('#v-grid', v.grid);
  set('#fx-emitter', v.emitter); set('#fx-blend', v.blend); set('#fx-tint', v.tint); set('#fx-size', v.size);
  set('#fx-bg', v.fxBg); set('#fx-color', v.fxColor);
  $('#v-bgcolor').hidden = v.bg !== 'custom' || v.channel !== 'rgba';
  $('#v-bg').disabled = v.channel !== 'rgba';
  $('#fx-color').hidden = v.fxBg !== 'custom';
  $('#v-grid-wrap').hidden = !state.doc.anim.on;
  const play = $('#fx-play');
  play.replaceChildren(icon(v.playing ? 'pause' : 'play'));
  play.setAttribute('aria-label', v.playing ? 'Pause' : 'Play');
  play.title = v.playing ? 'Pause (Space)' : 'Play (Space)';
}
