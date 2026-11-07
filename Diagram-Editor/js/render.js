'use strict';
// Turns elements into SVG markup. Used by the live canvas, the palette thumbnails and export.
// ctx = { getEl(id), href(assetId), export?: bool, editing?: id }

const ICON_GAP = 6, LINE_HEIGHT = 1.25;
const IMAGE_FIT = { stretch: 'none', contain: 'xMidYMid meet', cover: 'xMidYMid slice' };

function dashAttr(style, sw) {
  if (style === 'dashed') return ` stroke-dasharray="${fmt(sw * 4)} ${fmt(sw * 2.5)}"`;
  if (style === 'dotted') return ` stroke-dasharray="0 ${fmt(sw * 2.2)}"`;
  return '';
}

function textMarkup(o, lines, x, top, lh, anchor) {
  if (!lines.length) return '';
  const outline = o.textStrokeWidth > 0
    ? ` stroke="${esc(o.textStroke)}" stroke-width="${fmt(o.textStrokeWidth)}" stroke-linejoin="round" paint-order="stroke"` : '';
  const spans = lines.map((line, i) => line ? `<tspan x="${fmt(x)}" y="${fmt(top + lh * (i + 0.5))}">${esc(line)}</tspan>` : '').join('');
  return `<text font-family="${esc(fontStack(o.fontFamily))}" font-size="${fmt(o.fontSize)}"${o.bold ? ' font-weight="bold"' : ''}${o.italic ? ' font-style="italic"' : ''}`
    + ` fill="${esc(o.textColor)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve"${outline}>${spans}</text>`;
}

/* ---------- Boxes: shape + image + icon + text ---------- */

// Positions the icon and the wrapped text inside the element (local coords).
function boxLayout(el) {
  const cb = contentBox(el), pad = el.padding || 0;
  const x0 = cb.x + pad, y0 = cb.y + pad;
  const aw = Math.max(1, cb.w - 2 * pad), ah = Math.max(0, cb.h - 2 * pad);
  const hasText = el.text != null && el.text !== '';
  const s = el.icon ? el.iconSize : 0;
  const horiz = el.iconPos === 'left' || el.iconPos === 'right';
  const gap = s && hasText ? ICON_GAP : 0;
  const font = fontCSS(el), lh = el.fontSize * LINE_HEIGHT;
  const lines = hasText ? wrapText(el.text, font, Math.max(1, horiz ? aw - s - gap : aw)) : [];
  const tw = lines.length ? Math.max(...lines.map(l => textWidth(l, font))) : 0;
  const th = lines.length * lh;
  const gw = horiz ? s + gap + tw : Math.max(s, tw);
  const gh = horiz ? Math.max(s, th) : s + gap + th;
  const alignX = (outer, inner) => el.hAlign === 'left' ? 0 : el.hAlign === 'right' ? outer - inner : (outer - inner) / 2;
  const gx = x0 + alignX(aw, gw);
  const gy = y0 + (el.vAlign === 'top' ? 0 : el.vAlign === 'bottom' ? ah - gh : (ah - gh) / 2);
  let icon, tx, ty;
  if (horiz) {
    ty = gy + (gh - th) / 2;
    const iy = gy + (gh - s) / 2;
    if (el.iconPos === 'left') { icon = P(gx, iy); tx = gx + s + gap; } else { tx = gx; icon = P(gx + tw + gap, iy); }
  } else {
    tx = gx + alignX(gw, tw);
    const ix = gx + alignX(gw, s);
    if (el.iconPos === 'bottom') { ty = gy; icon = P(ix, gy + th + gap); } else { icon = P(ix, gy); ty = gy + s + gap; }
  }
  return { lines, lh, tw, tx, ty, icon: s ? { x: icon.x, y: icon.y, s } : null };
}

