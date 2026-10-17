/* demo.js — Vecteur Atelier: original demo images drawn procedurally on a canvas (nothing copyrighted).
 * logo   → flat-colour emblem with text, ring (holes), star, waves, dots, a soft gradient sun;
 * sketch → pencil-like line drawing on grainy paper (for the centreline and clean-up tools).
 * Original code, MIT licence. */
(function (root) {
  'use strict';
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function star(ctx, cx, cy, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath();
  }
  /** Stylised Amazigh "yaz" (ⵣ) drawn with strokes, so it does not depend on installed fonts. */
  function yaz(ctx, cx, cy, s, color, lw) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.62, cy - s * 0.95); ctx.quadraticCurveTo(cx - s * 0.62, cy - s * 0.35, cx, cy - s * 0.35); ctx.quadraticCurveTo(cx + s * 0.62, cy - s * 0.35, cx + s * 0.62, cy - s * 0.95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.62, cy + s * 0.95); ctx.quadraticCurveTo(cx - s * 0.62, cy + s * 0.35, cx, cy + s * 0.35); ctx.quadraticCurveTo(cx + s * 0.62, cy + s * 0.35, cx + s * 0.62, cy + s * 0.95); ctx.stroke();
    ctx.restore();
  }
  function logo(canvas) {
    const W = 960, H = 640; canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    c.fillStyle = '#f4efe4'; c.fillRect(0, 0, W, H);
    // emblem
    c.fillStyle = '#0f5c63'; c.beginPath(); c.arc(250, 300, 200, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8a33d'; c.lineWidth = 16; c.beginPath(); c.arc(250, 300, 172, 0, Math.PI * 2); c.stroke();
    const g = c.createRadialGradient(300, 215, 8, 300, 225, 62); g.addColorStop(0, '#ffd27a'); g.addColorStop(1, '#e8a33d');
    c.fillStyle = g; c.beginPath(); c.arc(300, 225, 58, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(250, 300, 162, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#c8553d'; c.beginPath(); c.moveTo(70, 420); c.lineTo(190, 250); c.lineTo(250, 330); c.lineTo(320, 230); c.lineTo(450, 420); c.closePath(); c.fill();
    c.fillStyle = '#f4efe4'; c.beginPath(); c.moveTo(190, 250); c.lineTo(222, 296); c.lineTo(205, 290); c.lineTo(188, 304); c.lineTo(168, 282); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(320, 230); c.lineTo(356, 282); c.lineTo(336, 276); c.lineTo(318, 292); c.lineTo(300, 270); c.lineTo(287, 278); c.closePath(); c.fill();
    c.strokeStyle = '#f4efe4'; c.lineWidth = 9; c.lineCap = 'round';
    for (let k = 0; k < 3; k++) { c.beginPath(); for (let x = 80; x <= 420; x += 4) c.lineTo(x, 438 + k * 26 + 7 * Math.sin(x / 22 + k)); c.stroke(); }
    c.restore();
    // title
    c.fillStyle = '#1d2a3a'; c.font = '800 104px system-ui, "Segoe UI", Roboto, Arial, sans-serif'; c.textBaseline = 'alphabetic';
    c.fillText('VECTEUR', 480, 275);
    c.fillStyle = '#c8553d'; c.font = '700 64px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
    c.fillText('atelier', 486, 350);
    yaz(c, 850, 323, 34, '#0f5c63', 11);
    // stars and dots
    c.fillStyle = '#e8a33d'; star(c, 560, 470, 44, 18, 8, -Math.PI / 2); c.fill();
    c.fillStyle = '#0f5c63'; star(c, 680, 470, 40, 22, 5, -Math.PI / 2); c.fill();
    c.strokeStyle = '#1d2a3a'; c.lineWidth = 10; c.beginPath(); c.arc(800, 470, 34, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#1d2a3a'; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(500 + i * 42, 560, 4 + i * 1.2, 0, Math.PI * 2); c.fill(); }
    c.fillRect(480, 380, 400, 8);
    return canvas;
  }
  function sketch(canvas) {
    const W = 900, H = 640; canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d'), R = rng(42);
    c.fillStyle = '#f7f4ec'; c.fillRect(0, 0, W, H);
    // paper grain + specks (removed by denoise / despeckle)
    const im = c.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = (R() - 0.5) * 18; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
    c.putImageData(im, 0, 0);
    c.fillStyle = '#3a3a3a'; for (let i = 0; i < 70; i++) { c.beginPath(); c.arc(R() * W, R() * H, 0.6 + R() * 1.4, 0, Math.PI * 2); c.fill(); }
    const ink = '#2b2b2e';
    c.strokeStyle = ink; c.lineCap = 'round'; c.lineJoin = 'round';
    const wob = (pts, lw) => { c.lineWidth = lw; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x + (R() - 0.5) * 1.2, y + (R() - 0.5) * 1.2) : c.moveTo(x, y))); c.stroke(); };
    // spiral
    const sp = []; for (let a = 0; a < Math.PI * 7; a += 0.08) sp.push([190 + a * 6.5 * Math.cos(a), 200 + a * 6.5 * Math.sin(a)]); wob(sp, 6);
    // star outline
    const st = []; for (let i = 0; i <= 10; i++) { const r = i % 2 ? 48 : 110, a = -Math.PI / 2 + (i * Math.PI) / 5; st.push([470 + r * Math.cos(a), 205 + r * Math.sin(a)]); } wob(st, 7);
    // flower
    for (let k = 0; k < 6; k++) { c.save(); c.translate(720, 210); c.rotate((k * Math.PI) / 3); c.lineWidth = 6; c.beginPath(); c.ellipse(0, -58, 26, 52, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }
    c.lineWidth = 6; c.beginPath(); c.arc(720, 210, 20, 0, Math.PI * 2); c.stroke();
    wob([[720, 320], [712, 400], [722, 480], [716, 560]], 6);
    wob([[716, 470], [680, 440], [650, 452]], 5);
    // little house
    wob([[110, 560], [110, 430], [200, 360], [290, 430], [290, 560], [110, 560]], 7);
    wob([[170, 560], [170, 490], [220, 490], [220, 560]], 6);
    // waves and a word
    for (let k = 0; k < 3; k++) { const p = []; for (let x = 360; x <= 610; x += 6) p.push([x, 420 + k * 34 + 10 * Math.sin(x / 18 + k)]); wob(p, 5); }
    c.fillStyle = ink; c.font = 'italic 600 54px Georgia, "Times New Roman", serif'; c.fillText('azul', 410, 590);
    return canvas;
  }
  root.VDEMO = { logo, sketch };
})(typeof self !== 'undefined' ? self : this);
