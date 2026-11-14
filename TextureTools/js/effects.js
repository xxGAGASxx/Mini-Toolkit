'use strict';
// Effects tab: blur / sharpen, pixelate, noise, gradient overlay, pattern overlay, outline.

/* ---------- blend modes, on 0..1 values (base b, overlay s) */
const BLEND_FN = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  softlight: (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b)
    : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  hardlight: (b, s) => (s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  add: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
  difference: (b, s) => Math.abs(b - s),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
};
// 'color' is not per channel: overlay hue and saturation, base brightness. null marks it.
const blendFn = (mode) => (mode === 'color' ? null : BLEND_FN[mode] || BLEND_FN.normal);

const CLR = new Float64Array(3);
function setLum(r, g, b, l) {
  const d = l - (0.3 * r + 0.59 * g + 0.11 * b);
  r += d; g += d; b += d;
  const L = 0.3 * r + 0.59 * g + 0.11 * b, n = Math.min(r, g, b), x = Math.max(r, g, b);
  if (n < 0) { const k = L / (L - n || 1e-9); r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k; }
  if (x > 1) { const k = (1 - L) / (x - L || 1e-9); r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k; }
  CLR[0] = r; CLR[1] = g; CLR[2] = b;
}

// Mixes an overlay color (0..1) into pixel i of d with a blend mode, by `mix` (0..1).
// Alpha stays as it is: overlays are clipped to the image, like layer styles.
function mixInto(d, i, sr, sg, sb, mix, fn) {
  const br = d[i] / 255, bg = d[i + 1] / 255, bb = d[i + 2] / 255;
  let r, g, b;
  if (fn) { r = fn(br, sr); g = fn(bg, sg); b = fn(bb, sb); } else {
    setLum(sr, sg, sb, 0.3 * br + 0.59 * bg + 0.11 * bb);
    r = CLR[0]; g = CLR[1]; b = CLR[2];
  }
  d[i] = (br + (r - br) * mix) * 255;
  d[i + 1] = (bg + (g - bg) * mix) * 255;
  d[i + 2] = (bb + (b - bb) * mix) * 255;
}

/* ---------- blur / sharpen */
function fxBlur(img, p, wrap) {
  const { w, h } = img;
  if (p.mode === 'sharpen') return fxSharpen(img, p, wrap);
  return fromPremul(gaussBlur(toPremul(img), w, h, 4, p.radius, wrap), w, h);
}

// Unsharp mask: push each pixel away from its blurred surroundings. The blur is weighted by alpha,
// so transparent neighbours don't add dark halos to a sprite's edge.
function fxSharpen(img, p, wrap) {
  const { w, h, d } = img, f = gaussBlur(toPremul(img), w, h, 4, Math.max(0.3, p.radius), wrap), k = p.amount / 100;
  const out = newImg(w, h), o = out.d;
  for (let i = 0; i < d.length; i += 4) {
    const a = f[i + 3], inv = a > 0.01 ? 255 / a : 0;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c], blurred = inv ? f[i + c] * inv : v;
      o[i + c] = v + (v - blurred) * k;
    }
    o[i + 3] = d[i + 3];
  }
  return out;
}

/* ---------- pixelate and posterize */
function fxPixelate(img, p) {
  const { w, h, d } = img, n = Math.max(1, Math.round(p.size)), out = newImg(w, h), o = out.d;
  if (n === 1) o.set(d);
  else {
    for (let by = 0; by < h; by += n) {
      const y1 = Math.min(h, by + n);
      for (let bx = 0; bx < w; bx += n) {
        const x1 = Math.min(w, bx + n);
        let r, g, b, a;
        if (p.mode === 'center') {
          const i = (Math.min(y1 - 1, by + (n >> 1)) * w + Math.min(x1 - 1, bx + (n >> 1))) * 4;
          r = d[i]; g = d[i + 1]; b = d[i + 2]; a = d[i + 3];
        } else {
          // Average weighted by alpha, so transparent pixels don't darken the cell.
          let sr = 0, sg = 0, sb = 0, sa = 0, cnt = 0;
          for (let y = by; y < y1; y++) {
            for (let x = bx, i = (y * w + bx) * 4; x < x1; x++, i += 4) {
              const al = d[i + 3];
              sr += d[i] * al; sg += d[i + 1] * al; sb += d[i + 2] * al; sa += al; cnt++;
            }
          }
          r = sa ? sr / sa : 0; g = sa ? sg / sa : 0; b = sa ? sb / sa : 0; a = sa / cnt;
        }
        for (let y = by; y < y1; y++) {
          for (let x = bx, i = (y * w + bx) * 4; x < x1; x++, i += 4) { o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = a; }
        }
      }
    }
  }
  if (p.levels >= 2) {
    const q = (p.levels - 1) / 255, lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v * q) / q);
    for (let i = 0; i < o.length; i += 4) { o[i] = lut[o[i]]; o[i + 1] = lut[o[i + 1]]; o[i + 2] = lut[o[i + 2]]; }
  }
  return out;
}

