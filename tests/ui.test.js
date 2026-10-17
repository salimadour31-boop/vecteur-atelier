// Headless UI test (Playwright + Chrome/Chromium): node tests/ui.test.js
// Serves the folder locally and runs the interface at 1440 × 900 (desktop) and 390 × 844 (mobile): demo tracing,
// all six presets and the modes / trace types / layering / outline style, SVG validity (DOMParser) and render-back
// pixel agreement with the reduced image, centreline coverage, image loading (PNG with alpha, JPG, WebP, GIF, BMP)
// by file picker, paste and drag-and-drop, Web Worker progress + cancel + responsiveness, palette editing (recolour,
// hide, lock), every export (SVG ×2, clipboard, PNG, palette JSON / GPL, settings JSON + import), URL-hash sharing,
// languages (+ Tifinagh), theme, view modes, split slider, zoom, overlays, keyboard, no console errors, no
// horizontal overflow on mobile. Writes the README screenshots.
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'))); }
const root = path.resolve(__dirname, '..'), shots = path.join(root, 'screenshots'), fx = path.join(__dirname, 'fixtures');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
let checks = 0;
const ok = (msg) => { checks++; console.log('  ✓ ' + msg); };

/** Waits for the next finished trace after `fn` runs. */
async function traced(page, fn) {
  const n0 = await page.evaluate(() => +(document.body.dataset.traces || 0));
  await fn();
  await page.waitForFunction((n) => +(document.body.dataset.traces || 0) > n && document.body.dataset.busy === '0', n0, { timeout: 60000 });
  return page.evaluate(() => VA.state.res.stats);
}
/** Validity + render-back check, run in the page. */
async function quality(page) {
  return page.evaluate(async () => {
    const r = VA.state.res, s = VA.state.s;
    const out = {};
    for (const layered of [true, false]) {
      const svg = VA.getSVG(layered, false);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      out[layered ? 'layeredValid' : 'optValid'] = !doc.querySelector('parsererror') && doc.documentElement.nodeName === 'svg';
      out[layered ? 'layeredPaths' : 'optPaths'] = doc.querySelectorAll('path').length;
      if (layered) out.groups = doc.querySelectorAll('g[id^="hex-"]').length;
    }
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(VA.getSVG(false, false));
    await img.decode();
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, r.w, r.h).data, pal = r.palette.map((p) => VTRACE.hexToRgb(p.hex));
    let okp = 0, tot = 0, inter = 0, uni = 0;
    for (let i = 0; i < r.labels.length; i++) {
      const L = r.labels[i];
      if (L === 255) continue;
      const a = d[i * 4 + 3];
      if (s.trace === 'center') {
        const fg = !r.palette[L].removed, cov = a >= 128;
        if (fg && cov) inter++; if (fg || cov) uni++;
        continue;
      }
      tot++;
      if (a < 128) { if (r.palette[L].removed) okp++; continue; }
      let best = -1, be = Infinity;
      for (let k = 0; k < pal.length; k++) { const e = (d[i * 4] - pal[k][0]) ** 2 + (d[i * 4 + 1] - pal[k][1]) ** 2 + (d[i * 4 + 2] - pal[k][2]) ** 2; if (e < be) { be = e; best = k; } }
      if (best === L) okp++;
    }
    out.agreement = tot ? okp / tot : null;
    out.iou = uni ? inter / uni : null;
    return out;
  });
}
function checkQuality(q, label, min) {
  assert(q.layeredValid && q.optValid, label + ': SVG not valid');
  assert(q.layeredPaths > 0 && q.optPaths > 0, label + ': no paths');
  if (q.agreement != null) assert(q.agreement >= min, `${label}: render-back agreement ${q.agreement.toFixed(4)} < ${min}`);
  if (q.iou != null) assert(q.iou >= min, `${label}: centreline IoU ${q.iou.toFixed(3)} < ${min}`);
}

