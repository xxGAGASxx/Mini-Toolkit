'use strict';
// DOM, math, time, file and storage helpers shared by every file.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
  (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(el.type)));

const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
const fmtDb = (db) => (db === -Infinity || db < -120 ? '−∞ dB' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`);

// 83.4567 -> "1:23.457"; digits is how many decimals the seconds keep.
function fmtTime(sec, digits = 3) {
  if (!Number.isFinite(sec)) return '–';
  const neg = sec < 0;
  sec = Math.abs(sec);
  const scale = Math.pow(10, digits), total = Math.round(sec * scale) / scale;
  const m = Math.floor(total / 60), s = total - m * 60;
  const ss = s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  return `${neg ? '−' : ''}${m}:${ss}`;
}
// "1:23.4", "83.4", "83.4s", "1500ms" -> seconds (or NaN).
function parseTime(text) {
  const t = String(text || '').trim().toLowerCase().replace(/,/g, '.').replace(/−/g, '-');
  if (!t) return NaN;
  let m = /^(-?\d+(?:\.\d*)?)\s*ms$/.exec(t);
  if (m) return parseFloat(m[1]) / 1000;
  m = /^(-?\d+(?:\.\d*)?)\s*s?$/.exec(t);
  if (m) return parseFloat(m[1]);
  m = /^(\d+):(\d+(?:\.\d*)?)$/.exec(t);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  m = /^(\d+):(\d+):(\d+(?:\.\d*)?)$/.exec(t);
  if (m) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  return NaN;
}
const fmtSecs = (sec) => (sec < 10 ? `${sec.toFixed(2)} s` : sec < 600 ? `${sec.toFixed(1)} s` : fmtTime(sec, 0));
const fmtRate = (sr) => (sr % 1000 === 0 ? `${sr / 1000} kHz` : `${(sr / 1000).toFixed(1)} kHz`);
const chanName = (n) => (n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} channels`);

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3600);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const stripExt = (name) => (name || '').replace(/\.[^./\\]+$/, '');
const fileSafe = (name) => (name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'audio';

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

// Lets the browser paint (a progress bar, disabled buttons) before a long step.
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const sleep0 = () => new Promise((r) => setTimeout(r, 0));
