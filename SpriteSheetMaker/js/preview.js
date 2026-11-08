'use strict';
// Preview tab: playback, dragging and nudging a frame, onion skin, align frame.

/* ================= preview: playback ================= */
let last = 0, acc = 0;
function setFrame(i) {
  const n = state.sprites.length; if (!n) return;
  state.frame = ((i % n) + n) % n;
  schedule();
}
function play() {
  if (state.playing || state.sprites.length < 2) return;
  state.playing = true; last = 0; acc = 0;
  requestAnimationFrame(tick);
  schedule();
}
function pause() { if (state.playing) { state.playing = false; schedule(); } }
function tick(t) {
  if (!state.playing) return;
  if (!last) last = t;
  acc += Math.min(t - last, 250); last = t;
  const step = 1000 / state.fps; let moved = false;
  while (acc >= step) { acc -= step; state.frame = (state.frame + 1) % state.sprites.length; moved = true; }
  if (moved) schedule();
  requestAnimationFrame(tick);
}
els.play.addEventListener('click', () => (state.playing ? pause() : play()));
els.prev.addEventListener('click', () => { pause(); setFrame(state.frame - 1); });
els.next.addEventListener('click', () => { pause(); setFrame(state.frame + 1); });
els.frame.addEventListener('input', () => { pause(); setFrame(+els.frame.value - 1); });
els.fps.addEventListener('input', () => { const v = parseInt(els.fps.value, 10); if (v > 0) { state.fps = clamp(v, 1, 60); schedule(); } });

/* ================= preview: reposition ================= */
let pvDrag = null;
els.pvWrap.addEventListener('pointerdown', (e) => {
  const s = cur(); if (!s || e.button !== 0) return;
  e.preventDefault(); pause();
  els.pvWrap.focus({ preventScroll: true });
  els.pvWrap.setPointerCapture(e.pointerId);
  const r = els.pv.getBoundingClientRect();
  pvDrag = { x: e.clientX, y: e.clientY, ox: s.ox, oy: s.oy, k: r.width / els.pv.width, id: s.id };
  els.pvWrap.classList.add('grabbing');
});
els.pvWrap.addEventListener('pointermove', (e) => {
  if (!pvDrag) return;
  const s = state.sprites.find((x) => x.id === pvDrag.id); if (!s) return;
  const nx = pvDrag.ox + Math.round((e.clientX - pvDrag.x) / pvDrag.k);
  const ny = pvDrag.oy + Math.round((e.clientY - pvDrag.y) / pvDrag.k);
  if (nx !== s.ox || ny !== s.oy) { s.ox = nx; s.oy = ny; schedule(); }
});
const endPv = () => { pvDrag = null; els.pvWrap.classList.remove('grabbing'); };
els.pvWrap.addEventListener('pointerup', endPv);
els.pvWrap.addEventListener('pointercancel', endPv);
els.offX.addEventListener('input', () => { const s = cur(), v = parseInt(els.offX.value, 10); if (s && !isNaN(v)) { s.ox = v; schedule(); } });
els.offY.addEventListener('input', () => { const s = cur(), v = parseInt(els.offY.value, 10); if (s && !isNaN(v)) { s.oy = v; schedule(); } });
els.offReset.addEventListener('click', () => { const s = cur(); if (s) { s.ox = 0; s.oy = 0; schedule(); } });

els.onion.addEventListener('change', () => { state.onion = els.onion.checked; schedule(); });
els.onionN.addEventListener('input', () => { const v = parseInt(els.onionN.value, 10); if (v > 0) { state.onionN = clamp(v, 1, 8); schedule(); } });
els.onionA.addEventListener('input', () => { state.onionA = +els.onionA.value; els.onionAOut.textContent = state.onionA + '%'; schedule(); });

/* ================= align frame ================= */
buildAnchor(els.alignFrame, (ax, ay) => {
  const s = cur(); if (!s) return;
  s.ax = ax; s.ay = ay; s.ox = 0; s.oy = 0;
  schedule();
});
