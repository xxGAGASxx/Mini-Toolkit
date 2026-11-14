'use strict';
// DOM, math, file and storage helpers shared by every file.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const roundTo = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };
const fmt = (v, d = 3) => String(roundTo(v, d));            // number without trailing zeros
const has = (map, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
  (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(el.type)));

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const saveText = (text, name, type = 'text/plain') => saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  // Pages opened from disk can be denied the async clipboard; a selected textarea still copies.
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

// "Toon 2 band!" -> "toon-2-band", for file names.
const slug = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'gradient';
// "Toon 2 band!" -> "toon2Band", for code identifiers.
function ident(name) {
  const words = (name || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const id = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join('');
  return /^[A-Za-z]/.test(id) ? id : 'gradient' + id;
}

// localStorage can be missing or throw (private windows, blocked storage); the tool works without it.
const store = {
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};

// Reads a CSS custom property of the page, e.g. cssVar('--accent').
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Fills a canvas context with the transparency checkerboard.
function fillChecker(x, w, h, size) {
  x.fillStyle = cssVar('--chk-a'); x.fillRect(0, 0, w, h);
  x.fillStyle = cssVar('--chk-b');
  for (let y = 0, r = 0; y < h; y += size, r++) {
    for (let xx = (r & 1) * size; xx < w; xx += size * 2) x.fillRect(xx, y, size, size);
  }
}

// Sizes a canvas backing store to its CSS box times the device pixel ratio; returns [w, h, dpr].
function fitCanvas(c, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  return [w, h, dpr];
}
