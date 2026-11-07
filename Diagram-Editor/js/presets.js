'use strict';
// Default element properties, the palette presets and the example diagram.

const BOX_DEFAULTS = {
  type: 'box', x: 0, y: 0, w: 140, h: 90,
  // shape
  shape: 'rect', fill: '#dbeafe', stroke: '#3b82f6', strokeWidth: 2, dash: 'solid', opacity: 1,
  radius: 0, sides: 5, points: 5, innerRatio: 0.5, pieStart: 0, pieSweep: 270,
  tailSide: 'bottom', tailPos: 0.3, tailSize: 18, skew: 0.2,
  // text
  text: '', fontFamily: 'Arial', fontSize: 16, bold: false, italic: false,
  textColor: '#1e293b', textStroke: '#ffffff', textStrokeWidth: 0, hAlign: 'center', vAlign: 'middle', padding: 8,
  // icon (fixed size) and image
  icon: null, iconSize: 32, iconPos: 'top',
  image: null, imageFit: 'cover', lockRatio: false,
};

const ARROW_DEFAULTS = {
  type: 'arrow', start: { x: 0, y: 0 }, ends: [{ x: 160, y: 0 }], route: 'straight', split: 0.5,
  stroke: '#334155', strokeWidth: 2, dash: 'solid', headStart: 'none', headEnd: 'arrow', opacity: 1,
  text: '', fontFamily: 'Arial', fontSize: 14, bold: false, italic: false,
  textColor: '#334155', textStroke: '#ffffff', textStrokeWidth: 0, labelBg: '#ffffff',
};

const makeBox = (props = {}) => ({ ...clone(BOX_DEFAULTS), id: uid(), ...props });
const makeArrow = (props = {}) => ({ ...clone(ARROW_DEFAULTS), id: uid(), ...props });
const makeIconElement = icon => makeBox({ shape: 'none', icon: addAsset(icon.src), iconSize: 48, w: 48, h: 48, padding: 0 });

function libIcon(name) {
  const icon = iconLibrary().find(i => i.name === name);
  return icon ? addAsset(icon.src) : null;
}

const TEXT_ONLY = { shape: 'none', w: 160, h: 40, text: 'Text', fontSize: 20, padding: 4 };

// [key, label, factory]. Factories build the element at the origin; the editor moves it into place.
const PRESETS = {
  Shapes: [
    ['rect', 'Rectangle', () => makeBox()],
    ['rounded', 'Rounded', () => makeBox({ radius: 16 })],
    ['circle', 'Circle', () => makeBox({ shape: 'ellipse', w: 100, h: 100 })],
    ['triangle', 'Triangle', () => makeBox({ shape: 'triangle', w: 110, h: 96 })],
    ['diamond', 'Diamond', () => makeBox({ shape: 'diamond', w: 120, h: 100 })],
    ['pie', 'Pie', () => makeBox({ shape: 'pie', w: 100, h: 100 })],
    ['callout', 'Callout', () => makeBox({ shape: 'callout', radius: 12, w: 160, h: 100, fill: '#fef9c3', stroke: '#eab308' })],
    ['polygon', 'Polygon', () => makeBox({ shape: 'polygon', sides: 5, w: 104, h: 100 })],
    ['hexagon', 'Hexagon', () => makeBox({ shape: 'polygon', sides: 6, w: 120, h: 104 })],
    ['star', 'Star', () => makeBox({ shape: 'star', w: 104, h: 100, fill: '#fef3c7', stroke: '#f59e0b' })],
    ['parallelogram', 'Slanted', () => makeBox({ shape: 'parallelogram', w: 150, h: 80 })],
    ['cylinder', 'Cylinder', () => makeBox({ shape: 'cylinder', w: 110, h: 120 })],
    ['cloud', 'Cloud', () => makeBox({ shape: 'cloud', w: 160, h: 100 })],
  ],
  Connectors: [
    ['arrow', 'Arrow', () => makeArrow()],
    ['elbow', 'Elbow', () => makeArrow({ route: 'elbow', ends: [{ x: 160, y: 80 }] })],
    ['curved', 'Curved', () => makeArrow({ route: 'curved', ends: [{ x: 160, y: 80 }] })],
    ['double', 'Two-way', () => makeArrow({ headStart: 'arrow' })],
    ['line', 'Line', () => makeArrow({ headEnd: 'none' })],
    ['multi', 'Multi arrow', () => makeArrow({ start: { x: 0, y: 60 }, ends: [{ x: 160, y: 0 }, { x: 160, y: 60 }, { x: 160, y: 120 }] })],
    ['tree', 'Multi elbow', () => makeArrow({ route: 'elbow', start: { x: 80, y: 0 }, ends: [{ x: 0, y: 110 }, { x: 80, y: 110 }, { x: 160, y: 110 }] })],
  ],
  Text: [
    ['text', 'Text', () => makeBox(TEXT_ONLY)],
    ['heading', 'Heading', () => makeBox({ ...TEXT_ONLY, w: 260, h: 50, text: 'Heading', fontSize: 32, bold: true })],
    ['outlined', 'Outlined', () => makeBox({ ...TEXT_ONLY, w: 220, h: 56, text: 'Outline', fontSize: 36, bold: true, textColor: '#ffffff', textStroke: '#1e293b', textStrokeWidth: 5 })],
    ['text-shape', 'Text + shape', () => makeBox({ radius: 8, w: 160, h: 64, text: 'Text' })],
    ['text-icon', 'Text + icon', () => makeBox({ shape: 'none', w: 160, h: 48, text: 'Label', icon: libIcon('user'), iconPos: 'left', hAlign: 'left', padding: 4 })],
    ['text-icon-shape', 'Text + icon + shape', () => makeBox({ radius: 12, w: 150, h: 110, text: 'Service', icon: libIcon('server'), iconSize: 40, fill: '#ffffff', stroke: '#94a3b8' })],
  ],
};

