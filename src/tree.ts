// Path-addressable structured read/write over a map's XML subtree — what the
// tree editor stands on. The generic property flow in map.ts only reaches flat
// leaves; the tree needs to read the whole shape and write a value anywhere in
// it (players[0].Race, a moon's State, a spell in a list).
//
// A path is a list of steps: a string picks a named child, a number picks the
// nth <Item> of a list. Kept deliberately schema-free — it moves values by
// position in the DOM; the schema (src/schema.ts) decides how each is shown.

import type { XmlElement, XmlNode } from './xml.ts';
import { children, find, text, setText, setAttr } from './xml.ts';

/** A step into the tree: a field name, or a list index. */
export type PathStep = string | number;
export type Path = PathStep[];

/** The data at a node: a leaf value, a list, or a keyed structure. */
export type TreeData = string | TreeData[] | { [key: string]: TreeData };

/**
 * Read an element's value as plain data, mirroring the XML shape:
 * - no element children -> the leaf value (its href if it carries one, else its
 *   text), so a ref and a value read the same way;
 * - all children are <Item> -> a list;
 * - otherwise -> an object keyed by child element name.
 *
 * An empty container reads as '' (it has no element children); the schema is
 * what tells the caller it is really an empty list, so this does not have to.
 */
export function readTree(el: XmlElement): TreeData {
  const els = children(el);
  if (els.length === 0) return el.attrs.href !== undefined ? el.attrs.href : text(el);
  if (els.every((c) => c.name === 'Item')) return els.map(readTree);
  const out: Record<string, TreeData> = {};
  for (const c of els) out[c.name] = readTree(c);
  return out;
}

/** The element a path points at, or null if any step is missing. */
export function nodeAt(root: XmlElement, path: Path): XmlElement | null {
  let cur: XmlElement | null = root;
  for (const step of path) {
    if (!cur) return null;
    if (typeof step === 'number') {
      cur = children(cur).filter((c) => c.name === 'Item')[step] ?? null;
    } else {
      cur = find(cur, step);
    }
  }
  return cur;
}

/**
 * Set a leaf's value. Writes the href when the target carries one (a reference),
 * the text otherwise. False when the path misses or lands on a structure —
 * a structure has no single value to set.
 */
export function setPath(root: XmlElement, path: Path, value: string): boolean {
  const el = nodeAt(root, path);
  if (!el || children(el).length) return false;
  if (el.attrs.href !== undefined) setAttr(el, 'href', value);
  else setText(el, value);
  return true;
}

/** The indentation text node used between an element's children, if any. */
function indentOf(container: XmlElement): XmlNode | null {
  // The whitespace text node before the first element child is the item indent;
  // matching it keeps the file's shape when we add a sibling.
  const kids = container.children;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]!;
    if (k.type === 'element') return i > 0 && kids[i - 1]!.type === 'text' ? kids[i - 1]! : null;
  }
  return null;
}

/**
 * Append `<Item>value</Item>` to a string list (spellIDs, artifactIDs, banned
 * races…). For lists of plain enum/ref values only — struct-item lists (players,
 * buildings) are cloned elsewhere. Returns false if the path is not a container.
 */
export function addStringItem(root: XmlElement, containerPath: Path, value: string): boolean {
  const container = nodeAt(root, containerPath);
  if (!container) return false;
  const item: XmlElement = {
    type: 'element', name: 'Item', attrs: {},
    children: [{ type: 'text', text: value } as XmlNode], _dirtyAttrs: true,
  } as XmlElement;
  const arr = container.children;
  const indent = indentOf(container);
  // Insert before the container's closing whitespace, indented like its siblings.
  const last = arr[arr.length - 1];
  if (indent) arr.splice(last && last.type === 'text' ? arr.length - 1 : arr.length, 0, { ...indent }, item);
  else arr.push(item);
  return true;
}

/**
 * Remove the list item a path ends at (its last step is the index). Also drops
 * the indentation text node *before* it — the whitespace that belongs to this
 * item — so the container keeps its shape and an add followed by a remove is a
 * no-op. (The object list removes the *trailing* node instead; there the item
 * carries a blank line after it, here it carries its indent before it.)
 */
export function removeItem(root: XmlElement, itemPath: Path): boolean {
  if (!itemPath.length || typeof itemPath[itemPath.length - 1] !== 'number') return false;
  const container = nodeAt(root, itemPath.slice(0, -1));
  const item = nodeAt(root, itemPath);
  if (!container || !item) return false;
  const arr = container.children;
  const idx = arr.indexOf(item);
  if (idx === -1) return false;
  const prev = arr[idx - 1];
  if (prev && prev.type === 'text' && /^\s*$/.test(prev.text)) arr.splice(idx - 1, 2);
  else arr.splice(idx, 1);
  return true;
}
