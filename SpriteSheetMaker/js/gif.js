'use strict';
// GIF89a encoder: shared palette (exact, or median cut above 256 colors), LZW, looping.

function encodeGif(frames, w, h, delay, transparent, bg) {
  const N = w * h, maxColors = transparent ? 255 : 256, pix = [], masks = [], hist = new Map();
  for (const f of frames) {
    const d = f.data, out = new Uint32Array(N), m = transparent ? new Uint8Array(N) : null;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const a = d[i + 3];
      if (transparent && a < 128) { m[p] = 1; continue; }
      const al = a / 255;
      const r = Math.round(d[i] * al + bg[0] * (1 - al)), g = Math.round(d[i + 1] * al + bg[1] * (1 - al)), b = Math.round(d[i + 2] * al + bg[2] * (1 - al));
      const key = (r << 16) | (g << 8) | b;
      out[p] = key;
      hist.set(key, (hist.get(key) || 0) + 1);
    }
    pix.push(out); masks.push(m);
  }
  const base = transparent ? 1 : 0;
  let palette, lookup;
  if (hist.size <= maxColors) {
    const keys = [...hist.keys()], map = new Map();
    keys.forEach((k, i) => map.set(k, i + base));
    palette = keys.map((k) => [k >> 16 & 255, k >> 8 & 255, k & 255]);
    lookup = (k) => map.get(k);
  } else {
    const buckets = new Map();
    for (const [k, n] of hist) {
      const bk = ((k >> 19 & 31) << 10) | ((k >> 11 & 31) << 5) | (k >> 3 & 31);
      let e = buckets.get(bk); if (!e) buckets.set(bk, (e = [0, 0, 0, 0]));
      e[0] += (k >> 16 & 255) * n; e[1] += (k >> 8 & 255) * n; e[2] += (k & 255) * n; e[3] += n;
    }
    palette = medianCut([...buckets.values()].map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]]), maxColors);
    const cache = new Map();
    lookup = (k) => { let v = cache.get(k); if (v === undefined) { v = nearest(palette, k) + base; cache.set(k, v); } return v; };
  }
  const total = palette.length + base;
  let bits = 1; while ((1 << bits) < total) bits++;
  const size = 1 << bits, minCode = Math.max(2, bits);

  const W = new Bytes();
  W.str('GIF89a'); W.u16(w); W.u16(h);
  W.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); W.byte(0); W.byte(0);
  for (let i = 0; i < size; i++) {
    const c = transparent ? (i === 0 ? bg : palette[i - 1]) : palette[i];
    W.byte(c ? c[0] : 0); W.byte(c ? c[1] : 0); W.byte(c ? c[2] : 0);
  }
  W.byte(0x21); W.byte(0xFF); W.byte(11); W.str('NETSCAPE2.0'); W.byte(3); W.byte(1); W.u16(0); W.byte(0);
  const idx = new Uint8Array(N);
  for (let f = 0; f < frames.length; f++) {
    W.byte(0x21); W.byte(0xF9); W.byte(4); W.byte((2 << 2) | (transparent ? 1 : 0)); W.u16(delay); W.byte(0); W.byte(0);
    W.byte(0x2C); W.u16(0); W.u16(0); W.u16(w); W.u16(h); W.byte(0);
    const px = pix[f], m = masks[f];
    for (let p = 0; p < N; p++) idx[p] = m && m[p] ? 0 : lookup(px[p]);
    lzw(W, idx, minCode);
  }
  W.byte(0x3B);
  return W.out();
}
function medianCut(colors, k) {
  const boxes = [colors];
  while (boxes.length < k) {
    let bi = -1, best = 0, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const e of b) { if (e[c] < lo) lo = e[c]; if (e[c] > hi) hi = e[c]; }
        if (hi - lo > best) { best = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x[bc] - y[bc]);
    let tot = 0; for (const e of b) tot += e[3];
    let accW = 0, m = 0;
    for (; m < b.length - 1; m++) { accW += b[m][3]; if (accW >= tot / 2) break; }
    boxes.splice(bi, 1, b.slice(0, m + 1), b.slice(m + 1));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, t = 0;
    for (const e of b) { r += e[0] * e[3]; g += e[1] * e[3]; bl += e[2] * e[3]; t += e[3]; }
    return [Math.round(r / t), Math.round(g / t), Math.round(bl / t)];
  });
}
function nearest(pal, k) {
  const r = k >> 16 & 255, g = k >> 8 & 255, b = k & 255;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i], d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
class Bytes {
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  byte(v) { if (this.n >= this.a.length) { const b = new Uint8Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  out() { return this.a.slice(0, this.n); }
}
function lzw(W, idx, minCode) {
  W.byte(minCode);
  const clear = 1 << minCode, eoi = clear + 1, blk = new Uint8Array(255);
  let size = minCode + 1, next = eoi + 1, dict = new Map(), cur = 0, bits = 0, bl = 0;
  const putByte = (v) => { blk[bl++] = v; if (bl === 255) { W.byte(255); for (let i = 0; i < 255; i++) W.byte(blk[i]); bl = 0; } };
  const emit = (c) => { cur |= c << bits; bits += size; while (bits >= 8) { putByte(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let pre = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (pre << 8) | k, f = dict.get(key);
    if (f !== undefined) { pre = f; continue; }
    emit(pre);
    if (next === 4096) { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    else { if (next >= (1 << size)) size++; dict.set(key, next++); }
    pre = k;
  }
  emit(pre); emit(eoi);
  if (bits > 0) putByte(cur & 255);
  if (bl) { W.byte(bl); for (let i = 0; i < bl; i++) W.byte(blk[i]); }
  W.byte(0);
}