function boxMarkup(el, ctx) {
  const out = [];
  if (!ctx.export) out.push(`<rect class="hit" width="${fmt(el.w)}" height="${fmt(el.h)}" fill="transparent"/>`);
  const g = shapeGeom(el), sw = el.strokeWidth || 0;
  const fill = el.fill && el.fill !== 'none' ? esc(el.fill) : 'none';
  const stroke = sw > 0 && el.stroke && el.stroke !== 'none'
    ? ` stroke="${esc(el.stroke)}" stroke-width="${fmt(sw)}" stroke-linejoin="round"${el.dash === 'dotted' ? ' stroke-linecap="round"' : ''}${dashAttr(el.dash, sw)}`
    : '';
  if (el.image) {
    const img = `<image xlink:href="${ctx.href(el.image)}" width="${fmt(el.w)}" height="${fmt(el.h)}" preserveAspectRatio="${IMAGE_FIT[el.imageFit] || 'none'}"`;
    if (g) { // image clipped to the shape, outline drawn on top
      const clipId = 'clip-' + el.id;
      out.push(`<clipPath id="${clipId}"><path d="${g.d}"/></clipPath>`);
      if (fill !== 'none') out.push(`<path d="${g.d}" fill="${fill}"/>`);
      out.push(`${img} clip-path="url(#${clipId})"/>`);
      if (stroke) out.push(`<path d="${g.d}" fill="none"${stroke}/>`);
    } else out.push(img + '/>');
  } else if (g) {
    out.push(`<path d="${g.d}" fill="${fill}"${stroke}/>`);
  }
  if (g && g.deco && stroke) out.push(`<path d="${g.deco}" fill="none"${stroke}/>`);

  const L = boxLayout(el);
  if (L.icon) out.push(`<image xlink:href="${ctx.href(el.icon)}" x="${fmt(L.icon.x)}" y="${fmt(L.icon.y)}" width="${L.icon.s}" height="${L.icon.s}"/>`);
  if (L.lines.length && ctx.editing !== el.id) {
    const anchor = el.hAlign === 'left' ? 'start' : el.hAlign === 'right' ? 'end' : 'middle';
    const x = el.hAlign === 'left' ? L.tx : el.hAlign === 'right' ? L.tx + L.tw : L.tx + L.tw / 2;
    out.push(textMarkup(el, L.lines, x, L.ty, L.lh, anchor));
  }
  const body = out.join('');
  return el.opacity < 1 ? `<g opacity="${fmt(el.opacity)}">${body}</g>` : body;
}

/* ---------- Arrows ---------- */
// An arrow has one start and one or more ends. Each end is a free point {x,y}
// or linked to an element: {id} floats around its outline, {id, ax, ay} is pinned to a snap point.

const headLen = sw => 7 + sw * 3;

function axisDir(dx, dy, force) {
  const horiz = force ? force === 'h' : Math.abs(dx) >= Math.abs(dy);
  return horiz ? P(dx >= 0 ? 1 : -1, 0) : P(0, dy >= 0 ? 1 : -1);
}

// Resolves an endpoint to { p, d }: its position and the direction pointing away from its element.
function resolveEnd(ep, toward, axisMode, getEl, force) {
  const el = ep.id ? getEl(ep.id) : null;
  if (!el) {
    const p = P(ep.x, ep.y);
    return { p, d: axisMode ? axisDir(toward.x - p.x, toward.y - p.y, force) : unit(toward.x - p.x, toward.y - p.y) };
  }
  const c = P(el.x + el.w / 2, el.y + el.h / 2);
  if (ep.ax != null) {
    const p = P(el.x + ep.ax * el.w, el.y + ep.ay * el.h);
    return { p, d: axisMode ? axisDir(ep.ax - 0.5, ep.ay - 0.5) : unit(p.x - c.x, p.y - c.y) };
  }
  if (axisMode) { // attach to the middle of the side facing the other end
    const d = axisDir((toward.x - c.x) / (el.w || 1), (toward.y - c.y) / (el.h || 1), force);
    return { p: boundaryPoint(el, c.x + d.x * (el.w + 10), c.y + d.y * (el.h + 10)), d };
  }
  const p = boundaryPoint(el, toward.x, toward.y);
  return { p, d: unit(p.x - c.x, p.y - c.y) };
}

