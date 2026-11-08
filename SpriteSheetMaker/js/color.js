'use strict';
// Per-sprite color adjustment: an affine color matrix (same math as CSS filters),
// and the cache of processed canvases it produces.

const DEF = { h: 0, s: 100, b: 100, c: 100 };
const isId = (a) => a.h === 0 && a.s === 100 && a.b === 100 && a.c === 100;

function mul3(A, B) {
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return R;
}
function affine(a) {
  const r = a.h * Math.PI / 180, c = Math.cos(r), n = Math.sin(r), s = a.s / 100, b = a.b / 100, k = a.c / 100;
  const H = [
    .213 + c * .787 - n * .213, .715 - c * .715 - n * .715, .072 - c * .072 + n * .928,
    .213 - c * .213 + n * .143, .715 + c * .285 + n * .140, .072 - c * .072 - n * .283,
    .213 - c * .213 - n * .787, .715 - c * .715 + n * .715, .072 + c * .928 + n * .072,
  ];
  const S = [
    .213 + .787 * s, .715 - .715 * s, .072 - .072 * s,
    .213 - .213 * s, .715 + .285 * s, .072 - .072 * s,
    .213 - .213 * s, .715 - .715 * s, .072 + .928 * s,
  ];
  const M = mul3(S, H).map((v) => v * b * k);   // hue → saturation → brightness → contrast
  const o = 127.5 * (1 - k);
  return { M, o: [o, o, o] };
}
function compose(outer, inner) {
  const M = mul3(outer.M, inner.M);
  const o = [0, 1, 2].map((i) => outer.M[i * 3] * inner.o[0] + outer.M[i * 3 + 1] * inner.o[1] + outer.M[i * 3 + 2] * inner.o[2] + outer.o[i]);
  return { M, o };
}
function procOf(s) {
  if (!s.dirty) return s.proc;
  s.dirty = false;
  if (isId(state.global) && isId(s.adj)) return (s.proc = s.src);
  const { M, o } = compose(affine(s.adj), affine(state.global));
  const cv = s.proc && s.proc !== s.src ? s.proc : mk(s.w, s.h);
  const ctx = cv.getContext('2d'), out = ctx.createImageData(s.w, s.h), d = s.data.data, q = out.data;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = M, [o0, o1, o2] = o;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    q[i] = m0 * r + m1 * g + m2 * b + o0;
    q[i + 1] = m3 * r + m4 * g + m5 * b + o1;
    q[i + 2] = m6 * r + m7 * g + m8 * b + o2;
    q[i + 3] = d[i + 3];
  }
  ctx.putImageData(out, 0, 0);
  return (s.proc = cv);
}
const markAllDirty = () => state.sprites.forEach((s) => (s.dirty = true));
