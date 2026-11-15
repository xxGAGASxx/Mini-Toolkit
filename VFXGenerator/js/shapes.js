'use strict';
// The layer generators. Each one turns coordinates into a brightness, usually 0..1.
//
// Most generators work in layer space: (0, 0) is the layer's center, 1 is half the shorter side of
// the frame, y points up, and the layer's position, scale, stretch and rotation are already
// applied. "Full frame" generators (trail, noise) instead get the frame's u, v in 0..1, so they
// can fill it edge to edge and tile.
//
// A generator has:
//   params   settings shown in the panel; values are stored as shown (90 means 90 %)
//   prep     (params, ctx) -> whatever fill needs, worked out once per frame.
//            ctx = { seed, z, pz, ax, ay }: seed for this frame, time position z along the noise
//            (pz > 0: it repeats after pz, for loops), and the frame's half size in layer units
//   fill     (prepared, xs, ys, out, n) writes n values into out
//   cost     rough work per pixel, so the app can tell slow settings from fast ones

const SEED = { k: 'seed', label: 'Seed', type: 'seed', def: 1, hint: 'Another number gives another random pattern' };

const FALLOFFS = [['inverse', 'Glow'], ['gauss', 'Gaussian'], ['smooth', 'Smooth'], ['linear', 'Linear'], ['expo', 'Exponential']];

// Center (t = 0) to edge (t = 1), 1 -> 0. `tight` > 1 pulls the light in toward the center.
// "Glow" is inverse-square like real light: a hot center with a long faint tail.
function makeFalloff(kind, tight) {
  switch (kind) {
    case 'linear': return (t) => Math.pow(1 - t, tight);
    case 'smooth': return (t) => Math.pow(1 - smooth01(t), tight);
    case 'gauss': { const k = 4 * tight, e = Math.exp(-k); return (t) => (Math.exp(-k * t * t) - e) / (1 - e); }
    case 'expo': { const k = 4 * tight, e = Math.exp(-k); return (t) => (Math.exp(-k * t) - e) / (1 - e); }
    default: {
      const a2 = 16 * tight * tight, g1 = 1 / (1 + a2);
      return (t) => (1 / (1 + a2 * t * t) - g1) / (1 - g1);
    }
  }
}

// 1 inside, 0 at t >= 1, fading over the outer `soft` part (0..1). soft 0 is a hard edge.
function softEdge(t, soft) {
  if (t >= 1) return 0;
  const a = 1 - soft;
  return t <= a ? 1 : 1 - smooth01((t - a) / soft);
}
const screen = (a, b) => a + b - a * b;

/* ---------- signed distances: negative inside the shape, positive outside */
function sdBox(x, y, bx, by) {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
// Star with n points (Inigo Quilez's sdStar). m runs from n (a regular polygon) down to 2 (thin
// spikes). One point faces up.
function starSdf(n, m) {
  const an = Math.PI / n, en = Math.PI / m;
  const acx = Math.cos(an), acy = Math.sin(an), ecx = Math.cos(en), ecy = Math.sin(en), lim = acy / ecy;
  return (x, y, r) => {
    const a = Math.atan2(x, y);
    const bn = a - 2 * an * Math.floor(a / (2 * an)) - an;
    const len = Math.sqrt(x * x + y * y);
    let qx = len * Math.cos(bn) - r * acx, qy = len * Math.abs(Math.sin(bn)) - r * acy;
    const k = clamp(-(qx * ecx + qy * ecy), 0, r * lim);
    qx += ecx * k; qy += ecy * k;
    return Math.sqrt(qx * qx + qy * qy) * Math.sign(qx);
  };
}
// Heart with its tip at (0, 0) and its top near y = 1.1 (Inigo Quilez's sdHeart).
function sdHeart(x, y) {
  x = Math.abs(x);
  if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(x + y, 0);
  return Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) * Math.sign(x - y);
}

