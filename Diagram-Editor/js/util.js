'use strict';
// Small helpers shared by all modules.

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = n => Math.round(n * 100) / 100;               // short numbers for SVG output
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 2D vector helpers
const P = (x, y) => ({ x, y });
const add = (a, b) => P(a.x + b.x, a.y + b.y);
const sub = (a, b) => P(a.x - b.x, a.y - b.y);
const mul = (a, k) => P(a.x * k, a.y * k);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const unit = (x, y) => { const l = Math.hypot(x, y); return l ? P(x / l, y / l) : P(0, 0); };
const pt = p => fmt(p.x) + ',' + fmt(p.y);

function hashString(s) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (h2 * 33 + c) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function dataURLToBlob(url) {
  const comma = url.indexOf(',');
  const head = url.slice(0, comma), body = url.slice(comma + 1);
  const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type: mime });
  const bin = atob(body), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const readFile = (file, as = 'DataURL') => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r['readAs' + as](file);
});

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not load image'));
  img.src = src;
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- Text measuring & wrapping (canvas measureText matches SVG text closely) ----
const measureCtx = document.createElement('canvas').getContext('2d');

function fontStack(family) {
  const generic = /courier|mono/i.test(family) ? 'monospace' : /georgia|times|serif/i.test(family) ? 'serif' : 'sans-serif';
  return `'${family}', ${generic}`;
}
function fontCSS(o, size = o.fontSize) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${size}px ${fontStack(o.fontFamily)}`;
}
function textWidth(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Greedy word wrap. Honors manual line breaks; breaks words that are longer than the line.
function wrapText(text, font, maxWidth) {
  measureCtx.font = font;
  const W = s => measureCtx.measureText(s).width;
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (!line || W(test) <= maxWidth) line = test;
      else { lines.push(line); line = word; }
      while (line.length > 1 && W(line) > maxWidth) {
        let i = line.length - 1;
        while (i > 1 && W(line.slice(0, i)) > maxWidth) i--;
        lines.push(line.slice(0, i));
        line = line.slice(i);
      }
    }
    lines.push(line);
  }
  return lines;
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
