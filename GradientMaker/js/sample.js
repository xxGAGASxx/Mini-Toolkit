'use strict';
// Evaluates a gradient: stops blended in the chosen color space, with midpoints, blend curves,
// steps and adjustments. Results are cached per gradient as a lookup table (LUT).

const LUT_N = 8192;

// Blend curves for one segment, t in 0..1 after the midpoint has been applied.
const EASE = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  easein: (t) => t * t,
  easeout: (t) => t * (2 - t),
  hard: (t) => (t < 0.5 ? 0 : 1),
};

// Stops sorted, with colors converted once into the gradient's interpolation space.
function prep(g) {
  const stops = sortStops(g.stops.slice()).map((s) => {
    const rgb = rgbOfHex(s.c);
    return { pos: s.pos, a: s.a, blend: s.blend, mid: s.mid, rgb, k: encodeIn(g.space, rgb[0], rgb[1], rgb[2]) };
  });
  return { stops, space: g.space, hue: g.hue, hi: has(HUE_AT, g.space) ? HUE_AT[g.space] : -1 };
}

// The midpoint moves where the blend is half way (the same power curve as a CSS color hint).
function segT(s, t) {
  if (s.mid !== 0.5 && t > 0) t = Math.pow(t, Math.log(0.5) / Math.log(s.mid));
  return (EASE[s.blend] || EASE.linear)(t);
}

function mixStops(P, A, B, t, out) {
  const a = A.a + (B.a - A.a) * t;
  // Premultiplied blending, like CSS: a fade to transparent doesn't pick up the transparent stop's color.
  const pre = A.a !== B.a && a > 1e-6;
  const wa = pre ? (A.a * (1 - t)) / a : 1 - t, wb = pre ? (B.a * t) / a : t;
  const x = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (i === P.hi) {
      let h0 = A.k[i], h1 = B.k[i];
      if (Number.isNaN(h0)) h0 = Number.isNaN(h1) ? 0 : h1;
      if (Number.isNaN(h1)) h1 = h0;
      x[i] = hueMix(h0, h1, t, P.hue);
    } else x[i] = A.k[i] * wa + B.k[i] * wb;
  }
  const rgb = decodeFrom(P.space, x[0], x[1], x[2]);
  out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; out[3] = a;
  return out;
}
function putStop(s, out) { out[0] = s.rgb[0]; out[1] = s.rgb[1]; out[2] = s.rgb[2]; out[3] = s.a; return out; }

// Color at x (0..1) from the stops alone: no steps, no adjustments.
function sampleRaw(P, x, out) {
  const S = P.stops, n = S.length;
  if (!n) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  if (n === 1 || x <= S[0].pos) return putStop(S[0], out);
  if (x >= S[n - 1].pos) return putStop(S[n - 1], out);
  let i = 0;
  while (i < n - 2 && S[i + 1].pos <= x) i++;
  const A = S[i], B = S[i + 1], span = B.pos - A.pos;
  if (span <= 0) return putStop(B, out);
  return mixStops(P, A, B, segT(A, (x - A.pos) / span), out);
}

// Steps: N flat bands, the first and last holding the end colors.
function quant(x, steps) {
  if (steps < 2) return x;
  return Math.min(steps - 1, Math.floor(x * steps)) / (steps - 1);
}

// The final color function of a gradient: x -> [r, g, b, a] in 0..1.
function evaluator(g) {
  const P = prep(g), adj = makeAdjust(g.adj), steps = g.steps;
  return (x) => {
    const c = sampleRaw(P, quant(clamp(x, 0, 1), steps), [0, 0, 0, 0]);
    if (adj) adj(c);
    for (let k = 0; k < 4; k++) c[k] = clamp(c[k], 0, 1);
    return c;
  };
}

