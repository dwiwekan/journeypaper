// The hash router. Routes: '' (empty), #home, #library, #library?q=…, #library/<owner>/<id>,
// #papers, #paper-<id>, #trash, #signin. resolveRoute sends each one where this visitor may go;
// a redirect replaces the history entry, so Back does not bounce through it again.

const ID = '[A-Za-z0-9_-]+';
const OWNER = '[0-9A-Fa-f-]+';

function decode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

/** The route a hash names. Anything unknown is { name: 'empty' }. */
export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#/, '');
  let m;
  if (h === 'home' || h === 'papers' || h === 'trash' || h === 'signin') return { name: h };
  if (h === 'library') return { name: 'library', q: '' };
  if ((m = h.match(/^library\?q=(.*)$/s))) return { name: 'library', q: decode(m[1]) };
  if ((m = h.match(new RegExp(`^library/(${OWNER})/(${ID})$`)))) return { name: 'public-paper', owner: m[1], id: m[2] };
  if ((m = h.match(new RegExp(`^paper-(${ID})$`)))) return { name: 'paper', id: m[1] };
  return { name: 'empty' };
}

const MEMBER = new Set(['papers', 'paper', 'trash']);

/** Where this route goes for a visitor (signed out), a member (signed in), or local mode. */
export function resolveRoute(route, { signedIn, apiOn }) {
  const n = route.name;
  /* Local mode has no accounts and no public list: the m1 screens only. */
  if (!apiOn) return n === 'paper' || n === 'papers' ? route : { name: 'papers' };
  if (!signedIn) {
    if (n === 'empty') return { name: 'home' };
    if (MEMBER.has(n)) return { name: 'library', q: '' };
    return route;
  }
  if (n === 'empty' || n === 'signin') return { name: 'papers' };
  return route;
}

/** The hash (without '#') for a route; parseRoute('#' + routeHash(r)) gives r back. */
export function routeHash(route) {
  switch (route.name) {
    case 'home': case 'papers': case 'trash': case 'signin': return route.name;
    case 'library': return route.q ? 'library?q=' + encodeURIComponent(route.q) : 'library';
    case 'public-paper': return `library/${route.owner}/${route.id}`;
    case 'paper': return 'paper-' + route.id;
    default: return '';
  }
}

/** True for the routes only a signed-in member can see. */
export const isMemberRoute = (route) => MEMBER.has(route.name);

let handlers = null;
let context = null;
let skip = null; // the hash a redirect just set; its hashchange is already handled

function run() {
  const asked = parseRoute(location.hash);
  const route = resolveRoute(asked, context());
  if (JSON.stringify(route) !== JSON.stringify(asked)) {
    skip = '#' + routeHash(route);
    location.replace(skip);
  }
  const fn = handlers[route.name];
  if (fn) fn(route);
}

/**
 * handlers: { [route name]: (route) => void }. ctx() -> { signedIn, apiOn }.
 * Listens to hashchange and routes the current hash. With no arguments it routes the current
 * hash again (after sign-in, or once the papers load); before the first call it does nothing.
 */
export function initRouter(h, ctx) {
  if (h) {
    const first = !handlers;
    handlers = h; context = ctx;
    if (first) {
      window.addEventListener('hashchange', () => {
        if (skip && location.hash === skip) { skip = null; return; }
        skip = null;
        /* An in-page anchor, like the skip link's #grid, is not a route. */
        if (parseRoute(location.hash).name === 'empty' && location.hash.length > 1
          && document.getElementById(location.hash.slice(1))) return;
        run();
      });
    }
  }
  if (handlers) run();
}