// Drops duplicate and collinear points from an orthogonal route.
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && dist(out[out.length - 1], p) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 0.01) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

// Orthogonal route between two points; d0/d1 point away from their elements.
function elbowRoute(p0, d0, p1, d1) {
  const S = 20, a = add(p0, mul(d0, S)), b = add(p1, mul(d1, S));
  const h0 = d0.x !== 0, h1 = d1.x !== 0;
  let mid;
  if (h0 === h1) {
    const k = h0 ? 'x' : 'y', o = h0 ? 'y' : 'x';
    const at = (kv, ov) => h0 ? P(kv, ov) : P(ov, kv);
    const m = (a[k] + b[k]) / 2;
    if ((m - p0[k]) * d0[k] >= 0 && (m - p1[k]) * d1[k] >= 0) mid = [at(m, p0[o]), at(m, p1[o])];
    else if (d0[k] === d1[k]) {
      const e = d0[k] > 0 ? Math.max(a[k], b[k]) : Math.min(a[k], b[k]);
      mid = [at(e, p0[o]), at(e, p1[o])];
    } else {
      const mo = (a[o] + b[o]) / 2;
      mid = [a, at(a[k], mo), at(b[k], mo), b];
    }
  } else {
    const c = h0 ? P(p1.x, p0.y) : P(p0.x, p1.y);
    const ok0 = h0 ? (c.x - p0.x) * d0.x >= 0 : (c.y - p0.y) * d0.y >= 0;
    const ok1 = h0 ? (c.y - p1.y) * d1.y >= 0 : (c.x - p1.x) * d1.x >= 0;
    mid = ok0 && ok1 ? [c] : [a, h0 ? P(a.x, b.y) : P(b.x, a.y), b];
  }
  return simplify([p0, ...mid, p1]);
}

const lineSegs = pts => pts.slice(1).map(p => ({ t: 'L', p }));
const segStart = (br, i) => i ? br.segs[i - 1].p : br.p0;

function endTangent(br) {
  const i = br.segs.length - 1, s = br.segs[i];
  const from = s.t === 'C' ? s.c2 : s.t === 'Q' ? s.c : segStart(br, i);
  const u = unit(s.p.x - from.x, s.p.y - from.y);
  return u.x || u.y ? u : unit(s.p.x - br.p0.x, s.p.y - br.p0.y);
}
function startTangent(br) {
  const s = br.segs[0], to = s.t === 'C' ? s.c1 : s.t === 'Q' ? s.c : s.p;
  const u = unit(to.x - br.p0.x, to.y - br.p0.y);
  if (u.x || u.y) return u;
  const last = br.segs[br.segs.length - 1].p;
  return unit(last.x - br.p0.x, last.y - br.p0.y);
}

// How far the line stops short of the tip so it does not poke through the head.
function headInset(type, sw) {
  const L = headLen(sw);
  return { arrow: L * 0.8, diamond: L * 0.5, circle: L * 0.32, open: sw * 0.5 }[type] || 0;
}
function shortenEnd(br, by) {
  const i = br.segs.length - 1, s = br.segs[i], u = endTangent(br);
  if (s.t === 'L') by = Math.min(by, dist(segStart(br, i), s.p) * 0.9);
  if (by > 0) s.p = P(s.p.x - u.x * by, s.p.y - u.y * by);
}
function shortenStart(br, by) {
  const s = br.segs[0], u = startTangent(br);
  if (s.t === 'L') by = Math.min(by, dist(br.p0, s.p) * 0.9);
  if (by > 0) br.p0 = P(br.p0.x + u.x * by, br.p0.y + u.y * by);
}

function midPoint(br) {
  const s = br.segs[0];
  if (s.t === 'C') {
    const q = br.p0;
    return P((q.x + 3 * s.c1.x + 3 * s.c2.x + s.p.x) / 8, (q.y + 3 * s.c1.y + 3 * s.c2.y + s.p.y) / 8);
  }
  const pts = [br.p0, ...br.segs.map(g => g.p)];
  let half = 0;
  for (let i = 1; i < pts.length; i++) half += dist(pts[i - 1], pts[i]);
  half /= 2;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (half <= d) return lerp(pts[i - 1], pts[i], d ? half / d : 0);
    half -= d;
  }
  return pts[pts.length - 1];
}

