'use strict';
// More layer generators, built the same way as those in shapes.js: slash, vortex, particles,
// flame, caustics, cracks, gradient, runes, splatter and crystal. Also the stroke helpers used
// by the ones drawn from line segments, and the order of the "Add layer" menu.

/* ---------- strokes: segments of six numbers, x0, y0, x1, y1, width, brightness */

// Segments cut to `amt` of their arrival times T (if given), bucketed for drawing.
function prepStrokes(S, T, amt, soft, glowSize, glowAmt) {
  const R = T ? revealSegments(S, T, amt) : S;
  return { S: R, grid: segmentGrid(R, glowSize), soft, reach: glowSize, glow: glowSize > 0 ? glowAmt : 0 };
}

// Lines with a soft edge, plus a glow round them that fades over `reach`.
function strokeFill(s, xs, ys, out, n) {
  const { S, grid, soft, reach, glow } = s;
  if (!S.length) { out.fill(0, 0, n); return; }
  const { x0, y0, sx, sy, G, start, idx } = grid, r2 = reach * reach;
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
      const ex = x - ax - dx * t, ey = y - ay - dy * t, d2 = ex * ex + ey * ey, hw = S[j + 4] / 2, b = S[j + 5];
      if (d2 < hw * hw) { const v = b * softEdge(Math.sqrt(d2) / hw, soft); if (v > core) core = v; }
      if (d2 < r2) { const q = 1 - Math.sqrt(d2) / reach, g = b * q * q * q; if (g > halo) halo = g; }
    }
    out[i] = screen(core, glow * halo);
  }
}

// Scratch coordinate arrays, for generators that remap coordinates before drawing.
let scrX = new Float32Array(0), scrY = new Float32Array(0);
function scratch(n) {
  if (scrX.length < n) { scrX = new Float32Array(n); scrY = new Float32Array(n); }
}

/* ---------- cracks: random walks out from the center, with branches and rings */
function buildCracks(p, seed) {
  const r = rng(seed), S = [], T = [], mains = [];
  const L = p.length / 100, jag = p.jag / 100, w0 = p.width / 100, taper = p.taper / 100, n = p.count;
  const seg = (x0, y0, x1, y1, w, t0, t1) => { S.push(x0, y0, x1, y1, w, 1); T.push(t0, t1); };

  // One crack: heads along `base`, wandering and pulled back toward it, so it stays roughly
  // straight but jagged. keep: also return its points with their arrival (for the rings).
  function walk(x, y, base, len, w, t, depth, keep) {
    const steps = Math.max(3, Math.round((26 * len) / L)), sl = len / steps, pts = keep ? [[x, y, t]] : null;
    let wander = 0;
    for (let i = 0; i < steps; i++) {
      wander = wander * 0.8 + (r() - 0.5) * jag * 1.3;
      const ang = base + wander, nx = x + Math.cos(ang) * sl, ny = y + Math.sin(ang) * sl;
      const f0 = i / steps, f1 = (i + 1) / steps;
      seg(x, y, nx, ny, w * (1 - taper * (f0 + f1) / 2), t, t + sl);
      if (depth < 2 && i > 0 && i < steps - 2 && r() < (p.branches / 100) * 0.16) {
        const blen = (len - (i + 1) * sl) * (0.35 + 0.45 * r());
        if (blen > L * 0.06) walk(nx, ny, ang + (r() < 0.5 ? -1 : 1) * (0.35 + 0.6 * r()), blen, w * (1 - taper * f1) * 0.7, t + sl, depth + 1, false);
      }
      x = nx; y = ny; t += sl;
      if (pts) pts.push([x, y, t]);
    }
    return pts;
  }
  for (let i = 0; i < n; i++) {
    const base = Math.PI / 2 - (i / n) * TAU + (r() - 0.5) * (TAU / n) * 0.5;
    mains.push(walk(0, 0, base, L * (1 - (p.lenVar / 100) * r()), w0, 0, 0, true));
  }
  // Rings: jagged cracks across from each main crack to the next, at a few distances out.
  if (n >= 3) {
    for (let q = 1; q <= p.rings; q++) {
      const rad = L * (q / (p.rings + 1)) * (0.85 + 0.3 * r());
      for (let i = 0; i < n; i++) {
        const A = mains[i].find((pt) => Math.hypot(pt[0], pt[1]) >= rad);
        const B = mains[(i + 1) % n].find((pt) => Math.hypot(pt[0], pt[1]) >= rad);
        if (!A || !B || r() < 0.2) continue;
        let X = [A[0], B[0]], Y = [A[1], B[1]], amp = jag * Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.15;
        for (let l = 0; l < 3; l++) {
          const nx = [X[0]], ny = [Y[0]];
          for (let k = 0; k < X.length - 1; k++) {
            const dx = X[k + 1] - X[k], dy = Y[k + 1] - Y[k], d = Math.hypot(dx, dy) || 1, off = (r() * 2 - 1) * amp;
            nx.push((X[k] + X[k + 1]) / 2 - (dy / d) * off, X[k + 1]);
            ny.push((Y[k] + Y[k + 1]) / 2 + (dx / d) * off, Y[k + 1]);
          }
          X = nx; Y = ny; amp *= 0.5;
        }
        const w = w0 * 0.65 * (1 - taper * clamp01(rad / L));
        let t = A[2];
        for (let k = 0; k < X.length - 1; k++) {
          const sl = Math.hypot(X[k + 1] - X[k], Y[k + 1] - Y[k]);
          seg(X[k], Y[k], X[k + 1], Y[k + 1], w, t, t + sl);
          t += sl;
        }
      }
    }
  }
  return { S: new Float64Array(S), T: normArrivals(new Float64Array(T)) };
}

/* ---------- runes: made-up glyphs from strokes between points of a small grid */
const RUNE_X = [-0.35, 0, 0.35], RUNE_Y = [0.5, 0.17, -0.17, -0.5];
const RUNE_STEPS = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]];   // diagonals twice as likely

