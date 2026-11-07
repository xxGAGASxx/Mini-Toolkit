'use strict';
// Menus, toolbar, palette (left), properties panel (right), keyboard and clipboard wiring.

const palette = $('#palette'), props = $('#props');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const isTyping = t => t && t.closest && t.closest('input, textarea, select, [contenteditable]');

function confirmDiscard(action) {
  return !state.dirty || confirm(`${action}? Changes since your last save will be lost.`);
}

/* ---------- Commands (menus, toolbar, keyboard and panel buttons all use these) ---------- */

const COMMANDS = {
  new: () => { if (confirmDiscard('Start a new diagram')) loadDocument(blankDoc()); },
  open: () => $('#fileOpen').click(),
  example: () => { if (confirmDiscard('Open the example')) loadDocument(exampleDoc()); },
  save: saveFile,
  exportPng: () => exportRaster('png', 1),
  exportPng2x: () => exportRaster('png', 2),
  exportJpg: () => exportRaster('jpeg', 2),
  exportSvg: exportSVGFile,
  addImage: () => pickImage('new'),
  loadIcons: () => $('#fileIconDir').click(),
  undo, redo,
  cut: cutSelection,
  copy: () => { if (copySelection()) toast(`Copied ${state.sel.length} element${state.sel.length > 1 ? 's' : ''}`); },
  paste: pasteClipboard,
  duplicate: duplicateSelection,
  delete: deleteSelection,
  selectAll: () => setSelection(els().map(e => e.id)),
  deselect: () => setSelection([]),
  editText: () => { if (state.sel.length === 1) startTextEdit(state.sel[0]); },
  toggleGrid: () => togglePref('grid'),
  toggleSnapGrid: () => togglePref('snapGrid'),
  toggleSnapObjects: () => togglePref('snapObjects'),
  zoomIn: () => setZoom(state.zoom * 1.25),
  zoomOut: () => setZoom(state.zoom / 1.25),
  zoomReset: () => setZoom(1),
  zoomFit,
  front: () => reorder('front'),
  forward: () => reorder('forward'),
  backward: () => reorder('backward'),
  back: () => reorder('back'),
  alignLeft: () => align('left'),
  alignCenter: () => align('center'),
  alignRight: () => align('right'),
  alignTop: () => align('top'),
  alignMiddle: () => align('middle'),
  alignBottom: () => align('bottom'),
  distributeH: () => distribute('h'),
  distributeV: () => distribute('v'),
};
const run = cmd => COMMANDS[cmd] && COMMANDS[cmd]();

/* ---------- Menus & toolbar ---------- */

const closeMenus = () => $$('.menu.open').forEach(m => m.classList.remove('open'));

document.addEventListener('click', e => {
  const btn = e.target.closest('.menu-btn');
  if (btn) {
    const menu = btn.parentElement, wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
    return;
  }
  const item = e.target.closest('[data-cmd]');
  if (item && !item.disabled) { closeMenus(); run(item.dataset.cmd); }
});
$('#menubar').addEventListener('mouseover', e => {
  const menu = e.target.closest('.menu');
  if (menu && $('.menu.open') && !menu.classList.contains('open')) { closeMenus(); menu.classList.add('open'); }
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.menu')) closeMenus();
  if (popover && !e.target.closest('.popover, [data-act="pickIcon"]')) closePopover();
}, true);

// Enables/disables and checks menu items and toolbar buttons.
function updateChrome() {
  const boxes = selected().filter(e => e.type === 'box').length;
  const needs = {
    sel: state.sel.length > 0, undo: history.undo.length > 0, redo: history.redo.length > 0,
    clip: !!clipboard, two: boxes >= 2, three: boxes >= 3, one: state.sel.length === 1,
  };
  $$('[data-needs]').forEach(b => { b.disabled = !needs[b.dataset.needs]; });
  $$('[data-check]').forEach(b => {
    const on = !!state.prefs[b.dataset.check];
    b.classList.toggle('checked', on);
    b.setAttribute('aria-pressed', on);
  });
}

