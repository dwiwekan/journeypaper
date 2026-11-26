// Autosave for the open paper's notes, without the DOM, so it can be tested in Node.
// One save runs at a time, so two saves never send the same revision. A change that could not
// be saved is kept (with its paper id) and sent by the next save, even after the page changes.
import { ApiError, AuthError } from '../data/api.js';
import { ConflictError } from '../data/api-store.js';

export const RETRY_FIRST_MS = 3000;
export const RETRY_MAX_MS = 30000;

const retryable = (e) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
const noop = () => {};

/**
 * store: has update(id, patch, opts). getBlocks(): the editor's blocks. setSave(text): the save label.
 * onConflict(current) -> Promise<'reload'|'keep'>. onSaved(paper|null), onReload(current), onError(err).
 * schedule(fn, ms): runs fn later (setTimeout in the page).
 */
export function createSaver({ store, getBlocks, setSave, onConflict, onSaved = noop, onReload = noop, onError = noop, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  let id = null; // the paper in the editor
  let dirty = false; // the editor changed since the last snapshot
  let snap = null; // { id, content } not yet saved
  let running = null;
  let delay = RETRY_FIRST_MS;
  let gen = 0; // a scheduled retry only runs if no save started since

  function take() {
    if (!dirty || !id) return;
    if (snap && snap.id !== id) return; // send the older paper's change first
    snap = { id, content: getBlocks() };
    dirty = false;
  }

  async function send(s) {
    let opts;
    for (;;) {
      try {
        const saved = await store.update(s.id, { content: s.content }, opts);
        if (saved === null) {
          /* Deleted in another tab or device: nothing was stored. Keep the text so it is not lost. */
          setSave('Not saved');
          onError(new Error('Not saved: this paper was deleted in another tab or device. Restore it, or copy your text.'));
          return false;
        }
        if (snap === s) snap = null;
        delay = RETRY_FIRST_MS;
        onSaved(saved, s.id);
        return true;
      } catch (e) {
        if (e instanceof ConflictError) {
          const choice = await onConflict(e.current);
          if (choice === 'reload') {
            if (snap === s) snap = null;
            if (s.id === id) dirty = false;
            onReload(e.current, s.id);
            setSave('');
            return false;
          }
          if (s.id === id && dirty) { s.content = getBlocks(); dirty = false; }
          opts = { force: true };
          continue;
        }
        if (retryable(e)) {
          setSave('Not saved, retrying');
          const mine = gen;
          schedule(() => { if (mine === gen) return flush(); return undefined; }, delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        } else {
          setSave('Not saved');
          if (!(e instanceof AuthError)) onError(e);
        }
        return false;
      }
    }
  }

  async function flush() {
    while (running) await running;
    for (;;) {
      take();
      if (!snap) return;
      gen += 1;
      setSave('Saving…');
      const s = snap;
      running = send(s);
      let ok;
      try { ok = await running; } finally { running = null; }
      if (!ok) return;
      /* The older paper is saved; go on with the open one if it changed too. */
      if (!dirty || s.id === id) { if (!dirty && !snap) setSave('Saved'); return; }
    }
  }

  return {
    /** The editor now shows this paper. An unsaved change of the previous one is kept. */
    open(next) { id = next; dirty = false; },
    touch() { dirty = true; },
    flush,
    /** Drops every unsaved change (the paper was deleted, or everything was wiped). */
    cancel() { dirty = false; snap = null; gen += 1; delay = RETRY_FIRST_MS; },
    pending: () => dirty || !!snap,
  };
}
