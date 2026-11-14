# Mini-Toolkit
Various Web based tools

All tools open straight from disk in the browser. Most work fully offline.
Tools marked **Needs internet** load a library from a CDN (cdn.jsdelivr.net / unpkg.com).


### Frame Notes
- Extract frames from GIF / Video

### Sprite Cutter
- Extract sprites form image

### Sprite Sheet Maker
- Sort sprites into a grid

### MD Comparer
- compare 2 or more md files

### Text Toolkit
- Text case converter, image to text converter
- **Needs internet** for image to text (loads the Tesseract.js OCR engine and language data). The case converter works offline.

### Video Editor
- Resize / Crop / Cut
- **Needs internet** to export (downloads the ffmpeg.wasm encoder, ~32 MB) and to open formats the browser can't play (AVI, MPEG, some MKV). Opening and editing MP4 / WebM works offline.

### 3D Debug Viewer
- 3D Mesh debug modes
- **Needs internet** for the whole tool (loads three.js)

### Diagram Editor
- Draw diagrams with shapes, connected arrows, text, icons and images
- Save / open as JSON, export PNG / JPG / SVG
- Built-in icon library, or load your own icon folder
- See [Diagram-Editor/README.md](Diagram-Editor/README.md) for details and keyboard shortcuts

### Gradient Maker
- Gradients and lighting ramps: color stops with alpha, midpoints, per-segment blend (linear, smooth, ease, hard edge), steps for toon bands
- Blend in OKLab, OKLCH, sRGB, linear RGB or HSL; hue, saturation, brightness, contrast and opacity adjustments
- Linear, reflected, radial, angular, diamond and square shapes; clamp, repeat or mirror outside the gradient
- Several gradients as one atlas texture (rows or columns), with padding that extends edges, and optional power-of-two size
- Export 8-bit or 16-bit PNG (with ordered or noise dithering); the PNG keeps the settings, so it opens again for editing
- Code export: CSS, SVG, Unity C# `Gradient`, GLSL, HLSL, hex list, JSON
- Lit sphere and channel curve previews, presets, undo / redo, autosave
- Open `GradientMaker/gradient-maker.html`. Works offline