function findPreset(key) {
  for (const list of Object.values(PRESETS)) for (const p of list) if (p[0] === key) return p;
  return null;
}

// The diagram shown on first launch.
function exampleDoc() {
  const assets = {};
  const icon = name => {
    const found = (window.ICON_LIBRARY || []).find(i => i.name === name);
    if (!found) return null;
    const id = 'a' + hashString(found.src);
    assets[id] = found.src;
    return id;
  };
  const card = { fill: '#ffffff', stroke: '#94a3b8', radius: 14, bold: true, fontSize: 17 };
  const customer = makeBox({ shape: 'none', x: 80, y: 326, w: 120, h: 108, text: 'Customer', icon: icon('user'), iconSize: 48 });
  const shop = makeBox({ ...card, x: 300, y: 340, w: 190, h: 80, fill: '#eff6ff', stroke: '#3b82f6', radius: 12, text: 'Web shop', icon: icon('laptop'), iconPos: 'left' });
  const api = makeBox({ ...card, x: 620, y: 318, w: 170, h: 124, text: 'Order API', icon: icon('server'), iconSize: 48 });
  const db = makeBox({ ...card, shape: 'cylinder', x: 900, y: 140, w: 180, h: 124, fill: '#ecfdf5', stroke: '#10b981', text: 'Orders DB' });
  const pay = makeBox({ ...card, x: 900, y: 342, w: 180, h: 76, radius: 38, fill: '#fffbeb', stroke: '#f59e0b', text: 'Payments', icon: icon('lock'), iconSize: 24, iconPos: 'left' });
  const mail = makeBox({ ...card, shape: 'parallelogram', skew: 0.15, x: 900, y: 512, w: 190, h: 80, fill: '#f5f3ff', stroke: '#8b5cf6', text: 'Email queue', icon: icon('mail'), iconSize: 24, iconPos: 'left' });
  const elements = [
    makeBox({ ...TEXT_ONLY, x: 60, y: 44, w: 620, h: 44, text: 'How an order flows', fontSize: 30, bold: true, hAlign: 'left', textColor: '#0f172a' }),
    makeBox({ ...TEXT_ONLY, x: 60, y: 92, w: 620, h: 26, text: 'Double-click any element to edit its text. Drag new elements in from the left.', fontSize: 15, hAlign: 'left', textColor: '#64748b' }),
    makeBox({ shape: 'callout', x: 250, y: 160, w: 240, h: 110, radius: 12, tailPos: 0.4, tailSize: 20, fill: '#fef9c3', stroke: '#eab308', text: 'Hover a shape, then drag from one of its blue dots to connect it.', fontSize: 14, padding: 14 }),
    customer, shop, api, db, pay, mail,
    makeArrow({ start: { id: customer.id, x: 200, y: 380 }, ends: [{ id: shop.id, x: 300, y: 380 }], text: 'browses' }),
    makeArrow({ start: { id: shop.id, x: 490, y: 380 }, ends: [{ id: api.id, x: 620, y: 380 }], text: 'places order' }),
    makeArrow({ route: 'elbow', start: { id: api.id, ax: 1, ay: 0.5, x: 790, y: 380 }, ends: [db, pay, mail].map(t => ({ id: t.id, x: t.x, y: t.y + t.h / 2 })) }),
  ];
  return { name: 'Example diagram', canvas: { w: 1200, h: 680, bg: '#ffffff', transparent: false, grid: 20 }, elements, assets };
}
