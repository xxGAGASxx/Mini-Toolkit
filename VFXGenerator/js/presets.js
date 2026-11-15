'use strict';
// Built-in presets, and turning a preset into a document. Layers are listed bottom first.
// A preset can set: size (longest side of a frame), aspect (width / height), color, ramp (a
// RAMP_PRESETS name), edge and anim. Size and aspect left out keep a square at the current size.
// Layer options are those of makeLayer: placement, p (generator), d (dissolve), a (motion) and
// k (end values of animated settings, as 'p.radius' / 'd.amt').

const PRESET_GROUPS = [['still', 'Still', 'Single images'], ['anim', 'Animated', 'Flipbooks and variant sheets'], ['tile', 'Tiling', 'Tiling textures and masks']];

const withRamp = (name, more) => ({ color: { mode: 'ramp', ...more }, ramp: name });
const flipbook = (frames, more) => ({ on: true, frames, ...more });

const PRESETS = [
  /* ---------- still */
  { group: 'still', name: 'Soft glow', layers: [['glow', { p: { radius: 95, tight: 1.2 } }]] },
  { group: 'still', name: 'Hard dot', layers: [['glow', { p: { radius: 55, core: 75, falloff: 'smooth' } }]] },
  {
    group: 'still', name: 'Sparkle',
    layers: [
      ['star', { name: 'Diagonal rays', rot: 45, opacity: 70, p: { rays: 4, length: 50, width: 6, core: 0 } }],
      ['star', { p: { rays: 4, length: 95, width: 9, fade: 1.6, core: 60, coreSize: 22 } }],
    ],
  },
  {
    group: 'still', name: 'Star glint', ...withRamp('Gold'),
    layers: [
      ['ring', { name: 'Halo', opacity: 25, p: { radius: 52, width: 4, softIn: 100, softOut: 100 } }],
      ['star', { name: 'Fine rays', opacity: 70, p: { rays: 12, length: 85, width: 1.2, fade: 2.2, randLen: 55, core: 0, seed: 5 } }],
      ['star', { name: 'Main rays', p: { rays: 4, length: 98, width: 4, fade: 1.4, core: 0 } }],
      ['glow', { name: 'Core', p: { radius: 38, tight: 1.6 } }],
    ],
  },
  {
    group: 'still', name: 'Lens flare', ...withRamp('Electric'),
    layers: [
      ['glow', { name: 'Streak', stretch: 1000, opacity: 80, p: { radius: 100, tight: 2.5 } }],
      ['ring', { name: 'Halo', opacity: 30, p: { radius: 60, width: 5, softIn: 100, softOut: 100 } }],
      ['star', { name: 'Rays', opacity: 45, p: { rays: 8, length: 75, width: 2, fade: 2.5, randLen: 40, core: 0, seed: 7 } }],
      ['glow', { name: 'Core', p: { radius: 50, tight: 1.5 } }],
    ],
  },
  {
    group: 'still', name: 'Bokeh',
    layers: [
      ['shape', { name: 'Fill', opacity: 35, p: { shape: 'polygon', sides: 6, size: 72, round: 25, soft: 5 } }],
      ['shape', { name: 'Rim', opacity: 60, p: { shape: 'polygon', sides: 6, size: 70, round: 25, style: 'outline', line: 5, soft: 5 } }],
    ],
  },
  { group: 'still', name: 'Shockwave', layers: [['ring', { p: { radius: 70, width: 22, softIn: 100, softOut: 20 } }]] },
  {
    group: 'still', name: 'Spark', aspect: 4, ...withRamp('Gold'), edge: { mode: 'box', width: 6 },
    layers: [['spark', { p: { length: 700, width: 70, glowSize: 60 } }]],
  },
  {
    group: 'still', name: 'Muzzle flash', ...withRamp('Fire', { gain: 110 }),
    layers: [
      ['glow', { name: 'Heat', opacity: 80, p: { radius: 55, tight: 1.3 } }],
      ['star', { name: 'Flames', p: { rays: 6, length: 92, width: 16, taper: 100, fade: 1.1, randLen: 55, randAng: 35, core: 70, coreSize: 32, seed: 4 } }],
    ],
  },
  {
    group: 'still', name: 'Impact burst', ...withRamp('Fire', { gain: 110 }),
    layers: [
      ['particles', { name: 'Sparks', p: { count: 36, spread: 20, size: 2.4, elong: 450, travel: 55, speedVar: 60, seed: 3 } }],
      ['star', { name: 'Rays', p: { rays: 12, length: 90, width: 6, randLen: 60, randAng: 40, core: 70, coreSize: 32, seed: 9 } }],
    ],
  },
  { group: 'still', name: 'Smoke puff', layers: [['smoke', {}]] },
  {
    group: 'still', name: 'Fireball', ...withRamp('Fire', { gain: 110 }),
    layers: [
      ['smoke', { name: 'Flames', p: { radius: 75, kind: 'ridged', scale: 3, warp: 80, density: 60, contrast: 1.6, seed: 3 } }],
      ['glow', { name: 'Heat', opacity: 70, p: { radius: 70, tight: 1.5 } }],
    ],
  },
  {
    group: 'still', name: 'Flame', size: 256, aspect: 0.5, ...withRamp('Fire'), edge: { mode: 'box', width: 5 },
    layers: [['flame', { scale: 185, y: -4, p: { width: 90, tip: 0.7, seed: 3 } }]],
  },
  { group: 'still', name: 'Trail', size: 512, aspect: 4, edge: { mode: 'tb', width: 20 }, layers: [['trail', {}]] },
  {
    group: 'still', name: 'Laser beam', size: 512, aspect: 4, edge: { mode: 'tb', width: 25 },
    layers: [['trail', { p: { width: 40, core: 100, seamless: true, streaks: 25, sScale: 3 } }]],
  },
  {
    group: 'still', name: 'Energy trail', size: 512, aspect: 4, ...withRamp('Magic'), edge: { mode: 'tb', width: 15 },
    layers: [['trail', { p: { width: 80, core: 40, tail: 90, streaks: 85, sScale: 6, sDetail: 4, seed: 6 } }]],
  },
  {
    group: 'still', name: 'Slash', ...withRamp('Ice', { gain: 130 }), edge: { mode: 'box', width: 6 },
    layers: [['slash', { y: -38, scale: 125, p: { sweep: 150, width: 42 } }]],
  },
  { group: 'still', name: 'Lightning', ...withRamp('Electric'), layers: [['lightning', { a: { reseed: true } }]] },
  {
    group: 'still', name: 'Magic circle', ...withRamp('Magic'), edge: { mode: 'round', width: 5 },
    layers: [
      ['glow', { name: 'Glow', opacity: 30, p: { radius: 95, tight: 3 } }],
      ['ring', { name: 'Outer ring', p: { radius: 88, width: 3, softIn: 25, softOut: 25 } }],
      ['ring', { name: 'Dashes', p: { radius: 79, width: 2.5, softIn: 25, softOut: 25, dashes: 32, gap: 45 } }],
      ['shape', { name: 'Star', p: { shape: 'star', points: 6, depth: 25, style: 'outline', line: 2.5, size: 72 } }],
      ['ring', { name: 'Inner ring', p: { radius: 36, width: 2.5, softIn: 25, softOut: 25 } }],
    ],
  },
  {
    group: 'still', name: 'Rune circle', ...withRamp('Magic'), edge: { mode: 'round', width: 5 },
    layers: [
      ['glow', { name: 'Glow', opacity: 30, p: { radius: 95, tight: 3 } }],
      ['ring', { name: 'Outer ring', p: { radius: 91, width: 2.5, softIn: 25, softOut: 25 } }],
      ['runes', { name: 'Runes', p: { count: 18, radius: 78, size: 12, width: 1.5, seed: 4 } }],
      ['ring', { name: 'Inner ring', p: { radius: 65, width: 2, softIn: 25, softOut: 25 } }],
      ['shape', { name: 'Hexagram', p: { shape: 'star', points: 6, depth: 25, style: 'outline', line: 2, size: 64 } }],
      ['shape', { name: 'Hexagon', opacity: 70, p: { shape: 'polygon', sides: 6, style: 'outline', line: 1.6, size: 33 } }],
    ],
  },
  {
    group: 'still', name: 'Sigil', ...withRamp('Gold'), edge: { mode: 'round', width: 5 },
    layers: [
      ['ring', { name: 'Ring', p: { radius: 86, width: 3, softIn: 30, softOut: 30 } }],
      ['runes', { name: 'Glyph', p: { count: 1, radius: 0, size: 125, strokes: 6, width: 4, glow: 10, glowAmt: 55, seed: 12 } }],
    ],
  },
  {
    group: 'still', name: 'Portal', ...withRamp('Magic', { gain: 110 }),
    layers: [
      ['glow', { name: 'Depth', opacity: 55, p: { radius: 80, tight: 1.4 } }],
      ['vortex', { name: 'Swirl', p: { arms: 4, twist: 330, width: 50, hole: 22, breakup: 50 } }],
      ['ring', { name: 'Rim', opacity: 80, p: { radius: 84, width: 7, softIn: 100, softOut: 30 } }],
    ],
  },
  {
    group: 'still', name: 'Heal plus', ...withRamp('Heal'),
    layers: [['shape', { p: { shape: 'cross', size: 70, thick: 34, round: 40, soft: 2, glow: 60, glowSize: 30 } }]],
  },
  { group: 'still', name: 'Ground crack', layers: [['cracks', { p: { count: 8, width: 2.2, seed: 2 } }]] },
  {
    group: 'still', name: 'Lava cracks', ...withRamp('Fire', { gain: 120 }),
    layers: [
      ['glow', { name: 'Heat', opacity: 45, p: { radius: 45, tight: 1.4 } }],
      ['cracks', { name: 'Cracks', p: { count: 8, width: 2.4, glow: 14, glowAmt: 70, seed: 2 } }],
    ],
  },
  {
    group: 'still', name: 'Shattered glass',
    layers: [['cracks', { p: { count: 10, length: 100, lenVar: 25, jag: 20, branches: 15, rings: 3, width: 0.9, taper: 25, soft: 30, seed: 6 } }]],
  },
  { group: 'still', name: 'Blood splat', ...withRamp('Blood'), layers: [['splatter', { p: { seed: 2 } }]] },
  {
    group: 'still', name: 'Slime splat', ...withRamp('Slime'),
    layers: [['splatter', { p: { size: 42, lumps: 75, drops: 10, streak: 15, dropSize: 40, specks: 15, rough: 20, seed: 7 } }]],
  },
  {
    group: 'still', name: 'Snowflake', ...withRamp('Ice'),
    layers: [
      ['glow', { name: 'Glow', opacity: 40, p: { radius: 40, tight: 2 } }],
      ['crystal', { name: 'Flake', p: { twigs: 50, seed: 5 } }],
    ],
  },

  /* ---------- animated: flipbooks, and sheets of random variants */
  {
    group: 'anim', name: 'Shockwave anim', size: 128, anim: flipbook(16, { ease: 'out' }),
    layers: [['ring', { p: { radius: 82, width: 18, softIn: 100, softOut: 15 }, a: { scA: 10, scB: 100, opA: 100, opB: 0 } }]],
  },
  {
    group: 'anim', name: 'Water ripple', size: 128, anim: flipbook(16, { ease: 'out' }),
    layers: [
      ['ring', { name: 'Outer', p: { radius: 85, width: 9, softIn: 100, softOut: 50 }, a: { scA: 5, scB: 100, opB: 0 } }],
      ['ring', { name: 'Middle', opacity: 70, p: { radius: 58, width: 8, softIn: 100, softOut: 50 }, a: { scA: 5, scB: 100, opB: 0 } }],
      ['ring', { name: 'Inner', opacity: 45, p: { radius: 32, width: 7, softIn: 100, softOut: 50 }, a: { scA: 5, scB: 100, opB: 0 } }],
    ],
  },
  {
    group: 'anim', name: 'Hit flash', size: 128, anim: flipbook(12, { ease: 'out' }),
    layers: [
      ['glow', { name: 'Flash', p: { radius: 70 }, a: { scA: 40, scB: 130, opB: 0 } }],
      ['ring', { name: 'Ring', p: { radius: 80, width: 30, softIn: 100, softOut: 20 }, k: { 'p.width': 3 }, a: { scA: 15, scB: 110, opB: 20 } }],
      ['star', { name: 'Rays', p: { rays: 8, length: 90, width: 7, randLen: 50, core: 0, seed: 3 }, a: { scA: 50, scB: 130, opB: 0, rot: 15 } }],
      ['particles', { name: 'Sparks', p: { count: 24, spread: 15, size: 2.5, elong: 400, speedVar: 60, travel: 5 }, k: { 'p.travel': 90 }, a: { opB: 0 } }],
    ],
  },
  {
    group: 'anim', name: 'Explosion', size: 256, ...withRamp('Fire', { gain: 115 }), anim: flipbook(16),
    layers: [
      ['smoke', { name: 'Fire', p: { radius: 85, warp: 80, density: 62, contrast: 1.5, seed: 11 }, d: { from: 'out', soft: 35, burn: 55 },
        k: { 'd.amt': 92, 'p.density': 42 }, a: { scA: 45, scB: 110, evo: 1.5 } }],
      ['glow', { name: 'Flash', p: { radius: 80, tight: 1.5 }, a: { scA: 60, scB: 120, opB: 0 } }],
    ],
  },
  {
    group: 'anim', name: 'Smoke anim', size: 128, anim: flipbook(16, { ease: 'out' }),
    layers: [['smoke', { a: { scA: 60, scB: 105, opA: 100, opB: 0, evo: 1.5 } }]],
  },
  {
    group: 'anim', name: 'Smoke dissipate', size: 128, anim: flipbook(16),
    layers: [['smoke', { p: { density: 60 }, d: { from: 'out', soft: 50, scale: 4 }, k: { 'd.amt': 100 }, a: { scA: 70, scB: 110, evo: 1 } }]],
  },
  {
    group: 'anim', name: 'Fire loop', size: 256, aspect: 0.5, ...withRamp('Fire'), edge: { mode: 'box', width: 5 }, anim: flipbook(16, { loop: true }),
    layers: [['flame', { scale: 185, y: -4, p: { width: 90, tip: 0.7, seed: 3 }, a: { evo: 1 } }]],
  },
  {
    group: 'anim', name: 'Rising embers', size: 256, ...withRamp('Fire', { gain: 160 }), anim: flipbook(16),
    layers: [['particles', { y: -45, p: { count: 60, area: 'square', spread: 55, cluster: 10, size: 4.5, elong: 170, dim: 50, dir: 'up', speedVar: 70, twinkle: 60, seed: 5 },
      k: { 'p.travel': 110 }, a: { opB: 30, flk: 15, evo: 2 } }]],
  },
  {
    group: 'anim', name: 'Slash swipe', size: 256, ...withRamp('Ice', { gain: 130 }), edge: { mode: 'box', width: 6 }, anim: flipbook(12),
    layers: [['slash', { y: -38, scale: 125, p: { sweep: 160, width: 34, tailAt: 0, headAt: 50 }, k: { 'p.tailAt': 65, 'p.headAt': 100 }, a: { opB: 15 } }]],
  },
  {
    group: 'anim', name: 'Lightning strike', size: 256, aspect: 0.5, ...withRamp('Electric'), anim: flipbook(8, { ease: 'out' }),
    layers: [
      ['glow', { name: 'Flash', opacity: 50, p: { radius: 100, tight: 1.6 }, a: { opA: 0, opB: 100 } }],
      ['lightning', { name: 'Bolt', rot: -90, scale: 190, p: { reveal: 0, seed: 4 }, k: { 'p.reveal': 100 } }],
    ],
  },
  {
    group: 'anim', name: 'Electric orb', size: 128, ...withRamp('Electric'), anim: flipbook(16),
    layers: [
      ['glow', { name: 'Glow', p: { radius: 60, tight: 1.4 }, a: { flk: 40 } }],
      ['lightning', { name: 'Arc 1', p: { length: 150, jag: 60, branches: 20, width: 1.4, glow: 10 }, a: { reseed: true, flk: 30 } }],
      ['lightning', { name: 'Arc 2', rot: 60, p: { length: 150, jag: 60, branches: 20, width: 1.4, glow: 10, seed: 2 }, a: { reseed: true, flk: 30 } }],
      ['lightning', { name: 'Arc 3', rot: 120, p: { length: 150, jag: 60, branches: 20, width: 1.4, glow: 10, seed: 3 }, a: { reseed: true, flk: 30 } }],
      ['glow', { name: 'Core', p: { radius: 28, core: 40 } }],
    ],
  },
  {
    group: 'anim', name: 'Charge-up', size: 256, ...withRamp('Electric', { gain: 110 }), anim: flipbook(16, { ease: 'in' }),
    layers: [
      ['particles', { name: 'Inflow', p: { count: 60, spread: 95, cluster: 0, area: 'ring', size: 3.5, elong: 350, dir: 'in', speedVar: 40, seed: 2 }, k: { 'p.travel': 100 } }],
      ['ring', { name: 'Ring', p: { radius: 80, width: 4, softIn: 100, softOut: 60 }, a: { scA: 130, scB: 10, opA: 20, opB: 100 } }],
      ['glow', { name: 'Core', p: { radius: 55, tight: 1.5 }, a: { scA: 20, scB: 100, opA: 30, opB: 100 } }],
    ],
  },
  {
    group: 'anim', name: 'Twinkle', size: 128, anim: flipbook(16, { loop: true }),
    layers: [
      ['star', { name: 'Diagonal rays', rot: 45, opacity: 60, p: { rays: 4, length: 55, width: 6, core: 0 }, a: { rot: 90, pls: 80, plsN: 1, plsTo: 'both' } }],
      ['star', { name: 'Star', p: { rays: 4, length: 95, width: 9, fade: 1.6, core: 60, coreSize: 22 }, a: { rot: 90, pls: 60, plsN: 1, plsTo: 'both' } }],
    ],
  },
  {
    group: 'anim', name: 'Heal pulse', size: 128, ...withRamp('Heal'), anim: flipbook(16, { loop: true }),
    layers: [['shape', { p: { shape: 'cross', size: 62, thick: 34, round: 40, soft: 2, glow: 60, glowSize: 30 }, a: { pls: 45, plsN: 1, plsTo: 'both' } }]],
  },
  {
    group: 'anim', name: 'Magic circle spin', size: 256, ...withRamp('Magic'), edge: { mode: 'round', width: 5 }, anim: flipbook(16, { loop: true }),
    layers: [
      ['glow', { name: 'Glow', opacity: 30, p: { radius: 95, tight: 3 }, a: { pls: 30, plsN: 1 } }],
      ['ring', { name: 'Outer ring', p: { radius: 91, width: 2.5, softIn: 25, softOut: 25 } }],
      ['runes', { name: 'Runes', p: { count: 18, radius: 78, size: 12, width: 1.5, seed: 4 } }],
      ['ring', { name: 'Dashes', p: { radius: 66, width: 2.5, softIn: 25, softOut: 25, dashes: 24, gap: 40 }, a: { rot: -15 } }],
      ['shape', { name: 'Hexagram', p: { shape: 'star', points: 6, depth: 25, style: 'outline', line: 2, size: 60 }, a: { rot: 60 } }],
    ],
  },
  {
    group: 'anim', name: 'Portal loop', size: 256, ...withRamp('Magic', { gain: 110 }), anim: flipbook(16, { loop: true }),
    layers: [
      ['glow', { name: 'Depth', opacity: 55, p: { radius: 80, tight: 1.4 } }],
      ['vortex', { name: 'Swirl', p: { arms: 4, twist: 330, width: 50, hole: 22, breakup: 50 }, a: { rot: -90, evo: 1 } }],
      ['ring', { name: 'Rim', opacity: 80, p: { radius: 84, width: 7, softIn: 100, softOut: 30 } }],
    ],
  },
  {
    group: 'anim', name: 'Crack open', size: 256, anim: flipbook(12, { ease: 'out' }),
    layers: [
      ['glow', { name: 'Flash', opacity: 60, p: { radius: 50 }, a: { opB: 0 } }],
      ['cracks', { name: 'Cracks', p: { count: 8, width: 2.2, spread: 0, seed: 2 }, k: { 'p.spread': 100 } }],
    ],
  },
  {
    group: 'anim', name: 'Frost grow', size: 256, ...withRamp('Ice'), anim: flipbook(16, { ease: 'out' }),
    layers: [['crystal', { p: { twigs: 50, grow: 0, seed: 5 }, k: { 'p.grow': 100 } }]],
  },
  {
    group: 'anim', name: 'Smoke variants', size: 128, anim: flipbook(16),
    layers: [['smoke', { a: { reseed: true } }]],
  },
  {
    group: 'anim', name: 'Bolt variants', size: 128, ...withRamp('Electric'), anim: flipbook(16),
    layers: [['lightning', { a: { reseed: true } }]],
  },
  {
    group: 'anim', name: 'Splat variants', size: 128, ...withRamp('Blood'), anim: flipbook(16),
    layers: [['splatter', { a: { reseed: true } }]],
  },
  {
    group: 'anim', name: 'Caustics loop', size: 256, color: { mode: 'gray' }, edge: { mode: 'off' }, anim: flipbook(16, { loop: true }),
    layers: [['caustics', { a: { evo: 1 } }]],
  },
  {
    group: 'anim', name: 'Cloud loop', size: 256, ...withRamp('Smoke', { rampAlpha: false }), edge: { mode: 'off' }, anim: flipbook(16, { loop: true }),
    layers: [['noise', { p: { kind: 'billow', scale: 3, detail: 6, contrast: 1.3 }, a: { evo: 1 } }]],
  },

  /* ---------- tiling textures and masks */
  {
    group: 'tile', name: 'Cell edges', color: { mode: 'gray' }, edge: { mode: 'off' },
    layers: [['noise', { p: { kind: 'edges', scale: 5, detail: 2, rough: 40, contrast: 1.4 } }]],
  },
  { group: 'tile', name: 'Caustics', color: { mode: 'gray' }, edge: { mode: 'off' }, layers: [['caustics', {}]] },
  {
    group: 'tile', name: 'Tiling clouds', ...withRamp('Smoke', { rampAlpha: false }), edge: { mode: 'off' },
    layers: [['noise', { p: { kind: 'billow', scale: 3, detail: 6, contrast: 1.3 } }]],
  },
  {
    group: 'tile', name: 'Dissolve mask', color: { mode: 'gray' }, edge: { mode: 'off' },
    layers: [['noise', { p: { scale: 6, detail: 5, contrast: 1.6 } }]],
  },
  {
    group: 'tile', name: 'Vignette mask', color: { mode: 'gray' }, edge: { mode: 'off' },
    layers: [['gradient', { p: { kind: 'radial', size: 141, curve: 1.6, start: 100, end: 0 } }]],
  },
  {
    group: 'tile', name: 'Stripes', color: { mode: 'gray' }, edge: { mode: 'off' },
    layers: [['gradient', { p: { repeat: 8, zigzag: true, curve: 1.5 } }]],
  },
  {
    group: 'tile', name: 'Packed masks', color: { mode: 'pack' }, edge: { mode: 'off' },
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
