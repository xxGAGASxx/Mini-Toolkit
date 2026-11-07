'use strict';
// Procedural 2D shapes. Every shape is drawn in local coordinates (0,0)-(w,h).

const SHAPES = {
  none: 'None', rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Diamond',
  pie: 'Pie', callout: 'Callout', polygon: 'Polygon', star: 'Star', parallelogram: 'Parallelogram',
  cylinder: 'Cylinder', cloud: 'Cloud',
};

const polyPath = pts => 'M' + pts.map(pt).join(' L') + ' Z';

// Scales unit-circle points so they fill the box exactly.
function fitPoints(unitPts, w, h) {
  const xs = unitPts.map(p => p.x), ys = unitPts.map(p => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const sx = w / ((Math.max(...xs) - x0) || 1), sy = h / ((Math.max(...ys) - y0) || 1);
  return unitPts.map(p => P((p.x - x0) * sx, (p.y - y0) * sy));
}

function regularPolygon(n) {
  const start = -Math.PI / 2 + (n % 2 ? 0 : Math.PI / n); // flat top for even counts
  return Array.from({ length: n }, (_, i) => {
    const a = start + i * 2 * Math.PI / n;
    return P(Math.cos(a), Math.sin(a));
  });
}

function starPoints(n, ratio) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ratio : 1, a = -Math.PI / 2 + i * Math.PI / n;
    return P(r * Math.cos(a), r * Math.sin(a));
  });
}

function rectPath(w, h, r) {
  r = clamp(r || 0, 0, Math.min(w, h) / 2);
  if (!r) return `M0,0 H${fmt(w)} V${fmt(h)} H0 Z`;
  const a = `A${fmt(r)},${fmt(r)} 0 0 1`;
  return `M${fmt(r)},0 H${fmt(w - r)} ${a} ${fmt(w)},${fmt(r)} V${fmt(h - r)} ${a} ${fmt(w - r)},${fmt(h)} H${fmt(r)} ${a} 0,${fmt(h - r)} V${fmt(r)} ${a} ${fmt(r)},0 Z`;
}

function ellipsePath(w, h) {
  const a = `A${fmt(w / 2)},${fmt(h / 2)} 0 1 1`;
  return `M0,${fmt(h / 2)} ${a} ${fmt(w)},${fmt(h / 2)} ${a} 0,${fmt(h / 2)} Z`;
}

function piePath(w, h, start, sweep) {
  sweep = clamp(sweep, 1, 360);
  if (sweep >= 360) return ellipsePath(w, h);
  const c = P(w / 2, h / 2), at = deg => P(c.x + w / 2 * Math.cos(deg * Math.PI / 180), c.y + h / 2 * Math.sin(deg * Math.PI / 180));
  return `M${pt(c)} L${pt(at(start))} A${fmt(w / 2)},${fmt(h / 2)} 0 ${sweep > 180 ? 1 : 0} 1 ${pt(at(start + sweep))} Z`;
}

const cylinderRy = (w, h) => Math.min(h * 0.15, w * 0.3);
function cylinderGeom(w, h) {
  const rx = w / 2, ry = cylinderRy(w, h), arc = `A${fmt(rx)},${fmt(ry)} 0 0`;
  return {
    d: `M0,${fmt(ry)} ${arc} 1 ${fmt(w)},${fmt(ry)} V${fmt(h - ry)} ${arc} 1 0,${fmt(h - ry)} Z`,
    deco: `M0,${fmt(ry)} ${arc} 0 ${fmt(w)},${fmt(ry)}`, // front rim of the lid (stroke only)
  };
}

function cloudPath(w, h) {
  const n = 9, rx = w * 0.4, ry = h * 0.36;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return P(w / 2 + rx * Math.cos(a), h / 2 + ry * Math.sin(a));
  });
  let d = 'M' + pt(pts[0]);
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % n], r = dist(p, q) * (i % 2 ? 0.62 : 0.55);
    d += ` A${fmt(r)},${fmt(r)} 0 0 1 ${pt(q)}`;
  });
  return d + ' Z';
}

// Callout = rounded body + tail. Built for a bottom tail, then mapped to the chosen side.
function calloutParts(el) {
  const side = el.tailSide || 'bottom', vertical = side === 'left' || side === 'right';
  const W = vertical ? el.h : el.w, H = vertical ? el.w : el.h;
  const t = clamp(el.tailSize, 0, H * 0.8), bh = H - t;
  const r = clamp(el.radius, 0, Math.min(W / 2, bh / 2));
  const bw = Math.max(0, Math.min(W * 0.25, 30, W - 2 * r));
  const tip = clamp(el.tailPos, 0, 1) * W;
  const bx = clamp(tip - bw / 2, r, W - r - bw);
  const map = {
    bottom: p => p,
    top: p => P(p.x, el.h - p.y),
    right: p => P(p.y, p.x),
    left: p => P(el.w - p.y, p.x),
  }[side];
  return { W, H, t, bh, r, bw, bx, tip, map, side };
}

