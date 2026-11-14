'use strict';
// Playback through Web Audio. Plays the document, or a processed preview of a tool (with the playhead mapped
// back onto the document's timeline).

const player = {
  ctx: null, src: null, playing: false, startedAt: 0, from: 0, to: 0, loop: false, sr: 44100,
  map: null,          // played position (samples) -> document position (samples)
  preview: null,      // id of the tool being previewed, or null
};
let onPlayChange = () => {};
const bufCache = new WeakMap();

function audioCtx() {
  if (!player.ctx) player.ctx = new AudioContext({ latencyHint: 'interactive' });
  if (player.ctx.state === 'suspended') player.ctx.resume();
  return player.ctx;
}
function toBuffer(audio) {
  let b = bufCache.get(audio);
  if (b) return b;
  b = audioCtx().createBuffer(audio.ch.length, lenOf(audio), audio.sr);
  audio.ch.forEach((d, c) => b.copyToChannel(d, c));
  bufCache.set(audio, b);
  return b;
}

// Plays `audio` from sample `from` to `to`, looping between them when `loop` is on.
function startPlayback(audio, from, to, opts = {}) {
  stopPlayback(true);
  const ctx = audioCtx(), src = ctx.createBufferSource(), sr = audio.sr;
  from = clamp(Math.round(from), 0, lenOf(audio));
  to = clamp(Math.round(to), from, lenOf(audio));
  if (to - from < 16) return;
  src.buffer = toBuffer(audio);
  src.connect(ctx.destination);
  if (opts.loop) { src.loop = true; src.loopStart = from / sr; src.loopEnd = to / sr; src.start(0, from / sr); }
  else src.start(0, from / sr, (to - from) / sr);
  Object.assign(player, {
    src, playing: true, startedAt: ctx.currentTime, from, to, loop: !!opts.loop, sr,
    map: opts.map || ((x) => x), preview: opts.preview || null,
  });
  src.onended = () => { if (player.src === src) { player.src = null; player.playing = false; player.preview = null; onPlayChange(); } };
  onPlayChange();
}
function stopPlayback(quiet) {
  const was = player.playing;
  if (player.src) { player.src.onended = null; try { player.src.stop(); } catch { /* already stopped */ } }
  player.src = null; player.playing = false; player.preview = null;
  if (was && !quiet) onPlayChange();
}
// Where the sound you hear is now, in samples of the played audio (output latency taken off).
function playedPos() {
  if (!player.playing) return null;
  const ctx = player.ctx, lat = ctx.outputLatency || ctx.baseLatency || 0;
  let t = Math.max(0, ctx.currentTime - player.startedAt - lat) * player.sr;
  const span = player.to - player.from;
  t = player.loop && span > 0 ? t % span : Math.min(t, span);
  return player.from + t;
}
// The same, on the document's timeline.
const playheadPos = () => { const p = playedPos(); return p === null ? null : player.map(p); };
