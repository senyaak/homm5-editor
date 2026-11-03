// Templates for newly placed objects, taken from the game's own maps.
//
// A new object has to be written with the fields its type actually carries: a
// monster needs Amount and Mood, a town needs its buildings list, and the set
// differs per type and per game version. HommMap.addObject clones an object of
// the same type already on the map, which is the surest description of a valid
// one — but only if the map HAS one, and placing the first building on an empty
// map does not.
//
// So the shipped maps are the fallback library. They are full of correct
// examples of every type, they are already on disk beside the editor, and
// reading them costs nothing at build time. Nothing is copied INTO the repo:
// the game's data is copyrighted, so the templates are read at runtime from
// whatever installation is present.
//
// The alternative — writing a table of defaults by hand — was considered and
// rejected: 21 object types with fields we have not decoded, against a source
// that is correct by construction.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mapTreeUnder } from './map-source.ts';
import { noteFailure } from '../failure.ts';

/** One `<Item …><AdvMapX>…</AdvMapX></Item>` fragment, as text. */
export type DonorXml = string;

/** Cached per type, negatives included, so a fruitless scan happens once. */
const cache = new Map<string, DonorXml | null>();

/**
 * The maps last listed, and the date of every folder the listing walked.
 *
 * Listing the Maps folder is a walk of 290 folders and 4700 files, and it ran
 * for every type placed for the first time — most of the 0.4 s each such
 * placement took. Kept, it is checked instead: a folder's date moves when an
 * entry in it comes or goes, so the 290 dates say whether a map was added or
 * removed anywhere below, at a fraction of a walk. When one moved, the maps
 * are listed again and every "no map has one" goes with the old list: a type
 * no map had may have one now. A template found stays — it is text, good
 * whatever becomes of the map it came from.
 */
let listed: { root: string; maps: string[]; dates: Map<string, number> } | null = null;

/** Every map.xdb under the game's Maps folder, nearest first. */
function mapFiles(gameData: string): string[] {
  const root = join(gameData, 'Maps');
  if (listed?.root === root && unchanged(listed.dates)) return listed.maps;
  const tree = mapTreeUnder(root);
  const dates = new Map<string, number>();
  for (const dir of tree.dirs) {
    const at = statSync(dir, { throwIfNoEntry: false });
    if (at) dates.set(dir, at.mtimeMs);
  }
  listed = { root, maps: tree.maps, dates };
  for (const [type, donor] of cache) if (donor === null) cache.delete(type);
  return tree.maps;
}

/** No folder of a listing gained or lost an entry since its date was taken. */
function unchanged(dates: ReadonlyMap<string, number>): boolean {
  for (const [dir, date] of dates) {
    const now = statSync(dir, { throwIfNoEntry: false });
    // A folder gone is a change like any other.
    if (!now || now.mtimeMs !== date) return false;
  }
  return true;
}

/**
 * The first complete `<Item>` wrapping an object of `type`, from any shipped
 * map, or null when no map has one.
 *
 * Matched with a scan for the opening tag and then a walk to its closing one,
 * rather than a regex across the whole file: a map is megabytes of XML and the
 * naive pattern backtracks badly on it.
 */
export function donorFor(gameData: string, type: string): DonorXml | null {
  // A template found is good whatever becomes of its map: it is kept as text.
  // "No map has one" is asked again, of a listing that knows if maps came.
  const hit = cache.get(type);
  if (hit) return hit;
  const files = mapFiles(gameData);
  if (cache.get(type) === null) return null;

  for (const file of files) {
    let xml: string;
    try { xml = readFileSync(file, 'latin1'); } catch (e) { noteFailure(`reading ${file}`, e); continue; }
    const open = `<${type}>`;
    const at = xml.indexOf(open);
    if (at < 0) continue;
    const close = xml.indexOf(`</${type}>`, at);
    if (close < 0) continue;
    // Back up to the <Item …> that wraps it, so the donor carries the wrapper
    // the objects list is made of.
    const itemAt = xml.lastIndexOf('<Item ', at);
    if (itemAt < 0) continue;
    const end = close + type.length + 3;
    const tail = xml.indexOf('</Item>', end);
    if (tail < 0) continue;
    const donor = xml.slice(itemAt, tail + 7);
    cache.set(type, donor);
    return donor;
  }
  cache.set(type, null);
  return null;
}

/** Forget everything, so a different installation can be pointed at. */
export function clearDonorCache(): void { cache.clear(); listed = null; }