function calloutPath(el) {
  const { W, H, bh, r, bw, bx, tip, map } = calloutParts(el);
  const segs = [
    ['M', P(r, 0)], ['L', P(W - r, 0)], ['Q', P(W, 0), P(W, r)], ['L', P(W, bh - r)], ['Q', P(W, bh), P(W - r, bh)],
    ['L', P(bx + bw, bh)], ['L', P(tip, H)], ['L', P(bx, bh)],
    ['L', P(r, bh)], ['Q', P(0, bh), P(0, bh - r)], ['L', P(0, r)], ['Q', P(0, 0), P(r, 0)],
  ];
  return segs.map(([cmd, ...ps]) => cmd + ps.map(p => pt(map(p))).join(' ')).join(' ') + ' Z';
}

// Polygon outline (local coords) for polygonal shapes; null for curved/rect ones.
function shapePolygon(el) {
  const { w, h } = el;
  switch (el.shape) {
    case 'triangle': return [P(w / 2, 0), P(w, h), P(0, h)];
    case 'diamond': return [P(w / 2, 0), P(w, h / 2), P(w / 2, h), P(0, h / 2)];
    case 'polygon': return fitPoints(regularPolygon(clamp(Math.round(el.sides), 3, 10)), w, h);
    case 'star': return fitPoints(starPoints(clamp(Math.round(el.points), 3, 12), clamp(el.innerRatio, 0.1, 0.95)), w, h);
    case 'parallelogram': { const s = clamp(el.skew, 0, 0.9) * w; return [P(s, 0), P(w, 0), P(w - s, h), P(0, h)]; }
    case 'callout': {
      const { W, H, bh, bw, bx, tip, map } = calloutParts(el);
      return [P(0, 0), P(W, 0), P(W, bh), P(bx + bw, bh), P(tip, H), P(bx, bh), P(0, bh)].map(map);
    }
  }
  return null;
}

// SVG path(s) for a shape: { d, deco? } or null when the element has no shape.
function shapeGeom(el) {
  const { w, h } = el;
  switch (el.shape) {
    case 'none': return null;
    case 'rect': return { d: rectPath(w, h, el.radius) };
    case 'ellipse': return { d: ellipsePath(w, h) };
    case 'pie': return { d: piePath(w, h, el.pieStart, el.pieSweep) };
    case 'callout': return { d: calloutPath(el) };
    case 'cylinder': return cylinderGeom(w, h);
    case 'cloud': return { d: cloudPath(w, h) };
  }
  const poly = shapePolygon(el);
  return poly ? { d: polyPath(poly) } : null;
}

// Area available for text/icon inside the shape (local coords).
function contentBox(el) {
  const b = { x: 0, y: 0, w: el.w, h: el.h };
  if (el.shape === 'callout') {
    const { t, side } = calloutParts(el);
    if (side === 'bottom') b.h -= t;
    else if (side === 'top') { b.y = t; b.h -= t; }
    else if (side === 'right') b.w -= t;
    else { b.x = t; b.w -= t; }
  } else if (el.shape === 'cylinder') {
    const ry = cylinderRy(el.w, el.h);
    b.y = ry * 2; b.h -= ry * 2;
  } else if (el.shape === 'triangle') {
    b.x = el.w / 6; b.w = el.w * 2 / 3; b.y = el.h / 3; b.h = el.h * 2 / 3;
  }
  return b;
}

// Point where the ray from the element center toward (tx,ty) leaves the outline (absolute coords).
function boundaryPoint(el, tx, ty) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2, dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return P(cx, cy);
  if (['ellipse', 'pie', 'cloud'].includes(el.shape)) {
    const k = 1 / Math.sqrt((dx / (el.w / 2)) ** 2 + (dy / (el.h / 2)) ** 2);
    return P(cx + dx * k, cy + dy * k);
  }
  const poly = shapePolygon(el);
  if (!poly) {
    const k = Math.min(dx ? el.w / 2 / Math.abs(dx) : Infinity, dy ? el.h / 2 / Math.abs(dy) : Infinity);
    return P(cx + dx * k, cy + dy * k);
  }
  let best = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) return;
    const ax = a.x - el.w / 2, ay = a.y - el.h / 2;
    const t = (ax * ey - ay * ex) / den, s = (ax * dy - ay * dx) / den;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  });
  if (!isFinite(best)) best = 0;
  return P(cx + dx * best, cy + dy * best);
}

// Snap points: where the outline meets the vertical/horizontal center lines.
function snapPoints(el) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
    const p = boundaryPoint(el, cx + dx * (el.w + 10), cy + dy * (el.h + 10));
    return { x: p.x, y: p.y, ax: el.w ? (p.x - el.x) / el.w : 0.5, ay: el.h ? (p.y - el.y) / el.h : 0.5 };
  });
}
