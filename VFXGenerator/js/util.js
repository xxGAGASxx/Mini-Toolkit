'use strict';
// Helpers shared by every file: building DOM, math, colors, files, storage and messages.

/* ---------- DOM */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('button.btn', { title: 'Add', onclick: fn }, child, 'text') builds an element. Props that are
// element properties (value, checked, min…) are set directly, the rest become attributes. Put
// min / max / step before value, so a range input does not clamp the value to its old limits.
function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k.includes('-') || k === 'for' || k === 'role' || k === 'style' || !(k in el)) el.setAttribute(k, v === true ? '' : v);
    else el[k] = v;
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// Line icons on a 16 px grid, drawn with the current text color.
const ICONS = {
  undo: '<path d="M6 3.5 2.5 7 6 10.5M3 7h7.5a3 3 0 0 1 0 6H8"/>',
  redo: '<path d="M10 3.5 13.5 7 10 10.5M13 7H5.5a3 3 0 0 0 0 6H8"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M2.5 2.5l11 11M6.6 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.2M10.5 11.8c-.8.4-1.6.7-2.5.7-4 0-6.5-4.5-6.5-4.5s.9-1.6 2.5-2.9"/>',
  up: '<path d="M8 13V3.5M4 7.5l4-4 4 4"/>',
  down: '<path d="M8 3v9.5M4 8.5l4 4 4-4"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.7" cy="5.7" r=".6"/><circle cx="10.3" cy="10.3" r=".6"/><circle cx="8" cy="8" r=".6"/>',
  play: '<path d="M5 3.5v9l7.5-4.5z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  restart: '<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ---------- math */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => t * t * (3 - 2 * t);   // t already in 0..1
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Number of decimals a slider step shows: 1 -> 0, 0.5 -> 1, 0.01 -> 2.
function decimalsOf(step) {
  const s = String(step), i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
const fmtNum = (v, step = 1) => String(+v.toFixed(decimalsOf(step)));

/* ---------- colors: '#rrggbb' <-> [r, g, b] in 0..1 */
const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
function hexToRgb(hex) {
  const n = isHex(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const hexByte = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
const rgbToHex = (r, g, b) => `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
// 'f80', '#FF8800' or 'ff8800' -> '#ff8800'; anything else -> null.
function parseHex(text) {
  let s = String(text).trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, '$&$&');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

/* ---------- files */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const saveText = (text, name, type = 'application/json') => saveBlob(new Blob([text], { type }), name);

// "Soft Glow #2" -> "soft-glow-2", for file names.
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vfx';
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- storage that never throws (private windows, blocked site data, previews) */
const store = {
  get(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      return s == null ? fallback : JSON.parse(s);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

/* ---------- messages */
let toastTimer = 0;
function toast(msg, ms = 2800) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
