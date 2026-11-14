'use strict';
// Export encoders. PNG, BMP and TGA are written here byte by byte from the straight RGBA pixels, so
// colors under soft or zero alpha come out exactly (a canvas premultiplies alpha and loses them).
// JPEG and WebP use the browser's own encoder through a canvas.

const FORMATS = {
  png: { ext: 'png', label: 'PNG', alpha: true },
  jpeg: { ext: 'jpg', label: 'JPEG', alpha: false, mime: 'image/jpeg' },
  webp: { ext: 'webp', label: 'WebP', alpha: true, mime: 'image/webp' },
  bmp: { ext: 'bmp', label: 'BMP', alpha: true },
  tga: { ext: 'tga', label: 'TGA', alpha: true },
};

// How the format will treat transparency: 'keep', 'drop' (opaque, colors as they are) or 'matte'
// (blended over a background color). JPEG has no alpha, so 'keep' becomes 'matte' there.
const alphaModeFor = (ex) => (!FORMATS[ex.fmt].alpha && ex.alpha === 'keep' ? 'matte' : ex.alpha);

function flattenAlpha(img, mode, matte) {
  const out = newImg(img.w, img.h), s = img.d, d = out.d;
  if (mode === 'drop') {
    d.set(s);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    return out;
  }
  const [mr, mg, mb] = hexToRgb(matte);
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3] / 255, k = 1 - a;
    d[i] = s[i] * a + mr * k; d[i + 1] = s[i + 1] * a + mg * k; d[i + 2] = s[i + 2] * a + mb * k; d[i + 3] = 255;
  }
  return out;
}

async function encodeImage(img, ex) {
  const mode = alphaModeFor(ex), alpha = mode === 'keep', src = alpha ? img : flattenAlpha(img, mode, ex.matte);
  switch (ex.fmt) {
    case 'jpeg': case 'webp': return encodeCanvas(src, FORMATS[ex.fmt].mime, ex.quality / 100);
    case 'bmp': return encodeBmp(src, alpha);
    case 'tga': return encodeTga(src, alpha, ex.rle);
    default: return encodePng(src, alpha);
  }
}

/* ---------- JPEG / WebP through the browser */
async function encodeCanvas(img, mime, quality) {
  const blob = await new Promise((res) => imgToCanvas(img).toBlob(res, mime, quality));
  if (!blob) throw new Error('the browser could not encode the image');
  // Browsers that can't write a format quietly hand back a PNG instead.
  if (blob.type !== mime) throw new Error(`this browser cannot save ${mime === 'image/webp' ? 'WebP' : mime}; pick another format`);
  return blob;
}

/* ---------- PNG, 8 bits per channel */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zlib stream of the bytes. CompressionStream is built into current browsers; without it the data
// goes into uncompressed ("stored") deflate blocks, which every PNG reader accepts.
async function zlib(bytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch { /* fall through */ }
  }
  const n = bytes.length, blocks = Math.max(1, Math.ceil(n / 65535)), out = new Uint8Array(2 + n + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535, len = Math.min(65535, n - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >>> 8; out[o++] = ~len & 255; out[o++] = (~len >>> 8) & 255;
    out.set(bytes.subarray(start, start + len), o); o += len;
  }
  let s1 = 1, s2 = 0;
  for (let i = 0; i < n; i += 4096) {
    const end = Math.min(n, i + 4096);
    for (let j = i; j < end; j++) { s1 += bytes[j]; s2 += s1; }
    s1 %= 65521; s2 %= 65521;
  }
  out[o++] = s2 >>> 8; out[o++] = s2 & 255; out[o++] = s1 >>> 8; out[o++] = s1 & 255;
  return out;
}