function buildRunes(p, seed) {
  const r = rng(seed), S = [], T = [], n = p.count, R = p.radius / 100, gs = p.size / 100, w = p.width / 100;
  for (let g = 0; g < n; g++) {
    // Glyph g sits at the top for g = 0, then clockwise, upright facing outward.
    const th = Math.PI / 2 - (g / n) * TAU, rx = Math.cos(th), ry = Math.sin(th), cx = rx * R, cy = ry * R;
    // Strokes join grid points a step or two apart, mostly starting from a point already drawn,
    // so a glyph hangs together like a rune: often a stem with branches off it.
    const strokes = [], used = [], seen = new Set();
    const add = (ai, aj, bi, bj) => {
      const id = ai * 4 + aj < bi * 4 + bj ? `${ai}${aj}${bi}${bj}` : `${bi}${bj}${ai}${aj}`;
      if (seen.has(id)) return false;
      seen.add(id);
      used.push([ai, aj], [bi, bj]);
      return true;
    };
    if (r() < 0.75) {   // a stem
      const c = r() < 0.6 ? 1 : r() < 0.5 ? 0 : 2, j0 = r() < 0.75 ? 0 : 1, j1 = r() < 0.75 ? 3 : 2;
      add(c, j0, c, j1);
      strokes.push([[RUNE_X[c], RUNE_Y[j0]], [RUNE_X[c], RUNE_Y[j1]]]);
    }
    for (let tries = 0; strokes.length < p.strokes && tries < 60; tries++) {
      if (r() < 0.08) {   // a small ring
        const ox = RUNE_X[(r() * 3) | 0], oy = RUNE_Y[(r() * 4) | 0], pts = [];
        for (let k = 0; k <= 8; k++) pts.push([ox + 0.1 * Math.cos((k / 8) * TAU), oy + 0.1 * Math.sin((k / 8) * TAU)]);
        strokes.push(pts);
        continue;
      }
      const from = used.length && r() < 0.85 ? used[(r() * used.length) | 0] : [(r() * 3) | 0, (r() * 4) | 0];
      const [di, dj] = RUNE_STEPS[(r() * RUNE_STEPS.length) | 0], len = r() < 0.3 ? 2 : 1;
      const ai = from[0], aj = from[1], bi = ai + di * len, bj = aj + dj * len;
      if (bi < 0 || bi > 2 || bj < 0 || bj > 3 || !add(ai, aj, bi, bj)) continue;
      const A = [RUNE_X[ai], RUNE_Y[aj]], B = [RUNE_X[bi], RUNE_Y[bj]];
      if (r() < p.curves / 100) {   // an arc: a curve bent to one side
        const bend = (r() < 0.5 ? -1 : 1) * (0.25 + 0.25 * r()), dx = B[0] - A[0], dy = B[1] - A[1];
        const C = [(A[0] + B[0]) / 2 - dy * bend, (A[1] + B[1]) / 2 + dx * bend], pts = [];
        for (let k = 0; k <= 6; k++) {
          const t = k / 6, u = 1 - t;
          pts.push([u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], u * u * A[1] + 2 * u * t * C[1] + t * t * B[1]]);
        }
        strokes.push(pts);
      } else strokes.push([A, B]);
    }
    // To layer space: glyph x runs along the circle (clockwise), glyph y points outward.
    const put = (pt) => [cx + (pt[0] * ry + pt[1] * rx) * gs, cy + (-pt[0] * rx + pt[1] * ry) * gs];
    const ns = strokes.length;
    strokes.forEach((pts, si) => {
      const nk = pts.length - 1;
      for (let k = 0; k < nk; k++) {
        const a = put(pts[k]), b = put(pts[k + 1]);
        S.push(a[0], a[1], b[0], b[1], w, 1);
        T.push((g + (si + k / nk) / ns) / n, (g + (si + (k + 1) / nk) / ns) / n);
      }
    });
  }
  return { S: new Float64Array(S), T: new Float64Array(T) };
}

/* ---------- crystal: one arm's half, drawn in a wedge and mirrored all round */
function buildCrystal(p, seed) {
  const r = rng(seed), S = [], T = [];
  const L = p.length / 100, w0 = p.width / 100, taper = p.taper / 100, rnd = p.random / 100;
  const half = Math.PI / p.arms, lim = half * 0.92, phi = p.angle * DEG;
  const wAt = (d) => w0 * (1 - taper * clamp01(d / L));
  // A straight stroke split in pieces so its width can taper, with arrival by distance.
  const line = (x0, y0, x1, y1, wa, wb, t0) => {
    const len = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(len / (L / 8)));
    for (let i = 0; i < k; i++) {
      const a = i / k, b = (i + 1) / k;
      S.push(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, lerp(wa, wb, (a + b) / 2), 1);
      T.push(t0 + len * a, t0 + len * b);
    }
  };
  // Longest stroke from (x, y) at angle a, up to len, that stays inside this arm's half wedge.
  const fit = (x, y, a, len) => {
    for (let k = 0; k < 14; k++, len *= 0.82) {
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      if (ey >= 0 && ex > 0 && Math.atan2(ey, ex) <= lim) return len;
    }
    return 0;
  };
  line(0, 0, L, 0, w0, wAt(L), 0);
  const nb = p.branches;
  for (let b = 0; b < nb; b++) {
    const pos = L * clamp(0.22 + (0.7 * (b + 0.5)) / nb + ((r() - 0.5) * rnd * 0.6) / nb, 0.1, 0.95);
    const want = (p.branchLen / 100) * (L - pos) * 1.3 * (1 - rnd * 0.55 * r());
    const len = fit(pos, 0, phi, want);
    if (len < L * 0.02) continue;
    const ex = pos + Math.cos(phi) * len, ey = Math.sin(phi) * len, wb = wAt(pos) * 0.8;
    line(pos, 0, ex, ey, wb, wb * (1 - taper * 0.8), pos);
    // Twigs: smaller strokes off the branch, on both sides where they fit.
    const nt = p.twigs > 0 ? 1 + Math.round((p.twigs / 100) * 2) : 0;
    for (let t = 0; t < nt; t++) {
      const f = 0.35 + (0.5 * (t + 0.5)) / nt + (r() - 0.5) * rnd * 0.15, tx = pos + Math.cos(phi) * len * f, ty = Math.sin(phi) * len * f;
      for (const side of [-1, 1]) {
        const a = phi + side * phi * 0.85, tl = fit(tx, ty, a, len * (1 - f) * (p.twigs / 100) * 0.9 * (1 - rnd * 0.4 * r()));
        if (tl > L * 0.015) line(tx, ty, tx + Math.cos(a) * tl, ty + Math.sin(a) * tl, wb * 0.7, wb * 0.7 * (1 - taper * 0.8), pos + len * f);
      }
    }
  }
  if (p.plate > 0) {   // half of one side of a ring with a corner on each arm
    const P = (p.plate / 100) * L;
    line(P, 0, (P * (1 + Math.cos(2 * half))) / 2, (P * Math.sin(2 * half)) / 2, w0 * 0.8, w0 * 0.8, 0);
  }
  return { S: new Float64Array(S), T: normArrivals(new Float64Array(T)) };
}

