'use strict';
// Code export: CSS, SVG, Unity C#, GLSL, HLSL, a hex list and JSON, all made from the gradient model.

const FORMATS = {
  css: { ext: 'css', mime: 'text/css', keys: true },
  svg: { ext: 'svg', mime: 'image/svg+xml', keys: true },
  unity: { ext: 'cs', mime: 'text/plain' },
  glsl: { ext: 'glsl', mime: 'text/plain', keys: true },
  hlsl: { ext: 'hlsl', mime: 'text/plain', keys: true },
  hex: { ext: 'txt', mime: 'text/plain', samples: true },
  json: { ext: 'json', mime: 'application/json' },
};
const pct = (p) => fmt(p * 100, 2) + '%';
const cssCol = (c) => toHexA(c[0], c[1], c[2], c[3]);
const f3 = (v) => v.toFixed(3);
const f4 = (v) => v.toFixed(4);
const describe = (g) => `${SPACES[g.space]}${g.steps >= 2 ? `, ${g.steps} steps` : ''}${adjIsDefault(g.adj) ? '' : ', adjusted'}`;

/* ---------- CSS */

// The stops as CSS would write them: color hints for midpoints, doubled stops for hard edges, and a
// few extra stops inside eased segments, since CSS only blends linearly. Entries: { p, c } or { p, hint }.
function nativeCssStops(g) {
  const S = sortStops(g.stops.slice()), adj = makeAdjust(g.adj), f = evaluator(g), list = [];
  const col = (s) => { const c = [...rgbOfHex(s.c), s.a]; if (adj) adj(c); return c.map((v) => clamp(v, 0, 1)); };
  if (S[0].pos > 0) list.push({ p: 0, c: col(S[0]) });
  for (let i = 0; i < S.length; i++) {
    const A = S[i], B = S[i + 1];
    list.push({ p: A.pos, c: col(A) });
    if (!B || B.pos <= A.pos) continue;
    const span = B.pos - A.pos;
    if (A.blend === 'hard') { const e = A.pos + A.mid * span; list.push({ p: e, c: col(A) }, { p: e, c: col(B) }); }
    else if (A.blend === 'linear') { if (A.mid !== 0.5) list.push({ p: A.pos + A.mid * span, hint: true }); }
    else for (let k = 1; k < 8; k++) { const x = A.pos + (span * k) / 8; list.push({ p: x, c: f(x) }); }
  }
  if (S[S.length - 1].pos < 1) list.push({ p: 1, c: col(S[S.length - 1]) });
  return list;
}
function cssMethod(g) {
  const hue = g.hue !== 'shorter' ? ` ${g.hue} hue` : '';
  return { oklab: 'in oklab', linear: 'in srgb-linear', oklch: `in oklch${hue}`, hsl: `in hsl${hue}` }[g.space] || '';
}

