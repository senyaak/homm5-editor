// Where a map remembers what is inside its Pandora's Boxes.
//
// The contents belong to the PLACED box and to nothing else, so they are the
// map's — but there is nowhere in map.xdb to put them. An `AdvMapTreasure` has
// the fields the engine reads and no more, and inventing a tag inside it would
// be betting the map's loadability on the engine ignoring what it does not
// know. So the contents live beside the map, in a sidecar the editor owns, and
// what SHIPS is what the game can actually read: the generated Lua block and
// the message texts.
//
// KEYED BY THE PLACEMENT'S NAME, which is not an arbitrary choice — it is the
// same handle the touch trigger looks the box up by, so a name that drifts
// away from the sidecar is a box that stops working, and renaming through
// renamePandoraBox() is what keeps the two together.
//
// The sidecar does not travel: src/map/project.ts filters it out of a pack the
// way it filters the manifest, so a shipped .h5m carries no editor bookkeeping.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PandoraContents } from '../mods/pandora-contents.ts';

/** The sidecar's name inside the map folder. */
export const PANDORA_FILE = 'pandora.json';

/** What the sidecar holds. Versioned from the start: the contents model will
 *  grow (the engine half is still being built) and a reader that cannot say
 *  which shape it is looking at has to guess. */
export interface PandoraSidecar {
  version: 1;
  boxes: PandoraContents[];
}

/**
 * The boxes a map's sidecar records, or none.
 *
 * A sidecar that will not parse answers "no boxes" rather than throwing: it is
 * bookkeeping, and a map that opens with its boxes empty can be fixed, where a
 * map that will not open cannot.
 */
export function readPandoraBoxes(mapDir: string): PandoraContents[] {
  const p = join(mapDir, PANDORA_FILE);
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as Partial<PandoraSidecar>;
    return Array.isArray(data.boxes) ? data.boxes : [];
  } catch {
    return [];
  }
}

/**
 * Write the boxes back, or take the sidecar away when there are none left.
 *
 * An empty file would be a lie of a different kind — a map that never had a
 * box and one whose last box was deleted should look the same on disk.
 */
export function writePandoraBoxes(mapDir: string, boxes: readonly PandoraContents[]): void {
  const p = join(mapDir, PANDORA_FILE);
  if (!boxes.length) {
    if (existsSync(p)) writeFileSync(p, JSON.stringify({ version: 1, boxes: [] } as PandoraSidecar, null, 1) + '\n');
    return;
  }
  const sidecar: PandoraSidecar = { version: 1, boxes: [...boxes] };
  writeFileSync(p, JSON.stringify(sidecar, null, 1) + '\n');
}

/** One box's contents, by placement name. */
export function findPandoraBox(boxes: readonly PandoraContents[], name: string): PandoraContents | null {
  return boxes.find((b) => b.name === name) ?? null;
}

/** Contents put back under a name — replacing that box's entry, or adding it. */
export function setPandoraBox(
  boxes: readonly PandoraContents[], box: PandoraContents,
): PandoraContents[] {
  const out = boxes.filter((b) => b.name !== box.name);
  out.push(box);
  return out;
}

/** Boxes with one dropped — what deleting a placement leaves behind. */
export function removePandoraBox(boxes: readonly PandoraContents[], name: string): PandoraContents[] {
  return boxes.filter((b) => b.name !== name);
}

/**
 * Carry a box's contents to its new name.
 *
 * Renaming a placement in the inspector has to reach here, or the contents
 * stay keyed to a name no object has any more: the box would still be on the
 * map, still glowing, and would open with nothing inside.
 */
export function renamePandoraBox(
  boxes: readonly PandoraContents[], from: string, to: string,
): PandoraContents[] {
  if (from === to) return [...boxes];
  return boxes
    .filter((b) => b.name !== to)
    .map((b) => (b.name === from ? { ...b, name: to } : b));
}

/**
 * Boxes whose placements are gone, forgotten.
 *
 * Called with the names the map actually holds — an object deleted through any
 * path (the inspector, a fill, an undone placement) leaves its contents behind
 * otherwise, and the next save would write a trigger for an object that is not
 * there. The engine answers a trigger on a missing object with a line in the
 * console and no box.
 */
export function prunePandoraBoxes(
  boxes: readonly PandoraContents[], placed: Iterable<string>,
): PandoraContents[] {
  const alive = new Set(placed);
  return boxes.filter((b) => alive.has(b.name));
}

// --- the message text --------------------------------------------------------

/**
 * The file a box's message is written to, inside the map folder.
 *
 * One file per box rather than one shared file, because `MessageBox` takes a
 * ref and a ref is a whole file: two boxes sharing one would say each other's
 * lines. The name carries the placement's, so the folder reads as a map.
 */
export const pandoraMessageFile = (name: string): string => `pandora-${name}.txt`;

/**
 * What the generated block points at — the path as the GAME addresses it,
 * which is the map's path under the data root plus the file's name.
 */
export function pandoraMessageRef(archivePrefix: string, name: string): string {
  const dir = archivePrefix.replace(/^\/+|\/+$/g, '');
  return `/${dir ? dir + '/' : ''}${pandoraMessageFile(name)}`;
}

/**
 * And the receipt beside it — what the box handed over, in the game's own
 * words, flown over the hero when it opens (src/mods/pandora-names.ts).
 *
 * A SECOND FILE rather than a paragraph appended to the message: the two are
 * shown by different calls at different moments, one is the author's and the
 * other is generated, and a box may want either without the other.
 */
export const pandoraGiftFile = (name: string): string => `pandora-${name}-gift.txt`;

/** The receipt's path as the game addresses it. */
export function pandoraGiftRef(archivePrefix: string, name: string): string {
  const dir = archivePrefix.replace(/^\/+|\/+$/g, '');
  return `/${dir ? dir + '/' : ''}${pandoraGiftFile(name)}`;
}
