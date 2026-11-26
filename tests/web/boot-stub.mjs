// A do-nothing DOM for booting main.js in Node, in API mode with no stored session.
function stub() {
  const fn = function () {};
  const handler = {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    has() { return true; },
    deleteProperty() { return true; },
  };
  const proxy = new Proxy(fn, handler);
  return proxy;
}
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

/** Installs the globals; returns the fetch calls and the location.replace targets as they happen. */
export function stubDom(hash) {
  const calls = [], replaced = [];
  globalThis.window = globalThis;
  globalThis.document = stub();
  globalThis.location = { hash, hostname: 'localhost', replace(h) { replaced.push(h); this.hash = h; }, reload() {} };
  globalThis.localStorage = memStorage({ 'jp:api': 'http://api.test' });
  globalThis.sessionStorage = memStorage();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.addEventListener = () => {};
  globalThis.requestAnimationFrame = () => 0;
  globalThis.scrollTo = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers && init.headers.Authorization });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, replaced };
}