/* ---------- lightning: midpoint displacement, with forks */
function buildBolt(p, seed) {
  const r = rng(seed), segs = [];
  const L = p.length / 100, jag = p.jag / 100, thin = p.thin / 100, forks = (p.branches / 100) * 6;
  function bolt(ax, ay, bx, by, levels, w0, b0, depth) {
    const len0 = Math.hypot(bx - ax, by - ay);
    let X = [ax, bx], Y = [ay, by], amp = jag * len0 * 0.3;
    for (let l = 0; l < levels; l++) {
      const nx = [X[0]], ny = [Y[0]];
      for (let i = 0; i < X.length - 1; i++) {
        const x0 = X[i], y0 = Y[i], x1 = X[i + 1], y1 = Y[i + 1];
        const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
        const off = (r() * 2 - 1) * amp;
        nx.push((x0 + x1) / 2 - (dy / d) * off, x1);
        ny.push((y0 + y1) / 2 + (dx / d) * off, y1);
      }
      X = nx; Y = ny; amp *= 0.55;
    }
    const n = X.length - 1, chance = depth < 2 ? forks / n / (depth + 1) : 0;
    for (let i = 0; i < n; i++) {
      const f = i / n, w = w0 * (1 - thin * f), b = b0 * (1 - 0.5 * thin * f);
      segs.push(X[i], Y[i], X[i + 1], Y[i + 1], w, b);
      if (i > 0 && r() < chance) {
        const dir = Math.atan2(Y[i + 1] - Y[i], X[i + 1] - X[i]) + (r() < 0.5 ? -1 : 1) * (0.35 + 0.55 * r());
        const blen = (p.branchLen / 100) * len0 * (1 - f) * (0.5 + 0.5 * r());
        if (blen > 0.02) {
          bolt(X[i], Y[i], X[i] + Math.cos(dir) * blen, Y[i] + Math.sin(dir) * blen,
            Math.max(2, levels - 2), w * 0.6, b * 0.7, depth + 1);
        }
      }
    }
  }
  bolt(-L / 2, 0, L / 2, 0, p.detail, p.width / 100, 1, 0);
  return new Float64Array(segs);
}

// Buckets segments into a grid of cells, so each pixel only measures the few segments near it.
function segmentGrid(S, reach) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < S.length; j += 6) {
    const R = Math.max(S[j + 4] / 2, reach);
    x0 = Math.min(x0, S[j] - R, S[j + 2] - R); x1 = Math.max(x1, S[j] + R, S[j + 2] + R);
    y0 = Math.min(y0, S[j + 1] - R, S[j + 3] - R); y1 = Math.max(y1, S[j + 1] + R, S[j + 3] + R);
  }
  const G = 48, sx = G / Math.max(x1 - x0, 1e-6), sy = G / Math.max(y1 - y0, 1e-6);
  const count = new Int32Array(G * G + 1);
  const each = (j, fn) => {
    const R = Math.max(S[j + 4] / 2, reach);
    const cx0 = clamp(Math.floor((Math.min(S[j], S[j + 2]) - R - x0) * sx), 0, G - 1);
    const cx1 = clamp(Math.floor((Math.max(S[j], S[j + 2]) + R - x0) * sx), 0, G - 1);
    const cy0 = clamp(Math.floor((Math.min(S[j + 1], S[j + 3]) - R - y0) * sy), 0, G - 1);
    const cy1 = clamp(Math.floor((Math.max(S[j + 1], S[j + 3]) + R - y0) * sy), 0, G - 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * G + cx);
  };
  for (let j = 0; j < S.length; j += 6) each(j, (c) => count[c + 1]++);
  for (let c = 0; c < G * G; c++) count[c + 1] += count[c];
  const idx = new Int32Array(count[G * G]), fillAt = count.slice(0, G * G);
  for (let j = 0; j < S.length; j += 6) each(j, (c) => { idx[fillAt[c]++] = j; });
  return { x0, y0, sx, sy, G, start: count, idx };
}

