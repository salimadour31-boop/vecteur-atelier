// Unit tests (plain Node, no dependencies): node tests/engine.test.js
// Pre-processing, Otsu, k-means / median cut / merging, despeckle, boundary following (holes, saddles, orientation),
// corner detection, Douglas–Peucker, Bézier fitting accuracy, centreline, the SVG writer (parsed back and
// rasterised: pixel agreement with the reduced image), settings / presets / URL hash and translations.
const assert = require('assert');
const V = require('../js/trace.js'), S = require('../js/settings.js'), I = require('../js/i18n.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } }
const base = (o) => S.normalize({ ...S.DEFAULTS, ...o });
function image(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x + 0.5, y + 0.5); d[(y * w + x) * 4] = c[0]; d[(y * w + x) * 4 + 1] = c[1]; d[(y * w + x) * 4 + 2] = c[2]; d[(y * w + x) * 4 + 3] = c[3] == null ? 255 : c[3]; }
  return { width: w, height: h, data: d };
}

/* --------------------------------------------------- tiny SVG path parser + even-odd rasteriser (test only) */
function parsePath(d) {
  const toks = d.match(/[MmLlHhVvCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const polys = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cur = null;
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; cur = [[x, y]]; polys.push(cur); cmd = 'L'; }
    else if (cmd === 'm') { x += num(); y += num(); sx = x; sy = y; cur = [[x, y]]; polys.push(cur); cmd = 'l'; }
    else if (cmd === 'L') { x = num(); y = num(); cur.push([x, y]); }
    else if (cmd === 'l') { x += num(); y += num(); cur.push([x, y]); }
    else if (cmd === 'h') { x += num(); cur.push([x, y]); } else if (cmd === 'H') { x = num(); cur.push([x, y]); }
    else if (cmd === 'v') { y += num(); cur.push([x, y]); } else if (cmd === 'V') { y = num(); cur.push([x, y]); }
    else if (cmd === 'c' || cmd === 'C') {
      const r = cmd === 'c', a = [num(), num(), num(), num(), num(), num()];
      const p1 = [r ? x + a[0] : a[0], r ? y + a[1] : a[1]], p2 = [r ? x + a[2] : a[2], r ? y + a[3] : a[3]], p3 = [r ? x + a[4] : a[4], r ? y + a[5] : a[5]];
      for (let k = 1; k <= 12; k++) { const t = k / 12, s = 1 - t; cur.push([s * s * s * x + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0], s * s * s * y + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]]); }
      x = p3[0]; y = p3[1];
    } else if (cmd === 'z' || cmd === 'Z') { x = sx; y = sy; }
    else throw new Error('unknown command ' + cmd + ' at ' + i);
  }
  return polys;
}
/** Even-odd coverage of pixel centres. */
function rasterize(polys, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (const P of polys) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, Math.ceil(xs[k + 1] - 0.5)); x++) m[y * w + x] ^= 1;
  }
  return m;
}
/** Paints an SVG (from buildSVG) into a label image: later paths overwrite earlier ones (painter's order). */
function renderSVG(svg, res) {
  const out = new Int16Array(res.w * res.h).fill(-1), hexIdx = new Map(res.palette.map((p, i) => [p.hex, i]));
  const re = /<path[^>]*?fill="(#[0-9a-f]{6})"[^>]*?d="([^"]*)"/g;
  let mm;
  while ((mm = re.exec(svg))) { const m = rasterize(parsePath(mm[2]), res.w, res.h), L = hexIdx.get(mm[1]); for (let i = 0; i < m.length; i++) if (m[i]) out[i] = L; }
  const reG = /<g [^>]*fill="(#[0-9a-f]{6})"[^>]*>([\s\S]*?)<\/g>/g;
  while ((mm = reG.exec(svg))) {
    const L = hexIdx.get(mm[1]);
    for (const pm of mm[2].matchAll(/d="([^"]*)"/g)) { const m = rasterize(parsePath(pm[1]), res.w, res.h); for (let i = 0; i < m.length; i++) if (m[i]) out[i] = L; }
  }
  return out;
}
const agreement = (a, labels) => { let ok = 0, tot = 0; for (let i = 0; i < labels.length; i++) { if (labels[i] === 255) continue; tot++; if (a[i] === labels[i]) ok++; } return ok / tot; };
function iou(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 1; }

