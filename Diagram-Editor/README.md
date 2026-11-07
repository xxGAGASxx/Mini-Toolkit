# Diagram Editor

A browser-based diagram editor in plain HTML, CSS and JavaScript. There is no build step and nothing to install.
Open `index.html` in Chrome, Edge, Firefox or Safari. It works straight from disk.

## Layout

| Area   | What it does |
|--------|--------------|
| Top    | **File** (New, Open, Save, Export PNG/JPG/SVG, Add image, Load icon folder), **Edit**, **View** (grid, snap to grid, snap to objects, zoom), **Arrange** (order, align, distribute). Quick buttons on the right. |
| Left   | Elements to drag onto the canvas, or click to add at the center: shapes, connectors, text, icons, images. |
| Middle | The canvas: a page with a color and a grid, on a scrollable workspace. |
| Right  | Properties of the selection. With nothing selected it shows the canvas size, color and grid. |

## Elements

- **Shapes**: rectangle (rounded corners), ellipse/circle, triangle, diamond, pie, callout, polygon (3–10 sides), star, slanted, cylinder and cloud. Each has a fill and an outline (color, width, solid/dashed/dotted).
- **Arrows**: drag the round end handles onto a shape to connect them. Dropping on one of the shape's four snap points pins the end there. Dropping anywhere else on the shape lets the end slide around the outline as shapes move. Hold **Alt** to drop without connecting. Routes are straight, elbow or curved. Ends can be an arrow, open arrow, dot, diamond or nothing. The label sits in the middle.
- **Multi arrows**: one start and several ends (**Add end** in the panel). Elbow routing draws a tree, the other routes fan out from a split point.
- **Text**: on its own, or combined with a shape and/or an icon. Text has a fill and an outline, font, size, bold/italic, alignment and padding. Double-click any element to edit its text.
- **Icons**: PNG images at fixed sizes (16–64 px). The built-in library comes from the `icons/` folder.
- **Images**: PNG/JPG via **Add image…**, drag and drop from your computer, or paste (Ctrl+V). An image can also be put inside a shape, where it's clipped to the outline.

Hover a shape and drag from one of its blue snap points to draw a new connected arrow.
Moving elements snaps to the grid and lines up with other elements' edges and centers (guides show in pink). Hold **Alt** while dragging to turn snapping off.

## Saving and exporting

- **Save** downloads a `.json` file containing all images and icons the diagram uses. Open it with **File › Open** or drop it on the canvas.
- The current diagram is also autosaved in the browser and comes back when you reopen the page.
- **Export** writes PNG (1× or 2×), JPG or SVG of the canvas page. Turn on **Transparent background** in the canvas properties for a transparent PNG/SVG.

## Icon library

The icons in `icons/` are embedded into `js/icon-library.js` because browsers don't let a page read a folder by itself when it's opened from disk.

- To change the built-in library, add or remove PNG files in `icons/<group>/` (each sub-folder becomes a group), then run `node tools/build-icon-library.js`.
- To use any folder without rebuilding, click **Load folder…** in the Icons section. The app remembers the loaded icons if they fit in browser storage.

## Keyboard

| Keys | Action |
|------|--------|
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo |
| Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D | Copy, cut, paste, duplicate |
| Delete / Backspace | Delete selection |
| Arrow keys (+Shift) | Nudge by 1 px (10 px) |
| Enter or F2 | Edit text of the selected element |
| Ctrl+] / Ctrl+[ | Bring forward / send backward |
| Ctrl+Shift+] / Ctrl+Shift+[ | Bring to front / send to back |
| Ctrl+S, Ctrl+O | Save, open |
| Ctrl + mouse wheel, Ctrl++ / Ctrl+-, Ctrl+0, Shift+1 | Zoom, actual size, fit page |
| Space + drag, or middle mouse | Pan |
| Shift while resizing | Flip the aspect-ratio lock |

On a Mac use ⌘ instead of Ctrl.

## Files

```
index.html               page layout and menus
css/style.css            all styling
js/util.js               helpers (geometry, text measuring and wrapping, files)
js/shapes.js             procedural shapes, outlines and snap points
js/render.js             element to SVG: boxes, arrow routing, heads, export
js/presets.js            default properties, palette items, example diagram
js/editor.js             state, undo history, canvas interaction, snapping, clipboard, files
js/ui.js                 menus, palette, properties panel, keyboard
js/icon-library.js       generated from icons/
icons/                   built-in PNG icons, one sub-folder per group
fonts/                   IBM Plex Sans for the interface (SIL Open Font License)
tools/build-icon-library.js
```
