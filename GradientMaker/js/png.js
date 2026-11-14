'use strict';
// PNG encoder for 8 and 16 bits per channel. Written here rather than using canvas.toBlob, which
// only does 8 bits and premultiplies alpha (losing color in faint pixels). Exported PNGs carry the
// gradient settings in a text chunk, which readPngSettings() finds again when the file is opened.

const PNG_KEY = 'gradient-maker';
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
// Gradients compress far better filtered: neighbouring pixels differ by small, repeating amounts.
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
const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 255);

// data: RGBA, Uint8ClampedArray (depth 8) or Uint16Array (depth 16). alpha: false writes RGB only.
async function encodePng(w, h, data, depth, alpha, text) {
  const ch = alpha ? 4 : 3, bytes = depth / 8, bpp = ch * bytes, rowLen = w * bpp, raw = new Uint8Array(rowLen * h);
  let o = 0;
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    for (let k = 0; k < ch; k++) {
      const v = data[i + k];
      if (bytes === 2) { raw[o++] = v >>> 8; raw[o++] = v & 255; } else raw[o++] = v;
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = depth; ihdr[9] = alpha ? 6 : 2;   // 6 = RGBA, 2 = RGB; compression, filter, interlace stay 0
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', ihdr)];
  if (text) {
    // tEXt is Latin-1, so anything outside ASCII is escaped (valid JSON either way).
    const safe = text.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    parts.push(pngChunk('tEXt', ascii(PNG_KEY + '\0' + safe)));
  }
  parts.push(pngChunk('IDAT', await zlib(filterRows(raw, rowLen, h, bpp))), pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

function hasAlpha(data, depth) {
  const max = depth === 16 ? 65535 : 255;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== max) return true;
  return false;
}

// The settings text an exported PNG carries, or null.
function readPngSettings(buf) {
  const b = new Uint8Array(buf), sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  while (o + 12 <= b.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (o + 12 + len > b.length) break;
    if (type === 'tEXt') {
      const d = b.subarray(o + 8, o + 8 + len), z = d.indexOf(0);
      if (z > 0 && new TextDecoder('latin1').decode(d.subarray(0, z)) === PNG_KEY) return new TextDecoder('latin1').decode(d.subarray(z + 1));
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return null;
}