/* ---------- noise */
function gaussRand(rand) {
  const u = rand() || 1e-12, v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function fxNoise(img, p, wrap) {
  const { w, h, d } = img, out = newImg(w, h), o = out.d, rand = rng(p.seed * 7919 + 13);
  const amp = (p.amount / 100) * 127.5, g = Math.max(1, Math.round(p.grain)), ch = p.mono ? 1 : 3;
  const sample = p.dist === 'uniform' ? () => rand() * 2 - 1 : () => gaussRand(rand) * 0.5;
  if (g === 1) {
    for (let i = 0; i < d.length; i += 4) {
      const n0 = sample() * amp;
      o[i] = d[i] + n0;
      o[i + 1] = d[i + 1] + (ch === 1 ? n0 : sample() * amp);
      o[i + 2] = d[i + 2] + (ch === 1 ? n0 : sample() * amp);
      o[i + 3] = d[i + 3];
    }
    return out;
  }
  // Coarser grain: random values on a grid of g-pixel cells, smoothly interpolated. Interpolating
  // lowers the spread, so the values get a boost to look as strong as fine grain.
  const gw = Math.ceil(w / g), gh = Math.ceil(h / g), grid = new Float32Array(gw * gh * ch), boost = 1.6;
  for (let i = 0; i < grid.length; i++) grid[i] = sample() * amp * boost;
  const idx = (v, n) => (wrap ? mod(v, n) : clamp(v, 0, n - 1));
  const xa = new Int32Array(w), xb = new Int32Array(w), xt = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / g - 0.5, x0 = Math.floor(u);
    xa[x] = idx(x0, gw); xb[x] = idx(x0 + 1, gw); xt[x] = smooth(u - x0);
  }
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / g - 0.5, y0 = Math.floor(v), ty = smooth(v - y0);
    const ra = idx(y0, gh) * gw, rb = idx(y0 + 1, gh) * gw;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const t = xt[x];
      for (let c = 0; c < 3; c++) {
        const k = ch === 1 ? 0 : c;
        const top = lerp(grid[(ra + xa[x]) * ch + k], grid[(ra + xb[x]) * ch + k], t);
        const bot = lerp(grid[(rb + xa[x]) * ch + k], grid[(rb + xb[x]) * ch + k], t);
        o[i + c] = d[i + c] + lerp(top, bot, ty);
      }
      o[i + 3] = d[i + 3];
    }
  }
  return out;
}

/* ---------- gradient overlay
   Angle follows the usual image-editor convention: 0° runs left to right, 90° bottom to top. */
function gradientT(p, w, h) {
  const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = -Math.sin(a), sc = Math.max(0.01, p.scale / 100);
  const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  const ext = Math.abs(cx * dx) + Math.abs(cy * dy) || 1;     // half the image's length along the direction
  switch (p.type) {
    case 'radial': return (X, Y) => Math.hypot(X, Y) / (R * sc);
    case 'reflected': return (X, Y) => Math.abs(X * dx + Y * dy) / (ext * sc);
    case 'angle': return (X, Y) => fract((Math.atan2(-Y, X) - a) / (2 * Math.PI));
    case 'diamond': {
      const m = Math.max(...[[cx, cy], [cx, -cy]].map(([x, y]) => Math.abs(x * dx + y * dy) + Math.abs(-x * dy + y * dx)));
      return (X, Y) => (Math.abs(X * dx + Y * dy) + Math.abs(-X * dy + Y * dx)) / (m * sc);
    }
    default: return (X, Y) => 0.5 + (X * dx + Y * dy) / (2 * ext * sc);
  }
}

