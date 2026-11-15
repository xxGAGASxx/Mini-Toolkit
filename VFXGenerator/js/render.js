'use strict';
// Document -> pixels. Each frame is worked out in bands of rows at the supersampled size:
// every layer is evaluated and blended into one value (four when packing channels), shaped by
// intensity and gamma, faded at the edges, averaged down to the output size and colored.
// The result is 16-bit RGBA with straight alpha; export turns it into 8 or 16 bits.
// Rendering is a generator that yields between bands, so long renders can run in slices.

const BAND = 32768;   // samples per band: small enough to yield often, big enough to stay efficient

// Where frame k sits in the animation. t runs evenly 0..1 (a loop stops one frame short of 1,
// because the frame after the last is the first again). s is the eased 0..1 used for
// "from -> to" values; in a loop it goes to the end value and back.
function animAt(anim, k) {
  if (anim.loop) {
    const t = k / anim.frames;
    return { t, s: (1 - Math.cos(TAU * t)) / 2 };
  }
  const t = anim.frames > 1 ? k / (anim.frames - 1) : 0;
  return { t, s: EASE[anim.ease](t) };
}

// Settings of group grp ('p' generator, 'd' dissolve) at position s (0..1) between their own
// values and their end values in L.k. Counts stay whole.
function settingsAt(L, grp, src, s) {
  let o = src;
  for (const key in L.k) {
    if (!key.startsWith(grp) || key[grp.length] !== '.') continue;
    const def = keyDef(L.type, key);
    if (!def) continue;
    if (o === src) o = { ...src };
    const v = lerp(src[def.k], L.k[key], s);
    o[def.k] = def.int ? Math.round(v) : v;
  }
  return o;
}

// One layer at frame k, ready to evaluate: its generator and dissolve prepared, and the
// transform from frame space into layer space (move, then rotate back, then undo scale and
// stretch). li is the layer's place in the stack, which varies its flicker.
function prepLayer(L, doc, k, ax, ay, li = 0) {
  const g = GEN[L.type], A = L.a, an = doc.anim.on ? animAt(doc.anim, k) : null;
  let p = L.p, d = L.d, scale = L.scale / 100, op = L.opacity / 100, rot = L.rot, seed = L.p.seed || 0, z = 0, pz = 0;
  if (an) {
    p = settingsAt(L, 'p', p, an.s);
    d = settingsAt(L, 'd', d, an.s);
    scale *= lerp(A.scA, A.scB, an.s) / 100;
    op *= lerp(A.opA, A.opB, an.s) / 100;
    rot += A.rot * (doc.anim.loop ? an.t : an.s);
    if (A.evo > 0 && g.evolve) {
      if (doc.anim.loop) { pz = Math.max(1, Math.round(A.evo)); z = an.t * pz; } else z = an.s * A.evo;
    }
    if (A.reseed && g.seeded) seed += k * 7919;
    if (A.flk > 0) op *= 1 - (A.flk / 100) * (hash3(k, li, 0x6b1f) / 4294967296);
    if (A.pls > 0) {
      // Whole beats over the animation, at full strength on the first frame.
      const dip = (A.pls / 100) * (1 - Math.cos(TAU * A.plsN * an.t)) / 2;
      if (A.plsTo !== 'size') op *= 1 - dip;
      if (A.plsTo !== 'op' && !g.full) scale *= 1 - 0.5 * dip;
    }
  }
  scale = Math.max(scale, 1e-3);
  const r = -rot * DEG;
  return { g, st: g.prep(p, { seed, z, pz, ax, ay }), op, blend: L.blend, inv: L.invert, ch: doc.color.mode === 'pack' ? CH[L.ch] : 0,
    dis: d.amt > 0 ? prepDissolve(d, !!g.full, ax, ay) : null,
    full: !!g.full, x: L.x / 100, y: L.y / 100, c: Math.cos(r), s: Math.sin(r), isx: 1 / ((scale * L.stretch) / 100), isy: 1 / scale };
}

/* ---------- dissolve */
const DIS_FROM = { all: 0, out: 1, in: 2, bottom: 3, top: 4, left: 5, right: 6 };

function prepDissolve(d, full, ax, ay) {
  const soft = Math.max((d.soft / 100) * 0.4, 0.004), bw = soft + 0.06;
  // Full-frame layers get whole noise cells across the frame, so a tiling layer still tiles.
  const fx = full ? Math.max(1, Math.round(d.scale * ax)) : 0, fy = full ? Math.max(1, Math.round(d.scale * ay)) : 0;
  return { P: perm(d.seed + 1000003), k: d.scale / 2, fx, fy, full, ax, ay, from: DIS_FROM[d.from], soft, sb: bw,
    burn: (d.burn / 100) * 2, t0: lerp(-bw, 1, d.amt / 100) };
}

