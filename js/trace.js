/* trace.js — Vecteur Atelier tracing engine: bitmap → vector (no DOM; runs in a Web Worker, in the page or in Node).
 *
 * ORIGINAL CODE written for this project (MIT licence). It does not contain or adapt code from potrace,
 * imagetracerjs, autotrace or any other tracer. The methods are classic textbook ideas, implemented from scratch:
 *   1. pre-processing ............ contrast curve, 3×3 median (sorting network), box blur ×3 (≈ Gaussian)
 *   2. colour reduction ........... threshold (manual or Otsu), grey levels, weighted k-means++ on a colour
 *                                   histogram (√count weights) or median cut, merging of
 *                                   similar colours in CIELAB (ΔE76), or a locked palette (nearest colour)
 *      + anti-aliasing clean-up (edge pixels that blend their two neighbours join the nearer side)
 *   3. despeckle .................. 4-connected regions smaller than N px are absorbed by their main neighbour
 *   4. boundary following ......... directed pixel-edge contours per colour layer ("crack following"), clockwise
 *                                   outlines / anticlockwise holes, saddle rule = right turn (4-connected regions)
 *   5. corner detection ........... turning angle measured over k samples on the edge-midpoint polygon, local maxima
 *                                   above a threshold, snapped back to the real pixel corner
 *   6. simplification / fitting ... Douglas–Peucker (polygons, straight-run detection) and least-squares cubic
 *                                   Bézier fitting with Newton re-parameterisation and recursive splitting
 *   7. centreline ................. Zhang–Suen thinning, staircase clean-up, skeleton graph walk, spur pruning
 *   8. SVG writer ................. rounded relative commands (h/v/l/c, implicit repeats), layered or optimised
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VTRACE = factory();
})(typeof self !== 'undefined' ? self : this, function vtraceFactory() {
  'use strict';
  const TRANSPARENT = 255;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // directions: 0 right, 1 down, 2 left, 3 up (screen, y down)
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /* ================================================================== colours */
  const hex2 = (v) => (v < 16 ? '0' : '') + v.toString(16);
  const rgbToHex = (c) => '#' + hex2(c[0] | 0) + hex2(c[1] | 0) + hex2(c[2] | 0);
  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  /** sRGB [0..255] → CIELAB (D65). */
  function rgbToLab(c) {
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b),
      z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  /** Small deterministic PRNG (xorshift32) so that a given image + settings always gives the same result. */
  function prng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* ================================================================== 1. pre-processing */
  function boxBlurPass(src, dst, w, h, r, horizontal) {
    const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 4 : 4 * w, inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = horizontal ? l * w * 4 : l * 4;
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += src[base + clamp(i, 0, len - 1) * step + c];
        for (let i = 0; i < len; i++) {
          dst[base + i * step + c] = acc * inv;
          acc += src[base + Math.min(i + r + 1, len - 1) * step + c] - src[base + Math.max(i - r, 0) * step + c];
        }
      }
    }
  }
  /** Approximate Gaussian blur: three box blurs (horizontal + vertical). */
  function blur(d, w, h, radius) {
    const r = Math.round(radius);
    if (r < 1) return d;
    const a = new Float32Array(d), b = new Float32Array(d.length);
    for (let k = 0; k < 3; k++) { boxBlurPass(a, b, w, h, r, true); boxBlurPass(b, a, w, h, r, false); }
    for (let i = 0; i < d.length; i++) d[i] = a[i];
    return d;
  }
  // 9-element sorting network (19 compare-exchanges) → median in v[4]
  const NET = [1, 2, 4, 5, 7, 8, 0, 1, 3, 4, 6, 7, 1, 2, 4, 5, 7, 8, 0, 3, 5, 8, 4, 7, 3, 6, 1, 4, 2, 5, 4, 7, 4, 2, 6, 4, 4, 2];
  /** 3×3 median filter on R, G, B (removes salt-and-pepper noise while keeping edges). */
  function median3(d, w, h) {
    const src = new Uint8ClampedArray(d), v = new Int32Array(9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let k = 0;
      for (let j = -1; j <= 1; j++) {
        const yy = clamp(y + j, 0, h - 1);
        for (let i = -1; i <= 1; i++) v[k++] = src[(yy * w + clamp(x + i, 0, w - 1)) * 4 + c];
      }
      for (let n = 0; n < NET.length; n += 2) { const a = NET[n], b = NET[n + 1]; if (v[a] > v[b]) { const t = v[a]; v[a] = v[b]; v[b] = t; } }
      d[(y * w + x) * 4 + c] = v[4];
    }
    return d;
  }
  /** Returns a pre-processed copy (contrast → median → blur). */
  function preprocess(data, w, h, s) {
    const d = new Uint8ClampedArray(data);
    if (s.contrast) {
      const c = clamp(s.contrast, -100, 100) * 2.55, f = (259 * (c + 255)) / (255 * (259 - c)), lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) lut[i] = f * (i - 128) + 128;
      for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = lut[d[i]];
    }
    if (s.denoise) median3(d, w, h);
    if (s.blur > 0) blur(d, w, h, s.blur);
    return d;
  }

  /* ================================================================== 2. colour reduction */
  /** Otsu threshold on a 256-bin histogram: pixels with value < returned threshold form the dark class. */
  function otsu(hist) {
    let total = 0, sum = 0;
    for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    let wB = 0, sumB = 0, best = -1, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t + 1; }
    }
    return thr;
  }
  /** Up to `max` opaque pixels taken on a regular stride (deterministic sample for clustering). */
  function samplePixels(d, max) {
    const n = d.length >> 2, stride = Math.max(1, Math.floor(n / max)), out = [];
    for (let p = 0; p < n; p += stride) if (d[p * 4 + 3] >= 128) out.push(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
    return new Float64Array(out);
  }
  /**
   * Colour histogram on 5 bits per channel: one entry per occupied bin with its mean colour and a weight.
   * The weight is the square root of the pixel count, so that small but distinct areas (a sign, a tree trunk)
   * still get their own colour instead of being swamped by a large gradient (a sky).
   */
  function colourBins(d) {
    const H = new Float64Array(32768 * 4);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      H[key * 4] += d[i]; H[key * 4 + 1] += d[i + 1]; H[key * 4 + 2] += d[i + 2]; H[key * 4 + 3]++;
    }
    const out = [];
    for (let q = 0; q < 32768; q++) { const c = H[q * 4 + 3]; if (c) out.push(H[q * 4] / c, H[q * 4 + 1] / c, H[q * 4 + 2] / c, Math.sqrt(c)); }
    return new Float64Array(out);
  }
  /** Weighted k-means (k-means++ seeding) on colour bins [r, g, b, weight, …]. Returns centres [[r,g,b], ...]. */
  function kmeans(S, k, seed) {
    const n = S.length / 4;
    if (!n) return [[0, 0, 0]];
    const rnd = prng(seed), C = [], dist = new Float64Array(n).fill(Infinity);
    // first centre: the heaviest bin (deterministic), then k-means++ on weight × distance²
    let idx = 0;
    for (let i = 1; i < n; i++) if (S[i * 4 + 3] > S[idx * 4 + 3]) idx = i;
    for (let c = 0; c < k; c++) {
      C.push([S[idx * 4], S[idx * 4 + 1], S[idx * 4 + 2]]);
      let tot = 0;
      for (let i = 0; i < n; i++) {
        const dr = S[i * 4] - C[c][0], dg = S[i * 4 + 1] - C[c][1], db = S[i * 4 + 2] - C[c][2], e = dr * dr + dg * dg + db * db;
        if (e < dist[i]) dist[i] = e;
        tot += dist[i] * S[i * 4 + 3];
      }
      if (tot <= 1e-9) break; // fewer distinct colours than k
      let r = rnd() * tot; idx = n - 1;
      for (let i = 0; i < n; i++) { r -= dist[i] * S[i * 4 + 3]; if (r <= 0) { idx = i; break; } }
    }
    const K = C.length, sums = new Float64Array(K * 4);
    for (let it = 0; it < 30; it++) {
      sums.fill(0);
      for (let i = 0; i < n; i++) {
        let bi = 0, be = Infinity;
        for (let c = 0; c < K; c++) {
          const dr = S[i * 4] - C[c][0], dg = S[i * 4 + 1] - C[c][1], db = S[i * 4 + 2] - C[c][2], e = dr * dr + dg * dg + db * db;
          if (e < be) { be = e; bi = c; }
        }
        const wt = S[i * 4 + 3];
        sums[bi * 4] += S[i * 4] * wt; sums[bi * 4 + 1] += S[i * 4 + 1] * wt; sums[bi * 4 + 2] += S[i * 4 + 2] * wt; sums[bi * 4 + 3] += wt;
      }
      let moved = 0;
      for (let c = 0; c < K; c++) {
        const m = sums[c * 4 + 3];
        if (!m) continue;
        const nc = [sums[c * 4] / m, sums[c * 4 + 1] / m, sums[c * 4 + 2] / m];
        moved = Math.max(moved, Math.abs(nc[0] - C[c][0]) + Math.abs(nc[1] - C[c][1]) + Math.abs(nc[2] - C[c][2]));
        C[c] = nc;
      }
      if (moved < 0.3) break;
    }
    // final means with true pixel counts (weight²): the √ weighting chose the clusters, but each colour should be
    // the real average of its pixels, not pulled towards rarer edge blends
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      let bi = 0, be = Infinity;
      for (let c = 0; c < K; c++) {
        const dr = S[i * 4] - C[c][0], dg = S[i * 4 + 1] - C[c][1], db = S[i * 4 + 2] - C[c][2], e = dr * dr + dg * dg + db * db;
        if (e < be) { be = e; bi = c; }
      }
      const wt = S[i * 4 + 3] * S[i * 4 + 3];
      sums[bi * 4] += S[i * 4] * wt; sums[bi * 4 + 1] += S[i * 4 + 1] * wt; sums[bi * 4 + 2] += S[i * 4 + 2] * wt; sums[bi * 4 + 3] += wt;
    }
    for (let c = 0; c < K; c++) { const m = sums[c * 4 + 3]; if (m) C[c] = [sums[c * 4] / m, sums[c * 4 + 1] / m, sums[c * 4 + 2] / m]; }
    return C.map((c) => c.map((v) => Math.round(v)));
  }
  /** Median cut on a 5-bit-per-channel histogram. Returns up to k colours (weighted box averages). */
  function medianCut(d, k) {
    const H = new Float64Array(32768 * 4);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      H[key * 4] += d[i]; H[key * 4 + 1] += d[i + 1]; H[key * 4 + 2] += d[i + 2]; H[key * 4 + 3]++;
    }
    const keys = [];
    for (let q = 0; q < 32768; q++) if (H[q * 4 + 3]) keys.push(q);
    if (!keys.length) return [[0, 0, 0]];
    const comp = (q, c) => (c === 0 ? q >> 10 : c === 1 ? (q >> 5) & 31 : q & 31);
    const boxInfo = (b) => {
      let cnt = 0; const lo = [31, 31, 31], hi = [0, 0, 0];
      for (const q of b) { cnt += H[q * 4 + 3]; for (let c = 0; c < 3; c++) { const v = comp(q, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } }
      const rg = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], axis = rg.indexOf(Math.max(...rg));
      return { b, cnt, axis, range: rg[axis] };
    };
    let boxes = [boxInfo(keys)];
    while (boxes.length < k) {
      let bi = -1, bs = 0;
      boxes.forEach((B, i) => { const sc = B.range * Math.sqrt(B.cnt); if (B.b.length > 1 && B.range > 0 && sc > bs) { bs = sc; bi = i; } });
      if (bi < 0) break;
      const B = boxes[bi];
      B.b.sort((a, c) => comp(a, B.axis) - comp(c, B.axis));
      let acc = 0, cut = 1;
      for (let i = 0; i < B.b.length; i++) { acc += H[B.b[i] * 4 + 3]; if (acc >= B.cnt / 2) { cut = clamp(i + 1, 1, B.b.length - 1); break; } }
      boxes.splice(bi, 1, boxInfo(B.b.slice(0, cut)), boxInfo(B.b.slice(cut)));
    }
    return boxes.map((B) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (const q of B.b) { r += H[q * 4]; g += H[q * 4 + 1]; b += H[q * 4 + 2]; n += H[q * 4 + 3]; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
  }
  /** Merges palette entries closer than `thr` (ΔE76) — weighted by pixel counts — and exact duplicates. */
  function mergeSimilar(pal, counts, thr) {
    const P = pal.map((c, i) => ({ c: c.slice(), n: Math.max(counts[i] || 0, 1e-6), lab: rgbToLab(c) }));
    for (;;) {
      let bi = -1, bj = -1, be = Infinity;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const e = deltaE(P[i].lab, P[j].lab);
        if (e < be) { be = e; bi = i; bj = j; }
      }
      if (bi < 0 || !(be < thr || be < 0.5)) break;
      const A = P[bi], B = P[bj], n = A.n + B.n;
      A.c = [0, 1, 2].map((c) => Math.round((A.c[c] * A.n + B.c[c] * B.n) / n)); A.n = n; A.lab = rgbToLab(A.c);
      P.splice(bj, 1);
    }
    return P.map((p) => p.c);
  }
  /** Nearest-palette lookup through a 6-bit-per-channel cache (exact enough, fast for photos). */
  function makeMapper(pal) {
    const lut = new Int16Array(1 << 18).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let v = lut[key];
      if (v < 0) {
        const cr = (r & ~3) + 2, cg = (g & ~3) + 2, cb = (b & ~3) + 2;
        let be = Infinity; v = 0;
        for (let i = 0; i < pal.length; i++) {
          const dr = cr - pal[i][0], dg = cg - pal[i][1], db = cb - pal[i][2], e = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
          if (e < be) { be = e; v = i; }
        }
        lut[key] = v;
      }
      return v;
    };
  }
  /**
   * Anti-aliasing clean-up. An edge pixel whose colour is a blend of the two colours on either side of it
   * (left/right, up/down, or a two-pixel-wide band) is given to the nearer side instead of becoming a thin
   * sliver of an unrelated palette colour. Genuine thin lines are kept: their colour is not a blend of their
   * neighbours. Returns the number of pixels changed.
   */
  function cleanAntialias(d, labels, w, h, pal) {
    const src = labels.slice(), steps = [[1, 1], [1, 2], [2, 1]];
    let changed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, L = src[p];
      if (L === TRANSPARENT) continue;
      const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2];
      let best = -1, bestE = Infinity;
      for (let axis = 0; axis < 2; axis++) for (const [a, c] of steps) {
        const xa = axis ? x : x - a, ya = axis ? y - a : y, xb = axis ? x : x + c, yb = axis ? y + c : y;
        if (xa < 0 || ya < 0 || xb >= w || yb >= h) continue;
        const A = src[ya * w + xa], B = src[yb * w + xb];
        if (A === L || B === L || A === TRANSPARENT || B === TRANSPARENT || A === B) continue;
        const PA = pal[A], PB = pal[B], ex = PB[0] - PA[0], ey = PB[1] - PA[1], ez = PB[2] - PA[2], len2 = ex * ex + ey * ey + ez * ez;
        if (!len2) continue;
        const t = ((r - PA[0]) * ex + (g - PA[1]) * ey + (b - PA[2]) * ez) / len2;
        if (t <= 0.02 || t >= 0.98) continue;
        const qx = PA[0] + t * ex - r, qy = PA[1] + t * ey - g, qz = PA[2] + t * ez - b, e = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (e < 18 + 0.08 * Math.sqrt(len2) && e < bestE) { bestE = e; best = t < 0.5 ? A : B; }
      }
      if (best >= 0) { labels[p] = best; changed++; }
    }
    return changed;
  }
  /** Colour reduction → { labels (Uint8Array, 255 = transparent), palette [[r,g,b]], threshold }. */
  function quantize(d, w, h, s) {
    const n = w * h, labels = new Uint8Array(n);
    let palette, threshold = null;
    if (s.mode === 'bw' || s.mode === 'grey') {
      const L = new Uint8Array(n), hist = new Float64Array(256);
      for (let p = 0; p < n; p++) {
        if (d[p * 4 + 3] < 128) { labels[p] = TRANSPARENT; continue; }
        const v = Math.round(luma(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])); L[p] = v; hist[v]++;
      }
      if (s.mode === 'bw') {
        threshold = s.otsu ? otsu(hist) : s.threshold;
        for (let p = 0; p < n; p++) if (labels[p] !== TRANSPARENT) labels[p] = ((L[p] < threshold) !== !!s.invert) ? 0 : 1;
        palette = [[0, 0, 0], [255, 255, 255]];
      } else {
        const lv = s.levels, sum = new Float64Array(lv), cnt = new Float64Array(lv);
        for (let p = 0; p < n; p++) if (labels[p] !== TRANSPARENT) { const b = Math.min(lv - 1, Math.floor((L[p] * lv) / 256)); labels[p] = b; sum[b] += L[p]; cnt[b]++; }
        palette = [];
        for (let b = 0; b < lv; b++) { const g = cnt[b] ? Math.round(sum[b] / cnt[b]) : Math.round(((b + 0.5) * 256) / lv); palette.push([g, g, g]); }
        if (s.antialias && lv > 2) cleanAntialias(d, labels, w, h, palette);
        if (s.invert) palette = palette.map((c) => [255 - c[0], 255 - c[1], 255 - c[2]]);
      }
      return { labels, palette, threshold };
    }
    // colour
    const locked = s.lock && Array.isArray(s.palette) ? s.palette.map(hexToRgb).filter(Boolean) : [];
    if (locked.length >= 1) palette = locked;
    else {
      palette = s.quant === 'median' ? medianCut(d, s.colors) : kmeans(colourBins(d), s.colors, 1234567);
      // pixel counts on a sample, then merge near-duplicates (ΔE)
      const S = samplePixels(d, 60000), map0 = makeMapper(palette), counts = new Float64Array(palette.length);
      for (let i = 0; i < S.length; i += 3) counts[map0(S[i], S[i + 1], S[i + 2])]++;
      palette = mergeSimilar(palette, counts, s.merge);
    }
    const map = makeMapper(palette);
    for (let p = 0; p < n; p++) labels[p] = d[p * 4 + 3] < 128 ? TRANSPARENT : map(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
    if (s.antialias && palette.length > 2) cleanAntialias(d, labels, w, h, palette);
    return { labels, palette, threshold };
  }

  /* ================================================================== 3. despeckle */
  /** Regions (4-connected, same label) smaller than minArea take the label they share the longest border with. */
  function despeckle(labels, w, h, minArea) {
    if (!(minArea > 1)) return 0;
    const n = w * h, stack = new Int32Array(n), nb = new Float64Array(256);
    let total = 0;
    for (let pass = 0; pass < 3; pass++) {
      const seen = new Uint8Array(n);
      let changed = 0;
      for (let s0 = 0; s0 < n; s0++) {
        if (seen[s0] || labels[s0] === TRANSPARENT) continue;
        const L = labels[s0];
        let sp = 0, top = 0; stack[top++] = s0; seen[s0] = 1;
        const touched = [];
        // stack[] doubles as the pixel list: [0, top) are all pixels of the region, sp = scan pointer
        while (sp < top) {
          const p = stack[sp++], x = p % w;
          for (let k = 0; k < 4; k++) {
            let q;
            if (k === 0) { if (x + 1 >= w) continue; q = p + 1; } else if (k === 1) { if (x === 0) continue; q = p - 1; }
            else if (k === 2) { q = p + w; if (q >= n) continue; } else { q = p - w; if (q < 0) continue; }
            const lq = labels[q];
            if (lq === L) { if (!seen[q]) { seen[q] = 1; stack[top++] = q; } }
            else if (lq !== TRANSPARENT) { if (!nb[lq]) touched.push(lq); nb[lq]++; }
          }
        }
        if (top < minArea && touched.length) {
          let best = touched[0];
          for (const t of touched) if (nb[t] > nb[best]) best = t;
          for (let i = 0; i < top; i++) labels[stack[i]] = best;
          changed++;
        }
        for (const t of touched) nb[t] = 0;
      }
      total += changed;
      if (!changed) break;
    }
    return total;
  }

  /* ================================================================== 4. boundary following */
  /** 4-connected component labels of a binary mask (Int32Array, -1 outside). */
  function components(mask, w, h) {
    const n = w * h, comp = new Int32Array(n).fill(-1), stack = new Int32Array(n);
    let id = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (!mask[s0] || comp[s0] >= 0) continue;
      let top = 0; stack[top++] = s0; comp[s0] = id;
      while (top) {
        const p = stack[--top], x = p % w;
        if (x + 1 < w && mask[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; stack[top++] = p + 1; }
        if (x > 0 && mask[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; stack[top++] = p - 1; }
        if (p + w < n && mask[p + w] && comp[p + w] < 0) { comp[p + w] = id; stack[top++] = p + w; }
        if (p - w >= 0 && mask[p - w] && comp[p - w] < 0) { comp[p - w] = id; stack[top++] = p - w; }
      }
      id++;
    }
    return { comp, count: id };
  }
  /**
   * Follows every boundary of a binary mask along pixel edges. Each edge is directed with the inside on its right,
   * so outlines run clockwise on screen (positive area) and holes anticlockwise. At a saddle vertex (two pixels
   * touching only by a corner) the walk turns right, which keeps diagonal neighbours separate (4-connectivity, the
   * same rule as despeckle and component labelling).
   * Returns [{ sx, sy, dirs: Uint8Array, area, comp }].
   */
  function traceLoops(mask, w, h, comp) {
    const W1 = w + 1, out = new Uint8Array(W1 * (h + 1));
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      if (!mask[p]) continue;
      if (y === 0 || !mask[p - w]) out[y * W1 + x] |= 1;               // top edge, heading right
      if (x === w - 1 || !mask[p + 1]) out[y * W1 + x + 1] |= 2;       // right edge, heading down
      if (y === h - 1 || !mask[p + w]) out[(y + 1) * W1 + x + 1] |= 4; // bottom edge, heading left
      if (x === 0 || !mask[p - 1]) out[(y + 1) * W1 + x] |= 8;         // left edge, heading up
    }
    const loops = [];
    let buf = new Uint8Array(4096);
    for (let v = 0; v < out.length; v++) {
      while (out[v]) {
        const sx = v % W1, sy = (v / W1) | 0, bits = out[v];
        const startDir = bits & 1 ? 0 : bits & 2 ? 1 : bits & 4 ? 2 : 3;
        out[v] &= ~(1 << startDir);
        let n = 0, x = sx, y = sy, d = startDir, a2 = 0;
        for (;;) {
          if (n >= buf.length) { const nb = new Uint8Array(buf.length * 2); nb.set(buf); buf = nb; }
          buf[n++] = d;
          a2 += x * DY[d] - DX[d] * y;
          x += DX[d]; y += DY[d];
          const vi = y * W1 + x, atStart = x === sx && y === sy;
          let avail = out[vi];
          if (atStart) avail |= 1 << startDir;
          const r = (d + 1) & 3, l = (d + 3) & 3;
          const nd = (avail >> r) & 1 ? r : (avail >> d) & 1 ? d : (avail >> l) & 1 ? l : -1;
          if (nd < 0 || (atStart && nd === startDir)) break;
          out[vi] &= ~(1 << nd); d = nd;
        }
        // pixel on the right of the first edge → component id (groups each outline with its holes)
        const rx = startDir === 0 ? sx : startDir === 1 ? sx - 1 : startDir === 2 ? sx - 1 : sx;
        const ry = startDir === 0 ? sy : startDir === 1 ? sy : startDir === 2 ? sy - 1 : sy - 1;
        loops.push({ sx, sy, dirs: buf.slice(0, n), area: a2 / 2, comp: comp ? comp[ry * w + rx] : 0 });
      }
    }
    return loops;
  }

  /* ================================================================== 5–6. corners, simplification, curve fitting */
  /** Turning angle at each sample measured between the chords (i-k → i) and (i → i+k); corners are local maxima ≥ thr. */
  function detectCorners(X, Y, closed, k, thr) {
    const n = X.length, ang = new Float64Array(n), out = [];
    for (let i = 0; i < n; i++) {
      let kk = k;
      if (!closed) { kk = Math.min(k, i, n - 1 - i); if (kk < 1) continue; }
      const a = (i - kk + n) % n, c = (i + kk) % n;
      const ux = X[i] - X[a], uy = Y[i] - Y[a], vx = X[c] - X[i], vy = Y[c] - Y[i];
      ang[i] = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    }
    for (let i = 0; i < n; i++) {
      if (ang[i] < thr || ang[i] === 0) continue;
      let ok = true;
      for (let j = 1; j <= k && ok; j++) {
        const jb = closed ? (i - j + n) % n : i - j, jf = closed ? (i + j) % n : i + j;
        if (jb >= 0 && ang[jb] >= ang[i]) ok = false;   // ties → the earlier sample wins
        if (jf < n && ang[jf] > ang[i]) ok = false;
      }
      if (ok) out.push(i);
    }
    return out;
  }
  /** Douglas–Peucker on X[first..last] (iterative). Returns the kept indices, in order. */
  function douglasPeucker(X, Y, first, last, tol) {
    const keep = new Uint8Array(last - first + 1); keep[0] = keep[last - first] = 1;
    const st = [first, last], t2 = tol * tol;
    while (st.length) {
      const b = st.pop(), a = st.pop();
      const dx = X[b] - X[a], dy = Y[b] - Y[a], L2 = dx * dx + dy * dy;
      let bi = -1, be = t2;
      for (let i = a + 1; i < b; i++) {
        let e;
        if (L2 < 1e-12) e = (X[i] - X[a]) ** 2 + (Y[i] - Y[a]) ** 2;
        else { const cr = (X[i] - X[a]) * dy - (Y[i] - Y[a]) * dx; e = (cr * cr) / L2; }
        if (e > be) { be = e; bi = i; }
      }
      if (bi > 0) { keep[bi - first] = 1; st.push(a, bi, bi, b); }
    }
    const idx = [];
    for (let i = 0; i < keep.length; i++) if (keep[i]) idx.push(first + i);
    return idx;
  }
  /** Largest distance of X[first..last] from the chord first→last. */
  function chordDeviation(X, Y, first, last) {
    const dx = X[last] - X[first], dy = Y[last] - Y[first], L = Math.hypot(dx, dy);
    let m = 0;
    for (let i = first + 1; i < last; i++) {
      const e = L < 1e-9 ? Math.hypot(X[i] - X[first], Y[i] - Y[first]) : Math.abs((X[i] - X[first]) * dy - (Y[i] - Y[first]) * dx) / L;
      if (e > m) m = e;
    }
    return m;
  }
  function unit(x, y) { const l = Math.hypot(x, y); return l > 1e-12 ? [x / l, y / l] : [0, 0]; }
  function bez(p0, p1, p2, p3, t) { const s = 1 - t; return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3; }
  /** Appends a cubic, or a line when both control points lie on the chord (within lineTol). */
  function pushCubic(out, x0, y0, x1, y1, x2, y2, x3, y3, lineTol) {
    const dx = x3 - x0, dy = y3 - y0, L = Math.hypot(dx, dy);
    if (L > 1e-9 && lineTol > 0) {
      const d1 = Math.abs((x1 - x0) * dy - (y1 - y0) * dx) / L, d2 = Math.abs((x2 - x0) * dy - (y2 - y0) * dx) / L;
      const t1 = ((x1 - x0) * dx + (y1 - y0) * dy) / (L * L), t2 = ((x2 - x0) * dx + (y2 - y0) * dy) / (L * L);
      if (d1 <= lineTol && d2 <= lineTol && t1 >= -0.01 && t1 <= 1.01 && t2 >= -0.01 && t2 <= 1.01) { out.push(0, x3, y3); return; }
    }
    out.push(1, x1, y1, x2, y2, x3, y3);
  }
  /** Least-squares control-point distances along fixed end tangents (t2 points back into the curve). */
  function solveBezier(X, Y, first, last, u, t1x, t1y, t2x, t2y) {
    const p0x = X[first], p0y = Y[first], p3x = X[last], p3y = Y[last];
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = first; i <= last; i++) {
      const t = u[i - first], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
      const a1x = t1x * b1, a1y = t1y * b1, a2x = t2x * b2, a2y = t2y * b2;
      c00 += a1x * a1x + a1y * a1y; c01 += a1x * a2x + a1y * a2y; c11 += a2x * a2x + a2y * a2y;
      const rx = X[i] - (p0x * (b0 + b1) + p3x * (b2 + b3)), ry = Y[i] - (p0y * (b0 + b1) + p3y * (b2 + b3));
      x0 += a1x * rx + a1y * ry; x1 += a2x * rx + a2y * ry;
    }
    const det = c00 * c11 - c01 * c01, seg = Math.hypot(p3x - p0x, p3y - p0y);
    let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0, ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
    const eps = 1e-6 * seg;
    if (!(al > eps && ar > eps) || al > seg * 2.5 || ar > seg * 2.5) al = ar = seg / 3; // fall back to the 1/3 rule
    return [p0x, p0y, p0x + t1x * al, p0y + t1y * al, p3x + t2x * ar, p3y + t2y * ar, p3x, p3y];
  }
  function maxError(X, Y, first, last, B, u) {
    let m = 0, at = (first + last) >> 1;
    for (let i = first + 1; i < last; i++) {
      const t = u[i - first], dx = bez(B[0], B[2], B[4], B[6], t) - X[i], dy = bez(B[1], B[3], B[5], B[7], t) - Y[i], e = dx * dx + dy * dy;
      if (e >= m) { m = e; at = i; }
    }
    return [m, at];
  }
  /** One Newton–Raphson step per sample: moves u towards the closest point of the curve. */
  function reparam(X, Y, first, last, u, B) {
    const out = new Float64Array(u.length);
    for (let i = first; i <= last; i++) {
      const t = u[i - first], s = 1 - t;
      const qx = bez(B[0], B[2], B[4], B[6], t), qy = bez(B[1], B[3], B[5], B[7], t);
      const d1x = 3 * (s * s * (B[2] - B[0]) + 2 * s * t * (B[4] - B[2]) + t * t * (B[6] - B[4]));
      const d1y = 3 * (s * s * (B[3] - B[1]) + 2 * s * t * (B[5] - B[3]) + t * t * (B[7] - B[5]));
      const d2x = 6 * (s * (B[4] - 2 * B[2] + B[0]) + t * (B[6] - 2 * B[4] + B[2]));
      const d2y = 6 * (s * (B[5] - 2 * B[3] + B[1]) + t * (B[7] - 2 * B[5] + B[3]));
      const num = (qx - X[i]) * d1x + (qy - Y[i]) * d1y, den = d1x * d1x + d1y * d1y + (qx - X[i]) * d2x + (qy - Y[i]) * d2y;
      out[i - first] = den ? clamp(t - num / den, 0, 1) : t;
    }
    return out;
  }
  /** Recursive cubic Bézier fitting of X[first..last] with end tangents (t1 forward, t2 backward). */
  function fitCubic(X, Y, first, last, t1x, t1y, t2x, t2y, err2, lineTol, out, depth) {
    const p0x = X[first], p0y = Y[first], p3x = X[last], p3y = Y[last], seg = Math.hypot(p3x - p0x, p3y - p0y);
    if (last - first < 2) {
      const a = seg / 3;
      pushCubic(out, p0x, p0y, p0x + t1x * a, p0y + t1y * a, p3x + t2x * a, p3y + t2y * a, p3x, p3y, lineTol); return;
    }
    // chord-length parameterisation
    let u = new Float64Array(last - first + 1);
    for (let i = first + 1; i <= last; i++) u[i - first] = u[i - first - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
    const tot = u[last - first] || 1;
    for (let i = 0; i < u.length; i++) u[i] /= tot;
    let B = solveBezier(X, Y, first, last, u, t1x, t1y, t2x, t2y), [e, at] = maxError(X, Y, first, last, B, u);
    if (e <= err2) { pushCubic(out, B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], lineTol); return; }
    if (e <= err2 * 16) {
      for (let it = 0; it < 6; it++) {
        u = reparam(X, Y, first, last, u, B);
        B = solveBezier(X, Y, first, last, u, t1x, t1y, t2x, t2y); [e, at] = maxError(X, Y, first, last, B, u);
        if (e <= err2) { pushCubic(out, B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], lineTol); return; }
      }
    }
    if (depth > 40) { pushCubic(out, B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], lineTol); return; }
    at = clamp(at, first + 1, last - 1);
    let [cx, cy] = unit(X[at - 1] - X[at + 1], Y[at - 1] - Y[at + 1]);
    if (!cx && !cy) [cx, cy] = unit(-(Y[at] - Y[at - 1]), X[at] - X[at - 1]);
    fitCubic(X, Y, first, at, t1x, t1y, cx, cy, err2, lineTol, out, depth + 1);
    fitCubic(X, Y, at, last, -cx, -cy, t2x, t2y, err2, lineTol, out, depth + 1);
  }
  /** Fits one piece between two breakpoints (corners or split points). */
  function fitPiece(PX, PY, t1, t2, s, out) {
    const last = PX.length - 1;
    if (last < 1) return;
    if (s.trace === 'polygons') {
      const idx = douglasPeucker(PX, PY, 0, last, s.simp);
      for (let j = 1; j < idx.length; j++) out.push(0, PX[idx[j]], PY[idx[j]]);
      return;
    }
    if (chordDeviation(PX, PY, 0, last) <= s.simp) { out.push(0, PX[last], PY[last]); return; }
    fitCubic(PX, PY, 0, last, t1[0], t1[1], t2[0], t2[1], s.tol * s.tol, Math.min(s.simp, s.tol) * 0.35, out, 0);
  }
  /**
   * Turns a polyline (closed loop or open chain) into path data: [x0, y0, code, …] with code 0 = line (x y) and
   * code 1 = cubic (x1 y1 x2 y2 x y). `snap(i)` may move a corner sample to a better position.
   */
  function fitPolyline(X, Y, closed, s, snap) {
    const n = X.length, out = [];
    const k = n >= 32 ? 3 : n >= 14 ? 2 : 1;
    let corners = s.corner >= 180 || n < 3 ? [] : detectCorners(X, Y, closed, k, (s.corner * Math.PI) / 180);
    const tangentAt = (i) => {
      const a = closed ? (i - k + n) % n : Math.max(0, i - k), b = closed ? (i + k) % n : Math.min(n - 1, i + k);
      return unit(X[b] - X[a], Y[b] - Y[a]);
    };
    let breaks, smoothJoin;
    if (!closed) { breaks = [0, ...corners.filter((c) => c > 0 && c < n - 1), n - 1]; smoothJoin = false; }
    else if (corners.length) { breaks = corners; smoothJoin = false; }
    else { breaks = n >= 16 ? [0, n >> 2, n >> 1, (3 * n) >> 2] : n >= 4 ? [0, n >> 1] : [0]; smoothJoin = true; }
    const pos = new Map();
    if (snap && !smoothJoin) for (const c of breaks) pos.set(c, snap(c));
    // light Laplacian smoothing ([1 2 1] / 4, twice) of the samples between corners: removes the residual
    // half-pixel zigzag of digital edges so that the curve fit needs far fewer nodes (shrinkage < 0.02 px)
    if (s.trace !== 'pixels' && n >= 5) {
      const fixed = new Uint8Array(n);
      if (!smoothJoin) for (const c of breaks) fixed[c] = 1;
      if (!closed) fixed[0] = fixed[n - 1] = 1;
      let A = X, Bv = Y;
      for (let it = 0; it < 2; it++) {
        const NX = new Float64Array(n), NY = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          if (fixed[i]) { NX[i] = A[i]; NY[i] = Bv[i]; continue; }
          const a = (i - 1 + n) % n, b = (i + 1) % n;
          NX[i] = 0.25 * A[a] + 0.5 * A[i] + 0.25 * A[b]; NY[i] = 0.25 * Bv[a] + 0.5 * Bv[i] + 0.25 * Bv[b];
        }
        A = NX; Bv = NY;
      }
      X = A; Y = Bv;
    }
    const P = (i) => pos.get(i) || [X[i], Y[i]];
    const start = P(breaks[0]);
    const d = [start[0], start[1]];
    const nb = closed ? breaks.length : breaks.length - 1;
    for (let j = 0; j < nb; j++) {
      const a = breaks[j], b = closed ? breaks[(j + 1) % breaks.length] : breaks[j + 1];
      let len = closed ? ((b - a + n) % n) + 1 : b - a + 1;
      if (closed && breaks.length === 1) len = n + 1;
      const PX = new Float64Array(len), PY = new Float64Array(len);
      for (let i = 0; i < len; i++) { const q = (a + i) % n; PX[i] = X[q]; PY[i] = Y[q]; }
      const pa = P(a), pb = P(b);
      PX[0] = pa[0]; PY[0] = pa[1]; PX[len - 1] = pb[0]; PY[len - 1] = pb[1];
      const m = Math.min(k, len - 1);
      let t1, t2;
      if (smoothJoin) { t1 = tangentAt(a); const tb = tangentAt(b); t2 = [-tb[0], -tb[1]]; }
      else { t1 = unit(PX[m] - PX[0], PY[m] - PY[0]); t2 = unit(PX[len - 1 - m] - PX[len - 1], PY[len - 1 - m] - PY[len - 1]); }
      fitPiece(PX, PY, t1, t2, s, out);
    }
    for (let i = 0; i < out.length; i++) d.push(out[i]);
    // drop a final line that only returns to the start (Z closes it)
    if (closed && d.length >= 5 && d[d.length - 3] === 0 && Math.abs(d[d.length - 2] - d[0]) < 1e-9 && Math.abs(d[d.length - 1] - d[1]) < 1e-9) d.length -= 3;
    return d;
  }
  /** Fits a traced pixel-edge loop. */
  function fitLoop(loop, s) {
    const dirs = loop.dirs, n = dirs.length;
    const PXs = new Int32Array(n), PYs = new Int32Array(n);
    let x = loop.sx, y = loop.sy;
    for (let i = 0; i < n; i++) { PXs[i] = x; PYs[i] = y; x += DX[dirs[i]]; y += DY[dirs[i]]; }
    if (s.trace === 'pixels' || n < 8) {
      // exact pixel outline: keep only turning vertices
      const d = [];
      for (let i = 0; i < n; i++) if (dirs[i] !== dirs[(i - 1 + n) % n]) { if (!d.length) d.push(PXs[i], PYs[i]); else d.push(0, PXs[i], PYs[i]); }
      return d;
    }
    // midpoints of the unit edges: removes the 90° staircase while keeping corners within half a pixel
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = PXs[i] + DX[dirs[i]] * 0.5; Y[i] = PYs[i] + DY[dirs[i]] * 0.5; }
    const k = n >= 32 ? 3 : n >= 14 ? 2 : 1;
    const snap = (i) => {
      // a corner found at an edge midpoint is moved to whichever end of that edge sticks out more
      const a = (i - k + n) % n, c = (i + k) % n, dx = X[c] - X[a], dy = Y[c] - Y[a], L = Math.hypot(dx, dy) || 1;
      const j = (i + 1) % n;
      const e1 = Math.abs((PXs[i] - X[a]) * dy - (PYs[i] - Y[a]) * dx) / L, e2 = Math.abs((PXs[j] - X[a]) * dy - (PYs[j] - Y[a]) * dx) / L;
      return e2 >= e1 ? [PXs[j], PYs[j]] : [PXs[i], PYs[i]];
    };
    return fitPolyline(X, Y, true, s, snap);
  }
  const countNodes = (d) => { let c = 1; for (let i = 2; i < d.length; i += d[i] === 0 ? 3 : 7) c++; return c; };

  /* ================================================================== 7. centreline */
  const OFF8 = (W) => [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1]; // N NE E SE S SW W NW
  // number of 8-connected groups formed by the set neighbours of a pixel, for each of the 256 patterns
  const NB_GROUPS = (() => {
    const t = new Uint8Array(256), pos = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (let m = 0; m < 256; m++) {
      const par = [0, 1, 2, 3, 4, 5, 6, 7], f = (a) => (par[a] === a ? a : (par[a] = f(par[a])));
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++)
        if ((m >> i) & 1 && (m >> j) & 1 && Math.max(Math.abs(pos[i][0] - pos[j][0]), Math.abs(pos[i][1] - pos[j][1])) === 1) par[f(i)] = f(j);
      const g = new Set();
      for (let i = 0; i < 8; i++) if ((m >> i) & 1) g.add(f(i));
      t[m] = g.size;
    }
    return t;
  })();
  /** Zhang–Suen thinning on a padded mask (in place). */
  function thin(m, W, H) {
    const del = [];
    for (let changed = true, guard = 0; changed && guard < 500; guard++) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        del.length = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1, p = y * W + 1; x < W - 1; x++, p++) {
          if (!m[p]) continue;
          const p2 = m[p - W], p3 = m[p - W + 1], p4 = m[p + 1], p5 = m[p + W + 1], p6 = m[p + W], p7 = m[p + W - 1], p8 = m[p - 1], p9 = m[p - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(p);
        }
        for (const p of del) m[p] = 0;
        if (del.length) changed = true;
      }
    }
    // remove staircase pixels (an L of 4-neighbours) when that keeps the neighbourhood connected
    const O = OFF8(W);
    for (let p = W; p < W * (H - 1); p++) {
      if (!m[p]) continue;
      let pat = 0, cnt = 0;
      for (let k = 0; k < 8; k++) if (m[p + O[k]]) { pat |= 1 << k; cnt++; }
      if (cnt < 2 || NB_GROUPS[pat] !== 1) continue;
      const N = pat & 1, E = pat & 4, S = pat & 16, Wd = pat & 64;
      if ((N && E) || (E && S) || (S && Wd) || (Wd && N)) m[p] = 0;
    }
    return m;
  }
  /** Centreline of a mask → { chains: [{ d, closed }], strokeWidth }. */
  function centreline(mask, w, h, s) {
    const W = w + 2, H = h + 2, m = new Uint8Array(W * H);
    let area = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { m[(y + 1) * W + x + 1] = 1; area++; }
    thin(m, W, H);
    const O = OFF8(W), deg = new Uint8Array(W * H), vis = new Uint8Array(W * H);
    let skel = 0;
    for (let p = W; p < W * (H - 1); p++) if (m[p]) { skel++; let c = 0; for (let k = 0; k < 8; k++) c += m[p + O[k]]; deg[p] = c; }
    const sw = s.strokeWidth > 0 ? s.strokeWidth : Math.max(1, Math.round((area / Math.max(1, skel)) * 10) / 10);
    const walk = (p, dir) => {
      const pts = [p];
      let cur = p, d = dir;
      for (let guard = 0; guard < W * H; guard++) {
        vis[cur] |= 1 << d;
        const nx = cur + O[d];
        vis[nx] |= 1 << ((d + 4) & 7);
        pts.push(nx);
        if (deg[nx] !== 2 || nx === p) break;
        let nd = -1;
        for (let k = 0; k < 8; k++) if (m[nx + O[k]] && !((vis[nx] >> k) & 1)) { nd = k; break; }
        if (nd < 0) break;
        cur = nx; d = nd;
      }
      return pts;
    };
    const raw = [];
    for (let p = W; p < W * (H - 1); p++) {
      if (!m[p]) continue;
      if (deg[p] === 0) { raw.push([p]); continue; }
      if (deg[p] === 2) continue;
      for (let k = 0; k < 8; k++) if (m[p + O[k]] && !((vis[p] >> k) & 1)) raw.push(walk(p, k));
    }
    for (let p = W; p < W * (H - 1); p++) {
      if (!m[p] || deg[p] !== 2) continue;
      for (let k = 0; k < 8; k++) if (m[p + O[k]] && !((vis[p] >> k) & 1)) raw.push(walk(p, k));
    }
    const spur = Math.max(3, sw * 1.2), chains = [];
    for (const c of raw) {
      const a = deg[c[0]], b = deg[c[c.length - 1]], closed = c.length > 2 && c[0] === c[c.length - 1];
      if (!closed && ((a === 1 && b >= 3) || (b === 1 && a >= 3)) && c.length < spur) continue; // spur
      if (!closed && a >= 3 && b >= 3 && c.length <= 2) continue; // link inside a junction cluster
      const pts = closed ? c.slice(0, -1) : c;
      const X = new Float64Array(pts.length), Y = new Float64Array(pts.length);
      pts.forEach((p, i) => { X[i] = (p % W) - 0.5; Y[i] = Math.floor(p / W) - 0.5; });
      if (pts.length === 1) { chains.push({ d: [X[0] - 0.25, Y[0], 0, X[0] + 0.25, Y[0]], closed: false }); continue; }
      chains.push({ d: fitPolyline(X, Y, closed, s.trace === 'center' ? { ...s, trace: 'curves' } : s, null), closed });
    }
    return { chains, strokeWidth: sw };
  }

  /* ================================================================== main entry */
  /**
   * Full pipeline. img = { width, height, data (RGBA) }, s = normalised settings (see settings.js),
   * progress(fraction, stage) is called from time to time.
   * Returns { w, h, palette: [{hex, count, bg}], layers (bottom → top), labels, threshold, stats }.
   */
  function trace(img, s, progress) {
    const t0 = now(), w = img.width, h = img.height, n = w * h;
    const prog = progress || (() => {});
    prog(0.02, 'pre');
    const d = preprocess(img.data, w, h, s);
    prog(0.12, 'quant');
    const q = quantize(d, w, h, s);
    prog(0.3, 'speckle');
    despeckle(q.labels, w, h, s.speckle);
    // compact the palette (drop unused entries), count pixels and border pixels
    const K0 = q.palette.length, cnt = new Float64Array(K0), border = new Float64Array(K0);
    for (let p = 0; p < n; p++) { const L = q.labels[p]; if (L !== TRANSPARENT) cnt[L]++; }
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const L = q.labels[y * w + x]; if (L !== TRANSPARENT) border[L]++; }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const L = q.labels[y * w + x]; if (L !== TRANSPARENT) border[L]++; }
    const remap = new Uint8Array(256).fill(TRANSPARENT), pal = [];
    for (let i = 0; i < K0; i++) if (cnt[i] > 0) { remap[i] = pal.length; pal.push({ rgb: q.palette[i], count: cnt[i], border: border[i] }); }
    for (let p = 0; p < n; p++) q.labels[p] = remap[q.labels[p]];
    const K = pal.length;
    // background = colour touching the image border most
    let bg = -1;
    pal.forEach((c, i) => { if (bg < 0 || c.border > pal[bg].border) bg = i; });
    if (bg >= 0 && pal[bg].border === 0) bg = -1;
    const centre = s.trace === 'center', dropBg = (s.removeBg || centre) && bg >= 0 && K > 1;
    // stacking order: biggest areas at the bottom; a removed background always goes to the very bottom
    const order = pal.map((c, i) => i).sort((a, b) => pal[b].count - pal[a].count || a - b);
    if (dropBg) { order.splice(order.indexOf(bg), 1); order.unshift(bg); }
    const rank = new Int16Array(256).fill(-1);
    order.forEach((L, r) => (rank[L] = r));
    const layers = [], mask = new Uint8Array(n);
    let paths = 0, nodes = 0;
    const stack = s.layering !== 'cut' && !centre;
    order.forEach((L, r) => {
      const hex = rgbToHex(pal[L].rgb);
      if (dropBg && L === bg) { prog(0.35 + (0.63 * (r + 1)) / K, 'trace'); return; }
      for (let p = 0; p < n; p++) { const lp = q.labels[p]; mask[p] = lp !== TRANSPARENT && (stack ? rank[lp] >= r : lp === L) ? 1 : 0; }
      const layer = { hex, index: L, kind: centre ? 'center' : s.style === 'stroke' ? 'stroke' : 'fill', strokeWidth: 0, paths: [] };
      if (centre) {
        const cl = centreline(mask, w, h, s);
        layer.strokeWidth = cl.strokeWidth;
        for (const c of cl.chains) { const nn = countNodes(c.d); layer.paths.push({ loops: [c], nodes: nn }); nodes += nn; }
      } else {
        const cc = components(mask, w, h), loops = traceLoops(mask, w, h, cc.comp), groups = new Map();
        for (const lp of loops) {
          if (!groups.has(lp.comp)) groups.set(lp.comp, []);
          const g = groups.get(lp.comp);
          if (lp.area > 0) g.unshift(lp); else g.push(lp); // outline first, then its holes
        }
        for (const g of groups.values()) {
          let nn = 0;
          const fitted = g.map((lp) => { const dd = fitLoop(lp, s); nn += countNodes(dd); return { d: dd, closed: true }; });
          layer.paths.push({ loops: fitted, nodes: nn }); nodes += nn;
        }
        layer.strokeWidth = s.strokeWidth > 0 ? s.strokeWidth : 1;
      }
      paths += layer.paths.length;
      layers.push(layer);
      prog(0.35 + (0.63 * (r + 1)) / K, 'trace');
    });
    prog(1, 'done');
    return {
      w, h, labels: q.labels, threshold: q.threshold,
      palette: pal.map((c, i) => ({ hex: rgbToHex(c.rgb), count: c.count, bg: i === bg, removed: dropBg && i === bg })),
      layers, stats: { paths, nodes, colors: K, ms: Math.round(now() - t0) },
    };
  }

  /* ================================================================== 8. SVG writer */
  function fmt(v, dec) {
    let t = dec > 0 ? v.toFixed(dec) : String(Math.round(v));
    if (dec > 0 && t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, '');
    if (t === '-0') t = '0';
    return t.replace(/^(-?)0\./, '$1.');
  }
  /** Path data for a list of loops [{ d, closed }], rounded to `dec` decimals, relative commands. */
  function pathData(loops, dec) {
    const f = Math.pow(10, dec), R = (v) => Math.round(v * f) / f;
    const parts = [];
    for (const lp of loops) {
      const d = lp.d;
      if (!d || d.length < 2) continue;
      let cx = R(d[0]), cy = R(d[1]), last = 'M', s = 'M' + fmt(cx, dec) + (cy < 0 ? '' : ' ') + fmt(cy, dec);
      const add = (cmd, nums) => {
        let piece = '';
        for (const v of nums) { const t = fmt(v, dec); piece += (piece && t[0] !== '-' ? ' ' : '') + t; }
        if (cmd === last) s += (piece[0] === '-' ? '' : ' ') + piece;
        else s += cmd + piece;
        last = cmd;
      };
      for (let i = 2; i < d.length;) {
        if (d[i] === 0) {
          const x = R(d[i + 1]), y = R(d[i + 2]), dx = R(x - cx), dy = R(y - cy);
          i += 3;
          if (!dx && !dy) continue;
          if (!dy) add('h', [dx]); else if (!dx) add('v', [dy]); else add('l', [dx, dy]);
          cx = x; cy = y;
        } else {
          const v = [d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6]].map(R);
          i += 7;
          if (v[4] === cx && v[5] === cy && v[0] === cx && v[1] === cy && v[2] === cx && v[3] === cy) continue;
          add('c', [R(v[0] - cx), R(v[1] - cy), R(v[2] - cx), R(v[3] - cy), R(v[4] - cx), R(v[5] - cy)]);
          cx = v[4]; cy = v[5];
        }
      }
      if (lp.closed) s += 'z';
      parts.push(s);
    }
    return parts.join('');
  }
  const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  /**
   * SVG document. opts: { layered, dec, hidden (Set of hex), recolor ({hex: hex}), width, height }.
   * layered → one <g> per colour (id + Inkscape layer label, read as layers by Illustrator / Inkscape) with one
   * <path> per shape; otherwise one compound <path> per colour (smallest file).
   */
  function buildSVG(res, opts) {
    const o = opts || {}, dec = o.dec == null ? 2 : o.dec, hidden = o.hidden || new Set(), rec = o.recolor || {};
    const W = o.width || res.w, H = o.height || res.h, layered = !!o.layered;
    const head = `<svg xmlns="http://www.w3.org/2000/svg"${layered ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' : ''} width="${fmt(W, 2)}" height="${fmt(H, 2)}" viewBox="0 0 ${res.w} ${res.h}" fill-rule="evenodd">`;
    const out = [head];
    if (layered) out.push('<title>Vecteur Atelier</title>');
    const used = new Set();
    for (const L of res.layers) {
      if (hidden.has(L.hex)) continue;
      const col = /^#[0-9a-f]{6}$/i.test(rec[L.hex] || '') ? rec[L.hex].toLowerCase() : L.hex;
      const sw = fmt(L.strokeWidth || 1, 2);
      const paint = L.kind === 'fill' ? `fill="${col}"` : `fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
      if (!L.paths.length) continue;
      if (layered) {
        let id = 'hex-' + col.slice(1).toUpperCase(), k = 2;
        while (used.has(id)) id = 'hex-' + col.slice(1).toUpperCase() + '-' + k++;
        used.add(id);
        out.push(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${esc(col.toUpperCase())}" ${paint}>`);
        for (const p of L.paths) { const dd = pathData(p.loops, dec); if (dd) out.push(`<path d="${dd}"/>`); }
        out.push('</g>');
      } else {
        const all = [];
        for (const p of L.paths) for (const lp of p.loops) all.push(lp);
        const dd = pathData(all, dec);
        if (dd) out.push(`<path ${paint} d="${dd}"/>`);
      }
    }
    out.push('</svg>');
    return out.join(layered ? '\n' : '');
  }

  return {
    TRANSPARENT, trace, preprocess, quantize, cleanAntialias, colourBins, despeckle, components, traceLoops, fitLoop, fitPolyline, detectCorners,
    douglasPeucker, centreline, thin, otsu, kmeans, medianCut, mergeSimilar, pathData, buildSVG, fmt, countNodes,
    rgbToHex, hexToRgb, rgbToLab, deltaE, luma, prng, _factory: vtraceFactory,
  };
});
