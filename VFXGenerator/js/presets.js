'use strict';
// Built-in presets, and turning a preset into a document. Layers are listed bottom first.
// A preset can set: size (longest side of a frame), aspect (width / height), color, ramp (a
// RAMP_PRESETS name), edge and anim. Size and aspect left out keep a square at the current size.

const PRESETS = [
  { name: 'Soft glow', layers: [['glow', { p: { radius: 95, tight: 1.2 } }]] },
  { name: 'Hard dot', layers: [['glow', { p: { radius: 55, core: 75, falloff: 'smooth' } }]] },
  {
    name: 'Sparkle',
    layers: [
      ['star', { name: 'Diagonal rays', rot: 45, opacity: 70, p: { rays: 4, length: 50, width: 6, core: 0 } }],
      ['star', { p: { rays: 4, length: 95, width: 9, fade: 1.6, core: 60, coreSize: 22 } }],
    ],
  },
  {
    name: 'Lens flare', color: { mode: 'ramp' }, ramp: 'Electric',
    layers: [
      ['glow', { name: 'Streak', stretch: 1000, opacity: 80, p: { radius: 100, tight: 2.5 } }],
      ['ring', { name: 'Halo', opacity: 30, p: { radius: 60, width: 5, softIn: 100, softOut: 100 } }],
      ['star', { name: 'Rays', opacity: 45, p: { rays: 8, length: 75, width: 2, fade: 2.5, randLen: 40, core: 0, seed: 7 } }],
      ['glow', { name: 'Core', p: { radius: 50, tight: 1.5 } }],
    ],
  },
  { name: 'Shockwave', layers: [['ring', { p: { radius: 70, width: 22, softIn: 100, softOut: 20 } }]] },
  {
    name: 'Shockwave anim', size: 128, anim: { on: true, frames: 16, ease: 'out' },
    layers: [['ring', { p: { radius: 82, width: 18, softIn: 100, softOut: 15 }, a: { scA: 10, scB: 100, opA: 100, opB: 0 } }]],
  },
  {
    name: 'Spark', aspect: 4, color: { mode: 'ramp' }, ramp: 'Gold', edge: { mode: 'box', width: 6 },
    layers: [['spark', { p: { length: 700, width: 70, glowSize: 60 } }]],
  },
  { name: 'Smoke puff', layers: [['smoke', {}]] },
  {
    name: 'Smoke anim', size: 128, anim: { on: true, frames: 16, ease: 'out' },
    layers: [['smoke', { a: { scA: 60, scB: 105, opA: 100, opB: 0, evo: 1.5 } }]],
  },
  {
    name: 'Fireball', color: { mode: 'ramp', gain: 110 }, ramp: 'Fire',
    layers: [
      ['smoke', { name: 'Flames', p: { radius: 75, kind: 'ridged', scale: 3, warp: 80, density: 60, contrast: 1.6, seed: 3 } }],
      ['glow', { name: 'Heat', opacity: 70, p: { radius: 70, tight: 1.5 } }],
    ],
  },
  { name: 'Trail', size: 512, aspect: 4, edge: { mode: 'tb', width: 20 }, layers: [['trail', {}]] },
  { name: 'Lightning', color: { mode: 'ramp' }, ramp: 'Electric', layers: [['lightning', { a: { reseed: true } }]] },
  {
    name: 'Magic circle', color: { mode: 'ramp' }, ramp: 'Magic', edge: { mode: 'round', width: 5 },
    layers: [
      ['glow', { name: 'Glow', opacity: 30, p: { radius: 95, tight: 3 } }],
      ['ring', { name: 'Outer ring', p: { radius: 88, width: 3, softIn: 25, softOut: 25 } }],
      ['ring', { name: 'Dashes', p: { radius: 79, width: 2.5, softIn: 25, softOut: 25, dashes: 32, gap: 45 } }],
      ['shape', { name: 'Star', p: { shape: 'star', points: 6, depth: 75, style: 'outline', line: 2.5, size: 72 } }],
      ['ring', { name: 'Inner ring', p: { radius: 36, width: 2.5, softIn: 25, softOut: 25 } }],
    ],
  },
  {
    name: 'Heal plus', color: { mode: 'ramp' }, ramp: 'Heal',
    layers: [['shape', { p: { shape: 'cross', size: 70, thick: 34, round: 40, soft: 2, glow: 60, glowSize: 30 } }]],
  },
  {
    name: 'Cell edges', color: { mode: 'gray' }, edge: { mode: 'off' },
    layers: [['noise', { p: { kind: 'edges', scale: 5, detail: 2, rough: 40, contrast: 1.4 } }]],
  },
  {
    name: 'Packed masks', color: { mode: 'pack' }, edge: { mode: 'off' },
    layers: [
      ['glow', { name: 'R: glow', ch: 'r', p: { radius: 90, falloff: 'smooth' } }],
      ['noise', { name: 'G: noise', ch: 'g', p: { detail: 5 } }],
      ['noise', { name: 'B: cells', ch: 'b', p: { kind: 'cells', scale: 6, detail: 1 } }],
    ],
  },
];

// A preset as a complete document. Output settings, anti-aliasing and the ramp (unless the
// preset brings its own) carry over from `base`.
function presetDoc(pr, base) {
  const d = newDoc(), aspect = pr.aspect || 1;
  const side = pr.size || (base.anim.on ? 256 : Math.max(base.w, base.h));
  d.name = pr.name;
  d.w = aspect >= 1 ? side : Math.round(side * aspect);
  d.h = aspect >= 1 ? Math.round(side / aspect) : side;
  d.ss = base.ss;
  d.out = { ...base.out };
  Object.assign(d.color, pr.color);
  d.color.ramp = copyStops(pr.ramp ? RAMP_PRESETS[pr.ramp] : base.color.ramp);
  Object.assign(d.edge, pr.edge);
  Object.assign(d.anim, { fps: base.anim.fps }, pr.anim);
  d.layers = pr.layers.map(([type, o]) => makeLayer(type, o));
  return cleanDoc(d);
}

// A saved user preset (a whole document) applied on top of the current output settings.
function userPresetDoc(saved, base) {
  const d = cleanDoc(saved);
  d.out = { ...base.out };
  return d;
}
