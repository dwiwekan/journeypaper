// A tiny DOM for Node tests of cleanInline: an HTML tokenizer, a tree, and a serializer that
// escapes text. Enough for the sanitizer's walk; not a browser parser.
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr']);
const RAW = new Set(['script', 'style']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

class TextNode {
  constructor(v) { this.nodeType = 3; this.nodeValue = v; }
  get textContent() { return this.nodeValue; }
}
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.childNodes = []; if (tag === 'template') this.content = new El('#fragment'); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  set href(v) { this.setAttribute('href', v); }
  set target(v) { this.setAttribute('target', v); }
  set rel(v) { this.setAttribute('rel', v); }
  set title(v) { this.setAttribute('title', v); }
  appendChild(n) { this.childNodes.push(n); return n; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  get innerHTML() { return (this.content || this).childNodes.map(serialize).join(''); }
  set innerHTML(h) { (this.content || this).childNodes = parse(String(h)); }
}
function serialize(n) {
  if (n.nodeType === 3) return escText(n.nodeValue);
  const t = n.tagName.toLowerCase();
  const a = [...n.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  return VOID.has(t) ? `<${t}${a}>` : `<${t}${a}>${n.childNodes.map(serialize).join('')}</${t}>`;
}
function parse(html) {
  const root = new El('#fragment');
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const t = m[1].toLowerCase();
      const i = stack.map((e) => e.tagName.toLowerCase()).lastIndexOf(t);
      if (i > 0) stack.length = i;
      continue;
    }
    if (m[2]) {
      const t = m[2].toLowerCase();
      const el = new El(t);
      for (const a of m[3].matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      }
      top().appendChild(el);
      if (RAW.has(t)) {
        const end = html.toLowerCase().indexOf(`</${t}`, re.lastIndex);
        const stop = end < 0 ? html.length : end;
        el.appendChild(new TextNode(html.slice(re.lastIndex, stop)));
        re.lastIndex = stop;
      } else if (!VOID.has(t)) stack.push(el);
      continue;
    }
    top().appendChild(new TextNode(decode(m[0])));
  }
  return root.childNodes;
}

export function installMiniDom() {
  globalThis.document = { createElement: (t) => new El(t), createTextNode: (v) => new TextNode(v) };
}