// Full arrow geometry: branches (one per end), heads, label position, endpoints and bounds.
function arrowGeom(a, getEl) {
  const axisMode = a.route !== 'straight', multi = a.ends.length > 1;
  const ref = ep => {
    const el = ep.id ? getEl(ep.id) : null;
    if (!el) return P(ep.x, ep.y);
    return ep.ax != null ? P(el.x + ep.ax * el.w, el.y + ep.ay * el.h) : P(el.x + el.w / 2, el.y + el.h / 2);
  };
  const sRef = ref(a.start), eRefs = a.ends.map(ref);
  const cen = P(eRefs.reduce((s, p) => s + p.x, 0) / eRefs.length, eRefs.reduce((s, p) => s + p.y, 0) / eRefs.length);
  const S = resolveEnd(a.start, multi ? cen : eRefs[0], axisMode, getEl);
  const branches = [];
  let ends, label;

  if (!multi) {
    const E = resolveEnd(a.ends[0], sRef, axisMode, getEl);
    let segs;
    if (a.route === 'elbow') segs = lineSegs(elbowRoute(S.p, S.d, E.p, E.d));
    else if (a.route === 'curved') {
      const k = Math.max(30, dist(S.p, E.p) * 0.4);
      segs = [{ t: 'C', c1: add(S.p, mul(S.d, k)), c2: add(E.p, mul(E.d, k)), p: E.p }];
    }
    if (!segs || !segs.length) segs = [{ t: 'L', p: E.p }];
    ends = [E.p];
    branches.push({ p0: S.p, segs });
    label = midPoint(branches[0]);
  } else if (a.route === 'elbow') { // tree: trunk, bus line, one branch per end
    const v = S.d.y !== 0, k = v ? 'y' : 'x', dir = v ? S.d.y : S.d.x;
    const E = a.ends.map(ep => resolveEnd(ep, S.p, true, getEl, v ? 'v' : 'h'));
    ends = E.map(e => e.p);
    const ahead = ends.map(p => (p[k] - S.p[k]) * dir).filter(d => d > 1);
    const bus = S.p[k] + dir * (ahead.length ? Math.min(...ahead) : 40) * a.split;
    const onBus = q => v ? P(q.x, bus) : P(bus, q.y);
    for (const p of ends) {
      const segs = lineSegs(simplify([S.p, onBus(S.p), onBus(p), p]));
      branches.push({ p0: S.p, segs: segs.length ? segs : [{ t: 'L', p }] });
    }
    label = lerp(S.p, onBus(S.p), 0.5);
  } else { // fan out from a junction
    const J = lerp(S.p, cen, a.split);
    const E = a.ends.map(ep => resolveEnd(ep, J, axisMode, getEl));
    ends = E.map(e => e.p);
    const u = unit(J.x - S.p.x, J.y - S.p.y);
    for (const p of ends) {
      const last = a.route === 'curved' ? { t: 'Q', c: add(J, mul(u, dist(J, p) * 0.5)), p } : { t: 'L', p };
      branches.push({ p0: S.p, segs: [{ t: 'L', p: J }, last] });
    }
    label = lerp(S.p, J, 0.5);
  }

  const all = [S.p, ...ends];
  for (const br of branches) for (const s of br.segs) all.push(...[s.p, s.c, s.c1, s.c2].filter(Boolean));
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys) };
  bbox.w = Math.max(...xs) - bbox.x;
  bbox.h = Math.max(...ys) - bbox.y;

  const heads = [];
  if (a.headEnd !== 'none') for (const br of branches) {
    heads.push({ type: a.headEnd, tip: br.segs[br.segs.length - 1].p, u: endTangent(br) });
    shortenEnd(br, headInset(a.headEnd, a.strokeWidth));
  }
  if (a.headStart !== 'none') {
    const u = startTangent(branches[0]);
    heads.push({ type: a.headStart, tip: branches[0].p0, u: P(-u.x, -u.y) });
    for (const br of branches) shortenStart(br, headInset(a.headStart, a.strokeWidth));
  }
  return { branches, heads, label, start: S.p, ends, bbox };
}

