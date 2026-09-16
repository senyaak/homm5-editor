// The executable the generator is bound to — read once, handed through.
//
// Every table the port used to hold as a literal comes out of the game's
// image (`src/exe/rmg-tables.ts`); the chain takes the decoded set as an
// input and passes each module the part it consumes. Reading the image costs
// a second or so, and a process runs the generator many times, so the read
// is memoized by path.

import { readRmgExeTables } from '../exe/rmg-tables.ts';
import type { RmgExeTables } from '../exe/rmg-tables.ts';

export type { RmgExeTables };

const cache = new Map<string, RmgExeTables>();

/** The tables of the executable at `path`, read once per process. */
export function exeTables(path: string): RmgExeTables {
  let t = cache.get(path);
  if (!t) {
    t = readRmgExeTables(path);
    cache.set(path, t);
  }
  return t;
}

/**
 * `/MapObjects/Shrine_Of_Magic_1.(AdvMapShrineShared).xdb#xpointer(…)` →
 * `Shrine_Of_Magic_1` — the name a document's href carries, for the modules
 * that key their tables by it.
 */
export function objectName(href: string): string {
  const file = href.replace(/#.*$/, '').split('/').pop() ?? '';
  return file.replace(/\.\([^)]*\)\.xdb$/, '').replace(/\.xdb$/, '');
}

/** The href without its `#xpointer(…)` — the document path a map file names, slash and all. */
export function withoutPointer(href: string): string {
  return href.replace(/#.*$/, '');
}