// Each point gets a key 0..1: noise, spread evenly (the noise is bunched near 0.5), mixed with a
// gradient when the dissolve starts from a side. Points with keys below the threshold are gone;
// the threshold climbs from below 0 to 1 as the amount goes 0 -> 100 %.
function dissolve(D, xs, ys, val, n) {
  const { P, k, fx, fy, full, ax, ay, from, soft, sb, burn, t0 } = D;
  for (let i = 0; i < n; i++) {
    const v = val[i];
    if (v <= 0) continue;
    let x, y, nx, ny;
    if (full) { nx = xs[i] * fx; ny = ys[i] * fy; x = (xs[i] * 2 - 1) * ax; y = (1 - ys[i] * 2) * ay; }
    else { x = xs[i]; y = ys[i]; nx = x * k; ny = y * k; }
    let key = 1 / (1 + Math.exp((0.5 - noise01(fractal(P, nx, ny, 0.5, 4, 0.5, 0, fx, fy, 0), 0)) * 8.5));
    if (from) {
      const g = from === 1 ? 1 - Math.sqrt(x * x + y * y) : from === 2 ? Math.sqrt(x * x + y * y)
        : from === 3 ? (y + 1) / 2 : from === 4 ? (1 - y) / 2 : from === 5 ? (x + 1) / 2 : (1 - x) / 2;
      key = key * 0.35 + clamp01(g) * 0.65;
    }
    const dd = key - t0;
    if (dd <= 0) { val[i] = 0; continue; }
    let m = dd >= soft ? 1 : smooth01(dd / soft);
    if (burn > 0 && dd < sb) m += burn * (1 - smooth01(dd / sb));
    val[i] = v * m;
  }
}

// 0 at the edge, 1 once `d` (distance in from the edge, 0..1) passes the fade width.
const edgeRamp = (d, fw) => (d >= fw ? 1 : d <= 0 ? 0 : smooth01(d / fw));

