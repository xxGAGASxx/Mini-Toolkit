'use strict';
// Speed and pitch. Keeping one while changing the other uses Signalsmith Stretch (vendor/signalsmith-stretch.js),
// a WASM phase vocoder; changing both together (like a tape or record) is plain resampling.

let stretchMod = null;
function stretchModule() {
  if (typeof SignalsmithStretch !== 'function') return Promise.reject(new Error('the time-stretch engine did not load'));
  if (!stretchMod) {
    stretchMod = SignalsmithStretch().then((m) => { m._main(); return m; });
    stretchMod.catch(() => { stretchMod = null; });
  }
  return stretchMod;
}

/* Stretches and/or transposes channels. rate > 1 is faster (shorter), semis shifts pitch, formants keeps a
   voice's character when transposing. The output is exactly round(n / rate) long and lines up with the
   input: the first inputLatency samples prime the engine, the first outputLatency samples of output are
   dropped, and the end is pushed out with silence. */
async function stretch(ch, sr, rate, semis, formants, job) {
  const m = await stretchModule(), C = ch.length, n = ch[0].length;
  const heap = () => (m.exports ? m.exports.memory.buffer : m.HEAP8.buffer);
  m._presetDefault(C, sr);
  m._setTransposeSemitones(semis, 8000 / sr);
  m._setFormantSemitones(0, formants ? 1 : 0);
  m._setFormantBase(0);
  const inLat = m._inputLatency(), outLat = m._outputLatency(), B = 512;
  const L = Math.max(Math.ceil(B * rate) + 2, B, inLat, outLat) + 8;
  const ptr = m._setBuffers(C, L);
  const inBuf = (c) => new Float32Array(heap(), ptr + L * 4 * c, L);
  const outBuf = (c) => new Float32Array(heap(), ptr + L * 4 * (C + c), L);
  const outN = Math.max(1, Math.round(n / rate)), out = ch.map(() => new Float32Array(outN));

  for (let c = 0; c < C; c++) { const b = inBuf(c); b.fill(0); b.set(ch[c].subarray(0, Math.min(n, inLat))); }
  m._seek(inLat, rate);
  let inPos = inLat, done = 0, w = -outLat;
  const total = outN + outLat;
  while (done < total) {
    const bs = Math.min(B, total - done);
    const want = Math.round((done + bs) * rate) + inLat, cnt = Math.max(0, Math.min(L, want - inPos));
    for (let c = 0; c < C; c++) {
      const b = inBuf(c), s1 = Math.min(n, inPos + cnt);
      b.fill(0, 0, cnt);
      if (s1 > inPos) b.set(ch[c].subarray(inPos, s1));
    }
    m._process(cnt, bs);
    inPos += cnt;
    const skip = Math.max(0, -w), take = Math.min(bs, outN - w) - skip;
    if (take > 0) for (let c = 0; c < C; c++) out[c].set(outBuf(c).subarray(skip, skip + take), w + skip);
    done += bs; w += bs;
    await job.tick(done / total);
  }
  return out;
}

// Faster or slower like a tape: pitch moves with speed (12 · log2(rate) semitones).
async function varispeed(ch, rate, job) {
  const outN = Math.max(1, Math.round(ch[0].length / rate)), out = [];
  for (let c = 0; c < ch.length; c++) out.push(await resampleAt(ch[c], outN, rate, job.part(c / ch.length, 1 / ch.length)));
  return out;
}

// Pitch only, used by Delay for repeats that climb or fall.
const pitchShift = (ch, sr, semis, job) => (Math.abs(semis) < 1e-3 ? Promise.resolve(ch.map((d) => d.slice())) : stretch(ch, sr, 1, semis, false, job));