/* ---------- splatter: soft blobs that merge where they meet */
// Blobs as [x, y, radius, dx, dy, stretch]: the main blob and lumps round it, droplets thrown
// outward (stretched back toward the center) and small specks.
function buildSplat(p, seed) {
  const r = rng(seed), B = [];
  const Rm = p.size / 100, lumps = p.lumps / 100, spread = p.spread / 100, st = p.streak / 100, ref = Rm > 0 ? Rm : 0.3;
  if (Rm > 0) {
    B.push([0, 0, Rm * (1 - 0.35 * lumps), 1, 0, 1]);
    const k = Math.round(3 + lumps * 7);
    for (let i = 0; i < k; i++) {
      const a = (TAU * (i + r() * 0.8)) / k, d = Rm * (0.35 + 0.45 * r()) * (0.4 + lumps);
      B.push([Math.cos(a) * d, Math.sin(a) * d, Rm * (0.3 + 0.35 * r()), 1, 0, 1]);
    }
  }
  const near = Rm * 0.9, far = Math.max(spread, near + 0.1);
  for (let i = 0; i < p.drops; i++) {
    const a = TAU * r(), u = r(), d = near + (far - near) * Math.pow(u, 0.8);
    const rad = Math.max(0.006, ref * (p.dropSize / 100) * (0.35 + 0.65 * r()) * (1 - 0.5 * u));
    const el = 1 + st * 3.5 * (0.3 + 0.7 * u) * (0.5 + 0.5 * r()), c = d - rad * (el - 1);
    B.push([Math.cos(a) * c, Math.sin(a) * c, rad, Math.cos(a), Math.sin(a), el]);
  }
  for (let i = 0; i < p.specks; i++) {
    const a = TAU * r(), d = near + far * 1.1 * Math.pow(r(), 0.7), el = 1 + st * 1.5 * r();
    B.push([Math.cos(a) * d, Math.sin(a) * d, 0.005 + 0.012 * r(), Math.cos(a), Math.sin(a), el]);
  }
  return B;
}
// Each blob adds (1 - (d / reach)^2)^3 out to reach = 1.6 radii. Alone, a blob then reaches
// SPLAT_T at exactly its radius; blobs close together melt into one.
const SPLAT_K = 1.6, SPLAT_T = (1 - 1 / (SPLAT_K * SPLAT_K)) ** 3;

