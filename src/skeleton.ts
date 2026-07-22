// Build a fresh list item from its schema — a new <Item> with default values,
// so adding a rumour, a building, an army stack or a player writes a complete,
// valid element rather than an empty one the engine would choke on. The shape
// and the defaults come from the schema (src/schema.ts); nothing is guessed.

import type { XmlElement, XmlNode } from './xml.ts';
import type { FieldSchema, HasDefs } from './schema.ts';
import { deref } from './schema.ts';

const textNode = (s: string): XmlNode => ({ type: 'text', text: s } as XmlNode);
const elem = (name: string, kids: XmlNode[], attrs: Record<string, string> = {}): XmlElement =>
  ({ type: 'element', name, attrs, children: kids, _dirtyAttrs: true } as XmlElement);
const selfClose = (name: string, attrs: Record<string, string> = {}): XmlElement =>
  ({ ...elem(name, [], attrs), selfClose: true } as XmlElement);

/**
 * The value a fresh field takes: its schema `default`, else the natural zero for
 * its type — `false`, `0`, a `*_NONE`/`*_UNKNOWN` enum member when there is one,
 * or empty. Empty is written as a self-closing tag, so it round-trips cleanly.
 */
export function defaultFor(f: FieldSchema): string {
  // Structured defaults (a town's buildings, a quest) are a whole subtree and
  // belong to src/defaults.ts; here only a scalar can be written as text.
  if (f.default !== undefined && typeof f.default !== 'object') return String(f.default);
  if (f.enum && f.enum.length) return f.enum.find((v) => /_(NONE|UNKNOWN)$/.test(v)) ?? f.enum[0]!;
  if (f.type === 'boolean') return 'false';
  if (f.type === 'integer' || f.type === 'number') return '0';
  return '';
}

/** Whether a schema describes a structure we can build (has named fields). */
export function isBuildable(itemSchema: FieldSchema | null): boolean {
  return !!itemSchema?.properties && Object.keys(itemSchema.properties).length > 0;
}

/**
 * A new `<Item>` for a list, indented to sit among its siblings. `indent` is the
 * whitespace that precedes an item in the target list (e.g. "\n\t\t\t"); nested
 * fields step one tab deeper.
 */
export function buildItem(root: HasDefs, itemSchema: FieldSchema, indent: string): XmlElement {
  return buildStruct(root, 'Item', itemSchema, indent);
}

/**
 * A fresh entity document body — a `<ClassName>` element with default fields,
 * for "New" on a referenced object (a new AdvMapBirds/Wind/AmbientLight saved
 * beside the map). The element is named for the class (also its root/xpointer),
 * not `Item`. Returns null when the schema has no fields to build from.
 */
export function buildEntity(root: HasDefs, className: string, schema: FieldSchema, indent = ''): XmlElement | null {
  if (!isBuildable(schema)) return null;
  return buildStruct(root, className, schema, indent);
}

function buildStruct(root: HasDefs, name: string, schema: FieldSchema, indent: string): XmlElement {
  const inner = indent + '\t';
  const kids: XmlNode[] = [];
  for (const [k, raw] of Object.entries(schema.properties ?? {})) {
    kids.push(textNode(inner), buildField(root, k, deref(root, raw), inner));
  }
  kids.push(textNode(indent));
  return elem(name, kids);
}

function buildField(root: HasDefs, name: string, f: FieldSchema, indent: string): XmlElement {
  // A populated nested structure; an empty one self-closes.
  if (f.type === 'object' && f.properties && Object.keys(f.properties).length) {
    return buildStruct(root, name, f, indent);
  }
  if (f.type === 'array' || f.type === 'object') return selfClose(name);
  if (f['x-ref']) return selfClose(name, { href: defaultFor(f) });
  const v = defaultFor(f);
  return v ? elem(name, [textNode(v)]) : selfClose(name);
}