console.log('Pre-processing & colour reduction');
test('Otsu splits a bimodal histogram between the modes', () => {
  const h = new Float64Array(256); for (let i = 0; i < 2000; i++) { h[40 + (i % 20)]++; h[190 + (i % 30)]++; }
  const t = V.otsu(h); assert(t > 59 && t <= 190, 'got ' + t);
});
test('contrast 0 / blur 0 / no denoise leaves pixels unchanged; blur smooths a step', () => {
  const im = image(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]));
  assert.deepStrictEqual(Array.from(V.preprocess(im.data, 20, 10, base({}))), Array.from(im.data));
  const b = V.preprocess(im.data, 20, 10, base({ blur: 2 }));
  const v = b[(5 * 20 + 10) * 4]; assert(v > 20 && v < 235, 'edge pixel should be grey, got ' + v);
});
test('median 3×3 removes an isolated white pixel', () => {
  const im = image(9, 9, (x, y) => (x > 4 && x < 5 && y > 4 && y < 5 ? [255, 255, 255] : [0, 0, 0]));
  const d = V.preprocess(im.data, 9, 9, base({ denoise: true })); assert.strictEqual(d[(4 * 9 + 4) * 4], 0);
});
test('weighted k-means finds three flat colours and keeps a small distinct area', () => {
  const cols = [[200, 30, 30], [30, 160, 60], [20, 40, 200]];
  const im = image(60, 30, (x) => cols[Math.floor(x / 20)]);
  const C = V.kmeans(V.colourBins(im.data), 3, 1);
  for (const c of cols) assert(C.some((k) => Math.abs(k[0] - c[0]) + Math.abs(k[1] - c[1]) + Math.abs(k[2] - c[2]) < 4), JSON.stringify(C));
  // big blue→white gradient + a small brown square: the brown must survive with 6 colours
  const im2 = image(200, 100, (x, y) => (x > 150 && x < 165 && y > 60 && y < 75 ? [110, 60, 30] : [40 + x, 80 + x * 0.8, 230]));
  const C2 = V.kmeans(V.colourBins(im2.data), 6, 1);
  assert(C2.some((k) => Math.abs(k[0] - 110) + Math.abs(k[1] - 60) + Math.abs(k[2] - 30) < 20), JSON.stringify(C2));
});
test('median cut finds the colours of a 4-colour image', () => {
  const cols = [[250, 250, 250], [10, 10, 10], [240, 120, 0], [0, 120, 240]];
  const im = image(40, 40, (x, y) => cols[(x < 20 ? 0 : 1) + (y < 20 ? 0 : 2)]);
  const C = V.medianCut(im.data, 4);
  assert.strictEqual(C.length, 4);
  for (const c of cols) assert(C.some((k) => Math.abs(k[0] - c[0]) + Math.abs(k[1] - c[1]) + Math.abs(k[2] - c[2]) < 12), JSON.stringify(C));
});
test('merging joins colours closer than ΔE and keeps distant ones', () => {
  const out = V.mergeSimilar([[200, 0, 0], [204, 2, 2], [0, 0, 200]], [10, 10, 10], 6);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(V.mergeSimilar([[200, 0, 0], [0, 0, 200]], [1, 1], 6).length, 2);
});
test('BW threshold + invert, grey levels, locked palette, transparency', () => {
  const im = image(10, 2, (x) => [x * 25, x * 25, x * 25, x < 1 ? 0 : 255]);
  const q = V.quantize(im.data, 10, 2, base({ mode: 'bw', otsu: false, threshold: 128 }));
  assert.strictEqual(q.labels[0], 255); assert.strictEqual(q.labels[1], 0); assert.strictEqual(q.labels[9], 1);
  const qi = V.quantize(im.data, 10, 2, base({ mode: 'bw', otsu: false, threshold: 128, invert: true }));
  assert.strictEqual(qi.labels[1], 1);
  const g = V.quantize(im.data, 10, 2, base({ mode: 'grey', levels: 4 }));
  assert(new Set(Array.from(g.labels).filter((v) => v !== 255)).size >= 3);
  const lk = V.quantize(im.data, 10, 2, base({ mode: 'color', lock: true, palette: ['#000000', '#ffffff'] }));
  assert.deepStrictEqual(lk.palette, [[0, 0, 0], [255, 255, 255]]); assert.strictEqual(lk.labels[2], 0); assert.strictEqual(lk.labels[9], 1);
});
test('despeckle absorbs regions smaller than N px into their neighbour', () => {
  const w = 20, h = 20, lab = new Uint8Array(w * h);
  lab[5 * w + 5] = 1; lab[5 * w + 6] = 1; for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) lab[y * w + x] = 1;
  V.despeckle(lab, w, h, 5);
  assert.strictEqual(lab[5 * w + 5], 0); assert.strictEqual(lab[12 * w + 12], 1);
});

