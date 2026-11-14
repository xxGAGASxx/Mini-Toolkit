'use strict';
// Clean up: Noise reduction (spectral gating against a noise profile), Hum removal, Low / high cut.

/* ---------- Noise reduction
   The audio is cut into overlapping frames and each frame split into frequencies (STFT). A frequency that is
   not clearly louder than the noise profile at that frequency is turned down by Reduction. The gains are
   smoothed across neighbouring frequencies and over time (they fall back slowly), which keeps the "musical
   noise" twinkle down. */
const nrSize = (sr) => (sr > 64000 ? 4096 : sr > 24000 ? 2048 : 1024);

// Average magnitude per frequency over a stretch of noise: the profile.
async function learnNoise({ sr, ch }, job) {
  const N = nrSize(sr), hop = N / 2, n = ch[0].length;
  if (n < N) throw new Error(`select at least ${Math.ceil(N / sr * 1000)} ms of noise`);
  const fft = new FFT(N), win = hann(N), re = new Float64Array(N), im = new Float64Array(N), bins = N / 2 + 1;
  const mag = new Float32Array(bins);
  let frames = 0;
  for (const d of ch) {
    for (let pos = 0; pos + N <= n; pos += hop) {
      for (let i = 0; i < N; i++) { re[i] = d[pos + i] * win[i]; im[i] = 0; }
      fft.run(re, im, false);
      for (let k = 0; k < bins; k++) mag[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      frames++;
      await job.tick(pos / n);
    }
  }
  for (let k = 0; k < bins; k++) mag[k] /= frames;
  return { sr, N, mag, secs: n / sr };
}
// Without a learned profile: guess the noise from the quietest moments (10th percentile per frequency).
async function estimateNoise({ sr, ch }, job) {
  const N = nrSize(sr), n = ch[0].length, bins = N / 2 + 1, fft = new FFT(N), win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N), count = Math.max(1, Math.min(400, Math.floor((n - N) / (N / 2)) + 1));
  const all = Array.from({ length: bins }, () => new Float32Array(count * ch.length));
  let f = 0;
  for (const d of ch) {
    for (let j = 0; j < count; j++) {
      const pos = count > 1 ? Math.round(j * (n - N) / (count - 1)) : 0;
      for (let i = 0; i < N; i++) { const v = d[pos + i]; re[i] = (v || 0) * win[i]; im[i] = 0; }
      fft.run(re, im, false);
      for (let k = 0; k < bins; k++) all[k][f] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      f++;
      if ((j & 15) === 0) await job.tick(j / count);
    }
  }
  const mag = new Float32Array(bins);
  for (let k = 0; k < bins; k++) { const a = all[k].sort(); mag[k] = a[Math.floor(a.length * 0.1)] * 2; }
  return { sr, N, mag, auto: true };
}
async function fxNoise(input, p, job, profile) {
  const { sr, ch } = input, n = ch[0].length;
  const prof = profile && profile.sr === sr ? profile : await estimateNoise(input, job.part(0, 0.1));
  const N = prof.N, hop = N / 4, bins = N / 2 + 1, fft = new FFT(N), win = hann(N), norm = 1 / (1.5 * N);
  const floor = dbToGain(-p.reduce), sens = dbToGain(p.sens), bands = Math.round(p.smooth);
  const fall = Math.pow(floor, hop / (Math.max(10, p.release) * 0.001 * sr));   // per frame, while a gain falls
  const thr2 = Float32Array.from(prof.mag, (m) => (m * sens) * (m * sens));   // compared with squared magnitudes
  const re = new Float64Array(N), im = new Float64Array(N), off = new Uint8Array(bins), sm = new Float32Array(bins);
  // Smoothing across frequencies averages the gains in dB. Each raw gain is 1 or floor, so the average over a
  // window with j "off" bins out of w is floor^(j / w): a small table covers every full-width window.
  const W = 2 * bands + 1, pw = Float32Array.from({ length: W + 1 }, (_, j) => Math.pow(floor, j / W));
  const out = [];
  const work = job.part(profile ? 0 : 0.1, profile ? 1 : 0.9);
  for (let c = 0; c < ch.length; c++) {
    // Gains start closed, so the very start is cleaned like the rest (they open instantly where there's sound).
    const x = ch[c], total = n + 2 * N, acc = new Float32Array(total), g = new Float32Array(bins);
    const at = (i) => { const j = i - N; return j >= 0 && j < n ? x[j] : 0; };
    for (let pos = 0; pos + N <= total; pos += hop) {
      for (let i = 0; i < N; i++) { re[i] = at(pos + i) * win[i]; im[i] = 0; }
      fft.run(re, im, false);
      for (let k = 0; k < bins; k++) off[k] = re[k] * re[k] + im[k] * im[k] > thr2[k] ? 0 : 1;
      // Smooth across frequencies (a sliding count of "off" bins), then let gains fall no faster than Release.
      let cnt = 0;
      for (let j = 0; j < Math.min(bins, bands); j++) cnt += off[j];
      for (let k = 0; k < bins; k++) {
        if (k + bands < bins) cnt += off[k + bands];
        if (k - bands - 1 >= 0) cnt -= off[k - bands - 1];
        const w = Math.min(bins - 1, k + bands) - Math.max(0, k - bands) + 1;
        sm[k] = w === W ? pw[cnt] : Math.pow(floor, cnt / w);
      }
      for (let k = 0; k < bins; k++) {
        const v = Math.max(sm[k], g[k] * fall);
        g[k] = v;
        re[k] *= v; im[k] *= v;
        if (k > 0 && k < N / 2) { re[N - k] *= v; im[N - k] *= v; }
      }
      fft.run(re, im, true);
      for (let i = 0; i < N; i++) acc[pos + i] += re[i] * win[i] * norm;
      if ((pos & 0x3fff) < hop) await work.tick((c + pos / total) / ch.length);
    }
    const y = acc.slice(N, N + n);
    if (p.residual) for (let i = 0; i < n; i++) y[i] = x[i] - y[i];   // hear what gets removed
    out.push(y);
  }
  return { ch: out, pre: 0 };
}