function buildLut(g) {
  const f = evaluator(g), lut = new Float32Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) lut.set(f(i / (LUT_N - 1)), i * 4);
  return lut;
}
const lutCache = new Map();   // gradient id -> { key, lut }
const lutKey = (g) => JSON.stringify([g.stops, g.space, g.hue, g.steps, g.adj]);
function lutOf(g) {
  const key = lutKey(g);
  let e = lutCache.get(g.id);
  if (!e || e.key !== key) { e = { key, lut: buildLut(g) }; lutCache.set(g.id, e); }
  return e.lut;
}
// Linear lookup into a LUT at t in 0..1, written to out.
function lutAt(lut, t, out) {
  const f = (t <= 0 ? 0 : t >= 1 ? 1 : t) * (LUT_N - 1), i = Math.min(LUT_N - 2, f | 0), u = f - i, j = i * 4;
  out[0] = lut[j] + (lut[j + 4] - lut[j]) * u;
  out[1] = lut[j + 1] + (lut[j + 5] - lut[j + 1]) * u;
  out[2] = lut[j + 2] + (lut[j + 6] - lut[j + 2]) * u;
  out[3] = lut[j + 3] + (lut[j + 7] - lut[j + 3]) * u;
  return out;
}

// Draws a gradient left to right across a canvas, over a checkerboard.
function drawStrip(canvas, g, checker = 6) {
  const w = canvas.width, h = canvas.height, x = canvas.getContext('2d');
  const lut = lutOf(g), row = new ImageData(w, 1), c = [0, 0, 0, 0];
  for (let i = 0; i < w; i++) {
    lutAt(lut, (i + 0.5) / w, c);
    row.data[i * 4] = c[0] * 255 + 0.5; row.data[i * 4 + 1] = c[1] * 255 + 0.5;
    row.data[i * 4 + 2] = c[2] * 255 + 0.5; row.data[i * 4 + 3] = c[3] * 255 + 0.5;
  }
  fillChecker(x, w, h, checker);
  const one = mk(w, 1);
  one.getContext('2d').putImageData(row, 0, 0);
  x.imageSmoothingEnabled = false;
  x.drawImage(one, 0, 0, w, h);
}

/* ---------- helpers for code export */

// Positions in (0, 1) where the gradient jumps from one color to another.
function edgesOf(g) {
  const e = [];
  if (g.steps >= 2) { for (let k = 1; k < g.steps; k++) e.push(k / g.steps); return e; }
  const S = sortStops(g.stops.slice());
  for (let i = 0; i < S.length - 1; i++) {
    const A = S[i], B = S[i + 1], span = B.pos - A.pos;
    if (span <= 0) { if (A.c !== B.c || A.a !== B.a) e.push(A.pos); }
    else if (A.blend === 'hard') e.push(A.pos + A.mid * span);
  }
  return [...new Set(e)].filter((p) => p > 0 && p < 1).sort((a, b) => a - b);
}
const EPS = 1e-6;

// Evenly spaced samples plus every stop and both sides of every hard edge: [{ p, c }].
function sampledStops(g, n) {
  const f = evaluator(g), edges = edgesOf(g), out = [];
  if (g.steps >= 2) {
    for (let k = 0; k < g.steps; k++) {
      const c = f((k + 0.5) / g.steps);
      out.push({ p: k / g.steps, c }, { p: (k + 1) / g.steps, c });
    }
    return out;
  }
  const xs = new Set();
  for (let i = 0; i < n; i++) xs.add(roundTo(i / (n - 1), 6));
  for (const s of g.stops) xs.add(roundTo(s.pos, 6));
  for (const x of [...xs].sort((a, b) => a - b)) {
    if (edges.some((e) => Math.abs(e - x) < 1e-4)) continue;
    out.push({ p: x, c: f(x) });
  }
  for (const e of edges) {
    const i = out.findIndex((s) => s.p > e);
    out.splice(i < 0 ? out.length : i, 0, { p: e, c: f(e - EPS) }, { p: e, c: f(e + EPS) });
  }
  return out;
}

