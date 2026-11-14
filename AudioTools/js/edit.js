'use strict';
// Edit tab: clipboard, trim, silence, split markers, fades, volume, channels. Quick enough to run directly.
// Range tools work on the selection, or on the whole file when nothing is selected.

const hasSel = () => !!state.sel && state.sel.b > state.sel.a;
const range = () => (hasSel() ? [state.sel.a, state.sel.b] : [0, lenOf(state.audio)]);
const secs = (n) => fmtSecs(n / state.audio.sr);
function setSel(a, b) {
  const n = lenOf(state.audio);
  a = clamp(Math.round(a), 0, n); b = clamp(Math.round(b), 0, n);
  if (a > b) [a, b] = [b, a];
  state.sel = b > a ? { a, b } : null;
}
// Puts a new document state in place as one undo step.
function setDoc(audio, markers, sel, cursor, msg) {
  stopAll();
  state.audio = audio;
  state.markers = markers;
  state.sel = null;
  if (sel) setSel(sel[0], sel[1]);
  state.cursor = clamp(Math.round(cursor ?? state.cursor), 0, lenOf(audio));
  commit();
  schedule();
  if (msg) toast(msg);
}
function needSel(what) { if (hasSel()) return true; toast(`Select a part of the waveform to ${what}.`); return false; }

/* ---------- clipboard */
function doCopy() {
  if (!needSel('copy')) return;
  state.clip = sliceAudio(state.audio, state.sel.a, state.sel.b);
  toast(`Copied ${secs(state.sel.b - state.sel.a)}.`);
  schedule();
}
function doDelete(verb = 'Deleted') {
  if (!needSel(verb === 'Cut' ? 'cut' : 'delete')) return;
  const [s, e] = range(), n = lenOf(state.audio);
  if (e - s >= n) { toast('That would remove everything. Open another file to start over.'); return; }
  const audio = spliceAudio(state.audio, s, e, null);
  setDoc(audio, remapMarkers(state.markers, s, e, 0, lenOf(audio)), null, s, `${verb} ${secs(e - s)}.`);
}
function doCut() {
  if (!needSel('cut')) return;
  state.clip = sliceAudio(state.audio, state.sel.a, state.sel.b);
  doDelete('Cut');
}
async function doPaste() {
  if (!state.clip) { toast('Nothing to paste yet: copy or cut a part first.'); return; }
  let clip = state.clip.ch;
  if (state.clip.sr !== state.audio.sr) {   // copied from a file with another sample rate
    const out = [];
    for (const d of clip) out.push(await resampleRate(d, state.clip.sr, state.audio.sr, quietJob()));
    clip = out;
  }
  const [s, e] = hasSel() ? range() : [state.cursor, state.cursor], m = clip[0].length;
  const audio = spliceAudio(state.audio, s, e, clip);
  setDoc(audio, remapMarkers(state.markers, s, e, m, lenOf(audio)), [s, s + m], s, `Pasted ${secs(m)}${e > s ? ' over the selection' : ''}.`);
}
function doTrim() {
  if (!needSel('keep')) return;
  const [s, e] = range();
  const audio = sliceAudio(state.audio, s, e);
  setDoc(audio, cleanMarkers(state.markers.map((x) => x - s), e - s), null, 0, `Kept ${secs(e - s)}; the rest is removed.`);
}
function doSilence() {
  if (!needSel('silence')) return;
  const [s, e] = range();
  const audio = spliceAudio(state.audio, s, e, state.audio.ch.map(() => new Float32Array(e - s)));
  setDoc(audio, state.markers, [s, e], state.cursor, `Silenced ${secs(e - s)}.`);
}
function doInsertSilence() {
  const m = Math.max(1, Math.round(state.fx.silence.len * state.audio.sr)), s = hasSel() ? state.sel.a : state.cursor;
  const audio = spliceAudio(state.audio, s, s, state.audio.ch.map(() => new Float32Array(m)));
  setDoc(audio, remapMarkers(state.markers, s, s, m, lenOf(audio)), [s, s + m], s, `Inserted ${secs(m)} of silence.`);
}