const branchPath = br => 'M' + pt(br.p0) + br.segs.map(s =>
  s.t === 'C' ? ` C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}` : s.t === 'Q' ? ` Q${pt(s.c)} ${pt(s.p)}` : ` L${pt(s.p)}`).join('');
const arrowPath = G => G.branches.map(branchPath).join(' ');

function headMarkup(h, sw, color) {
  const L = headLen(sw), W = L * 0.42, u = h.u, n = P(-u.y, u.x), c = esc(color);
  const at = (along, side) => pt(P(h.tip.x - u.x * along + n.x * side, h.tip.y - u.y * along + n.y * side));
  switch (h.type) {
    case 'arrow': return `<path d="M${at(0, 0)} L${at(L, W)} L${at(L, -W)} Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>`;
    case 'open': return `<path d="M${at(L, W)} L${at(0, 0)} L${at(L, -W)}" fill="none" stroke="${c}" stroke-width="${fmt(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'diamond': return `<path d="M${at(0, 0)} L${at(L / 2, W)} L${at(L, 0)} L${at(L / 2, -W)} Z" fill="${c}"/>`;
    case 'circle': {
      const r = L * 0.32;
      return `<circle cx="${fmt(h.tip.x - u.x * r)}" cy="${fmt(h.tip.y - u.y * r)}" r="${fmt(r)}" fill="${c}"/>`;
    }
  }
  return '';
}

function arrowMarkup(a, ctx) {
  const G = arrowGeom(a, ctx.getEl), d = arrowPath(G), sw = a.strokeWidth;
  let s = '';
  if (!ctx.export) s += `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="${fmt(Math.max(14, sw + 10))}"/>`;
  s += `<path d="${d}" fill="none" stroke="${esc(a.stroke)}" stroke-width="${fmt(sw)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(a.dash, sw)}/>`;
  s += G.heads.map(h => headMarkup(h, sw, a.stroke)).join('');
  if (a.text && ctx.editing !== a.id) {
    const lines = String(a.text).split('\n'), lh = a.fontSize * LINE_HEIGHT, top = G.label.y - lines.length * lh / 2;
    if (a.labelBg && a.labelBg !== 'none') { // a box behind the label hides the line under it
      const font = fontCSS(a), w = Math.max(...lines.map(l => textWidth(l, font))) + 10;
      s += `<rect x="${fmt(G.label.x - w / 2)}" y="${fmt(top - 1)}" width="${fmt(w)}" height="${fmt(lines.length * lh + 2)}" rx="3" fill="${esc(a.labelBg)}"/>`;
    }
    s += textMarkup(a, lines, G.label.x, top, lh, 'middle');
  }
  return a.opacity < 1 ? `<g opacity="${fmt(a.opacity)}">${s}</g>` : s;
}

function elementMarkup(el, ctx) {
  return el.type === 'arrow' ? arrowMarkup(el, ctx) : `<g transform="translate(${fmt(el.x)},${fmt(el.y)})">${boxMarkup(el, ctx)}</g>`;
}

// Standalone SVG document of the canvas page (images embedded as data URLs).
function buildSVG(doc, scale = 1) {
  const { w, h, bg, transparent } = doc.canvas;
  const getEl = id => doc.elements.find(e => e.id === id);
  const ctx = { export: true, getEl, href: id => esc(doc.assets[id] || '') };
  const back = transparent ? '' : `<rect width="${w}" height="${h}" fill="${esc(bg)}"/>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVGNS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(w * scale)}" height="${fmt(h * scale)}" viewBox="0 0 ${w} ${h}">\n`
    + back + doc.elements.map(el => elementMarkup(el, ctx)).join('\n') + '\n</svg>\n';
}
