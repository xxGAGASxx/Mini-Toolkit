# JSON / CSV / YAML Converter

A small browser tool that converts between JSON, CSV and YAML. Everything runs locally in the browser; no data is uploaded.

## Use it

Open `index.html` in any modern browser. No build step or server is needed, and it works offline.

To put it online, upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, etc.).

## Files

```
index.html               Page markup
css/styles.css           Styles, light and dark themes
js/app.js                Detection, parsing, conversion and UI logic
js/vendor/papaparse.min.js   Papa Parse 5.4.1 (MIT) - CSV reading and writing
js/vendor/js-yaml.min.js     js-yaml 4.1.0 (MIT) - YAML reading and writing
```

## Features

- Input format detected automatically, or chosen by hand
- Paste, open a file, or drag and drop (.json, .jsonl, .csv, .tsv, .yaml, .yml)
- JSON indent (2, 4, tab, minified), CSV delimiter (comma, semicolon, tab, pipe), YAML indent
- CSV output flattens nested objects into dot columns (`ship_to.city`) and writes lists as JSON text
- CSV input can detect numbers, true/false and blanks, and can rebuild nested objects from dot columns
- JSON Lines and multi-document YAML become one list
- Parse errors show the line and column, with a button to jump to it
- Copy and Download buttons; the swap button turns the output into the new input

The IBM Plex fonts load from Google Fonts when online; offline, the page falls back to system fonts.
