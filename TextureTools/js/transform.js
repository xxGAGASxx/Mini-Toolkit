'use strict';
// Transform tab operations: resize, crop, canvas size, trim, rotate, flip, wrap offset.
// Each takes an image and returns a new one.

/* ---------- resize */
const RESAMPLE = {
  bilinear: { r: 1, f: (x) => { x = Math.abs(x); return x < 1 ? 1 - x : 0; } },
  // Catmull-Rom (Keys cubic, a = -0.5)
  bicubic: {
    r: 2,
    f: (x) => {
      x = Math.abs(x);
      return x < 1 ? (1.5 * x - 2.5) * x * x + 1 : x < 2 ? ((-0.5 * x + 2.5) * x - 4) * x + 2 : 0;
    },
  },
  lanczos: {
    r: 3,
    f: (x) => {
      if (x === 0) return 1;
      if (x <= -3 || x >= 3) return 0;
      const p = Math.PI * x;
      return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
    },
  },
};

// For each output pixel, the source pixels and weights that make it. When shrinking, the filter is
// stretched over the source so every source pixel counts (no aliasing).
function resampleWeights(srcN, dstN, filter, wrap) {
  const scale = srcN / dstN, fs = Math.max(1, scale), support = filter.r * fs;
  const taps = Math.ceil(support * 2) + 3;
  const idx = new Int32Array(dstN * taps), wt = new Float32Array(dstN * taps), cnt = new Int32Array(dstN);
  for (let i = 0; i < dstN; i++) {
    const center = (i + 0.5) * scale, lo = Math.floor(center - support), hi = Math.ceil(center + support), o = i * taps;
    let sum = 0, k = 0;
    for (let j = lo; j <= hi && k < taps; j++) {
      const v = filter.f((j + 0.5 - center) / fs);
      if (v === 0) continue;
      idx[o + k] = wrap ? mod(j, srcN) : clamp(j, 0, srcN - 1);
      wt[o + k] = v; sum += v; k++;
    }
    if (!k) { idx[o] = clamp(Math.floor(center), 0, srcN - 1); wt[o] = 1; k = 1; sum = 1; }
    for (let t = 0; t < k; t++) wt[o + t] /= sum;
    cnt[i] = k;
  }
  return { idx, wt, cnt, taps };
}

function resize(img, nw, nh, filterName, wrap) {
  if (filterName === 'nearest') return resizeNearest(img, nw, nh);
  const f = RESAMPLE[filterName] || RESAMPLE.bicubic, { w, h } = img, src = toPremul(img);
  const H = resampleWeights(w, nw, f, wrap), V = resampleWeights(h, nh, f, wrap);
  const mid = new Float32Array(nw * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4, o = y * nw * 4;
    for (let x = 0; x < nw; x++) {
      const base = x * H.taps;
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < H.cnt[x]; t++) {
        const s = row + H.idx[base + t] * 4, k = H.wt[base + t];
        r += src[s] * k; g += src[s + 1] * k; b += src[s + 2] * k; a += src[s + 3] * k;
      }
      const q = o + x * 4;
      mid[q] = r; mid[q + 1] = g; mid[q + 2] = b; mid[q + 3] = a;
    }
  }
  const out = new Float32Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const base = y * V.taps, o = y * nw * 4;
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < V.cnt[y]; t++) {
        const s = (V.idx[base + t] * nw + x) * 4, k = V.wt[base + t];
        r += mid[s] * k; g += mid[s + 1] * k; b += mid[s + 2] * k; a += mid[s + 3] * k;
      }
      const q = o + x * 4;
      out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = clamp(a, 0, 255);
    }
  }
  return fromPremul(out, nw, nh);
}

function resizeNearest(img, nw, nh) {
  const out = newImg(nw, nh), s = u32(img), d = u32(out), xs = new Int32Array(nw);
  for (let x = 0; x < nw; x++) xs[x] = Math.min(img.w - 1, Math.floor(((x + 0.5) * img.w) / nw));
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) * img.h) / nh)) * img.w, o = y * nw;
    for (let x = 0; x < nw; x++) d[o + x] = s[sy + xs[x]];
  }
  return out;
}

/* ---------- crop and canvas size */
// Parts of the rectangle outside the image come out transparent (used by trim's padding).
function cropImg(img, x, y, w, h) {
  const out = newImg(w, h), s = u32(img), d = u32(out);
  const x0 = Math.max(0, -x), x1 = Math.min(w, img.w - x);
  if (x1 > x0) {
    for (let yy = 0; yy < h; yy++) {
      const sy = y + yy;
      if (sy < 0 || sy >= img.h) continue;
      d.set(s.subarray(sy * img.w + x + x0, sy * img.w + x + x1), yy * w + x0);
    }
  }
  return out;
}

const mirrorIdx = (v, n) => { const p = mod(v, 2 * n); return p < n ? p : 2 * n - 1 - p; };

