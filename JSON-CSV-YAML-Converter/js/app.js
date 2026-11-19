(() => {
  'use strict';

  const FMT = { json: 'JSON', csv: 'CSV', yaml: 'YAML' };
  const DELIM_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
  const EXT_FMT = { json: 'json', jsonl: 'json', ndjson: 'json', csv: 'csv', tsv: 'csv', yaml: 'yaml', yml: 'yaml' };
  const PREFS_KEY = 'jcy-converter:v1';
  const VALID = { jsonIndent: ['2', '4', 'tab', 'min'], yamlIndent: ['2', '4'], csvDelim: [',', ';', '\t', '|'] };

  const SAMPLE = JSON.stringify([
    { order_id: 'A-1042', customer: 'Lena Park', total: 84.5, paid: true, items: ['notebook', 'pen set'], ship_to: { city: 'Lisbon', country: 'PT' } },
    { order_id: 'A-1043', customer: 'Omar Haddad', total: 129, paid: false, items: ['desk lamp'], ship_to: { city: 'Toronto', country: 'CA' } },
    { order_id: 'A-1044', customer: 'Mia Schulz', total: 19.99, paid: true, items: [], ship_to: { city: 'Berlin', country: 'DE' } }
  ], null, 2);

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $('input'), output: $('output'),
    inSeg: $('in-seg'), outSeg: $('out-seg'),
    inStatus: $('in-status'), outStatus: $('out-status'), flash: $('out-flash'),
    inOptsCsv: $('in-opts-csv'), inOptsNone: $('in-opts-none'),
    outOpts: { json: $('out-opts-json'), csv: $('out-opts-csv'), yaml: $('out-opts-yaml') },
    typed: $('opt-typed'), nest: $('opt-nest'),
    jsonIndent: $('opt-json-indent'), csvDelim: $('opt-csv-delim'), yamlIndent: $('opt-yaml-indent'),
    copy: $('copy-btn'), dl: $('dl-btn'), dlLabel: $('dl-label'),
    open: $('open-btn'), file: $('file-input'), sample: $('sample-btn'), clear: $('clear-btn'),
    swap: $('swap-btn'), inPane: $('in-pane'),
    err: $('error'), errTitle: $('error-title'), errMsg: $('error-msg'), errHelp: $('error-help'),
    errActions: $('error-actions'), errJump: $('error-jump')
  };

  const state = {
    inFmt: 'auto', outFmt: 'csv', effIn: null,
    hint: null, fileName: null, fileBase: 'data', isSample: false, jump: null,
    opts: { jsonIndent: '2', yamlIndent: '2', csvDelim: ',', csvTyped: true, csvNest: false }
  };

  class ConvertError extends Error {
    constructor(message, where, line, col, help) {
      super(message);
      this.where = where; this.line = line; this.col = col; this.help = help;
    }
  }

  // ---------- helpers ----------
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const byteSize = (s) => new Blob([s]).size;
  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function typeName(v) {
    if (v === null || v === undefined) return 'null value';
    if (typeof v === 'string') return 'piece of text';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'true/false value';
    return typeof v;
  }
  function describe(d) {
    if (Array.isArray(d)) return plural(d.length, 'record');
    if (isObj(d)) return plural(Object.keys(d).length, 'key');
    return 'a single ' + typeName(d);
  }
  function lineCol(text, pos) {
    let line = 1, last = -1;
    for (let i = 0; i < pos && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) { line++; last = i; }
    }
    return { line, col: pos - last };
  }

  // ---------- detection ----------
  function detect(text, hint) {
    if (hint) return hint;
    const t = text.trim();
    if (t[0] === '{' || t[0] === '[') return 'json';
    if (/^(---|%YAML)/.test(t)) return 'yaml';
    const lines = t.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l)).slice(0, 60);
    if (!lines.length) return 'yaml';
    const yamlish = lines.filter((l) =>
      /^\s*-(\s|$)/.test(l) ||
      /^\s*[^\s,;\t|"'#-][^,;\t|]*?:(\s|$)/.test(l) ||
      /^\s*["'][^"']*["']\s*:(\s|$)/.test(l)
    ).length;
    if (yamlish / lines.length >= 0.5) return 'yaml';
    if (/[,;\t|]/.test(lines[0])) return 'csv';
    return lines.length > 1 ? 'csv' : 'yaml';
  }

  // ---------- parsers ----------
  function parseJSON(text) {
    try {
      return { data: JSON.parse(text), notes: [] };
    } catch (e) {
      const rows = text.split(/\r?\n/).filter((l) => l.trim());
      if (rows.length > 1 && rows[0].trim()[0] === '{') {
        try {
          const data = rows.map((l) => JSON.parse(l));
          return { data, notes: ['Read as JSON Lines, one record per line'] };
        } catch (_) { /* fall through to the original error */ }
      }
      let msg = String((e && e.message) || e);
      let line, col, m;
      if ((m = msg.match(/line (\d+) column (\d+)/i))) { line = +m[1]; col = +m[2]; }
      else if ((m = msg.match(/position (\d+)/i))) { ({ line, col } = lineCol(text, +m[1])); }
      msg = msg
        .replace(/^JSON\.parse:\s*/i, '')
        .replace(/^JSON Parse error:\s*/i, '')
        .replace(/\s*\(line \d+ column \d+\)/i, '')
        .replace(/\s*at line \d+ column \d+ of the JSON data/i, '')
        .replace(/,?\s*(in JSON )?at position \d+/i, '')
        .trim();
      throw new ConvertError(cap(msg) || 'Invalid JSON', 'input', line, col);
    }
  }

  function yamlError(e) {
    const mark = e && e.mark;
    const reason = (e && (e.reason || e.message)) || 'Invalid YAML';
    return new ConvertError(cap(reason), 'input', mark ? mark.line + 1 : undefined, mark ? mark.column + 1 : undefined);
  }
  function parseYAML(text) {
    try {
      return { data: jsyaml.load(text), notes: [] };
    } catch (e) {
      if (e && /single document/i.test(e.message || '')) {
        try {
          const docs = [];
          jsyaml.loadAll(text, (d) => docs.push(d));
          return { data: docs, notes: [`${docs.length} YAML documents combined into one list`] };
        } catch (e2) { throw yamlError(e2); }
      }
      throw yamlError(e);
    }
  }

  const NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  function typeCell(v) {
    if (v === '') return null;
    const s = v.trim();
    if (/^true$/i.test(s)) return true;
    if (/^false$/i.test(s)) return false;
    if (NUM.test(s) && s.replace(/[-.eE+]/g, '').length <= 15) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    if ((s[0] === '[' && s.endsWith(']')) || (s[0] === '{' && s.endsWith('}'))) {
      try { return JSON.parse(s); } catch (_) { /* keep as text */ }
    }
    return v;
  }
  function nest(rec) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      const parts = k.split('.');
      if (parts.length < 2 || parts.some((p) => !p || /\s/.test(p))) {
        if (!(k in out)) out[k] = v;
        continue;
      }
      let cur = out, ok = true;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (cur[p] === undefined) cur[p] = {};
        else if (!isObj(cur[p])) { ok = false; break; }
        cur = cur[p];
      }
      const leaf = parts[parts.length - 1];
      if (ok && !(leaf in cur)) cur[leaf] = v;
      else if (!(k in out)) out[k] = v;
    }
    return out;
  }
  function uniqueHeaders(row, width) {
    const seen = new Map();
    const out = [];
    for (let i = 0; i < width; i++) {
      let h = row[i] === undefined ? '' : String(row[i]).trim();
      if (!h) h = `column_${i + 1}`;
      let name = h, n = 1;
      while (seen.has(name)) name = `${h}_${++n}`;
      seen.set(name, true);
      out.push(name);
    }
    return out;
  }
  function parseCSV(text) {
    const res = Papa.parse(text, { header: false, skipEmptyLines: 'greedy', delimiter: '' });
    const quoteErr = res.errors.find((e) => e.type === 'Quotes');
    if (quoteErr) {
      const pos = typeof quoteErr.index === 'number' ? lineCol(text, quoteErr.index) : {};
      throw new ConvertError(quoteErr.message || 'A quoted field is not closed', 'input', pos.line, pos.col);
    }
    const rows = res.data;
    if (!rows.length) throw new ConvertError('No rows found.', 'input');
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const header = uniqueHeaders(rows[0], width);
    const notes = [];
    const d = res.meta && res.meta.delimiter;
    if (d && d !== ',' && DELIM_NAMES[d]) notes.push(`${cap(DELIM_NAMES[d])}-separated`);
    let ragged = 0;
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== rows[0].length) ragged++;
      const rec = {};
      header.forEach((h, j) => {
        const v = r[j] === undefined ? '' : r[j];
        rec[h] = state.opts.csvTyped ? typeCell(v) : v;
      });
      data.push(state.opts.csvNest ? nest(rec) : rec);
    }
    if (!data.length) notes.push('Only a header row');
    if (ragged) notes.push(`${plural(ragged, 'row')} had a different number of fields than the header`);
    return { data, notes };
  }

  const PARSERS = { json: parseJSON, yaml: parseYAML, csv: parseCSV };

  // ---------- serializers ----------
  function toJSON(data) {
    const ind = state.opts.jsonIndent;
    const space = ind === 'min' ? undefined : ind === 'tab' ? '\t' : Number(ind);
    const text = JSON.stringify(data === undefined ? null : data, null, space);
    return { text, notes: [] };
  }
  function toYAML(data) {
    const text = jsyaml.dump(data === undefined ? null : data, {
      indent: Number(state.opts.yamlIndent), lineWidth: -1, noRefs: true
    });
    return { text, notes: [] };
  }
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function flattenInto(obj, prefix, out, flags) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (isObj(v) && Object.keys(v).length) {
        flags.nested = true;
        flattenInto(v, key, out, flags);
      } else {
        if ((Array.isArray(v) && v.length) || isObj(v)) flags.lists = true;
        out[key] = cellText(v);
      }
    }
  }
  function toCSV(data) {
    const notes = [];
    const help = 'Choose JSON or YAML output instead, or give a list of records.';
    let list = data;
    if (isObj(data)) {
      const keys = Object.keys(data);
      if (keys.length === 1 && Array.isArray(data[keys[0]])) {
        list = data[keys[0]];
        notes.push(`Used the "${keys[0]}" list`);
      } else if (keys.length > 1 && keys.every((k) => isObj(data[k]))) {
        const col = keys.some((k) => 'key' in data[k]) ? '_key' : 'key';
        list = keys.map((k) => Object.assign({ [col]: k }, data[k]));
        notes.push(`Each top-level key became a row (column "${col}")`);
      } else {
        list = [data];
      }
    } else if (!Array.isArray(data)) {
      throw new ConvertError(`CSV needs a list of records, and this data is a single ${typeName(data)}.`, 'output', undefined, undefined, help);
    }
    if (!list.length) {
      throw new ConvertError('There are no records to write: the list is empty.', 'output', undefined, undefined, help);
    }
    const delimiter = state.opts.csvDelim;
    if (list.every(Array.isArray)) {
      const text = Papa.unparse(list.map((r) => r.map(cellText)), { delimiter, newline: '\n' });
      notes.push('Lists written as rows without a header');
      return { text, notes, rows: list.length, cols: list.reduce((w, r) => Math.max(w, r.length), 0) };
    }
    const headers = [];
    const seen = new Set();
    const flags = { nested: false, lists: false };
    const rows = list.map((item) => {
      const flat = {};
      if (isObj(item)) flattenInto(item, '', flat, flags);
      else flat.value = cellText(item);
      for (const k of Object.keys(flat)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
      return flat;
    });
    if (flags.nested) notes.push('Nested fields became dot columns');
    if (flags.lists) notes.push('Lists written as JSON text');
    const text = Papa.unparse(
      { fields: headers, data: rows.map((r) => headers.map((h) => (h in r ? r[h] : ''))) },
      { delimiter, newline: '\n' }
    );
    return { text, notes, rows: rows.length, cols: headers.length };
  }

  const SERIALIZERS = { json: toJSON, yaml: toYAML, csv: toCSV };

  // ---------- status rendering ----------
  function chip(fmt, tag) {
    const s = document.createElement('span');
    s.className = 'chip';
    s.dataset.fmt = fmt;
    const d = document.createElement('span');
    d.className = 'dot';
    s.append(d, FMT[fmt]);
    if (tag) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = tag;
      s.append(t);
    }
    return s;
  }
  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }
  function setStatus(target, items) {
    target.replaceChildren();
    for (const it of items) {
      if (!it) continue;
      if (target.childNodes.length) target.append(span('sep', '·'));
      target.append(typeof it === 'string' ? document.createTextNode(it) : it);
    }
  }
  let flashTimer;
  function flash(msg) {
    el.flash.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.flash.textContent = ''; }, 3200);
  }

  // ---------- UI sync ----------
  function setPressed(seg, val) {
    seg.querySelectorAll('button[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === val)));
  }
  function syncControls() {
    setPressed(el.inSeg, state.inFmt);
    setPressed(el.outSeg, state.outFmt);
    el.typed.checked = state.opts.csvTyped;
    el.nest.checked = state.opts.csvNest;
    el.jsonIndent.value = state.opts.jsonIndent;
    el.csvDelim.value = state.opts.csvDelim;
    el.yamlIndent.value = state.opts.yamlIndent;
    for (const f of Object.keys(el.outOpts)) el.outOpts[f].hidden = f !== state.outFmt;
    el.dl.title = `Save as a .${state.outFmt} file`;
  }
  function showInputOpts(fmt) {
    const csv = fmt === 'csv';
    el.inOptsCsv.hidden = !csv;
    el.inOptsNone.hidden = csv;
  }
  function markDetected(fmt) {
    el.inSeg.querySelectorAll('button[data-fmt]').forEach((b) =>
      b.classList.toggle('is-detected', state.inFmt === 'auto' && b.dataset.fmt === fmt));
  }
  function setButtons(on) {
    el.copy.disabled = !on;
    el.dl.disabled = !on;
    el.swap.disabled = !on;
  }
  function hideError() { el.err.hidden = true; state.jump = null; }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!p || typeof p !== 'object') return;
      if (FMT[p.outFmt]) state.outFmt = p.outFmt;
      const o = p.opts || {};
      for (const k of Object.keys(VALID)) if (VALID[k].includes(o[k])) state.opts[k] = o[k];
      if (typeof o.csvTyped === 'boolean') state.opts.csvTyped = o.csvTyped;
      if (typeof o.csvNest === 'boolean') state.opts.csvNest = o.csvNest;
    } catch (_) { /* storage unavailable */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ outFmt: state.outFmt, opts: state.opts })); } catch (_) { /* ignore */ }
  }

  // ---------- conversion ----------
  function inputLabelParts(fmt) {
    return [
      state.fileName ? span('note', state.fileName) : (state.isSample ? span('note', 'Example data') : null),
      chip(fmt, state.inFmt === 'auto' ? (state.hint ? 'from file name' : 'detected') : '')
    ];
  }

  function fail(e, inFmt) {
    const err = e instanceof ConvertError ? e : new ConvertError(cap(String((e && e.message) || e)), 'output');
    el.output.value = '';
    setButtons(false);
    const isIn = err.where === 'input';
    el.errTitle.textContent = isIn ? `Couldn't read this as ${FMT[inFmt]}` : `Couldn't write ${FMT[state.outFmt]}`;
    const loc = err.line ? `Line ${err.line}${err.col ? `, column ${err.col}` : ''}: ` : '';
    el.errMsg.textContent = loc + err.message;
    if (isIn) {
      el.errHelp.textContent = state.inFmt === 'auto'
        ? `The input was read as ${FMT[inFmt]}. If it's another format, pick it above the input.`
        : 'Fix the input, or pick a different input format.';
    } else {
      el.errHelp.textContent = err.help || 'Pick a different output format.';
    }
    state.jump = isIn && err.line ? { line: err.line } : null;
    el.errActions.hidden = !state.jump;
    el.err.hidden = false;
    if (isIn) {
      setStatus(el.inStatus, [...inputLabelParts(inFmt), span('bad', err.line ? `Error on line ${err.line}` : 'Error')]);
      setStatus(el.outStatus, []);
    } else {
      setStatus(el.outStatus, [chip(state.outFmt), span('bad', 'Not possible for this data')]);
    }
  }

  function convert() {
    const raw = el.input.value;
    const text = raw.replace(/^﻿/, '');
    hideError();
    if (!text.trim()) {
      el.output.value = '';
      setButtons(false);
      showInputOpts(null);
      markDetected(null);
      setStatus(el.inStatus, ['Paste data, open a file, or drop one onto the page']);
      setStatus(el.outStatus, []);
      return;
    }
    const fmt = state.inFmt === 'auto' ? detect(text, state.hint) : state.inFmt;
    state.effIn = fmt;
    showInputOpts(fmt);
    markDetected(fmt);

    let parsed;
    try { parsed = PARSERS[fmt](text); } catch (e) { return fail(e, fmt); }
    setStatus(el.inStatus, [
      ...inputLabelParts(fmt),
      describe(parsed.data),
      fmtBytes(byteSize(raw)),
      ...parsed.notes.map((n) => span('note', n))
    ]);

    let out;
    try { out = SERIALIZERS[state.outFmt](parsed.data); } catch (e) { return fail(e, fmt); }
    el.output.value = out.text;
    setButtons(true);
    const size = fmtBytes(byteSize(out.text));
    const shape = state.outFmt === 'csv'
      ? `${plural(out.rows, 'row')} × ${plural(out.cols, 'column')}`
      : plural(out.text.split('\n').length, 'line');
    setStatus(el.outStatus, [chip(state.outFmt), shape, size, ...out.notes.map((n) => span('note', n))]);
  }

  let timer;
  function scheduleConvert() {
    clearTimeout(timer);
    timer = setTimeout(convert, el.input.value.length > 200000 ? 300 : 90);
  }

  // ---------- input sources ----------
  function resetSource() {
    state.hint = null;
    state.fileName = null;
    state.fileBase = 'data';
    state.isSample = false;
  }
  async function readFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setStatus(el.inStatus, [span('bad', `${file.name} is ${fmtBytes(file.size)}. Files over 50 MB are too large to convert here.`)]);
      return;
    }
    let text;
    try { text = await file.text(); }
    catch (_) {
      setStatus(el.inStatus, [span('bad', `Couldn't read ${file.name}. Try opening it again.`)]);
      return;
    }
    const m = file.name.match(/\.([^./\\]+)$/);
    const ext = m ? m[1].toLowerCase() : '';
    resetSource();
    state.hint = EXT_FMT[ext] || null;
    state.fileName = file.name;
    state.fileBase = file.name.replace(/\.[^.]+$/, '') || 'data';
    state.inFmt = 'auto';
    syncControls();
    el.input.value = text;
    el.input.scrollTop = 0;
    convert();
  }

  // ---------- events ----------
  el.input.addEventListener('input', () => {
    if (state.isSample) state.isSample = false;
    scheduleConvert();
  });
  el.input.addEventListener('paste', () => {
    if (el.input.selectionStart === 0 && el.input.selectionEnd === el.input.value.length) resetSource();
    else state.hint = null;
  });

  el.inSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fmt]');
    if (!b) return;
    state.inFmt = b.dataset.fmt;
    syncControls();
    convert();
  });
  el.outSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fmt]');
    if (!b) return;
    state.outFmt = b.dataset.fmt;
    syncControls();
    savePrefs();
    convert();
  });

  el.typed.addEventListener('change', () => { state.opts.csvTyped = el.typed.checked; savePrefs(); convert(); });
  el.nest.addEventListener('change', () => { state.opts.csvNest = el.nest.checked; savePrefs(); convert(); });
  el.jsonIndent.addEventListener('change', () => { state.opts.jsonIndent = el.jsonIndent.value; savePrefs(); convert(); });
  el.csvDelim.addEventListener('change', () => { state.opts.csvDelim = el.csvDelim.value; savePrefs(); convert(); });
  el.yamlIndent.addEventListener('change', () => { state.opts.yamlIndent = el.yamlIndent.value; savePrefs(); convert(); });

  el.open.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    readFile(el.file.files && el.file.files[0]);
    el.file.value = '';
  });
  el.sample.addEventListener('click', () => {
    resetSource();
    state.isSample = true;
    state.inFmt = 'auto';
    syncControls();
    el.input.value = SAMPLE;
    convert();
  });
  el.clear.addEventListener('click', () => {
    resetSource();
    el.input.value = '';
    convert();
    el.input.focus();
  });

  el.swap.addEventListener('click', () => {
    if (!el.output.value) return;
    const from = state.effIn;
    const to = state.outFmt;
    el.input.value = el.output.value;
    state.hint = null;
    state.isSample = false;
    state.fileName = null;
    state.inFmt = to;
    if (from && from !== to) state.outFmt = from;
    syncControls();
    savePrefs();
    convert();
  });

  el.errJump.addEventListener('click', () => {
    if (!state.jump) return;
    const t = el.input.value;
    let pos = 0;
    for (let i = 1; i < state.jump.line; i++) {
      const n = t.indexOf('\n', pos);
      if (n < 0) break;
      pos = n + 1;
    }
    const end = t.indexOf('\n', pos);
    el.input.focus();
    el.input.setSelectionRange(pos, end < 0 ? t.length : end);
    const lh = parseFloat(getComputedStyle(el.input).lineHeight) || 21;
    el.input.scrollTop = Math.max(0, (state.jump.line - 4) * lh);
  });

  el.copy.addEventListener('click', async () => {
    const t = el.output.value;
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      flash('Copied');
    } catch (_) {
      el.output.focus();
      el.output.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      flash(ok ? 'Copied' : 'Text selected. Press Ctrl+C or ⌘C to copy.');
    }
  });

  const MIME = { json: 'application/json', csv: 'text/csv', yaml: 'application/yaml' };
  el.dl.addEventListener('click', () => {
    if (!el.output.value) return;
    const suffix = state.effIn === state.outFmt ? '-formatted' : '';
    const filename = `${state.fileBase}${suffix}.${state.outFmt}`;
    try {
      const blob = new Blob([el.output.value], { type: `${MIME[state.outFmt]};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash(`Saved ${filename}`);
    } catch (_) {
      flash("Couldn't start the download. Use Copy instead.");
    }
  });

  // Drag and drop anywhere on the page opens the file in the input.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    el.inPane.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.inPane.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.inPane.classList.remove('dragging');
    readFile(e.dataTransfer.files[0]);
  });

  // ---------- start ----------
  loadPrefs();
  syncControls();
  if (!window.Papa || !window.jsyaml) {
    setButtons(false);
    el.errTitle.textContent = "The converter didn't finish loading";
    el.errMsg.textContent = 'The CSV and YAML libraries could not be started.';
    el.errHelp.textContent = 'Reload the page. If it keeps happening, try another browser.';
    el.err.hidden = false;
    return;
  }
  state.isSample = true;
  el.input.value = SAMPLE;
  convert();
})();