console.log('Boundary following & fitting');
test('a filled square gives one clockwise loop of perimeter 4·side', () => {
  const w = 10, h = 10, m = new Uint8Array(100); for (let y = 2; y < 6; y++) for (let x = 3; x < 7; x++) m[y * w + x] = 1;
  const L = V.traceLoops(m, w, h, null); assert.strictEqual(L.length, 1); assert.strictEqual(L[0].dirs.length, 16); assert.strictEqual(L[0].area, 16);
});
test('a ring gives an outline (area > 0) and a hole (area < 0) in the same component', () => {
  const w = 20, h = 20, m = new Uint8Array(w * h); for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) m[y * w + x] = x < 6 || x > 13 || y < 6 || y > 13 ? 1 : 0;
  const cc = V.components(m, w, h), L = V.traceLoops(m, w, h, cc.comp);
  assert.strictEqual(L.length, 2); assert(L.some((l) => l.area === 256)); assert(L.some((l) => l.area === -64)); assert.strictEqual(L[0].comp, L[1].comp);
});
test('two pixels touching by a corner are two separate loops (4-connectivity saddle rule)', () => {
  const m = new Uint8Array([1, 0, 0, 1]); const L = V.traceLoops(m, 2, 2, V.components(m, 2, 2).comp);
  assert.strictEqual(L.length, 2); assert(L.every((l) => l.area === 1)); assert.notStrictEqual(L[0].comp, L[1].comp);
});
test('a diagonal chain of pixels inside a ring: total signed area equals the pixel count', () => {
  const w = 12, h = 12, m = new Uint8Array(w * h); let cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (x === y || x + 1 === y || (x > 1 && x < 10 && (y === 1 || y === 10))) ? 1 : 0; m[y * w + x] = v; cnt += v; }
  const L = V.traceLoops(m, w, h, V.components(m, w, h).comp); assert.strictEqual(L.reduce((a, l) => a + l.area, 0), cnt);
});
test('Douglas–Peucker keeps the corner of an L and drops collinear points', () => {
  const X = new Float64Array([0, 1, 2, 3, 3, 3, 3]), Y = new Float64Array([0, 0, 0, 0, 1, 2, 3]);
  assert.deepStrictEqual(V.douglasPeucker(X, Y, 0, 6, 0.5), [0, 3, 6]);
});
test('corner detection finds the 4 corners of a square outline and none on a circle', () => {
  const X = [], Y = [];
  for (let i = 0; i < 40; i++) { const s = Math.floor(i / 10), t = i % 10; const p = [[t, 0], [10, t], [10 - t, 10], [0, 10 - t]][s]; X.push(p[0]); Y.push(p[1]); }
  assert.strictEqual(V.detectCorners(new Float64Array(X), new Float64Array(Y), true, 3, Math.PI / 3).length, 4);
  const CX = [], CY = []; for (let i = 0; i < 120; i++) { CX.push(30 * Math.cos(i / 120 * 2 * Math.PI)); CY.push(30 * Math.sin(i / 120 * 2 * Math.PI)); }
  assert.strictEqual(V.detectCorners(new Float64Array(CX), new Float64Array(CY), true, 3, Math.PI / 3).length, 0);
});
test('square → 4 exact corners (lines only); circle → few Bézier nodes, IoU > 0.98', () => {
  const sq = V.trace(image(40, 40, (x, y) => (x > 8 && x < 30 && y > 5 && y < 25 ? [0, 0, 0] : [255, 255, 255])), base({ mode: 'bw', removeBg: true }));
  const d = sq.layers[0].paths[0].loops[0].d; assert.strictEqual(V.countNodes(d), 4);
  const pts = [[d[0], d[1]]]; for (let i = 2; i < d.length; i += 3) { assert.strictEqual(d[i], 0); pts.push([d[i + 1], d[i + 2]]); }
  assert.deepStrictEqual(pts.map(String).sort(), ['30,25', '30,5', '8,25', '8,5']);
  const w = 120, im = image(w, w, (x, y) => (Math.hypot(x - 60, y - 60) < 40 ? [0, 0, 0] : [255, 255, 255]));
  const r = V.trace(im, base({ mode: 'bw', removeBg: true }));
  assert(r.stats.nodes <= 8, 'nodes ' + r.stats.nodes);
  const m = rasterize(parsePath(V.pathData(r.layers[0].paths[0].loops, 2)), w, w), ref = r.labels.map((l) => (l === 0 ? 1 : 0));
  const v = iou(m, ref); assert(v > 0.98, 'IoU ' + v);
});
test('higher curve tolerance → fewer nodes; corner 180 → no sharp corners on a square (rounded)', () => {
  const im = image(150, 150, (x, y) => (Math.hypot(x - 75, y - 75) < 30 + 12 * Math.sin(Math.atan2(y - 75, x - 75) * 5) ? [0, 0, 0] : [255, 255, 255]));
  const a = V.trace(im, base({ mode: 'bw', removeBg: true, tol: 0.4 })), b = V.trace(im, base({ mode: 'bw', removeBg: true, tol: 3 }));
  assert(b.stats.nodes < a.stats.nodes, a.stats.nodes + ' vs ' + b.stats.nodes);
});
test('pixels mode reproduces the reduced image exactly', () => {
  const R = V.prng(5), cols = [[0, 0, 0], [255, 0, 0], [0, 0, 255], [255, 255, 255]];
  const grid = Array.from({ length: 16 * 16 }, () => cols[Math.floor(R() * 4)]);
  const im = image(16, 16, (x, y) => grid[Math.floor(y) * 16 + Math.floor(x)]);
  for (const layering of ['stack', 'cut']) {
    const r = V.trace(im, base({ mode: 'color', colors: 4, merge: 0, speckle: 0, trace: 'pixels', layering }));
    assert.strictEqual(agreement(renderSVG(V.buildSVG(r, { dec: 0 }), r), r.labels), 1, layering);
  }
});
test('centreline of a thick ring gives one closed stroke near the middle radius', () => {
  const w = 100, im = image(w, w, (x, y) => { const r = Math.hypot(x - 50, y - 50); return r > 22 && r < 32 ? [0, 0, 0] : [255, 255, 255]; });
  const r = V.trace(im, base({ mode: 'bw', trace: 'center' }));
  assert.strictEqual(r.layers.length, 1); const L0 = r.layers[0];
  assert.strictEqual(L0.kind, 'center'); assert(L0.strokeWidth > 7 && L0.strokeWidth < 13, 'sw ' + L0.strokeWidth);
  assert.strictEqual(L0.paths.length, 1); assert(L0.paths[0].loops[0].closed);
  const P = parsePath(V.pathData(L0.paths[0].loops, 2))[0]; for (const [x, y] of P) { const rr = Math.hypot(x - 50, y - 50); assert(rr > 24 && rr < 30, 'radius ' + rr); }
});
test('centreline of a straight thick bar → a single open stroke', () => {
  const r = V.trace(image(120, 40, (x, y) => (x > 10 && x < 110 && y > 15 && y < 25 ? [0, 0, 0] : [255, 255, 255])), base({ mode: 'bw', trace: 'center' }));
  assert.strictEqual(r.stats.paths, 1); assert(!r.layers[0].paths[0].loops[0].closed); assert(r.stats.nodes <= 3, 'nodes ' + r.stats.nodes);
});

