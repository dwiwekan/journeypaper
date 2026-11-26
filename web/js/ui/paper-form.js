// The add / edit info dialog.
import { $, esc } from '../util.js';
import { MAX_TAGS } from '../config.js';
import { normTags } from '../data/paper.js';
import { Store } from '../data/active-store.js';
import { AI } from '../services/ai.js';
import { compressImage } from '../editor/image.js';
import { safeImg } from '../editor/sanitize.js';
import { ICON, STAR } from './icons.js';
import { reload, replacePaper } from './state.js';
import { toast } from './toast.js';
import { openDialog } from './dialog.js';
import { renderAll } from './catalog.js';

/* ---------- add / edit info form ---------- */
const F = { id: null, image: '', tags: [], rating: 0 };
const f = {
  dlg: $('#dlg-form'), form: $('#paper-form'), heading: $('#form-title'),
  title: $('#f-title'), link: $('#f-link'), authors: $('#f-authors'), year: $('#f-year'), venue: $('#f-venue'),
  status: $('#f-status'), summary: $('#f-summary'), more: $('#more'),
  drop: $('#drop'), preview: $('#drop-preview'), dropEmpty: $('#drop-empty'), file: $('#f-file'),
  url: $('#f-image-url'), clear: $('#btn-img-clear'), err: $('#img-err'),
  tagInput: $('#f-tags'), tagChips: $('#f-tag-chips'), rating: $('#f-rating'), save: $('#btn-save'),
};

export function openForm(paper, preset) {
  const p = paper || { title: '', image: '', link: '', authors: '', year: '', venue: '', tags: [], status: 'want', rating: 0, summary: '', ...(preset || {}) };
  F.id = paper ? paper.id : null;
  F.image = p.image || '';
  F.tags = p.tags.slice();
  F.rating = p.rating || 0;
  f.heading.textContent = paper ? 'Edit paper info' : 'Add paper';
  f.save.textContent = paper ? 'Save changes' : 'Save and start writing';
  f.title.value = p.title;
  f.link.value = p.link;
  f.authors.value = p.authors;
  f.year.value = p.year;
  f.venue.value = p.venue;
  f.status.value = p.status;
  f.summary.value = p.summary;
  f.tagInput.value = '';
  f.url.value = F.image && !F.image.startsWith('data:') ? F.image : '';
  f.err.hidden = true;
  f.more.open = !!paper;
  renderFormTags(); renderFormStars(); renderPreview();
  openDialog(f.dlg);
}

function renderPreview() {
  const has = !!F.image;
  f.preview.hidden = !has;
  f.dropEmpty.hidden = has;
  f.clear.hidden = !has;
  if (has) f.preview.src = F.image;
  else f.preview.removeAttribute('src');
}
function showImgErr(msg) { f.err.textContent = msg; f.err.hidden = !msg; }

async function setImageFile(file) {
  showImgErr('');
  if (!file || !/^image\//.test(file.type)) return showImgErr('That file is not an image. Choose a PNG, JPG, or WebP file.');
  try {
    F.image = await compressImage(file, { max: 900, q: 0.84 });
    f.url.value = '';
    renderPreview();
  } catch (e) { showImgErr('Could not read that image. Try another file.'); }
}

function renderFormTags() {
  f.tagChips.innerHTML = F.tags.map((t, i) =>
    `<span class="chip">#${esc(t)}<button type="button" data-rm="${i}" aria-label="Remove tag ${esc(t)}">${ICON.x}</button></span>`).join('');
}
function addTagsFromInput() {
  normTags(f.tagInput.value).forEach((v) => { if (!F.tags.includes(v) && F.tags.length < MAX_TAGS) F.tags.push(v); });
  f.tagInput.value = '';
  renderFormTags();
}

function renderFormStars() {
  f.rating.className = 'stars input';
  f.rating.innerHTML = [1, 2, 3, 4, 5].map((i) =>
    `<button type="button" class="${i <= F.rating ? 'on' : ''}" data-rate="${i}" role="radio" aria-checked="${i === F.rating}" aria-label="${i} ${i === 1 ? 'star' : 'stars'}">${STAR}</button>`).join('');
}

/** Cover drop zone, paste, tags, rating, and the save button. */
export function initPaperForm() {
  f.drop.addEventListener('click', () => f.file.click());
  f.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.file.click(); } });
  f.file.addEventListener('change', () => { if (f.file.files[0]) setImageFile(f.file.files[0]); f.file.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => f.drop.addEventListener(ev, (e) => { e.preventDefault(); f.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => f.drop.addEventListener(ev, (e) => { e.preventDefault(); f.drop.classList.remove('over'); }));
  f.drop.addEventListener('drop', (e) => { const file = e.dataTransfer && e.dataTransfer.files[0]; if (file) setImageFile(file); });
  document.addEventListener('paste', (e) => {
    if (!f.dlg.open || !e.clipboardData) return;
    const file = Array.from(e.clipboardData.files || []).find((x) => /^image\//.test(x.type));
    if (file) { e.preventDefault(); setImageFile(file); }
  });
  f.url.addEventListener('input', () => {
    showImgErr('');
    const v = f.url.value.trim();
    F.image = v ? safeImg(v) : '';
    if (v && !F.image) showImgErr('Image URLs must start with http:// or https://');
    renderPreview();
  });
  f.preview.addEventListener('error', () => { if (F.image && !F.image.startsWith('data:')) showImgErr('Could not load an image from that URL. A generated cover is used if you leave it.'); });
  f.clear.addEventListener('click', () => { F.image = ''; f.url.value = ''; showImgErr(''); renderPreview(); });

  f.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagsFromInput(); }
    else if (e.key === 'Backspace' && !f.tagInput.value && F.tags.length) { F.tags.pop(); renderFormTags(); }
  });
  f.tagInput.addEventListener('change', addTagsFromInput);
  f.tagInput.addEventListener('blur', addTagsFromInput);
  f.tagChips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { F.tags.splice(+b.dataset.rm, 1); renderFormTags(); f.tagInput.focus(); }
  });

  f.rating.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate]');
    if (!b) return;
    const n = +b.dataset.rate;
    F.rating = n === F.rating ? 0 : n;
    renderFormStars();
  });

  /* Invalid fields inside "More details" must be visible, not hidden. */
  f.form.addEventListener('invalid', () => { f.more.open = true; }, true);

  f.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.tagInput.value.trim()) addTagsFromInput();
    const data = {
      title: f.title.value.trim(), image: F.image, link: f.link.value.trim(),
      authors: f.authors.value.trim(), year: f.year.value.trim(), venue: f.venue.value.trim(),
      tags: F.tags, status: f.status.value, rating: F.rating, summary: f.summary.value.trim(),
    };
    if (!data.title) { f.title.focus(); return; }
    f.save.disabled = true;
    try {
      const creating = !F.id;
      const saved = creating ? await Store.create(data) : await Store.update(F.id, data);
      if (!saved) { toast('Not saved: this paper was deleted in another tab or device.'); return; }
      f.dlg.close();
      await reload();
      if (creating) {
        toast('Paper added. The five sections are ready.');
        location.hash = 'paper-' + saved.id;
        /* AI hook: auto-fill fields that are still empty. */
        try {
          const extra = await AI.enrich(saved);
          if (extra) { const up = await Store.update(saved.id, extra); if (up) { replacePaper(up); renderAll(); } }
        } catch (err) { /* AI may fail; the paper is already saved */ }
      } else {
        toast('Changes saved');
        renderAll();
      }
    } finally { f.save.disabled = false; }
  });

  $('#btn-add').addEventListener('click', () => openForm());
}
