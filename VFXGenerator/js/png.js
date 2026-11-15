'use strict';
// PNG writing and reading. canvas.toBlob would only give 8-bit images with premultiplied alpha,
// losing the faint color at the edges of soft glows, so the file is put together here.
// Exported files carry the document in a text chunk; readPngText() finds it again.

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

// zlib-wrapped deflate. CompressionStream('deflate') produces exactly that; without it the data
// goes into uncompressed deflate blocks, which every PNG reader still accepts.
async function zlibCompress(bytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall back below */ }
  }
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535)), out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2, a = 1, b = 0;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, len = Math.min(65535, bytes.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >> 8; out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(bytes.subarray(start, start + len), o);
    o += len;
  }
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  out[o++] = adler >>> 24; out[o++] = (adler >>> 16) & 255; out[o++] = (adler >>> 8) & 255; out[o++] = adler & 255;
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Raw rows -> filtered rows. Each row gets the filter whose output is closest to zero, the usual
// rule of thumb for what deflate packs smallest.
function filterRows(raw, rowBytes, h, bpp) {
  const out = new Uint8Array((rowBytes + 1) * h), cand = new Uint8Array(rowBytes);
  for (let y = 0; y < h; y++) {
    const cur = y * rowBytes, prev = cur - rowBytes, dst = y * (rowBytes + 1);
    let best = -1, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < rowBytes; i++) {
        const x = raw[cur + i], left = i >= bpp ? raw[cur + i - bpp] : 0;
        const up = y > 0 ? raw[prev + i] : 0, ul = y > 0 && i >= bpp ? raw[prev + i - bpp] : 0;
        const v = f === 0 ? x : f === 1 ? x - left : f === 2 ? x - up : f === 3 ? x - ((left + up) >> 1) : x - paeth(left, up, ul);
        cand[i] = v;
        const s = cand[i];
        sum += s < 128 ? s : 256 - s;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum; best = f;
        out[dst] = f;
        out.set(cand, dst + 1);
      }
    }
    if (best < 0) { out[dst] = 0; out.set(raw.subarray(cur, cur + rowBytes), dst + 1); }
  }
  return out;
}

// RGBA pixels (Uint8 for 8-bit, Uint16 for 16-bit) -> PNG Blob. text: { keyword: value } chunks.
async function encodePng(w, h, px, depth, text = {}) {
  const bpp = depth === 16 ? 8 : 4, rowBytes = w * bpp;
  let raw;
  if (depth === 16) {
    raw = new Uint8Array(w * h * 8);
    for (let i = 0, o = 0; i < px.length; i++, o += 2) { raw[o] = px[i] >>> 8; raw[o + 1] = px[i] & 255; }
  } else raw = px instanceof Uint8Array ? px : new Uint8Array(px.buffer, px.byteOffset, px.length);
  const idat = await zlibCompress(filterRows(raw, rowBytes, h, bpp));

  const chunks = [];
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    dv.setUint32(8 + data.length, crc32(b, 4, 8 + data.length));
    chunks.push(b);
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = depth; ihdr[9] = 6;   // RGBA; compression, filter and interlace stay 0
  chunk('IHDR', ihdr);
  for (const key in text) {
    // tEXt is Latin-1; anything else in the value is written as \u escapes, which JSON reads back.
    const s = `${key}\0${String(text[key]).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}`;
    chunk('tEXt', Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks], { type: 'image/png' });
}

// The tEXt chunks of a PNG as { keyword: text }, or null when the bytes are not a PNG.
function readPngText(buffer) {
  const b = new Uint8Array(buffer), sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = {};
  for (let o = 8; o + 12 <= b.length;) {
    const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (o + 12 + len > b.length) break;
    if (type === 'tEXt') {
      const data = b.subarray(o + 8, o + 8 + len), nul = data.indexOf(0);
      if (nul > 0) {
        let key = '', val = '';
        for (let i = 0; i < nul; i++) key += String.fromCharCode(data[i]);
        for (let i = nul + 1; i < data.length; i++) val += String.fromCharCode(data[i]);
        out[key] = val;
      }
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return out;
}