// Renders a document. opt: { w, h } frame size in pixels, ss samples per pixel side, and
// single: true for just one frame (thumbnails), frame `at` (default 0). Yields progress 0..1, returns
// { data: Uint16Array RGBA, w, h, cols, rows, n, border } where border is the most visible a
// frame's edge pixels get (-1 when packing channels, where it does not apply).
function* renderDoc(doc, opt) {
  const sh = sheetOf(doc), W = opt.w, H = opt.h, ss = opt.ss;
  const n = opt.single ? 1 : sh.n, cols = opt.single ? 1 : sh.cols, rows = opt.single ? 1 : sh.rows;
  const SW = W * ss, SH = H * ss, m = Math.min(W, H), ax = W / m, ay = H / m, inv = 1 / (ss * ss);
  const mode = doc.color.mode, pack = mode === 'pack', nch = pack ? 4 : 1;
  const gain = doc.color.gain / 100, gamma = doc.color.gamma;
  const lut = mode === 'ramp' ? rampLut(doc.color.ramp) : null, rampAlpha = doc.color.rampAlpha;
  const used = [false, false, false, false];
  for (const L of doc.layers) if (L.on) used[CH[L.ch]] = true;

  // Edge fade, per sample column and row: the fade factor (square, top and bottom), or the
  // squared distance out from the center (round, which needs both together). Distances count
  // from one output pixel in, so the whole outermost ring of pixels ends up empty.
  const em = { off: 0, round: 1, box: 2, tb: 3 }[doc.edge.mode], fw = doc.edge.width / 100;
  const inward = (s, size) => {
    const p = (s + 0.5) / ss;
    return clamp((Math.min(p, size - p) - 1) / (size / 2 - 1), 0, 1);   // 0 in the edge pixel .. 1 at the center
  };
  const ex = new Float32Array(SW), ey = new Float32Array(SH);
  for (let x = 0; x < SW; x++) {
    const d = inward(x, W);
    ex[x] = em === 1 ? (1 - d) * (1 - d) : em === 2 ? edgeRamp(d, fw) : 1;
  }
  for (let y = 0; y < SH; y++) {
    const d = inward(y, H);
    ey[y] = em === 1 ? (1 - d) * (1 - d) : em >= 2 ? edgeRamp(d, fw) : 1;
  }

  const rpb = Math.max(1, Math.floor(BAND / (SW * ss)));   // output rows per band
  const cap = SW * rpb * ss;
  const xs = new Float32Array(cap), ys = new Float32Array(cap), val = new Float32Array(cap), acc = new Float32Array(cap * nch);
  const out = new Uint16Array(cols * W * rows * H * 4);
  const visible = doc.layers.filter((L) => L.on && L.opacity > 0);
  let border = 0, done = 0;

  for (let k = 0; k < n; k++) {
    const frame = opt.single ? Math.min(opt.at || 0, sh.n - 1) : k;
    const layers = visible.map((L) => prepLayer(L, doc, frame, ax, ay, doc.layers.indexOf(L))).filter((P) => P.op > 0);
    const fx0 = (k % cols) * W, fy0 = Math.floor(k / cols) * H;

    for (let oy = 0; oy < H; oy += rpb) {
      const oy1 = Math.min(H, oy + rpb), sy0 = oy * ss, sy1 = oy1 * ss, cnt = (sy1 - sy0) * SW;
      acc.fill(0);

      for (const P of layers) {
        let i = 0;
        if (P.full) {
          for (let sy = sy0; sy < sy1; sy++) {
            const v = (sy + 0.5) / SH;
            for (let sx = 0; sx < SW; sx++, i++) { xs[i] = (sx + 0.5) / SW; ys[i] = v; }
          }
        } else {
          const { c, s, isx, isy } = P;
          for (let sy = sy0; sy < sy1; sy++) {
            const py = (1 - ((sy + 0.5) / SH) * 2) * ay - P.y;
            for (let sx = 0; sx < SW; sx++, i++) {
              const px = (((sx + 0.5) / SW) * 2 - 1) * ax - P.x;
              xs[i] = (px * c - py * s) * isx;
              ys[i] = (px * s + py * c) * isy;
            }
          }
        }
        P.g.fill(P.st, xs, ys, val, cnt);
        if (P.inv) for (i = 0; i < cnt; i++) val[i] = 1 - clamp01(val[i]);
        if (P.dis) dissolve(P.dis, xs, ys, val, cnt);
        const o = P.ch * cap, op = P.op;
        switch (P.blend) {
          case 'screen':
            for (i = 0; i < cnt; i++) { const a = acc[o + i], b = op * val[i]; acc[o + i] = a + b * (1 - Math.min(a, 1)); }
            break;
          case 'max':
            for (i = 0; i < cnt; i++) { const b = op * val[i]; if (b > acc[o + i]) acc[o + i] = b; }
            break;
          case 'mask':
            for (i = 0; i < cnt; i++) acc[o + i] *= 1 - op + op * clamp01(val[i]);
            break;
          case 'sub':
            for (i = 0; i < cnt; i++) acc[o + i] = Math.max(0, acc[o + i] - op * val[i]);
            break;
          default:
            for (i = 0; i < cnt; i++) acc[o + i] += op * val[i];
        }
      }

      // Shape, fade, average the samples of each pixel, color it.
      for (let py = oy; py < oy1; py++) {
        const rowOut = ((fy0 + py) * cols * W + fx0) * 4, edgeRow = py === 0 || py === H - 1;
        for (let px = 0; px < W; px++) {
          let v0 = 0, v1 = 0, v2 = 0, v3 = 0;
          for (let j = 0; j < ss; j++) {
            const sy = py * ss + j, row = (sy - sy0) * SW;
            for (let q = 0; q < ss; q++) {
              const sx = px * ss + q, i = row + sx;
              let e = 1;
              if (em === 1) {
                const r = Math.sqrt(ex[sx] + ey[sy]);
                e = r >= 1 ? 0 : r <= 1 - fw ? 1 : 1 - smooth01((r - 1 + fw) / fw);
              } else if (em) e = ex[sx] * ey[sy];
              if (e === 0) continue;
              for (let ch = 0; ch < nch; ch++) {
                let a = acc[ch * cap + i] * gain;
                a = a <= 0 ? 0 : a >= 1 ? 1 : gamma === 1 ? a : Math.pow(a, gamma);
                a *= e;
                if (ch === 0) v0 += a; else if (ch === 1) v1 += a; else if (ch === 2) v2 += a; else v3 += a;
              }
            }
          }
          v0 *= inv; v1 *= inv; v2 *= inv; v3 *= inv;

          let r, g, b, a;
          if (pack) { r = used[0] ? v0 : 0; g = used[1] ? v1 : 0; b = used[2] ? v2 : 0; a = used[3] ? v3 : 1; }
          else if (mode === 'alpha') { r = g = b = 1; a = v0; }
          else if (mode === 'gray') { r = g = b = v0; a = 1; }
          else {
            const f = v0 * 1023, i0 = Math.min(Math.floor(f), 1022) * 4, t = f - i0 / 4;
            r = lut[i0] + (lut[i0 + 4] - lut[i0]) * t;
            g = lut[i0 + 1] + (lut[i0 + 5] - lut[i0 + 1]) * t;
            b = lut[i0 + 2] + (lut[i0 + 6] - lut[i0 + 2]) * t;
            a = lut[i0 + 3] + (lut[i0 + 7] - lut[i0 + 3]) * t;
            if (rampAlpha) a *= v0;
          }
          const o = rowOut + px * 4;
          out[o] = Math.round(r * 65535);
          out[o + 1] = Math.round(g * 65535);
          out[o + 2] = Math.round(b * 65535);
          out[o + 3] = Math.round(a * 65535);
          if (!pack && (edgeRow || (em !== 3 && (px === 0 || px === W - 1)))) {
            const vis = mode === 'gray' ? v0 : a;
            if (vis > border) border = vis;
          }
        }
      }
      done += oy1 - oy;
      yield done / (n * H);
    }
  }
  return { data: out, w: W, h: H, cols, rows, n, border: pack ? -1 : border };
}

