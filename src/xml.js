// A small, loss-less XML DOM tailored to HoMM5 `.xdb` files.
//
// The editor must never corrupt a map by rewriting fields it didn't touch, so
// this parser is built for *byte-identical* round-trips, not pretty-printing:
//
//   * Text between tags (including all whitespace/newlines) is kept VERBATIM as
//     text nodes — so indentation and line endings survive untouched.
//   * An element stores the raw attribute segment exactly as written
//     (e.g. ` href="..." id="..."`), so attributes re-emit byte-for-byte unless
//     explicitly changed. A parsed `attrs` map is provided for convenience.
//   * Declarations/comments/doctype (`<?xml?>`, `<!-- -->`, `<!DOCTYPE>`) are kept
//     as verbatim raw nodes.
//
// serialize(parse(text)) === text for the game's xdb files (verified in tests).
// Edits go through helpers that mark only the changed element for re-emission.
//
// Node shapes:
//   { type:'element', name, rawAttrs, attrs, children:[], selfClose, _dirtyAttrs? }
//   { type:'text', text }                       // verbatim, whitespace included
//   { type:'raw',  text }                       // <?...?>, <!--...-->, <!...>
//
// Exports: parse, serialize, and small tree helpers (find, findAll, text, setText…).

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parse(input) {
  const root = { type: 'element', name: '#document', rawAttrs: '', attrs: {}, children: [], selfClose: false };
  const stack = [root];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) { pushText(stack, input.slice(i)); break; }
    if (lt > i) pushText(stack, input.slice(i, lt));

    // Verbatim constructs: declarations, comments, doctype.
    if (input.startsWith('<?', lt)) { const e = input.indexOf('?>', lt) + 2; pushRaw(stack, input.slice(lt, e)); i = e; continue; }
    if (input.startsWith('<!--', lt)) { const e = input.indexOf('-->', lt) + 3; pushRaw(stack, input.slice(lt, e)); i = e; continue; }
    if (input.startsWith('<!', lt)) { const e = input.indexOf('>', lt) + 1; pushRaw(stack, input.slice(lt, e)); i = e; continue; }

    const gt = input.indexOf('>', lt);
    if (gt === -1) { pushText(stack, input.slice(lt)); break; }
    const inner = input.slice(lt + 1, gt); // between < and >

    if (inner[0] === '/') {
      // Closing tag </name>
      const name = inner.slice(1).trim();
      // Pop to the matching element (tolerant of minor mismatches).
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) { stack.length = s; break; }
      }
      i = gt + 1;
      continue;
    }

    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    // Split name from the raw attribute segment (everything after the name,
    // preserved verbatim, e.g. ` href="x" id="y"`).
    const m = /^([^\s/>]+)([\s\S]*)$/.exec(body);
    const name = m[1];
    const rawAttrs = m[2];
    const el = { type: 'element', name, rawAttrs, attrs: parseAttrs(rawAttrs), children: [], selfClose };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
    i = gt + 1;
  }
  return root;
}

function pushText(stack, text) { if (text) stack[stack.length - 1].children.push({ type: 'text', text }); }
function pushRaw(stack, text) { stack[stack.length - 1].children.push({ type: 'raw', text }); }

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1]] = m[2];
  return attrs;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

export function serialize(node) {
  if (node.type === 'text' || node.type === 'raw') return node.text;
  let out = '';
  if (node.name !== '#document') {
    const rawAttrs = node._dirtyAttrs ? buildAttrs(node.attrs) : node.rawAttrs;
    if (node.selfClose) return `<${node.name}${rawAttrs}/>`;
    out += `<${node.name}${rawAttrs}>`;
  }
  for (const c of node.children) out += serialize(c);
  if (node.name !== '#document') out += `</${node.name}>`;
  return out;
}

// Rebuild an attribute segment (used only when attrs were edited). Mirrors the
// game's ` key="value"` style with single-space separators.
function buildAttrs(attrs) {
  const keys = Object.keys(attrs);
  return keys.length ? ' ' + keys.map((k) => `${k}="${attrs[k]}"`).join(' ') : '';
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

// Direct child elements (skips text/raw nodes).
export function children(el) { return el.children.filter((c) => c.type === 'element'); }

// First direct child element with the given name.
export function find(el, name) {
  for (const c of el.children) if (c.type === 'element' && c.name === name) return c;
  return null;
}

// All descendant elements with the given name (depth-first).
export function findAll(el, name, out = []) {
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

// Text content of an element (concatenated verbatim text children, trimmed).
export function text(el) {
  if (!el) return '';
  return el.children.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

// Convenience: text of the first child element named `name`.
export function childText(el, name) { return text(find(el, name)); }

// Replace an element's text content with a single new value, preserving nothing
// of the old text run (leaf value fields only, e.g. <x>40</x>).
export function setText(el, value) {
  el.children = [{ type: 'text', text: String(value) }];
  el.selfClose = false;
}

// Set an attribute and flag the element so serialize() rebuilds its attr segment.
export function setAttr(el, key, value) { el.attrs[key] = value; el._dirtyAttrs = true; }
