/* settings.js — Vecteur Atelier: default settings, ranges, presets, validation and URL-hash (#…) encoding.
 * Original code, MIT licence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VSET = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // key: [short hash key, default, kind, min|choices, max, step]
  const SPEC = {
    mode: ['m', 'color', 'enum', ['bw', 'color', 'grey']],
    threshold: ['t', 128, 'int', 1, 254],
    otsu: ['ot', true, 'bool'],
    invert: ['iv', false, 'bool'],
    colors: ['n', 8, 'int', 2, 32],
    quant: ['q', 'kmeans', 'enum', ['kmeans', 'median']],
    merge: ['mg', 6, 'num', 0, 40],
    antialias: ['aa', true, 'bool'],
    levels: ['lv', 4, 'int', 2, 16],
    maxSize: ['sz', 1000, 'int', 64, 4000],
    contrast: ['ct', 0, 'int', -50, 100],
    blur: ['bl', 0, 'int', 0, 6],
    denoise: ['dn', false, 'bool'],
    speckle: ['sp', 8, 'int', 0, 2000],
    trace: ['tr', 'curves', 'enum', ['curves', 'polygons', 'pixels', 'center']],
    corner: ['cn', 60, 'int', 0, 180],
    tol: ['tl', 1, 'num', 0.1, 8],
    simp: ['sm', 0.8, 'num', 0.1, 8],
    layering: ['ly', 'stack', 'enum', ['stack', 'cut']],
    style: ['st', 'fill', 'enum', ['fill', 'stroke']],
    strokeWidth: ['sw', 0, 'num', 0, 40],
    removeBg: ['bg', false, 'bool'],
    dec: ['dc', 2, 'int', 0, 3],
    lock: ['lk', false, 'bool'],
    palette: ['pal', [], 'hexlist'],
    hidden: ['hid', [], 'hexlist'],
    recolor: ['rec', {}, 'hexmap'],
  };
  const DEFAULTS = {};
  for (const k in SPEC) DEFAULTS[k] = clone(SPEC[k][1]);
  function clone(v) { return Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? { ...v } : v; }
  const HEX = /^#[0-9a-f]{6}$/;
  const normHex = (h) => { const t = String(h || '').trim().toLowerCase().replace(/^#?/, '#'); return HEX.test(t) ? t : null; };

  /** Validated copy: unknown keys dropped, numbers clamped, enums checked, missing values from DEFAULTS. */
  function normalize(src) {
    const o = {}, s = src || {};
    for (const k in SPEC) {
      const [, def, kind, a, b] = SPEC[k];
      let v = s[k];
      if (kind === 'enum') o[k] = a.includes(v) ? v : def;
      else if (kind === 'bool') o[k] = v === true || v === 1 || v === '1' || v === 'true' ? true : v === false || v === 0 || v === '0' || v === 'false' ? false : def;
      else if (kind === 'int' || kind === 'num') {
        v = Number(v);
        if (!Number.isFinite(v)) v = def;
        v = Math.min(b, Math.max(a, v));
        o[k] = kind === 'int' ? Math.round(v) : Math.round(v * 100) / 100;
      } else if (kind === 'hexlist') o[k] = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[.,\s]+/) : []).map(normHex).filter(Boolean).slice(0, 64);
      else if (kind === 'hexmap') {
        const m = {};
        if (v && typeof v === 'object') for (const h in v) { const a1 = normHex(h), b1 = normHex(v[h]); if (a1 && b1) m[a1] = b1; }
        o[k] = m;
      }
    }
    return o;
  }

  /** Presets: each one only sets the values listed (the rest keeps the current value). */
  const PRESETS = {
    logo: { mode: 'color', antialias: true, colors: 6, quant: 'kmeans', merge: 10, contrast: 0, blur: 0, denoise: false, speckle: 12, trace: 'curves', corner: 55, tol: 0.8, simp: 0.6, layering: 'stack', style: 'fill', removeBg: false, lock: false, maxSize: 1000 },
    lineart: { mode: 'bw', otsu: true, invert: false, contrast: 10, blur: 1, denoise: false, speckle: 16, trace: 'curves', corner: 70, tol: 1, simp: 0.8, layering: 'stack', style: 'fill', removeBg: true, maxSize: 1600 },
    illustration: { mode: 'color', antialias: true, colors: 16, quant: 'kmeans', merge: 5, contrast: 0, blur: 1, denoise: false, speckle: 20, trace: 'curves', corner: 75, tol: 1.2, simp: 1, layering: 'stack', style: 'fill', removeBg: false, lock: false, maxSize: 1200 },
    poster: { mode: 'color', antialias: true, colors: 12, quant: 'kmeans', merge: 6, contrast: 10, blur: 2, denoise: true, speckle: 40, trace: 'curves', corner: 95, tol: 1.6, simp: 1.2, layering: 'stack', style: 'fill', removeBg: false, lock: false, maxSize: 900 },
    pixel: { mode: 'color', antialias: false, colors: 32, quant: 'median', merge: 0, contrast: 0, blur: 0, denoise: false, speckle: 0, trace: 'pixels', layering: 'stack', style: 'fill', removeBg: false, lock: false, maxSize: 4000, dec: 0 },
    sketch: { mode: 'bw', otsu: true, invert: false, contrast: 30, blur: 1, denoise: true, speckle: 30, trace: 'center', corner: 80, tol: 1.4, simp: 1, strokeWidth: 0, removeBg: true, maxSize: 1200 },
  };
  function applyPreset(cur, name) {
    const p = PRESETS[name];
    return p ? normalize({ ...cur, ...p, hidden: [], recolor: {}, palette: [] }) : normalize(cur);
  }

  /** Settings → hash string (only values that differ from the defaults), plus extra pairs such as the language. */
  function toHash(s, extra) {
    const n = normalize(s), parts = [];
    for (const k in SPEC) {
      const [key, def, kind] = SPEC[k], v = n[k];
      if (kind === 'hexlist') { if (v.length) parts.push(key + '=' + v.map((h) => h.slice(1)).join('.')); continue; }
      if (kind === 'hexmap') { const e = Object.entries(v); if (e.length) parts.push(key + '=' + e.map(([a, b]) => a.slice(1) + '-' + b.slice(1)).join('.')); continue; }
      if (v === def) continue;
      parts.push(key + '=' + (kind === 'bool' ? (v ? 1 : 0) : v));
    }
    for (const k in extra || {}) if (extra[k] != null) parts.push(k + '=' + encodeURIComponent(extra[k]));
    return parts.join('&');
  }
  /** Hash string → { settings, extra } (unknown pairs go to extra). */
  function fromHash(hash) {
    const raw = {}, extra = {}, byKey = {};
    for (const k in SPEC) byKey[SPEC[k][0]] = k;
    String(hash || '').replace(/^#/, '').split('&').forEach((pair) => {
      if (!pair) return;
      const i = pair.indexOf('='), key = i < 0 ? pair : pair.slice(0, i);
      let val = i < 0 ? '' : pair.slice(i + 1);
      try { val = decodeURIComponent(val); } catch (e) { /* keep raw */ }
      const name = byKey[key];
      if (!name) { extra[key] = val; return; }
      if (SPEC[name][2] === 'hexmap') {
        const m = {};
        val.split('.').forEach((e) => { const [a, b] = e.split('-'); if (a && b) m['#' + a] = '#' + b; });
        raw[name] = m;
      } else raw[name] = val;
    });
    return { settings: normalize(raw), extra };
  }
  return { SPEC, DEFAULTS, PRESETS, normalize, applyPreset, toHash, fromHash };
});
