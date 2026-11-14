'use strict';
// The audio document and opening files.
// An audio is { sr, ch: [Float32Array per channel] }. It is never changed once made: every edit builds a
// new one, so undo can keep old ones around and share the parts that didn't change.
// Split markers are sample positions, kept sorted, strictly inside (0, length).

const makeAudio = (sr, ch) => ({ sr, ch });
const lenOf = (a) => (a ? a.ch[0].length : 0);
const durOf = (a) => (a ? a.ch[0].length / a.sr : 0);

function sliceAudio(a, s, e) {
  return makeAudio(a.sr, a.ch.map((d) => d.slice(s, e)));
}
// A new audio with [s, e) replaced by `ins` (channels, any length; adapted to the audio's channel count).
function spliceAudio(a, s, e, ins) {
  const n = lenOf(a), m = ins ? ins[0].length : 0, C = a.ch.length;
  const src = ins ? adaptChannels(ins, C) : null;
  return makeAudio(a.sr, a.ch.map((d, c) => {
    const out = new Float32Array(n - (e - s) + m);
    out.set(d.subarray(0, s), 0);
    if (src) out.set(src[c], s);
    out.set(d.subarray(e), s + m);
    return out;
  }));
}

/* ---------- markers */
function cleanMarkers(ms, len) {
  const out = [];
  for (const m of [...ms].map(Math.round).sort((x, y) => x - y)) {
    if (m > 0 && m < len && out[out.length - 1] !== m) out.push(m);
  }
  return out;
}
// Where markers go when [s, e) becomes m samples long: inside it they scale, after it they move.
function remapMarkers(ms, s, e, m, newLen) {
  const d = e - s, out = ms.map((x) => (x <= s ? x : x >= e ? x + m - d : s + Math.round((x - s) * (d ? m / d : 0))));
  return cleanMarkers(out, newLen);
}
// Regions are the stretches between split markers (the whole file when there are none).
function regionsOf(ms, len) {
  const b = [0, ...ms, len], out = [];
  for (let i = 0; i < b.length - 1; i++) if (b[i + 1] > b[i]) out.push([b[i], b[i + 1]]);
  return out;
}

/* ---------- putting a processed range back
   res = { ch, pre }: the processed audio starts `pre` samples before the range start (reverse reverb rings in
   before the sound) and may run past its end (reverb and echo tails).
   mode 'replace': the range becomes res, whatever its length (speed changes); markers inside it scale.
   mode 'mix': inside the range res replaces the audio; the parts before and after are added on top of what is
   there (that's where tails ring out), growing the file at either end if needed. Returns
   { audio, markers, shift } where shift is how far the original audio moved right (growth at the start). */
function placeResult(a, ms, s, e, res, mode, xfade = 0) {
  const n = lenOf(a), C = a.ch.length, ch = adaptChannels(res.ch, C), m = ch[0].length;
  if (mode === 'replace') {
    let out = ch;
    // Short crossfades at the edges hide the step where processed audio meets untouched audio.
    if (xfade > 0 && m === e - s) {
      const f = Math.min(xfade, m >> 1);
      out = ch.map((d, c) => {
        const o = d === res.ch[c] ? d.slice() : d, src = a.ch[c];
        for (let i = 0; i < f; i++) {
          const t = (i + 0.5) / f;
          if (s > 0) o[i] = src[s + i] * (1 - t) + o[i] * t;
          if (e < n) o[m - 1 - i] = src[e - 1 - i] * (1 - t) + o[m - 1 - i] * t;
        }
        return o;
      });
    }
    const audio = spliceAudio(a, s, e, out);
    return { audio, markers: remapMarkers(ms, s, e, m, lenOf(audio)), shift: 0 };
  }
  const pre = res.pre || 0, start = s - pre;          // where res[0] lands
  const grow0 = Math.max(0, -start), end = start + m, total = Math.max(n, end) + grow0;
  const audio = makeAudio(a.sr, a.ch.map((d, c) => {
    const out = new Float32Array(total), r = ch[c];
    out.set(d, grow0);
    const o = start + grow0;                           // res[0] in out
    for (let i = 0; i < m; i++) {
      const t = o + i, inside = t >= s + grow0 && t < e + grow0;
      out[t] = inside ? r[i] : out[t] + r[i];
    }
    return out;
  }));
  return { audio, markers: cleanMarkers(ms.map((x) => x + grow0), total), shift: grow0 };
}

