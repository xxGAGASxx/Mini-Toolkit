'use strict';
// Two built-in images to try the tools on.

// A brick wall that does not tile yet: the bricks don't divide the image evenly and the light falls
// from the top left. Good for Seam fix and Even out lighting.
function sampleBricks() {
  const w = 512, h = 512, img = newImg(w, h), d = img.d;
  const BW = 76, BH = 36, M = 5;   // brick width, height, mortar width
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / BH), fy = y - row * BH, shift = row & 1 ? BW / 2 : 0;
    for (let x = 0; x < w; x++) {
      const xx = x + shift, col = Math.floor(xx / BW), fx = xx - col * BW, i = (y * w + x) * 4;
      const edge = Math.min(fx, BW - 1 - fx, fy, BH - 1 - fy);   // distance to the brick's border
      const stain = fbm(x / 40, y / 40, 5) - 0.5, grain = hash2(x, y, 3) - 0.5;
      let r, g, b;
      if (edge < M / 2) {
        const v = 168 + stain * 40 + grain * 26;
        r = v + 6; g = v; b = v - 12;
      } else {
        const t = hash2(col, row, 9), tone = 0.8 + t * 0.32 + stain * 0.35 + grain * 0.12;
        const bevel = edge < M / 2 + 2.5 ? 0.82 : 1;   // darker rim where the brick meets the mortar
        r = (150 + t * 18) * tone * bevel; g = (68 + t * 14) * tone * bevel; b = (50 + t * 6) * tone * bevel;
      }
      const light = 1.2 - 0.5 * ((x / w) * 0.55 + (y / h) * 0.45);
      d[i] = r * light; d[i + 1] = g * light; d[i + 2] = b * light; d[i + 3] = 255;
    }
  }
  return img;
}

// A cut gem on a transparent background. Good for Outline, Trim and the overlays.
function sampleSprite() {
  const S = 256, c = mk(S, S), x = c.getContext('2d');
  const P = { tl: [92, 66], tr: [164, 66], l: [42, 110], r: [214, 110], ml: [104, 110], mr: [152, 110], b: [128, 220] };
  const face = (pts, color) => {
    x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath();
    x.fillStyle = color;
    x.fill();
  };
  face([P.tl, P.tr, P.r, P.b, P.l], '#2a8fc0');   // the whole silhouette first, so facets leave no gaps
  face([P.tl, P.tr, P.mr, P.ml], '#6ad8ea');
  face([P.tl, P.ml, P.l], '#45b6da');
  face([P.tr, P.r, P.mr], '#2f96c6');
  face([P.l, P.ml, P.b], '#2378b0');
  face([P.ml, P.mr, P.b], '#3ba7d9');
  face([P.mr, P.r, P.b], '#1a5d95');
  x.strokeStyle = 'rgba(255,255,255,.4)';
  x.lineWidth = 1.5;
  x.beginPath();
  for (const [a, b] of [[P.tl, P.ml], [P.tr, P.mr], [P.l, P.r], [P.ml, P.b], [P.mr, P.b]]) { x.moveTo(...a); x.lineTo(...b); }
  x.stroke();
  // a glint
  x.fillStyle = 'rgba(255,255,255,.9)';
  x.beginPath();
  x.moveTo(112, 74); x.lineTo(116, 84); x.lineTo(126, 88); x.lineTo(116, 92); x.lineTo(112, 102);
  x.lineTo(108, 92); x.lineTo(98, 88); x.lineTo(108, 84);
  x.closePath();
  x.fill();
  return newImg(S, S, x.getImageData(0, 0, S, S).data);
}
