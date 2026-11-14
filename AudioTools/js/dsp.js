'use strict';
// Signal processing building blocks: progress / cancel for long jobs, FFT, filters, resampling,
// oversampled waveshaping, and level helpers. Audio is plain Float32Array channels throughout.

/* ---------- long jobs
   Processors call `await job.tick(fraction)` in their loops. It hands control back to the browser every
   ~30 ms (so the page stays responsive and the progress bar moves) and throws Cancelled when the user
   pressed Cancel. job.part(from, size) maps a step's 0..1 progress into a slice of the whole. */
class Cancelled extends Error { constructor() { super('Cancelled'); this.cancelled = true; } }
class Job {
  constructor(onProgress) {
    this.root = this; this.onProgress = onProgress || null;
    this.cancelled = false; this.last = performance.now(); this.base = 0; this.span = 1;
  }
  part(from, size) {
    const p = Object.create(Job.prototype);
    p.root = this.root; p.base = this.base + from * this.span; p.span = this.span * size;
    return p;
  }
  async tick(f = 0) {
    const r = this.root;
    if (r.cancelled) throw new Cancelled();
    const now = performance.now();
    if (now - r.last < 30) return;
    if (r.onProgress) r.onProgress(clamp(this.base + clamp(f, 0, 1) * this.span, 0, 1));
    await sleep0();
    r.last = performance.now();
    if (r.cancelled) throw new Cancelled();
  }
}
const quietJob = () => new Job(null);

/* ---------- FFT: in-place radix-2 complex transform. Forward is e^(-i…); inverse is unscaled. */
class FFT {
  constructor(n) {
    this.n = n;
    let bits = 0;
    while ((1 << bits) < n) bits++;
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n >> 1); this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = Math.sin(2 * Math.PI * i / n); }
  }
  run(re, im, inverse) {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin, sg = inverse ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half, c = cs[k], s = sg * sn[k];
          const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}
const hann = (n) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };

/* ---------- filters (RBJ "Audio EQ Cookbook" biquads) */
function biquad(type, freq, q, sr, gainDb = 0) {
  const w0 = 2 * Math.PI * clamp(freq, 1, sr * 0.499) / sr, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    default: throw new Error('unknown filter ' + type);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
// Runs a biquad over x into out (may be the same array). Returns out.
function runBiquad(c, x, out = x) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
// Forward then backward: no phase shift (nothing moves in time), twice the slope.
function runBiquadZeroPhase(c, x, out = x) {
  runBiquad(c, x, out);
  out.reverse();
  runBiquad(c, out, out);
  return out.reverse();
}
// Butterworth stages: 12 dB/oct is one biquad (Q 0.707), 24 dB/oct two (Q 0.541 and 1.307).
const butterQs = (order) => (order >= 4 ? [0.5412, 1.3066] : [Math.SQRT1_2]);

// One-pole low-pass coefficient for a cutoff in Hz.
const onePoleK = (fc, sr) => 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.49) / sr);

// Removes DC (a 10 Hz one-pole high-pass), in place.
function dcBlock(x, sr) {
  const R = 1 - 2 * Math.PI * 10 / sr;
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = v - px + R * py; px = v; py = y; x[i] = y; }
  return x;
}

/* ---------- resampling: windowed sinc (Kaiser), table-driven */
function besselI0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-12 * s) break; }
  return s;
}
const RS_ZC = 16, RS_RES = 512;
let rsTable = null;
function rsKernel() {
  if (rsTable) return rsTable;
  const n = RS_ZC * RS_RES + 2, t = new Float32Array(n), beta = 8.5, i0b = besselI0(beta);
  for (let i = 0; i < n; i++) {
    const x = i / RS_RES, r = x / RS_ZC;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    t[i] = r >= 1 ? 0 : sinc * besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
  }
  return (rsTable = t);
}
// Reads x at fractional positions: out[i] = x(start + i * step), band-limited to `fc` (a fraction of
// x's Nyquist, ≤ 1). Used for sample-rate conversion (step = inRate / outRate) and varispeed (step = rate).
async function resampleAt(x, outN, step, job, start = 0) {
  const n = x.length, tbl = rsKernel(), tl = tbl.length - 1, out = new Float32Array(outN);
  const fc = Math.min(1, 1 / step) * 0.96, hw = RS_ZC / fc, sc = fc * RS_RES;
  for (let i = 0; i < outN; i++) {
    const p = start + i * step;
    const k0 = Math.max(0, Math.ceil(p - hw)), k1 = Math.min(n - 1, Math.floor(p + hw));
    let s = 0;
    for (let k = k0; k <= k1; k++) {
      const u = Math.abs(p - k) * sc, j = u | 0;
      if (j < tl) s += x[k] * (tbl[j] + (tbl[j + 1] - tbl[j]) * (u - j));
    }
    out[i] = s * fc;
    if ((i & 32767) === 0 && job) await job.tick(i / outN);
  }
  return out;
}
// Same audio at a new sample rate.
async function resampleRate(x, inRate, outRate, job) {
  if (inRate === outRate) return x.slice();
  const outN = Math.max(1, Math.round(x.length * outRate / inRate));
  return resampleAt(x, outN, inRate / outRate, job);
}