/* ---------- reverse, fades, volume */
function doReverse() {
  const [s, e] = range();
  const ins = state.audio.ch.map((d) => d.slice(s, e).reverse());
  const audio = spliceAudio(state.audio, s, e, ins);
  const markers = cleanMarkers(state.markers.map((x) => (x > s && x < e ? s + e - x : x)), lenOf(audio));
  setDoc(audio, markers, hasSel() ? [s, e] : null, state.cursor, `Reversed ${hasSel() ? 'the selection' : 'the whole file'}.`);
}
const FADES = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  fast: (t) => Math.sin(t * Math.PI / 2),
  slow: (t) => t * t,
};
function doFade(out) {
  const n = lenOf(state.audio), L = Math.min(n, Math.max(1, Math.round(state.fx.fade.len * state.audio.sr)));
  const [s, e] = hasSel() ? range() : out ? [n - L, n] : [0, L], m = e - s, f = FADES[state.fx.fade.curve] || FADES.smooth;
  const ins = state.audio.ch.map((d) => {
    const o = d.slice(s, e);
    for (let i = 0; i < m; i++) { const t = m > 1 ? i / (m - 1) : 1; o[i] *= f(out ? 1 - t : t); }
    return o;
  });
  setDoc(spliceAudio(state.audio, s, e, ins), state.markers, hasSel() ? [s, e] : null, state.cursor,
    `Faded ${out ? 'out' : 'in'} over ${secs(m)}${hasSel() ? '' : out ? ' at the end' : ' at the start'}.`);
}
function scaleRange(gains, msg) {   // gains: one per channel
  const [s, e] = range();
  const ins = state.audio.ch.map((d, c) => { const o = d.slice(s, e), g = gains[c]; for (let i = 0; i < o.length; i++) o[i] *= g; return o; });
  setDoc(spliceAudio(state.audio, s, e, ins), state.markers, hasSel() ? [s, e] : null, state.cursor, msg);
}
function doGain() {
  const db = state.fx.gain.db;
  if (!db) { toast('Set an amount first.'); return; }
  scaleRange(state.audio.ch.map(() => dbToGain(db)), `Volume ${fmtDb(db)}${hasSel() ? ' on the selection' : ''}.`);
  const [s, e] = range();
  if (peakOf(state.audio.ch, s, e) > 1) toast(`Volume ${fmtDb(db)}: some samples now go past full scale and will clip on export.`);
}
function doNormalize() {
  const [s, e] = range(), target = dbToGain(state.fx.norm.peak), sep = state.fx.norm.sep;
  const peaks = state.audio.ch.map((d) => peakOf([d], s, e)), all = Math.max(...peaks);
  if (all < 1e-7) { toast('That part is silent: nothing to normalize.'); return; }
  scaleRange(peaks.map((p) => target / (sep ? Math.max(p, 1e-7) : all)), `Normalized the peak to ${fmtDb(state.fx.norm.peak)} (was ${fmtDb(gainToDb(all))}).`);
}

/* ---------- channels */
function doMono() {
  if (state.audio.ch.length === 1) { toast('Already mono.'); return; }
  setDoc(makeAudio(state.audio.sr, [mixdown(state.audio.ch)]), state.markers, hasSel() ? range() : null, state.cursor, 'Mixed down to mono.');
}
function doStereo() {
  if (state.audio.ch.length !== 1) { toast('Already has two or more channels.'); return; }
  setDoc(makeAudio(state.audio.sr, [state.audio.ch[0], state.audio.ch[0].slice()]), state.markers, hasSel() ? range() : null, state.cursor, 'Made stereo: both sides play the same.');
}
function doSwap() {
  if (state.audio.ch.length !== 2) { toast('Swap needs a stereo file.'); return; }
  setDoc(makeAudio(state.audio.sr, [state.audio.ch[1], state.audio.ch[0]]), state.markers, hasSel() ? range() : null, state.cursor, 'Swapped left and right.');
}

