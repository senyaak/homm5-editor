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

/** The document's text, or a refusal that names the path and the roots searched. */
export function readText(root: DataRoot, rel: string, encoding: BufferEncoding = 'utf8'): string {
  const data = toAssets(root);
  const text = data.text(docPath(rel), encoding);
  if (text === null) throw new Error(`${rel}: not in any mounted root (${data.roots.join(', ')})`);
  return text;
}

/** The document's bytes, or the same refusal. */
export function readBytes(root: DataRoot, rel: string): Buffer {
  const data = toAssets(root);
  const bytes = data.bytes(docPath(rel));
  if (bytes === null) throw new Error(`${rel}: not in any mounted root (${data.roots.join(', ')})`);
  return bytes;
}

/** The real file behind a path — for the readers that take a filename. */
export function filePath(root: DataRoot, rel: string): string {
  const data = toAssets(root);
  const p = docPath(rel);
  if (!data.exists(p)) throw new Error(`${rel}: not in any mounted root (${data.roots.join(', ')})`);
  return data.path(p);
}
