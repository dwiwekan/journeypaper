/* A simple Notion-style block editor for paper notes.
   Data is a list of blocks: { id, type, text | tex | src+caption+w }.
   Inline text is stored as a small HTML subset (b, i, code, a) and is always sanitized first. */
import { esc } from '../util.js';
import { safeHref, safeImg, cleanInline, plain } from './sanitize.js';
import { TEXT, ALL, MENU, LABEL, HINT, KEYS, GLYPH, PH, blockId, cleanId, blockPlain, normBlocks, mk } from './blocks.js';
import { compressImage } from './image.js';

const GRIP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';

function renderTex(tex) {
  if (window.katex) {
    try { return window.katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'mathml' }); } catch (e) { /* fall back to raw text */ }
  }
  return '<code class="eq-raw">' + esc(tex) + '</code>';
}

function placeCaret(body, where) {
  body.focus();
  const sel = document.getSelection();
  const r = document.createRange();
  r.selectNodeContents(body);
  r.collapse(where === 'start');
  sel.removeAllRanges();
  sel.addRange(r);
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

/* ---------- editor ---------- */
export function createEditor(root, opts) {
  opts = opts || {};
  const doc = document;
  let blocks = normBlocks(opts.blocks);
  if (!blocks.length) blocks = [mk('p')];

  const cleanups = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
  const byId = (id) => blocks.find((b) => b.id === id);
  const idx = (id) => blocks.findIndex((b) => b.id === id);
  const elOf = (id) => root.querySelector('.blk[data-id="' + id + '"]');
  const changed = () => { if (opts.onChange) opts.onChange(); };
  const say = (m) => { if (opts.toast) opts.toast(m); };
  const bodyOf = (el) => el && el.querySelector('.blk-body');
  const isText = (b) => b && TEXT.includes(b.type);

  /* ---------- building elements ---------- */
  function buildEl(b) {
    const el = doc.createElement('div');
    el.className = 'blk';
    el.dataset.id = b.id;
    el.dataset.type = b.type;
    const h = doc.createElement('button');
    h.type = 'button'; h.className = 'blk-handle'; h.tabIndex = -1;
    h.setAttribute('aria-label', 'Block menu'); h.innerHTML = GRIP;
    el.appendChild(h);

    if (isText(b)) {
      const body = doc.createElement('div');
      body.className = 'blk-body';
      body.contentEditable = 'true';
      body.spellcheck = false;
      body.dataset.ph = PH[b.type];
      body.setAttribute('role', b.type === 'h2' || b.type === 'h3' ? 'heading' : 'textbox');
      if (b.type === 'h2') body.setAttribute('aria-level', '2');
      if (b.type === 'h3') body.setAttribute('aria-level', '3');
      body.setAttribute('aria-multiline', 'true');
      body.setAttribute('aria-label', LABEL[b.type]);
      body.innerHTML = b.text || '';
      el.appendChild(body);
    } else if (b.type === 'code') {
      el.tabIndex = -1;
      const ta = doc.createElement('textarea');
      ta.className = 'code-edit'; ta.rows = 1; ta.spellcheck = false; ta.value = b.text || '';
      ta.placeholder = 'Code or pseudocode'; ta.setAttribute('aria-label', 'Code');
      el.appendChild(ta);
    } else if (b.type === 'equation') {
      el.tabIndex = -1;
      const view = doc.createElement('div');
      view.className = 'eq-view'; view.tabIndex = 0; view.setAttribute('role', 'button');
      view.setAttribute('aria-label', 'Edit equation');
      const ta = doc.createElement('textarea');
      ta.className = 'eq-edit'; ta.rows = 1; ta.spellcheck = false; ta.value = b.tex || '';
      ta.placeholder = 'Write LaTeX, e.g. \\frac{a}{b} + \\sqrt{x}'; ta.setAttribute('aria-label', 'LaTeX formula');
      el.appendChild(view); el.appendChild(ta);
    } else if (b.type === 'image') {
      el.tabIndex = -1;
      el.appendChild(buildFigure(b));
    } else if (b.type === 'divider') {
      el.tabIndex = -1;
      el.appendChild(doc.createElement('hr'));
    }
    return el;
  }

  function buildFigure(b) {
    const fig = doc.createElement('figure');
    fig.className = 'fig';
    fig.dataset.w = b.w || 'l';
    if (b.src) {
      const img = doc.createElement('img');
      img.src = b.src; img.alt = b.caption || 'Image'; img.decoding = 'async';
      fig.appendChild(img);
      const cap = doc.createElement('figcaption');
      cap.className = 'cap'; cap.contentEditable = 'true'; cap.spellcheck = false;
      cap.dataset.ph = 'Add a caption';
      cap.textContent = b.caption || '';
      fig.appendChild(cap);
    } else {
      const box = doc.createElement('div');
      box.className = 'img-empty';
      box.innerHTML = '<div class="img-empty-row"><button type="button" class="btn small img-pick">Choose image</button><span>or paste with Ctrl+V, or drag it here</span></div>'
        + '<input class="img-url" type="text" inputmode="url" placeholder="or paste an image URL and press Enter" aria-label="Image URL">'
        + '<input class="img-file" type="file" accept="image/*" hidden>';
      fig.appendChild(box);
    }
    return fig;
  }

  function hydrate(el) {
    const b = byId(el.dataset.id);
    if (!b) return;
    if (b.type === 'code') autosize(el.querySelector('.code-edit'));
    if (b.type === 'equation') { renderEq(el, b); }
  }

  function renderEq(el, b, editing) {
    const view = el.querySelector('.eq-view'), ta = el.querySelector('.eq-edit');
    const has = !!(b.tex || '').trim();
    if (has && !editing) { view.innerHTML = renderTex(b.tex); view.hidden = false; ta.hidden = true; }
    else { view.hidden = true; ta.hidden = false; autosize(ta); }
  }

  function renderAll() {
    root.innerHTML = '';
    blocks.forEach((b) => { const el = buildEl(b); root.appendChild(el); hydrate(el); });
  }

  function replaceEl(id) {
    const old = elOf(id), b = byId(id);
    const el = buildEl(b);
    old.replaceWith(el);
    hydrate(el);
    return el;
  }

  /* ---------- focus ---------- */
  function focusBlock(id, where) {
    const el = elOf(id);
    if (!el) return;
    const body = bodyOf(el);
    if (body) { placeCaret(body, where === 'start' ? 'start' : 'end'); return; }
    const ta = el.querySelector('textarea:not([hidden])');
    if (ta) { ta.focus(); const n = where === 'start' ? 0 : ta.value.length; ta.setSelectionRange(n, n); return; }
    el.focus();
  }

  /* ---------- structural operations ---------- */
  function insertAfter(afterId, nb, where) {
    const i = afterId ? idx(afterId) : blocks.length - 1;
    blocks.splice(i + 1, 0, nb);
    const el = buildEl(nb);
    const ref = afterId ? elOf(afterId) : root.lastElementChild;
    if (ref) ref.after(el); else root.appendChild(el);
    hydrate(el);
    if (where) focusBlock(nb.id, where);
    changed();
    return nb;
  }

  function removeBlock(id, focusWhere) {
    const i = idx(id);
    if (i < 0) return;
    const el = elOf(id);
    blocks.splice(i, 1);
    if (el) el.remove();
    if (!blocks.length) {
      const nb = mk('p'); blocks.push(nb);
      const ne = buildEl(nb); root.appendChild(ne); focusBlock(nb.id, 'start');
    } else if (focusWhere !== false) {
      const prev = blocks[i - 1], next = blocks[i];
      if (prev) focusBlock(prev.id, 'end'); else if (next) focusBlock(next.id, 'start');
    }
    changed();
  }

  function convertBlock(id, type, o) {
    o = o || {};
    const i = idx(id);
    if (i < 0) return;
    const old = blocks[i];
    const oldPlain = blockPlain(old);
    let nb;
    if (TEXT.includes(type)) {
      let text = '';
      if (!o.clear) text = isText(old) ? old.text : esc(oldPlain).replace(/\n/g, '<br>');
      nb = { id, type, text };
    } else if (type === 'code') nb = { id, type, text: o.clear ? '' : oldPlain };
    else if (type === 'equation') nb = { id, type, tex: o.clear ? '' : oldPlain };
    else if (type === 'image') nb = { id, type, src: '', caption: '', w: 'l' };
    else nb = { id, type: 'divider' };
    blocks[i] = nb;
    const el = replaceEl(id);
    if (type === 'divider') {
      const next = blocks[i + 1];
      if (next && isText(next)) focusBlock(next.id, 'start');
      else insertAfter(id, mk('p'), 'start');
    } else if (type === 'image') el.focus();
    else focusBlock(id, 'end');
    changed();
    return el;
  }

  function moveBlock(id, dir) {
    const i = idx(id), j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const el = elOf(id), other = elOf(blocks[j].id);
    const tmp = blocks[i]; blocks[i] = blocks[j]; blocks[j] = tmp;
    if (dir < 0) other.before(el); else other.after(el);
    focusBlock(id, 'end');
    changed();
  }

  function duplicateBlock(id) {
    const b = byId(id);
    const copy = Object.assign({}, b, { id: blockId() });
    insertAfter(id, copy, 'end');
  }

  function ensureTrailing() {
    const last = blocks[blocks.length - 1];
    if (!last || !isText(last) || last.text) insertAfter(last ? last.id : null, mk('p'), null);
  }

  renderAll();

  /* ---------- caret ---------- */
  function splitAtCaret(body) {
    const sel = doc.getSelection();
    const r = sel.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const pre = r.cloneRange(); pre.selectNodeContents(body); pre.setEnd(r.startContainer, r.startOffset);
    const post = r.cloneRange(); post.selectNodeContents(body); post.setStart(r.startContainer, r.startOffset);
    const a = doc.createElement('div'); a.appendChild(pre.cloneContents());
    const z = doc.createElement('div'); z.appendChild(post.cloneContents());
    return { before: a.innerHTML, after: z.innerHTML };
  }
  function caretAtStart(body) {
    const sel = doc.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    const pre = doc.createRange(); pre.selectNodeContents(body); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString() === '';
  }
  function caretRect() {
    const sel = doc.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0).cloneRange(); r.collapse(true);
    const rect = r.getClientRects()[0];
    return rect && (rect.width || rect.height) ? rect : null;
  }
  function lineH(body) { const cs = getComputedStyle(body); const lh = parseFloat(cs.lineHeight); return isNaN(lh) ? parseFloat(cs.fontSize) * 1.4 : lh; }
  function onFirstLine(body) { const r = caretRect(); return !r || r.top - body.getBoundingClientRect().top < lineH(body) * 0.8; }
  function onLastLine(body) { const r = caretRect(); return !r || body.getBoundingClientRect().bottom - r.bottom < lineH(body) * 0.8; }

  /* ---------- Enter and Backspace (via beforeinput so they also work on mobile) ---------- */
  function enterInText(b, body) {
    const empty = !body.textContent;
    if (empty && b.type !== 'p') { convertBlock(b.id, 'p', { clear: true }); return; }
    const { before, after } = splitAtCaret(body);
    body.innerHTML = before;
    b.text = before;
    const type = b.type === 'ul' || b.type === 'ol' ? b.type : 'p';
    insertAfter(b.id, { id: blockId(), type, text: after }, 'start');
  }

  function backspaceAtStart(b, body) {
    if (b.type !== 'p') { convertBlock(b.id, 'p'); return; }
    const i = idx(b.id), prev = blocks[i - 1];
    if (!prev) return;
    if (isText(prev)) {
      const pb = bodyOf(elOf(prev.id));
      const mark = pb.childNodes.length;
      pb.insertAdjacentHTML('beforeend', body.innerHTML);
      prev.text = pb.innerHTML;
      removeBlock(b.id, false);
      pb.focus();
      const r = doc.createRange();
      r.setStart(pb, Math.min(mark, pb.childNodes.length)); r.collapse(true);
      const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      changed();
    } else if (!body.textContent) {
      removeBlock(b.id, false);
      focusBlock(prev.id, 'end');
    } else focusBlock(prev.id, 'end');
  }

  on(root, 'beforeinput', (e) => {
    const body = e.target.closest && e.target.closest('.blk-body');
    if (!body || e.isComposing) return;
    const el = body.closest('.blk'); const b = byId(el.dataset.id);
    if (e.inputType === 'insertParagraph') { e.preventDefault(); enterInText(b, body); }
    else if (e.inputType === 'deleteContentBackward' && caretAtStart(body)) { e.preventDefault(); backspaceAtStart(b, body); }
  });

  /* ---------- input ---------- */
  const SHORT = { '# ': 'h2', '## ': 'h2', '### ': 'h3', '- ': 'ul', '* ': 'ul', '1. ': 'ol', '> ': 'quote', '```': 'code', '---': 'divider', '$$': 'equation' };

  on(root, 'input', (e) => {
    const t = e.target;
    const el = t.closest && t.closest('.blk');
    if (!el) return;
    const b = byId(el.dataset.id);
    if (!b) return;
    if (t.classList.contains('blk-body')) {
      if (!t.textContent && t.innerHTML) t.innerHTML = '';
      b.text = t.innerHTML;
      const txt = t.textContent.replace(/ /g, ' ');
      if (b.type === 'p' && SHORT[txt]) { closeSlash(); convertBlock(b.id, SHORT[txt], { clear: true }); return; }
      checkSlash(b, t, txt);
    } else if (t.classList.contains('cap')) b.caption = t.textContent;
    else if (t.classList.contains('code-edit')) { b.text = t.value; autosize(t); }
    else if (t.classList.contains('eq-edit')) { b.tex = t.value; autosize(t); }
    changed();
  });

  /* ---------- keyboard ---------- */
  function exitTextarea(b) {
    const next = blocks[idx(b.id) + 1];
    if (next) focusBlock(next.id, 'start'); else insertAfter(b.id, mk('p'), 'start');
  }

  on(root, 'keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    const el = t.closest && t.closest('.blk');
    if (!el) return;
    const b = byId(el.dataset.id);
    const mod = e.ctrlKey || e.metaKey;

    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlock(b.id, e.key === 'ArrowUp' ? -1 : 1); return; }

    if (t.classList.contains('blk-body')) {
      if (slash.el) {
        if (e.key === 'ArrowDown') { e.preventDefault(); slash.i = (slash.i + 1) % slash.items.length; renderSlash(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); slash.i = (slash.i - 1 + slash.items.length) % slash.items.length; renderSlash(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slash.items[slash.i]); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
      }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleCode(); return; }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink(); return; }
      if (!mod && !e.shiftKey && !e.altKey) {
        if (e.key === 'ArrowUp' && onFirstLine(t)) {
          const prev = blocks[idx(b.id) - 1];
          if (prev) { e.preventDefault(); focusBlock(prev.id, 'end'); }
        } else if (e.key === 'ArrowDown' && onLastLine(t)) {
          const next = blocks[idx(b.id) + 1];
          if (next) { e.preventDefault(); focusBlock(next.id, 'start'); }
        }
      }
      return;
    }

    if (t.classList.contains('cap')) {
      if (e.key === 'Enter') { e.preventDefault(); exitTextarea(b); }
      return;
    }

    if (t.classList.contains('code-edit')) {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (e.key === 'Escape' || (mod && e.key === 'Enter')) { e.preventDefault(); exitTextarea(b); }
      else if (e.key === 'Backspace' && !t.value) { e.preventDefault(); removeBlock(b.id); }
      return;
    }

    if (t.classList.contains('eq-edit')) {
      if (e.key === 'Escape' || (mod && e.key === 'Enter')) { e.preventDefault(); t.blur(); if (b.tex.trim()) focusBlock(b.id, 'end'); }
      else if (e.key === 'Backspace' && !t.value) { e.preventDefault(); removeBlock(b.id); }
      return;
    }

    if (t === el) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeBlock(b.id); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (b.type === 'equation') { renderEq(el, b, true); el.querySelector('.eq-edit').focus(); }
        else insertAfter(b.id, mk('p'), 'start');
      } else if (e.key === 'ArrowUp') { const p = blocks[idx(b.id) - 1]; if (p) { e.preventDefault(); focusBlock(p.id, 'end'); } }
      else if (e.key === 'ArrowDown') { const n = blocks[idx(b.id) + 1]; if (n) { e.preventDefault(); focusBlock(n.id, 'start'); } }
      return;
    }

    if (t.classList.contains('eq-view') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); renderEq(el, b, true); el.querySelector('.eq-edit').focus();
    }
  });

  on(root, 'focusout', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('eq-edit')) {
      const el = t.closest('.blk'), b = byId(el.dataset.id);
      if (b && b.tex.trim()) renderEq(el, b);
    }
  });

  /* ---------- clicks ---------- */
  on(root, 'click', (e) => {
    const t = e.target;
    if (t === root) {
      const last = blocks[blocks.length - 1];
      if (last && isText(last) && !last.text) focusBlock(last.id, 'start');
      else insertAfter(last ? last.id : null, mk('p'), 'start');
      return;
    }
    const a = t.closest && t.closest('a');
    if (a && (e.ctrlKey || e.metaKey) && a.href) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }
    const el = t.closest && t.closest('.blk');
    if (!el) return;
    const b = byId(el.dataset.id);
    if (t.closest('.blk-handle')) { toggleHandleMenu(b.id, t.closest('.blk-handle')); return; }
    if (t.closest('.eq-view')) { renderEq(el, b, true); el.querySelector('.eq-edit').focus(); return; }
    if (t.closest('.img-pick')) { el.querySelector('.img-file').click(); return; }
    if (t.matches('.fig img') && opts.openImage) { opts.openImage(t.currentSrc || t.src, b.caption); }
  });

  on(root, 'change', (e) => {
    if (e.target.classList.contains('img-file') && e.target.files[0]) {
      const el = e.target.closest('.blk');
      insertImages([e.target.files[0]], el.dataset.id);
      e.target.value = '';
    }
  });
  on(root, 'keydown', (e) => {
    if (e.target.classList && e.target.classList.contains('img-url') && e.key === 'Enter') {
      e.preventDefault();
      const el = e.target.closest('.blk'), b = byId(el.dataset.id);
      const src = safeImg(e.target.value);
      if (!src) { say('Image URLs must start with http:// or https://'); return; }
      b.src = src; replaceEl(b.id); changed();
    }
  });
  on(root, 'error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.fig')) { e.target.closest('.fig').classList.add('broken'); e.target.alt = 'Image could not be loaded'; }
  }, true);

  /* ---------- paste and drag ---------- */
  async function insertImages(files, afterId) {
    let at = afterId;
    for (const f of files) {
      try {
        const src = await compressImage(f, { max: 1400, q: 0.86, keepPng: true });
        const cur = byId(at);
        if (cur && cur.type === 'image' && !cur.src) { cur.src = src; replaceEl(cur.id); changed(); }
        else { const nb = { id: blockId(), type: 'image', src, caption: '', w: 'l' }; insertAfter(at, nb, null); at = nb.id; }
      } catch (err) { say('Could not read that image. Try another file.'); }
    }
    ensureTrailing();
  }
  const imgFiles = (list) => Array.from(list || []).filter((f) => /^image\//.test(f.type));

  on(root, 'paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const el = e.target.closest && e.target.closest('.blk');
    const files = imgFiles(cd.files);
    if (files.length) {
      e.preventDefault();
      insertImages(files, el ? el.dataset.id : (blocks[blocks.length - 1] || {}).id);
      return;
    }
    const t = e.target;
    if (t.classList && (t.classList.contains('blk-body') || t.classList.contains('cap'))) {
      e.preventDefault();
      const text = cd.getData('text/plain').replace(/\r/g, '');
      const lines = text.split('\n');
      doc.execCommand('insertText', false, lines[0]);
      if (lines.length > 1 && t.classList.contains('blk-body')) {
        const b = byId(el.dataset.id);
        let at = b.id;
        lines.slice(1).forEach((ln) => { if (ln.trim()) { const nb = { id: blockId(), type: b.type === 'ul' || b.type === 'ol' ? b.type : 'p', text: esc(ln) }; insertAfter(at, nb, 'end'); at = nb.id; } });
      }
    }
  });
  on(root, 'dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  on(root, 'drop', (e) => {
    const files = imgFiles(e.dataTransfer && e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    const el = e.target.closest && e.target.closest('.blk');
    insertImages(files, el ? el.dataset.id : (blocks[blocks.length - 1] || {}).id);
  });

  /* ---------- slash menu ---------- */
  const slash = { el: null, items: [], i: 0, id: null };
  function closeSlash() { if (slash.el) { slash.el.remove(); slash.el = null; } }
  function renderSlash() {
    slash.el.innerHTML = slash.items.map((t, n) =>
      '<button type="button" role="option" class="pop-item' + (n === slash.i ? ' on' : '') + '" aria-selected="' + (n === slash.i) + '" data-type="' + t + '">'
      + '<span class="pi-ic">' + esc(GLYPH[t]) + '</span><span class="pi-tx"><b>' + LABEL[t] + '</b><small>' + HINT[t] + '</small></span></button>').join('');
    const on_ = slash.el.querySelector('.on');
    if (on_) on_.scrollIntoView({ block: 'nearest' });
    positionPop(slash.el, bodyOf(elOf(slash.id)), 'below');
  }
  function openSlash(id, q) {
    const ql = (q || '').toLowerCase();
    const items = MENU.filter((t) => !ql || (LABEL[t] + ' ' + KEYS[t]).toLowerCase().includes(ql));
    if (!items.length) { closeSlash(); return; }
    slash.items = items; slash.i = 0; slash.id = id;
    if (!slash.el) {
      closeMenu();
      slash.el = doc.createElement('div');
      slash.el.className = 'pop slash';
      slash.el.setAttribute('role', 'listbox');
      slash.el.addEventListener('mousedown', (ev) => ev.preventDefault());
      slash.el.addEventListener('click', (ev) => { const bt = ev.target.closest('[data-type]'); if (bt) pickSlash(bt.dataset.type); });
      doc.body.appendChild(slash.el);
    }
    renderSlash();
  }
  function checkSlash(b, body, txt) {
    const m = b.type === 'p' ? txt.match(/^\/([\p{L}]*)$/u) : null;
    if (m) openSlash(b.id, m[1]); else closeSlash();
  }
  function pickSlash(type) {
    const id = slash.id;
    closeSlash();
    convertBlock(id, type, { clear: true });
    if (type === 'image') { const f = elOf(id).querySelector('.img-file'); if (f) f.click(); }
  }

  function positionPop(pop, anchor, mode) {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const sx = window.scrollX, sy = window.scrollY;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + sx + 'px';
    let top = mode === 'right' ? r.top : r.bottom + 6;
    if (mode === 'right') top = Math.max(8, Math.min(top, window.innerHeight - pop.offsetHeight - 8));
    else if (top + pop.offsetHeight > window.innerHeight - 8 && r.top - pop.offsetHeight - 6 > 8) top = r.top - pop.offsetHeight - 6;
    pop.style.top = top + sy + 'px';
  }

  /* ---------- block menu (handle) ---------- */
  let menuEl = null, menuFor = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; menuFor = null; } }
  function toggleHandleMenu(id, btn) {
    if (menuEl && menuFor === id) { closeMenu(); return; }
    closeMenu(); closeSlash();
    const b = byId(id), i = idx(id);
    const m = doc.createElement('div');
    m.className = 'pop hmenu'; m.setAttribute('role', 'menu');
    let html = '';
    if (b.type !== 'image' && b.type !== 'divider') {
      html += '<p class="pop-h">Turn into</p><div class="pop-chips">'
        + ['p', 'h2', 'h3', 'ul', 'ol', 'quote', 'callout', 'code', 'equation'].filter((t) => t !== b.type)
          .map((t) => '<button type="button" role="menuitem" data-conv="' + t + '">' + LABEL[t] + '</button>').join('') + '</div>';
    }
    if (b.type === 'image') {
      html += '<p class="pop-h">Image width</p><div class="pop-chips">'
        + [['s', 'Small'], ['m', 'Medium'], ['l', 'Full']].map(([k, l]) => '<button type="button" role="menuitem" data-w="' + k + '"' + (b.w === k ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
    }
    html += '<div class="pop-list">'
      + (i > 0 ? '<button type="button" role="menuitem" data-act="up">Move up</button>' : '')
      + (i < blocks.length - 1 ? '<button type="button" role="menuitem" data-act="down">Move down</button>' : '')
      + '<button type="button" role="menuitem" data-act="dup">Duplicate</button>'
      + '<button type="button" role="menuitem" data-act="del" class="danger">Delete block</button></div>';
    m.innerHTML = html;
    m.addEventListener('mousedown', (ev) => ev.preventDefault());
    m.addEventListener('click', (ev) => {
      const bt = ev.target.closest('button');
      if (!bt) return;
      closeMenu();
      if (bt.dataset.conv) convertBlock(id, bt.dataset.conv);
      else if (bt.dataset.w) { b.w = bt.dataset.w; const f = elOf(id).querySelector('.fig'); if (f) f.dataset.w = b.w; changed(); }
      else if (bt.dataset.act === 'up') moveBlock(id, -1);
      else if (bt.dataset.act === 'down') moveBlock(id, 1);
      else if (bt.dataset.act === 'dup') duplicateBlock(id);
      else if (bt.dataset.act === 'del') removeBlock(id);
    });
    doc.body.appendChild(m);
    menuEl = m; menuFor = id;
    positionPop(m, btn, 'right');
    const r = btn.getBoundingClientRect();
    m.style.left = Math.min(r.right + 8, window.innerWidth - m.offsetWidth - 8) + window.scrollX + 'px';
  }

  /* ---------- formatting toolbar ---------- */
  const tb = doc.createElement('div');
  tb.className = 'fmt'; tb.hidden = true;
  tb.innerHTML = '<div class="fmt-row">'
    + '<button type="button" data-cmd="bold" aria-label="Bold (Ctrl+B)"><b>B</b></button>'
    + '<button type="button" data-cmd="italic" aria-label="Italic (Ctrl+I)"><i>I</i></button>'
    + '<button type="button" data-cmd="code" aria-label="Inline code (Ctrl+E)"><span class="mono">&lt;/&gt;</span></button>'
    + '<button type="button" data-cmd="link" aria-label="Link (Ctrl+K)">Link</button></div>'
    + '<div class="fmt-link" hidden><input type="text" inputmode="url" placeholder="https://..." aria-label="Link URL">'
    + '<button type="button" data-cmd="apply">Apply</button><button type="button" data-cmd="unlink">Remove</button></div>';
  doc.body.appendChild(tb);
  let linkMode = false, savedRange = null, savedBody = null;
  const linkRow = tb.querySelector('.fmt-link'), linkInput = linkRow.querySelector('input');

  function selBody() {
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const n = sel.getRangeAt(0).commonAncestorContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const body = el && el.closest('.blk-body');
    return body && root.contains(body) ? body : null;
  }
  function hideTb() { tb.hidden = true; linkMode = false; linkRow.hidden = true; tb.querySelector('.fmt-row').hidden = false; }
  function updateToolbar() {
    if (linkMode) return;
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hideTb(); return; }
    const body = selBody();
    if (!body) { hideTb(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { hideTb(); return; }
    tb.hidden = false;
    const w = tb.offsetWidth, h = tb.offsetHeight;
    let top = rect.top - h - 8;
    if (top < 8) top = rect.bottom + 8;
    tb.style.top = top + 'px';
    tb.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    const n = sel.getRangeAt(0).commonAncestorContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    tb.querySelector('[data-cmd=bold]').classList.toggle('on', !!doc.queryCommandState('bold'));
    tb.querySelector('[data-cmd=italic]').classList.toggle('on', !!doc.queryCommandState('italic'));
    tb.querySelector('[data-cmd=code]').classList.toggle('on', !!el.closest('code'));
  }
  function toggleCode() {
    const sel = doc.getSelection(), body = selBody();
    if (!body) return;
    const r = sel.getRangeAt(0);
    const n = r.commonAncestorContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const code = el.closest('code');
    if (code && body.contains(code)) {
      const frag = doc.createDocumentFragment();
      while (code.firstChild) frag.appendChild(code.firstChild);
      code.replaceWith(frag);
    } else if (!sel.isCollapsed) {
      doc.execCommand('insertHTML', false, '<code>' + esc(r.toString()) + '</code>');
    } else return;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function openLink() {
    const sel = doc.getSelection(), body = selBody();
    if (!body || sel.isCollapsed) return;
    savedRange = sel.getRangeAt(0).cloneRange(); savedBody = body;
    const n = savedRange.commonAncestorContainer;
    const a = (n.nodeType === 1 ? n : n.parentElement).closest('a');
    linkInput.value = a ? a.getAttribute('href') || '' : '';
    linkMode = true;
    tb.hidden = false;
    tb.querySelector('.fmt-row').hidden = true; linkRow.hidden = false;
    linkInput.focus();
  }
  function restoreSel() {
    if (!savedBody) return false;
    savedBody.focus();
    const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange);
    return true;
  }
  tb.addEventListener('mousedown', (e) => { if (e.target !== linkInput) e.preventDefault(); });
  tb.addEventListener('click', (e) => {
    const bt = e.target.closest('[data-cmd]');
    if (!bt) return;
    const c = bt.dataset.cmd;
    if (c === 'bold' || c === 'italic') { doc.execCommand(c); updateToolbar(); }
    else if (c === 'code') { toggleCode(); updateToolbar(); }
    else if (c === 'link') openLink();
    else if (c === 'apply') applyLink();
    else if (c === 'unlink') { if (restoreSel()) { doc.execCommand('unlink'); savedBody.dispatchEvent(new Event('input', { bubbles: true })); } hideTb(); }
  });
  function applyLink() {
    let url = linkInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (!safeHref(url)) { say('That link address is not valid.'); return; }
    if (restoreSel()) doc.execCommand('createLink', false, url);
    hideTb();
  }
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    else if (e.key === 'Escape') { e.preventDefault(); const b = savedBody; hideTb(); if (b) restoreSel(); }
  });
  on(doc, 'selectionchange', updateToolbar);
  on(window, 'scroll', () => { if (!tb.hidden && !linkMode) updateToolbar(); if (slash.el) positionPop(slash.el, bodyOf(elOf(slash.id)), 'below'); }, { passive: true });
  on(doc, 'mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target) && !(e.target.closest && e.target.closest('.blk-handle'))) closeMenu();
    if (slash.el && !slash.el.contains(e.target)) closeSlash();
    if (linkMode && !tb.contains(e.target)) hideTb();
  });
  on(doc, 'keydown', (e) => { if (e.key === 'Escape') { closeMenu(); } });
  on(window, 'katex-ready', () => { root.querySelectorAll('.blk[data-type=equation]').forEach((el) => { const b = byId(el.dataset.id); if (b && b.tex.trim() && !el.querySelector('.eq-view').hidden) renderEq(el, b); }); });

  /* ---------- API ---------- */
  return {
    getBlocks: () => blocks.map((b) => Object.assign({}, b)),
    headings: () => blocks.filter((b) => b.type === 'h2' || b.type === 'h3').map((b) => ({ id: b.id, level: b.type === 'h2' ? 2 : 3, text: plain(b.text) })),
    scrollTo: (id) => { const el = elOf(id); if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); },
    headingOffsets: () => blocks.filter((b) => b.type === 'h2' || b.type === 'h3').map((b) => { const el = elOf(b.id); return { id: b.id, top: el ? el.getBoundingClientRect().top : 0 }; }),
    destroy: () => { cleanups.forEach((f) => f()); closeSlash(); closeMenu(); tb.remove(); root.innerHTML = ''; },
  };
}