/* ---------- the generators */
Object.assign(GEN, {
  gradient: {
    label: 'Gradient', hint: 'Linear, radial, angle and diamond ramps, with repeats: masks, wipes, stripes.',
    params: [
      { k: 'kind', label: 'Type', type: 'select', def: 'linear',
        options: [['linear', 'Linear'], ['mirror', 'Linear, both ways'], ['radial', 'Radial'], ['angle', 'Angle'], ['diamond', 'Diamond'], ['square', 'Square']] },
      { k: 'size', label: 'Size', min: 5, max: 300, def: 100, unit: '%', hint: 'Length of one run of the ramp' },
      { k: 'repeat', label: 'Repeats', min: 1, max: 32, def: 1, int: true },
      { k: 'zigzag', label: 'Zigzag repeats', type: 'check', def: false, hint: 'Every other run goes back down, so there are no hard steps', show: (p) => p.repeat > 1 },
      { k: 'offset', label: 'Offset', min: -100, max: 100, def: 0, unit: '%', hint: 'Slides the ramp along. Animate it to sweep a wipe across' },
      { k: 'curve', label: 'Curve', min: 0.2, max: 5, step: 0.01, def: 1, log: true },
      { k: 'steps', label: 'Steps', min: 0, max: 32, def: 0, int: true, hint: '0 is smooth; otherwise the ramp is cut into this many flat bands' },
      { k: 'start', label: 'Start', min: 0, max: 100, def: 0, unit: '%', hint: 'Brightness where the ramp starts' },
      { k: 'end', label: 'End', min: 0, max: 100, def: 100, unit: '%', hint: 'Brightness where the ramp ends' },
    ],
    cost: () => 0.5,
    prep: (p) => ({ kind: p.kind, is: 100 / p.size, rep: p.repeat, zig: p.zigzag, off: p.offset / 100, curve: p.curve,
      steps: p.steps, a: p.start / 100, b: p.end / 100, wrap: p.repeat > 1 || p.kind === 'angle' }),
    fill(s, xs, ys, out, n) {
      const { kind, is, rep, zig, off, curve, steps, a, b, wrap } = s;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        let t;
        switch (kind) {
          case 'mirror': t = Math.abs(x) * is; break;
          case 'radial': t = Math.sqrt(x * x + y * y) * is; break;
          case 'angle': t = Math.atan2(x, y) / TAU + 1; break;   // clockwise from straight up
          case 'diamond': t = (Math.abs(x) + Math.abs(y)) * is; break;
          case 'square': t = Math.max(Math.abs(x), Math.abs(y)) * is; break;
          default: t = (x * is + 1) / 2;
        }
        if (wrap) {
          t = t * rep + off;
          if (zig) { const m = t - 2 * Math.floor(t / 2); t = m < 1 ? m : 2 - m; } else t -= Math.floor(t);
        } else t = clamp01(t + off);
        if (curve !== 1) t = Math.pow(t, curve);
        if (steps > 1) t = Math.min(Math.floor(t * steps), steps - 1) / (steps - 1);
        out[i] = a + (b - a) * t;
      }
    },
  },

  slash: {
    label: 'Slash / Arc', hint: 'A curved swipe with a bright outer edge: sword slashes, whooshes, arcs.', seeded: true, evolve: true,
    params: [
      { k: 'radius', label: 'Radius', min: 10, max: 150, def: 72, unit: '%' },
      { k: 'sweep', label: 'Sweep', min: 10, max: 360, def: 170, unit: '°', hint: 'How far round the circle the arc reaches' },
      { k: 'width', label: 'Width', min: 1, max: 100, def: 40, unit: '%' },
      { k: 'tailAt', label: 'Tail at', min: 0, max: 100, def: 0, unit: '%', hint: 'Where the drawn part starts along the arc. Animate it with Head at for a swipe' },
      { k: 'headAt', label: 'Head at', min: 0, max: 100, def: 100, unit: '%', hint: 'Where the drawn part ends along the arc' },
      { k: 'thick', label: 'Thickest at', min: 0, max: 100, def: 62, unit: '%', hint: 'Along the drawn part, from the tail (0) to the head (100)' },
      { k: 'taper', label: 'Taper', min: 0, max: 100, def: 100, unit: '%', hint: 'How much the arc narrows toward both ends' },
      { k: 'tailFade', label: 'Tail fade', min: 0.2, max: 6, step: 0.01, def: 1.2, log: true },
      { k: 'inner', label: 'Inner fade', min: 0.2, max: 6, step: 0.01, def: 1.3, log: true, hint: 'How fast it fades from the bright outer edge inward' },
      { k: 'outer', label: 'Outer softness', min: 0, max: 100, def: 12, unit: '%' },
      { k: 'streaks', label: 'Streaks', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'sScale', label: 'Streak scale', min: 1, max: 32, step: 0.1, def: 6, log: true, show: (p) => p.streaks > 0 },
      SEED,
    ],
    cost: (p) => 1.5 + (p.streaks > 0 ? 3 : 0),
    prep(p, ctx) {
      const sw = p.sweep * DEG;
      return { R: p.radius / 100, w: p.width / 100, sw, th0: Math.PI / 2 + sw / 2, u0: p.tailAt / 100, du: (p.headAt - p.tailAt) / 100,
        h: clamp(p.thick / 100, 0.001, 0.999), taper: p.taper / 100, tf: p.tailFade, inner: p.inner, outer: p.outer / 100,
        amt: p.streaks / 100, ss: p.sScale, P: perm(ctx.seed), z: 0.5 + ctx.z, pz: ctx.pz };
    },
    fill(s, xs, ys, out, n) {
      const { R, w, sw, th0, u0, du, h, taper, tf, inner, outer, amt, ss, P, z, pz } = s;
      if (du <= 0) { out.fill(0, 0, n); return; }
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], r = Math.sqrt(x * x + y * y);
        let a = (th0 - Math.atan2(y, x)) % TAU;   // clockwise from the tail end of the whole arc
        if (a < 0) a += TAU;
        const f = (a / sw - u0) / du;             // 0 tail .. 1 head of the drawn part
        if (f < 0 || f > 1) { out[i] = 0; continue; }
        const q = f < h ? (h - f) / h : (f - h) / (1 - h), tm = 1 - taper * q * q;
        if (tm <= 0) { out[i] = 0; continue; }
        const bw = w * tm;   // thickness of the band here, from the outer edge inward
        let v;
        if (r > R) { const o = outer > 0 ? (r - R) / (outer * bw) : 1; v = o >= 1 ? 0 : 1 - smooth01(o); }
        else { const t = (R - r) / bw; v = t >= 1 ? 0 : Math.pow(1 - t, inner); }
        if (v <= 0) { out[i] = 0; continue; }
        if (f < h) v *= Math.pow(f / h, tf);
        if (amt > 0) {
          const m = clamp01(0.5 + fractal(P, a * R * ss * 0.5, r * ss * 4, z, 3, 0.5, 0, 0, 0, pz) * 3);
          v = clamp01(v * (1 + amt * (m - 0.5) * 1.6));   // bright and dark streaks, about even
        }
        out[i] = v;
      }
    },
  },

  particles: {
    label: 'Particles', hint: 'Scattered dots, sparkles or streaks: embers, dust, bursts. Animate Distance to move them.', seeded: true, evolve: true,
    params: [
      { k: 'count', label: 'Count', min: 1, max: 300, def: 40, int: true },
      { k: 'area', label: 'Area', type: 'select', def: 'disc', options: [['disc', 'Disc'], ['ring', 'Ring'], ['square', 'Square'], ['line', 'Line']] },
      { k: 'spread', label: 'Spread', min: 5, max: 150, def: 75, unit: '%', hint: 'Size of the area the particles start in' },
      { k: 'cluster', label: 'Clustering', min: 0, max: 100, def: 30, unit: '%', hint: 'Gathers more of them toward the middle (Ring: toward the circle line)' },
      { k: 'look', label: 'Look', type: 'select', def: 'glow', options: [['glow', 'Soft glow'], ['dot', 'Hard dot'], ['sparkle', 'Sparkle']] },
      { k: 'size', label: 'Size', min: 0.5, max: 40, step: 0.1, def: 10, unit: '%' },
      { k: 'sizeVar', label: 'Size range', min: 0, max: 100, def: 60, unit: '%', hint: 'How much smaller some particles are, at random' },
      { k: 'dim', label: 'Dim range', min: 0, max: 100, def: 50, unit: '%', hint: 'How much dimmer some particles are, at random' },
      { k: 'elong', label: 'Streak', min: 100, max: 1000, def: 100, unit: '%', log: true, hint: 'Stretches each particle along its way of travel' },
      { k: 'dir', label: 'Travel', type: 'select', def: 'out', options: [['out', 'Outward'], ['in', 'Inward'], ['up', 'Up'], ['down', 'Down']] },
      { k: 'travel', label: 'Distance', min: 0, max: 200, def: 0, unit: '%', hint: 'How far they have moved. Animate it for bursts, implosions and rising embers' },
      { k: 'speedVar', label: 'Speed range', min: 0, max: 100, def: 50, unit: '%', hint: 'How much slower some particles are', show: (p) => p.travel > 0 },
      { k: 'twinkle', label: 'Twinkle', min: 0, max: 100, def: 0, unit: '%', hint: 'Each particle brightens and dims at its own pace as Noise motion runs' },
      SEED,
    ],
    cost: (p) => 1.5 + Math.min(25, p.count / 30 + p.count * (p.size / 100) ** 2 * (p.elong / 100) * 10),
    prep(p, ctx) {
      const r = rng(ctx.seed), n = p.count, R = p.spread / 100, c = p.cluster / 100, el = p.elong / 100;
      const T = p.travel / 100, sv = p.speedVar / 100, base = p.size / 100, tw = p.twinkle / 100;
      const D = new Float64Array(n * 8), S = new Float64Array(n * 6);
      const lean = (u) => Math.sign(u - 0.5) * Math.pow(Math.abs(2 * u - 1), 1 + 2 * c);
      for (let i = 0; i < n; i++) {
        const u1 = r(), u2 = r(), u3 = r(), u4 = r(), u5 = r(), u6 = r(), u7 = r(), u8 = r();
        let x, y;
        if (p.area === 'square') { x = R * lean(u1); y = R * lean(u2); }
        else if (p.area === 'line') { x = R * lean(u1); y = R * 0.06 * (2 * u2 - 1); }
        else {
          const rad = p.area === 'ring' ? R * (1 + (u1 - 0.5) * 0.4 * (1 - 0.85 * c)) : R * Math.pow(u1, 0.5 + 1.5 * c), a = TAU * u2;
          x = rad * Math.cos(a); y = rad * Math.sin(a);
        }
        let dx = 0, dy = 1;
        if (p.dir === 'down') dy = -1;
        else if (p.dir !== 'up') {
          const l = Math.hypot(x, y), a = TAU * u6;
          dx = l > 1e-6 ? x / l : Math.cos(a); dy = l > 1e-6 ? y / l : Math.sin(a);
          if (p.dir === 'in') { dx = -dx; dy = -dy; }
        }
        const go = T * (1 - sv * u5);
        if (p.dir === 'in') { const k = Math.max(0, 1 - go); x *= k; y *= k; } else { x += dx * go; y += dy * go; }
        const s = Math.max(base * (1 - (p.sizeVar / 100) * u3), 1e-4);
        let b = 1 - (p.dim / 100) * u4;
        // Whole cycles per unit of z, so a looping flipbook twinkles back to where it began.
        if (tw > 0) b *= 1 - tw * (0.5 - 0.5 * Math.cos(TAU * (u7 + ctx.z * (u8 < 0.5 ? 1 : 2))));
        D.set([x, y, dx, dy, 1 / s, 1 / (s * el), b], i * 8);
        S.set([x, y, x, y, 2 * s * Math.max(el, 1), b], i * 6);
      }
      return { D, S, grid: segmentGrid(S, 0), look: p.look === 'dot' ? 1 : p.look === 'sparkle' ? 2 : 0 };
    },
    fill(s, xs, ys, out, n) {
      const { D, grid, look } = s, { x0, y0, sx, sy, G, start, idx } = grid, g9 = 1 / 9;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        const cx = Math.floor((x - x0) * sx), cy = Math.floor((y - y0) * sy);
        if (cx < 0 || cy < 0 || cx >= G || cy >= G) { out[i] = 0; continue; }
        const c = cy * G + cx;
        let acc = 0;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const o = (idx[k] / 6) * 8, px = x - D[o], py = y - D[o + 1];
          const along = (px * D[o + 2] + py * D[o + 3]) * D[o + 5], across = (py * D[o + 2] - px * D[o + 3]) * D[o + 4];
          let v;
          if (look === 2) {   // sparkle: two thin crossed rays and a small core
            const ax = Math.abs(along), ay = Math.abs(across);
            if (ax >= 1 && ay >= 1) continue;
            v = 0;
            if (ax < 1) { const th = 0.14 * (1 - ax); if (ay < th) v = (1 - ax) * (1 - ax) * (1 - ay / th); }
            if (ay < 1) { const th = 0.14 * (1 - ay); if (ax < th) { const w = (1 - ay) * (1 - ay) * (1 - ax / th); if (w > v) v = w; } }
            const d2 = ax * ax + ay * ay;
            if (d2 < 0.09) { const g = 1 - d2 / 0.09; v = screen(v, g * g); }
          } else {
            const d2 = along * along + across * across;
            if (d2 >= 1) continue;
            v = look === 1 ? softEdge(Math.sqrt(d2), 0.25) : (1 / (1 + 8 * d2) - g9) / (1 - g9);
          }
          v *= D[o + 6];
          acc = acc + v - acc * v;
        }
        out[i] = acc;
      }
    },
  },

  flame: {
    label: 'Flame', hint: 'A tongue of fire on a round base. Give it Noise motion for a fire loop.', seeded: true, evolve: true,
    params: [
      { k: 'height', label: 'Height', min: 20, max: 200, def: 170, unit: '%' },
      { k: 'width', label: 'Width', min: 5, max: 150, def: 75, unit: '%' },
      { k: 'tip', label: 'Tip sharpness', min: 0.3, max: 4, step: 0.01, def: 0.9, log: true },
      { k: 'sway', label: 'Sway', min: 0, max: 100, def: 35, unit: '%', hint: 'How much the flame bends side to side, more toward the tip' },
      { k: 'tongues', label: 'Tongues', min: 0, max: 100, def: 70, unit: '%', hint: 'How much the noise tears the flame into licks' },
      { k: 'scale', label: 'Noise scale', min: 1, max: 12, step: 0.1, def: 3.5, log: true },
      { k: 'detail', label: 'Detail', min: 1, max: 6, def: 4, int: true },
      { k: 'rise', label: 'Rise speed', min: 0, max: 4, step: 0.1, def: 1.5, hint: 'How fast the pattern climbs as Noise motion runs' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'core', label: 'Hot core', min: 0, max: 100, def: 40, unit: '%', hint: 'Brighter inside, near the base' },
      SEED,
    ],
    cost: (p) => 2 + 2 * p.detail,
    prep(p, ctx) {
      const H = p.height / 100;
      return { yb: -H / 2, iH: 1 / H, W: p.width / 200, tip: p.tip, sway: p.sway / 100, brk: p.tongues / 100, sc: p.scale,
        oct: p.detail, rise: p.rise, soft: Math.max((p.soft / 100) * 0.6, 0.01), core: p.core / 100, P: perm(ctx.seed), z: ctx.z, pz: ctx.pz };
    },
    fill(s, xs, ys, out, n) {
      const { yb, iH, W, tip, sway, brk, sc, oct, rise, soft, core, P, z, pz } = s, zt = 0.5 + z;
      // The pattern climbs `rise` cells per unit of z. In a loop, two copies half a cycle apart are
      // blended, each faded out at the moment it jumps back, so the loop has no seam.
      let w1 = 1, w2 = 0, o1 = z * rise, o2 = 0, norm = 1;
      if (pz > 0) {
        const ph = z - Math.floor(z);
        w1 = 1 - Math.abs(2 * ph - 1); w2 = 1 - w1;
        o1 = ph * rise; o2 = ((ph + 0.5) % 1) * rise;
        norm = 1 / Math.sqrt(w1 * w1 + w2 * w2);
      }
      const rn = (X, Y, o) => (w2 === 0 ? fractal(P, X, Y - o1, zt, o, 0.5, 0, 0, 0, pz)
        : (w1 * fractal(P, X, Y - o1, zt, o, 0.5, 0, 0, 0, pz) + w2 * fractal(P, X + 31.7, Y - o2, zt, o, 0.5, 0, 0, 0, pz)) * norm);
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], f = (y - yb) * iH;   // 0 at the base .. 1 at the tip
        if (f <= 0 || f >= 1) { out[i] = 0; continue; }
        const Y = y * sc * 0.55;   // noise stretched upward, so it tears the flame into tall licks
        const xx = sway > 0 ? x - sway * rn(7.3, Y * 0.5, 2) * W * 3 * f * Math.sqrt(f) : x;
        const wy = W * (f < 0.25 ? Math.sqrt(1 - ((0.25 - f) / 0.25) ** 2) : Math.pow(1 - (f - 0.25) / 0.75, tip));
        if (wy < 1e-5) { out[i] = 0; continue; }
        let e = 1 - Math.abs(xx) / wy;   // 1 on the middle line, 0 at the side
        if (e <= -0.5) { out[i] = 0; continue; }
        if (brk > 0) e -= brk * (1 - noise01(rn(x * sc * 1.4, Y, oct), 0)) * (0.15 + 1.6 * f * f);
        if (e <= 0) { out[i] = 0; continue; }
        let v = (e >= soft ? 1 : smooth01(e / soft)) * (0.6 + 0.4 * clamp01(e * 1.6)) * (1 - 0.3 * f);
        if (core > 0) v = screen(v, core * smooth01(clamp01((e - 0.25) * 2)) * (1 - f) * (1 - f));
        out[i] = v;
      }
    },
  },

  vortex: {
    label: 'Vortex / Swirl', hint: 'Spiral arms round a center: portals, whirlpools, charge-ups.', seeded: true, evolve: true,
    params: [
      { k: 'arms', label: 'Arms', min: 1, max: 12, def: 3, int: true },
      { k: 'twist', label: 'Twist', min: -1080, max: 1080, def: 300, unit: '°', hint: 'How far each arm winds from the center to the edge. Negative winds the other way' },
      { k: 'width', label: 'Arm width', min: 5, max: 100, def: 45, unit: '%' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 80, unit: '%' },
      { k: 'radius', label: 'Radius', min: 10, max: 150, def: 90, unit: '%' },
      { k: 'hole', label: 'Hole', min: 0, max: 90, def: 15, unit: '%', hint: 'Empty middle, as a part of the radius' },
      { k: 'fade', label: 'Edge fade', min: 0, max: 100, def: 55, unit: '%' },
      { k: 'breakup', label: 'Breakup', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'scale', label: 'Noise scale', min: 1, max: 12, def: 3, int: true, hint: 'Noise cells per arm. Every arm gets the same pattern, so turning the layer by one arm loops' },
      SEED,
    ],
    cost: (p) => 1.5 + (p.breakup > 0 ? 3 : 0),
    prep: (p, ctx) => ({ arms: p.arms, tw: p.twist / 360, w: p.width / 100, soft: p.soft / 100, iR: 100 / p.radius, hole: p.hole / 100,
      fade: p.fade / 100, brk: p.breakup / 100, c: p.scale, P: perm(ctx.seed), z: 0.5 + ctx.z, pz: ctx.pz }),
    fill(s, xs, ys, out, n) {
      const { arms, tw, w, soft, iR, hole, fade, brk, c, P, z, pz } = s;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], rr = Math.sqrt(x * x + y * y) * iR;
        if (rr >= 1) { out[i] = 0; continue; }
        // Spiral phase: whole numbers on the arms. The noise runs along the spiral and repeats once
        // per arm (c cells), so it joins up all round the circle.
        let q = arms * (Math.atan2(y, x) / TAU - tw * rr), nv = 0.5;
        if (brk > 0) {
          nv = noise01(fractal(P, q * c, rr * c * 1.5, z, 3, 0.5, 0, c, 0, pz), 0);
          q += (nv - 0.5) * brk * 0.8;
        }
        let v = softEdge((Math.abs(q - Math.round(q)) * 2) / w, soft);
        if (v <= 0) { out[i] = 0; continue; }
        if (hole > 0) v *= smooth01(clamp01((rr - hole) / Math.max(0.05, 0.3 * (1 - hole))));
        if (fade > 0) v *= 1 - smooth01(clamp01((rr - 1 + fade) / fade));
        if (brk > 0) v *= clamp01(1 + brk * (nv - 0.5) * 2.2);
        out[i] = v;
      }
    },
  },

  splatter: {
    label: 'Splatter', hint: 'A blob with droplets flung outward: blood, paint, slime, ink.', seeded: true,
    params: [
      { k: 'size', label: 'Blob size', min: 0, max: 100, def: 36, unit: '%' },
      { k: 'lumps', label: 'Lumpiness', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'drops', label: 'Droplets', min: 0, max: 60, def: 18, int: true },
      { k: 'spread', label: 'Spread', min: 20, max: 150, def: 85, unit: '%', hint: 'How far the droplets fly' },
      { k: 'dropSize', label: 'Droplet size', min: 5, max: 100, def: 30, unit: '%', hint: 'Size of the droplets, against the blob' },
      { k: 'streak', label: 'Streaks', min: 0, max: 100, def: 50, unit: '%', hint: 'How much the droplets stretch back toward the center' },
      { k: 'specks', label: 'Specks', min: 0, max: 200, def: 40, int: true },
      { k: 'rough', label: 'Rough edges', min: 0, max: 100, def: 30, unit: '%' },
      { k: 'soft', label: 'Edge softness', min: 0, max: 50, step: 0.5, def: 3, unit: '%' },
      SEED,
    ],
    cost: (p) => 3 + (p.rough > 0 ? 3 : 0),
    prep(p, ctx) {
      const B = buildSplat(p, ctx.seed), D = new Float64Array(B.length * 8), S = new Float64Array(B.length * 6);
      B.forEach(([x, y, rad, dx, dy, el], i) => {
        const reach = rad * SPLAT_K;
        D.set([x, y, dx, dy, 1 / reach, 1 / (reach * el)], i * 8);
        S.set([x, y, x, y, 2 * reach * el, 1], i * 6);
      });
      return { D, S, grid: segmentGrid(S, 0), rough: p.rough / 100, sw: Math.max((p.soft / 100) * 1.2, 0.002) * SPLAT_T * 4, P: perm(ctx.seed) };
    },
    fill(s, xs, ys, out, n) {
      const { D, S, grid, rough, sw, P } = s, { x0, y0, sx, sy, G, start, idx } = grid;
      if (!S.length) { out.fill(0, 0, n); return; }
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        const cx = Math.floor((x - x0) * sx), cy = Math.floor((y - y0) * sy);
        if (cx < 0 || cy < 0 || cx >= G || cy >= G) { out[i] = 0; continue; }
        const c = cy * G + cx;
        let F = 0;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const o = (idx[k] / 6) * 8, px = x - D[o], py = y - D[o + 1];
          const a = (px * D[o + 2] + py * D[o + 3]) * D[o + 5], b = (py * D[o + 2] - px * D[o + 3]) * D[o + 4], q = a * a + b * b;
          if (q < 1) { const m = 1 - q; F += m * m * m; }
        }
        if (F < SPLAT_T * 0.3) { out[i] = 0; continue; }
        let thr = SPLAT_T;
        if (rough > 0) thr *= 1 + rough * (noise01(fractal(P, x * 9, y * 9, 0.5, 3, 0.5, 0, 0, 0, 0), 0) - 0.5) * 1.4;
        out[i] = smooth01(clamp01(0.5 + (F - thr) / sw));
      }
    },
  },

  cracks: {
    label: 'Cracks', hint: 'Branching cracks out from a point: ground impacts, ice, glass. Animate Spread to grow them.', seeded: true,
    params: [
      { k: 'count', label: 'Cracks', min: 1, max: 16, def: 7, int: true },
      { k: 'length', label: 'Length', min: 10, max: 150, def: 85, unit: '%' },
      { k: 'lenVar', label: 'Length range', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'jag', label: 'Jaggedness', min: 0, max: 100, def: 45, unit: '%' },
      { k: 'branches', label: 'Branches', min: 0, max: 100, def: 40, unit: '%' },
      { k: 'rings', label: 'Rings', min: 0, max: 4, def: 0, int: true, hint: 'Cracks running round the center between the main ones, as in broken glass' },
      { k: 'width', label: 'Width', min: 0.2, max: 8, step: 0.1, def: 1.6, unit: '%' },
      { k: 'taper', label: 'End taper', min: 0, max: 100, def: 75, unit: '%' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 40, unit: '%' },
      { k: 'glow', label: 'Glow size', min: 0, max: 40, step: 0.5, def: 0, unit: '%' },
      { k: 'glowAmt', label: 'Glow strength', min: 0, max: 100, def: 50, unit: '%', show: (p) => p.glow > 0 },
      { k: 'spread', label: 'Spread', min: 0, max: 100, def: 100, unit: '%', hint: 'How far the cracks have grown from the center. Animate it to crack open' },
      SEED,
    ],
    cost: () => 3,
    prep(p, ctx) {
      const b = buildCracks(p, ctx.seed);
      return prepStrokes(b.S, b.T, p.spread / 100, p.soft / 100, p.glow / 100, p.glowAmt / 100);
    },
    fill: strokeFill,
  },

  crystal: {
    label: 'Crystal / Snowflake', hint: 'Branches repeated round a center in mirror pairs: snowflakes, frost, ice stars.', seeded: true,
    params: [
      { k: 'arms', label: 'Arms', min: 3, max: 12, def: 6, int: true },
      { k: 'length', label: 'Length', min: 10, max: 150, def: 85, unit: '%' },
      { k: 'branches', label: 'Branches', min: 0, max: 8, def: 4, int: true },
      { k: 'branchLen', label: 'Branch length', min: 0, max: 100, def: 55, unit: '%' },
      { k: 'angle', label: 'Branch angle', min: 15, max: 85, def: 60, unit: '°' },
      { k: 'random', label: 'Randomness', min: 0, max: 100, def: 50, unit: '%', hint: 'Varies where branches sit and how long they are; change the seed for other flakes' },
      { k: 'twigs', label: 'Twigs', min: 0, max: 100, def: 0, unit: '%', hint: 'Smaller strokes off the branches' },
      { k: 'plate', label: 'Center ring', min: 0, max: 60, def: 15, unit: '%', hint: 'A ring with a corner on each arm, as a part of the length' },
      { k: 'width', label: 'Line width', min: 0.2, max: 10, step: 0.1, def: 2, unit: '%' },
      { k: 'taper', label: 'Taper', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 40, unit: '%' },
      { k: 'glow', label: 'Glow size', min: 0, max: 30, step: 0.5, def: 6, unit: '%' },
      { k: 'glowAmt', label: 'Glow strength', min: 0, max: 100, def: 40, unit: '%', show: (p) => p.glow > 0 },
      { k: 'grow', label: 'Grown', min: 0, max: 100, def: 100, unit: '%', hint: 'How far it has grown from the center. Animate it to freeze over' },
      SEED,
    ],
    cost: () => 2.5,
    prep(p, ctx) {
      const b = buildCrystal(p, ctx.seed);
      return { ...prepStrokes(b.S, b.T, p.grow / 100, p.soft / 100, p.glow / 100, p.glowAmt / 100), sector: TAU / p.arms };
    },
    fill(s, xs, ys, out, n) {
      // Fold every point into one half wedge (arm 0 points up), where that half arm is drawn.
      scratch(n);
      const sector = s.sector;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], rr = Math.sqrt(x * x + y * y);
        let a = Math.atan2(x, y);
        a = Math.abs(a - sector * Math.round(a / sector));
        scrX[i] = rr * Math.cos(a); scrY[i] = rr * Math.sin(a);
      }
      strokeFill(s, scrX, scrY, out, n);
    },
  },

  runes: {
    label: 'Rune ring', hint: 'Made-up glyphs round a circle for magic circles and seals. One glyph at radius 0 makes a sigil.', seeded: true,
    params: [
      { k: 'count', label: 'Glyphs', min: 1, max: 48, def: 12, int: true },
      { k: 'radius', label: 'Radius', min: 0, max: 140, def: 72, unit: '%' },
      { k: 'size', label: 'Glyph size', min: 2, max: 150, def: 20, unit: '%' },
      { k: 'strokes', label: 'Strokes', min: 1, max: 8, def: 4, int: true, hint: 'Strokes per glyph' },
      { k: 'curves', label: 'Curves', min: 0, max: 100, def: 25, unit: '%', hint: 'Share of strokes drawn as arcs' },
      { k: 'width', label: 'Line width', min: 0.2, max: 10, step: 0.1, def: 1.8, unit: '%' },
      { k: 'soft', label: 'Softness', min: 0, max: 100, def: 30, unit: '%' },
      { k: 'glow', label: 'Glow size', min: 0, max: 30, step: 0.5, def: 0, unit: '%' },
      { k: 'glowAmt', label: 'Glow strength', min: 0, max: 100, def: 50, unit: '%', show: (p) => p.glow > 0 },
      { k: 'reveal', label: 'Drawn', min: 0, max: 100, def: 100, unit: '%', hint: 'How much is written, glyph by glyph clockwise from the top. Animate it to write the ring' },
      SEED,
    ],
    cost: () => 2.5,
    prep(p, ctx) {
      const b = buildRunes(p, ctx.seed);
      return prepStrokes(b.S, b.T, p.reveal / 100, p.soft / 100, p.glow / 100, p.glowAmt / 100);
    },
    fill: strokeFill,
  },

  caustics: {
    label: 'Caustics', hint: 'The bright web of light on a pool floor. Tiles, and loops with Noise motion.', full: true, seeded: true, evolve: true,
    params: [
      { k: 'scale', label: 'Scale', min: 1, max: 24, step: 0.1, def: 4, log: true },
      { k: 'line', label: 'Line width', min: 1, max: 100, def: 25, unit: '%' },
      { k: 'glow', label: 'Glow', min: 0, max: 100, def: 40, unit: '%', hint: 'Soft light spreading from the lines into the cells' },
      { k: 'warp', label: 'Wobble', min: 0, max: 200, def: 80, unit: '%' },
      { k: 'second', label: 'Second web', min: 0, max: 100, def: 60, unit: '%', hint: 'Another web over the first, drifting the other way' },
      { k: 'density', label: 'Brightness', min: 0, max: 100, def: 50, unit: '%' },
      { k: 'contrast', label: 'Contrast', min: 0.2, max: 5, step: 0.01, def: 1, log: true },
      { k: 'seamless', label: 'Tiles seamlessly', type: 'check', def: true, hint: 'Rounds the scale so the pattern repeats exactly at the frame edges' },
      SEED,
    ],
    cost: (p) => 14 + (p.warp > 0 ? 8 : 0) + (p.second > 0 ? 18 : 0),
    prep(p, ctx) {
      let fx = p.scale * ctx.ax, fy = p.scale * ctx.ay;
      if (p.seamless) { fx = Math.max(1, Math.round(fx)); fy = Math.max(1, Math.round(fy)); }
      return { fx, fy, px: p.seamless ? fx : 0, py: p.seamless ? fy : 0, lw: Math.max((p.line / 100) * 0.12, 0.002), glow: p.glow / 100,
        warp: (p.warp / 100) * 0.6, two: p.second / 100, dens: p.density / 100, con: p.contrast, seed: ctx.seed, P: perm(ctx.seed), z: ctx.z, pz: ctx.pz };
    },
    fill(s, xs, ys, out, n) {
      const { fx, fy, px, py, lw, glow, warp, two, dens, con, seed, P, z, pz } = s, gw = lw * 5;
      // A thin bright line where two cells meet, with a wider soft glow round it.
      const web = (d) => Math.exp(-d / lw) * (1 - glow * 0.5) + glow * 0.5 * Math.exp(-d / gw);
      for (let i = 0; i < n; i++) {
        let x = xs[i] * fx, y = ys[i] * fy;
        if (warp > 0) { warp2(P, x, y, 0.5 + z, warp, px, py, pz); x = warpX; y = warpY; }
        // The cell points circle whole turns per unit of z, so loops join up.
        worley(seed, x, y, z, px, py);
        let v = web(cellF2 - cellF1);
        if (two > 0) {
          worley(seed + 977, x + 0.43, y + 0.71, -z, px, py);
          v = screen(v, two * web(cellF2 - cellF1));
        }
        out[i] = clamp01((v - 0.5) * con + dens);
      }
    },
  },
});

const GEN_ORDER = ['glow', 'ring', 'star', 'shape', 'gradient', 'spark', 'trail', 'slash', 'lightning', 'particles',
  'smoke', 'flame', 'vortex', 'splatter', 'cracks', 'crystal', 'runes', 'caustics', 'noise'];
