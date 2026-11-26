// Talks to Supabase Auth (sign-in, token refresh) and to our API with the current token.
// Uses fetch only; no supabase-js. The session is kept in localStorage under SESSION_KEY.
import { SUPABASE_URL, SUPABASE_KEY, SESSION_KEY, API_BASE } from '../config.js';

export class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; }
}
export class ApiError extends Error {
  /** status 0 means the request never reached the server (offline, DNS, CORS). */
  constructor(status, code, body, message) {
    super(message || (status ? `Request failed (${status})` : 'Could not reach the server.'));
    this.name = 'ApiError'; this.status = status; this.code = code; this.body = body;
  }
}

const EARLY_S = 60; // refresh this many seconds before the token expires

export function createApi({ fetchImpl = (...a) => fetch(...a), storage = globalThis.localStorage, now = () => Date.now(), base = API_BASE } = {}) {
  let current = null; // the session this tab is using
  let loaded = false;
  let refreshing = null;
  const handlers = new Set();
  const nowS = () => Math.floor(now() / 1000);
  const fresh = (s) => !!(s && s.access_token && s.expires_at - EARLY_S > nowS());

  function read() {
    try {
      const s = JSON.parse((storage && storage.getItem(SESSION_KEY)) || 'null');
      return s && s.access_token && s.refresh_token ? s : null;
    } catch (e) { return null; }
  }
  function save(s) { current = s; try { storage && storage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* private mode: keep it in memory */ } }
  function forget() { current = null; try { storage && storage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
  function session() { if (!loaded) { current = read(); loaded = true; } return current; }
  function endSession() {
    forget();
    handlers.forEach((fn) => { try { fn(); } catch (e) { /* a handler must not block the others */ } });
    throw new AuthError('Your session ended. Please sign in again.');
  }

  async function goTrue(path, body, token) {
    const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let r;
    try { r = await fetchImpl(`${SUPABASE_URL}/auth/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) }); } catch (e) {
      throw new ApiError(0, 'network', null, 'Could not reach the sign-in service. Check your connection.');
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { r, data };
  }
  const toSession = (d) => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Number(d.expires_at) || nowS() + (Number(d.expires_in) || 3600),
    user: { id: d.user && d.user.id, email: d.user && d.user.email },
  });

  async function signIn(email, password) {
    const { r, data } = await goTrue('token?grant_type=password', { email, password });
    if (!r.ok) throw new AuthError((data && (data.error_description || data.msg)) || 'Could not sign in.');
    loaded = true;
    save(toSession(data));
    return current;
  }

  async function signOut() {
    const s = session();
    /* scope=local: only this device. GoTrue's default signs out every device. */
    if (s) { try { await goTrue('logout?scope=local', {}, s.access_token); } catch (e) { /* signing out locally is enough */ } }
    forget();
  }

  async function doRefresh() {
    /* Another tab may have refreshed already. Its token is as good as ours, and our refresh
       token may already be used up, so take it instead of refreshing again. */
    const stored = read();
    if (fresh(stored) && (!current || stored.access_token !== current.access_token)) { current = stored; return current; }
    const s = stored || current;
    if (!s) return endSession();
    const { r, data } = await goTrue('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (r.ok) { save(toSession(data)); return current; }
    if (r.status >= 500) throw new ApiError(r.status, 'auth_unavailable', data, 'The sign-in service is having trouble. Try again soon.');
    const again = read();
    if (fresh(again) && again.access_token !== s.access_token) { current = again; return current; }
    return endSession();
  }
  function refresh() {
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function request(method, path, { body, headers = {} } = {}) {
    if (!session()) return endSession();
    if (!fresh(current)) await refresh();
    const send = async () => {
      const h = { Authorization: `Bearer ${current.access_token}`, ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      try {
        return await fetchImpl(`${base}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
      } catch (e) { throw new ApiError(0, 'network', null, 'Could not reach the server. Check your connection.'); }
    };
    let r = await send();
    if (r.status === 401) {
      await refresh();
      r = await send();
      if (r.status === 401) return endSession();
    }
    return r;
  }

  /** A visitor's request: no token, and the stored session is never read, refreshed or ended. */
  async function publicRequest(method, path) {
    try {
      return await fetchImpl(`${base}/api/v1${path}`, { method });
    } catch (e) { throw new ApiError(0, 'network', null, 'Could not reach the server. Check your connection.'); }
  }

  /** The signed-in user's id from the stored session, without a network call. */
  function userId() {
    const s = session();
    return (s && s.user && s.user.id) || null;
  }

  function onSignedOut(fn) { handlers.add(fn); return () => handlers.delete(fn); }

  return { signIn, signOut, session, refresh, request, publicRequest, userId, onSignedOut };
}

export const api = createApi();