/* ---------- opening files
   WAV and AIFF are read here, so their exact samples and sample rate are kept. Everything else goes to the
   browser's decoder, at the file's own sample rate when it can be read from the header. */
async function decodeAudioFile(file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf), tag = String.fromCharCode(...u8.subarray(0, 4));
  const kind = String.fromCharCode(...u8.subarray(8, 12));
  if ((tag === 'RIFF' || tag === 'RF64') && kind === 'WAVE') {
    try { return parseWav(buf); } catch (err) { console.warn('WAV reader:', err); }
  }
  if (tag === 'FORM' && (kind === 'AIFF' || kind === 'AIFC')) {
    try { return parseAiff(buf); } catch (err) { console.warn('AIFF reader:', err); }
  }
  const rate = sniffRate(u8) || 48000;
  let decoded;
  try {
    decoded = await new OfflineAudioContext(1, 1, clamp(rate, 3000, 768000)).decodeAudioData(buf.slice(0));
  } catch {
    throw new Error('this browser cannot decode that format');
  }
  const ch = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) ch.push(decoded.getChannelData(c).slice());
  if (!ch.length || !ch[0].length) throw new Error('the file has no audio');
  return { audio: makeAudio(decoded.sampleRate, ch), markers: [] };
}

// The sample rate from the first bytes of FLAC, Ogg, MP3 and MP4 / M4A files (0 when unknown).
function sniffRate(u8) {
  const str = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  try {
    if (str(0, 4) === 'fLaC') return (u8[18] << 12) | (u8[19] << 4) | (u8[20] >> 4);
    if (str(0, 4) === 'OggS') {
      const segs = u8[26], body = 27 + segs;
      if (str(body, 8) === 'OpusHead') return 48000;
      if (str(body + 1, 6) === 'vorbis') return dv.getUint32(body + 12, true);
      return 0;
    }
    // MP4 / M4A: the sample rate in the 'mp4a' sample entry (16.16 fixed point).
    if (str(4, 4) === 'ftyp') {
      for (let i = 0; i + 32 < u8.length; i++) {
        if (u8[i] === 0x6d && u8[i + 1] === 0x70 && u8[i + 2] === 0x34 && u8[i + 3] === 0x61) {
          const r = dv.getUint32(i + 28) >>> 16;
          if (r >= 8000 && r <= 192000) return r;
        }
      }
      return 0;
    }
    // MP3: skip an ID3v2 tag, then read the first frame header.
    let o = 0;
    if (str(0, 3) === 'ID3') o = 10 + ((u8[6] & 127) << 21 | (u8[7] & 127) << 14 | (u8[8] & 127) << 7 | (u8[9] & 127));
    for (let i = o; i < Math.min(u8.length - 4, o + 65536); i++) {
      if (u8[i] === 0xff && (u8[i + 1] & 0xe0) === 0xe0) {
        const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, sri = (u8[i + 2] >> 2) & 3;
        if (ver === 1 || layer === 0 || sri === 3) continue;
        const base = [44100, 48000, 32000][sri];
        return ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
      }
    }
  } catch { /* fall through */ }
  return 0;
}

