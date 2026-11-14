'use strict';
// The live settings (Color, Effects, Tiling) and the order they run in. Every step's result is kept,
// keyed by its settings and everything before it, so moving one slider only reruns that step and the
// ones after it.

const DEFAULTS = {
  wrap: false,   // blur, sharpen, noise and shadows/highlights wrap around the edges (for tiling textures)
  bc: { on: true, bri: 0, con: 0, inv: false },
  hs: { on: true, hue: 0, sat: 0, lig: 0, colorize: false },
  sh: { on: true, sha: 0, hil: 0, width: 50, radius: 20 },
  blur: { on: false, mode: 'blur', radius: 2, amount: 100 },
  pix: { on: false, size: 8, mode: 'avg', levels: 0 },
  noise: { on: false, amount: 20, dist: 'gauss', mono: true, grain: 1, seed: 1 },
  grad: { on: false, type: 'linear', angle: 90, scale: 100, c1: '#000000', a1: 100, c2: '#ffffff', a2: 100, rev: false, blend: 'overlay', opacity: 50 },
  pat: { on: false, type: 'checker', size: 32, angle: 0, thick: 30, fg: '#000000', fa: 100, bg: '#ffffff', ba: 0, fit: true, seed: 1, blend: 'normal', opacity: 50 },
  outline: { on: false, size: 3, pos: 'outside', color: '#000000', alpha: 100, thr: 50 },
  bal: { on: false, strength: 100, radius: 12, mode: 'lum' },
  seam: { on: false, method: 'cross', width: 50, axis: 'xy', keep: true },
  off: { on: false, x: 50, y: 50 },
};
const clonePar = (p) => JSON.parse(JSON.stringify(p));

// Images the settings refer to (a custom pattern tile). Kept outside the settings so undo stays light.
const assets = { pattern: null };

const STAGES = [
  { id: 'bal', on: (p) => p.bal.on && p.bal.strength > 0, run: (img, p) => tileBalance(img, p.bal) },
  { id: 'bc', on: (p) => p.bc.on && (p.bc.bri !== 0 || p.bc.con !== 0 || p.bc.inv), run: (img, p) => colorBC(img, p.bc) },
  { id: 'hs', on: (p) => p.hs.on && (p.hs.hue !== 0 || p.hs.sat !== 0 || p.hs.lig !== 0 || p.hs.colorize), run: (img, p) => colorHS(img, p.hs) },
  { id: 'sh', wrap: true, on: (p) => p.sh.on && (p.sh.sha !== 0 || p.sh.hil !== 0), run: (img, p) => colorSH(img, p.sh, p.wrap) },
  { id: 'blur', wrap: true, on: (p) => p.blur.on && p.blur.radius > 0 && (p.blur.mode === 'blur' || p.blur.amount > 0), run: (img, p) => fxBlur(img, p.blur, p.wrap) },
  { id: 'pix', on: (p) => p.pix.on && (p.pix.size > 1 || p.pix.levels >= 2), run: (img, p) => fxPixelate(img, p.pix) },
  { id: 'noise', wrap: true, on: (p) => p.noise.on && p.noise.amount > 0, run: (img, p) => fxNoise(img, p.noise, p.wrap) },
  { id: 'grad', on: (p) => p.grad.on && p.grad.opacity > 0, run: (img, p) => fxGradient(img, p.grad) },
  {
    id: 'pat',
    on: (p) => p.pat.on && p.pat.opacity > 0 && (p.pat.type !== 'image' || !!assets.pattern),
    run: (img, p) => fxPattern(img, p.pat, assets.pattern),
    extra: () => (assets.pattern ? assets.pattern.id : 0),
  },
  { id: 'outline', on: (p) => p.outline.on && p.outline.size > 0 && p.outline.alpha > 0, run: (img, p) => fxOutline(img, p.outline) },
  { id: 'seam', on: (p) => p.seam.on && p.seam.width > 0, run: (img, p) => tileSeam(img, p.seam) },
  {
    id: 'off',
    on: (p) => p.off.on && (p.off.x % 100 !== 0 || p.off.y % 100 !== 0),
    run: (img, p) => offsetWrap(img, Math.round((p.off.x / 100) * img.w), Math.round((p.off.y / 100) * img.h)),
  },
];
const anyStageOn = (p) => STAGES.some((s) => s.on(p));

const stageCache = new Map();
const lastRun = { ms: 0, failed: '' };

// The base image with every active step applied. Returns base itself when nothing is active.
function runPipeline(base, p) {
  let img = base, key = 'b' + base.id, ran = false;
  const t0 = performance.now();
  lastRun.failed = '';
  for (const st of STAGES) {
    if (!st.on(p)) { stageCache.delete(st.id); continue; }
    key += `>${st.id}${JSON.stringify(p[st.id])}${st.wrap ? (p.wrap ? 'w' : 'c') : ''}${st.extra ? st.extra() : ''}`;
    const hit = stageCache.get(st.id);
    if (hit && hit.key === key) { img = hit.img; continue; }
    try {
      img = st.run(img, p);
      stageCache.set(st.id, { key, img });
      ran = true;
    } catch (err) {
      console.error(err);
      stageCache.delete(st.id);
      lastRun.failed = st.id;
    }
  }
  if (ran) lastRun.ms = performance.now() - t0;
  return img;
}
