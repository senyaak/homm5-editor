// The documents PlaceTowns reads: a town's shape, and the pool of random
// specialisations it draws from.
//
// A town is placed as a whole building, so the phase needs its FOOTPRINT —
// the three offset lists an `AdvMapTownShared` carries — to know whether the
// building fits where the dice pointed. And once placed, a town gets one of
// the specialisations from `RMG/TownRandomSpecGroup.xdb`, filtered to its own
// town type and to the ones marked random.
//
// Offsets are in the MAP's coordinates (x east, y south), the way the files
// spell them; the phase rotates them by a quarter turn at a time.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** One (x, y) offset from the building's anchor. */
export type Offset = readonly [number, number];

export interface TownShared {
  /** The href path, without its xpointer suffix — what an instance names. */
  path: string;
  /** `TOWN_*`, the filter a specialisation must match. */
  townType: string;
  blockedTiles: Offset[];
  holeTiles: Offset[];
  activeTiles: Offset[];
  /**
   * `PossessionMarkerTile` — where the flag stands. PlaceTowns measures the
   * town's depth from THIS offset rather than from the town's own tile; see
   * towns.ts for how that was settled, and for what is still open about it.
   */
  possessionMarker: Offset;
}

export interface TownSpecialization {
  path: string;
  townType: string;
  /** `TOWN_RANDOM` for the ones the generator may roll. */
  randomTown: string;
}

const stripXpointer = (href: string): string => href.replace(/#xpointer\(.*\)$/, '');

const readDoc = (dataRoot: string, path: string): XmlElement =>
  parse(readFileSync(join(dataRoot, path.replace(/^\//, '')), 'utf8'));

/** `<name><Item><x>..</x><y>..</y></Item>…</name>` — an offset list. */
function offsets(el: XmlElement, name: string): Offset[] {
  const holder = find(el, name);
  if (!holder) return [];
  return findAll(holder, 'Item').map((item): Offset => [
    Number.parseInt(childText(item, 'x'), 10) || 0,
    Number.parseInt(childText(item, 'y'), 10) || 0,
  ]);
}

export function readTownShared(dataRoot: string, href: string): TownShared {
  const path = stripXpointer(href);
  const town = find(readDoc(dataRoot, path), 'AdvMapTownShared');
  if (!town) throw new Error(`${path}: not an AdvMapTownShared`);
  const marker = find(town, 'PossessionMarkerTile');
  return {
    path,
    // `Type` on the building, `TownType` on a specialisation — the two
    // documents spell the same enum differently, and the building's own
    // nested <Type> tags (towers, gates) sit deeper, out of find()'s reach.
    townType: childText(town, 'Type'),
    blockedTiles: offsets(town, 'blockedTiles'),
    holeTiles: offsets(town, 'holeTiles'),
    activeTiles: offsets(town, 'activeTiles'),
    possessionMarker: marker
      ? [Number.parseInt(childText(marker, 'x'), 10) || 0, Number.parseInt(childText(marker, 'y'), 10) || 0]
      : [0, 0],
  };
}

/**
 * `RMG/TownRandomSpecGroup.xdb` in FILE ORDER — the order the phase's
 * `below(matches)` indexes into once the list is filtered.
 */
export function readTownSpecializations(dataRoot: string): TownSpecialization[] {
  const group = find(readDoc(dataRoot, '/RMG/TownRandomSpecGroup.xdb'), 'TownRandomSpecGroup');
  const link = group ? find(group, 'link') : null;
  if (!link) return [];
  return findAll(link, 'Item')
    .map((i) => i.attrs['href'])
    .filter((h): h is string => !!h)
    .map((href) => {
      const path = stripXpointer(href);
      const spec = find(readDoc(dataRoot, path), 'TownSpecialization');
      return {
        path,
        townType: spec ? childText(spec, 'TownType') : '',
        randomTown: spec ? childText(spec, 'RandomTown') : '',
      };
    });
}

/** A decoration's `AdvMapStaticShared` is only ever named — no field is read. */
export function staticPath(href: string): string {
  return stripXpointer(href);
}
