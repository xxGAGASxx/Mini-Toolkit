'use strict';
// Tiling tab: even out lighting, seam fix. (The tiled preview lives in the viewer, the wrap offset
// in transform.js.)

/* ---------- even out lighting
   Divides out the large-scale brightness changes (a lit corner, a dark side), which are what make a
   tiled texture show an obvious repeating pattern. Each pixel is scaled by (image average / local
   average), where the local average is a wide blur. */
function tileBalance(img, p) {
  const { w, h, d } = img, n = w * h, sigma = Math.max(1, (p.radius / 100) * Math.min(w, h)), k = p.strength / 100;
  const out = newImg(w, h), o = out.d, off = 4;   // the offset keeps near-black areas from exploding
  if (p.mode === 'rgb') {
    const f = new Float32Array(n * 3), mean = [0, 0, 0];
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      for (let c = 0; c < 3; c++) { f[j * 3 + c] = d[i + c]; mean[c] += d[i + c]; }
    }
    for (let c = 0; c < 3; c++) mean[c] /= n;
    gaussBlur(f, w, h, 3, sigma, false);
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      for (let c = 0; c < 3; c++) {
        const ratio = clamp((mean[c] + off) / (f[j * 3 + c] + off), 0.2, 5);
        o[i + c] = d[i + c] * (1 + (ratio - 1) * k);
      }
      o[i + 3] = d[i + 3];
    }
    return out;
  }
  const L = lumaOf(img);
  let mean = 0;
  for (let j = 0; j < n; j++) { L[j] *= 255; mean += L[j]; }
  mean /= n;
  gaussBlur(L, w, h, 1, sigma, false);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const s = 1 + (clamp((mean + off) / (L[j] + off), 0.2, 5) - 1) * k;
    o[i] = d[i] * s; o[i + 1] = d[i + 1] * s; o[i + 2] = d[i + 2] * s; o[i + 3] = d[i + 3];
  }
  return out;
}

/* ---------- seam fix
   cross:  blends in a copy shifted by half the image. Near the edges the shifted copy takes over, and
           its edges are the original's middle, which already continue into each other. The copy's
           own seam falls in the middle, where the original is fully kept.
   mirror: blends each edge with the opposite edge, so both sides end up nearly the same.
   Done once across (horizontal seam fix), then once down, so the corners work too.
   keep:   averaging two layers flattens contrast; this restores it around the image's mean color. */
function tileSeam(img, p) {
  let cur = img;
  if (p.axis !== 'y') cur = seamPass(cur, p, true);
  if (p.axis !== 'x') cur = seamPass(cur, p, false);
  return cur;
}

function seamPass(img, p, across) {
  const { w, h, d } = img, n = across ? w : h, half = Math.floor(n / 2), bw = Math.max(1, ((p.width / 100) * n) / 2);
  const keep = new Float32Array(n);   // how much of the original stays, by position
  for (let i = 0; i < n; i++) keep[i] = smooth(clamp01(Math.min(i + 0.5, n - i - 0.5) / bw));
  const mean = [0, 0, 0];
  if (p.keep) {
    for (let i = 0; i < d.length; i += 4) { mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
    for (let c = 0; c < 3; c++) mean[c] /= w * h;
  }
  const mirror = p.method === 'mirror', out = newImg(w, h), o = out.d;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, f = keep[across ? x : y];
      const m = mirror ? 0.5 * (1 - f) : 1 - f;   // weight of the other copy
      if (m <= 0) { o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = d[i + 3]; continue; }
      const j = mirror
        ? (across ? y * w + (w - 1 - x) : (h - 1 - y) * w + x) * 4
        : (across ? y * w + ((x + half) % w) : ((y + half) % h) * w + x) * 4;
      const g = p.keep ? 1 / Math.sqrt((1 - m) * (1 - m) + m * m) : 1;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] * (1 - m) + d[j + c] * m;
        o[i + c] = p.keep ? mean[c] + (v - mean[c]) * g : v;
      }
      o[i + 3] = d[i + 3] * (1 - m) + d[j + 3] * m;
    }
  }
  return out;
}
