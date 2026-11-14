'use strict';
// The image every tool works on, and turning files into one.
// An image is { w, h, d, id }: d holds straight (not premultiplied) RGBA, 8 bits per channel.
// Images are never changed once made. Every step returns a new one, so undo can simply keep them.

const MAX_SIDE = 8192;
let imgSeq = 0;
function newImg(w, h, d) { return { w, h, d: d || new Uint8ClampedArray(w * h * 4), id: ++imgSeq }; }
const u32 = (img) => new Uint32Array(img.d.buffer, img.d.byteOffset, img.w * img.h);   // one number per pixel

function imgToCanvas(img, c) {
  c = c || mk(img.w, img.h);
  if (c.width !== img.w || c.height !== img.h) { c.width = img.w; c.height = img.h; }
  c.getContext('2d').putImageData(new ImageData(img.d, img.w, img.h), 0, 0);
  return c;
}

const alphaSeen = new WeakMap();
function imgHasAlpha(img) {
  if (alphaSeen.has(img)) return alphaSeen.get(img);
  let r = false;
  const d = img.d;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { r = true; break; }
  alphaSeen.set(img, r);
  return r;
}

function checkSize(w, h) {
  if (!w || !h) throw new Error('the image has no size');
  if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`images are limited to ${MAX_SIDE} px per side (this one is ${w} × ${h})`);
}

/* ---------- decoding */
async function decodeFile(file) {
  if (/\.tga$/i.test(file.name) || /x-tga|x-targa/i.test(file.type)) return decodeTga(await file.arrayBuffer());
  return decodeBlob(file);
}

// Lets the browser decode the file, then reads the pixels back without premultiplying them, so colors
// under transparent pixels survive (game textures often keep data there).
async function decodeBlob(blob) {
  let src = null;
  try { src = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch {
    try { src = await createImageBitmap(blob); } catch { src = null; }
  }
  if (!src) src = await loadImgElement(blob);   // SVG, and browsers without createImageBitmap
  try {
    const w = 'naturalWidth' in src ? src.naturalWidth : src.width, h = 'naturalHeight' in src ? src.naturalHeight : src.height;
    checkSize(w, h);
    return newImg(w, h, readPixelsGL(src, w, h) || readPixels2D(src, w, h));
  } finally {
    if (typeof src.close === 'function') src.close();
  }
}

function loadImgElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), el = new Image();
    el.onload = () => { resolve(el); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('the browser cannot read this file as an image')); };
    el.src = url;
  });
}

// WebGL uploads the decoded pixels as they are (no premultiplying), and readPixels hands them back.
// Returns null when WebGL is missing or refuses; the 2D canvas path is the fallback.
function readPixelsGL(src, w, h) {
  let gl = null;
  try {
    gl = mk(1, 1).getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) return null;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (w > max || h > max) return null;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);   // row 0 is the image's first row
    if (gl.getError() !== gl.NO_ERROR) return null;
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    return new Uint8ClampedArray(out.buffer);
  } catch {
    return null;
  } finally {
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }
}

function readPixels2D(src, w, h) {
  const x = mk(w, h).getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}

/* ---------- TGA (browsers can't open it, so it is read here): true-color, grayscale and
   color-mapped, plain or RLE, any origin */
function decodeTga(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 18) throw new Error('not a TGA file');
  const idLen = b[0], cmType = b[1], type = b[2];
  const cmStart = b[3] | (b[4] << 8), cmLen = b[5] | (b[6] << 8), cmDepth = b[7];
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), depth = b[16], desc = b[17];
  const rle = type >= 9, kind = rle ? type - 8 : type;
  if (![1, 2, 3].includes(kind) || ![8, 15, 16, 24, 32].includes(depth)) throw new Error('unsupported TGA type');
  checkSize(w, h);

  // Reads one color of `bits` bits at byte o into rgba[k..k+3].
  const color = (o, bits, rgba, k) => {
    if (bits === 24 || bits === 32) {
      rgba[k] = b[o + 2]; rgba[k + 1] = b[o + 1]; rgba[k + 2] = b[o]; rgba[k + 3] = bits === 32 ? b[o + 3] : 255;
    } else if (bits === 15 || bits === 16) {
      const v = b[o] | (b[o + 1] << 8);
      rgba[k] = (((v >> 10) & 31) * 255 / 31) | 0; rgba[k + 1] = (((v >> 5) & 31) * 255 / 31) | 0; rgba[k + 2] = ((v & 31) * 255 / 31) | 0;
      rgba[k + 3] = bits === 16 && (desc & 15) ? (v & 0x8000 ? 255 : 0) : 255;
    } else {
      rgba[k] = rgba[k + 1] = rgba[k + 2] = b[o]; rgba[k + 3] = 255;
    }
  };

  let o = 18 + idLen;
  let pal = null;
  if (cmType === 1) {
    const eb = Math.ceil(cmDepth / 8);
    pal = new Uint8Array((cmStart + cmLen) * 4);
    for (let i = 0; i < cmLen; i++) color(o + i * eb, cmDepth, pal, (cmStart + i) * 4);
    o += cmLen * eb;
  }
  const px = Math.ceil(depth / 8), n = w * h, tmp = new Uint8Array(n * 4);
  const put = (i, at) => {
    if (at + px > b.length) throw new Error('the TGA file is cut short');
    if (kind === 1) {
      const idx = px === 1 ? b[at] : b[at] | (b[at + 1] << 8), k = idx * 4;
      if (!pal || k + 3 >= pal.length) throw new Error('bad TGA palette index');
      tmp[i * 4] = pal[k]; tmp[i * 4 + 1] = pal[k + 1]; tmp[i * 4 + 2] = pal[k + 2]; tmp[i * 4 + 3] = pal[k + 3];
    } else if (kind === 3) {
      tmp[i * 4] = tmp[i * 4 + 1] = tmp[i * 4 + 2] = b[at]; tmp[i * 4 + 3] = depth === 16 ? b[at + 1] : 255;
    } else color(at, depth, tmp, i * 4);
  };
  if (!rle) {
    for (let i = 0; i < n; i++) put(i, o + i * px);
  } else {
    let i = 0;
    while (i < n) {
      if (o >= b.length) throw new Error('the TGA file is cut short');
      const hdr = b[o++], cnt = Math.min((hdr & 127) + 1, n - i);
      if (hdr & 128) {
        put(i, o);
        for (let k = 1; k < cnt; k++) tmp.copyWithin((i + k) * 4, i * 4, i * 4 + 4);
        o += px;
      } else {
        for (let k = 0; k < cnt; k++) put(i + k, o + k * px);
        o += cnt * px;
      }
      i += cnt;
    }
  }
  // Some writers leave the alpha bits at zero; an all-transparent picture is surely meant to be opaque.
  let anyAlpha = false;
  for (let i = 3; i < tmp.length; i += 4) if (tmp[i]) { anyAlpha = true; break; }
  if (!anyAlpha) for (let i = 3; i < tmp.length; i += 4) tmp[i] = 255;

  const img = newImg(w, h), src32 = new Uint32Array(tmp.buffer), dst = u32(img);
  const top = desc & 0x20, right = desc & 0x10;
  for (let r = 0; r < h; r++) {
    const y = top ? r : h - 1 - r;
    for (let c = 0; c < w; c++) dst[y * w + (right ? w - 1 - c : c)] = src32[r * w + c];
  }
  return img;
}
