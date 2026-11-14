'use strict';
// DOM, math, color, file and storage helpers shared by every file.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);                 // smoothstep on 0..1
const fract = (v) => v - Math.floor(v);
const mod = (a, n) => ((a % n) + n) % n;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
  (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(el.type)));

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3200);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const stripExt = (name) => (name || '').replace(/\.[^./\\]+$/, '');
const fileSafe = (name) => (name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'texture';

// '#ff8800' -> [255, 136, 0]
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Seeded random numbers (mulberry32): the same seed gives the same noise every time.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Hash of an integer lattice point to 0..1, for value noise.
function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// localStorage can be missing or throw (private windows, blocked storage); the tool works without it.
const store = {
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};

// Reads a CSS custom property of the page, e.g. cssVar('--accent').
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Sizes a canvas backing store to its CSS box times the device pixel ratio; returns [w, h, dpr].
function fitCanvas(c, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  return [w, h, dpr];
}

// Lets the browser paint (a "Working…" note, disabled buttons) before a long synchronous step.
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