/* ---------- the generators */
const GEN = {
  glow: {
    label: 'Glow', hint: 'Round light, from a hard dot to a wide soft halo.',
    params: [
      { k: 'radius', label: 'Radius', min: 2, max: 150, def: 90, unit: '%' },
      { k: 'core', label: 'Hard core', min: 0, max: 95, def: 0, unit: '%', hint: 'Part of the radius that stays fully bright' },
      { k: 'falloff', label: 'Falloff', type: 'select', def: 'inverse', options: FALLOFFS },
      { k: 'tight', label: 'Tightness', min: 0.2, max: 8, step: 0.01, def: 1, log: true, hint: 'Higher pulls the light toward the center' },
    ],
    cost: () => 1,
    prep: (p) => ({ ir: 100 / p.radius, c: p.core / 100, f: makeFalloff(p.falloff, p.tight) }),
    fill(s, xs, ys, out, n) {
      const ir = s.ir, c = s.c, ic = 1 / (1 - c), f = s.f;
      for (let i = 0; i < n; i++) {
        const t = (Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i]) * ir - c) * ic;
        out[i] = t >= 1 ? 0 : t <= 0 ? 1 : f(t);
      }
    },
  },

  ring: {
    label: 'Ring', hint: 'A circle line: shockwaves, halos, dashed magic rings.',
    params: [
      { k: 'radius', label: 'Radius', min: 0, max: 150, def: 60, unit: '%' },
      { k: 'width', label: 'Width', min: 0.5, max: 100, step: 0.5, def: 16, unit: '%' },
      { k: 'softIn', label: 'Inner softness', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'softOut', label: 'Outer softness', min: 0, max: 100, def: 40, unit: '%' },
      { k: 'fill', label: 'Fill inside', min: 0, max: 100, def: 0, unit: '%' },
      { k: 'dashes', label: 'Dashes', min: 0, max: 48, def: 0 },
      { k: 'gap', label: 'Gap', min: 5, max: 95, def: 50, unit: '%', show: (p) => p.dashes > 0 },
    ],
    cost: () => 1,
    prep: (p) => ({ r: p.radius / 100, ihw: 200 / p.width, si: p.softIn / 100, so: p.softOut / 100, fill: p.fill / 100, dash: p.dashes, on: 1 - p.gap / 100 }),
    fill(s, xs, ys, out, n) {
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], d = Math.sqrt(x * x + y * y) - s.r;
        let v = softEdge(Math.abs(d) * s.ihw, d < 0 ? s.si : s.so);
        if (s.dash && v > 0) {
          const a = (Math.atan2(y, x) / TAU + 1) * s.dash;
          if (a - Math.floor(a) > s.on) v = 0;
        }
        if (d < 0 && s.fill > v) v = s.fill;
        out[i] = v;
      }
    },
  },

  star: {
    label: 'Star / Flare', hint: 'Rays from the center: sparkles, glints, lens stars.', seeded: true,
    params: [
      { k: 'rays', label: 'Rays', min: 2, max: 32, def: 4 },
      { k: 'length', label: 'Length', min: 5, max: 150, def: 95, unit: '%' },
      { k: 'width', label: 'Ray width', min: 0.2, max: 50, step: 0.1, def: 8, unit: '%' },
      { k: 'taper', label: 'Taper', min: 0, max: 100, def: 100, unit: '%', hint: 'How much each ray narrows toward its tip' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'fade', label: 'Fade out', min: 0.2, max: 6, step: 0.01, def: 1.5, log: true, hint: 'How fast rays fade toward their tips' },
      { k: 'randLen', label: 'Random length', min: 0, max: 100, def: 0, unit: '%' },
      { k: 'randAng', label: 'Random angle', min: 0, max: 100, def: 0, unit: '%' },
      { k: 'core', label: 'Center glow', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'coreSize', label: 'Center size', min: 2, max: 100, def: 30, unit: '%', show: (p) => p.core > 0 },
      SEED,
    ],
    cost: (p) => 1 + p.rays * 0.12,
    prep(p, ctx) {
      const r = rng(ctx.seed), rays = new Float64Array(p.rays * 3);
      for (let i = 0; i < p.rays; i++) {
        const a = (i / p.rays) * TAU + (r() - 0.5) * (p.randAng / 100) * (TAU / p.rays);
        rays[i * 3] = Math.cos(a);
        rays[i * 3 + 1] = Math.sin(a);
        rays[i * 3 + 2] = (p.length / 100) * (1 - (p.randLen / 100) * r());
      }
      return { rays, ihw: 200 / p.width, taper: p.taper / 100, soft: p.soft / 100, fade: p.fade,
        core: p.core / 100, icore: 100 / p.coreSize, cf: makeFalloff('inverse', 1) };
    },
    fill(s, xs, ys, out, n) {
      const R = s.rays, ihw = s.ihw, taper = s.taper, soft = s.soft, fade = s.fade;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        let v = 0;
        for (let j = 0; j < R.length; j += 3) {
          const c = R[j], sn = R[j + 1], len = R[j + 2];
          const along = x * c + y * sn;
          if (along <= 0 || along >= len) continue;
          const u = along / len, wm = 1 - taper * u;
          if (wm <= 0) continue;
          const t = (Math.abs(y * c - x * sn) * ihw) / wm;
          if (t >= 1) continue;
          const r = softEdge(t, soft) * Math.pow(1 - u, fade);
          if (r > v) v = r;
        }
        if (s.core > 0) {
          const rr = Math.sqrt(x * x + y * y) * s.icore;
          if (rr < 1) v = screen(v, s.core * s.cf(rr));
        }
        out[i] = v;
      }
    },
  },

  spark: {
    label: 'Spark / Streak', hint: 'A stretched, tapered streak with a bright head, for fast particles.',
    params: [
      { k: 'length', label: 'Length', min: 10, max: 800, def: 170, unit: '%', log: true },
      { k: 'width', label: 'Width', min: 0.5, max: 100, step: 0.5, def: 16, unit: '%' },
      { k: 'head', label: 'Brightest at', min: 0, max: 100, def: 75, unit: '%', hint: 'Where along the streak it is brightest, from the tail (0) to the head (100)' },
      { k: 'tailTaper', label: 'Tail taper', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'headTaper', label: 'Head taper', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'tailFade', label: 'Tail fade', min: 0.2, max: 6, step: 0.01, def: 1.2, log: true },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'glow', label: 'Head glow', min: 0, max: 100, def: 40, unit: '%' },
      { k: 'glowSize', label: 'Glow size', min: 2, max: 150, def: 25, unit: '%', show: (p) => p.glow > 0 },
    ],
    cost: () => 1,
    prep: (p) => ({ hl: p.length / 200, hw: p.width / 200, h: p.head / 50 - 1, tt: p.tailTaper / 100, ht: p.headTaper / 100,
      tf: p.tailFade, soft: p.soft / 100, glow: p.glow / 100, ig: 100 / p.glowSize, gf: makeFalloff('inverse', 1.2) }),
    fill(s, xs, ys, out, n) {
      const { hl, hw, h, tt, ht, tf, soft, glow, ig, gf } = s, hx = h * hl;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], u = x / hl;
        let v = 0;
        if (u > -1 && u < 1) {
          let wm, along;
          if (u <= h) { const q = (h - u) / (h + 1); wm = 1 - tt * q; along = Math.pow(1 - q, tf); }
          else { const q = (u - h) / (1 - h); wm = 1 - ht * q; along = 1 - smooth01(q); }
          if (wm > 0) {
            const t = Math.abs(y) / (hw * wm);
            if (t < 1) v = softEdge(t, soft) * along;
          }
        }
        if (glow > 0) {
          const d = Math.hypot(x - hx, y) * ig;
          if (d < 1) v = screen(v, glow * gf(d));
        }
        out[i] = v;
      }
    },
  },

  smoke: {
    label: 'Smoke / Cloud', hint: 'A noisy puff with broken edges: smoke, dust, clouds, fire.', seeded: true, evolve: true,
    params: [
      { k: 'radius', label: 'Radius', min: 10, max: 150, def: 80, unit: '%' },
      { k: 'edge', label: 'Edge softness', min: 0, max: 100, def: 60, unit: '%' },
      { k: 'breakup', label: 'Edge breakup', min: 0, max: 100, def: 50, unit: '%', hint: 'How much the noise eats into the outline' },
      { k: 'kind', label: 'Noise', type: 'select', def: 'billow', options: NOISE_KINDS },
      { k: 'scale', label: 'Noise scale', min: 0.5, max: 16, step: 0.01, def: 2.5, log: true },
      { k: 'detail', label: 'Detail', min: 1, max: 8, def: 5 },
      { k: 'rough', label: 'Roughness', min: 20, max: 80, def: 50, unit: '%', hint: 'Strength of the fine detail' },
      { k: 'warp', label: 'Swirl', min: 0, max: 200, def: 40, unit: '%' },
      { k: 'density', label: 'Density', min: 0, max: 100, def: 55, unit: '%' },
      { k: 'contrast', label: 'Contrast', min: 0.2, max: 5, step: 0.01, def: 1.3, log: true },
      SEED,
    ],
    cost: (p) => 1 + p.detail + (p.warp > 0 ? 6 : 0),
    prep: (p, ctx) => ({ P: perm(ctx.seed), ir: 100 / p.radius, edge: Math.max(p.edge / 100, 1e-3), brk: p.breakup / 100,
      kind: KIND_INDEX[p.kind], sc: p.scale, oct: p.detail, gain: p.rough / 100, warp: p.warp / 100 * 1.5,
      dens: p.density / 100, con: p.contrast, z: 0.5 + ctx.z, pz: ctx.pz }),
    fill(s, xs, ys, out, n) {
      const { P, ir, edge, brk, kind, sc, oct, gain, warp, dens, con, z, pz } = s, reach = 1 + 0.5 * brk;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], r = Math.sqrt(x * x + y * y) * ir;
        if (r >= reach) { out[i] = 0; continue; }   // outside even the most broken-up edge
        let nx = x * sc, ny = y * sc;
        if (warp > 0) { warp2(P, nx, ny, z, warp, 0, 0, pz); nx = warpX; ny = warpY; }
        const nv = noise01(fractal(P, nx, ny, z, oct, gain, kind, 0, 0, pz), kind);
        const re = r + (0.5 - nv) * brk;
        const m = re >= 1 ? 0 : re <= 1 - edge ? 1 : 1 - smooth01((re - 1 + edge) / edge);
        out[i] = m * clamp01((nv - 0.5) * con + dens);
      }
    },
  },

  trail: {
    label: 'Trail', hint: 'Fills the frame left to right: a band for trail and beam renderers, head on the right.', full: true, seeded: true, evolve: true,
    params: [
      { k: 'width', label: 'Width', min: 5, max: 100, def: 60, unit: '%' },
      { k: 'soft', label: 'Edge softness', min: 0, max: 100, def: 100, unit: '%' },
      { k: 'core', label: 'Bright core', min: 0, max: 100, def: 30, unit: '%' },
      { k: 'seamless', label: 'Repeats along its length', type: 'check', def: false, hint: 'No fades at the ends; the streaks tile left to right' },
      { k: 'tail', label: 'Tail fade', min: 0, max: 100, def: 80, unit: '%', show: (p) => !p.seamless },
      { k: 'head', label: 'Head fade', min: 0, max: 50, def: 5, unit: '%', show: (p) => !p.seamless },
      { k: 'curve', label: 'Fade curve', min: 0.2, max: 6, step: 0.01, def: 1.5, log: true, show: (p) => !p.seamless },
      { k: 'streaks', label: 'Streaks', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'sScale', label: 'Streak scale', min: 1, max: 32, step: 0.1, def: 4, log: true, show: (p) => p.streaks > 0 },
      { k: 'sDetail', label: 'Streak detail', min: 1, max: 6, def: 3, show: (p) => p.streaks > 0 },
      SEED,
    ],
    cost: (p) => 1 + (p.streaks > 0 ? p.sDetail : 0),
    prep(p, ctx) {
      const seam = p.seamless, px = seam ? Math.max(1, Math.round(p.sScale)) : p.sScale;
      return { w: p.width / 100, soft: p.soft / 100, core: p.core / 100, seam, tail: p.tail / 100, head: p.head / 100,
        curve: p.curve, amt: p.streaks / 100, px, py: p.sScale * 5, oct: p.sDetail, P: perm(ctx.seed), z: 0.5 + ctx.z, pz: ctx.pz };
    },
    fill(s, xs, ys, out, n) {
      const { w, soft, core, seam, tail, head, curve, amt, px, py, oct, P, z, pz } = s;
      for (let i = 0; i < n; i++) {
        const u = xs[i], a = Math.abs(ys[i] * 2 - 1);
        let v = softEdge(a / w, soft);
        if (core > 0) v = screen(v, core * (1 - smooth01(clamp01(a / (w * 0.25)))));
        if (!seam) {
          if (u < tail) v *= Math.pow(u / tail, curve);
          if (u > 1 - head) v *= smooth01((1 - u) / head);
        }
        if (amt > 0 && v > 0) {
          const m = clamp01(0.5 + (fractal(P, u * px, ys[i] * py, z, oct, 0.5, 0, seam ? px : 0, 0, pz)) * 3);
          v *= 1 - amt + amt * m;
        }
        out[i] = v;
      }
    },
  },

  lightning: {
    label: 'Lightning', hint: 'A jagged branching bolt from left to right. Rotate the layer to aim it.', seeded: true,
    params: [
      { k: 'length', label: 'Length', min: 20, max: 300, def: 180, unit: '%' },
      { k: 'jag', label: 'Jaggedness', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'detail', label: 'Detail', min: 2, max: 9, def: 7 },
      { k: 'branches', label: 'Forks', min: 0, max: 100, def: 35, unit: '%' },
      { k: 'branchLen', label: 'Fork length', min: 5, max: 100, def: 50, unit: '%', show: (p) => p.branches > 0 },
      { k: 'width', label: 'Core width', min: 0.2, max: 10, step: 0.1, def: 2, unit: '%' },
      { k: 'thin', label: 'End taper', min: 0, max: 100, def: 50, unit: '%', hint: 'How much thinner and dimmer the bolt gets toward its end' },
      { k: 'glow', label: 'Glow size', min: 0, max: 60, step: 0.5, def: 12, unit: '%' },
      { k: 'glowAmt', label: 'Glow strength', min: 0, max: 100, def: 55, unit: '%', show: (p) => p.glow > 0 },
      SEED,
    ],
    cost: () => 3,
    prep(p, ctx) {
      const S = buildBolt(p, ctx.seed), reach = p.glow / 100;
      return { S, grid: segmentGrid(S, reach), reach, glow: reach > 0 ? p.glowAmt / 100 : 0 };
    },
    fill(s, xs, ys, out, n) {
      const { S, grid, reach, glow } = s, { x0, y0, sx, sy, G, start, idx } = grid;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        const cx = Math.floor((x - x0) * sx), cy = Math.floor((y - y0) * sy);
        if (cx < 0 || cy < 0 || cx >= G || cy >= G) { out[i] = 0; continue; }
        const c = cy * G + cx;
        let core = 0, halo = 0;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const j = idx[k], ax = S[j], ay = S[j + 1], dx = S[j + 2] - ax, dy = S[j + 3] - ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
          const d = Math.hypot(x - ax - dx * t, y - ay - dy * t), hw = S[j + 4] / 2, b = S[j + 5];
          if (d < hw) { const q = (d / hw) ** 2, cv = b * (1 - q * q); if (cv > core) core = cv; }   // flat-topped, so thin bolts stay white-hot
          if (d < reach) { const q = 1 - d / reach, gv = b * q * q * q; if (gv > halo) halo = gv; }
        }
        out[i] = screen(core, glow * halo);
      }
    },
  },

  shape: {
    label: 'Shape', hint: 'Circles, polygons, stars, crosses and hearts, filled or as outlines.',
    params: [
      { k: 'shape', label: 'Shape', type: 'select', def: 'circle',
        options: [['circle', 'Circle'], ['square', 'Square'], ['polygon', 'Polygon'], ['star', 'Star'], ['cross', 'Cross'], ['heart', 'Heart']] },
      { k: 'size', label: 'Size', min: 5, max: 150, def: 60, unit: '%' },
      { k: 'sides', label: 'Sides', min: 3, max: 12, def: 6, show: (p) => p.shape === 'polygon' },
      { k: 'points', label: 'Points', min: 3, max: 12, def: 5, show: (p) => p.shape === 'star' },
      { k: 'depth', label: 'Point depth', min: 0, max: 100, def: 55, unit: '%', show: (p) => p.shape === 'star' },
      { k: 'thick', label: 'Arm width', min: 5, max: 90, def: 32, unit: '%', show: (p) => p.shape === 'cross' },
      { k: 'round', label: 'Rounding', min: 0, max: 100, def: 0, unit: '%', show: (p) => p.shape !== 'circle' },
      { k: 'style', label: 'Style', type: 'select', def: 'fill', options: [['fill', 'Filled'], ['outline', 'Outline']] },
      { k: 'line', label: 'Line width', min: 0.5, max: 50, step: 0.5, def: 5, unit: '%', show: (p) => p.style === 'outline' },
      { k: 'soft', label: 'Edge softness', min: 0, max: 50, step: 0.5, def: 1, unit: '%' },
      { k: 'glow', label: 'Outer glow', min: 0, max: 100, def: 0, unit: '%' },
      { k: 'glowSize', label: 'Glow size', min: 1, max: 100, def: 25, unit: '%', show: (p) => p.glow > 0 },
    ],
    cost: () => 1.5,
    prep(p) {
      const R = p.size / 100, rnd = p.round / 100;
      let sd;
      switch (p.shape) {
        case 'square': { const rr = rnd * R; sd = (x, y) => sdBox(x, y, R - rr, R - rr) - rr; break; }
        case 'polygon': { const f = starSdf(p.sides, p.sides), rr = rnd * R * 0.5; sd = (x, y) => f(x, y, R - rr) - rr; break; }
        case 'star': {
          const f = starSdf(p.points, lerp(p.points, 2, p.depth / 100)), rr = rnd * R * 0.3;
          sd = (x, y) => f(x, y, R - rr) - rr;
          break;
        }
        case 'cross': {
          const th = (p.thick / 100) * R, rr = rnd * th * 0.95;
          sd = (x, y) => Math.min(sdBox(x, y, R - rr, th - rr), sdBox(x, y, th - rr, R - rr)) - rr;
          break;
        }
        case 'heart': {
          const rr = rnd * R * 0.3, k = 0.552 / Math.max(R - rr, 1e-3);
          sd = (x, y) => sdHeart(x * k, y * k + 0.552) / k - rr;
          break;
        }
        default: sd = (x, y) => Math.sqrt(x * x + y * y) - R;
      }
      return { sd, outline: p.style === 'outline', lw: p.line / 200, e: p.soft / 100, glow: p.glow / 100, ig: 100 / p.glowSize };
    },
    fill(s, xs, ys, out, n) {
      const { sd, outline, lw, e, glow, ig } = s;
      for (let i = 0; i < n; i++) {
        let d = sd(xs[i], ys[i]);
        if (outline) d = Math.abs(d) - lw;
        let v = e > 0 ? smooth01(clamp01(0.5 - d / e)) : d < 0 ? 1 : 0;
        if (glow > 0 && d > 0) {
          const t = d * ig;
          if (t < 1) v = screen(v, glow * (1 - t) * (1 - t));
        }
        out[i] = v;
      }
    },
  },

  noise: {
    label: 'Noise', hint: 'Fills the frame with noise or cells. Use it as a mask, for dissolves, or packed in a channel.', full: true, seeded: true, evolve: true,
    params: [
      { k: 'kind', label: 'Type', type: 'select', def: 'smooth', options: [...NOISE_KINDS, ['cells', 'Cells'], ['edges', 'Cell edges']] },
      { k: 'scale', label: 'Scale', min: 1, max: 32, step: 0.1, def: 4, log: true },
      { k: 'stretch', label: 'Stretch', min: 10, max: 1000, def: 100, unit: '%', log: true, hint: 'Above 100 % stretches the pattern sideways' },
      { k: 'detail', label: 'Detail', min: 1, max: 8, def: 4 },
      { k: 'rough', label: 'Roughness', min: 20, max: 80, def: 50, unit: '%' },
      { k: 'warp', label: 'Swirl', min: 0, max: 200, def: 0, unit: '%', show: (p) => p.kind !== 'cells' && p.kind !== 'edges' },
      { k: 'density', label: 'Brightness', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'contrast', label: 'Contrast', min: 0.2, max: 5, step: 0.01, def: 1, log: true },
      { k: 'seamless', label: 'Tiles seamlessly', type: 'check', def: true, hint: 'Rounds the scale so the pattern repeats exactly at the frame edges' },
      SEED,
    ],
    cost: (p) => (p.kind === 'cells' || p.kind === 'edges' ? p.detail * 4 : p.detail + (p.warp > 0 ? 6 : 0)),
    prep(p, ctx) {
      let fx = (p.scale * ctx.ax) / (p.stretch / 100), fy = p.scale * ctx.ay;
      if (p.seamless) { fx = Math.max(1, Math.round(fx)); fy = Math.max(1, Math.round(fy)); }
      const cells = p.kind === 'cells' || p.kind === 'edges';
      return { fx, fy, px: p.seamless ? fx : 0, py: p.seamless ? fy : 0, cells, edges: p.kind === 'edges',
        kind: cells ? 0 : KIND_INDEX[p.kind], seed: ctx.seed, P: perm(ctx.seed), oct: p.detail, gain: p.rough / 100,
        warp: p.warp / 100 * 1.5, dens: p.density / 100, con: p.contrast, z: ctx.z, pz: ctx.pz };
    },
    fill(s, xs, ys, out, n) {
      const { fx, fy, px, py, cells, edges, kind, seed, P, oct, gain, warp, dens, con, z, pz } = s;
      for (let i = 0; i < n; i++) {
        let x = xs[i] * fx, y = ys[i] * fy, v;
        if (cells) v = cellular(seed, x, y, z, oct, gain, edges, px, py);
        else {
          if (warp > 0) { warp2(P, x, y, 0.5 + z, warp, px, py, pz); x = warpX; y = warpY; }
          v = noise01(fractal(P, x, y, 0.5 + z, oct, gain, kind, px, py, pz), kind);
        }
        out[i] = clamp01((v - 0.5) * con + dens);
      }
    },
  },
};
const GEN_ORDER = ['glow', 'ring', 'star', 'spark', 'smoke', 'trail', 'lightning', 'shape', 'noise'];
