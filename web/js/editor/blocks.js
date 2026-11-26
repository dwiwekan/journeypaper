// Block types, their labels, and the rules that keep stored blocks valid.
import { cleanInline, plain, safeImg } from './sanitize.js';

export const TEXT = ['p', 'h2', 'h3', 'ul', 'ol', 'quote', 'callout'];
export const ALL = TEXT.concat(['code', 'equation', 'image', 'divider']);
export const MENU = ['p', 'h2', 'h3', 'ul', 'ol', 'quote', 'callout', 'code', 'equation', 'image', 'divider'];
export const LABEL = { p: 'Text', h2: 'Heading', h3: 'Subheading', ul: 'Bulleted list', ol: 'Numbered list', quote: 'Quote', callout: 'Callout', code: 'Code', equation: 'Equation', image: 'Image', divider: 'Divider' };
export const HINT = { p: 'Plain paragraph', h2: 'Section heading', h3: 'Smaller section heading', ul: 'Simple bullet points', ol: 'Numbered points', quote: 'Quote an important sentence', callout: 'Highlight one key idea', code: 'Code or pseudocode block', equation: 'LaTeX formula', image: 'Upload, paste, or drag', divider: 'Horizontal line' };
export const KEYS = { p: 'text paragraph plain', h2: 'heading title h1 h2', h3: 'subheading h3', ul: 'bullet list unordered', ol: 'number numbered ordered list', quote: 'quote blockquote', callout: 'callout note important highlight', code: 'code pseudocode snippet', equation: 'equation formula math latex tex', image: 'image picture photo figure', divider: 'divider separator line rule hr' };
export const GLYPH = { p: 'Aa', h2: 'H2', h3: 'H3', ul: '•', ol: '1.', quote: '“', callout: '!', code: '</>', equation: '∑', image: '▣', divider: '—' };
export const PH = { p: 'Write something, or type / to choose a block', h2: 'Section heading', h3: 'Subheading', ul: 'List item', ol: 'Numbered item', quote: 'Quote', callout: 'Write the key idea here' };

export const blockId = () => 'b' + Math.random().toString(36).slice(2, 10);
export const cleanId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || blockId();

export function blockPlain(b) {
  if (TEXT.includes(b.type)) return plain(b.text);
  if (b.type === 'code') return b.text || '';
  if (b.type === 'equation') return b.tex || '';
  if (b.type === 'image') return b.caption || '';
  return '';
}

export function normBlocks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const r of arr.slice(0, 600)) {
    if (!r || typeof r !== 'object') continue;
    const type = ALL.includes(r.type) ? r.type : 'p';
    let id = cleanId(r.id);
    while (seen.has(id)) id = blockId();
    seen.add(id);
    const b = { id, type };
    if (TEXT.includes(type)) b.text = cleanInline(r.text);
    else if (type === 'code') b.text = String(r.text || '').slice(0, 20000);
    else if (type === 'equation') b.tex = String(r.tex || '').slice(0, 4000);
    else if (type === 'image') { b.src = safeImg(r.src); b.caption = String(r.caption || '').slice(0, 300); b.w = ['s', 'm', 'l'].includes(r.w) ? r.w : 'l'; }
    out.push(b);
  }
  return out;
}

export const mk = (type) => {
  if (type === 'code') return { id: blockId(), type, text: '' };
  if (type === 'equation') return { id: blockId(), type, tex: '' };
  if (type === 'image') return { id: blockId(), type, src: '', caption: '', w: 'l' };
  if (type === 'divider') return { id: blockId(), type };
  return { id: blockId(), type, text: '' };
};