async function run(browser, base, vp, name) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true, deviceScaleFactor: mobile ? 2 : 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => +(document.body.dataset.traces || 0) >= 1, null, { timeout: 30000 });
  let st = await page.evaluate(() => VA.state.res.stats);
  assert(st.paths > 0 && st.nodes > 0);
  assert(await page.evaluate(() => document.querySelectorAll('#svgHost svg path').length) > 0);
  ok(`demo logo traced on load (${st.paths} paths, ${st.nodes} nodes, ${st.colors} colours, ${st.ms} ms)`);
  checkQuality(await quality(page), 'default', 0.97); ok('default SVG valid, render-back agreement ≥ 97 %');
  assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'fr');
  assert.strictEqual((await page.textContent('#exLayered')).trim(), 'SVG en calques');
  ok('French by default');

  // ---------------------------------------------------------------- presets
  const presetMin = { logo: 0.98, lineart: 0.97, illustration: 0.95, poster: 0.95, pixel: 0.999, sketch: 0.6 };
  for (const p of Object.keys(presetMin)) {
    if (p === 'sketch') await traced(page, () => page.click('#demoSketch'));
    if (p === 'lineart') await traced(page, () => page.click('#demoSketch'));
    if (p === 'logo') await traced(page, () => page.click('#demoLogo'));
    st = await traced(page, () => page.click(`[data-preset="${p}"]`));
    const q = await quality(page);
    checkQuality(q, 'preset ' + p, presetMin[p]);
    ok(`preset ${p}: ${st.paths} paths / ${st.nodes} nodes, ${q.agreement != null ? 'agreement ' + (q.agreement * 100).toFixed(2) + ' %' : 'centreline IoU ' + q.iou.toFixed(3)}`);
    if (!mobile && p === 'sketch') {
      await page.check('input[name=view][value=side]', { force: true });
      await page.evaluate(() => { document.getElementById('toast').hidden = true; });
      await page.locator('#viewer').screenshot({ path: path.join(shots, 'sketch-centreline.png') });
      await page.check('input[name=view][value=split]', { force: true });
    }
  }
  // ---------------------------------------------------------------- modes / options
  await traced(page, () => page.click('#demoLogo'));
  await traced(page, () => page.click('[data-preset="logo"]'));
  const variants = [
    ['bw (Otsu)', { mode: 'bw', otsu: true }, 0.99],
    ['bw manual threshold + invert', { mode: 'bw', otsu: false, threshold: 90, invert: true }, 0.99],
    ['grey 5 levels', { mode: 'grey', levels: 5 }, 0.96],
    ['colour median cut 12 + merge 0', { mode: 'color', quant: 'median', colors: 12, merge: 0 }, 0.95],
    ['polygons', { mode: 'color', trace: 'polygons', colors: 6 }, 0.97],
    ['exact pixels, cut-out layers', { trace: 'pixels', layering: 'cut' }, 0.999],
    ['curves, cut-out layers', { trace: 'curves', layering: 'cut' }, 0.95],
    ['remove background', { layering: 'stack', removeBg: true }, 0.97],
    ['blur + denoise + contrast + despeckle 100', { removeBg: false, blur: 2, denoise: true, contrast: 30, speckle: 100 }, 0.95],
    ['corner 10° / tolerance 0.3', { blur: 0, denoise: false, contrast: 0, speckle: 12, corner: 10, tol: 0.3 }, 0.97],
    ['corner 180° / tolerance 4', { corner: 180, tol: 4, simp: 3 }, 0.9],
  ];
  for (const [label, patch, min] of variants) {
    st = await traced(page, () => page.evaluate((pt) => VA.setAll({ ...VA.state.s, ...pt }), patch));
    checkQuality(await quality(page), label, min);
    ok(`${label}: ${st.paths} paths / ${st.nodes} nodes`);
  }
  const otsu = await traced(page, () => page.evaluate(() => VA.setAll({ ...VA.state.s, mode: 'bw', otsu: true, corner: 55, tol: 0.8, simp: 0.6 })));
  assert(/\(\d+\)/.test(await page.textContent('#otsuVal'))); ok('Otsu threshold displayed');
  // tolerance slider through the real control (range input)
  const before = otsu.nodes;
  st = await traced(page, () => page.evaluate(() => { const el = document.getElementById('s-tol'); el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); }));
  assert(st.nodes < before, `higher tolerance should reduce nodes (${before} → ${st.nodes})`);
  assert.strictEqual(await page.textContent('output[for="s-tol"]'), '5.0');
  ok(`curve-tolerance slider: ${before} → ${st.nodes} nodes`);
  // outline-only
  await traced(page, () => page.selectOption('#s-style', 'stroke'));
  assert(await page.evaluate(() => VA.getSVG(false).includes('fill="none" stroke="#')));
  assert(await page.isVisible('#s-strokeWidth')); ok('outline-only style (strokes) + stroke-width control shown');
  await traced(page, () => page.evaluate(() => VA.setAll(VSET.applyPreset(VSET.DEFAULTS, 'logo'))));

  // ---------------------------------------------------------------- hash / settings persistence
  await traced(page, () => page.evaluate(() => { const el = document.getElementById('s-colors'); el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); }));
  const hash = await page.evaluate(() => location.hash);
  assert(/n=7/.test(hash), hash); ok('settings written to the URL hash: ' + hash.slice(0, 70) + '…');
  {
    const p2 = await ctx.newPage();
    await p2.goto(base + hash);
    await p2.waitForFunction(() => +(document.body.dataset.traces || 0) >= 1);
    assert.strictEqual(await p2.inputValue('#s-colors'), '7');
    assert.strictEqual(await p2.evaluate(() => VA.state.s.corner), 55);
    await p2.close(); ok('hash restores the settings in a new tab');
  }

  // ---------------------------------------------------------------- palette editing
  const pal = await page.evaluate(() => VA.state.res.layers.map((l) => l.hex));
  const target = pal[pal.length - 1];
  await page.evaluate((hex) => { const inp = document.querySelector(`#palette li[data-hex="${hex}"] input[type=color]`); inp.value = '#ff00aa'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }, target);
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => VA.getSVG(true).includes('fill="#ff00aa"'))); ok('recolour a layer from the palette (no re-trace)');
  await page.click(`#palette li[data-hex="${target}"] .eye`);
  assert(await page.evaluate((hex) => VA.state.s.hidden.includes(hex) && !VA.getSVG(true).includes('#ff00aa'), target));
  assert(await page.evaluate((hex) => document.querySelector(`#palette li[data-hex="${hex}"]`).classList.contains('off'), target));
  ok('hide a layer with the eye button');
  await traced(page, () => page.click('#palReset'));
  await traced(page, () => page.check('#lockPal'));
  const locked = await page.evaluate(() => ({ lock: VA.state.s.lock, pal: VA.state.s.palette.slice(), now: VA.state.res.palette.map((p) => p.hex) }));
  assert(locked.lock && locked.pal.length > 1);
  st = await traced(page, () => page.evaluate(() => { const el = document.getElementById('s-blur'); el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); }));
  const after = await page.evaluate(() => VA.state.res.palette.map((p) => p.hex));
  assert(after.every((h) => locked.pal.includes(h)), 'locked palette must be reused');
  assert(/lk=1/.test(await page.evaluate(() => location.hash)));
  ok('lock palette: colours kept after changing other settings (and stored in the link)');
  await traced(page, () => page.click('#palReset'));
  await traced(page, () => page.evaluate(() => VA.setAll(VSET.applyPreset(VSET.DEFAULTS, 'logo'))));

  // ---------------------------------------------------------------- exports
  const dl = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = await d.path(); return { name: d.suggestedFilename(), buf: fs.readFileSync(p) }; };
  let f = await dl('#exLayered');
  assert(/-calques\.svg$/.test(f.name)); let txt = f.buf.toString();
  assert(/^<svg [^>]*width="960" height="640" viewBox="0 0 960 640"/.test(txt) && /<g id="hex-[0-9A-F]{6}"/.test(txt));
  f = await dl('#exOpt'); assert(/\.svg$/.test(f.name)); txt = f.buf.toString(); assert(!/<g /.test(txt) && /<path fill="#/.test(txt));
  ok(`SVG exports: ${f.name} (${f.buf.length} bytes optimised), layered with one <g> per colour`);
  await page.click('#exCopy'); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('<svg') && clip.includes('<path')); ok('copy SVG to the clipboard');
  await page.selectOption('#pngScale', '2');
  f = await dl('#exPng');
  assert(f.buf.slice(1, 4).toString() === 'PNG'); assert.strictEqual(f.buf.readUInt32BE(16), 1920); assert.strictEqual(f.buf.readUInt32BE(20), 1280);
  ok('PNG export at 2× (1920 × 1280)');
  f = await dl('#palJson'); const pj = JSON.parse(f.buf.toString()); assert(pj.colors.length >= 2 && /^#[0-9a-f]{6}$/.test(pj.colors[0].hex));
  f = await dl('#palGpl'); txt = f.buf.toString(); assert(txt.startsWith('GIMP Palette\n') && /\n\s*\d+\s+\d+\s+\d+\t#[0-9a-f]{6}/.test(txt));
  ok('palette exports (JSON, GIMP .gpl)');
  f = await dl('#exSettings'); const sj = JSON.parse(f.buf.toString()); assert.strictEqual(sj.app, 'vecteur-atelier'); assert.strictEqual(sj.settings.colors, 6);
  const tmp = path.join(require('os').tmpdir(), 'va-settings.json');
  sj.settings.colors = 3; sj.settings.mode = 'color'; fs.writeFileSync(tmp, JSON.stringify(sj));
  await traced(page, () => page.setInputFiles('#settingsFile', tmp));
  assert.strictEqual(await page.inputValue('#s-colors'), '3'); ok('settings JSON export + import');
  await page.click('#copyLink'); await page.waitForTimeout(150);
  assert((await page.evaluate(() => navigator.clipboard.readText())).includes('#') ); ok('copy link');

  // ---------------------------------------------------------------- image loading
  for (const file of ['shapes.png', 'shapes.jpg', 'shapes.webp', 'shapes.gif', 'shapes.bmp']) {
    await traced(page, () => page.setInputFiles('#fileInput', path.join(fx, file)));
    const info = await page.evaluate(() => ({ name: VA.state.src.name, w: VA.state.src.w, colors: VA.state.res.stats.colors, transparent: VA.state.res.labels.some((l) => l === 255) }));
    assert.strictEqual(info.name, file); assert.strictEqual(info.w, 240);
    if (file === 'shapes.png' || file === 'shapes.webp') assert(info.transparent, 'alpha kept for ' + file);
    checkQuality(await quality(page), file, 0.96);
  }
  ok('file picker: PNG (alpha), JPG, WebP (alpha), GIF, BMP traced');
  const b64 = fs.readFileSync(path.join(fx, 'sprite.png')).toString('base64');
  await traced(page, () => page.evaluate((b) => {
    const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], 'sprite.png', { type: 'image/png' }), dt = new DataTransfer(); dt.items.add(file);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, b64));
  assert.strictEqual(await page.evaluate(() => VA.state.src.name), 'sprite.png'); ok('paste (Ctrl+V) an image');
  await traced(page, () => page.click('[data-preset="pixel"]'));
  checkQuality(await quality(page), 'sprite pixel', 0.999);
  if (!mobile) { await page.check('input[name=view][value=side]', { force: true }); await page.check('#showNodes'); await page.evaluate(() => { document.getElementById('toast').hidden = true; }); await page.locator('#viewer').screenshot({ path: path.join(shots, 'pixel-art.png') }); await page.uncheck('#showNodes'); await page.check('input[name=view][value=split]', { force: true }); }
  ok('pixel-art preset reproduces the sprite exactly');
  const jb64 = fs.readFileSync(path.join(fx, 'shapes.jpg')).toString('base64');
  await traced(page, () => page.evaluate((b) => {
    const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'dropped.jpg', { type: 'image/jpeg' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, jb64));
  assert.strictEqual(await page.evaluate(() => VA.state.src.name), 'dropped.jpg'); assert(await page.isHidden('#dropHint'));
  ok('drag-and-drop an image');

  // ---------------------------------------------------------------- worker: progress, responsiveness, cancel
  await traced(page, () => page.setInputFiles('#fileInput', path.join(fx, 'photo.jpg')));
  st = await traced(page, () => page.click('[data-preset="poster"]'));
  checkQuality(await quality(page), 'photo poster', 0.93);
  ok(`photo → poster: ${st.paths} paths / ${st.nodes} nodes in ${st.ms} ms`);
  if (!mobile) { await page.evaluate(() => { VA.setSplit(22); document.getElementById('toast').hidden = true; }); await page.locator('#viewer').screenshot({ path: path.join(shots, 'photo-poster.png') }); await page.evaluate(() => VA.setSplit(50)); }
  await page.evaluate(() => VA.setAll({ ...VA.state.s, maxSize: 4000, colors: 32, merge: 0, speckle: 0, blur: 0, denoise: false, tol: 0.2, antialias: true }));
  await page.waitForSelector('#progress:not([hidden])', { timeout: 5000 });
  const frames = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  assert(frames > 10, 'UI should keep animating while tracing, got ' + frames + ' frames');
  assert(await page.evaluate(() => document.body.dataset.busy === '1'), 'trace should still be running');
  const pct = await page.textContent('#progText');
  await page.click('#cancelBtn');
  await page.waitForFunction(() => document.body.dataset.busy === '0');
  assert(await page.isHidden('#progress'));
  ok(`Web Worker: progress shown ("${pct.trim()}"), ${frames} frames in 0.5 s during the trace, cancel works`);

  // ---------------------------------------------------------------- viewer
  await traced(page, () => page.click('#demoLogo'));
  await traced(page, () => page.click('[data-preset="logo"]'));
  for (const v of ['side', 'vector', 'original', 'split']) {
    await page.check(`input[name=view][value=${v}]`, { force: true });
    assert.strictEqual(await page.getAttribute('#viewer', 'data-view'), v);
  }
  ok('view modes: side by side, vector, original, split');
  await page.focus('#split'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  assert.strictEqual(await page.getAttribute('#split', 'aria-valuenow'), '46');
  assert(/inset\(0(px)? 54%/.test(await page.evaluate(() => document.getElementById('layOrig').style.clipPath)));
  ok('split slider (keyboard, ARIA value)');
  const z0 = await page.textContent('#zoomVal');
  await page.click('#zoomIn'); await page.click('#zoomIn');
  assert.notStrictEqual(await page.textContent('#zoomVal'), z0);
  await page.click('#zoom100'); assert.strictEqual(await page.textContent('#zoomVal'), '100 %');
  await page.focus('#viewer'); await page.keyboard.press('0');
  assert.strictEqual(await page.textContent('#zoomVal'), z0);
  const box = await page.locator('#paneVec').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2); await page.mouse.wheel(0, -400);
  assert.notStrictEqual(await page.textContent('#zoomVal'), z0);
  ok('zoom: buttons, 1:1, keyboard fit, wheel');
  await page.focus('#viewer'); await page.keyboard.press('o'); await page.keyboard.press('n');
  const ov = await page.evaluate(() => [document.getElementById('ovOutline').getAttribute('d').length, document.getElementById('ovNodes').getAttribute('d').length]);
  assert(ov[0] > 100 && ov[1] > 100); ok('outline and node overlays (keyboard O / N)');
  if (!mobile) {
    await page.evaluate(() => { document.getElementById('toast').hidden = true; VA.state.view = { z: 3.2, tx: -1700, ty: -620 }; VA.state.autoFit = false; document.querySelectorAll('.stage').forEach((s) => (s.style.transform = 'translate(-1700px,-620px) scale(3.2)')); document.getElementById('ovOutline').style.strokeWidth = 1.2 / 3.2; document.getElementById('ovNodes').style.strokeWidth = 5 / 3.2; });
    await page.locator('#viewer').screenshot({ path: path.join(shots, 'nodes-zoom.png') });
  }
  await page.keyboard.press('o'); await page.keyboard.press('n'); await page.keyboard.press('0');
  await page.check('#cmpQuant'); assert(await page.isVisible('#cQuantB')); await page.uncheck('#cmpQuant');
  ok('compare with the reduced (quantised) image');

  // ---------------------------------------------------------------- languages, theme, help
  await page.selectOption('#lang', 'en');
  assert.strictEqual((await page.textContent('#exLayered')).trim(), 'Layered SVG');
  assert(/lang=en/.test(await page.evaluate(() => location.hash)));
  await page.selectOption('#lang', 'kab');
  assert.strictEqual((await page.textContent('#exLayered')).trim(), 'SVG s yikalkuyen');
  await page.check('#tfng');
  assert(/[\u2D30-\u2D7F]/.test(await page.textContent('#secPresetsLbl, details:nth-of-type(2) summary')));
  assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'kab-Tfng');
  await page.reload(); await page.waitForFunction(() => +(document.body.dataset.traces || 0) >= 1);
  assert.strictEqual(await page.inputValue('#lang'), 'kab'); assert(await page.isChecked('#tfng'));
  ok('languages FR / EN / Taqbaylit + Tifinagh, kept after reload');
  await page.uncheck('#tfng'); await page.selectOption('#lang', 'fr');
  const th0 = await page.getAttribute('html', 'data-theme'); await page.click('#themeBtn');
  assert.notStrictEqual(await page.getAttribute('html', 'data-theme'), th0); ok('theme toggle');
  if (!mobile) {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.getElementById('toast').hidden = true; });
    await page.screenshot({ path: path.join(shots, 'desktop-light.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  }
  await page.click('#helpBtn'); assert(await page.isVisible('#helpDlg')); await page.keyboard.press('Escape'); assert(await page.isHidden('#helpDlg'));
  ok('help dialog (opens, Escape closes)');
  // accessibility basics: every range / select has a label, every button has a name
  const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input, select, button')].filter((el) => {
    if (el.type === 'file' || el.closest('[hidden]')) return false;
    const name = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.textContent.trim();
    return !name;
  }).map((el) => el.outerHTML.slice(0, 80)));
  assert.deepStrictEqual(unlabeled, []); ok('all controls have an accessible name');

  // ---------------------------------------------------------------- screenshots + mobile overflow
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.getElementById('toast').hidden = true; });
  if (mobile) {
    const o = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(o[0] <= o[1], 'horizontal overflow on mobile ' + o); ok('no horizontal overflow at 390 px');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, 'mobile.png') });
  } else {
    await page.screenshot({ path: path.join(shots, 'desktop.png') });
  }
  assert.deepStrictEqual(errors, [], 'console errors');
  ok('no console errors');
  await ctx.close();
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const exe = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  let code = 0;
  try {
    fs.mkdirSync(shots, { recursive: true });
    console.log('desktop 1440 × 900');
    await run(browser, base, { width: 1440, height: 900 }, 'desktop');
    console.log('file:// (opened without a server)');
    {
      const ctx = await browser.newContext(), page = await ctx.newPage(), errs = [];
      page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
      await page.goto('file://' + path.join(root, 'index.html'));
      await page.waitForFunction(() => +(document.body.dataset.traces || 0) >= 1, null, { timeout: 30000 });
      assert(await page.isHidden('#toast') || !(await page.textContent('#toast')).includes('Worker'), 'worker fallback used on file://');
      assert.deepStrictEqual(errs, []); await ctx.close(); ok('works from file:// with the inline Blob worker');
    }
    console.log('mobile 390 × 844');
    await run(browser, base, { width: 390, height: 844 }, 'mobile');
    console.log(`\n${checks} checks passed`);
  } catch (e) { console.error('\n✗ ' + (e.stack || e)); code = 1; }
  await browser.close(); server.close(); process.exit(code);
})();
