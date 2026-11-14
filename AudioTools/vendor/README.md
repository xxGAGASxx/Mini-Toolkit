# Third-party code

Both files are kept here so Audio Tools works offline, opened straight from disk.

## signalsmith-stretch.js

- **What:** Signalsmith Stretch 1.3.2, the time-stretch and pitch-shift engine used by Speed and Pitch
  (and the pitch change in Delay).
- **Source:** npm package [`signalsmith-stretch@1.3.2`](https://www.npmjs.com/package/signalsmith-stretch),
  file `SignalsmithStretch.js`. Project page: https://signalsmith-audio.co.uk/code/stretch/
- **License:** MIT, Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd. The full notice is at the top of the file.
- **Changes:** only the first part of the original file is kept: the Emscripten module factory with the WASM
  embedded. The AudioWorklet wrapper is left out, because worklets can't load on pages opened from disk
  (`file://`). `js/timepitch.js` drives the module directly.

## lame.min.js

- **What:** lamejs 1.2.1, a JavaScript port of the [LAME](https://lame.sourceforge.io/) MP3 encoder. Used only
  for MP3 export.
- **Source:** npm package [`lamejs@1.2.1`](https://www.npmjs.com/package/lamejs), file `lame.min.js`,
  unmodified. Project page: https://github.com/zhuker/lamejs
- **License:** LGPL-3.0. This tool uses LAME (http://lame.sourceforge.net) as a separate, unmodified file;
  you can replace `lame.min.js` with another build of lamejs that has the same `lamejs.Mp3Encoder` interface.
