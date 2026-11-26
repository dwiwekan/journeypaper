// One catalog card. Member cards have edit and delete; read-only cards (the public library)
// link to the public paper page and show the status and stars for display only.
import { esc, pad } from '../util.js';
import { STATUS, SECTIONS } from '../config.js';
import { derived } from '../data/paper.js';
import { hl, snippet } from '../services/search.js';
import { ICON, STAR } from './icons.js';
import { coverFor } from './cover.js';

export function starsHtml(n) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? STAR : STAR.replace('<svg ', '<svg class="off" ');
  return `<span class="stars" role="img" aria-label="Rated ${n} out of 5">${s}</span>`;
}
export function progressHtml(p) {
  const filled = derived(p).filled;
  const names = SECTIONS.filter(([k]) => filled.has(k)).map(([, t]) => t);
  const label = `${filled.size} of 5 sections filled${names.length ? ': ' + names.join(', ') : ''}`;
  return `<span class="prog" role="img" aria-label="${esc(label)}" title="${esc(label)}">${SECTIONS.map(([k]) => `<i class="${filled.has(k) ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** The public route of a card in the library: #library/<owner>/<id>. */
export const publicHash = (p) => `library/${p.owner}/${p.id}`;

/** Card HTML. re and terms come from filterAndSort/highlighter; rank is the № shown. */
export function cardHtml(p, re, terms, rank, { readOnly = false } = {}) {
  const cover = coverFor(p);
  const meta = [p.authors, [p.venue, p.year].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ');
  let snip = '';
  if (terms.length) {
    const body = derived(p).body;
    const seen = (p.title + ' ' + p.summary).toLowerCase();
    const inVisible = terms.every((t) => seen.includes(t.raw.toLowerCase()));
    const s = !inVisible && !terms.some((t) => t.tag) && snippet(body, terms);
    if (s) snip = `<p class="snip"><b>Notes</b>${hl(s, re)}</p>`;
  }
  const title = readOnly
    ? `<a class="title-btn" href="#${esc(publicHash(p))}">${hl(p.title, re)}</a>`
    : `<button type="button" class="title-btn" data-act="open">${hl(p.title, re)}</button>`;
  const edit = readOnly ? '' : `
          <button type="button" class="icon-btn small" data-act="edit" aria-label="Edit paper info">${ICON.edit}</button>
          <button type="button" class="icon-btn small" data-act="delete" aria-label="Delete paper">${ICON.trash}</button>`;
  return `<article class="card" data-id="${esc(p.id)}"${readOnly ? ` data-owner="${esc(p.owner)}"` : ''}>
    <div class="cover">
      <img src="${esc(cover.src)}"${cover.fit ? ' class="fit"' : ''} alt="" loading="lazy" decoding="async" data-title="${esc(p.title)}">
      <span class="no">№ ${pad(rank)}</span>
      ${!readOnly && p.public ? '<span class="badge-public" title="Anyone can read this paper in the library">Public</span>' : ''}
      <span class="pill" data-s="${p.status}">${STATUS[p.status]}</span>
    </div>
    <div class="card-main">
      <div class="card-body">
        ${meta ? `<p class="meta">${hl(meta, re)}</p>` : ''}
        <h3>${title}</h3>
        ${p.summary ? `<p class="summary">${hl(p.summary, re)}</p>` : ''}
        ${snip}
        ${p.tags.length ? `<div class="tags">${p.tags.map((t) => `<span class="tag">#${hl(t, re)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card-foot">
        <span class="foot-l">${progressHtml(p)}${p.rating ? starsHtml(p.rating) : ''}</span>
        <span class="acts">
          ${p.link ? `<a class="icon-btn small" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open paper link">${ICON.link}</a>` : ''}${edit}
        </span>
      </div>
    </div>
  </article>`;
}