/* ---------- 4× oversampled waveshaping, so distortion doesn't fold harsh aliases back down.
   A 65-tap linear-phase low-pass (cutoff 90% of the original Nyquist) is used to go up and down again;
   both steps are centred, so the result lines up with the input sample for sample. */
let osH = null;
function osFir() {
  if (osH) return osH;
  const L = 65, c = 32, fc = 0.9 * 0.125, beta = 7.5, i0b = besselI0(beta), h = new Float64Array(L);
  let sum = 0;
  for (let k = 0; k < L; k++) {
    const t = k - c, r = t / c;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[k] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    sum += h[k];
  }
  for (let k = 0; k < L; k++) h[k] /= sum;
  return (osH = h);
}
async function shapeOversampled(x, fn, job) {
  const h = osFir(), L = 65, c = 32, n = x.length, out = new Float32Array(n);
  // Each chunk is copied with P samples of margin (zeros past the ends), so the loops need no bounds checks.
  const B = 16384, M = 10, P = 9, xs = new Float32Array(B + 2 * M + 2 * P), up = new Float32Array((B + 2 * M) * 4);
  for (let b0 = 0; b0 < n; b0 += B) {
    const bn = Math.min(B, n - b0), s0 = b0 - M, cnt = bn + 2 * M, U = cnt * 4;
    for (let j = -P; j < cnt + P; j++) { const i = s0 + j; xs[j + P] = i >= 0 && i < n ? x[i] : 0; }
    // Up: only every 4th tap meets a real (non-stuffed) sample, so each output uses 16 or 17 taps.
    for (let m = 0; m < U; m++) {
      const r = (m + c) & 3, base = ((m + c - r) >> 2) + P;
      let acc = 0;
      for (let k = r, t = 0; k < L; k += 4, t++) acc += h[k] * xs[base - t];
      up[m] = fn(acc * 4);
    }
    // Down: the filter is symmetric, so taps k and L-1-k share one multiply.
    for (let i = M; i < M + bn; i++) {
      const base = 4 * i + c;
      let acc = h[c] * up[base - c];
      for (let k = 0; k < c; k++) acc += h[k] * (up[base - k] + up[base - (L - 1 - k)]);
      out[s0 + i] = acc;
    }
    await job.tick(b0 / n);
  }
  return out;
}

/* ---------- levels and channels */
function peakOf(chs, a = 0, b = chs[0].length) {
  let p = 0;
  for (const d of chs) for (let i = a; i < b; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > p) p = v; }
  return p;
}
function rmsOf(chs, a = 0, b = chs[0].length) {
  let s = 0;
  for (const d of chs) for (let i = a; i < b; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, (b - a) * chs.length));
}
function mixdown(chs) {
  if (chs.length === 1) return chs[0].slice();
  const n = chs[0].length, out = new Float32Array(n), k = 1 / chs.length;
  for (const d of chs) for (let i = 0; i < n; i++) out[i] += d[i] * k;
  return out;
}
// The same audio with n channels: mono is copied out, more channels are mixed down or cut to the first two.
function adaptChannels(chs, n) {
  if (chs.length === n) return chs;
  if (n === 1) return [mixdown(chs)];
  if (chs.length === 1) return Array.from({ length: n }, () => chs[0].slice());
  return Array.from({ length: n }, (_, i) => (chs[i] || chs[chs.length - 1]).slice());
}
// Equal-power dry / wet amounts for a 0..100 mix.
const mixGains = (pct) => { const t = clamp(pct / 100, 0, 1) * Math.PI / 2; return [Math.cos(t), Math.sin(t)]; };
