// Cleans untrusted HTML and URLs before they reach the page or storage.

export function safeHref(u) {
  try {
    const url = new URL(String(u || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (e) { return ''; }
}
export function safeImg(u) {
  const s = String(u || '').trim();
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(s)) return s;
  return safeHref(s);
}

/* Only b, i, code, a, br survive. Other tags are unwrapped; scripts are dropped. */
export function cleanInline(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const out = document.createElement('div');
  (function walk(src, dst) {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName.toLowerCase();
      if (['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'].includes(t)) return;
      if (t === 'br') { dst.appendChild(document.createElement('br')); return; }
      let el = null;
      if (t === 'b' || t === 'strong') el = document.createElement('b');
      else if (t === 'i' || t === 'em') el = document.createElement('i');
      else if (t === 'code') el = document.createElement('code');
      else if (t === 'a') {
        const h = safeHref(n.getAttribute('href'));
        if (h) { el = document.createElement('a'); el.href = h; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.title = 'Ctrl or Cmd + click to open'; }
      }
      if (el) { dst.appendChild(el); walk(n, el); } else walk(n, dst);
    });
  })(tpl.content, out);
  if (!out.textContent.trim()) return '';
  return out.innerHTML.replace(/(<br>)+$/, '');
}

export function plain(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  return tpl.content.textContent.replace(/ /g, ' ');
}
