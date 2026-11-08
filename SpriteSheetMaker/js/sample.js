'use strict';
// Built-in sample: a procedural 8-frame slime idle loop.

function slimeFrame(i, n) {
  const q = Math.sin(i / n * Math.PI * 2);
  const w = Math.round(18 + 4 * q), h = Math.round(15 - 3 * q);
  const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true }), im = x.createImageData(w, h), d = im.data;
  const cx = w / 2, top = h * 0.6, bot = h - top;
  const inside = (px, py) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    const nx = (px + 0.5 - cx) / (w / 2), dy = py + 0.5 - top;
    if (dy < 0) { const ny = dy / top; return nx * nx + ny * ny <= 1; }
    const ny = dy / bot; return nx ** 4 + ny ** 4 <= 1;
  };
  const put = (px, py, col) => { const p = (py * w + px) * 4; d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255; };
  const OUT = [24, 52, 44], BODY = [74, 196, 130], SHADE = [44, 150, 100], HI = [204, 247, 218], EYE = [14, 28, 22];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    if (!inside(px, py)) continue;
    const edge = !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
    let col = edge ? OUT : py > h * 0.72 ? SHADE : BODY;
    if (!edge && Math.hypot(px - w * 0.3, py - h * 0.32) < 1.4) col = HI;
    put(px, py, col);
  }
  const ey = Math.round(h * 0.48);
  for (const ex of [Math.floor(cx) - 3, Math.ceil(cx) + 2]) { put(ex, ey, EYE); put(ex, ey + 1, EYE); }
  x.putImageData(im, 0, 0);
  return c;
}
function loadSample() {
  state.sprites = Array.from({ length: 8 }, (_, i) => makeSprite(slimeFrame(i, 8), `slime_${i + 1}`, true));
  state.sel = null; state.frame = 0;
  autoZoom();
  schedule();
}
$('#empty-sample').addEventListener('click', loadSample);
$('#sample-clear').addEventListener('click', () => { state.sprites = []; state.sel = null; schedule(); });
