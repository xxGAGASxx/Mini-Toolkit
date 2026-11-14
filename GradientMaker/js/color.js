'use strict';
// Color math. Stops store colors as '#rrggbb' plus a separate alpha; while sampling, colors are
// [r, g, b, a] floats in 0..1, gamma-encoded sRGB. OKLab conversions follow Björn Ottosson's reference.

const toLin = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const toGam = (c) => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.pow(Math.abs(c), 1 / 2.4) - 0.055));

function linToLab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function labToLin(L, a, b) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  ];
}
const rgbToLab = (r, g, b) => linToLab(toLin(r), toLin(g), toLin(b));
function labToRgb(L, a, b) { const c = labToLin(L, a, b); return [toGam(c[0]), toGam(c[1]), toGam(c[2])]; }
function oklchToRgb(L, C, H) { const h = H * Math.PI / 180; return labToRgb(L, C * Math.cos(h), C * Math.sin(h)); }

// Hue is NaN for grays: the color has no hue, so blending takes the other color's hue (as CSS does).
function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [NaN, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = ((((h || 0) % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/* ---------- interpolation spaces: sRGB -> coordinates and back */
const HUE_AT = { oklch: 2, hsl: 0 };   // which coordinate is the hue, for polar spaces

function encodeIn(space, r, g, b) {
  switch (space) {
    case 'linear': return [toLin(r), toLin(g), toLin(b)];
    case 'oklab': return rgbToLab(r, g, b);
    case 'oklch': {
      const [L, A, B] = rgbToLab(r, g, b), C = Math.hypot(A, B);
      return [L, C, C < 2e-4 ? NaN : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
    }
    case 'hsl': return rgbToHsl(r, g, b);
    default: return [r, g, b];
  }
}
function decodeFrom(space, x, y, z) {
  switch (space) {
    case 'linear': return [toGam(x), toGam(y), toGam(z)];
    case 'oklab': return labToRgb(x, y, z);
    case 'oklch': return oklchToRgb(x, y, z || 0);
    case 'hsl': return hslToRgb(x, y, z);
    default: return [x, y, z];
  }
}

// CSS Color 4 hue fix-up: which way round the color wheel a blend travels.
function hueMix(h0, h1, t, path) {
  let d = h1 - h0;
  switch (path) {
    case 'longer': if (d > 0 && d < 180) d -= 360; else if (d > -180 && d <= 0) d += 360; break;
    case 'increasing': if (d < 0) d += 360; break;
    case 'decreasing': if (d > 0) d -= 360; break;
    default: if (d > 180) d -= 360; else if (d < -180) d += 360;
  }
  return h0 + d * t;
}

/* ---------- parsing and formatting */
function parseHex(str) {
  let s = String(str).trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
  if (s.length <= 4) s = [...s].map((c) => c + c).join('');
  const n = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) : 1, hasAlpha: s.length === 8 };
}

// Any CSS color the browser knows (names, rgb(), hsl(), oklch()...), resolved by drawing one pixel.
let probe = null;
function parseColor(str) {
  const hex = parseHex(str);
  if (hex) return hex;
  if (typeof str !== 'string' || !str.trim() || str.length > 120) return null;
  probe ||= mk(1, 1).getContext('2d', { willReadFrequently: true });
  // Two different fallbacks tell an invalid string (fillStyle unchanged) apart from a valid one.
  probe.fillStyle = '#010203'; probe.fillStyle = str; const a = probe.fillStyle;
  probe.fillStyle = '#040506'; probe.fillStyle = str; const b = probe.fillStyle;
  if (a !== b) return null;
  probe.clearRect(0, 0, 1, 1); probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255, hasAlpha: d[3] < 255 };
}

const h2 = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const toHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);
const toHexA = (r, g, b, a) => toHex(r, g, b) + (a < 0.998 ? h2(a) : '');
const rgbOfHex = (hex) => { const c = parseHex(hex) || { r: 0, g: 0, b: 0 }; return [c.r, c.g, c.b]; };

/* ---------- adjustments, applied to sampled colors after blending */
const DEF_ADJ = { hue: 0, sat: 100, bri: 100, con: 100, op: 100 };
const adjIsDefault = (a) => Object.keys(DEF_ADJ).every((k) => a[k] === DEF_ADJ[k]);

// Returns a function that adjusts an [r, g, b, a] array in place, or null when nothing changes.
function makeAdjust(adj) {
  if (adjIsDefault(adj)) return null;
  const hr = adj.hue * Math.PI / 180, hc = Math.cos(hr), hs = Math.sin(hr);
  const sk = adj.sat / 100, bk = adj.bri / 100, ck = adj.con / 100, ok = adj.op / 100;
  const lab = adj.hue !== 0 || adj.sat !== 100;
  return (c) => {
    let r = c[0], g = c[1], b = c[2];
    if (lab) {
      // Hue turns and saturation scales the chroma in OKLab, so lightness stays put.
      const [L, A, B] = rgbToLab(r, g, b);
      [r, g, b] = labToRgb(L, (A * hc - B * hs) * sk, (A * hs + B * hc) * sk);
    }
    c[0] = (r * bk - 0.5) * ck + 0.5;
    c[1] = (g * bk - 0.5) * ck + 0.5;
    c[2] = (b * bk - 0.5) * ck + 0.5;
    c[3] *= ok;
  };
}
