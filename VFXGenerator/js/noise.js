'use strict';
// Seeded random numbers and noise. Gradient (Perlin) noise here can repeat after a whole number
// of cells along x, y and z: repeating in x and y makes a texture tile, and z is time, so a
// flipbook that travels a whole number of cells along z loops without a jump.

/* ---------- random */
// Small fast generator (mulberry32): the same seed always gives the same numbers, 0 <= n < 1.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash of a cell (x, y) and a seed: 0 .. 2^32 - 1.
function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x2f0e1eb5);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const wrapInt = (i, n) => { i %= n; return i < 0 ? i + n : i; };

/* ---------- gradient (Perlin) noise */
// A shuffled 0..255 table per seed, doubled so lookups never need wrapping.
const permCache = new Map();
function perm(seed) {
  let p = permCache.get(seed);
  if (p) return p;
  const r = rng(Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995), a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0, t = a[i];
    a[i] = a[j]; a[j] = t;
  }
  p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  if (permCache.size > 64) permCache.clear();
  permCache.set(seed, p);
  return p;
}

const fade5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
// Dot product with one of 12 edge directions of a cube, picked by the hash.
function grad3(h, x, y, z) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

// 3D gradient noise, about -1..1. px / py / pz > 0 make it repeat every that many cells.
function perlin3(P, x, y, z, px, py, pz) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  x -= fx; y -= fy; z -= fz;
  let x0 = fx, x1 = fx + 1, y0 = fy, y1 = fy + 1, z0 = fz, z1 = fz + 1;
  if (px > 0) { x0 = wrapInt(x0, px); x1 = wrapInt(x1, px); }
  if (py > 0) { y0 = wrapInt(y0, py); y1 = wrapInt(y1, py); }
  if (pz > 0) { z0 = wrapInt(z0, pz); z1 = wrapInt(z1, pz); }
  x0 &= 255; x1 &= 255; y0 &= 255; y1 &= 255; z0 &= 255; z1 &= 255;
  const u = fade5(x), v = fade5(y), w = fade5(z);
  const a = P[x0], b = P[x1];
  const aa = P[a + y0], ab = P[a + y1], ba = P[b + y0], bb = P[b + y1];
  const xm = x - 1, ym = y - 1, zm = z - 1;
  const n000 = grad3(P[aa + z0] & 15, x, y, z), n100 = grad3(P[ba + z0] & 15, xm, y, z);
  const n010 = grad3(P[ab + z0] & 15, x, ym, z), n110 = grad3(P[bb + z0] & 15, xm, ym, z);
  const n001 = grad3(P[aa + z1] & 15, x, y, zm), n101 = grad3(P[ba + z1] & 15, xm, y, zm);
  const n011 = grad3(P[ab + z1] & 15, x, ym, zm), n111 = grad3(P[bb + z1] & 15, xm, ym, zm);
  const nx00 = n000 + u * (n100 - n000), nx10 = n010 + u * (n110 - n010);
  const nx01 = n001 + u * (n101 - n001), nx11 = n011 + u * (n111 - n011);
  const nxy0 = nx00 + v * (nx10 - nx00), nxy1 = nx01 + v * (nx11 - nx01);
  return nxy0 + w * (nxy1 - nxy0);
}

// Kinds of fractal noise: 0 smooth (fBm), 1 billow (puffy, made of |n|), 2 ridged (sharp crests).
const NOISE_KINDS = [['smooth', 'Smooth'], ['billow', 'Puffy'], ['ridged', 'Ridged']];
const KIND_INDEX = { smooth: 0, billow: 1, ridged: 2 };

// Sum of octaves, each twice the frequency of the last and `gain` times the strength. Each kind
// comes out with its own average and spread; NOISE_NORM (measured) maps all of them to 0..1.
function fractal(P, x, y, z, oct, gain, kind, px, py, pz) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    // Offsets keep octaves from lining up at the origin; whole periods still repeat.
    let n = perlin3(P, x * f + o * 19.19, y * f + o * 7.31, z * f + o * 3.77, px * f, py * f, pz * f);
    if (kind === 1) n = Math.abs(n);
    else if (kind === 2) { n = 1 - Math.abs(n); n *= n; }
    sum += n * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
// [average, scale] per kind, measured over many points at 5 octaves: after mapping, each kind
// averages about 0.5 with a spread (standard deviation) of about 0.2, so few values clip.
const NOISE_NORM = [[0, 1.3], [0.22, 2.2], [0.63, 1.5]];
const noise01 = (n, kind) => clamp01(0.5 + (n - NOISE_NORM[kind][0]) * NOISE_NORM[kind][1]);

// Domain warp: moves (x, y) along two other noise fields, for swirling smoke. The result goes to
// warpX / warpY rather than a new array per pixel.
let warpX = 0, warpY = 0;
function warp2(P, x, y, z, amt, px, py, pz) {
  warpX = x + amt * fractal(P, x + 5.2, y + 1.3, z + 0.7, 3, 0.5, 0, px, py, pz);
  warpY = y + amt * fractal(P, x + 1.7, y + 9.2, z + 2.9, 3, 0.5, 0, px, py, pz);
}

/* ---------- cellular (Worley) noise */
// Distance to the nearest (F1) and second nearest (F2) point, one random point per cell.
// t moves every point round a small circle, so whole turns loop. Results go to cellF1 / cellF2.
let cellF1 = 0, cellF2 = 0;
function worley(seed, x, y, t, px, py) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const hx = px > 0 ? wrapInt(cx, px) : cx, hy = py > 0 ? wrapInt(cy, py) : cy;
      const hh = hash3(hx, hy, seed), ha = hash3(hx, hy, seed ^ 0x51ed27);
      const ang = TAU * (t + ha / 4294967296);
      const fx = cx + 0.5 + ((hh & 0xffff) / 65536 - 0.5) * 0.6 + 0.18 * Math.cos(ang);
      const fy = cy + 0.5 + ((hh >>> 16) / 65536 - 0.5) * 0.6 + 0.18 * Math.sin(ang);
      const d = (fx - x) * (fx - x) + (fy - y) * (fy - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  cellF1 = Math.sqrt(f1);
  cellF2 = Math.sqrt(f2);
}

// Octaves of cellular noise in 0..1: bright cell centers, or bright lines where cells meet.
function cellular(seed, x, y, t, oct, gain, edges, px, py) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    worley(seed + o * 101, x * f, y * f, t * f, px * f, py * f);
    const v = edges ? 1 - clamp01((cellF2 - cellF1) * 2.2) : 1 - clamp01(cellF1 * 1.15);
    sum += v * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
