'use strict';
// Color tab: brightness / contrast, hue / saturation / lightness, shadows / highlights.
// All work on RGB and leave alpha alone.

/* ---------- brightness / contrast, as one lookup table per value */
function colorBC(img, p) {
  const lut = new Uint8ClampedArray(256), b = p.bri / 100, c = p.con / 100;
  // Contrast is an S-curve around middle gray; below zero it flattens towards gray instead.
  const k = c >= 0 ? 1 + c * 2 : 1 / (1 - c * 2);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    // Brightness bends the curve, so black and white stay put and nothing clips.
    if (b > 0) v = 1 - Math.pow(1 - v, 1 + b * 1.5);
    else if (b < 0) v = Math.pow(v, 1 - b * 1.5);
    if (c !== 0) v = v < 0.5 ? 0.5 * Math.pow(2 * v, k) : 1 - 0.5 * Math.pow(2 * (1 - v), k);
    if (p.inv) v = 1 - v;
    lut[i] = Math.round(v * 255);
  }
  const out = newImg(img.w, img.h), s = img.d, d = out.d;
  for (let i = 0; i < s.length; i += 4) {
    d[i] = lut[s[i]]; d[i + 1] = lut[s[i + 1]]; d[i + 2] = lut[s[i + 2]]; d[i + 3] = s[i + 3];
  }
  return out;
}

/* ---------- hue / saturation / lightness */
const HSL = new Float64Array(3);
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const dd = mx - mn;
    s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / dd + 2;
    else h = (r - g) / dd + 4;
    h /= 6;
  }
  HSL[0] = h; HSL[1] = s; HSL[2] = l;
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {   // result in HSL[0..2] as r, g, b
  if (s === 0) { HSL[0] = HSL[1] = HSL[2] = l; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  HSL[0] = hue2rgb(p, q, h + 1 / 3); HSL[1] = hue2rgb(p, q, h); HSL[2] = hue2rgb(p, q, h - 1 / 3);
}

function colorHS(img, p) {
  const out = newImg(img.w, img.h), s = img.d, d = out.d, lig = p.lig / 100;
  if (p.colorize) {
    // Tints the image one hue: keeps each pixel's brightness, takes hue and saturation from the sliders.
    const H = mod(p.hue, 360) / 360, S = (p.sat + 100) / 200;
    for (let i = 0; i < s.length; i += 4) {
      let Y = (0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2]) / 255;
      Y = lig >= 0 ? Y + (1 - Y) * lig : Y * (1 + lig);
      hsl2rgb(H, S, Y);
      d[i] = HSL[0] * 255; d[i + 1] = HSL[1] * 255; d[i + 2] = HSL[2] * 255; d[i + 3] = s[i + 3];
    }
    return out;
  }
  const shift = p.hue / 360, sat = 1 + p.sat / 100;
  for (let i = 0; i < s.length; i += 4) {
    let r = s[i] / 255, g = s[i + 1] / 255, b = s[i + 2] / 255;
    if (shift) {
      rgb2hsl(r, g, b);
      hsl2rgb(fract(HSL[0] + shift), HSL[1], HSL[2]);
      r = HSL[0]; g = HSL[1]; b = HSL[2];
    }
    if (sat !== 1) {
      // Saturation scales the distance from the pixel's own gray, so brightness holds.
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = Y + (r - Y) * sat; g = Y + (g - Y) * sat; b = Y + (b - Y) * sat;
    }
    if (lig > 0) { r += (1 - r) * lig; g += (1 - g) * lig; b += (1 - b) * lig; }
    else if (lig < 0) { r *= 1 + lig; g *= 1 + lig; b *= 1 + lig; }
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; d[i + 3] = s[i + 3];
  }
  return out;
}

/* ---------- shadows / highlights
   Each pixel is judged by the blurred brightness around it (the radius), so a dark area is lifted
   as a whole and the detail inside it keeps its contrast. Positive values brighten. */
function colorSH(img, p, wrap) {
  const { w, h } = img, s = img.d, L = lumaOf(img);
  const Lb = p.radius > 0 ? gaussBlur(Float32Array.from(L), w, h, 1, p.radius, wrap) : L;
  const tw = Math.max(0.05, p.width / 100), sha = p.sha / 200, hil = p.hil / 200, eps = 0.1;
  const out = newImg(w, h), d = out.d;
  for (let j = 0, i = 0; j < L.length; j++, i += 4) {
    const lb = Lb[j];
    const ws = smooth(clamp01(1 - lb / tw)), wh = smooth(clamp01((lb - (1 - tw)) / tw));
    const dl = sha * ws + hil * wh;
    d[i + 3] = s[i + 3];
    if (dl === 0) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; continue; }
    // Scale the color to the new brightness. The small offset lets pure black lift too.
    const l = L[j], k = (clamp01(l + dl) + eps) / (l + eps);
    d[i] = ((s[i] / 255 + eps) * k - eps) * 255;
    d[i + 1] = ((s[i + 1] / 255 + eps) * k - eps) * 255;
    d[i + 2] = ((s[i + 2] / 255 + eps) * k - eps) * 255;
  }
  return out;
}