// One CSS gradient function for g with the current shape. list holds positions in gradient units (t).
function cssFunction(g, list, method) {
  const o = state.out, w = o.w, h = o.h, s = o.scale / 100, notes = [];
  const a = (o.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const rep = o.repeat !== 'clamp';
  let shape = o.shape;
  if (shape === 'diamond' || shape === 'square') { notes.push(`CSS has no ${shape} gradient: radial shown instead, export the PNG for the real thing.`); shape = 'radial'; }
  if (o.repeat === 'mirror' && shape !== 'reflect') {
    // One period of a mirror repeat is the gradient forward and then backward.
    list = list.concat(list.slice().reverse().map((e) => ({ ...e, p: 2 - e.p })));
  }
  let fn, head, pos;
  const at = `at ${fmt(o.cx, 2)}% ${fmt(o.cy, 2)}%`;
  if (shape === 'linear' || shape === 'reflect') {
    const len = Math.abs(w * cs) + Math.abs(h * sn), off = ((o.cx / 100 - 0.5) * w * cs + (o.cy / 100 - 0.5) * h * sn) / len;
    head = `${fmt(o.angle + 90, 2)}deg`;
    fn = 'linear-gradient';
    if (shape === 'reflect') {
      if (o.repeat === 'repeat') notes.push('Repeat on a reflected gradient has no CSS equivalent: shown as mirror repeat.');
      list = list.slice().reverse().map((e) => ({ ...e, p: -e.p })).concat(list);
      pos = (t) => 0.5 + off + (t * s) / 2;
    } else pos = (t) => 0.5 + off + (t - 0.5) * s;
  } else if (shape === 'radial') {
    fn = 'radial-gradient';
    head = o.circle ? `circle ${fmt(Math.min(w, h) / 2, 2)}px ${at}` : `50% 50% ${at}`;
    if (!o.circle && o.angle % 180 !== 0) notes.push('CSS ellipses cannot be rotated: the angle is left out.');
    pos = (t) => t * s;
  } else {
    fn = 'conic-gradient';
    head = `from ${fmt(o.angle + 90, 2)}deg ${at}`;
    pos = (t) => t * s;
  }
  if (rep) fn = 'repeating-' + fn;
  const parts = list.map((e) => (e.hint ? pct(pos(e.p)) : `${cssCol(e.c)} ${pct(pos(e.p))}`));
  const lead = method ? `${head} ${method}` : head;
  const body = parts.length > 4 ? `\n    ${[lead, ...parts].join(',\n    ')}\n  ` : [lead, ...parts].join(', ');
  return { text: `${fn}(${body})`, notes };
}

function cssCode(grads, mode, n) {
  const blocks = grads.map((g) => {
    const native = mode === 'native' && g.steps < 2;
    const method = native ? cssMethod(g) : '';
    const main = cssFunction(g, native ? nativeCssStops(g) : fitKeys(g, n), method);
    const lines = [`/* ${g.name}: ${describe(g)} */`];
    for (const note of main.notes) lines.push(`/* ${note} */`);
    if (native && !adjIsDefault(g.adj)) lines.push('/* Adjustments are applied to each stop here; use Sampled stops for an exact match. */');
    lines.push(`.${slug(g.name)} {`);
    // Browsers without color-interpolation methods use the first line; the rest use the second.
    if (method) lines.push(`  background: ${cssFunction(g, fitKeys(g, n), '').text};`);
    lines.push(`  background: ${main.text};`, '}');
    return lines.join('\n');
  });
  return blocks.join('\n\n') + '\n';
}

/* ---------- SVG: the whole texture, vector where SVG can draw the shape, embedded PNG otherwise */
function svgCode(n) {
  const o = state.out, L = texLayout(), s = o.scale / 100, out = [];
  const a = (o.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const vector = ['linear', 'reflect', 'radial'].includes(o.shape);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}">`);
  out.push(`  <!-- Gradient Maker: ${L.grads.map((g) => g.name.replace(/--/g, '-')).join(', ')} -->`);
  if (!vector) {
    if (L.W * L.H > PREVIEW_PX) {
      out.push('  <!-- SVG has no angular, diamond or square gradients, and this texture is too large to embed. Export the PNG instead. -->');
    } else {
      const c = mk(L.W, L.H);
      c.getContext('2d').putImageData(new ImageData(renderTexture(L, L.W, L.H, 8), L.W, L.H), 0, 0);
      out.push('  <!-- SVG has no angular, diamond or square gradients: the texture is embedded as a PNG. -->');
      out.push(`  <image width="${L.W}" height="${L.H}" href="${c.toDataURL('image/png')}"/>`);
    }
    out.push('</svg>');
    return out.join('\n') + '\n';
  }
  if (o.bgOn) out.push(`  <rect width="${L.W}" height="${L.H}" fill="${o.bg}"/>`);
  const spread = { clamp: 'pad', repeat: 'repeat', mirror: 'reflect' }[o.repeat];
  const defs = [], rects = [];
  if (o.shape === 'reflect' && o.repeat === 'repeat') out.push('  <!-- Repeat on a reflected gradient has no SVG equivalent: shown as mirror repeat. -->');
  if (o.padFill === 'extend' && (L.n > 1 || o.pot)) out.push('  <!-- Padding is left empty here; the PNG export extends the edges. -->');
  L.grads.forEach((g, i) => {
    const ox = L.nx > 1 ? i * (L.w + L.pad) : 0, oy = L.ny > 1 ? i * (L.h + L.pad) : 0;
    const cx = ox + (o.cx / 100) * L.w, cy = oy + (o.cy / 100) * L.h;
    let stops = fitKeys(g, n), tag;
    if (o.shape === 'radial') {
      const side = o.circle ? Math.min(L.w, L.h) : 0, rx = ((side || L.w) / 2) * s, ry = ((side || L.h) / 2) * s;
      tag = `<radialGradient id="g${i}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" spreadMethod="${spread}" gradientTransform="translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(o.angle)}) scale(${fmt(rx)} ${fmt(ry)})">`;
    } else {
      const edge = o.ends ? Math.abs(cs) + Math.abs(sn) : 0, half = ((Math.abs(L.w * cs) + Math.abs(L.h * sn) - edge) * s) / 2;
      if (o.shape === 'reflect') {
        stops = stops.slice().reverse().map((e) => ({ ...e, p: 0.5 - e.p / 2 })).concat(stops.map((e) => ({ ...e, p: 0.5 + e.p / 2 })));
      }
      tag = `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${fmt(cx - cs * half)}" y1="${fmt(cy - sn * half)}" x2="${fmt(cx + cs * half)}" y2="${fmt(cy + sn * half)}" spreadMethod="${o.shape === 'reflect' && spread !== 'pad' ? 'reflect' : spread}">`;
    }
    defs.push(`    ${tag}`);
    for (const e of stops) {
      defs.push(`      <stop offset="${fmt(e.p, 5)}" stop-color="${toHex(e.c[0], e.c[1], e.c[2])}"${e.c[3] < 0.998 ? ` stop-opacity="${fmt(e.c[3])}"` : ''}/>`);
    }
    defs.push(`    </${o.shape === 'radial' ? 'radialGradient' : 'linearGradient'}>`);
    rects.push(`  <rect x="${ox}" y="${oy}" width="${L.w}" height="${L.h}" fill="url(#g${i})"/>`);
  });
  out.push('  <defs>', ...defs, '  </defs>', ...rects, '</svg>');
  return out.join('\n') + '\n';
}

/* ---------- Unity C# */
function unityMethod(g) {
  const name = ident(g.name), Name = name[0].toUpperCase() + name.slice(1);
  let mode = 'Blend', colorKeys, alphaKeys;
  if (g.steps >= 2 && g.steps <= 8) {
    // Fixed mode holds each key's color from the previous key up to its own time.
    mode = 'Fixed';
    const f = evaluator(g);
    colorKeys = alphaKeys = Array.from({ length: g.steps }, (_, k) => ({ p: (k + 1) / g.steps, c: f((k + 0.5) / g.steps) }));
  } else {
    colorKeys = fitKeys(g, 8, [0, 1, 2]);
    alphaKeys = fitKeys(g, 8, [3]);
  }
  const ck = colorKeys.map((k) => `            new GradientColorKey(new Color(${f3(k.c[0])}f, ${f3(k.c[1])}f, ${f3(k.c[2])}f), ${f4(k.p)}f),`);
  const ak = alphaKeys.map((k) => `            new GradientAlphaKey(${f3(k.c[3])}f, ${f4(k.p)}f),`);
  return [
    `    // ${g.name}: ${describe(g)}. ${mode === 'Fixed' ? 'Exact bands.' : `Fitted to ${colorKeys.length} color and ${alphaKeys.length} alpha keys (Unity allows 8 of each).`}`,
    `    public static Gradient ${Name}()`,
    '    {',
    '        var gradient = new Gradient();',
    `        gradient.mode = GradientMode.${mode};`,
    '        gradient.SetKeys(',
    '            new[]',
    '            {',
    ...ck.map((l) => '    ' + l),
    '            },',
    '            new[]',
    '            {',
    ...ak.map((l) => '    ' + l),
    '            });',
    '        return gradient;',
    '    }',
  ].join('\n');
}
function unityCode(grads) {
  return [
    'using UnityEngine;',
    '',
    '// Made with Gradient Maker. Colors are sRGB, as the Gradient editor shows them.',
    'public static class GradientPresets',
    '{',
    grads.map(unityMethod).join('\n\n'),
    '}',
    '',
  ].join('\n');
}

/* ---------- GLSL / HLSL: piecewise linear functions through fitted keys */
function shaderFunction(g, lang, maxKeys) {
  const keys = fitKeys(g, Math.max(2, maxKeys)), n = keys.length, name = ident(g.name);
  const v4 = lang === 'glsl' ? 'vec4' : 'float4';
  const P = keys.map((k) => f4(k.p)), C = keys.map((k) => `${v4}(${k.c.map(f3).join(', ')})`);
  const wrapList = (items, per) => {
    const rows = [];
    for (let i = 0; i < items.length; i += per) rows.push('        ' + items.slice(i, i + per).join(', '));
    return rows.join(',\n');
  };
  const head = `// ${g.name}: ${describe(g)}. ${n} keys, straight lines between them, sRGB values.`;
  if (lang === 'glsl') {
    return [
      head,
      `vec4 ${name}(float t)`,
      '{',
      `    const float P[${n}] = float[${n}](\n${wrapList(P, 8)});`,
      `    const vec4 C[${n}] = vec4[${n}](\n${wrapList(C, 2)});`,
      '    t = clamp(t, 0.0, 1.0);',
      '    vec4 c = C[0];',
      `    for (int i = 1; i < ${n}; i++)`,
      '    {',
      '        float span = P[i] - P[i - 1];',
      '        float k = span > 0.0 ? clamp((t - P[i - 1]) / span, 0.0, 1.0) : step(P[i], t);',
      '        c = mix(c, C[i], k);',
      '    }',
      '    return c;',
      '}',
    ].join('\n');
  }
  return [
    head,
    `float4 ${name}(float t)`,
    '{',
    `    static const float P[${n}] = {\n${wrapList(P, 8)} };`,
    `    static const float4 C[${n}] = {\n${wrapList(C, 2)} };`,
    '    t = saturate(t);',
    '    float4 c = C[0];',
    '    [unroll]',
    `    for (int i = 1; i < ${n}; i++)`,
    '    {',
    '        float span = P[i] - P[i - 1];',
    '        float k = span > 0.0 ? saturate((t - P[i - 1]) / span) : step(P[i], t);',
    '        c = lerp(c, C[i], k);',
    '    }',
    '    return c;',
    '}',
  ].join('\n');
}
function shaderCode(grads, lang, maxKeys) {
  const intro = lang === 'glsl'
    ? '// Made with Gradient Maker. GLSL 3.30 / GLSL ES 3.00. Values are sRGB: convert to linear if you light in linear space.'
    : '// Made with Gradient Maker. HLSL (also Unity ShaderLab). Values are sRGB: convert to linear if you light in linear space.';
  return [intro, '', grads.map((g) => shaderFunction(g, lang, maxKeys)).join('\n\n'), ''].join('\n');
}

/* ---------- hex list and JSON */
function hexCode(grads, n) {
  return grads.map((g) => {
    const f = evaluator(g), lines = [`// ${g.name}: ${n} samples`];
    for (let i = 0; i < n; i++) { const c = f(n === 1 ? 0 : i / (n - 1)); lines.push(toHexA(c[0], c[1], c[2], c[3])); }
    return lines.join('\n');
  }).join('\n\n') + '\n';
}
function jsonCode(grads) {
  const doc = { app: 'gradient-maker', version: 1, gradients: grads.map(gradOut) };
  if (grads.length === state.grads.length) doc.output = { ...state.out };
  return JSON.stringify(doc, null, 2) + '\n';
}

// The code for the current settings: { text, name } where name is the download file name.
function generateCode() {
  const v = state.view, grads = v.all ? state.grads : [selGrad()], n = v.n, F = FORMATS[v.fmt];
  const base = v.all && v.fmt !== 'svg' ? 'gradients' : slug(selGrad().name);
  let text;
  switch (v.fmt) {
    case 'svg': text = svgCode(n); break;
    case 'unity': text = unityCode(grads); break;
    case 'glsl': case 'hlsl': text = shaderCode(grads, v.fmt, n); break;
    case 'hex': text = hexCode(grads, n); break;
    case 'json': text = jsonCode(grads); break;
    default: text = cssCode(grads, v.cmode, n);
  }
  return { text, name: `${v.fmt === 'unity' ? 'GradientPresets' : v.fmt === 'svg' && state.out.layout !== 'single' ? 'gradient-atlas' : base}.${F.ext}`, mime: F.mime };
}
