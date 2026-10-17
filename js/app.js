/* app.js — Vecteur Atelier interface: sources (file, drop, paste, demos), settings ↔ controls ↔ URL hash,
 * Web Worker tracing with progress / cancel, zoomable split / side-by-side preview with outline and node overlays,
 * palette editing, exports (SVG layered / optimised, PNG, palette JSON / GPL, settings JSON, link, clipboard),
 * languages and themes. Original code, MIT licence. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { t: tr, LANGS } = I18N;

  /* ================================================================== state */
  const LS = { lang: 'va-lang', tfng: 'va-tfng', theme: 'va-theme' };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const fromHash = VSET.fromHash(location.hash);
  const state = {
    s: fromHash.settings,
    lang: LANGS.includes(fromHash.extra.lang) ? fromHash.extra.lang : LANGS.includes(store.get(LS.lang)) ? store.get(LS.lang) : 'fr',
    tfng: store.get(LS.tfng) === '1',
    src: null,          // { canvas, name, w, h }
    work: null,         // { canvas, w, h, key }
    res: null,          // last tracing result
    view: { z: 1, tx: 0, ty: 0 }, autoFit: true, split: 50, mode: 'split',
    busy: false, traces: 0,
  };
  const L = (key, vars) => tr(key, state.lang, vars, state.tfng);
  const RENDER_ONLY = new Set(['dec', 'hidden', 'recolor']);
  const WORK_KEYS = new Set(['maxSize', 'trace']);

  /* ================================================================== i18n + theme */
  function applyLang() {
    const root = document.documentElement;
    root.lang = state.lang === 'kab' ? (state.tfng ? 'kab-Tfng' : 'kab') : state.lang;
    document.body.classList.toggle('tfng-on', state.lang === 'kab' && state.tfng);
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = L(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => { const [attr, key] = pair.split(':'); el.setAttribute(attr, L(key)); });
    });
    $('helpBody').innerHTML = L('helpBody');
    $('lang').value = state.lang;
    $('tfngWrap').hidden = state.lang !== 'kab';
    $('tfng').checked = state.tfng;
    if (state.res) { renderPalette(); renderStats(); }
    updateSrcInfo();
  }
  function setTheme(th) { document.documentElement.dataset.theme = th; store.set(LS.theme, th); }
  setTheme(store.get(LS.theme) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  /* ================================================================== toast / live region */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }
  const announce = (msg) => { $('live').textContent = msg; };

  /* ================================================================== settings ↔ controls */
  function fmtOut(key, v) {
    switch (key) {
      case 'maxSize': case 'speckle': return v + ' px';
      case 'contrast': return (v > 0 ? '+' : '') + v;
      case 'corner': return v + '°';
      case 'tol': case 'simp': return v.toFixed(1);
      case 'strokeWidth': return v > 0 ? v.toFixed(1) : 'auto';
      case 'blur': return v ? v + ' px' : '0';
      default: return String(v);
    }
  }
  function syncControls() {
    const s = state.s;
    document.querySelectorAll('[data-set]').forEach((el) => {
      const k = el.dataset.set, v = s[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v;
      if (el.type === 'range') { const o = el.parentElement.querySelector('output'); if (o) o.textContent = fmtOut(k, v); }
    });
    document.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(s.mode); });
    document.querySelectorAll('[data-trace]').forEach((el) => { el.hidden = !el.dataset.trace.split(' ').includes(s.trace); });
    document.querySelectorAll('[data-stroke]').forEach((el) => { el.hidden = !(s.trace === 'center' || s.style === 'stroke'); });
    $('s-threshold').disabled = s.otsu;
    $('lockPal').closest('label').hidden = s.mode !== 'color';
  }
  function updateHash() {
    const h = VSET.toHash(state.s, { lang: state.lang !== 'fr' ? state.lang : null });
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }
  function setSetting(key, value) {
    const next = { ...state.s, [key]: value };
    if (key === 'lock') next.palette = value && state.res ? state.res.palette.map((p) => p.hex) : [];
    state.s = VSET.normalize(next);
    syncControls(); updateHash();
    if (RENDER_ONLY.has(key)) { renderResult(); return; }
    if (WORK_KEYS.has(key)) prepareWork();
    scheduleTrace();
  }
  function setAll(s, msg) {
    state.s = VSET.normalize(s);
    syncControls(); updateHash(); prepareWork(); scheduleTrace(0);
    if (msg) toast(msg);
  }
  document.querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
      else if (el.type === 'range') v = Number(el.value);
      else v = el.value;
      setSetting(el.dataset.set, v);
    });
  });
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.preset;
    document.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    setAll(VSET.applyPreset(state.s, name), L('presetApplied', { p: b.textContent }));
  }));

  /* ================================================================== sources */
  function baseName() { return ((state.src && state.src.name) || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'image'; }
  function setSource(canvas, name) {
    state.src = { canvas, name, w: canvas.width, h: canvas.height };
    state.autoFit = true; state.work = null;
    prepareWork(); scheduleTrace(0);
  }
  function loadDemo(kind) {
    const c = document.createElement('canvas');
    VDEMO[kind](c);
    setSource(c, kind === 'sketch' ? 'demo-croquis' : 'demo-logo');
  }
  function loadFile(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) { toast(L('loadErr')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      if (!c.width || !c.height) { toast(L('loadErr')); return; }
      c.getContext('2d').drawImage(img, 0, 0);
      setSource(c, file.name || 'image');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast(L('loadErr')); };
    img.src = url;
  }
  /** Down-scales the source to the working size (smooth, or nearest-neighbour for exact pixels). */
  function prepareWork() {
    if (!state.src) return;
    const { w, h } = state.src, s = state.s, sc = Math.min(1, s.maxSize / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * sc)), th = Math.max(1, Math.round(h * sc)), smooth = s.trace !== 'pixels';
    const key = tw + 'x' + th + (smooth ? 's' : 'n');
    if (state.work && state.work.key === key) return;
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = smooth; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.src.canvas, 0, 0, tw, th);
    state.work = { canvas: c, w: tw, h: th, key };
    for (const id of ['cOrigA', 'cOrigB']) { const o = $(id); o.width = tw; o.height = th; o.getContext('2d').drawImage(c, 0, 0); }
    sizeStages(tw, th);
    if (state.autoFit) fit();
    updateSrcInfo();
  }
  function updateSrcInfo() {
    if (!state.src || !state.work) return;
    const txt = L('dims', { w: state.src.w, h: state.src.h, tw: state.work.w, th: state.work.h });
    $('srcInfo').textContent = (state.src.name.startsWith('demo-') ? L('srcDemo', { name: state.src.name }) : state.src.name) + ' — ' + txt;
    $('stDims').textContent = txt;
  }
  $('openBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('demoLogo').addEventListener('click', () => loadDemo('logo'));
  $('demoSketch').addEventListener('click', () => { setAll(VSET.applyPreset(state.s, 'sketch')); loadDemo('sketch'); });
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) if (it.type && it.type.startsWith('image/')) { loadFile(it.getAsFile()); e.preventDefault(); return; }
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; $('dropHint').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropHint').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  /* ================================================================== tracing (Web Worker) */
  /** Worker body: receives { id, img, settings }, posts progress / done / error. Serialised into a Blob URL. */
  function workerMain() {
    self.onmessage = (e) => {
      const { id, img, settings } = e.data;
      let last = 0;
      try {
        const res = self.VTRACE.trace(img, settings, (p, stage) => {
          const t = Date.now();
          if (t - last > 40 || p >= 1) { last = t; self.postMessage({ id, type: 'progress', p, stage }); }
        });
        self.postMessage({ id, type: 'done', res }, [res.labels.buffer]);
      } catch (err) { self.postMessage({ id, type: 'error', message: String((err && err.message) || err) }); }
    };
  }
  let worker = null, workerURL = null, jobId = 0, running = 0, traceTimer = 0, progTimer = 0, noWorkerWarned = false;
  function makeWorker() {
    try {
      if (!workerURL) {
        const src = 'self.VTRACE = (' + VTRACE._factory.toString() + ')();\n(' + workerMain.toString() + ')();';
        workerURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      return new Worker(workerURL);
    } catch (e) { return null; }
  }
  function scheduleTrace(delay) {
    clearTimeout(traceTimer);
    traceTimer = setTimeout(runTrace, delay == null ? 220 : delay);
  }
  function setBusy(b) {
    state.busy = b; document.body.dataset.busy = b ? '1' : '0';
    clearTimeout(progTimer);
    if (b) progTimer = setTimeout(() => { $('progress').hidden = false; }, 120);
    else $('progress').hidden = true;
  }
  function onProgress(p, stage) {
    $('progBar').style.width = Math.round(p * 100) + '%';
    $('progText').textContent = L('stage_' + stage) + ' ' + Math.round(p * 100) + ' %';
  }
  function cancelTrace(user) {
    clearTimeout(traceTimer);
    if (running) {
      if (worker) { worker.terminate(); worker = null; }
      running = 0; setBusy(false);
      if (user) { toast(L('cancelled')); announce(L('cancelled')); }
    }
  }
  function runTrace() {
    if (!state.work) return;
    cancelTrace(false);
    const id = ++jobId, { canvas, w, h } = state.work;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const settings = state.s;
    running = id; setBusy(true); onProgress(0, 'pre');
    if (!worker) worker = makeWorker();
    if (!worker) {
      if (!noWorkerWarned) { noWorkerWarned = true; toast(L('noWorker')); }
      setTimeout(() => {
        if (running !== id) return;
        try { finish(id, VTRACE.trace({ width: w, height: h, data: data.data }, settings, onProgress)); } catch (err) { fail(id, err.message); }
      }, 30);
      return;
    }
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id || running !== id) return;
      if (m.type === 'progress') onProgress(m.p, m.stage);
      else if (m.type === 'done') finish(id, m.res);
      else fail(id, m.message);
    };
    worker.onerror = (e) => { if (running === id) fail(id, e.message || 'worker'); };
    worker.postMessage({ id, img: { width: w, height: h, data: data.data }, settings }, [data.data.buffer]);
  }
  function fail(id, msg) {
    if (running !== id) return;
    running = 0; setBusy(false);
    toast(L('workerErr', { m: msg })); console.warn('trace error', msg);
  }
  function finish(id, res) {
    if (running !== id) return;
    running = 0; setBusy(false);
    state.res = res; state.traces++;
    document.body.dataset.traces = String(state.traces);
    $('otsuVal').textContent = res.threshold != null && state.s.otsu ? '(' + res.threshold + ')' : '';
    if (res.threshold != null && state.s.otsu) { $('s-threshold').value = res.threshold; $('s-threshold').parentElement.querySelector('output').textContent = res.threshold; }
    drawQuantized(); renderResult(); renderPalette();
    announce(L('traced', { p: res.stats.paths, n: res.stats.nodes, c: res.stats.colors }));
    document.dispatchEvent(new CustomEvent('va:traced', { detail: res.stats }));
  }

  /* ================================================================== rendering */
  const svgOpts = (layered, forExport) => ({
    layered, dec: state.s.dec, hidden: new Set(state.s.hidden), recolor: state.s.recolor,
    width: forExport && state.src ? state.src.w : state.res.w, height: forExport && state.src ? state.src.h : state.res.h,
  });
  function getSVG(layered, forExport) { return state.res ? VTRACE.buildSVG(state.res, svgOpts(layered, forExport)) : ''; }
  let lastSizes = { opt: 0, layered: 0 };
  function renderResult() {
    if (!state.res) return;
    const svg = getSVG(true, false);
    $('svgHost').innerHTML = svg;
    lastSizes = { layered: new Blob([getSVG(true, true)]).size, opt: new Blob([getSVG(false, true)]).size };
    renderOverlay(); renderStats(); updatePaletteState();
  }
  function renderStats() {
    const r = state.res;
    if (!r) return;
    const nf = new Intl.NumberFormat(state.lang === 'en' ? 'en' : 'fr');
    $('stPaths').textContent = nf.format(r.stats.paths);
    $('stNodes').textContent = nf.format(r.stats.nodes);
    $('stColors').textContent = r.stats.colors;
    const kb = (b) => (b < 1024 ? b + ' o' : b < 1048576 ? (b / 1024).toFixed(1) + ' Ko' : (b / 1048576).toFixed(2) + ' Mo');
    const kbEn = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB');
    const f = state.lang === 'en' ? kbEn : kb;
    $('stSize').textContent = f(lastSizes.opt) + ' / ' + f(lastSizes.layered);
    $('stTime').textContent = r.stats.ms + ' ms';
  }
  /** Outline + node overlay (stroke widths follow the zoom; nodes are zero-length round-capped segments). */
  function renderOverlay() {
    const r = state.res, ov = $('overlay');
    if (!r) return;
    ov.setAttribute('width', r.w); ov.setAttribute('height', r.h); ov.setAttribute('viewBox', `0 0 ${r.w} ${r.h}`);
    const showO = $('showOutline').checked, showN = $('showNodes').checked, hidden = new Set(state.s.hidden);
    const loops = [];
    if (showO || showN) for (const Ly of r.layers) if (!hidden.has(Ly.hex)) for (const p of Ly.paths) for (const lp of p.loops) loops.push(lp);
    $('ovOutline').setAttribute('d', showO ? VTRACE.pathData(loops, 2) : '');
    let nd = '';
    if (showN) {
      const parts = [];
      let count = 0;
      for (const lp of loops) {
        const d = lp.d;
        parts.push('M' + d[0].toFixed(1) + ' ' + d[1].toFixed(1) + 'h0');
        for (let i = 2; i < d.length && count < 300000; i += d[i] === 0 ? 3 : 7, count++) {
          const x = d[i] === 0 ? d[i + 1] : d[i + 5], y = d[i] === 0 ? d[i + 2] : d[i + 6];
          parts.push('M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h0');
        }
      }
      nd = parts.join('');
    }
    $('ovNodes').setAttribute('d', nd);
  }
  function drawQuantized() {
    const r = state.res;
    if (!r) return;
    const img = new ImageData(r.w, r.h), d = img.data, pal = r.palette.map((p) => VTRACE.hexToRgb(p.hex));
    for (let i = 0; i < r.labels.length; i++) {
      const L0 = r.labels[i];
      if (L0 === VTRACE.TRANSPARENT) continue;
      const c = pal[L0]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    for (const id of ['cQuantA', 'cQuantB']) { const c = $(id); c.width = r.w; c.height = r.h; c.getContext('2d').putImageData(img, 0, 0); }
    sizeStages(r.w, r.h);
  }
  $('showOutline').addEventListener('change', renderOverlay);
  $('showNodes').addEventListener('change', renderOverlay);
  $('cmpQuant').addEventListener('change', () => {
    const q = $('cmpQuant').checked;
    $('cQuantA').hidden = $('cQuantB').hidden = !q; $('cOrigA').hidden = $('cOrigB').hidden = q;
  });

  /* ================================================================== palette */
  function renderPalette() {
    const r = state.res, ul = $('palette');
    ul.innerHTML = '';
    if (!r) return;
    const total = r.palette.reduce((a, p) => a + p.count, 0) || 1;
    // show colours from top layer to bottom (same order as the layers panel of a vector editor)
    const order = r.layers.map((l) => l.hex).reverse();
    const extra = r.palette.filter((p) => !order.includes(p.hex)).map((p) => p.hex);
    for (const hex of [...order, ...extra]) {
      const p = r.palette.find((q) => q.hex === hex);
      if (!p) continue;
      const li = document.createElement('li'); li.dataset.hex = hex;
      const col = document.createElement('input'); col.type = 'color'; col.value = state.s.recolor[hex] || hex;
      col.setAttribute('aria-label', L('editColor', { c: hex }));
      col.addEventListener('input', () => { li.querySelector('.hx').textContent = col.value; });
      col.addEventListener('change', () => {
        const rec = { ...state.s.recolor };
        if (col.value.toLowerCase() === hex) delete rec[hex]; else rec[hex] = col.value.toLowerCase();
        setSetting('recolor', rec);
      });
      const meta = document.createElement('span'); meta.className = 'meta';
      const pct = ((100 * p.count) / total).toFixed(p.count / total < 0.01 ? 2 : 1);
      meta.innerHTML = `<span class="hx">${state.s.recolor[hex] || hex}</span><small>${pct} %${p.bg ? ' · ' + L('bgTag') : ''}${p.removed ? ' · ' + L('removedTag') : ''}</small>`;
      const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'eye';
      eye.setAttribute('aria-label', L('hideLayer', { c: hex }));
      eye.addEventListener('click', () => {
        const h = new Set(state.s.hidden);
        if (h.has(hex)) h.delete(hex); else h.add(hex);
        setSetting('hidden', [...h]);
      });
      if (p.removed) eye.disabled = true;
      li.append(col, meta, eye); ul.append(li);
    }
    updatePaletteState();
  }
  function updatePaletteState() {
    const h = new Set(state.s.hidden);
    document.querySelectorAll('#palette li').forEach((li) => {
      const off = h.has(li.dataset.hex) || (state.res && (state.res.palette.find((p) => p.hex === li.dataset.hex) || {}).removed);
      li.classList.toggle('off', !!off);
      const eye = li.querySelector('.eye');
      eye.textContent = off ? '◌' : '◉'; eye.setAttribute('aria-pressed', String(!off));
    });
  }
  $('palReset').addEventListener('click', () => setAll({ ...state.s, recolor: {}, hidden: [], lock: false, palette: [] }));
  function effectivePalette() {
    const r = state.res, total = r.palette.reduce((a, p) => a + p.count, 0) || 1;
    return r.palette.map((p) => { const hex = state.s.recolor[p.hex] || p.hex; return { hex, source: p.hex, rgb: VTRACE.hexToRgb(hex), pixels: p.count, share: +(p.count / total).toFixed(4), hidden: state.s.hidden.includes(p.hex), background: p.bg }; });
  }
  $('palJson').addEventListener('click', () => {
    if (!state.res) return toast(L('nothing'));
    download(JSON.stringify({ name: 'Vecteur Atelier — ' + baseName(), colors: effectivePalette() }, null, 2), baseName() + '-palette.json', 'application/json');
  });
  $('palGpl').addEventListener('click', () => {
    if (!state.res) return toast(L('nothing'));
    const pad = (v) => String(v).padStart(3, ' ');
    const lines = ['GIMP Palette', 'Name: Vecteur Atelier ' + baseName(), 'Columns: 8', '#'];
    for (const c of effectivePalette()) lines.push(`${pad(c.rgb[0])} ${pad(c.rgb[1])} ${pad(c.rgb[2])}\t${c.hex}`);
    download(lines.join('\n') + '\n', baseName() + '-palette.gpl', 'text/plain');
  });

  /* ================================================================== exports */
  function download(content, name, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(L('downloaded', { f: name }));
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove();
    }
    toast(L('copied'));
  }
  $('exLayered').addEventListener('click', () => { if (!state.res) return toast(L('nothing')); download(getSVG(true, true), baseName() + '-calques.svg', 'image/svg+xml'); });
  $('exOpt').addEventListener('click', () => { if (!state.res) return toast(L('nothing')); download(getSVG(false, true), baseName() + '.svg', 'image/svg+xml'); });
  $('exCopy').addEventListener('click', () => { if (!state.res) return toast(L('nothing')); copyText(getSVG(false, true)); });
  $('exPng').addEventListener('click', () => {
    if (!state.res) return toast(L('nothing'));
    const sc = Number($('pngScale').value) || 1, W0 = state.src.w, H0 = state.src.h;
    const k = Math.min(sc, 16384 / Math.max(W0, H0), Math.sqrt(120e6 / (W0 * H0)));
    const W = Math.max(1, Math.round(W0 * k)), H = Math.max(1, Math.round(H0 * k));
    const svg = VTRACE.buildSVG(state.res, { ...svgOpts(false, true), width: W, height: H });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, 0, 0, W, H); URL.revokeObjectURL(url);
      c.toBlob((b) => download(b, `${baseName()}@${sc}x.png`, 'image/png'), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast(L('workerErr', { m: 'PNG' })); };
    img.src = url;
  });
  $('exSettings').addEventListener('click', () => download(JSON.stringify({ app: 'vecteur-atelier', version: 1, settings: state.s }, null, 2), 'vecteur-atelier-reglages.json', 'application/json'));
  $('imSettings').addEventListener('click', () => $('settingsFile').click());
  $('settingsFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then((txt) => { const j = JSON.parse(txt); if (!j || typeof j !== 'object') throw new Error('json'); setAll(j.settings || j, L('imported')); }).catch(() => toast(L('importErr')));
  });
  $('copyLink').addEventListener('click', () => { updateHash(); copyText(location.href); });
  $('resetAll').addEventListener('click', () => setAll(VSET.DEFAULTS));

  /* ================================================================== viewer: zoom, pan, split */
  const panes = [$('paneOrig'), $('paneVec')];
  function sizeStages(w, h) {
    document.querySelectorAll('.stage').forEach((st) => { st.style.width = w + 'px'; st.style.height = h + 'px'; });
    document.querySelectorAll('.stage canvas').forEach((c) => { c.style.width = w + 'px'; c.style.height = h + 'px'; });
  }
  function activePane() { return state.mode === 'original' ? $('paneOrig') : $('paneVec'); }
  function applyView() {
    const { z, tx, ty } = state.view;
    const tf = `translate(${tx}px, ${ty}px) scale(${z})`;
    document.querySelectorAll('.stage').forEach((st) => { st.style.transform = tf; });
    document.querySelectorAll('.stage canvas').forEach((c) => c.classList.toggle('px', z >= 3));
    $('zoomVal').textContent = Math.round(z * 100) + ' %';
    // overlay strokes keep a constant on-screen width (the CSS zoom is outside the SVG, so vector-effect cannot help)
    $('ovOutline').style.strokeWidth = (1.2 / z).toFixed(4);
    $('ovNodes').style.strokeWidth = (5 / z).toFixed(4);
  }
  function fit() {
    const w = state.work ? state.work.w : 1, h = state.work ? state.work.h : 1, r = activePane().getBoundingClientRect();
    if (!r.width || !r.height) return;
    const z = Math.min(r.width / w, r.height / h) * 0.94;
    state.view = { z, tx: (r.width - w * z) / 2, ty: (r.height - h * z) / 2 };
    applyView();
  }
  function zoomAt(f, px, py) {
    const v = state.view, z = Math.min(64, Math.max(0.03, v.z * f));
    if (px == null) { const r = activePane().getBoundingClientRect(); px = r.width / 2; py = r.height / 2; }
    state.view = { z, tx: px - ((px - v.tx) * z) / v.z, ty: py - ((py - v.ty) * z) / v.z };
    state.autoFit = false; applyView();
  }
  function setMode(m) {
    state.mode = m; $('viewer').dataset.view = m;
    document.querySelectorAll('input[name="view"]').forEach((r) => (r.checked = r.value === m));
    if (state.autoFit) fit(); else applyView();
  }
  document.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener('change', () => r.checked && setMode(r.value)));
  $('zoomIn').addEventListener('click', () => zoomAt(1.25));
  $('zoomOut').addEventListener('click', () => zoomAt(0.8));
  $('zoomFit').addEventListener('click', () => { state.autoFit = true; fit(); });
  $('zoom100').addEventListener('click', () => zoomAt(1 / state.view.z));
  const pointers = new Map();
  let pinch = null;
  panes.forEach((pane) => {
    pane.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = pane.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    pane.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.split')) return;
      pane.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); pane.classList.add('dragging');
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    });
    pane.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const r = pane.getBoundingClientRect();
      if (pointers.size === 2 && pinch) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch.d = d; return;
      }
      state.view.tx += e.clientX - p.x; state.view.ty += e.clientY - p.y; state.autoFit = false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); applyView();
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) pane.classList.remove('dragging'); };
    pane.addEventListener('pointerup', up); pane.addEventListener('pointercancel', up);
  });
  function setSplit(pct) {
    state.split = Math.min(100, Math.max(0, pct));
    $('layOrig').style.clipPath = `inset(0 ${100 - state.split}% 0 0)`;
    $('split').style.left = state.split + '%';
    $('split').setAttribute('aria-valuenow', String(Math.round(state.split)));
  }
  const split = $('split');
  split.addEventListener('pointerdown', (e) => { split.setPointerCapture(e.pointerId); e.stopPropagation(); split.dataset.drag = '1'; });
  split.addEventListener('pointermove', (e) => {
    if (split.dataset.drag !== '1') return;
    const r = $('paneVec').getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100);
  });
  split.addEventListener('pointerup', () => { split.dataset.drag = ''; });
  split.addEventListener('keydown', (e) => {
    const st = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') setSplit(state.split - st); else if (e.key === 'ArrowRight') setSplit(state.split + st);
    else if (e.key === 'Home') setSplit(0); else if (e.key === 'End') setSplit(100); else return;
    e.preventDefault(); e.stopPropagation();
  });
  $('viewer').addEventListener('keydown', (e) => {
    if (e.target !== $('viewer')) return;
    const k = e.key, pan = 40;
    if (k === '+' || k === '=') zoomAt(1.25);
    else if (k === '-' || k === '_') zoomAt(0.8);
    else if (k === '0') { state.autoFit = true; fit(); }
    else if (k === '1') zoomAt(1 / state.view.z);
    else if (k.startsWith('Arrow')) {
      state.view.tx += k === 'ArrowLeft' ? pan : k === 'ArrowRight' ? -pan : 0;
      state.view.ty += k === 'ArrowUp' ? pan : k === 'ArrowDown' ? -pan : 0; state.autoFit = false; applyView();
    } else if (k === 's' || k === 'S') { const M = ['split', 'side', 'vector', 'original']; setMode(M[(M.indexOf(state.mode) + 1) % M.length]); }
    else if (k === 'o' || k === 'O') { $('showOutline').checked = !$('showOutline').checked; renderOverlay(); }
    else if (k === 'n' || k === 'N') { $('showNodes').checked = !$('showNodes').checked; renderOverlay(); }
    else return;
    e.preventDefault();
  });
  new ResizeObserver(() => { if (state.autoFit) fit(); }).observe($('viewer'));

  /* ================================================================== header controls */
  $('lang').addEventListener('change', () => { state.lang = $('lang').value; store.set(LS.lang, state.lang); applyLang(); updateHash(); });
  $('tfng').addEventListener('change', () => { state.tfng = $('tfng').checked; store.set(LS.tfng, state.tfng ? '1' : '0'); applyLang(); });
  $('themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('helpBtn').addEventListener('click', () => $('helpDlg').showModal());
  $('cancelBtn').addEventListener('click', () => cancelTrace(true));
  window.addEventListener('hashchange', () => {
    const h = VSET.fromHash(location.hash);
    if (VSET.toHash(h.settings) !== VSET.toHash(state.s)) setAll(h.settings);
    if (LANGS.includes(h.extra.lang) && h.extra.lang !== state.lang) { state.lang = h.extra.lang; applyLang(); }
  });

  /* ================================================================== start */
  // small hook for automated tests and power users (read-only helpers)
  window.VA = { state, getSVG, runTrace, cancelTrace, loadDemo, setAll, setSetting, fit, setSplit };
  applyLang(); syncControls(); setSplit(50); setMode('split');
  loadDemo('logo');
})();
