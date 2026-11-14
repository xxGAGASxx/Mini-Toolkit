'use strict';
// Effects: Reverb, Delay, Echo, Distortion, Compressor.
// Each takes ({ sr, ch }, params, job) and returns { ch, pre }: the processed audio, which may start `pre`
// samples before the input (reverse reverb) and run past its end (tails). See placeResult in audio.js.

/* ---------- presets (what the Preset menus fill in) */
const REVERB_PRESETS = {
  small: { size: 18, decay: 0.45, predelay: 4, damp: 55, width: 70, mix: 22 },
  room: { size: 40, decay: 0.9, predelay: 10, damp: 45, width: 85, mix: 26 },
  hall: { size: 70, decay: 2.4, predelay: 25, damp: 35, width: 100, mix: 32 },
  cathedral: { size: 100, decay: 6, predelay: 45, damp: 30, width: 100, mix: 38 },
  plate: { size: 28, decay: 1.8, predelay: 0, damp: 12, width: 100, mix: 30 },
  huge: { size: 100, decay: 12, predelay: 70, damp: 40, width: 100, mix: 45 },
};
const COMP_PRESETS = {
  gentle: { threshold: -18, ratio: 2, knee: 8, attack: 20, release: 250, lookahead: 5, auto: true, mix: 100 },
  vocal: { threshold: -22, ratio: 3.5, knee: 6, attack: 5, release: 120, lookahead: 5, auto: true, mix: 100 },
  punch: { threshold: -16, ratio: 4, knee: 3, attack: 25, release: 90, lookahead: 0, auto: true, mix: 100 },
  heavy: { threshold: -32, ratio: 8, knee: 6, attack: 2, release: 200, lookahead: 5, auto: true, mix: 100 },
  parallel: { threshold: -35, ratio: 10, knee: 4, attack: 1, release: 150, lookahead: 5, auto: true, mix: 40 },
  limiter: { threshold: -3, ratio: 20, knee: 0, attack: 0.1, release: 60, lookahead: 5, auto: false, makeup: 2.8, mix: 100 },
};

// Drops near-silent (below −80 dB) samples from the tails a processor added before and after the input.
function trimTails(res, n) {
  const T = 1e-4, ch = res.ch, total = ch[0].length;
  let pre = res.pre || 0, a = 0, b = total;
  const loud = (i) => ch.some((d) => d[i] > T || d[i] < -T);
  while (a < pre && !loud(a)) a++;
  while (b > pre + n && !loud(b - 1)) b--;
  if (a === 0 && b === total) return res;
  return { ch: ch.map((d) => d.slice(a, b)), pre: pre - a };
}

/* ---------- convolution through the browser's native convolver (fast, no added latency) */
async function convolve(ch, sr, ir, job) {
  if (ch.length > 2) {   // the convolver handles up to two channels: run the rest one at a time
    const out = [];
    for (let c = 0; c < ch.length; c++) out.push((await convolve([ch[c]], sr, [ir[c % ir.length]], job.part(c / ch.length, 1 / ch.length)))[0]);
    return out;
  }
  const C = ch.length, n = ch[0].length, L = ir[0].length, total = n + L;
  const ctx = new OfflineAudioContext(C, total, sr);
  const src = ctx.createBuffer(C, n, sr), irb = ctx.createBuffer(ir.length, L, sr);
  ch.forEach((d, c) => src.copyToChannel(d, c));
  ir.forEach((d, c) => irb.copyToChannel(d, c));
  const s = ctx.createBufferSource(), conv = ctx.createConvolver();
  s.buffer = src;
  conv.normalize = false;
  conv.buffer = irb;
  s.connect(conv).connect(ctx.destination);
  s.start(0);
  const steps = 8, dur = total / sr;
  const rendered = await new Promise((resolve, reject) => {
    for (let k = 1; k < steps; k++) {
      ctx.suspend(dur * k / steps).then(() => job.tick(k / steps)).then(() => ctx.resume(), reject);
    }
    ctx.startRendering().then(resolve, reject);
  });
  return Array.from({ length: C }, (_, c) => rendered.getChannelData(c).slice());
}

/* ---------- Reverb: a generated impulse response (early reflections, then a decaying noise tail that loses
   its highs over time), convolved with the audio. */
