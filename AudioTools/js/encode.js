'use strict';
// Saving: WAV, FLAC, MP3 (lamejs, vendor/lame.min.js), Opus in Ogg (the browser's WebCodecs encoder), and a
// small ZIP writer for exporting every region at once. Each encoder takes ({ sr, ch }, options, job).

const FORMATS = {
  wav: { ext: 'wav', label: 'WAV', mime: 'audio/wav' },
  flac: { ext: 'flac', label: 'FLAC', mime: 'audio/flac' },
  mp3: { ext: 'mp3', label: 'MP3', mime: 'audio/mpeg' },
  opus: { ext: 'ogg', label: 'Opus', mime: 'audio/ogg' },
};
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
let opusOk = null;   // null until checked, then true / false
async function checkOpus() {
  if (opusOk !== null) return opusOk;
  try {
    opusOk = typeof AudioEncoder === 'function' &&
      (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;
  } catch { opusOk = false; }
  return opusOk;
}

// The sample rate a format will actually write for a wanted rate.
function outRate(fmt, want) {
  if (fmt === 'opus') return 48000;
  if (fmt === 'mp3') return MP3_RATES.reduce((best, r) => (Math.abs(r - want) < Math.abs(best - want) ? r : best), 44100);
  if (fmt === 'flac') return Math.min(want, 655350);
  return want;
}

/* ---------- WAV */
function encodeWav({ sr, ch }, o) {
  const C = ch.length, n = ch[0].length, bits = Number(o.bits) || 16, float = bits === 32, bps = bits / 8;
  const cues = (o.markers || []).filter((m) => m > 0 && m < n);
  const cueBytes = cues.length ? 12 + 24 * cues.length : 0, data = n * C * bps;
  const buf = new ArrayBuffer(44 + data + cueBytes + (data & 1)), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const w4 = (o2, s) => { for (let i = 0; i < 4; i++) u8[o2 + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, buf.byteLength - 8, true); w4(8, 'WAVE');
  w4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, float ? 3 : 1, true); dv.setUint16(22, C, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * C * bps, true); dv.setUint16(32, C * bps, true); dv.setUint16(34, bits, true);
  w4(36, 'data'); dv.setUint32(40, data, true);
  const r = rng(77);
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      const v = ch[c][i];
      if (float) { dv.setFloat32(p, v, true); p += 4; continue; }
      if (bits === 16) {
        const d = o.dither ? (r() - r()) : 0;   // TPDF dither, ±1 LSB
        dv.setInt16(p, clamp(Math.round(v * 32767 + d), -32768, 32767), true); p += 2;
      } else {
        const s = clamp(Math.round(v * 8388607), -8388608, 8388607);
        u8[p] = s & 255; u8[p + 1] = (s >> 8) & 255; u8[p + 2] = (s >> 16) & 255; p += 3;
      }
    }
  }
  if (data & 1) p++;
  if (cues.length) {   // split markers as cue points, which many audio tools and game audio middleware read
    w4(p, 'cue '); dv.setUint32(p + 4, cueBytes - 8, true); dv.setUint32(p + 8, cues.length, true);
    cues.forEach((m, i) => {
      const q = p + 12 + i * 24;
      dv.setUint32(q, i + 1, true); dv.setUint32(q + 4, m, true); w4(q + 8, 'data');
      dv.setUint32(q + 12, 0, true); dv.setUint32(q + 16, 0, true); dv.setUint32(q + 20, m, true);
    });
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ---------- FLAC: fixed predictors (order 0–4) with Rice-coded residuals, partitioned. Lossless. */
class BitWriter {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
  grow(need) { if (this.pos + need > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + need + 1024)); b.set(this.buf); this.buf = b; } }
  bits(v, k) {   // writes the low k bits of v (k ≤ 32), most significant first
    while (k > 0) {
      const take = Math.min(k, 24 - this.n);
      const part = Math.floor(v / Math.pow(2, k - take)) & ((1 << take) - 1);
      this.acc = (this.acc << take) | part; this.n += take; k -= take;
      while (this.n >= 8) { this.grow(1); this.n -= 8; this.buf[this.pos++] = (this.acc >> this.n) & 255; }
      this.acc &= (1 << this.n) - 1;
    }
  }
  unary(q) { while (q >= 24) { this.bits(0, 24); q -= 24; } this.bits(1, q + 1); }
  align() { if (this.n) this.bits(0, 8 - this.n); }
}
const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; t[i] = c; } return t; })();
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; } return t; })();
function riceBits(res, from, to, k) {
  let b = 0;
  for (let i = from; i < to; i++) { const v = res[i], u = v >= 0 ? v * 2 : -v * 2 - 1; b += Math.floor(u / (1 << k)) + 1 + k; }
  return b;
}
function bestRice(res, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) { const v = res[i]; sum += v >= 0 ? v * 2 : -v * 2 - 1; }
  const mean = sum / Math.max(1, to - from);
  const k0 = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
  let best = 0, bb = Infinity;
  for (let k = Math.max(0, k0 - 1); k <= Math.min(14, k0 + 1); k++) { const b = riceBits(res, from, to, k); if (b < bb) { bb = b; best = k; } }
  return [best, bb];
}
function flacSubframe(bw, s, bits) {
  const n = s.length;
  let constant = true;
  for (let i = 1; i < n; i++) if (s[i] !== s[0]) { constant = false; break; }
  if (constant) { bw.bits(0, 8); bw.bits(s[0] & ((1 << bits) - 1), bits); return; }
  // Pick the fixed predictor order with the smallest residual.
  const res = [new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n)];
  let bestO = 0, bestSum = Infinity;
  for (let o = 0; o <= 4 && o < n; o++) {
    const r = res[o];
    let sum = 0;
    for (let i = o; i < n; i++) {
      const v = o === 0 ? s[i] : o === 1 ? s[i] - s[i - 1] : o === 2 ? s[i] - 2 * s[i - 1] + s[i - 2]
        : o === 3 ? s[i] - 3 * s[i - 1] + 3 * s[i - 2] - s[i - 3] : s[i] - 4 * s[i - 1] + 6 * s[i - 2] - 4 * s[i - 3] + s[i - 4];
      r[i] = v; sum += Math.abs(v);
    }
    if (sum < bestSum) { bestSum = sum; bestO = o; }
  }
  const r = res[bestO];
  // Partition order: try 0..6 (each partition gets its own Rice parameter).
  let bestP = 0, bestBits = Infinity, bestKs = null;
  for (let po = 0; po <= 6; po++) {
    if (n % (1 << po) || (n >> po) <= bestO) break;
    const ps = n >> po, ks = [];
    let total = 0;
    for (let pi = 0; pi < (1 << po); pi++) {
      const from = pi === 0 ? bestO : pi * ps, [k, b] = bestRice(r, from, (pi + 1) * ps);
      ks.push(k); total += b + 4;
    }
    if (total < bestBits) { bestBits = total; bestP = po; bestKs = ks; }
  }
  if (bestBits + bestO * bits > n * bits) {   // incompressible (noise): store verbatim
    bw.bits(0b00000010, 8);
    for (let i = 0; i < n; i++) bw.bits(s[i] & ((1 << bits) - 1), bits);
    return;
  }
  bw.bits((0b001000 | bestO) << 1, 8);         // FIXED subframe, no wasted bits
  for (let i = 0; i < bestO; i++) bw.bits(s[i] & ((1 << bits) - 1), bits);
  bw.bits(0, 2); bw.bits(bestP, 4);            // Rice coding, 4-bit parameters
  const ps = n >> bestP;
  for (let pi = 0; pi < (1 << bestP); pi++) {
    const k = bestKs[pi], from = pi === 0 ? bestO : pi * ps, to = (pi + 1) * ps;
    bw.bits(k, 4);
    for (let i = from; i < to; i++) {
      const v = r[i], u = v >= 0 ? v * 2 : -v * 2 - 1;
      bw.unary(Math.floor(u / (1 << k)));
      if (k) bw.bits(u & ((1 << k) - 1), k);
    }
  }
}
async function encodeFlac({ sr, ch }, o, job) {
  const bits = Number(o.bits) === 24 ? 24 : 16, C = ch.length, n = ch[0].length, BS = 4096, scale = bits === 24 ? 8388607 : 32767;
  const r = rng(91), lo = -scale - 1;
  const ints = ch.map((d) => {
    const q = new Int32Array(n);
    for (let i = 0; i < n; i++) q[i] = clamp(Math.round(d[i] * scale + (bits === 16 && o.dither ? r() - r() : 0)), lo, scale);
    return q;
  });
  const head = new BitWriter(64);
  head.bits(0x664c6143, 32);                   // "fLaC"
  head.bits(0x80, 8); head.bits(34, 24);       // last metadata block: STREAMINFO, 34 bytes
  head.bits(BS, 16); head.bits(BS, 16); head.bits(0, 24); head.bits(0, 24);
  head.bits(sr, 20); head.bits(C - 1, 3); head.bits(bits - 1, 5);
  head.bits(Math.floor(n / 4294967296), 4); head.bits(n >>> 0, 32);
  for (let i = 0; i < 4; i++) head.bits(0, 32); // MD5 left as "unknown"
  const parts = [head.buf.slice(0, head.pos)];
  for (let f = 0, s0 = 0; s0 < n; f++, s0 += BS) {
    const bs = Math.min(BS, n - s0), bw = new BitWriter(bs * C * (bits / 8) + 64);
    bw.bits(0xfff8, 16);
    const bsCode = bs === 4096 ? 12 : bs <= 256 ? 6 : 7;
    bw.bits(bsCode, 4); bw.bits(0, 4);          // block size code; sample rate from STREAMINFO
    bw.bits(C - 1, 4); bw.bits(bits === 24 ? 6 : 4, 3); bw.bits(0, 1);
    // Frame number, UTF-8 style.
    if (f < 0x80) bw.bits(f, 8);
    else if (f < 0x800) { bw.bits(0xc0 | (f >> 6), 8); bw.bits(0x80 | (f & 63), 8); }
    else if (f < 0x10000) { bw.bits(0xe0 | (f >> 12), 8); bw.bits(0x80 | ((f >> 6) & 63), 8); bw.bits(0x80 | (f & 63), 8); }
    else { bw.bits(0xf0 | (f >> 18), 8); bw.bits(0x80 | ((f >> 12) & 63), 8); bw.bits(0x80 | ((f >> 6) & 63), 8); bw.bits(0x80 | (f & 63), 8); }
    if (bsCode === 6) bw.bits(bs - 1, 8); else if (bsCode === 7) bw.bits(bs - 1, 16);
    let c8 = 0;
    for (let i = 0; i < bw.pos; i++) c8 = CRC8[c8 ^ bw.buf[i]];
    bw.bits(c8, 8);
    for (let c = 0; c < C; c++) flacSubframe(bw, ints[c].subarray(s0, s0 + bs), bits);
    bw.align();
    let c16 = 0;
    for (let i = 0; i < bw.pos; i++) c16 = ((c16 << 8) & 0xffff) ^ CRC16[(c16 >> 8) ^ bw.buf[i]];
    bw.bits(c16, 16);
    parts.push(bw.buf.slice(0, bw.pos));
    if ((f & 15) === 0) await job.tick(s0 / n);
  }
  return new Blob(parts, { type: 'audio/flac' });
}

