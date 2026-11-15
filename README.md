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

### Texture Tools
- Transform: resize (Lanczos, bicubic, bilinear, nearest), crop with a box on the image, trim, rotate / flip, canvas size
- Color: brightness / contrast, hue / saturation / colorize, shadows / highlights
- Effects: blur / sharpen, pixelate / posterize, noise, gradient overlay, pattern overlay (built-in or your own tile), outline
- Tiling: tiled preview, seam fix, even out lighting, wrap offset, filters that wrap around the edges
- Color, Effects and Tiling stay live on top of the image until you export; Bake applies them for good. Undo / redo for everything
- Export PNG, JPEG, WebP, BMP, TGA. PNG, BMP and TGA keep exact colors under transparent pixels. Opens TGA files too
- Open `TextureTools/texture-tools.html`. Works offline

### Audio Tools
- Edit: cut, copy, paste, delete, trim to selection, silence, insert silence, reverse, fade in / out, volume, normalize, mono / stereo / swap channels
- Split: mark clip boundaries without removing audio, split at silences (optionally removing them), trim silence at both ends; export each region as its own file in a ZIP
- Effects: reverb (presets from small room to cathedral, plus reverse reverb), delay (regular, ping-pong, bouncing ball, reverse, with pitch change per repeat), echo, distortion (11 types, 4× oversampled), compressor / limiter
- Speed & pitch: change speed while keeping pitch (or like a tape), stretch to an exact length, shift pitch while keeping speed, with an option to keep a voice's character
- Clean up: noise reduction (learn the noise from a selection, or estimate it automatically), hum removal (50 / 60 Hz, found automatically), low / high cut
- Preview any tool before applying it; it re-renders as you move the sliders. Tools work on the selection, or the whole file. Undo / redo for everything
- Opens WAV, AIFF, MP3, OGG, Opus, FLAC, M4A / AAC and the sound of MP4 / WebM videos at their own sample rate. WAV cue points become splits
- Export WAV (16 / 24-bit, 32-bit float, splits saved as cue points), FLAC, MP3, Opus (.ogg), at any common sample rate, mono or stereo
- Open `AudioTools/audio-tools.html`. Works offline. Includes two libraries in `AudioTools/vendor/`: Signalsmith Stretch (MIT) for speed and pitch, and lamejs (LGPL) for MP3; see `AudioTools/vendor/README.md`

### VFX Texture Generator
- Particle and effect textures built from 19 kinds of layer: glow, ring, star / flare, shape (circle, square, polygon, star, cross, heart), gradient (linear, radial, angle, diamond, square, with repeats and steps), spark / streak, trail, slash / arc, lightning, particles (dots, sparkles or streaks that can travel out, in, up or down), smoke / cloud, flame, vortex / swirl, splatter, cracks (with glass-like rings), crystal / snowflake, rune ring (made-up glyphs, or one big sigil), caustics and noise (smooth, puffy, ridged, cells, cell edges)
- Each layer has position, scale, stretch, rotation, opacity, invert and a blend mode (add, screen, lighten, mask, subtract). Drag in the view to move a layer, Shift+drag to turn it, Alt+drag to scale it
- Dissolve on any layer: noise eats it away, evenly or starting from the outside, center or a side, with an optional burning edge
- Color: white + alpha (tint in the engine), grayscale on black, a color ramp (with presets, or taken from any image), or pack layers into the R / G / B / A channels
- Intensity and gamma; edge fade (round, square, top and bottom), with a warning when the frame edges are not fully transparent
- Flipbook: 2–64 frames on one sheet. Per layer: scale, opacity and rotation over time, flicker, pulse (whole beats, so loops join), noise motion and new random shapes per frame. Any slider of a layer (and its dissolve) can be animated too: click ◆ beside it and set its value for the last frame. Lightning can strike, cracks spread, crystals grow and runes be written. Seamless loops or eased one-shots
- Preview the texture on sprites: one sprite or a burst, fountain or rising particles, additive or alpha blend, with tint and background
- Up to 2048 px frames (4096 px sheets), with 2× or 4× supersampling. Noise and caustics can tile seamlessly
- Export 8-bit (dithered) or 16-bit PNG, straight or premultiplied alpha; the PNG keeps the settings, so it opens again for editing. Save / open .json
- 59 presets in three groups (still, animated, tiling and masks): explosions, fire loops, portals, slashes, lightning strikes, magic circles, splats, variant sheets and more. Your own presets saved in the browser, undo / redo, autosave
- Open `VFXGenerator/vfx-generator.html`. Works offline
