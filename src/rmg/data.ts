// Where the generator's data comes from: the MOUNTED install, never one folder.
//
// The engine reads every document through its archive chain — `data/*.pak`,
// then whatever is mounted over them — so a mod that overrides the preset
// table, a tile, a shared document or the creature roster changes the map the
// generator makes. The port reads through the same chain (`src/game/assets.ts`;
// `src/game/mounted.ts` builds it the way the executable does). A plain
// directory is a chain of one, for the tools and tests that predate mounting.
//
// Hrefs arrive as the documents spell them — `/MapObjects/X.xdb#xpointer(…)` —
// and the chain wants a root-relative path, so this is also where the leading
// slash and the pointer come off.

import { toAssets } from '../game/assets.ts';
import type { Assets } from '../game/assets.ts';

export type DataRoot = string | Assets;

export { toAssets };

/** `/A/B.xdb#xpointer(/Tag)` → `A/B.xdb`. */
export function docPath(href: string): string {
  return href.replace(/#xpointer\(.*\)$/, '').replace(/#.*$/, '').replace(/^\/+/, '');
}

/**
 * The refusal for a document no root has — a sentence, with the roots on
 * the console rather than in it: a dialog shows this line, and eleven
 * paths of mounted archives are not what it needs to say.
 */
function missing(data: Assets, rel: string): Error {
  console.warn(`[rmg] ${rel}: not in any mounted root — searched ${data.roots.join(', ')}`);
  return new Error(`the generator needs ${rel}, and neither the game's data nor any mounted archive has it (${data.roots.length} roots searched — the console lists them)`);
}

/** The document's text, or a refusal that names the path. */
export function readText(root: DataRoot, rel: string, encoding: BufferEncoding = 'utf8'): string {
  const data = toAssets(root);
  const text = data.text(docPath(rel), encoding);
  if (text === null) throw missing(data, rel);
  return text;
}

/** The document's bytes, or the same refusal. */
export function readBytes(root: DataRoot, rel: string): Buffer {
  const data = toAssets(root);
  const bytes = data.bytes(docPath(rel));
  if (bytes === null) throw missing(data, rel);
  return bytes;
}

/**
 * An enum's numbering out of the editor's type listing — `types.xml`, read
 * through the chain so a mod's copy wins. The executable compares a building's
 * `Type` as a number; the map file spells it as a name; this is the bridge.
 */
export function readEnumValues(root: DataRoot, typeName: string): Map<number, string> {
  const xml = readText(root, 'types.xml');
  const at = xml.indexOf(`<TypeName>${typeName}</TypeName>`);
  if (at < 0) throw new Error(`types.xml: no type ${typeName}`);
  const entries = xml.indexOf('<Entries>', at);
  const end = xml.indexOf('</Entries>', entries);
  if (entries < 0 || end < 0) throw new Error(`types.xml: ${typeName} has no entries`);
  const out = new Map<number, string>();
  for (const m of xml.slice(entries, end).matchAll(/<Name>([^<]+)<\/Name>\s*<Value>(-?\d+)<\/Value>/g)) {
    out.set(Number.parseInt(m[2]!, 10), m[1]!);
  }
  return out;
}

/** The real file behind a path — for the readers that take a filename. */
export function filePath(root: DataRoot, rel: string): string {
  const data = toAssets(root);
  const p = docPath(rel);
  if (!data.exists(p)) throw missing(data, rel);
  return data.path(p);
}

/** An enum's names by value, densely from 0 — the order a map file's index means. */
export function enumNames(root: DataRoot, typeName: string): string[] {
  const byValue = readEnumValues(root, typeName);
  const out: string[] = [];
  for (let v = 0; byValue.has(v); v++) out.push(byValue.get(v)!);
  return out;
}
