// The read-only notes view: stored blocks as plain HTML, with no editing. Everything is cleaned
// again here (normBlocks: cleanInline for text, safeImg for images); code and TeX are escaped.
import { esc } from '../util.js';
import { normBlocks } from './blocks.js';

const BODY = { p: 'div', h2: 'h2', h3: 'h3', ul: 'div', ol: 'div', quote: 'blockquote', callout: 'div' };

function blockHtml(b) {
  const open = `<div class="blk" data-type="${b.type}">`;
  if (BODY[b.type]) {
    const t = BODY[b.type];
    const id = b.type === 'h2' || b.type === 'h3' ? ` id="h-${b.id}"` : '';
    return `${open}<${t} class="blk-body"${id}>${b.text}</${t}></div>`;
  }
  if (b.type === 'code') return `${open}<pre class="code-view"><code>${esc(b.text)}</code></pre></div>`;
  if (b.type === 'equation') return b.tex.trim() ? `${open}<div class="eq" data-tex="${esc(b.tex)}">${esc(b.tex)}</div></div>` : '';
  if (b.type === 'image') {
    if (!b.src) return '';
    return `${open}<figure class="fig" data-w="${b.w}"><img src="${esc(b.src)}" alt="${esc(b.caption)}" loading="lazy" decoding="async">`
      + `${b.caption ? `<figcaption class="cap">${esc(b.caption)}</figcaption>` : ''}</figure></div>`;
  }
  if (b.type === 'divider') return `${open}<hr></div>`;
  return '';
}

/** Read-only HTML for a paper's blocks. Headings get id="h-<block id>" for the contents. */
export function blocksHtml(blocks) {
  return normBlocks(blocks).filter((b) => !(b.text === '' && b.type in BODY)).map(blockHtml).join('');
}

/** Typesets the .eq blocks under root once KaTeX is loaded (MathML, like the editor). */
export function renderMath(root) {
  if (!root || !window.katex) return;
  root.querySelectorAll('.eq[data-tex]').forEach((el) => {
    try { el.innerHTML = window.katex.renderToString(el.dataset.tex, { displayMode: true, throwOnError: false, output: 'mathml' }); } catch (e) { /* the raw TeX stays */ }
  });
}

/** The headings under root, for the table of contents (same shape as the editor's). */
export function viewHeadings(root) {
  return root ? Array.from(root.querySelectorAll('h2.blk-body[id], h3.blk-body[id]')).map((h) => ({
    id: h.id.slice(2), level: h.tagName === 'H2' ? 2 : 3, text: h.textContent, el: h,
  })) : [];
}
