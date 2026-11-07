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
