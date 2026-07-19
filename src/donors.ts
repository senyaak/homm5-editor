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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** One `<Item …><AdvMapX>…</AdvMapX></Item>` fragment, as text. */
export type DonorXml = string;

/** Cached per type, negatives included, so a fruitless scan happens once. */
const cache = new Map<string, DonorXml | null>();

/** Every map.xdb under the game's Maps folder, nearest first. */
function mapFiles(gameData: string): string[] {
  const root = join(gameData, 'Maps');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let ents: string[];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (e === 'map.xdb') out.push(full);
    }
  };
  walk(root);
  return out;
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
  const hit = cache.get(type);
  if (hit !== undefined) return hit;

  for (const file of mapFiles(gameData)) {
    let xml: string;
    try { xml = readFileSync(file, 'latin1'); } catch { continue; }
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
export function clearDonorCache(): void { cache.clear(); }