/* ---------- Palette ---------- */

const openSections = { Image: false };

function section(title, body, cls = '') {
  const open = openSections[title] !== false;
  return `<details class="section ${cls}" data-section="${title}"${open ? ' open' : ''}><summary>${title}</summary><div class="section-body">${body}</div></details>`;
}

function thumbSVG(el) {
  const ctx = { export: true, getEl: () => null, href: id => esc(state.doc.assets[id] || '') };
  let vb, body;
  if (el.type === 'arrow') {
    const b = arrowGeom(el, () => null).bbox;
    vb = [b.x - 12, b.y - 12, b.w + 24, b.h + 24];
    body = arrowMarkup(el, ctx);
  } else {
    const pad = Math.max(4, el.strokeWidth);
    vb = [-pad, -pad, el.w + pad * 2, el.h + pad * 2];
    if (el.shape === 'none') { // text/icon only: crop to the content so it stays legible
      const L = boxLayout(el), xs = [], ys = [];
      if (L.lines.length) { xs.push(L.tx, L.tx + L.tw); ys.push(L.ty, L.ty + L.lines.length * L.lh); }
      if (L.icon) { xs.push(L.icon.x, L.icon.x + L.icon.s); ys.push(L.icon.y, L.icon.y + L.icon.s); }
      const x0 = Math.min(...xs), y0 = Math.min(...ys), m = 6 + el.textStrokeWidth;
      if (xs.length) vb = [x0 - m, y0 - m, Math.max(...xs) - x0 + m * 2, Math.max(...ys) - y0 + m * 2];
    }
    body = boxMarkup(el, ctx);
  }
  return `<svg viewBox="${vb.map(fmt).join(' ')}" aria-hidden="true">${body}</svg>`;
}

function iconGroups(icons) {
  const folders = [...new Set(icons.map(i => i.folder))];
  return folders.map(f => `<div class="icon-group"><div class="icon-group-name">${esc(f)}</div><div class="icon-grid">`
    + icons.map((ic, i) => ic.folder !== f ? '' : `<button type="button" class="icon-tile" draggable="true" data-icon="${i}" title="${esc(ic.name)}"><img src="${ic.src}" alt="${esc(ic.name)}" draggable="false"></button>`).join('')
    + '</div></div>').join('');
}

function renderPalette() {
  const html = Object.entries(PRESETS).map(([title, items]) => section(title, `<div class="tiles">${items.map(([key, label, make]) =>
    `<button type="button" class="tile" draggable="true" data-preset="${key}" title="${esc(label)}">${thumbSVG(make())}<span>${esc(label)}</span></button>`).join('')}</div>`));
  html.push(section('Icons', `<div class="pal-actions"><input type="search" class="icon-filter" placeholder="Filter icons" aria-label="Filter icons">`
    + `<button type="button" class="btn" data-cmd="loadIcons" title="Add every .png in a folder on your computer">Load folder…</button></div>`
    + iconGroups(iconLibrary())));
  html.push(section('Images', `<button type="button" class="btn wide" data-cmd="addImage">Add image…</button>`
    + `<p class="hint">You can also drop .png or .jpg files onto the canvas, or paste an image with ${isMac ? '⌘' : 'Ctrl'}+V.</p>`));
  palette.innerHTML = html.join('');
}

function filterIcons(root, query) {
  const q = query.trim().toLowerCase();
  root.querySelectorAll('[data-icon]').forEach(b => { b.hidden = !!q && !b.title.toLowerCase().includes(q); });
  root.querySelectorAll('.icon-group').forEach(g => { g.hidden = !g.querySelector('[data-icon]:not([hidden])'); });
}

function createItem(item, p) {
  let el;
  if (item.preset) {
    const preset = findPreset(item.preset);
    if (!preset) return;
    el = preset[2]();
  } else {
    const icon = iconLibrary()[item.icon];
    if (!icon) return;
    el = makeIconElement(icon);
  }
  addElements([placeAt(el, p)]);
}