/* ---------- Hum: narrow notches at the mains frequency and its harmonics, run both ways (no phase shift).
   Narrow notches need a few tenths of a second to settle, so the audio is first extended at both ends by a
   whole number of hum periods taken from itself: the hum carries on seamlessly into the padding, the filters
   settle there, and the padding is dropped afterwards. */
function padPeriodic(x, P) {
  const n = x.length, out = new Float32Array(n + 2 * P), at = (i) => x[((i % n) + n) % n];
  for (let i = 0; i < P; i++) { out[i] = at(i); out[P + n + i] = at(n - P + i); }
  out.set(x, P);
  return out;
}
function detectHum(ch, sr) {
  const d = ch[0], n = Math.min(d.length, sr * 20);
  const power = (f) => {
    const k = 2 * Math.cos(2 * Math.PI * f / sr);
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const t = d[i] + k * a - b; b = a; a = t; }
    return a * a + b * b - k * a * b;
  };
  const e50 = power(50) + power(100) + power(150), e60 = power(60) + power(120) + power(180);
  return e60 > e50 ? 60 : 50;
}
async function fxHum({ sr, ch }, p, job) {
  const f0 = p.base === 'auto' ? detectHum(ch, sr) : Number(p.base), out = [];
  const settle = clamp(2 / Math.max(0.5, p.width), 0.3, 4), P = Math.round(Math.ceil(settle * f0) * sr / f0);
  for (let c = 0; c < ch.length; c++) {
    const n = ch[c].length, y = padPeriodic(ch[c], P);
    for (let h = 1; h <= p.harmonics; h++) {
      const f = f0 * h;
      if (f >= sr * 0.45) break;
      runBiquadZeroPhase(biquad('notch', f, f / Math.max(0.5, p.width), sr), y);
      await job.tick((c + h / p.harmonics) / ch.length);
    }
    out.push(y.slice(P, P + n));
  }
  return { ch: out, pre: 0, note: `Removed ${f0} Hz hum` };
}

/* ---------- Low / high cut: Butterworth filters, 12 or 24 dB per octave */
async function fxFilter({ sr, ch }, p, job) {
  const stages = [], qs = butterQs(p.slope >= 24 ? 4 : 2);
  if (p.lowOn) for (const q of qs) stages.push(biquad('highpass', p.low, q, sr));
  if (p.highOn) for (const q of qs) stages.push(biquad('lowpass', Math.min(p.high, sr * 0.45), q, sr));
  const out = [];
  for (let c = 0; c < ch.length; c++) {
    const y = ch[c].slice();
    for (const s of stages) runBiquad(s, y);
    out.push(y);
    await job.tick((c + 1) / ch.length);
  }
  return { ch: out, pre: 0 };
}