function reverbIR(sr, C, p) {
  const rt = clamp(p.decay, 0.1, 20), size = clamp(p.size / 100, 0, 1), damp = clamp(p.damp / 100, 0, 1);
  const pre = Math.round(p.predelay / 1000 * sr), tail = Math.round(Math.min(rt * 1.15 + 0.05, 20) * sr), len = pre + tail;
  const k = Math.log(1000) / (rt * sr);             // amplitude falls 60 dB over rt seconds
  const build = Math.max(1, Math.round((0.004 + 0.05 * size) * sr));
  const erSpan = (0.006 + 0.075 * size) * sr, erN = 6 + Math.round(10 * size);
  const fHi = Math.min(18000, sr * 0.45), fLo = lerp(fHi, 700, damp), tau = Math.max(0.05, rt * 0.35) * sr;
  const irs = [];
  for (let c = 0; c < Math.max(1, Math.min(C, 2)); c++) {
    const r = rng(9157 + c * 7919), h = new Float32Array(len);
    for (let i = 0; i < tail; i++) {
      const fade = i < build ? Math.sin((i / build) * Math.PI / 2) : 1;
      h[pre + i] = (r() * 2 - 1) * Math.exp(-k * i) * fade;
    }
    for (let j = 0; j < erN; j++) {
      const t = Math.round(Math.pow(r(), 1.4) * erSpan) + 1;
      if (t < tail) h[pre + t] += (r() < 0.5 ? -1 : 1) * (1.2 + r()) * Math.exp(-k * t) * (1 - 0.5 * t / erSpan);
    }
    // Damping: two one-pole low-passes whose cutoff slides from bright to dark as the tail goes on.
    if (damp > 0) {
      let y1 = 0, y2 = 0;
      for (let i = 0; i < tail; i += 64) {
        const a = onePoleK(fLo + (fHi - fLo) * Math.exp(-i / tau), sr);
        for (let j = i; j < Math.min(tail, i + 64); j++) {
          y1 += a * (h[pre + j] - y1); y2 += a * (y1 - y2); h[pre + j] = y2;
        }
      }
    }
    irs.push(h);
  }
  if (irs.length === 2) {          // width: 0 makes both sides the same, 100 keeps them independent
    const w = clamp(p.width / 100, 0, 1), a = (1 + w) / 2, b = (1 - w) / 2, [L, R] = irs;
    for (let i = 0; i < len; i++) { const l = L[i], r2 = R[i]; L[i] = a * l + b * r2; R[i] = a * r2 + b * l; }
  }
  // Unit energy: the reverb comes out about as loud as the sound going in.
  let e = 0;
  for (const h of irs) for (let i = 0; i < len; i++) e += h[i] * h[i];
  const g = 1 / Math.sqrt(e / irs.length || 1);
  for (const h of irs) for (let i = 0; i < len; i++) h[i] *= g;
  return irs;
}
async function fxReverb({ sr, ch }, p, job) {
  const n = ch[0].length, ir = reverbIR(sr, ch.length, p), L = ir[0].length;
  const src = p.reverse ? ch.map((d) => d.slice().reverse()) : ch;
  const wet = await convolve(src, sr, ir, job.part(0, 0.95));
  if (p.reverse) wet.forEach((d) => d.reverse());     // the tail now swells in before the sound
  const [dg, wg] = mixGains(p.mix), off = p.reverse ? L : 0;
  const out = wet.map((w, c) => {
    const o = new Float32Array(n + L);
    for (let i = 0; i < o.length; i++) o[i] = w[i] * wg;
    const d = ch[c];
    for (let i = 0; i < n; i++) o[off + i] += d[i] * dg;
    return o;
  });
  return trimTails({ ch: out, pre: off }, n);
}

/* ---------- Delay and Echo: a set of repeats. Each repeat is the previous one passed through the tone
   filter (and pitch shift), so later repeats get darker (and climb or fall in pitch). */
