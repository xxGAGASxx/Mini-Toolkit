'use strict';
// Two built-in sounds to try the tools on, synthesized on the spot.

// A two-bar drum loop with bass and a chord stab, stereo, 120 BPM. Good for the effects and Compressor.
function sampleBeat() {
  const sr = 48000, beat = 0.5, n = Math.round(sr * beat * 8 + sr * 0.6), L = new Float32Array(n), R = new Float32Array(n), r = rng(11);
  const add = (t, len, fn, pan = 0) => {
    const s0 = Math.round(t * sr), m = Math.round(len * sr), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < m && s0 + i < n; i++) { const v = fn(i / sr); L[s0 + i] += v * gl * 1.41; R[s0 + i] += v * gr * 1.41; }
  };
  const kick = (t) => Math.sin(2 * Math.PI * (45 * t + 90 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 7) * 0.9;
  const snare = (t) => ((r() * 2 - 1) * 0.5 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-t * 25));
  const hat = (t) => (r() * 2 - 1) * 0.16 * Math.exp(-t * 60);
  for (let b = 0; b < 8; b++) {
    const t = b * beat;
    if (b % 2 === 0 || b === 7) add(t, 0.45, kick);
    if (b % 2 === 1) add(t, 0.3, snare, 0.1);
    add(t, 0.08, hat, -0.4); add(t + beat / 2, 0.08, hat, 0.4);
  }
  const bassNotes = [55, 55, 65.41, 49], saw = (f, t) => 2 * ((f * t) % 1) - 1;
  bassNotes.forEach((f, i) => add(i * beat * 2, beat * 1.8, (t) => {
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    return v * 0.22 * Math.min(1, t * 200) * Math.exp(-t * 1.2);
  }));
  for (const [t, f] of [[beat * 1.5, 220], [beat * 5.5, 196]]) {
    for (const [k, pan] of [[1, -0.5], [1.26, 0], [1.5, 0.5]]) add(t, 0.35, (u) => saw(f * k, u) * 0.07 * Math.exp(-u * 9), pan);
  }
  const pk = peakOf([L, R]);
  for (const d of [L, R]) for (let i = 0; i < n; i++) d[i] *= 0.89 / pk;
  return makeAudio(sr, [L, R]);
}

// Three sung-like phrases with silent gaps, on top of hiss and 50 Hz hum. Good for Noise reduction, Hum
// removal and Split at silences.
function sampleNoisy() {
  const sr = 44100, n = Math.round(sr * 6.5), d = new Float32Array(n), r = rng(23);
  const vowels = { a: [800, 1150, 2900], e: [400, 2000, 2550], o: [450, 800, 2830] };
  const phrase = (t0, len, f0, vw) => {
    const s0 = Math.round(t0 * sr), m = Math.round(len * sr), src = new Float32Array(m);
    let ph = 0;
    for (let i = 0; i < m; i++) {
      const t = i / sr, f = f0 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t)) * (1 + 0.05 * Math.sin(Math.PI * t / len));
      ph += f / sr;
      let v = 0;
      for (let h = 1; h <= 30; h++) if (f * h < sr / 2) v += Math.sin(2 * Math.PI * ph * h) / h;
      const env = Math.min(1, t / 0.06) * Math.min(1, (len - t) / 0.12);
      src[i] = v * env;
    }
    const out = new Float32Array(m);
    for (const [fc, g] of vowels[vw].map((f, k) => [f, [1, 0.6, 0.25][k]])) {
      const y = runBiquad(biquad('bandpass', fc, 6, sr), src, new Float32Array(m));
      for (let i = 0; i < m; i++) out[i] += y[i] * g;
    }
    for (let i = 0; i < m && s0 + i < n; i++) d[s0 + i] += out[i] * 0.55;
  };
  phrase(0.5, 1.4, 196, 'a');
  phrase(2.6, 1.1, 247, 'e');
  phrase(4.4, 1.6, 220, 'o');
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] += (r() - 0.5) * 0.03 + 0.05 * Math.sin(2 * Math.PI * 50 * t) + 0.025 * Math.sin(2 * Math.PI * 150 * t + 1) + 0.012 * Math.sin(2 * Math.PI * 250 * t + 2);
  }
  const pk = peakOf([d]);
  for (let i = 0; i < n; i++) d[i] *= 0.8 / pk;
  return makeAudio(sr, [d]);
}