/* ---------- MP3 through lamejs */
async function encodeMp3({ sr, ch }, o, job) {
  if (typeof lamejs !== 'function' && typeof lamejs !== 'object') throw new Error('the MP3 encoder did not load');
  const C = Math.min(2, ch.length), n = ch[0].length;
  let kbps = Number(o.kbps) || 192;
  if (sr < 32000) kbps = Math.min(kbps, 160);
  if (sr <= 12000) kbps = Math.min(kbps, 64);
  const enc = new lamejs.Mp3Encoder(C, sr, kbps), parts = [], F = 1152 * 8;
  const toI16 = (d, a, b) => { const o2 = new Int16Array(b - a); for (let i = a; i < b; i++) o2[i - a] = clamp(Math.round(d[i] * 32767), -32768, 32767); return o2; };
  for (let s = 0; s < n; s += F) {
    const e = Math.min(n, s + F), L = toI16(ch[0], s, e);
    const out = C === 2 ? enc.encodeBuffer(L, toI16(ch[1], s, e)) : enc.encodeBuffer(L);
    if (out.length) parts.push(new Uint8Array(out));
    await job.tick(s / n);
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}

/* ---------- Opus in Ogg: WebCodecs makes the Opus packets, this wraps them in Ogg pages (RFC 7845). */
const CRC_OGG = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; t[i] = c >>> 0; } return t; })();
function oggPage(serial, seq, granule, flags, packets) {
  const segs = [];
  for (const p of packets) { let L = p.length; while (L >= 255) { segs.push(255); L -= 255; } segs.push(L); }
  const body = packets.reduce((s, p) => s + p.length, 0), page = new Uint8Array(27 + segs.length + body), dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); page[4] = 0; page[5] = flags;
  dv.setUint32(6, granule >>> 0, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
  dv.setUint32(14, serial, true); dv.setUint32(18, seq, true); page[26] = segs.length;
  page.set(segs, 27);
  let o = 27 + segs.length;
  for (const p of packets) { page.set(p, o); o += p.length; }
  let crc = 0;
  for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ CRC_OGG[((crc >>> 24) ^ page[i]) & 255]) >>> 0;
  dv.setUint32(22, crc, true);
  return page;
}
async function encodeOpus({ sr, ch }, o, job) {
  if (!(await checkOpus())) throw new Error('this browser has no Opus encoder');
  if (sr !== 48000) throw new Error('Opus needs 48 kHz audio');
  const C = Math.min(2, ch.length), n = ch[0].length, packets = [];
  let failed = null, preSkip = 312;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); packets.push({ data: b, dur: Math.round((chunk.duration || 20000) * 48 / 1000) });
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && d.byteLength >= 12) { const v = new DataView(d instanceof ArrayBuffer ? d : d.buffer, d.byteOffset || 0); preSkip = v.getUint16(10, true); }
    },
    error: (e) => { failed = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: C, bitrate: (Number(o.kbps) || 128) * 1000 });
  const F = 48000;
  for (let s = 0; s < n; s += F) {
    const e = Math.min(n, s + F), m = e - s, plane = new Float32Array(m * C);
    for (let c = 0; c < C; c++) plane.set(ch[c].subarray(s, e), c * m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: m, numberOfChannels: C, timestamp: Math.round(s * 1e6 / 48000), data: plane });
    enc.encode(ad); ad.close();
    if (failed) throw failed;
    await job.tick(s / n * 0.9);
  }
  await enc.flush(); enc.close();
  if (failed) throw failed;
  const serial = (Math.random() * 4294967295) >>> 0, pages = [];
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); head[8] = 1; head[9] = C;
  hv.setUint16(10, preSkip, true); hv.setUint32(12, 48000, true); hv.setUint16(16, 0, true); head[18] = 0;
  const vendor = new TextEncoder().encode('Mini-Toolkit Audio Tools'), tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);
  let seq = 0;
  pages.push(oggPage(serial, seq++, 0, 2, [head]));
  pages.push(oggPage(serial, seq++, 0, 0, [tags]));
  // A page holds at most 255 lacing segments; the last page's granule cuts off the encoder's padding.
  let granule = 0, group = [], segs = 0;
  const end = preSkip + n;
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i], ps = Math.floor(p.data.length / 255) + 1;
    if (group.length && (segs + ps > 255 || group.length >= 50)) {
      pages.push(oggPage(serial, seq++, granule, 0, group));
      group = []; segs = 0;
    }
    group.push(p.data); segs += ps; granule += p.dur;
  }
  pages.push(oggPage(serial, seq++, Math.min(granule, end), 4, group));
  return new Blob(pages, { type: 'audio/ogg' });
}