// ax, ay: anchor 0 (left/top), 1 (center), 2 (right/bottom).
// fill: transparent | color | edge (repeat the border pixels) | repeat (wrap the image) | mirror.
function canvasSize(img, nw, nh, ax, ay, fill, color) {
  const out = newImg(nw, nh), s = u32(img), d = u32(out);
  const ox = Math.round(((nw - img.w) * ax) / 2), oy = Math.round(((nh - img.h) * ay) / 2);
  const [r, g, b] = hexToRgb(color), fillPx = new Uint32Array(new Uint8ClampedArray([r, g, b, 255]).buffer)[0];
  const map = fill === 'repeat' ? mod : fill === 'mirror' ? mirrorIdx : (v, n) => clamp(v, 0, n - 1);
  for (let y = 0; y < nh; y++) {
    const sy = y - oy, inY = sy >= 0 && sy < img.h, o = y * nw;
    for (let x = 0; x < nw; x++) {
      const sx = x - ox;
      if (inY && sx >= 0 && sx < img.w) d[o + x] = s[sy * img.w + sx];
      else if (fill === 'color') d[o + x] = fillPx;
      else if (fill !== 'transparent') d[o + x] = s[map(sy, img.h) * img.w + map(sx, img.w)];
    }
  }
  return out;
}

/* ---------- trim: the smallest rectangle holding everything that isn't background */
// mode 'alpha': background is alpha <= tol. mode 'corner': background is within tol of the top-left pixel.
function trimBounds(img, mode, tol) {
  const { w, h, d } = img, r0 = d[0], g0 = d[1], b0 = d[2], a0 = d[3];
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const keep = mode === 'alpha' ? d[i + 3] > tol
        : Math.max(Math.abs(d[i] - r0), Math.abs(d[i + 1] - g0), Math.abs(d[i + 2] - b0), Math.abs(d[i + 3] - a0)) > tol;
      if (!keep) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ---------- rotate and flip */
function rotate90(img, cw) {
  const { w, h } = img, out = newImg(h, w), s = u32(img), d = u32(out);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cw) d[x * h + (h - 1 - y)] = s[y * w + x];
      else d[(w - 1 - x) * h + y] = s[y * w + x];
    }
  }
  return out;
}
function rotate180(img) {
  const out = newImg(img.w, img.h), s = u32(img), d = u32(out), n = s.length;
  for (let i = 0; i < n; i++) d[n - 1 - i] = s[i];
  return out;
}
function flipH(img) {
  const { w, h } = img, out = newImg(w, h), s = u32(img), d = u32(out);
  for (let y = 0; y < h; y++) for (let x = 0, r = y * w; x < w; x++) d[r + w - 1 - x] = s[r + x];
  return out;
}
function flipV(img) {
  const { w, h } = img, out = newImg(w, h), s = u32(img), d = u32(out);
  for (let y = 0; y < h; y++) d.set(s.subarray(y * w, y * w + w), (h - 1 - y) * w);
  return out;
}

// Any angle, clockwise in degrees. expand grows the canvas to hold the whole rotated image;
// otherwise the size stays and the corners are cut. New area is transparent.
function rotateFree(img, deg, expand, smoothOn) {
  const q = mod(deg, 360);
  if (q === 0) return img;
  if (q === 90) return rotate90(img, true);
  if (q === 180) return rotate180(img);
  if (q === 270) return rotate90(img, false);
  const { w, h } = img, t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const nw = expand ? Math.max(1, Math.ceil(Math.abs(w * c) + Math.abs(h * s) - 1e-6)) : w;
  const nh = expand ? Math.max(1, Math.ceil(Math.abs(w * s) + Math.abs(h * c) - 1e-6)) : h;
  checkSize(nw, nh);
  const cx = w / 2, cy = h / 2, ncx = nw / 2, ncy = nh / 2;
  if (!smoothOn) {
    const out = newImg(nw, nh), sd = u32(img), dd = u32(out);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const X = x + 0.5 - ncx, Y = y + 0.5 - ncy;
        const sx = Math.floor(c * X + s * Y + cx), sy = Math.floor(-s * X + c * Y + cy);
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) dd[y * nw + x] = sd[sy * w + sx];
      }
    }
    return out;
  }
  const src = toPremul(img), out = new Float32Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const X = x + 0.5 - ncx, Y = y + 0.5 - ncy;
      const fx = c * X + s * Y + cx - 0.5, fy = -s * X + c * Y + cy - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) continue;
      const o = (y * nw + x) * 4;
      // Neighbours outside the image count as transparent, which antialiases the new edges.
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1), yy = y0 + (k >> 1);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const wgt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty), i = (yy * w + xx) * 4;
        out[o] += src[i] * wgt; out[o + 1] += src[i + 1] * wgt; out[o + 2] += src[i + 2] * wgt; out[o + 3] += src[i + 3] * wgt;
      }
    }
  }
  return fromPremul(out, nw, nh);
}

/* ---------- wrap offset: shifts the image, what leaves one side comes back on the other */
function offsetWrap(img, dx, dy) {
  const { w, h } = img, out = newImg(w, h), s = u32(img), d = u32(out);
  dx = mod(dx, w); dy = mod(dy, h);
  for (let y = 0; y < h; y++) {
    const sr = mod(y - dy, h) * w, o = y * w;
    // two straight copies per row: [0, dx) comes from the row's end, the rest from its start
    d.set(s.subarray(sr + w - dx, sr + w), o);
    d.set(s.subarray(sr, sr + w - dx), o + dx);
  }
  return out;
}
