'use strict';
// Constants, app state, element references, the sprite model and cell geometry.

const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];
const ANCHORS = [
  [0, 0, 'Top left'], [0.5, 0, 'Top center'], [1, 0, 'Top right'],
  [0, 0.5, 'Middle left'], [0.5, 0.5, 'Center'], [1, 0.5, 'Middle right'],
  [0, 1, 'Bottom left'], [0.5, 1, 'Bottom center'], [1, 1, 'Bottom right'],
];

const state = {
  sprites: [],          // { id, name, src, data, w, h, ax, ay, ox, oy, adj, proc, dirty, sample }
  sel: null,            // selected sprite id
  cols: 4, pad: 2, cellW: 0, cellH: 0, zoom: 4,
  align: [0.5, 1],      // last "align all" anchor, also used for new sprites
  global: { ...DEF },
  tab: 'main', frame: 0, playing: false, fps: 12,
  onionPrev: false, onionNext: false, onionN: 1, onionA: 35,
  scale: 1, bg: '#ffffff', transparent: true,
};
let uid = 1, busy = false;

const els = {
  stats: $('#stats'), file: $('#file'), drop: $('#drop'),
  tabMain: $('#tab-main'), tabPrev: $('#tab-preview'),
  sideMain: $('#side-main'), sidePrev: $('#side-preview'),
  viewMain: $('#view-main'), viewPrev: $('#view-preview'),
  sheet: $('#sheet'), sheetWrap: $('#sheet-wrap'), empty: $('#empty'), sample: $('#sample-note'),
  cols: $('#cols'), pad: $('#pad'), cw: $('#cell-w'), ch: $('#cell-h'), zoom: $('#zoom'),
  alignAll: $('#align-all'), alignFrame: $('#align-frame'),
  dup: $('#btn-dup'), del: $('#btn-del'), rev: $('#btn-rev'), clear: $('#btn-clear'),
  adjTarget: $('#adj-target'), adjReset: $('#adj-reset'),
  pvWrap: $('#pv-wrap'), pv: $('#pv'), pvEmpty: $('#pv-empty'),
  prev: $('#btn-prev'), play: $('#btn-play'), next: $('#btn-next'),
  frame: $('#frame'), frameLabel: $('#frame-label'), fps: $('#fps'),
  frameTitle: $('#frame-title'), frameInfo: $('#frame-info'),
  offX: $('#off-x'), offY: $('#off-y'), offReset: $('#off-reset'),
  onionPrev: $('#onion-prev'), onionNext: $('#onion-next'), onionN: $('#onion-n'), onionA: $('#onion-a'), onionAOut: $('#onion-a-out'),
  scale: $('#scale'), bg: $('#bg'), transp: $('#transp'), exNote: $('#ex-note'), exportBtns: $$('.ex'),
};

const selIdx = () => state.sprites.findIndex((s) => s.id === state.sel);
const selected = () => state.sprites.find((s) => s.id === state.sel) || null;
const cur = () => state.sprites[state.frame] || null;

function cell() {
  let w = 1, h = 1;
  for (const s of state.sprites) { if (s.w > w) w = s.w; if (s.h > h) h = s.h; }
  return [state.cellW || w, state.cellH || h, w, h];
}
const effCols = () => Math.max(1, Math.min(state.cols, state.sprites.length || 1));
const pos = (s, cw, ch) => [Math.round((cw - s.w) * s.ax) + s.ox, Math.round((ch - s.h) * s.ay) + s.oy];

function makeSprite(src, name, sample) {
  const w = src.width, h = src.height;
  return {
    id: uid++, name, src, w, h,
    data: src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h),
    ax: state.align[0], ay: state.align[1], ox: 0, oy: 0,
    adj: { ...DEF }, proc: null, dirty: true, sample: !!sample,
  };
}