const itemOf = t => t.dataset.preset ? { preset: t.dataset.preset } : { icon: +t.dataset.icon };

palette.addEventListener('dragstart', e => {
  const t = e.target.closest('[data-preset], [data-icon]');
  if (!t) return;
  e.dataTransfer.setData('application/x-diagram-item', JSON.stringify(itemOf(t)));
  e.dataTransfer.effectAllowed = 'copy';
});
palette.addEventListener('click', e => {
  const t = e.target.closest('[data-preset], [data-icon]');
  if (t) createItem(itemOf(t), viewCenter());
});
palette.addEventListener('input', e => { if (e.target.matches('.icon-filter')) filterIcons(palette, e.target.value); });
palette.addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.section) openSections[e.target.dataset.section] = e.target.open; }, true);

/* ---------- Drag & drop onto the canvas ---------- */

workspace.addEventListener('dragover', e => {
  const types = [...e.dataTransfer.types];
  if (types.includes('application/x-diagram-item') || types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
workspace.addEventListener('drop', e => {
  e.preventDefault();
  const p = toCanvas(e), raw = e.dataTransfer.getData('application/x-diagram-item');
  if (raw) return createItem(JSON.parse(raw), p);
  const files = [...e.dataTransfer.files];
  const json = files.find(f => /\.json$/i.test(f.name));
  if (json) { if (confirmDiscard(`Open ${json.name}`)) openFile(json); return; }
  const images = files.filter(f => f.type.startsWith('image/'));
  if (images.length) addImageFiles(images, p);
});
// Files dropped anywhere else must not make the browser navigate away.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

/* ---------- File inputs ---------- */

let imageMode = 'new';
function pickImage(mode) {
  imageMode = mode;
  const input = $('#fileImage');
  input.value = '';
  input.click();
}
$('#fileImage').addEventListener('change', e => {
  const files = [...e.target.files];
  if (!files.length) return;
  if (imageMode === 'element') setElementImage(files[0]);
  else addImageFiles(files, viewCenter());
});
$('#fileOpen').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file && confirmDiscard(`Open ${file.name}`)) openFile(file);
});
$('#fileIconDir').addEventListener('change', e => {
  loadIconFolder(e.target.files);
  e.target.value = '';
});

/* ---------- Properties panel ---------- */