function parseWav(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), str = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  let fmt = null, dataOff = -1, dataLen = 0, ds64Data = 0, cues = [];
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const id = str(o);
    let size = dv.getUint32(o + 4, true);
    if (id === 'ds64') ds64Data = dv.getUint32(o + 16, true) + dv.getUint32(o + 20, true) * 4294967296;
    if (id === 'fmt ') {
      let tag = dv.getUint16(o + 8, true);
      if (tag === 0xfffe && size >= 40) tag = dv.getUint16(o + 32, true);
      fmt = { tag, ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), align: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    } else if (id === 'data') {
      dataOff = o + 8;
      if (size === 0xffffffff && ds64Data) size = ds64Data;
      dataLen = Math.min(size, buf.byteLength - dataOff);   // streamed or cut-off files
      if (size === 0 || size === 0xffffffff) dataLen = buf.byteLength - dataOff;
    } else if (id === 'cue ' && size >= 4) {
      const n = dv.getUint32(o + 8, true);
      for (let i = 0; i < n && o + 12 + i * 24 + 24 <= buf.byteLength; i++) cues.push(dv.getUint32(o + 12 + i * 24 + 20, true));
    }
    if (dataOff >= 0 && id === 'data' && dataOff + dataLen >= buf.byteLength) break;
    o += 8 + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('not a complete WAV file');
  const { tag, ch: C, bits } = fmt, bps = bits >> 3, align = fmt.align || C * bps;
  if (!C || !bps) throw new Error('unsupported WAV layout');
  const n = Math.floor(dataLen / align), ch = Array.from({ length: C }, () => new Float32Array(n));
  for (let c = 0; c < C; c++) {
    const d = ch[c];
    let p = dataOff + c * bps;
    if (tag === 3 && bits === 32) for (let i = 0; i < n; i++, p += align) d[i] = dv.getFloat32(p, true);
    else if (tag === 3 && bits === 64) for (let i = 0; i < n; i++, p += align) d[i] = dv.getFloat64(p, true);
    else if (tag === 1 && bits === 8) for (let i = 0; i < n; i++, p += align) d[i] = (u8[p] - 128) / 128;
    else if (tag === 1 && bits === 16) for (let i = 0; i < n; i++, p += align) d[i] = dv.getInt16(p, true) / 32768;
    else if (tag === 1 && bits === 24) for (let i = 0; i < n; i++, p += align) d[i] = ((u8[p + 2] << 24 | u8[p + 1] << 16 | u8[p] << 8) >> 8) / 8388608;
    else if (tag === 1 && bits === 32) for (let i = 0; i < n; i++, p += align) d[i] = dv.getInt32(p, true) / 2147483648;
    else throw new Error(`unsupported WAV encoding (format ${tag}, ${bits}-bit)`);
  }
  if (!n) throw new Error('the file has no audio');
  return { audio: makeAudio(fmt.sr, ch), markers: cleanMarkers(cues, n) };
}

function parseAiff(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), str = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const aifc = str(8) === 'AIFC';
  let C = 0, frames = 0, bits = 0, sr = 0, comp = 'NONE', ssnd = -1;
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const id = str(o), size = dv.getUint32(o + 4);
    if (id === 'COMM') {
      C = dv.getUint16(o + 8); frames = dv.getUint32(o + 10); bits = dv.getUint16(o + 14);
      // 80-bit extended float
      const exp = (dv.getUint16(o + 16) & 0x7fff) - 16383, hi = dv.getUint32(o + 18), lo = dv.getUint32(o + 22);
      sr = Math.round(hi * Math.pow(2, exp - 31) + lo * Math.pow(2, exp - 63));
      if (aifc && size >= 22) comp = str(o + 26);
    } else if (id === 'SSND') ssnd = o + 16 + dv.getUint32(o + 8);
    o += 8 + size + (size & 1);
  }
  if (!C || ssnd < 0 || !sr) throw new Error('not a complete AIFF file');
  const bps = Math.ceil(bits / 8), le = comp === 'sowt', fl = comp === 'fl32' || comp === 'FL32';
  const n = Math.min(frames, Math.floor((buf.byteLength - ssnd) / (C * (fl ? 4 : bps))));
  const ch = Array.from({ length: C }, () => new Float32Array(n));
  if (!['NONE', 'sowt', 'fl32', 'FL32', 'twos'].includes(comp)) throw new Error(`unsupported AIFF compression (${comp})`);
  for (let c = 0; c < C; c++) {
    const d = ch[c], st = C * (fl ? 4 : bps);
    let p = ssnd + c * (fl ? 4 : bps);
    if (fl) for (let i = 0; i < n; i++, p += st) d[i] = dv.getFloat32(p);
    else if (bps === 1) for (let i = 0; i < n; i++, p += st) d[i] = dv.getInt8(p) / 128;
    else if (bps === 2) for (let i = 0; i < n; i++, p += st) d[i] = dv.getInt16(p, le) / 32768;
    else if (bps === 3) for (let i = 0; i < n; i++, p += st) d[i] = ((u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8) >> 8) / 8388608;
    else if (bps === 4) for (let i = 0; i < n; i++, p += st) d[i] = dv.getInt32(p) / 2147483648;
  }
  if (!n) throw new Error('the file has no audio');
  return { audio: makeAudio(sr, ch), markers: [] };
}