// Rough amount of work, to decide between rendering at once and rendering in the background.
function renderCost(doc, w, h, ss, frames) {
  let per = 0.5;
  for (const L of doc.layers) {
    if (!(L.on && L.opacity > 0)) continue;
    const p = frames > 1 ? withEnds(L, 'p', L.p) : L.p;   // the costlier end is a fair guess
    per += Math.max(GEN[L.type].cost(L.p), GEN[L.type].cost(p)) + 0.5;
    if (L.d.amt > 0 || (frames > 1 && has(L.k, 'd.amt'))) per += 4;
  }
  return frames * w * h * ss * ss * per;
}

/* ---------- running renders */
function runSync(gen) {
  let r;
  while (!(r = gen.next()).done);
  return r.value;
}

// Runs a render in slices of about 12 ms, so the page keeps responding. Returns { cancel }.
function runSliced(gen, { progress, done, fail }) {
  let dead = false;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    if (dead) return;
    const t0 = performance.now();
    try {
      for (;;) {
        const r = gen.next();
        if (r.done) { dead = true; done(r.value); return; }
        if (performance.now() - t0 > 12) { if (progress) progress(r.value); break; }
      }
    } catch (err) { dead = true; if (fail) fail(err); return; }
    ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
  return { cancel() { dead = true; ch.port1.onmessage = null; } };
}

/* ---------- converting results */
// Fixed triangular noise (-1..1 of one 8-bit step), tiled, so every export comes out the same.
const DITHER = (() => {
  const r = rng(2024), t = new Float32Array(64 * 64 * 4);
  for (let i = 0; i < t.length; i++) t[i] = r() - r();
  return t;
})();

// 8 bits per channel. Dithering adds a little noise to in-between values, which hides banding
// in smooth glows; exact 0 and full values stay exact, so empty areas stay empty.
function to8(res, premul, dither) {
  const d = res.data, W = res.cols * res.w, H = res.rows * res.h, o = new Uint8ClampedArray(d.length);
  const q = (v, ti) => {
    const x = v * 255;
    if (!dither || x < 0.5 || x > 254.5) return Math.round(x);
    return clamp(Math.round(x + DITHER[ti]), 0, 255);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, ti = ((y & 63) * 64 + (x & 63)) * 4;
      const a = d[i + 3] / 65535, mul = premul ? a : 1;
      o[i] = q((d[i] / 65535) * mul, ti);
      o[i + 1] = q((d[i + 1] / 65535) * mul, ti + 1);
      o[i + 2] = q((d[i + 2] / 65535) * mul, ti + 2);
      o[i + 3] = q(a, ti + 3);
    }
  }
  return o;
}

function to16(res, premul) {
  const d = res.data;
  if (!premul) return d;
  const o = new Uint16Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 65535;
    o[i] = Math.round(d[i] * a); o[i + 1] = Math.round(d[i + 1] * a); o[i + 2] = Math.round(d[i + 2] * a); o[i + 3] = d[i + 3];
  }
  return o;
}

// For the screen: the image as it will look, or one channel of the file as gray.
function resultImage(res, out, premulAllowed, channel) {
  const W = res.cols * res.w, H = res.rows * res.h;
  const premul = out.premul && premulAllowed, dither = out.depth === 8 && out.dither;
  if (channel === 'rgba') return new ImageData(to8(res, false, dither), W, H);
  const src = to8(res, premul, dither), c = CH[channel], px = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = src[i + c]; px[i + 3] = 255; }
  return new ImageData(px, W, H);
}
