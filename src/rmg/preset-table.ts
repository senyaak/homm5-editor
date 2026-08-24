// `RMGPresetTable` — what each race's zone is made of. This reader takes only
// the Tiles block: the terrain painter needs the default tile, the "other
// tiles" pool the zone constructor's roll picks from, and nothing else yet.
// The rest of a preset (hero pools, dwellings, road and water tiles) will be
// read by the phases that consume it, the way the rest of this port grew.
//
// The table indexes by the same race enum LoadTemplate draws (RACE_* ids in
// file order), and a tile is carried as the engine's shared reference: the
// href PATH is the identity a terrain layer keeps, `#xpointer(...)` stripped
// exactly the way GroundTerrain.bin stores it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';
import { RACE_BY_NAME } from './load-template.ts';

/** A terrain tile document, reduced to what the painter reads. */
export interface TerrainTileInfo {
  /** The layer identity: href path without its xpointer suffix. */
  path: string;
  priority: number;
  /** `TT_*` as the document spells it. */
  type: string;
}

export interface RacePresetTiles {
  defaultTile: TerrainTileInfo | null;
  otherTiles: TerrainTileInfo[];
}

const stripXpointer = (href: string): string => href.replace(/#xpointer\(.*\)$/, '');

/** Read one AdvMapTile document by its href, relative to unpacked data. */
export function readTileInfo(dataRoot: string, href: string): TerrainTileInfo {
  const path = stripXpointer(href);
  const root = parse(readFileSync(join(dataRoot, path.replace(/^\//, '')), 'utf8'));
  const tile = find(root, 'AdvMapTile');
  if (!tile) throw new Error(`${path}: not an AdvMapTile`);
  return {
    path,
    priority: Number.parseInt(childText(tile, 'Priority'), 10) || 0,
    type: childText(tile, 'Type'),
  };
}

/** The Tiles block of every race's preset, keyed by the race enum. */
export function readPresetTiles(dataRoot: string): Map<number, RacePresetTiles> {
  const xml = readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'RMGPresetTable.xdb'), 'utf8');
  const root = parse(xml);
  const table = find(root, 'Table_RMGPreset_Race');
  const objects = table ? find(table, 'objects') : null;
  const out = new Map<number, RacePresetTiles>();
  if (!objects) return out;
  for (const item of findAll(objects, 'Item')) {
    const id = childText(item, 'ID');
    const race = RACE_BY_NAME[id];
    if (race === undefined) continue;
    const obj = find(item, 'obj');
    const tiles = obj ? find(obj, 'Tiles') : null;
    if (!tiles) {
      out.set(race, { defaultTile: null, otherTiles: [] });
      continue;
    }
    const def = find(tiles, 'DefaultTile')?.attrs['href'];
    const others = find(tiles, 'OtherTiles');
    out.set(race, {
      defaultTile: def ? readTileInfo(dataRoot, def) : null,
      otherTiles: others
        ? findAll(others, 'Item').map((i) => i.attrs['href']).filter((h): h is string => !!h)
          .map((h) => readTileInfo(dataRoot, h))
        : [],
    });
  }
  return out;
}
