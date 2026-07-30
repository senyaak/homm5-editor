// Who would notice if this artifact went away.
//
// A map names an artifact by its ENUM NAME, never by its number: `<artifactIDs>`
// lists `SWORD_OF_RUINS`, `<ArtifactID>` holds a name, and one lying on the
// ground is an href to a shared document. That was worth checking rather than
// assuming, because the assumption ran the other way for a while and produced a
// design that quietly broke the very thing it was protecting.
//
// Two consequences, and they are the whole reason this file exists:
//
//   * REMOVING one is what breaks a map — the name it lists stops resolving.
//     That is exactly what a search for the name finds, exactly, with no
//     guessing.
//   * RENUMBERING the ones behind it does NOT break a map.
//
// So the editor's job is to look before it removes, and say what it found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** One place an artifact is named. */
export interface ArtifactUse {
  /** Path of the map, relative to the folder searched. */
  map: string;
  /**
   * Where in it — `allowed` is the map's own list of artifacts that may exist
   * on it, `hero` is one somebody is wearing or carrying. A map that merely
   * ALLOWS the artifact still stops mentioning something real when it goes.
   */
  where: 'allowed' | 'hero';
  /** How many times, so "in three places" is not four separate lines. */
  count: number;
}

/** Every map.xdb under `root`, packed archives excluded — they are not edited. */
function mapDocuments(root: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  let entries: string[];
  try { entries = readdirSync(root); } catch { return out; }
  for (const name of entries) {
    const path = join(root, name);
    let dir = false;
    try { dir = statSync(path).isDirectory(); } catch { continue; }
    if (dir) mapDocuments(path, out, depth + 1);
    else if (name === 'map.xdb') out.push(path);
  }
  return out;
}

/**
 * Find every map under `mapsRoot` that names one of `ids`.
 *
 * Matched on the whole element (`<Item>NAME</Item>`), not as a substring:
 * `ARTIFACT_RING_OF_DEATH` contains `ARTIFACT_RING`, and a warning that names
 * the wrong artifact is worse than none.
 */
export function findArtifactUses(mapsRoot: string, ids: readonly string[]): Map<string, ArtifactUse[]> {
  return findUses(mapsRoot, ids, ['Item', 'ArtifactID']);
}

/**
 * The same for creatures, which a map names in two places: an army slot holds
 * `<Creature>NAME</Creature>`, and a neutral stack is an href at a document in
 * the mod — the name reaches the first and is what a person recognises.
 */
export function findCreatureUses(mapsRoot: string, ids: readonly string[]): Map<string, ArtifactUse[]> {
  return findUses(mapsRoot, ids, ['Creature', 'Item']);
}

function findUses(mapsRoot: string, ids: readonly string[], elements: readonly string[]): Map<string, ArtifactUse[]> {
  const found = new Map<string, ArtifactUse[]>();
  if (!ids.length) return found;

  for (const path of mapDocuments(mapsRoot)) {
    let text: string;
    try { text = readFileSync(path, 'latin1'); } catch { continue; }
    // The root list sits outside <objects>; anything after it belongs to a hero.
    const objectsEnd = text.indexOf('</objects>');
    for (const id of ids) {
      const hits: Record<'allowed' | 'hero', number> = { allowed: 0, hero: 0 };
      const tag = elements.join('|');
      const pattern = new RegExp(`<(?:${tag})>${id}</(?:${tag})>`, 'g');
      for (const m of text.matchAll(pattern)) {
        hits[objectsEnd >= 0 && m.index! > objectsEnd ? 'allowed' : 'hero']++;
      }
      for (const where of ['allowed', 'hero'] as const) {
        if (!hits[where]) continue;
        const list = found.get(id) ?? [];
        list.push({ map: relative(mapsRoot, path).replace(/\\/g, '/'), where, count: hits[where] });
        found.set(id, list);
      }
    }
  }
  return found;
}

/** One line per map, for a dialog that has to fit. */
export function describeUses(uses: readonly ArtifactUse[]): string[] {
  return uses.map((u) => `${u.map} — ${u.where === 'hero' ? 'on a hero' : 'allowed on the map'}`
    + (u.count > 1 ? ` (${u.count}×)` : ''));
}

/**
 * Which maps reach a HERO, and how.
 *
 * Unlike an artifact or a creature, a hero is never named by an element value:
 * a map points at his document by href, in `AvailableHeroes` (its roster) or in
 * the `Shared` of a hero standing on it. So this looks for the path, and the
 * same split tells the two apart — the roster sits outside `<objects>`, a
 * placed hero inside it.
 */
export function findHeroUses(mapsRoot: string, hrefs: readonly string[]): Map<string, ArtifactUse[]> {
  const found = new Map<string, ArtifactUse[]>();
  if (!hrefs.length) return found;
  for (const path of mapDocuments(mapsRoot)) {
    let text: string;
    try { text = readFileSync(path, 'latin1'); } catch { continue; }
    const objectsEnd = text.indexOf('</objects>');
    for (const href of hrefs) {
      const hits: Record<'allowed' | 'hero', number> = { allowed: 0, hero: 0 };
      let at = text.indexOf(href);
      while (at >= 0) {
        hits[objectsEnd >= 0 && at > objectsEnd ? 'allowed' : 'hero']++;
        at = text.indexOf(href, at + href.length);
      }
      for (const where of ['allowed', 'hero'] as const) {
        if (!hits[where]) continue;
        const list = found.get(href) ?? [];
        list.push({ map: relative(mapsRoot, path).replace(/\\/g, '/'), where, count: hits[where] });
        found.set(href, list);
      }
    }
  }
  return found;
}