// Per-row PNG filtering, choosing the filter with the smallest sum of bytes (the usual heuristic).
function filterRows(raw, rowLen, h, bpp) {
  const out = new Uint8Array((rowLen + 1) * h), tries = Array.from({ length: 5 }, () => new Uint8Array(rowLen));
  const [t0, t1, t2, t3, t4] = tries, sums = new Float64Array(5);
  for (let y = 0; y < h; y++) {
    const r = y * rowLen, up = r - rowLen;
    sums.fill(0);
    for (let i = 0; i < rowLen; i++) {
      // a: left, b: above, c: above-left, as the PNG spec names them
      const x = raw[r + i], a = i >= bpp ? raw[r + i - bpp] : 0, b = y ? raw[up + i] : 0, c = y && i >= bpp ? raw[up + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const v0 = x, v1 = (x - a) & 255, v2 = (x - b) & 255, v3 = (x - ((a + b) >> 1)) & 255;
      const v4 = (x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      t0[i] = v0; t1[i] = v1; t2[i] = v2; t3[i] = v3; t4[i] = v4;
      sums[0] += v0 < 128 ? v0 : 256 - v0; sums[1] += v1 < 128 ? v1 : 256 - v1; sums[2] += v2 < 128 ? v2 : 256 - v2;
      sums[3] += v3 < 128 ? v3 : 256 - v3; sums[4] += v4 < 128 ? v4 : 256 - v4;
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (sums[f] < sums[best]) best = f;
    const o = y * (rowLen + 1);
    out[o] = best;
    out.set(tries[best], o + 1);
  }
  return out;
}

function pngChunk(type, payload) {
  const out = new Uint8Array(12 + payload.length), dv = new DataView(out.buffer);
  dv.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  dv.setUint32(8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}

async function encodePng(img, alpha) {
  const { w, h, d } = img, ch = alpha ? 4 : 3, rowLen = w * ch, raw = new Uint8Array(rowLen * h);
  if (alpha) raw.set(d);
  else for (let i = 0, o = 0; i < d.length; i += 4) { raw[o++] = d[i]; raw[o++] = d[i + 1]; raw[o++] = d[i + 2]; }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;   // 6 = RGBA, 2 = RGB; compression, filter, interlace stay 0
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', await zlib(filterRows(raw, rowLen, h, ch))), pngChunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' });
}

/* ---------- BMP: 24-bit, or 32-bit with an alpha mask (BITMAPV4HEADER), rows bottom to top */
function encodeBmp(img, alpha) {
  const { w, h, d } = img, row = alpha ? w * 4 : (w * 3 + 3) & ~3, hdr = alpha ? 108 : 40, off = 14 + hdr, size = off + row * h;
  const buf = new ArrayBuffer(size), b = new Uint8Array(buf), dv = new DataView(buf);
  b[0] = 0x42; b[1] = 0x4d;                       // 'BM'
  dv.setUint32(2, size, true); dv.setUint32(10, off, true);
  dv.setUint32(14, hdr, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, alpha ? 32 : 24, true);
  dv.setUint32(30, alpha ? 3 : 0, true);          // 3 = BI_BITFIELDS (masks below), 0 = BI_RGB
  dv.setUint32(34, row * h, true);
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);   // 72 dpi
  if (alpha) {
    dv.setUint32(54, 0x00ff0000, true); dv.setUint32(58, 0x0000ff00, true);
    dv.setUint32(62, 0x000000ff, true); dv.setUint32(66, 0xff000000, true);
    dv.setUint32(70, 0x73524742, true);           // LCS_sRGB
  }
  for (let y = 0; y < h; y++) {
    let o = off + (h - 1 - y) * row;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      b[o++] = d[i + 2]; b[o++] = d[i + 1]; b[o++] = d[i];
      if (alpha) b[o++] = d[i + 3];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/* ---------- TGA: 24 or 32-bit true color, top-left origin, optional RLE, with the TGA 2.0 footer */
function encodeTga(img, alpha, rle) {
  const { w, h, d } = img, px = alpha ? 4 : 3, n = w * h;
  const b = new Uint8Array(18 + n * (rle ? px + 1 : px) + 26);
  b[2] = rle ? 10 : 2;
  b[12] = w & 255; b[13] = w >> 8; b[14] = h & 255; b[15] = h >> 8;
  b[16] = px * 8;
  b[17] = (alpha ? 8 : 0) | 0x20;   // alpha bits; 0x20 = rows stored top to bottom
  let o = 18;
  const put = (i) => { b[o++] = d[i + 2]; b[o++] = d[i + 1]; b[o++] = d[i]; if (alpha) b[o++] = d[i + 3]; };
  const same = (i, j) => d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2] && (!alpha || d[i + 3] === d[j + 3]);
  for (let y = 0; y < h; y++) {
    const r0 = y * w * 4;
    if (!rle) { for (let x = 0; x < w; x++) put(r0 + x * 4); continue; }
    // Packets stay within a row, as the format recommends. Runs of 2+ equal pixels become one
    // run packet; everything else goes into raw packets of up to 128 pixels.
    let x = 0;
    while (x < w) {
      let run = 1;
      while (x + run < w && run < 128 && same(r0 + x * 4, r0 + (x + run) * 4)) run++;
      if (run > 1) { b[o++] = 0x80 | (run - 1); put(r0 + x * 4); x += run; continue; }
      const start = x;
      while (x < w && x - start < 128 && !(x + 1 < w && same(r0 + x * 4, r0 + (x + 1) * 4))) x++;
      b[o++] = x - start - 1;
      for (let k = start; k < x; k++) put(r0 + k * 4);
    }
  }
  o += 8;   // extension and developer area offsets: none
  for (const c of 'TRUEVISION-XFILE.') b[o++] = c.charCodeAt(0);
  b[o++] = 0;
  return new Blob([b.subarray(0, o)], { type: 'image/x-tga' });
}