function fxGradient(img, p) {
  const { w, h, d } = img, out = newImg(w, h), o = out.d;
  o.set(d);
  // Lookup table of the gradient's colors. Interpolated premultiplied, so fading to transparent
  // doesn't pass through a dark color.
  const N = 1024, lut = new Float32Array(N * 4), c1 = hexToRgb(p.c1), c2 = hexToRgb(p.c2), a1 = p.a1 / 100, a2 = p.a2 / 100;
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1), A = lerp(a1, a2, t);
    for (let c = 0; c < 3; c++) lut[k * 4 + c] = A > 0 ? lerp(c1[c] * a1, c2[c] * a2, t) / A / 255 : 0;
    lut[k * 4 + 3] = A;
  }
  const tAt = gradientT(p, w, h), op = p.opacity / 100, fn = blendFn(p.blend), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const Y = y + 0.5 - cy;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      let t = clamp01(tAt(x + 0.5 - cx, Y));
      if (p.rev) t = 1 - t;
      const k = Math.round(t * (N - 1)) * 4, mix = lut[k + 3] * op;
      if (mix > 0) mixInto(o, i, lut[k], lut[k + 1], lut[k + 2], mix, fn);
    }
  }
  return out;
}

/* ---------- pattern overlay
   Patterns are drawn per pixel from a coverage function of cell coordinates (u, v), antialiased by
   distance in pixels. With "fit", the cell size is nudged so a whole number of cells spans the
   image, and the pattern tiles with it. */
function patternCoverage(type, t, cw, ch, perU, perV, seed) {
  const aa = (sd) => clamp01(0.5 - sd);   // sd: signed distance in px, negative inside the shape
  switch (type) {
    case 'stripes': return (u) => aa((Math.abs(fract(u) - 0.5) - t / 2) * cw);
    case 'dots': return (u, v) => aa(Math.hypot((fract(u) - 0.5) * cw, (fract(v) - 0.5) * ch) - (t / 2) * Math.min(cw, ch));
    case 'grid': return (u, v) => {
      const fu = fract(u), fv = fract(v);
      return aa(Math.min(Math.min(fu, 1 - fu) * cw, Math.min(fv, 1 - fv) * ch) - (t * Math.min(cw, ch)) / 2);
    };
    case 'bricks': return (u, v) => {   // one cell holds two rows of bricks, every other row shifted half a brick
      const row = Math.floor(v * 2), fu = fract(u + (row & 1) * 0.5), fv = fract(v * 2);
      return aa(Math.min(Math.min(fu, 1 - fu) * cw, (Math.min(fv, 1 - fv) * ch) / 2) - (t * ch) / 4);
    };
    case 'noise': return (u, v) => fbm(u, v, seed, 4, perU, perV);
    default: return (u, v) => {   // checker
      const fu = fract(u), fv = fract(v), e = clamp01(0.5 + Math.min(Math.min(fu, 1 - fu) * cw, Math.min(fv, 1 - fv) * ch));
      return ((Math.floor(u) + Math.floor(v)) & 1) === 0 ? e : 1 - e;
    };
  }
}