const FONTS = ['Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];
const DASHES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
const HEADS = [['none', 'None'], ['arrow', 'Arrow'], ['open', 'Open arrow'], ['circle', 'Dot'], ['diamond', 'Diamond']];
const ICON_SIZES = [16, 24, 32, 48, 64];
const ALIGN_ICONS = {
  alignLeft: ['Align left', 'M3 2v14M6 5h9M6 12h5'],
  alignCenter: ['Align centers', 'M9 2v14M3 5h12M5 12h8'],
  alignRight: ['Align right', 'M15 2v14M3 5h9M7 12h5'],
  alignTop: ['Align top', 'M2 3h14M5 6v9M12 6v5'],
  alignMiddle: ['Align middles', 'M2 9h14M5 3v12M12 5v8'],
  alignBottom: ['Align bottom', 'M2 15h14M5 3v9M12 7v5'],
  distributeH: ['Distribute horizontally', 'M2 2v14M16 2v14M9 5v8'],
  distributeV: ['Distribute vertically', 'M2 2h14M2 16h14M5 9h8'],
};

const field = (label, control) => `<div class="field"><span class="label">${label}</span><div class="control">${control}</div></div>`;
const num = (key, o = {}) => `<input type="number" data-key="${key}" step="${o.step || 1}"${o.min != null ? ` min="${o.min}"` : ''}${o.max != null ? ` max="${o.max}"` : ''}${o.disabled ? ' disabled' : ''} aria-label="${o.label || key}">`;
const colorCtl = (key, noneOption) => `<input type="color" data-key="${key}" aria-label="${key} color">`
  + (noneOption ? `<label class="none"><input type="checkbox" data-none="${key}"> None</label>` : '');
const select = (key, opts) => `<select data-key="${key}">${opts.map(o => Array.isArray(o) ? `<option value="${o[0]}">${o[1]}</option>` : `<option>${o}</option>`).join('')}</select>`;
const range = (key, min, max, step) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"><output data-out="${key}"></output>`;
const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, label]) => `<button type="button" data-v="${v}">${label}</button>`).join('')}</div>`;
const check = (key, label) => `<label class="check"><input type="checkbox" data-key="${key}"> ${label}</label>`;
const toggles = `<div class="seg"><button type="button" data-toggle="bold" title="Bold"><b>B</b></button><button type="button" data-toggle="italic" title="Italic"><i>I</i></button></div>`;
const head = (title, note = '') => `<div class="panel-head"><h2>${title}</h2>${note ? `<p>${note}</p>` : ''}</div>`;

function group(title, body) {
  const open = openSections[title] !== false;
  return `<details class="group" data-section="${title}"${open ? ' open' : ''}><summary>${title}</summary><div class="group-body">${body}</div></details>`;
}

function kindOf(el) {
  if (el.type === 'arrow') return el.ends.length > 1 ? 'Multi arrow' : 'Arrow';
  if (el.image) return 'Image';
  if (el.shape === 'none') return el.icon ? (el.text ? 'Text + icon' : 'Icon') : 'Text';
  if (el.text) return el.icon ? 'Text + icon + shape' : 'Text + shape';
  return SHAPES[el.shape] || 'Shape';
}

function textFields(el, multi) {
  return (multi ? '' : `<textarea data-key="text" rows="2" placeholder="Type here, or double-click the element"></textarea>`)
    + field('Font', select('fontFamily', FONTS))
    + field('Size', num('fontSize', { min: 4, max: 400 }) + toggles)
    + field('Fill', colorCtl('textColor'))
    + field('Outline', colorCtl('textStroke') + num('textStrokeWidth', { min: 0, max: 40, step: 0.5, label: 'Outline width' }));
}

function arrangeGroup(sel) {
  const boxes = sel.filter(e => e.type === 'box').length;
  const icon = cmd => `<button type="button" class="icon-btn" data-act="${cmd}" title="${ALIGN_ICONS[cmd][0]}"><svg viewBox="0 0 18 18"><path d="${ALIGN_ICONS[cmd][1]}"/></svg></button>`;
  return group('Arrange',
    `<div class="btn-grid">
      <button type="button" class="btn" data-act="front" title="Ctrl+Shift+]">To front</button>
      <button type="button" class="btn" data-act="forward" title="Ctrl+]">Forward</button>
      <button type="button" class="btn" data-act="backward" title="Ctrl+[">Backward</button>
      <button type="button" class="btn" data-act="back" title="Ctrl+Shift+[">To back</button>
    </div>`
    + (boxes > 1 ? `<div class="align-row">${['alignLeft', 'alignCenter', 'alignRight', 'alignTop', 'alignMiddle', 'alignBottom'].map(icon).join('')}</div>` : '')
    + (boxes > 2 ? `<div class="align-row">${icon('distributeH')}${icon('distributeV')}</div>` : '')
    + `<div class="btn-row"><button type="button" class="btn" data-act="duplicate">Duplicate</button><button type="button" class="btn danger" data-act="delete">Delete</button></div>`);
}

function canvasPanel() {
  return head('Canvas', 'Nothing selected. Drag elements in from the left, or double-click the canvas to add text.')
    + group('Page', `<div class="pair">${field('W', num('w', { min: 100, max: 20000, step: 10 }))}${field('H', num('h', { min: 100, max: 20000, step: 10 }))}</div>`
      + field('Color', colorCtl('bg')) + check('transparent', 'Transparent background'))
    + group('Grid', field('Size', num('grid', { min: 2, max: 500 }))
      + check('pref:grid', 'Show grid') + check('pref:snapGrid', 'Snap to grid') + check('pref:snapObjects', 'Snap to objects'));
}

function boxPanel(sel) {
  const el = sel[0], multi = sel.length > 1, sh = el.shape;
  let extra = '';
  if (sh === 'rect' || sh === 'callout') extra += field('Corners', num('radius', { min: 0, max: 1000 }));
  if (sh === 'polygon') extra += field('Sides', num('sides', { min: 3, max: 10 }));
  if (sh === 'star') extra += field('Points', num('points', { min: 3, max: 12 })) + field('Inner', range('innerRatio', 0.1, 0.9, 0.05));
  if (sh === 'pie') extra += field('Start°', num('pieStart', { min: -360, max: 360, step: 5 })) + field('Angle°', num('pieSweep', { min: 1, max: 360, step: 5 }));
  if (sh === 'parallelogram') extra += field('Slant', range('skew', 0, 0.8, 0.01));
  if (sh === 'callout') extra += field('Tail', select('tailSide', [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']]))
    + field('Tail at', range('tailPos', 0, 1, 0.01)) + field('Tail size', num('tailSize', { min: 0, max: 400 }));
  const style = sh === 'none' ? '' : field('Fill', colorCtl('fill', true)) + field('Outline', colorCtl('stroke', true))
    + field('Width', num('strokeWidth', { min: 0, max: 40, step: 0.5 })) + field('Line', select('dash', DASHES));
  const iconSrc = el.icon && state.doc.assets[el.icon];
  const iconGroup = multi ? '' : group('Icon',
    `<div class="asset-row">${iconSrc ? `<img class="asset-preview" src="${iconSrc}" alt="">` : ''}`
    + `<button type="button" class="btn" data-act="pickIcon">${iconSrc ? 'Change…' : 'Add icon…'}</button>`
    + (iconSrc ? `<button type="button" class="btn" data-act="removeIcon">Remove</button>` : '') + '</div>'
    + (iconSrc ? field('Size', select('iconSize', ICON_SIZES.map(s => [s, s + ' px']))) : '')
    + (iconSrc && el.text ? field('Position', seg('iconPos', [['top', 'Top'], ['left', 'Left'], ['right', 'Right'], ['bottom', 'Bottom']])) : ''));
  const imageGroup = multi ? '' : group('Image', el.image
    ? field('Fit', select('imageFit', [['cover', 'Cover'], ['contain', 'Contain'], ['stretch', 'Stretch']]))
      + `<div class="btn-row"><button type="button" class="btn" data-act="setImage">Replace…</button><button type="button" class="btn" data-act="removeImage">Remove</button></div>`
    : `<button type="button" class="btn wide" data-act="setImage">Add image…</button><p class="hint">The image fills the element and is clipped to its shape.</p>`);
  return head(multi ? `${sel.length} elements` : kindOf(el), isIconOnly(el) && !multi ? 'Icons keep a fixed size. Pick one in Icon below.' : '')
    + group('Layout', `<div class="pair">${field('X', num('x'))}${field('Y', num('y'))}</div>`
      + `<div class="pair">${field('W', num('w', { min: MIN_SIZE, disabled: isIconOnly(el) }))}${field('H', num('h', { min: MIN_SIZE, disabled: isIconOnly(el) }))}</div>`
      + (isIconOnly(el) ? '' : check('lockRatio', 'Keep aspect ratio')))
    + group('Shape', field('Shape', select('shape', Object.entries(SHAPES))) + style + extra)
    + group('Text', textFields(el, multi)
      + field('Align', seg('hAlign', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]))
      + field('Vertical', seg('vAlign', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]))
      + field('Padding', num('padding', { min: 0, max: 400 })))
    + iconGroup + imageGroup
    + group('Appearance', field('Opacity', range('opacity', 0.05, 1, 0.05)))
    + arrangeGroup(sel);
}

function arrowPanel(sel) {
  const a = sel[0], multi = sel.length > 1;
  const ends = multi ? '' : field('Ends', `<span class="count">${a.ends.length}</span><button type="button" class="btn" data-act="addEnd">Add end</button>`
    + `<button type="button" class="btn" data-act="removeEnd"${a.ends.length < 2 ? ' disabled' : ''}>Remove</button>`);
  return head(multi ? `${sel.length} arrows` : kindOf(a), multi ? '' : 'Drag a round handle onto a shape to connect it. Hold Alt to drop it without connecting.')
    + group('Connector', field('Route', seg('route', [['straight', 'Straight'], ['elbow', 'Elbow'], ['curved', 'Curved']])) + ends
      + (a.ends.length > 1 ? field('Split at', range('split', 0, 1, 0.01)) : ''))
    + group('Line', field('Color', colorCtl('stroke')) + field('Width', num('strokeWidth', { min: 0.5, max: 40, step: 0.5 }))
      + field('Line', select('dash', DASHES)) + field('Start', select('headStart', HEADS)) + field('End', select('headEnd', HEADS))
      + field('Opacity', range('opacity', 0.05, 1, 0.05)))
    + group('Label', textFields(a, multi) + field('Background', colorCtl('labelBg', true)))
    + arrangeGroup(sel);
}

function buildPanel() {
  const sel = selected();
  let html;
  if (!sel.length) html = canvasPanel();
  else if (sel.every(e => e.type === 'box')) html = boxPanel(sel);
  else if (sel.every(e => e.type === 'arrow')) html = arrowPanel(sel);
  else html = head(`${sel.length} elements`, 'Shapes and arrows are selected together.') + arrangeGroup(sel);
  props.dataset.scope = sel.length ? 'element' : 'canvas';
  props.innerHTML = html;
  syncPanel(true);
}

function currentValue(key) {
  if (key.startsWith('pref:')) return state.prefs[key.slice(5)];
  if (props.dataset.scope === 'canvas') return state.doc.canvas[key];
  const el = selected()[0];
  return el ? el[key] : undefined;
}

// Copies model values into the panel inputs (skips the input being edited unless forced).
function syncPanel(force) {
  for (const inp of props.querySelectorAll('[data-key]')) {
    if (!force && inp === document.activeElement) continue;
    const v = currentValue(inp.dataset.key);
    if (inp.type === 'checkbox') inp.checked = !!v;
    else if (inp.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) inp.value = v; }
    else if (inp.type === 'number') inp.value = typeof v === 'number' ? Math.round(v * 100) / 100 : '';
    else inp.value = v == null ? '' : v;
  }
  for (const o of props.querySelectorAll('[data-out]')) o.textContent = Math.round(currentValue(o.dataset.out) * 100) + '%';
  for (const n of props.querySelectorAll('[data-none]')) n.checked = currentValue(n.dataset.none) === 'none';
  for (const s of props.querySelectorAll('[data-seg]')) {
    const v = String(currentValue(s.dataset.seg));
    s.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  }
  for (const b of props.querySelectorAll('[data-toggle]')) b.classList.toggle('active', !!currentValue(b.dataset.toggle));
}

function readInput(t, key) {
  if (t.type === 'checkbox') return t.checked;
  if (t.type === 'number' || t.type === 'range' || typeof currentValue(key) === 'number') {
    const n = parseFloat(t.value);
    return isNaN(n) ? undefined : n;
  }
  return t.value;
}

// Applies a property to the canvas or to every selected element that has it.
function setProp(key, v, live) {
  if (v === undefined) return;
  if (key.startsWith('pref:')) { state.prefs[key.slice(5)] = v; savePrefs(); updateChrome(); render(); return; }
  if (props.dataset.scope === 'canvas') {
    if ((key === 'w' || key === 'h' || key === 'grid') && live) return; // apply sizes when the field is done
    if (key === 'w' || key === 'h') v = clamp(v, 100, 20000);
    if (key === 'grid') v = clamp(v, 2, 500);
    state.doc.canvas[key] = v;
    applyZoom();
    render();
    return;
  }
  for (const el of selected()) {
    if (!(key in el)) continue;
    if (key === 'w' || key === 'h') {
      if (isIconOnly(el)) continue;
      v = Math.max(MIN_SIZE, v);
      if (el.lockRatio && el.w && el.h) { if (key === 'w') el.h = v * el.h / el.w; else el.w = v * el.w / el.h; }
    }
    if (key === 'iconSize' && isIconOnly(el)) { // icon-only elements are exactly the icon size
      el.x += (el.w - v) / 2;
      el.y += (el.h - v) / 2;
      el.w = el.h = v;
    }
    el[key] = v;
  }
  render();
}

props.addEventListener('input', e => {
  const t = e.target, key = t.dataset.key;
  if (key) setProp(key, readInput(t, key), true);
});
props.addEventListener('change', e => {
  const t = e.target, key = t.dataset.key;
  if (t.dataset.none) {
    const k = t.dataset.none;
    setProp(k, t.checked ? 'none' : props.querySelector(`input[type=color][data-key="${k}"]`).value);
  } else if (key) setProp(key, readInput(t, key), false);
  commit();
  if (key === 'shape' || key === 'text') buildPanel(); else syncPanel(true);
});
props.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const segEl = b.closest('[data-seg]');
  if (segEl) { setProp(segEl.dataset.seg, b.dataset.v); commit(); syncPanel(true); return; }
  if (b.dataset.toggle) { setProp(b.dataset.toggle, !currentValue(b.dataset.toggle)); commit(); syncPanel(true); return; }
  if (b.dataset.act && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act](b);
});
props.addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.section) openSections[e.target.dataset.section] = e.target.open; }, true);

function updateSelected(fn) {
  for (const el of selected()) if (el.type === 'box') fn(el);
  commit();
  buildPanel();
  render();
}

const ACTIONS = {
  ...COMMANDS,
  pickIcon: btn => openIconPicker(btn, icon => updateSelected(el => { el.icon = addAsset(icon.src); })),
  removeIcon: () => updateSelected(el => { el.icon = null; }),
  setImage: () => pickImage('element'),
  removeImage: () => updateSelected(el => { el.image = null; }),
  addEnd: () => {
    const a = selected()[0];
    const G = arrowGeom(a, byId), last = G.ends[G.ends.length - 1];
    const d = unit(last.x - G.start.x, last.y - G.start.y);
    a.ends.push({ x: last.x - d.y * 60, y: last.y + d.x * 60 });
    commit(); buildPanel(); render();
  },
  removeEnd: () => {
    const a = selected()[0];
    if (a.ends.length > 1) a.ends.pop();
    commit(); buildPanel(); render();
  },
};

/* ---------- Icon picker ---------- */

let popover = null;
function closePopover() {
  if (popover) { popover.remove(); popover = null; }
}
function openIconPicker(anchor, onPick) {
  closePopover();
  const icons = iconLibrary();
  popover = document.createElement('div');
  popover.className = 'popover';
  popover.innerHTML = `<input type="search" class="icon-filter" placeholder="Filter icons" aria-label="Filter icons">${iconGroups(icons)}`;
  document.body.appendChild(popover);
  const r = anchor.getBoundingClientRect(), pw = popover.offsetWidth, ph = popover.offsetHeight;
  popover.style.left = clamp(r.right - pw, 8, innerWidth - pw - 8) + 'px';
  popover.style.top = clamp(r.bottom + 6, 8, innerHeight - ph - 8) + 'px';
  popover.addEventListener('click', e => {
    const t = e.target.closest('[data-icon]');
    if (t) { onPick(icons[+t.dataset.icon]); closePopover(); }
  });
  popover.addEventListener('input', e => filterIcons(popover, e.target.value));
  popover.querySelector('input').focus();
}

/* ---------- Keyboard ---------- */

const KEYMAP = {
  'mod+z': 'undo', 'mod+shift+z': 'redo', 'mod+y': 'redo',
  'mod+s': 'save', 'mod+o': 'open', 'mod+d': 'duplicate', 'mod+a': 'selectAll',
  'delete': 'delete', 'backspace': 'delete', 'escape': 'deselect', 'enter': 'editText', 'f2': 'editText',
  'mod+]': 'forward', 'mod+[': 'backward', 'mod+shift+]': 'front', 'mod+shift+[': 'back',
  'mod+=': 'zoomIn', 'mod+shift+=': 'zoomIn', 'mod+-': 'zoomOut', 'mod+0': 'zoomReset', 'shift+1': 'zoomFit',
  "mod+'": 'toggleGrid',
};
const CODE_KEYS = { BracketRight: ']', BracketLeft: '[', Equal: '=', Minus: '-', Quote: "'", NumpadAdd: '=', NumpadSubtract: '-' };
const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// A mouse click should not leave focus on a button (Space would press it again instead of panning).
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button');
  if (b && e.detail > 0) b.blur();
}, true);

document.addEventListener('keydown', e => {
  if (isTyping(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) return; // keyboard users pressing a button
  if (e.key === 'Escape' && popover) return closePopover();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!state.spaceDown) { state.spaceDown = true; workspace.classList.add('panning'); render(); }
    return;
  }
  if (NUDGE[e.key] && state.sel.length && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    return nudge(NUDGE[e.key][0] * s, NUDGE[e.key][1] * s);
  }
  const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : CODE_KEYS[e.code] || (/^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.toLowerCase());
  const combo = (e.ctrlKey || e.metaKey ? 'mod+' : '') + (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + key;
  const cmd = KEYMAP[combo];
  if (cmd) { e.preventDefault(); run(cmd); }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') { state.spaceDown = false; workspace.classList.remove('panning'); render(); }
});
window.addEventListener('blur', () => { state.spaceDown = false; workspace.classList.remove('panning'); });

/* ---------- System clipboard: elements, images and plain text ---------- */

function onCopy(e, cut) {
  if (isTyping(e.target) || !state.sel.length) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', CLIP_TAG + JSON.stringify(copySelection()));
  if (cut) deleteSelection();
}
document.addEventListener('copy', e => onCopy(e, false));
document.addEventListener('cut', e => onCopy(e, true));
document.addEventListener('paste', e => {
  if (isTyping(e.target) || !e.clipboardData) return;
  const text = e.clipboardData.getData('text/plain');
  const images = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
  if (text.startsWith(CLIP_TAG)) {
    e.preventDefault();
    try { pastePayload(JSON.parse(text.slice(CLIP_TAG.length)), 20 * ++pasteCount); } catch (err) { toast('Could not paste those elements.'); }
  } else if (images.length) {
    e.preventDefault();
    addImageFiles(images, viewCenter());
  } else if (text.trim()) {
    e.preventDefault();
    const el = makeBox({ ...TEXT_ONLY, w: 300, text: text.trim() });
    el.h = Math.max(40, wrapText(el.text, fontCSS(el), el.w - 8).length * el.fontSize * LINE_HEIGHT + 8);
    addElements([placeAt(el, viewCenter())]);
  }
});

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Start ---------- */

function init() {
  if (isMac) $$('kbd').forEach(k => { k.textContent = k.textContent.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧'); });
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(STORAGE.prefs) || '{}')); } catch (e) { /* ignore */ }
  try { userIcons = JSON.parse(localStorage.getItem(STORAGE.icons) || '[]'); } catch (e) { userIcons = []; }
  renderPalette();
  const name = $('#docName');
  name.addEventListener('input', () => { state.doc.name = name.value; });
  name.addEventListener('change', commit);
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE.doc) || 'null'); } catch (e) { /* ignore */ }
  try { loadDocument(saved && Array.isArray(saved.elements) ? saved : exampleDoc()); } catch (e) { loadDocument(exampleDoc()); }
  window.addEventListener('resize', render);
}

init();
