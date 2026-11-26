// Catalog state shared by the screens, and the cached paper list.
import { Prefs } from '../util.js';
import { Store } from '../data/active-store.js';

/* ---------- state ---------- */
export const state = {
  papers: [],
  mode: 'mine', // 'mine': the member's own papers (or local mode); 'public': the library, read-only
  publicPapers: [],
  q: '',
  status: 'all',
  tags: new Set(),
  sort: 'recent',
  sortTouched: false,
  view: Prefs.get('view', 'grid') === 'list' ? 'list' : 'grid',
  openId: null,
};
/** The list the catalog shows: the member's papers, or the public library's cards. */
export const shownPapers = () => (state.mode === 'public' ? state.publicPapers : state.papers);
export const getPaper = (id) => state.papers.find((p) => p.id === id);
export async function reload() { state.papers = await Store.list(); }
export const replacePaper = (p) => { state.papers = state.papers.map((x) => (x.id === p.id ? p : x)); };