// Plays back short chunks backwards, for the reverse delay. Chunk edges fade to avoid clicks.
function reverseChunks(d, T, sr) {
  const n = d.length, out = new Float32Array(n), f = Math.min(Math.round(0.006 * sr), T >> 2);
  for (let s = 0; s < n; s += T) {
    const e = Math.min(n, s + T), m = e - s;
    for (let i = 0; i < m; i++) {
      const edge = Math.min(i, m - 1 - i), g = edge < f ? (edge + 0.5) / f : 1;
      out[s + i] = d[e - 1 - i] * g;
    }
  }
  return out;
}
async function repeats({ sr, ch }, cfg, job) {
  const n = ch[0].length, C = ch.length;
  const T = Math.max(1, Math.round(cfg.time / 1000 * sr));
  let taps = [];                                 // { t: offset in samples, g: gain, side: channel or -1 }
  if (cfg.mode === 'bounce') {
    let t = 0, iv = T, g = 1;
    for (let k = 0; k < 64 && iv >= 0.006 * sr && g > 0.001; k++) { t += iv; taps.push({ t: Math.round(t), g }); iv *= 0.78; g *= cfg.fb; }
  } else {
    let g = cfg.first;
    for (let k = 1; k <= cfg.max && g > 0.001; k++) { taps.push({ t: k * T, g }); g *= cfg.fb; }
  }
  // Each pitched repeat costs a full pitch-shift pass: skip the ones quieter than −40 dB.
  if (cfg.semis) taps = taps.filter((tp, k) => k < 16 && tp.g > 0.01 && Math.abs((k + 1) * cfg.semis) <= 36);
  const ping = cfg.mode === 'pingpong' && C === 2;
  let src = ping ? [mixdown(ch)] : ch.map((d) => d.slice());
  if (cfg.mode === 'reverse') src = src.map((d) => reverseChunks(d, T, sr));
  const last = taps.length ? taps[taps.length - 1].t : 0, total = n + last;
  const [dg, wg] = mixGains(cfg.mix);
  const out = ch.map((d) => { const o = new Float32Array(total); for (let i = 0; i < n; i++) o[i] = d[i] * dg; return o; });
  const tone = cfg.tone < 19999 ? biquad('lowpass', cfg.tone, Math.SQRT1_2, sr) : null;
  let cur = src;
  for (let k = 0; k < taps.length; k++) {
    const part = job.part(k / taps.length, 1 / taps.length);
    if (tone) cur = cur.map((d) => runBiquad(tone, d, new Float32Array(d.length)));
    if (cfg.semis) cur = await pitchShift(cur, sr, cfg.semis, part);
    const { t, g } = taps[k], gw = g * wg;
    for (let c = 0; c < C; c++) {
      if (ping && (k & 1) !== c) continue;       // ping-pong: left, right, left, …
      const r = ping ? cur[0] : cur[c], o = out[c];
      for (let i = 0; i < n; i++) o[t + i] += r[i] * gw;
    }
    await part.tick(1);
  }
  return trimTails({ ch: out, pre: 0 }, n);
}
const fxDelay = (input, p, job) => repeats(input, {
  mode: p.mode, time: p.time, fb: p.feedback / 100, first: 1, max: 64, semis: p.pitch, tone: p.tone, mix: p.mix,
}, job);
const fxEcho = (input, p, job) => repeats(input, {
  mode: 'regular', time: p.time, fb: p.decay / 100, first: p.decay / 100, max: p.count, semis: 0, tone: p.tone, mix: p.mix,
}, job);

