// The Store interface backed by our API. Same methods as data/store.js, plus revisions:
// every update sends the revision it last saw, so another tab's newer text is never overwritten.
// Notes keep their own base: the revision the editor's text was loaded at. Field edits, their
// silent 409 retries and list() never move it, so stale notes always meet a conflict.
import { api as defaultApi, ApiError } from './api.js';
import { normalizePaper, normalizeCard } from './paper.js';

export class ConflictError extends Error {
  /** current: the server's paper (normalized); revision: its revision, used by update(..., { force: true }). */
  constructor(current, revision) {
    super('This paper changed in another tab or device.');
    this.name = 'ConflictError'; this.current = current; this.revision = revision;
  }
}

/** Import batches stay under this many bytes of JSON (the server accepts 8 MB per request). */
export const BATCH_BYTES = 6291456;
const bytes = (s) => new Blob([s]).size;

export function createApiStore(api) {
  const revs = new Map(); // id -> revision last seen
  const bases = new Map(); // id -> revision the open notes were loaded at (get, create, a notes save)
  const forced = new Map(); // id -> revision from the last ConflictError
  const cards = new Map();

  async function call(method, path, opts) {
    return read(await api.request(method, path, opts));
  }
  /* Visitors' calls: no session, and nothing is kept in cards or revs. */
  async function callPublic(path) {
    return read(await api.publicRequest('GET', path));
  }
  async function read(r) {
    const raw = await r.text();
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch (e) { body = null; } }
    if (!r.ok) {
      const err = body && body.error ? body.error : {};
      throw new ApiError(r.status, err.code || 'error', body, err.message);
    }
    return body;
  }
  const missing = (e) => e instanceof ApiError && e.status === 404;
  function keepCard(raw) {
    revs.set(raw.id, raw.revision);
    const c = normalizeCard(raw);
    cards.set(c.id, c);
    return c;
  }
  const path = (id) => `/papers/${encodeURIComponent(id)}`;

  async function update(id, patch, { force = false } = {}) {
    const notes = 'content' in patch;
    const base = bases.has(id) ? bases.get(id) : revs.get(id);
    let rev = force && forced.has(id) ? forced.get(id) : notes ? base : revs.get(id);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const c = keepCard(await call('PATCH', path(id), { body: patch, headers: { 'If-Match': String(rev) } }));
        forced.delete(id);
        /* The open notes are still current only if nothing else was saved in between. */
        if (notes || rev === base) bases.set(id, revs.get(id));
        return c;
      } catch (e) {
        if (missing(e)) return null;
        if (!(e instanceof ApiError) || e.status !== 409 || !e.body || !e.body.current) throw e;
        const cur = e.body.current;
        revs.set(id, cur.revision);
        /* Field edits (title, rating...) do not clash with notes, so send them again once. Notes do. */
        if (!notes && attempt === 0) { rev = cur.revision; continue; }
        forced.set(id, cur.revision);
        throw new ConflictError(normalizePaper(cur), cur.revision);
      }
    }
  }

  return {
    async init() {},
    async list() { cards.clear(); return (await call('GET', '/papers')).map(keepCard); },
    async get(id) {
      try {
        const raw = await call('GET', path(id));
        revs.set(raw.id, raw.revision); bases.set(raw.id, raw.revision);
        return normalizePaper(raw);
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async create(data) {
      const p = normalizePaper({ ...data, id: undefined, content: undefined, createdAt: Date.now() });
      const raw = await call('POST', '/papers', { body: p });
      revs.set(raw.id, raw.revision); bases.set(raw.id, raw.revision);
      return normalizePaper(raw);
    },
    update,
    async remove(id) {
      try { await call('DELETE', path(id)); } catch (e) { if (!missing(e)) throw e; }
      cards.delete(id);
    },
    async restore(p) { return keepCard(await call('POST', `${path(p.id)}/restore`)); },
    async removeWhere(fn) {
      for (const c of Array.from(cards.values()).filter(fn)) await this.remove(c.id);
    },
    async merge(items) {
      const total = { created: 0, updated: 0, skipped: 0, errors: [] };
      const send = async (parts, ids) => {
        let out;
        try {
          out = await call('POST', '/import', { body: `[${parts.join(',')}]` });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 413) throw e;
          /* Only a paper bigger than a whole batch gets here; name it and go on with the rest. */
          total.errors.push(...ids.map((id) => ({ id, reason: 'too large (the server takes up to 8 MB per paper)' })));
          return;
        }
        total.created += out.created; total.updated += out.updated; total.skipped += out.skipped;
        total.errors.push(...(out.errors || []));
      };
      let batch = [], ids = [], size = 2;
      for (const item of items) {
        const s = JSON.stringify(item);
        const n = bytes(s) + 1;
        if (batch.length && size + n > BATCH_BYTES) { await send(batch, ids); batch = []; ids = []; size = 2; }
        batch.push(s); ids.push(String((item && item.id) || '')); size += n; // an item bigger than a batch goes alone
      }
      if (batch.length) await send(batch, ids);
      return total;
    },
    async clear() {
      await call('DELETE', '/papers', { headers: { 'X-Confirm': 'wipe' } });
      cards.clear(); revs.clear(); bases.clear(); forced.clear();
    },
    async listPublic() { return (await callPublic('/public/papers')).map((r) => normalizeCard(r)); },
    async getPublic(owner, id) {
      try {
        const raw = await callPublic(`/public/papers/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`);
        return { ...normalizePaper(raw), owner: normalizeCard(raw).owner };
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async publishAll() { return (await call('POST', '/papers/publish-all')).published; },
    async listTrash() { return (await call('GET', '/papers/trash')).map((r) => normalizeCard(r)); },
    async deleteForever(id, title) { await call('DELETE', `${path(id)}/forever`, { body: { title } }); },
    async exportAll() { return (await call('GET', '/export')).map((r) => normalizePaper(r)); },
  };
}

export const Store = createApiStore(defaultApi);
