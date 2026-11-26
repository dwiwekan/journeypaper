// Generated default covers. coverSvg is pure, so it can be tested without a browser.

/* ---------- generated covers ---------- */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const coverCache = new Map();
/* The default cover is a small graph, like a scene graph, so every title gets its own look. */
export function coverSvg(title) {
  const key = title || 'paper';
  if (coverCache.has(key)) return coverCache.get(key);
  const r = rng(hash(key));
  const hue = Math.floor(r() * 360);
  const n = 7 + Math.floor(r() * 4);
  const pts = Array.from({ length: n }, () => [Math.round(34 + r() * 332), Math.round(34 + r() * 182), 3 + r() * 5]);
  let edges = '';
  for (let i = 1; i < n; i++) {
    const j = Math.floor(r() * i);
    edges += `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}"/>`;
  }
  for (let k = 0; k < 2; k++) {
    const a = Math.floor(r() * n), b = Math.floor(r() * n);
    if (a !== b) edges += `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`;
  }
  const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2].toFixed(1)}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 52% 17%)"/><stop offset="1" stop-color="hsl(${(hue + 46) % 360} 58% 30%)"/></linearGradient></defs>`
    + `<rect width="400" height="250" fill="url(#g)"/>`
    + `<g stroke="hsl(${(hue + 20) % 360} 80% 78%)" stroke-opacity=".5" stroke-width="1.4">${edges}</g>`
    + `<g fill="hsl(${(hue + 20) % 360} 90% 80%)">${dots}</g></svg>`;
  const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  coverCache.set(key, uri);
  return uri;
}

/** Swaps broken cover images for a generated one. */
/* Uploaded covers get `fit` so CSS shows the whole image; generated covers fill the frame. */
export function coverFor(p) {
  return p.image ? { src: p.image, fit: true } : { src: coverSvg(p.title), fit: false };
}

export function initCoverFallback() {
  /* Broken images (for example a dead URL) fall back to a generated cover. */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset && img.dataset.title !== undefined && !img.dataset.fb) { img.dataset.fb = '1'; img.classList.remove('fit'); img.src = coverSvg(img.dataset.title); }
  }, true);
}
