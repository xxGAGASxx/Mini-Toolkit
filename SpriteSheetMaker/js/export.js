'use strict';
// Export: sheet PNG/JPG (optionally with JSON frame data), every frame as a ZIP of PNGs, animated GIF.

/* ================= export ================= */
els.scale.addEventListener('change', () => { state.scale = +els.scale.value; schedule(); });
els.bg.addEventListener('input', () => { state.bg = els.bg.value; });
els.transp.addEventListener('change', () => { state.transparent = els.transp.checked; });
els.json.addEventListener('change', () => { state.json = els.json.checked; schedule(); });

const blobOf = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('the image is too large for this browser'))), type, q));
function save(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function scaled(c) {
  const k = state.scale; if (k === 1) return c;
  const o = mk(c.width * k, c.height * k), x = o.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}
function frameCanvas(s, fill) {
  const [cw, ch] = cell(), c = mk(cw, ch), x = c.getContext('2d');
  if (fill) { x.fillStyle = fill; x.fillRect(0, 0, cw, ch); }
  const [px, py] = pos(s, cw, ch);
  x.drawImage(procOf(s), px, py);
  return c;
}
function sheetCanvas(fill) {
  const [cw, ch] = cell(), n = state.sprites.length, cols = effCols(), rows = Math.ceil(n / cols), p = state.pad;
  const c = mk(cols * cw + (cols - 1) * p, rows * ch + (rows - 1) * p), x = c.getContext('2d');
  if (fill) { x.fillStyle = fill; x.fillRect(0, 0, c.width, c.height); }
  state.sprites.forEach((s, i) => x.drawImage(frameCanvas(s, null), (i % cols) * (cw + p), Math.floor(i / cols) * (ch + p)));
  return c;
}
async function runExport(fn) {
  if (!state.sprites.length || busy) return;
  busy = true; updateUI();
  try { await fn(); }
  catch (err) { console.error(err); toast(`Export failed: ${err.message || err}`); }
  finally { busy = false; updateUI(); }
}
$('#ex-png').addEventListener('click', () => runExport(() => exportSheet(false)));
$('#ex-jpg').addEventListener('click', () => runExport(() => exportSheet(true)));
$('#ex-zip').addEventListener('click', () => runExport(exportZip));
$('#ex-gif').addEventListener('click', () => runExport(exportGif));

async function exportSheet(jpg) {
  const c = scaled(sheetCanvas(jpg || !state.transparent ? state.bg : null));
  const b = await blobOf(c, jpg ? 'image/jpeg' : 'image/png', 0.92);
  const name = `spritesheet.${jpg ? 'jpg' : 'png'}`;
  save(b, name);
  if (state.json) {
    const data = sheetData(name, jpg, c.width, c.height);
    save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'spritesheet.json');
  }
  toast(`Saved ${name}${state.json ? ' and spritesheet.json' : ''} · ${c.width}×${c.height} px`);
}

// Frame data in the TexturePacker "JSON (Hash)" layout, which Phaser, PixiJS and many other
// engines load as an atlas. Each frame is its whole cell, so all frames share one size and line up.
// Keys are the sprite names, made unique. "animations" lists them in order (PixiJS reads it);
// "duration" is the frame time in ms at the GIF fps (as Aseprite writes it). Sizes include the
// export scale, which meta.scale records.
function sheetData(image, jpg, w, h) {
  const [cw, ch] = cell(), cols = effCols(), p = state.pad, k = state.scale;
  const frames = {}, order = [], used = new Set();
  state.sprites.forEach((s, i) => {
    let key = s.name;
    for (let d = 2; used.has(key); d++) key = `${s.name}_${d}`;
    used.add(key); order.push(key);
    frames[key] = {
      frame: { x: (i % cols) * (cw + p) * k, y: Math.floor(i / cols) * (ch + p) * k, w: cw * k, h: ch * k },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cw * k, h: ch * k },
      sourceSize: { w: cw * k, h: ch * k },
      duration: Math.round(1000 / state.fps),
    };
  });
  return {
    frames,
    animations: { [image.replace(/\.\w+$/, '')]: order },
    meta: {
      app: 'Sprite Sheet Maker', version: '1.0', image,
      format: jpg ? 'RGB888' : 'RGBA8888', size: { w, h }, scale: String(k),
    },
  };
}
async function exportZip() {
  const n = state.sprites.length, digits = Math.max(2, String(n).length), fill = state.transparent ? null : state.bg, files = [];
  for (let i = 0; i < n; i++) {
    const b = await blobOf(scaled(frameCanvas(state.sprites[i], fill)), 'image/png');
    files.push({ name: `frame_${String(i + 1).padStart(digits, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
  }
  save(makeZip(files), 'sprites.zip');
  toast(`Saved sprites.zip with ${n} frame${n > 1 ? 's' : ''}`);
}
async function exportGif() {
  toast('Encoding GIF…');
  await new Promise((r) => setTimeout(r, 40));
  const frames = state.sprites.map((s) => scaled(frameCanvas(s, null)));
  const w = frames[0].width, h = frames[0].height;
  const data = frames.map((c) => c.getContext('2d').getImageData(0, 0, w, h));
  const bytes = encodeGif(data, w, h, Math.max(2, Math.round(100 / state.fps)), state.transparent, hexRGB(state.bg));
  save(new Blob([bytes], { type: 'image/gif' }), 'animation.gif');
  toast(`Saved animation.gif · ${frames.length} frames at ${state.fps} fps`);
}
