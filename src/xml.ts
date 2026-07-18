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
// Node types
// ---------------------------------------------------------------------------

/** A tag. `rawAttrs` is the verbatim attribute segment; `attrs` is its parsed
 *  form. Set `_dirtyAttrs` (via setAttr) to make serialize() rebuild the segment
 *  from `attrs` instead of re-emitting `rawAttrs`. The parse root is an element
 *  named '#document'. */
export interface XmlElement {
  type: 'element';
  name: string;
  rawAttrs: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  selfClose: boolean;
  _dirtyAttrs?: boolean;
}

/** Character data between tags, kept verbatim (whitespace and newlines included). */
export interface XmlText {
  type: 'text';
  text: string;
}

/** A verbatim construct re-emitted untouched: `<?...?>`, `<!--...-->`, `<!...>`. */
export interface XmlRaw {
  type: 'raw';
  text: string;
}

/** Any node in the document tree, discriminated by `type`. */
export type XmlNode = XmlElement | XmlText | XmlRaw;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parse(input: string): XmlElement {
  const root: XmlElement = { type: 'element', name: '#document', rawAttrs: '', attrs: {}, children: [], selfClose: false };
  const stack: XmlElement[] = [root];
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
    // Only a malformed tag (no name, e.g. a bare `<` in character data) fails to
    // match; the old code threw a TypeError on `m[1]` here.
    if (!m) throw new Error(`xml: malformed tag at offset ${lt}: <${inner}>`);
    const name = m[1];
    const rawAttrs = m[2];
    const el: XmlElement = { type: 'element', name, rawAttrs, attrs: parseAttrs(rawAttrs), children: [], selfClose };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
    i = gt + 1;
  }
  return root;
}

function pushText(stack: XmlElement[], text: string): void { if (text) stack[stack.length - 1].children.push({ type: 'text', text }); }
function pushRaw(stack: XmlElement[], text: string): void { stack[stack.length - 1].children.push({ type: 'raw', text }); }

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]] = m[2];
  return attrs;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

export function serialize(node: XmlNode): string {
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
function buildAttrs(attrs: Record<string, string>): string {
  const keys = Object.keys(attrs);
  return keys.length ? ' ' + keys.map((k) => `${k}="${attrs[k]}"`).join(' ') : '';
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

// Direct child elements (skips text/raw nodes).
export function children(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element');
}

// First direct child element with the given name.
export function find(el: XmlElement, name: string): XmlElement | null {
  for (const c of el.children) if (c.type === 'element' && c.name === name) return c;
  return null;
}

// All descendant elements with the given name (depth-first).
export function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

// Text content of an element (concatenated verbatim text children, trimmed).
// Accepts null/undefined so callers can chain find() results without a guard.
export function text(el: XmlElement | null | undefined): string {
  if (!el) return '';
  return el.children.filter((c): c is XmlText => c.type === 'text').map((c) => c.text).join('').trim();
}

// Convenience: text of the first child element named `name`.
export function childText(el: XmlElement, name: string): string { return text(find(el, name)); }

// Replace an element's text content with a single new value, preserving nothing
// of the old text run (leaf value fields only, e.g. <x>40</x>).
export function setText(el: XmlElement, value: string | number): void {
  el.children = [{ type: 'text', text: String(value) }];
  el.selfClose = false;
}

// Empty an element and write it as `<Name/>`.
//
// Not the same as setText(el, ''), which leaves `<Name></Name>`. The maps write
// every empty field self-closed, and matching that keeps a new object looking
// like the ones beside it — and keeps diffs to what actually changed.
export function clearElement(el: XmlElement): void {
  el.children = [];
  el.selfClose = true;
}

// Set an attribute and flag the element so serialize() rebuilds its attr segment.
export function setAttr(el: XmlElement, key: string, value: string): void { el.attrs[key] = value; el._dirtyAttrs = true; }
