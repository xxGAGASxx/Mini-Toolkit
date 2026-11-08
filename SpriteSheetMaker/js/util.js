'use strict';
// DOM, canvas and status-message helpers shared by every file.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const modalOpen = () => !!document.querySelector('dialog[open]');
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