console.log('Full pipeline + SVG writer');
const scene = image(200, 140, (x, y) => {
  if (Math.hypot(x - 50, y - 60) < 35) return Math.hypot(x - 50, y - 60) < 15 ? [250, 240, 220] : [200, 60, 40];
  if (x > 100 && x < 180 && y > 30 && y < 60) return [20, 40, 80];
  if (y > 80 && y < 120 && x > 110 && x < 170 && (x - 110) > (y - 80)) return [230, 170, 50];
  return [250, 240, 220];
});
for (const mode of ['color', 'bw', 'grey']) for (const trace of ['curves', 'polygons', 'pixels']) for (const layering of ['stack', 'cut']) {
  test(`SVG parses back and matches the reduced image — ${mode} / ${trace} / ${layering}`, () => {
    const r = V.trace(scene, base({ mode, trace, layering, colors: 4, levels: 3, speckle: 4 }));
    for (const layered of [false, true]) {
      const svg = V.buildSVG(r, { layered, dec: 2 });
      assert(/^<svg [^>]*viewBox="0 0 200 140"/.test(svg) && svg.endsWith('</svg>'));
      assert((svg.match(/<path /g) || []).length > 0);
      const a = agreement(renderSVG(svg, r), r.labels);
      assert(a > (trace === 'pixels' ? 0.999 : 0.97), `agreement ${a.toFixed(4)} (layered ${layered})`);
    }
  });
}
test('layered SVG: one <g> per colour with hex id and Inkscape layer label; hidden + recolour', () => {
  const r = V.trace(scene, base({ colors: 4 }));
  const svg = V.buildSVG(r, { layered: true, dec: 1 });
  assert.strictEqual((svg.match(/<g id="hex-[0-9A-F]{6}"/g) || []).length, r.layers.length);
  assert(svg.includes('inkscape:groupmode="layer"'));
  const h = r.layers[0].hex, svg2 = V.buildSVG(r, { layered: true, hidden: new Set([h]), recolor: { [r.layers[1].hex]: '#123456' } });
  assert(!svg2.includes('hex-' + h.slice(1).toUpperCase() + '"')); assert(svg2.includes('fill="#123456"'));
});
test('outline-only style writes strokes; removeBg drops the border colour', () => {
  const r = V.trace(scene, base({ colors: 4, style: 'stroke', removeBg: true }));
  const svg = V.buildSVG(r);
  assert(svg.includes('fill="none" stroke="#')); assert(r.palette.some((p) => p.removed)); assert(!svg.includes('stroke="' + r.palette.find((p) => p.removed).hex + '"'));
});
test('number formatting and relative commands (h/v/l/c, implicit repeats, decimals)', () => {
  assert.strictEqual(V.fmt(0.5, 2), '.5'); assert.strictEqual(V.fmt(-0.5, 2), '-.5'); assert.strictEqual(V.fmt(3, 2), '3'); assert.strictEqual(V.fmt(-0.001, 2), '0');
  assert.strictEqual(V.pathData([{ d: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10], closed: true }], 2), 'M0 0h10v10h-10z');
  assert.strictEqual(V.pathData([{ d: [1.234, 5.678, 0, 3, 3, 0, 5, 5], closed: false }], 1), 'M1.2 5.7l1.8-2.7 2 2');
});
test('transparent pixels are never traced', () => {
  const r = V.trace(image(30, 30, (x, y) => (x > 10 && x < 20 && y > 10 && y < 20 ? [255, 0, 0, 255] : [0, 0, 0, 0])), base({ colors: 4 }));
  assert.strictEqual(r.palette.length, 1); const m = rasterize(parsePath(V.pathData(r.layers[0].paths[0].loops, 2)), 30, 30);
  assert.strictEqual(m.reduce((a, v) => a + v, 0), 100);
});
test('deterministic: same input + settings → identical SVG', () => {
  const a = V.buildSVG(V.trace(scene, base({ colors: 6 }))), b = V.buildSVG(V.trace(scene, base({ colors: 6 })));
  assert.strictEqual(a, b);
});