/* ---------- split markers */
function doSplit() {
  const add = hasSel() ? [state.sel.a, state.sel.b] : [state.cursor];
  const markers = cleanMarkers([...state.markers, ...add], lenOf(state.audio));
  if (markers.length === state.markers.length) { toast('Put the cursor inside the audio (not at its very start or end) to split there.'); return; }
  setDoc(state.audio, markers, hasSel() ? range() : null, state.cursor,
    `Split at ${add.map((x) => fmtTime(x / state.audio.sr)).join(' and ')}: ${markers.length + 1} regions.`);
}
function doClearSplits() {
  if (!state.markers.length) { toast('There are no splits.'); return; }
  const [s, e] = range(), keep = hasSel() ? state.markers.filter((x) => x < s || x > e) : [];
  const gone = state.markers.length - keep.length;
  if (!gone) { toast('No splits inside the selection.'); return; }
  setDoc(state.audio, keep, hasSel() ? range() : null, state.cursor, `Removed ${gone} split${gone > 1 ? 's' : ''}.`);
}
// Quiet stretches inside [s, e): RMS in 10 ms windows (the loudest channel) below the threshold for at least minSec.
function silentRuns(audio, s, e, threshDb, minSec) {
  const W = Math.max(1, Math.round(audio.sr * 0.01)), thr = dbToGain(threshDb), runs = [];
  let start = -1;
  for (let w = s; w < e; w += W) {
    const we = Math.min(e, w + W);
    let lvl = 0;
    for (const d of audio.ch) { let q = 0; for (let i = w; i < we; i++) q += d[i] * d[i]; lvl = Math.max(lvl, Math.sqrt(q / (we - w))); }
    if (lvl < thr) { if (start < 0) start = w; } else if (start >= 0) { runs.push([start, w]); start = -1; }
  }
  if (start >= 0) runs.push([start, e]);
  return runs.filter(([a, b]) => b - a >= minSec * audio.sr);
}
function doAutoSplit() {
  const p = state.fx.split, [s, e] = range(), a = state.audio, n = lenOf(a);
  const runs = silentRuns(a, s, e, p.thresh, p.minSil / 1000);
  if (!p.remove) {
    const mids = runs.filter(([x, y]) => x > 0 && y < n).map(([x, y]) => Math.round((x + y) / 2));
    if (!mids.length) { toast('No silent gaps found. Try a higher threshold or a shorter minimum silence.'); return; }
    const markers = cleanMarkers([...state.markers, ...mids], n);
    setDoc(a, markers, hasSel() ? [s, e] : null, state.cursor, `Split at ${mids.length} silent gap${mids.length > 1 ? 's' : ''}: ${markers.length + 1} regions.`);
    return;
  }
  // Remove the silences: keep the sounds (with a little padding) back to back, split between them.
  const pad = Math.round(p.pad / 1000 * a.sr), keep = [];
  let pos = s;
  for (const [x, y] of runs) { if (x > pos) keep.push([pos, x]); pos = y; }
  if (pos < e) keep.push([pos, e]);
  const parts = keep.map(([x, y]) => [Math.max(s, x - pad), Math.min(e, y + pad)]).filter(([x, y]) => y > x);
  if (!parts.length) { toast('Everything there is below the threshold. Try a lower threshold.'); return; }
  if (parts.length === 1 && parts[0][0] === s && parts[0][1] === e) { toast('No silent gaps found. Try a higher threshold or a shorter minimum silence.'); return; }
  const total = parts.reduce((t, [x, y]) => t + y - x, 0), joins = [];
  let at = 0;
  parts.forEach(([x, y], i) => { at += y - x; if (i < parts.length - 1) joins.push(s + at); });
  const ins = a.ch.map((d) => {
    const o = new Float32Array(total);
    let w = 0;
    for (const [x, y] of parts) { o.set(d.subarray(x, y), w); w += y - x; }
    return o;
  });
  const audio = spliceAudio(a, s, e, ins), newLen = lenOf(audio);
  const outside = state.markers.filter((x) => x <= s || x >= e).map((x) => (x >= e ? x + total - (e - s) : x));
  setDoc(audio, cleanMarkers([...outside, ...joins], newLen), hasSel() ? [s, s + total] : null, s,
    `Removed ${secs(e - s - total)} of silence: ${parts.length} sound${parts.length > 1 ? 's' : ''}, split apart.`);
}
function doTrimSilence() {
  const p = state.fx.trim, a = state.audio, n = lenOf(a), runs = silentRuns(a, 0, n, p.thresh, 0);
  let s = 0, e = n;
  if (runs.length && runs[0][0] === 0) s = runs[0][1];
  if (runs.length && runs[runs.length - 1][1] === n) e = runs[runs.length - 1][0];
  if (e <= s) { toast('The whole file is below the threshold. Try a lower threshold.'); return; }
  const pad = Math.round(p.pad / 1000 * a.sr);
  s = Math.max(0, s - pad); e = Math.min(n, e + pad);
  if (s === 0 && e === n) { toast('No silence at the start or end.'); return; }
  setDoc(sliceAudio(a, s, e), cleanMarkers(state.markers.map((x) => x - s), e - s), null, 0,
    `Trimmed ${secs(s)} from the start and ${secs(n - e)} from the end.`);
}
