'use strict';
// Adding sprites: file picker, drag and drop, paste, and splitting animated GIFs.

/* ================= import ================= */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(toCanvas(im, im.naturalWidth, im.naturalHeight)); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    im.src = url;
  });
}
async function decodeGifFrames(file) {
  if (!('ImageDecoder' in window) || !(await ImageDecoder.isTypeSupported('image/gif'))) return null;
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await dec.completed;
    const n = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
    if (n < 2) return null;
    const out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      out.push(toCanvas(image, image.displayWidth, image.displayHeight));
      image.close();
    }
    return out;
  } finally { dec.close(); }
}
async function addFiles(list) {
  const files = [...list].filter((f) => /^image\/(png|jpeg|gif)$/.test(f.type) || /\.(png|jpe?g|gif)$/i.test(f.name));
  if (!files.length) { toast('Only PNG, JPEG and GIF files can be added.'); return; }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const added = []; let failed = 0;
  for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, '') || 'image';
    try {
      let frames = null;
      if (/gif$/i.test(f.type) || /\.gif$/i.test(f.name)) { try { frames = await decodeGifFrames(f); } catch (e) { frames = null; } }
      if (frames) frames.forEach((c, k) => added.push(makeSprite(c, `${base}_${k + 1}`)));
      else added.push(makeSprite(await loadImage(f), f.name));
    } catch (e) { failed++; }
  }
  if (!added.length) { toast('Those files could not be read as images.'); return; }
  const fresh = !state.sprites.length || state.sprites.every((s) => s.sample);
  if (fresh) { state.sprites = []; state.sel = null; state.frame = 0; }
  state.sprites.push(...added);
  if (fresh) autoZoom();
  toast(`Added ${added.length} sprite${added.length > 1 ? 's' : ''}${failed ? ` · ${failed} file${failed > 1 ? 's' : ''} skipped` : ''}`);
  schedule();
}

els.file.addEventListener('change', () => { addFiles(els.file.files); els.file.value = ''; });
$('#btn-add').addEventListener('click', () => els.file.click());
$('#empty-add').addEventListener('click', () => els.file.click());

let dragDepth = 0;
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.drop.hidden = true; });
window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; els.drop.hidden = true; addFiles(e.dataTransfer.files); });
document.addEventListener('paste', (e) => { const f = e.clipboardData ? [...e.clipboardData.files] : []; if (f.length) { e.preventDefault(); addFiles(f); } });