/* ---------- Distortion */
const DIST_TYPES = [
  ['soft', 'Soft clip'], ['hard', 'Hard clip'], ['overdrive', 'Overdrive'], ['tube', 'Tube'], ['fuzz', 'Fuzz'],
  ['tape', 'Tape saturation'], ['fold', 'Wavefolder'], ['half', 'Half-wave rectifier'], ['full', 'Full-wave rectifier (octave up)'],
  ['crush', 'Bitcrusher'], ['rate', 'Sample rate reducer'],
];
// Shapers that lean to one side are shifted so silence stays exactly silent; the DC blocker removes the rest.
const FUZZ0 = Math.tanh(0.35), OD0 = 1.5 * (0.1 - 0.001 / 3);
const SHAPERS = {
  soft: (u) => Math.tanh(u),
  hard: (u) => (u > 1 ? 1 : u < -1 ? -1 : u),
  overdrive: (u) => { const v = u * 0.8 + 0.1; return (Math.abs(v) < 1 ? 1.5 * (v - v * v * v / 3) : Math.sign(v)) - OD0; },
  tube: (u) => (u >= 0 ? 1 - Math.exp(-u) : -(1 - Math.exp(1.5 * u)) / 1.5),
  fuzz: (u) => Math.tanh(3 * u + 0.35) - FUZZ0,
  tape: (u) => (2 / Math.PI) * Math.atan(u * Math.PI / 2),
  fold: (u) => { const v = (u + 1) / 4; return 1 - 4 * Math.abs(v - Math.floor(v) - 0.5); },
  half: (u) => Math.max(0, Math.tanh(u)) * 1.6,
  full: (u) => Math.abs(Math.tanh(u)) * 1.4,
};
async function fxDistortion({ sr, ch }, p, job) {
  const g = dbToGain(p.drive), n = ch[0].length, C = ch.length;
  const tone = p.tone < 19999 ? biquad('lowpass', p.tone, Math.SQRT1_2, sr) : null;
  const inRms = rmsOf(ch);
  const wet = [];
  for (let c = 0; c < C; c++) {
    const part = job.part(c / C, 1 / C), x = ch[c];
    let y;
    if (p.type === 'crush') {
      const q = Math.pow(2, clamp(Math.round(p.bits), 1, 16) - 1);
      y = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = clamp(x[i] * g, -1, 1); y[i] = Math.round(v * q) / q; }
    } else if (p.type === 'rate') {
      const step = clamp(p.rate, 100, sr) / sr;
      y = new Float32Array(n);
      let acc = 1, hold = 0;
      for (let i = 0; i < n; i++) { acc += step; if (acc >= 1) { acc -= 1; hold = clamp(x[i] * g, -1, 1); } y[i] = hold; }
    } else {
      y = await shapeOversampled(x, SHAPERS[p.type] || SHAPERS.soft, part);
      dcBlock(y, sr);
    }
    if (tone) runBiquad(tone, y);
    wet.push(y);
  }
  // Keep loudness: match the distorted sound's level to the original, so Drive changes character, not volume.
  let lg = dbToGain(p.out);
  if (p.level) { const r = rmsOf(wet); if (r > 1e-9 && inRms > 1e-9) lg *= inRms / r; }
  const [dg, wg] = mixGains(p.mix);
  const out = wet.map((y, c) => { const x = ch[c]; for (let i = 0; i < n; i++) y[i] = x[i] * dg + y[i] * wg * lg; return y; });
  return { ch: out, pre: 0 };
}

/* ---------- Compressor: feed-forward, soft knee, peak detector linked across channels, optional look-ahead */
function compCurve(xdb, p) {
  const T = p.threshold, R = p.ratio >= 20 ? 1e6 : Math.max(1, p.ratio), W = Math.max(0, p.knee), d = xdb - T;
  if (2 * d < -W) return xdb;
  if (W > 0 && 2 * Math.abs(d) <= W) return xdb + (1 / R - 1) * (d + W / 2) * (d + W / 2) / (2 * W);
  return T + d / R;
}
async function fxCompressor({ sr, ch }, p, job) {
  const n = ch[0].length, C = ch.length;
  const aA = Math.exp(-1 / (Math.max(0.05, p.attack) * 0.001 * sr)), aR = Math.exp(-1 / (Math.max(1, p.release) * 0.001 * sr));
  const look = Math.round(clamp(p.lookahead, 0, 50) * 0.001 * sr), gdb = new Float32Array(n);
  let gs = 0;
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + look);
    let lvl = 0;
    for (let c = 0; c < C; c++) { const v = Math.abs(ch[c][j]); if (v > lvl) lvl = v; }
    const xdb = lvl > 1e-9 ? 20 * Math.log10(lvl) : -180, gc = compCurve(xdb, p) - xdb;
    gs = gc < gs ? aA * gs + (1 - aA) * gc : aR * gs + (1 - aR) * gc;
    gdb[i] = gs;
    if ((i & 65535) === 0) await job.tick(i / n * 0.8);
  }
  const out = ch.map((x) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[i] * Math.pow(10, gdb[i] / 20); return y; });
  // Auto makeup brings the peak back to where it was, so the quieter parts end up louder.
  let mk = dbToGain(p.makeup || 0);
  if (p.auto) { const a = peakOf(ch), b = peakOf(out); mk = b > 1e-9 ? a / b : 1; }
  const [dg, wg] = p.mix >= 100 ? [0, 1] : [1 - p.mix / 100, p.mix / 100];   // parallel compression mixes linearly
  for (let c = 0; c < C; c++) { const x = ch[c], y = out[c]; for (let i = 0; i < n; i++) y[i] = x[i] * dg + y[i] * mk * wg; }
  return { ch: out, pre: 0 };
}