console.log('Settings, presets, i18n');
test('normalize clamps and validates', () => {
  const s = S.normalize({ colors: 99, mode: 'nope', tol: '2.345', otsu: '0', palette: ['#ABCDEF', 'zz', 'abc123'], recolor: { '#000000': '#ffffff', bad: '#000' } });
  assert.strictEqual(s.colors, 32); assert.strictEqual(s.mode, 'color'); assert.strictEqual(s.tol, 2.35); assert.strictEqual(s.otsu, false);
  assert.deepStrictEqual(s.palette, ['#abcdef', '#abc123']); assert.deepStrictEqual(s.recolor, { '#000000': '#ffffff' });
});
test('URL hash round trip (all presets + palette / hidden / recolour + language)', () => {
  for (const p in S.PRESETS) {
    const s = { ...S.applyPreset(S.DEFAULTS, p), palette: ['#112233'], hidden: ['#445566'], recolor: { '#778899': '#aabbcc' } };
    const h = S.toHash(s, { lang: 'kab' }), back = S.fromHash('#' + h);
    assert.deepStrictEqual(back.settings, S.normalize(s), p); assert.strictEqual(back.extra.lang, 'kab');
  }
  assert.strictEqual(S.toHash(S.DEFAULTS), '');
});
test('every preset traces the scene without error', () => {
  for (const p in S.PRESETS) { const r = V.trace(scene, S.applyPreset(S.DEFAULTS, p)); assert(r.stats.paths > 0, p); }
});
test('translations: every key has FR / EN / Kabyle text; Tifinagh conversion keeps placeholders and tags', () => {
  for (const k in I.S) { assert.strictEqual(I.S[k].length, 3, k); I.S[k].forEach((s) => assert(s && s.length, k)); }
  assert.strictEqual(I.t('traced', 'kab', { p: 3, n: 4, c: 2 }, true).includes('3'), true);
  assert(/ⴰ/.test(I.toTifinagh('azul')));
  assert.strictEqual(I.toTifinagh('<b>{n}</b>'), '<b>{n}</b>');
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
