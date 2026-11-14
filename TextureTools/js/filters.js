'use strict';
// Building blocks shared by the transform, color, effect and tiling steps: float buffers,
// Gaussian blur, a distance transform and value noise.

/* ---------- float buffers */
// Straight 8-bit RGBA to premultiplied float RGBA (0..255). Blurring and resampling premultiplied
// keeps transparent pixels from bleeding their (invisible) color into the visible ones.
function toPremul(img) {
  const d = img.d, f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3], k = a / 255;
    f[i] = d[i] * k; f[i + 1] = d[i + 1] * k; f[i + 2] = d[i + 2] * k; f[i + 3] = a;
  }
  return f;
}
function fromPremul(f, w, h) {
  const out = newImg(w, h), d = out.d;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (a < 1e-3) continue;   // fully transparent: color unknown, left at 0
    const k = 255 / a;
    d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; d[i + 3] = a;
  }
  return out;
}
// Rec. 709 luma of each pixel, 0..1.
function lumaOf(img) {
  const d = img.d, L = new Float32Array(img.w * img.h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return L;
}

/* ---------- Gaussian blur
   Separable passes over "lines" (rows, then columns) of an interleaved buffer with `ch` channels.
   Edges either repeat the border pixel (clamp) or wrap around to the other side (for tiling textures). */

// map[j + r + 1] is the source index for position j, for j in -r-1 .. n+r.
function edgeMap(n, r, wrap) {
  const m = new Int32Array(n + 2 * r + 2);
  for (let k = 0; k < m.length; k++) {
    const j = k - r - 1;
    m[k] = wrap ? mod(j, n) : j < 0 ? 0 : j >= n ? n - 1 : j;
  }
  return m;
}

// Box blur of radius r by running sums: the same cost at any radius.
// Across: each row on its own.
function boxRows(src, dst, w, h, ch, r, wrap) {
  const map = edgeMap(w, r, wrap), inv = 1 / (2 * r + 1), span = 2 * r + 1, sums = new Float64Array(ch);
  for (let y = 0; y < h; y++) {
    const row = y * w * ch;
    sums.fill(0);
    for (let k = 1; k <= span; k++) { const o = row + map[k] * ch; for (let c = 0; c < ch; c++) sums[c] += src[o + c]; }
    for (let x = 0; x < w; x++) {
      const o = row + x * ch, add = row + map[x + span + 1] * ch, rem = row + map[x + 1] * ch;
      for (let c = 0; c < ch; c++) { dst[o + c] = sums[c] * inv; sums[c] += src[add + c] - src[rem + c]; }
    }
  }
}
// Down: one running sum per column, walking down the rows, so memory is read in order
// (walking each column on its own is many times slower on large images).
function boxCols(src, dst, w, h, ch, r, wrap) {
  const map = edgeMap(h, r, wrap), inv = 1 / (2 * r + 1), span = 2 * r + 1, rl = w * ch, sums = new Float64Array(rl);
  for (let k = 1; k <= span; k++) { const o = map[k] * rl; for (let i = 0; i < rl; i++) sums[i] += src[o + i]; }
  for (let y = 0; y < h; y++) {
    const o = y * rl, add = map[y + span + 1] * rl, rem = map[y + 1] * rl;
    for (let i = 0; i < rl; i++) { dst[o + i] = sums[i] * inv; sums[i] += src[add + i] - src[rem + i]; }
  }
}

// True Gaussian kernel, for small radii where three boxes would be too coarse.
function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, r };
}
// Each row is first copied with its edge pixels added on both sides, so every tap is one straight
// pass over memory.
function kernelRows(src, dst, w, h, ch, k, r, wrap) {
  const map = edgeMap(w, r, wrap), n = k.length, rl = w * ch, pad = new Float32Array((w + 2 * r) * ch);
  for (let y = 0; y < h; y++) {
    const row = y * rl;
    for (let j = 0; j < w + 2 * r; j++) {
      const s = row + map[j + 1] * ch, o = j * ch;
      for (let c = 0; c < ch; c++) pad[o + c] = src[s + c];
    }
    for (let t = 0; t < n; t++) {
      const kt = k[t], off = t * ch;
      if (t === 0) for (let i = 0; i < rl; i++) dst[row + i] = kt * pad[i + off];
      else for (let i = 0; i < rl; i++) dst[row + i] += kt * pad[i + off];
    }
  }
}
function kernelCols(src, dst, w, h, ch, k, r, wrap) {
  const map = edgeMap(h, r, wrap), n = k.length, rl = w * ch;
  for (let y = 0; y < h; y++) {
    const o = y * rl;
    for (let t = 0; t < n; t++) {
      const s = map[y + t + 1] * rl, kt = k[t];
      if (t === 0) for (let i = 0; i < rl; i++) dst[o + i] = kt * src[s + i];
      else for (let i = 0; i < rl; i++) dst[o + i] += kt * src[s + i];
    }
  }
}

// Widths of three boxes whose combination approximates a Gaussian of this sigma.
function boxSizes(sigma) {
  const n = 3, ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => (i < m ? wl : wl + 2));
}

// Blurs buf (w × h, ch interleaved channels) in place and returns it.
function gaussBlur(buf, w, h, ch, sigma, wrap) {
  if (!(sigma > 0.05)) return buf;
  const tmp = new Float32Array(buf.length);
  if (sigma < 1.5) {
    const { k, r } = gaussKernel(sigma);
    kernelRows(buf, tmp, w, h, ch, k, r, wrap);
    kernelCols(tmp, buf, w, h, ch, k, r, wrap);
  } else {
    for (const size of boxSizes(sigma)) {
      const r = (size - 1) >> 1;
      if (r < 1) continue;
      boxRows(buf, tmp, w, h, ch, r, wrap);
      boxCols(tmp, buf, w, h, ch, r, wrap);
    }
  }
  return buf;
}

/* ---------- Euclidean distance transform (Felzenszwalb & Huttenlocher)
   For every pixel, the squared distance to the nearest pixel where feature[i] is 1. */
function edt(feature, w, h) {
  const INF = 1e20, n = Math.max(w, h), g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) f[x] = g[r + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[r + x] = d[x];
  }
  return g;
}
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/* ---------- value noise
   px / py: period in lattice cells (0 = none). With a period the noise repeats, so it tiles. */
function vnoise(u, v, seed, px, py) {
  const x0 = Math.floor(u), y0 = Math.floor(v), sx = smooth(u - x0), sy = smooth(v - y0);
  const xa = px ? mod(x0, px) : x0, xb = px ? mod(x0 + 1, px) : x0 + 1;
  const ya = py ? mod(y0, py) : y0, yb = py ? mod(y0 + 1, py) : y0 + 1;
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed), c = hash2(xa, yb, seed), e = hash2(xb, yb, seed);
  return lerp(lerp(a, b, sx), lerp(c, e, sx), sy);
}
// Several octaves of value noise, 0..1.
function fbm(u, v, seed, octaves = 4, px = 0, py = 0) {
  let s = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * vnoise(u, v, seed + o * 31, px, py);
    total += amp;
    u *= 2; v *= 2; px *= 2; py *= 2; amp *= 0.5;
  }
  return s / total;
}
