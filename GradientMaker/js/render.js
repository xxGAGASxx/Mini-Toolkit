'use strict';
// Renders the output texture: the current gradient, or every gradient as atlas rows or columns,
// drawn with the chosen shape, outside mode, padding, background, dithering and bit depth.

const PREVIEW_PX = 1 << 20;   // live previews above this many pixels are drawn smaller
const pow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

// Texture geometry: cell size w×h, n cells, full size W×H.
function texLayout() {
  const o = state.out, single = o.layout === 'single';
  const grads = single ? [selGrad()] : state.grads, n = grads.length, pad = n > 1 ? o.pad : 0;
  let W = o.w, H = o.h;
  if (o.layout === 'rows') H = n * o.h + (n - 1) * pad;
  if (o.layout === 'cols') W = n * o.w + (n - 1) * pad;
  const cw = W, ch = H;   // before power-of-two rounding
  if (o.pot) { W = pow2(W); H = pow2(H); }
  return { grads, n, w: o.w, h: o.h, pad, W, H, cw, ch, nx: o.layout === 'cols' ? n : 1, ny: o.layout === 'rows' ? n : 1 };
}

// Maps a pixel to a gradient position t (before the outside mode). x, y are in cell pixels.
function shapeFn(o, w, h) {
  const a = (o.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const cx = (o.cx / 100) * w, cy = (o.cy / 100) * h, s = Math.max(0.01, o.scale / 100);
  const side = o.circle ? Math.min(w, h) : 0;
  const rx = ((side || w) / 2) * s, ry = ((side || h) / 2) * s;
  // Length of the gradient line across the cell, corner to corner along the angle (as in CSS).
  // With "end colors on edge pixels" it runs between the outermost pixel centers instead.
  const edge = o.ends ? Math.abs(cs) + Math.abs(sn) : 0;
  const len = Math.max(1e-6, (Math.abs(w * cs) + Math.abs(h * sn) - edge) * s);
  switch (o.shape) {
    case 'reflect': return (x, y) => Math.abs((x - cx) * cs + (y - cy) * sn) / (len / 2);
    case 'radial': return (x, y) => { const dx = x - cx, dy = y - cy, u = (dx * cs + dy * sn) / rx, v = (dy * cs - dx * sn) / ry; return Math.sqrt(u * u + v * v); };
    case 'diamond': return (x, y) => { const dx = x - cx, dy = y - cy; return Math.abs((dx * cs + dy * sn) / rx) + Math.abs((dy * cs - dx * sn) / ry); };
    case 'square': return (x, y) => { const dx = x - cx, dy = y - cy; return Math.max(Math.abs((dx * cs + dy * sn) / rx), Math.abs((dy * cs - dx * sn) / ry)); };
    case 'angular': return (x, y) => { let t = (Math.atan2(y - cy, x - cx) - a) / (2 * Math.PI); t -= Math.floor(t); return t / s; };
    default: return (x, y) => 0.5 + ((x - cx) * cs + (y - cy) * sn) / len;
  }
}
const WRAP = {
  clamp: (t) => (t < 0 ? 0 : t > 1 ? 1 : t),
  repeat: (t) => t - Math.floor(t),
  mirror: (t) => { const u = t - 2 * Math.floor(t / 2); return u > 1 ? 2 - u : u; },
};

// Finds the cell along one axis. Returns the cell index and the position inside it, or -1 when
// the point is in a gap (or past the content) and the padding is left empty.
const axisOut = [0, 0];
function axis(s, n, size, pad, extend) {
  const stride = size + pad;
  let i = Math.floor(s / stride);
  if (i >= n) i = n - 1;
  let local = s - i * stride;
  if (local > size) {
    if (!extend) return -1;
    // Gaps take the nearer neighbour's edge pixels; space past the last cell takes the last cell's.
    if (i < n - 1 && local - size > pad / 2) { i++; local = 0; } else local = size;
  }
  axisOut[0] = i;
  axisOut[1] = local < 0.5 ? 0.5 : local > size - 0.5 ? size - 0.5 : local;
  return i;
}

// 8×8 Bayer thresholds in 0..1, for ordered dithering.
const BAYER = (() => {
  const m = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let bit = 0; bit < 3; bit++) v = (v << 2) | ((((x ^ y) >> bit) & 1) << 1) | ((y >> bit) & 1);
      m[y * 8 + x] = (v + 0.5) / 64;
    }
  }
  return m;
})();
function hash01(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Renders the W×H texture into a tw×th buffer: Uint8ClampedArray for 8 bits, Uint16Array for 16.
function renderTexture(L, tw, th, depth) {
  const o = state.out, kx = L.W / tw, ky = L.H / th, extend = o.padFill === 'extend';
  const data = depth === 16 ? new Uint16Array(tw * th * 4) : new Uint8ClampedArray(tw * th * 4);
  const luts = L.grads.map(lutOf), shape = shapeFn(o, L.w, L.h), wrap = WRAP[o.repeat] || WRAP.clamp;
  const bg = o.bgOn ? rgbOfHex(o.bg) : null, c = [0, 0, 0, 0];
  const dither = depth === 8 ? o.dither : 'none';
  let p = 0;
  for (let py = 0; py < th; py++) {
    const sy = (py + 0.5) * ky;
    const iy = axis(sy, L.ny, L.h, L.pad, extend), ly = axisOut[1];
    for (let px = 0; px < tw; px++, p += 4) {
      const ix = iy < 0 ? -1 : axis((px + 0.5) * kx, L.nx, L.w, L.pad, extend);
      if (ix < 0) {   // empty padding
        if (bg) {
          if (depth === 16) { data[p] = bg[0] * 65535 + 0.5; data[p + 1] = bg[1] * 65535 + 0.5; data[p + 2] = bg[2] * 65535 + 0.5; data[p + 3] = 65535; }
          else { data[p] = Math.round(bg[0] * 255); data[p + 1] = Math.round(bg[1] * 255); data[p + 2] = Math.round(bg[2] * 255); data[p + 3] = 255; }
        }
        continue;
      }
      lutAt(luts[L.ny > 1 ? iy : ix], wrap(shape(axisOut[1], ly)), c);
      let r = c[0], g = c[1], b = c[2], al = c[3];
      if (bg) { r = r * al + bg[0] * (1 - al); g = g * al + bg[1] * (1 - al); b = b * al + bg[2] * (1 - al); al = 1; }
      if (depth === 16) {
        data[p] = r * 65535 + 0.5; data[p + 1] = g * 65535 + 0.5; data[p + 2] = b * 65535 + 0.5; data[p + 3] = al * 65535 + 0.5;
      } else {
        const d = dither === 'ordered' ? BAYER[((py & 7) << 3) | (px & 7)] : dither === 'noise' ? hash01(px, py) : 0.5;
        data[p] = Math.floor(r * 255 + d); data[p + 1] = Math.floor(g * 255 + d);
        data[p + 2] = Math.floor(b * 255 + d); data[p + 3] = Math.floor(al * 255 + d);
      }
    }
  }
  return data;
}

// Live preview size: the real texture, or a smaller copy of very large ones.
function previewSize(L) {
  const px = L.W * L.H;
  if (px <= PREVIEW_PX) return [L.W, L.H];
  const k = Math.sqrt(PREVIEW_PX / px);
  return [Math.max(1, Math.round(L.W * k)), Math.max(1, Math.round(L.H * k))];
}
