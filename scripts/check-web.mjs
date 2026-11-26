// Static checks for the front-end in web/. No dependencies; run with Node 20+.
// Usage: node --expose-internals scripts/check-web.mjs   (or: make check)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const JS = join(WEB, 'js');
const CSS_ORDER = ['tokens', 'base', 'layout', 'catalog', 'dialogs', 'paper', 'editor', 'responsive'];
const ID_COMMENT_WORDS = /\b(dasar|tombol|kartu|kosong|layar kecil|Tata letak|bar atas|pembuka|halaman paper|editor blok)\b/;

let failures = 0;
const fail = (file, reason) => { failures++; console.log(`FAIL ${relative(ROOT, file)}: ${reason}`); };

function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

if (!existsSync(WEB)) {
  fail(WEB, 'web/ does not exist');
  process.exit(1);
}

const jsFiles = walk(JS, '.js');
if (!jsFiles.length) fail(JS, 'no JavaScript modules found');

// 1. Syntax.
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--experimental-default-type=module', '--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(f, 'syntax error\n' + (r.stderr || '').split('\n').slice(0, 6).join('\n'));
}

// Collect exports per file.
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(s.split(/\s+as\s+/).pop().trim()));
  }
  return names;
}
const exportsCache = new Map();
const getExports = (f) => { if (!exportsCache.has(f)) exportsCache.set(f, exportsOf(readFileSync(f, 'utf8'))); return exportsCache.get(f); };

for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(JS, f);

  // 2. Imports resolve to real files and real exports.
  for (const m of src.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    const spec = m[2];
    if (!spec.startsWith('.')) { fail(f, `bare import "${spec}" (no packages allowed)`); continue; }
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) { fail(f, `imports missing file ${spec}`); continue; }
    const have = getExports(target);
    (m[1] || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const name = s.split(/\s+as\s+/)[0].trim();
      if (!have.has(name)) fail(f, `"${name}" is not exported by ${spec}`);
    });
  }

  // 3. Lower layers never import ui/.
  if (/^(data|services|editor)\//.test(rel) || rel === 'util.js' || rel === 'config.js') {
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (resolve(dirname(f), m[1]).startsWith(join(JS, 'ui'))) fail(f, `lower layer imports ui module ${m[1]}`);
    }
  }

  // 4. Only the store touches IndexedDB.
  if (rel !== join('data', 'store.js') && /\bindexedDB\b/.test(src)) fail(f, 'uses indexedDB outside data/store.js');

  // 5. ui modules do no work at import time.
  if (rel.startsWith('ui' + '/') || rel.startsWith('ui\\')) {
    src.split('\n').forEach((line, i) => {
      if (/^[A-Za-z_$][\w$.]*\s*\(/.test(line) && !/^(import|export|const|let|function|async)\b/.test(line)) {
        fail(f, `line ${i + 1}: top-level call runs at import time: ${line.trim().slice(0, 60)}`);
      }
    });
  }
}

// 6. index.html wiring.
const indexPath = join(WEB, 'index.html');
if (!existsSync(indexPath)) fail(indexPath, 'missing');
else {
  const html = readFileSync(indexPath, 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map((m) => m[1]);
  const want = CSS_ORDER.map((n) => `css/${n}.css`);
  if (JSON.stringify(links) !== JSON.stringify(want)) fail(indexPath, `stylesheet order is ${JSON.stringify(links)}, want ${JSON.stringify(want)}`);
  links.forEach((l) => { if (!existsSync(join(WEB, l))) fail(indexPath, `links missing ${l}`); });
  const local = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"/g)].filter((m) => !/^https?:/.test(m[2]));
  if (local.length !== 1 || local[0][2] !== 'js/main.js' || !/type="module"/.test(local[0][1])) {
    fail(indexPath, 'the only local script must be <script type="module" src="js/main.js">');
  }
}

// 7. Comments are in English.
for (const f of [...walk(WEB, '.css'), ...jsFiles, indexPath].filter((p) => existsSync(p) && !p.includes(join('web', 'tests')))) {
  const comments = (readFileSync(f, 'utf8').match(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g) || []).join('\n');
  if (ID_COMMENT_WORDS.test(comments)) fail(f, 'comment still in Indonesian');
}

// 8. Every name a module uses is declared, imported, or a browser global.
//    Uses the acorn parser bundled inside Node (needs --expose-internals). Scope is file-wide,
//    which is enough to catch a forgotten import after moving code between files.
const BROWSER = new Set(('window document location history localStorage sessionStorage indexedDB navigator '
  + 'console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame '
  + 'queueMicrotask structuredClone crypto URL Blob File FileReader Image Event CustomEvent Node NodeFilter '
  + 'HTMLElement Element Range getComputedStyle matchMedia fetch Intl JSON Math Date Number String Boolean '
  + 'Array Object Map Set WeakMap WeakSet Promise RegExp Error TypeError Symbol Infinity NaN undefined '
  + 'parseInt parseFloat isNaN encodeURIComponent decodeURIComponent globalThis performance alert confirm').split(' '));
let acorn = null, acornWalk = null;
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  acorn = req('internal/deps/acorn/acorn/dist/acorn');
  acornWalk = req('internal/deps/acorn/acorn-walk/dist/walk');
} catch (e) { fail(join(ROOT, 'scripts'), 'run with node --expose-internals to enable the undeclared-name check'); }
if (acorn) {
  const names = (p, out) => {
    if (!p) return;
    if (p.type === 'Identifier') out.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => names(x.type === 'RestElement' ? x.argument : x.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((x) => names(x, out));
    else if (p.type === 'AssignmentPattern') names(p.left, out);
    else if (p.type === 'RestElement') names(p.argument, out);
  };
  for (const f of jsFiles) {
    let ast;
    try { ast = acorn.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }); } catch (e) { continue; }
    const declared = new Set();
    const used = new Map();
    acornWalk.fullAncestor(ast, (node, _st, anc) => {
      const parent = anc[anc.length - 2];
      switch (node.type) {
        case 'VariableDeclarator': names(node.id, declared); break;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
          if (node.id) declared.add(node.id.name); node.params.forEach((p) => names(p, declared)); break;
        case 'ClassDeclaration': if (node.id) declared.add(node.id.name); break;
        case 'CatchClause': names(node.param, declared); break;
        case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': declared.add(node.local.name); break;
        case 'Identifier': {
          if (!parent) break;
          if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) break;
          if (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) break;
          if (parent.type === 'MethodDefinition' && parent.key === node) break;
          if (/^(LabeledStatement|BreakStatement|ContinueStatement|ImportSpecifier|ExportSpecifier)$/.test(parent.type)) break;
          if (!used.has(node.name)) used.set(node.name, node.start);
          break;
        }
        default: break;
      }
    });
    for (const [name] of used) if (!declared.has(name) && !BROWSER.has(name)) fail(f, `"${name}" is used but never declared or imported`);
  }
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log(`OK: ${jsFiles.length} modules, ${walk(WEB, '.css').length} stylesheets`);
