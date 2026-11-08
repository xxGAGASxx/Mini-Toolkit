'use strict';
// DOM, canvas and status-message helpers shared by every file.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const modalOpen = () => !!document.querySelector('dialog[open]');
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));   // '#rrggbb' → [r, g, b]
function toCanvas(source, w, h) {
  const c = mk(w, h);
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
  return c;
}

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2400);
}