/* ---------- ZIP (stored, no compression: audio barely compresses anyway) */
const CRC32 = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
async function makeZip(files) {   // files: [{ name, blob }]
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name);
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC32[(crc ^ data[i]) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, off, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch);
    off += lh.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0), eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}

/* ---------- export pipeline: channels, sample rate, then the encoder */
async function encodeAudio(audio, ex, job, markers) {
  let ch = audio.ch;
  if (ex.chans === 'mono') ch = adaptChannels(ch, 1);
  else if (ex.chans === 'stereo') ch = adaptChannels(ch, 2);
  if ((ex.fmt === 'mp3' || ex.fmt === 'opus') && ch.length > 2) ch = adaptChannels(ch, 2);
  if (ex.fmt === 'flac' && ch.length > 8) ch = adaptChannels(ch, 2);   // FLAC holds at most 8 channels
  const want = Number(ex.rate) || audio.sr, sr = outRate(ex.fmt, want);
  let encJob = job;
  if (sr !== audio.sr) {
    const conv = job.part(0, 0.3), out = [];
    encJob = job.part(0.3, 0.7);
    for (let c = 0; c < ch.length; c++) out.push(await resampleRate(ch[c], audio.sr, sr, conv.part(c / ch.length, 1 / ch.length)));
    ch = out;
    markers = (markers || []).map((m) => Math.round(m * sr / audio.sr));
  }
  const a = { sr, ch };
  switch (ex.fmt) {
    case 'flac': return encodeFlac(a, { bits: ex.flacBits, dither: ex.dither }, encJob);
    case 'mp3': return encodeMp3(a, { kbps: ex.mp3Kbps }, encJob);
    case 'opus': return encodeOpus(a, { kbps: ex.opusKbps }, encJob);
    default: return encodeWav(a, { bits: ex.wavBits, dither: ex.dither, markers });
  }
}