// Picks at most maxKeys points so straight-line blending between them stays close to the gradient.
// Hard edges become two keys at the same position. chans: which of r, g, b, a (0..3) count.
function fitKeys(g, maxKeys, chans = [0, 1, 2, 3]) {
  const f = evaluator(g), M = 1024;
  if (g.steps >= 2) {
    // Bands are exact as pairs of keys, if they fit.
    const bands = sampledStops(g, 2);
    if (bands.length <= maxKeys) return bands;
  }
  const keys = [{ p: 0, c: f(0) }];
  for (const e of edgesOf(g)) keys.push({ p: e, c: f(e - EPS) }, { p: e, c: f(e + EPS) });
  keys.push({ p: 1, c: f(1) });
  if (keys.length > maxKeys) {   // too many edges: fall back to even samples
    return Array.from({ length: maxKeys }, (_, i) => ({ p: i / (maxKeys - 1), c: f(i / (maxKeys - 1)) }));
  }
  const xs = Array.from({ length: M }, (_, i) => i / (M - 1)), vals = xs.map(f);
  while (keys.length < maxKeys) {
    let worst = 0, at = -1, k = 0;
    for (let i = 0; i < M; i++) {
      const x = xs[i];
      while (k < keys.length - 2 && keys[k + 1].p <= x) k++;
      const A = keys[k], B = keys[k + 1], span = B.p - A.p;
      if (span <= 0) continue;
      const t = clamp((x - A.p) / span, 0, 1);
      let err = 0;
      for (const ch of chans) err = Math.max(err, Math.abs(A.c[ch] + (B.c[ch] - A.c[ch]) * t - vals[i][ch]));
      if (err > worst) { worst = err; at = i; }
    }
    if (at < 0 || worst < 0.6 / 255) break;
    const x = xs[at], i = keys.findIndex((key) => key.p > x);
    keys.splice(i, 0, { p: x, c: vals[at] });
    k = 0;
  }
  return keys;
}

/* ---------- gradient edits shared by the panels */
const flipBlend = (b) => (b === 'easein' ? 'easeout' : b === 'easeout' ? 'easein' : b);

// Flips a gradient end to end. Each segment's blend moves to its new left stop, mirrored.
function reversedStops(stops) {
  const S = sortStops(stops.slice()), out = [];
  for (let i = S.length - 1; i >= 0; i--) {
    const s = S[i], seg = S[i - 1];
    out.push({ ...s, pos: roundTo(1 - s.pos, 5), blend: seg ? flipBlend(seg.blend) : 'linear', mid: seg ? roundTo(1 - seg.mid, 4) : 0.5 });
  }
  return out;
}

// Squeezes the stops into 0..0.5 and mirrors them into 0.5..1.
function mirroredStops(stops) {
  const A = sortStops(stops.slice()).map((s) => ({ ...s, pos: roundTo(s.pos / 2, 5) }));
  const B = reversedStops(stops).map((s) => ({ ...s, id: newId(), pos: roundTo(0.5 + s.pos / 2, 5) }));
  const last = A[A.length - 1], first = B[0];
  if (last.pos === first.pos && last.c === first.c && last.a === first.a) {
    // Same stop twice in the middle: keep one, carrying the blend of the mirrored half.
    last.blend = first.blend; last.mid = first.mid;
    B.shift();
  }
  return A.concat(B);
}

// Random colors with a pleasant lightness ramp, made in OKLCH.
function randomStops() {
  const n = 2 + Math.floor(Math.random() * 3);
  const h0 = Math.random() * 360, spread = (Math.random() < 0.5 ? 1 : -1) * (30 + Math.random() * 150);
  let L0 = 0.16 + Math.random() * 0.22, L1 = 0.8 + Math.random() * 0.17;
  if (Math.random() < 0.25) [L0, L1] = [L1, L0];
  const chroma = 0.05 + Math.random() * 0.13, stops = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), jitter = i && i < n - 1 ? (Math.random() - 0.5) * 0.5 / (n - 1) : 0;
    const L = lerp(L0, L1, t), C = chroma * (0.55 + Math.random() * 0.6) * (1 - Math.abs(t - 0.5) * 0.5);
    const rgb = oklchToRgb(L, C, h0 + spread * t);
    stops.push(mkStop(roundTo(clamp(t + jitter, 0, 1), 4), toHex(...rgb.map((v) => clamp(v, 0, 1)))));
  }
  return sortStops(stops);
}