function fxPattern(img, p, patImg) {
  const { w, h, d } = img, out = newImg(w, h), o = out.d;
  o.set(d);
  const useImg = p.type === 'image' && patImg;
  const ang = mod(p.angle, 360), rad = (ang * Math.PI) / 180, ca = Math.cos(rad), sa = Math.sin(rad);
  let cw = Math.max(2, p.size), ch = useImg ? (cw * patImg.h) / patImg.w : cw, perU = 0, perV = 0;
  if (p.fit && ang % 90 === 0) {
    const swap = ang % 180 !== 0, spanU = swap ? h : w, spanV = swap ? w : h;
    perU = Math.max(1, Math.round(spanU / cw)); perV = Math.max(1, Math.round(spanV / ch));
    cw = spanU / perU; ch = spanV / perV;
  }
  const op = p.opacity / 100, fn = blendFn(p.blend), cx = w / 2, cy = h / 2;
  const cov = patternCoverage(p.type, p.thick / 100, cw, ch, perU, perV, p.seed);
  const fg = hexToRgb(p.fg), bg = hexToRgb(p.bg), fa = p.fa / 100, ba = p.ba / 100;
  const pw = useImg ? patImg.w : 0, ph = useImg ? patImg.h : 0, pd = useImg ? patImg.d : null;
  for (let y = 0; y < h; y++) {
    const Y = y + 0.5 - cy;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const X = x + 0.5 - cx, u = (X * ca + Y * sa) / cw, v = (-X * sa + Y * ca) / ch;
      if (useImg) {
        // Bilinear sample of the tile image, wrapping around.
        const sx = fract(u) * pw - 0.5, sy = fract(v) * ph - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
        const xa = mod(x0, pw), xb = mod(x0 + 1, pw), ya = mod(y0, ph) * pw, yb = mod(y0 + 1, ph) * pw;
        let r = 0, g = 0, b = 0, a = 0;
        const add = (j, wt) => { const al = pd[j + 3] * wt; r += pd[j] * al; g += pd[j + 1] * al; b += pd[j + 2] * al; a += al; };
        add((ya + xa) * 4, (1 - tx) * (1 - ty)); add((ya + xb) * 4, tx * (1 - ty));
        add((yb + xa) * 4, (1 - tx) * ty); add((yb + xb) * 4, tx * ty);
        if (a > 0) mixInto(o, i, r / a / 255, g / a / 255, b / a / 255, (a / 255) * op, fn);
        continue;
      }
      const m = cov(u, v), A = lerp(ba, fa, m);
      if (A <= 0) continue;
      const k1 = (1 - m) * ba, k2 = m * fa;
      mixInto(o, i, (bg[0] * k1 + fg[0] * k2) / A / 255, (bg[1] * k1 + fg[1] * k2) / A / 255, (bg[2] * k1 + fg[2] * k2) / A / 255, A * op, fn);
    }
  }
  return out;
}

/* ---------- outline (a stroke along the edge of the opaque shape)
   Uses exact distances to the shape, so wide outlines stay round. Pixels with alpha at or above the
   threshold count as the shape. Outside: the stroke goes behind the image. Inside: on top, clipped to
   it; beyond the image's border counts as outside, so opaque textures get a frame. Center: half each. */
function fxOutline(img, p) {
  const { w, h, d } = img, n = w * h, thr = clamp(Math.round((p.thr / 100) * 255), 1, 255);
  const inside = new Uint8Array(n);
  for (let j = 0; j < n; j++) inside[j] = d[j * 4 + 3] >= thr ? 1 : 0;
  let dOut = null, dIn = null;
  const pw = w + 2;
  if (p.pos !== 'inside') dOut = edt(inside, w, h);
  if (p.pos !== 'outside') {
    const outside = new Uint8Array(pw * (h + 2)).fill(1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) outside[(y + 1) * pw + x + 1] = inside[y * w + x] ? 0 : 1;
    dIn = edt(outside, pw, h + 2);
  }
  const size = p.pos === 'center' ? p.size / 2 : p.size, [cr, cg, cb] = hexToRgb(p.color), ca = p.alpha / 100;
  const out = newImg(w, h), o = out.d;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4, ia = d[i + 3] / 255;
      let cov;
      if (inside[j]) cov = p.pos === 'outside' ? 1 : clamp01(size + 1 - Math.sqrt(dIn[(y + 1) * pw + x + 1]));
      else cov = p.pos === 'inside' ? 1 : clamp01(size + 1 - Math.sqrt(dOut[j]));
      const sa = cov * ca;
      if (p.pos === 'inside') {   // stroke over the image, clipped to it
        o[i] = lerp(d[i], cr, sa); o[i + 1] = lerp(d[i + 1], cg, sa); o[i + 2] = lerp(d[i + 2], cb, sa); o[i + 3] = d[i + 3];
        continue;
      }
      // outside: image over stroke. center: stroke over image.
      const imgOnTop = p.pos === 'outside', top = imgOnTop ? ia : sa, bot = (imgOnTop ? sa : ia) * (1 - top);
      const A = top + bot;
      if (A <= 0) { o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = 0; continue; }
      const kImg = (imgOnTop ? top : bot) / A, kStroke = 1 - kImg;
      o[i] = d[i] * kImg + cr * kStroke; o[i + 1] = d[i + 1] * kImg + cg * kStroke; o[i + 2] = d[i + 2] * kImg + cb * kStroke;
      o[i + 3] = A * 255;
    }
  }
  return out;
}
