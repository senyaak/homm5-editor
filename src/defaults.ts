// Put a newly placed object into the state the original editor would have
// written it in.
//
// A new object is built by cloning one of the same type — from this map if it
// has one, else from a shipped map (src/donors.ts). That is what makes its
// FIELD SET right: the set differs per type, per game version and per mod, and
// a real object is correct by construction where a hand-written template is 21
// chances to be wrong.
//
// But a donor is an object a designer TUNED. The town in the game's own maps
// carries 21 buildings and no guild spells; the monster carries Amount 4 and
// Custom true. Cloning it and stopping there hands the user someone else's
// design and calls it a new object.
//
// So: the donor supplies the fields, the schema supplies the values. The
// defaults in src/objects.schema.json are measured off a map the original saved
// with one of each type placed and left alone — see docs/OBJECT_DEFAULTS.md.
//
// Two rules that fall out of this split:
//
//   * A field the donor does not have is NOT created. The donor is the
//     authority on what this type carries here; inventing a field the engine
//     did not ask for is how a map stops loading. It is also what keeps one
//     `Editable` default usable for both the hero (fourteen fields) and the
//     town (two of them).
//   * A field with no measured default is left as the donor wrote it. That is
//     visible drift, not silence: the test in tools/test-defaults.ts compares
//     a placed object against the measured map and reports every field that
//     still differs.

import { find, setText, setAttr, clearElement } from './xml.ts';
import type { XmlElement, XmlNode } from './xml.ts';
import { objectSchema, objectProps, deref } from './schema.ts';
import type { FieldSchema, RegistryName } from './schema.ts';

/**
 * A measured default, as written in the schema.
 *
 * `null` is not "no default" — it is the second of the two empty forms the game
 * writes for a reference. Some empty refs keep the attribute
 * (`<MessageFileRef href=""/>`), others drop it entirely
 * (`<Specialization/>`, `<CombatScript/>`, a hero's `<Icon128x128/>`), and
 * which is which is per field, measured, not ours to pick. `""` is the first
 * form, `null` the second.
 */
export type DefaultValue = string | number | boolean | null | DefaultValue[] | { [k: string]: DefaultValue };

export interface DefaultsOptions {
  /**
   * The full roster behind an `x-registry` name, for the fields whose default
   * is "everything" (a town's guild spells). Installation-dependent, so it
   * cannot live in the schema. Without it those fields are left alone.
   */
  roster?: (name: RegistryName) => string[];
}

const textNode = (s: string): XmlNode => ({ type: 'text', text: s } as XmlNode);

/** A fresh element, written by us rather than parsed — so its attributes have
 *  to be rebuilt on serialize (`_dirtyAttrs`). */
const elem = (name: string, kids: XmlNode[] = []): XmlElement =>
  ({ type: 'element', name, rawAttrs: '', attrs: {}, children: kids, selfClose: false, _dirtyAttrs: true });

/** The whitespace an element indents its children with, and the one before its
 *  closing tag — copied from what is already there so the file keeps its shape. */
function indentsOf(el: XmlElement): { inner: string; close: string } {
  const texts = el.children.filter((n): n is Extract<XmlNode, { type: 'text' }> => n.type === 'text');
  const close = texts.length ? texts[texts.length - 1]!.text : '\n';
  const inner = texts.length > 1 ? texts[0]!.text : close + '\t';
  return { inner, close };
}

/** `<Item>` carrying a plain value. */
function valueItem(v: DefaultValue): XmlElement {
  return elem('Item', [textNode(String(v))]);
}

/** `<Item>` carrying named fields — a building, an army stack. */
function structItem(v: Record<string, DefaultValue>, indent: string): XmlElement {
  const inner = indent + '\t';
  const kids: XmlNode[] = [];
  for (const [k, val] of Object.entries(v)) {
    const child = elem(k);
    writeInto(child, val);
    kids.push(textNode(inner), child);
  }
  kids.push(textNode(indent));
  return elem('Item', kids);
}

/**
 * Write a default into an element that already exists.
 *
 * Empty — '', [], {} — is written as a self-closing tag, which is how the game
 * writes an unset field and what our round trip expects back.
 */
function writeInto(el: XmlElement, value: DefaultValue): void {
  // Empty AND attribute-less — the `<Specialization/>` form. Dropping the href
  // is the whole point, so it happens before the ref branch below.
  if (value === null) { delete el.attrs.href; el._dirtyAttrs = true; clearElement(el); return; }
  if (Array.isArray(value)) {
    if (!value.length) { clearElement(el); return; }
    const { close } = indentsOf(el);
    const itemIndent = close + '\t';
    const kids: XmlNode[] = [];
    for (const v of value) {
      kids.push(textNode(itemIndent));
      kids.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? structItem(v, itemIndent) : valueItem(v));
    }
    kids.push(textNode(close));
    el.children = kids;
    el.selfClose = false;
    return;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) { clearElement(el); return; }
    // Only fields the object already has — see the header.
    for (const k of keys) {
      const child = find(el, k);
      if (child) writeInto(child, value[k]!);
    }
    return;
  }
  // A ref carries its value in href, never as text.
  if (el.attrs.href !== undefined) { setAttr(el, 'href', String(value)); el.children = []; el.selfClose = true; return; }
  if (value === '') clearElement(el);
  else setText(el, String(value));
}

/** The default declared for a field, resolving `x-defaultAll` against a roster. */
function defaultOf(f: FieldSchema, opt: DefaultsOptions): DefaultValue | undefined {
  if (f['x-defaultAll']) {
    const reg = f['x-registry'];
    const all = reg && opt.roster ? opt.roster(reg) : null;
    return all ?? undefined;
  }
  return f.default as DefaultValue | undefined;
}

/**
 * Apply the measured defaults to a placed object's body (`<AdvMapMonster>`…).
 * Returns the names of the fields it wrote, so a caller can report what it did
 * and a test can see that it did anything at all.
 *
 * `Name` is skipped: it is generated per placement, not constant — see
 * HommMap.nextName() and the naming item in ROADMAP.
 */
export function applyDefaults(body: XmlElement, type: string, opt: DefaultsOptions = {}): string[] {
  const props = objectProps(type);
  const written: string[] = [];
  for (const [name, raw] of Object.entries(props)) {
    const f = deref(objectSchema, raw);
    if (f['x-nameOf']) continue;
    const value = defaultOf(f, opt);
    if (value === undefined) continue;
    const el = find(body, name);
    if (!el) continue;
    writeInto(el, value);
    written.push(name);
  }
  return written;
}

/** Every field of a type that carries no measured default — what a placed
 *  object still inherits from its donor. Reported by the defaults test. */
export function undefaulted(type: string, opt: DefaultsOptions = {}): string[] {
  return Object.entries(objectProps(type))
    .filter(([, raw]) => defaultOf(deref(objectSchema, raw), opt) === undefined)
    .map(([name]) => name);
}

