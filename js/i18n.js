/* i18n.js — Vecteur Atelier interface texts: French (default), English, Taqbaylit (Kabyle, Latin script) with
 * optional Tifinagh rendering of the Kabyle texts. Each entry is [fr, en, kab]; placeholders look like {n}.
 * The Kabyle texts are a first draft — corrections are welcome. Original texts, MIT licence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const S = {
    skip: ['Aller à l’aperçu', 'Skip to the preview', 'Ddu ɣer teskant'],
    tagline: ['Vectoriser une image (PNG, JPG → SVG) — tout reste sur votre appareil', 'Turn an image into vectors (PNG, JPG → SVG) — everything stays on your device', 'Sselkem tugna ɣer yivikturen (PNG, JPG → SVG) — kullec yeqqim ɣur-k'],
    language: ['Langue', 'Language', 'Tutlayt'],
    tifinagh: ['Tifinagh', 'Tifinagh', 'S tifinaɣ'],
    uiTheme: ['Thème clair / sombre', 'Light / dark theme', 'Asentel aceɛlal / aberkan'],
    help: ['Aide', 'Help', 'Tallalt'],
    close: ['Fermer', 'Close', 'Mdel'],
    preview: ['Aperçu', 'Preview', 'Taskant'],
    settings: ['Réglages', 'Settings', 'Iɣewwaren'],
    viewMode: ['Affichage', 'View', 'Askan'],
    vSplit: ['Curseur', 'Split', 'Afeggag'],
    vSide: ['Côte à côte', 'Side by side', 'Tama ɣer tama'],
    vVector: ['Vecteur', 'Vector', 'Avikṭur'],
    vOriginal: ['Original', 'Original', 'Aɣbalu'],
    cmpQuant: ['Image réduite', 'Reduced image', 'Tugna yettwasemzin'],
    outlines: ['Contours', 'Outlines', 'Iziraren'],
    nodes: ['Nœuds', 'Nodes', 'Tikerrisin'],
    zoomIn: ['Zoom avant', 'Zoom in', 'Semɣer'],
    zoomOut: ['Zoom arrière', 'Zoom out', 'Semẓi'],
    fit: ['Ajuster', 'Fit', 'Serreg'],
    viewerLabel: ['Aperçu : molette = zoom, glisser = déplacer, + − 0 1 au clavier', 'Preview: wheel = zoom, drag = pan, + − 0 1 on the keyboard', 'Taskant: taṛuṭ = asemɣer, zuɣer = senkez, + − 0 1 s unasiw'],
    splitLabel: ['Position du curseur de comparaison', 'Comparison split position', 'Adeg n ufeggag n userwes'],
    tagOriginal: ['Original', 'Original', 'Aɣbalu'],
    tagVector: ['Vecteur', 'Vector', 'Avikṭur'],
    dropHere: ['Déposez l’image ici', 'Drop the image here', 'Sers tugna dagi'],
    cancel: ['Annuler', 'Cancel', 'Sefsex'],
    cancelled: ['Vectorisation annulée.', 'Tracing cancelled.', 'Asselkem yettwasefsex.'],
    stPaths: ['chemins', 'paths', 'iberdan'],
    stNodes: ['nœuds', 'nodes', 'tikerrisin'],
    stColors: ['couleurs', 'colours', 'initen'],
    stSize: ['SVG', 'SVG', 'SVG'],
    stTime: ['calcul', 'compute', 'asiḍen'],
    dims: ['source {w} × {h} px · tracé à {tw} × {th} px', 'source {w} × {h} px · traced at {tw} × {th} px', 'aɣbalu {w} × {h} px · yettwasselkem s {tw} × {th} px'],
    stage_pre: ['Pré-traitement…', 'Pre-processing…', 'Aheyyi…'],
    stage_quant: ['Réduction des couleurs…', 'Reducing colours…', 'Asemẓi n yiniten…'],
    stage_speckle: ['Nettoyage des taches…', 'Removing specks…', 'Asizdeg n yiḍebsiyen…'],
    stage_trace: ['Vectorisation…', 'Tracing…', 'Asselkem…'],
    stage_done: ['Terminé', 'Done', 'Yemmed'],
    traced: ['Vectorisation terminée : {p} chemins, {n} nœuds, {c} couleurs.', 'Tracing done: {p} paths, {n} nodes, {c} colours.', 'Asselkem yemmed: {p} iberdan, {n} tikerrisin, {c} initen.'],
    loadErr: ['Impossible de lire cette image.', 'This image could not be read.', 'Ur tettwaɣer ara tugna-agi.'],
    workerErr: ['Erreur pendant la vectorisation : {m}', 'Error while tracing: {m}', 'Tuccḍa deg usselkem: {m}'],
    noWorker: ['Web Worker indisponible : calcul sur la page (l’interface peut se figer).', 'Web Worker unavailable: computing on the page (the interface may freeze).', 'Web Worker ulac-it: asiḍen deg usebter.'],
    // source
    secSource: ['Image', 'Image', 'Tugna'],
    openImage: ['Ouvrir une image', 'Open an image', 'Ldi tugna'],
    demoLogo: ['Démo logo', 'Logo demo', 'Amedya n ulugu'],
    demoSketch: ['Démo croquis', 'Sketch demo', 'Amedya n usuneɣ'],
    dropHint: ['PNG, JPG, WebP, GIF ou BMP — glissez-déposez ou collez (Ctrl+V) une image n’importe où.', 'PNG, JPG, WebP, GIF or BMP — drag and drop or paste (Ctrl+V) an image anywhere.', 'PNG, JPG, WebP, GIF neɣ BMP — zuɣer neɣ senṭeḍ (Ctrl+V) tugna anida tebɣiḍ.'],
    srcDemo: ['Démo : {name}', 'Demo: {name}', 'Amedya: {name}'],
    // presets
    secPresets: ['Préréglages', 'Presets', 'Iɣewwaren uheyyan'],
    pLogo: ['Logo', 'Logo', 'Alugu'],
    pLineart: ['Dessin au trait', 'Line art', 'Asuneɣ s yizirig'],
    pIllustration: ['Illustration', 'Illustration', 'Tugna n wudem'],
    pPoster: ['Photo → affiche', 'Photo → poster', 'Tawlaft → aɣmis'],
    pPixel: ['Pixel art', 'Pixel art', 'Taẓuri n pixel'],
    pSketch: ['Croquis / scan', 'Sketch / scan', 'Asuneɣ / asmiḍen'],
    presetApplied: ['Préréglage « {p} » appliqué.', 'Preset “{p}” applied.', 'Aɣewwar « {p} » yettwasnes.'],
    // mode
    secMode: ['Mode', 'Mode', 'Askar'],
    mBw: ['Noir & blanc', 'Black & white', 'Aberkan & amellal'],
    mColor: ['Couleurs', 'Colour', 'Initen'],
    mGrey: ['Gris', 'Greys', 'Amumad'],
    otsu: ['Seuil automatique (Otsu)', 'Automatic threshold (Otsu)', 'Talast tawurmant (Otsu)'],
    threshold: ['Seuil', 'Threshold', 'Talast'],
    colors: ['Nombre de couleurs', 'Number of colours', 'Amḍan n yiniten'],
    quant: ['Méthode', 'Method', 'Tarrayt'],
    kmeans: ['k-moyennes (k-means++)', 'k-means (k-means++)', 'k-means (k-means++)'],
    median: ['Coupe médiane', 'Median cut', 'Tagzemt talemmast'],
    merge: ['Fusionner les couleurs proches (ΔE)', 'Merge similar colours (ΔE)', 'Sdukkel initen yemqaraben (ΔE)'],
    antialias: ['Nettoyer l’anticrénelage des bords', 'Clean anti-aliased edges', 'Sizdeg iran n tugna'],
    levels: ['Niveaux de gris', 'Grey levels', 'Iswiren n umumad'],
    invert: ['Inverser', 'Invert', 'Tti'],
    removeBg: ['Supprimer le fond (couleur du bord)', 'Remove background (border colour)', 'Kkes agilal (ini n yiri)'],
    // pre
    secPre: ['Pré-traitement', 'Pre-processing', 'Aheyyi'],
    maxSize: ['Taille max. de calcul (px)', 'Max. working size (px)', 'Tiddi tafellayt n usiḍen (px)'],
    contrast: ['Contraste', 'Contrast', 'Amyezwer'],
    blur: ['Lissage (flou, rayon px)', 'Smoothing (blur radius px)', 'Asefsi (abrir, px)'],
    denoise: ['Débruitage (médian 3 × 3)', 'Denoise (3 × 3 median)', 'Kkes asxerxec (3 × 3)'],
    speckle: ['Supprimer les taches < N px', 'Remove specks < N px', 'Kkes iḍebsiyen < N px'],
    // trace
    secTrace: ['Tracé', 'Tracing', 'Asselkem'],
    traceType: ['Type de tracé', 'Trace type', 'Anaw n usselkem'],
    tCurves: ['Courbes de Bézier', 'Bézier curves', 'Izligen n Bézier'],
    tPolygons: ['Polygones', 'Polygons', 'Igetmuɣen'],
    tPixels: ['Pixels exacts', 'Exact pixels', 'Ipixelen s tidet'],
    tCenter: ['Ligne centrale (traits)', 'Centreline (strokes)', 'Izirig alemmas'],
    corner: ['Seuil des angles (°) — bas = plus d’angles vifs', 'Corner threshold (°) — low = more sharp corners', 'Talast n teɣmar (°)'],
    tol: ['Tolérance des courbes (px)', 'Curve tolerance (px)', 'Aseɣẓen n yizligen (px)'],
    simp: ['Simplification Douglas–Peucker (px)', 'Douglas–Peucker simplification (px)', 'Asishel Douglas–Peucker (px)'],
    layering: ['Superposition des couleurs', 'Colour layering', 'Asmezli n yiniten'],
    lStack: ['Empilées (aucun jour entre formes)', 'Stacked (no gaps between shapes)', 'Ttwasmezlin (ulac ilmawen)'],
    lCut: ['Découpées (sans chevauchement)', 'Cut out (no overlap)', 'Ttwagezmen (ulac anmegdal)'],
    style: ['Rendu', 'Rendering', 'Asekkem'],
    sFill: ['Formes pleines', 'Filled shapes', 'Talɣiwin yeččuren'],
    sStroke: ['Contours seuls', 'Outlines only', 'Iziraren kan'],
    strokeWidth: ['Épaisseur du trait (0 = auto)', 'Stroke width (0 = auto)', 'Tuzert n yizirig (0 = awurman)'],
    dec: ['Décimales du SVG', 'SVG decimals', 'Imeḍwan n SVG'],
    // palette
    secPalette: ['Palette', 'Palette', 'Tafelwit n yiniten'],
    paletteHint: ['Cliquez une pastille pour changer sa couleur ; l’œil masque le calque (en mode empilé, la couleur du dessous apparaît).', 'Click a swatch to change its colour; the eye hides the layer (in stacked mode the colour below shows through).', 'Sit ɣef yini akken ad t-tbeddleḍ; tiṭ tesnuffur akalku.'],
    lock: ['Verrouiller la palette (garder ces couleurs)', 'Lock the palette (keep these colours)', 'Sekkeṛ tafelwit (ḥrez initen-a)'],
    palReset: ['Réinitialiser', 'Reset', 'Ales awennez'],
    hideLayer: ['Masquer / afficher {c}', 'Hide / show {c}', 'Ffer / sken {c}'],
    editColor: ['Changer la couleur {c}', 'Change colour {c}', 'Beddel ini {c}'],
    bgTag: ['fond', 'background', 'agilal'],
    removedTag: ['supprimé', 'removed', 'yettwakkes'],
    // export
    secExport: ['Exporter', 'Export', 'Sifeḍ'],
    svgLayered: ['SVG en calques', 'Layered SVG', 'SVG s yikalkuyen'],
    svgOpt: ['SVG optimisé', 'Optimised SVG', 'SVG yettwasefsen'],
    copySvg: ['Copier le SVG', 'Copy SVG', 'Nɣel SVG'],
    pngScale: ['Échelle PNG', 'PNG scale', 'Taskala n PNG'],
    png: ['Exporter PNG', 'Export PNG', 'Sifeḍ PNG'],
    settingsJson: ['Réglages (JSON)', 'Settings (JSON)', 'Iɣewwaren (JSON)'],
    importJson: ['Importer des réglages', 'Import settings', 'Kter iɣewwaren'],
    copyLink: ['Copier le lien', 'Copy link', 'Nɣel aseɣwen'],
    resetAll: ['Tout réinitialiser', 'Reset all', 'Ales kullec'],
    exportHint: ['« En calques » : un groupe par couleur nommé par son code hexadécimal (calques dans Illustrator et Inkscape). « Optimisé » : un seul chemin composé par couleur, fichier le plus léger. Le lien contient les réglages, jamais l’image.', '“Layered”: one group per colour named by its hex code (layers in Illustrator and Inkscape). “Optimised”: a single compound path per colour, smallest file. The link holds the settings, never the image.', '« S yikalkuyen »: yiwet n terbaɛt i yal ini s tengalt-is hex. « Yettwasefsen »: yiwen n ubrid i yal ini. Aseɣwen yesɛa iɣewwaren kan, mačči tugna.'],
    copied: ['Copié dans le presse-papiers.', 'Copied to the clipboard.', 'Yettwanɣel.'],
    downloaded: ['Fichier enregistré : {f}', 'File saved: {f}', 'Afaylu yettwasekles: {f}'],
    imported: ['Réglages importés.', 'Settings imported.', 'Iɣewwaren ttwaketren.'],
    importErr: ['Fichier de réglages invalide.', 'Invalid settings file.', 'Afaylu n yiɣewwaren ur iṣeḥḥa ara.'],
    nothing: ['Rien à exporter pour l’instant.', 'Nothing to export yet.', 'Ulac ara yettwasifḍen.'],
    privacy: ['Vos images ne quittent jamais votre appareil : tout est calculé dans le navigateur.', 'Your images never leave your device: everything is computed in the browser.', 'Tugniwin-ik ur ttffeɣent ara seg ibenk-ik: kullec yettwasiḍen deg yiminig.'],
    source: ['Code source', 'Source code', 'Tangalt taɣbalut'],
    helpBody: [
      `<p><strong>Vecteur Atelier</strong> transforme une image matricielle (pixels) en dessin vectoriel SVG, entièrement dans votre navigateur.</p>
<ol><li><strong>Image</strong> : ouvrez, glissez-déposez ou collez (Ctrl+V) un PNG, JPG, WebP, GIF ou BMP — ou essayez une <em>démo</em>.</li>
<li><strong>Préréglage</strong> : choisissez le plus proche de votre image (logo, dessin au trait, illustration, photo → affiche, pixel art, croquis).</li>
<li><strong>Mode</strong> : noir & blanc (seuil manuel ou Otsu), couleurs (2 à 32, k-moyennes ou coupe médiane) ou niveaux de gris.</li>
<li><strong>Pré-traitement</strong> : lissage, débruitage et suppression des taches nettoient les scans et les JPEG.</li>
<li><strong>Tracé</strong> : seuil des angles (bas = coins vifs), tolérance des courbes (haut = moins de nœuds), simplification. « Pixels exacts » garde chaque pixel ; « Ligne centrale » produit des traits (dessins, écriture).</li>
<li><strong>Comparez</strong> avec le curseur, affichez contours et nœuds, zoomez (molette, pincement) et déplacez (glisser).</li>
<li><strong>Exportez</strong> le SVG (en calques pour Illustrator / Inkscape, ou optimisé), un PNG, la palette ou les réglages.</li></ol>
<p>Clavier (aperçu sélectionné) : <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>0</kbd> ajuster, <kbd>1</kbd> 100 %, flèches = déplacer, <kbd>S</kbd> curseur / côte à côte / vecteur / original, <kbd>O</kbd> contours, <kbd>N</kbd> nœuds. Curseur de comparaison : <kbd>←</kbd> <kbd>→</kbd>.</p>`,
      `<p><strong>Vecteur Atelier</strong> turns a raster (pixel) image into SVG vector artwork, entirely in your browser.</p>
<ol><li><strong>Image</strong>: open, drag and drop or paste (Ctrl+V) a PNG, JPG, WebP, GIF or BMP — or try a <em>demo</em>.</li>
<li><strong>Preset</strong>: pick the closest one (logo, line art, illustration, photo → poster, pixel art, sketch).</li>
<li><strong>Mode</strong>: black & white (manual or Otsu threshold), colour (2 to 32, k-means or median cut) or grey levels.</li>
<li><strong>Pre-processing</strong>: smoothing, denoise and speck removal clean up scans and JPEGs.</li>
<li><strong>Tracing</strong>: corner threshold (low = sharp corners), curve tolerance (high = fewer nodes), simplification. “Exact pixels” keeps every pixel; “Centreline” makes strokes (drawings, handwriting).</li>
<li><strong>Compare</strong> with the split slider, show outlines and nodes, zoom (wheel, pinch) and pan (drag).</li>
<li><strong>Export</strong> the SVG (layered for Illustrator / Inkscape, or optimised), a PNG, the palette or the settings.</li></ol>
<p>Keyboard (preview focused): <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>0</kbd> fit, <kbd>1</kbd> 100 %, arrows = pan, <kbd>S</kbd> split / side / vector / original, <kbd>O</kbd> outlines, <kbd>N</kbd> nodes. Split slider: <kbd>←</kbd> <kbd>→</kbd>.</p>`,
      `<p><strong>Vecteur Atelier</strong> yesselkam tugna n yipixelen ɣer usuneɣ avikṭur SVG, deg yiminig-ik kan.</p>
<ol><li><strong>Tugna</strong>: ldi, zuɣer neɣ senṭeḍ (Ctrl+V) PNG, JPG, WebP, GIF neɣ BMP — neɣ ɛreḍ <em>amedya</em>.</li>
<li><strong>Aɣewwar</strong>: fren win yemqaraben d tugna-k.</li>
<li><strong>Askar</strong>: aberkan & amellal, initen (2 ɣer 32) neɣ amumad.</li>
<li><strong>Aheyyi</strong>: asefsi, asxerxec d yiḍebsiyen.</li>
<li><strong>Asselkem</strong>: talast n teɣmar, aseɣẓen n yizligen, asishel. « Izirig alemmas » yettak-d izuraren.</li>
<li><strong>Serwes</strong> s ufeggag, sken iziraren d tikerrisin, semɣer (taṛuṭ) u senkez (zuɣer).</li>
<li><strong>Sifeḍ</strong> SVG (s yikalkuyen i Illustrator / Inkscape neɣ yettwasefsen), PNG, tafelwit neɣ iɣewwaren.</li></ol>
<p>Anasiw: <kbd>+</kbd> <kbd>−</kbd>, <kbd>0</kbd>, <kbd>1</kbd>, tineccabin, <kbd>S</kbd>, <kbd>O</kbd>, <kbd>N</kbd>.</p>`,
    ],
  };
  const LANGS = ['fr', 'en', 'kab'];
  const idx = (lang) => Math.max(0, LANGS.indexOf(lang));

  // Kabyle Latin → Tifinagh (neo-Tifinagh as used for Taqbaylit). Acronyms, units, names and words with digits are kept.
  const TF = { a: 'ⴰ', b: 'ⴱ', c: 'ⵛ', č: 'ⵞ', d: 'ⴷ', ḍ: 'ⴹ', e: 'ⴻ', é: 'ⴻ', ɛ: 'ⵄ', f: 'ⴼ', g: 'ⴳ', ǧ: 'ⴵ', ɣ: 'ⵖ', h: 'ⵀ', ḥ: 'ⵃ', i: 'ⵉ', j: 'ⵊ', k: 'ⴽ', l: 'ⵍ', m: 'ⵎ', n: 'ⵏ',
    o: 'ⵓ', p: 'ⵒ', q: 'ⵇ', r: 'ⵔ', ṛ: 'ⵕ', s: 'ⵙ', ṣ: 'ⵚ', t: 'ⵜ', ṭ: 'ⵟ', u: 'ⵓ', v: 'ⵠ', w: 'ⵡ', x: 'ⵅ', y: 'ⵢ', z: 'ⵣ', ẓ: 'ⵥ' };
  const KEEP = /^(Vecteur|Atelier|Bézier|Douglas|Peucker|Otsu|Illustrator|Inkscape|Ctrl|Web|Worker|WebP|hex|k-means|px|github|com|salimadour31-boop|vecteur-atelier|MIT)$/;
  function toTifinagh(text) {
    return String(text).replace(/(<[^>]*>)|(\{[^}]*\})|([^<{]+)/g, (m, tag, ph, txt) => tag || ph || txt.replace(/[\p{L}\d-]+/gu, (w) => {
      if (/\d/.test(w) || (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) || KEEP.test(w)) return w;
      return Array.from(w.toLowerCase()).map((ch) => TF[ch] || ch).join('');
    }));
  }
  /** Translate key into lang; vars fill {placeholders}; tfng renders Kabyle in Tifinagh. */
  function t(key, lang = 'fr', vars, tfng = false) {
    const e = S[key];
    let s = e ? e[idx(lang)] : key;
    if (lang === 'kab' && tfng) s = toTifinagh(s);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  return { S, LANGS, t, toTifinagh };
});
