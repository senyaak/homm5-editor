// `RMGPresetTable` — what each race's zone is made of. This reader grows one
// phase at a time: the terrain painter needs the Tiles block (the default
// tile and the "other tiles" pool the zone constructor's roll picks from),
// PlaceTowns needs the town prototype plus the decorations that may sit
// over a town's entrance, and the dwellings step needs the race's four
// dwelling hrefs. The rest of a preset (hero pools, road and water tiles)
// waits for the phases that consume it.
//
// The table indexes by the same race enum LoadTemplate draws (RACE_* ids in
// file order), and a tile is carried as the engine's shared reference: the
// href PATH is the identity a terrain layer keeps, `#xpointer(...)` stripped
// exactly the way GroundTerrain.bin stores it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { RACE_BY_NAME } from './load-template.ts';

/** A terrain tile document, reduced to what the painter reads. */
export interface TerrainTileInfo {
  /** The layer identity: href path without its xpointer suffix. */
  path: string;
  priority: number;
  /** `TT_*` as the document spells it. */
  type: string;
}

export interface RacePreset {
  defaultTile: TerrainTileInfo | null;
  otherTiles: TerrainTileInfo[];
  /**
   * `RoadTile` / `SecondaryRoadTile` — what the road painter paints under
   * the 0x08 and 0x10 networks. The `*Strenght` fields beside them are 100
   * in every shipped preset and the painted weight is always 255, so the
   * strength is not carried until a table proves it read.
   */
  roadTile: TerrainTileInfo | null;
  secondaryRoadTile: TerrainTileInfo | null;
  /** `TownProto` — the AdvMapTownShared a zone of this race builds. */
  townProto: string | null;
  /**
   * `OverTownCenterObjects` — statics that may be dropped over a town's
   * entrance. Empty for half the races, and an empty list makes PlaceTowns
   * skip the decoration block whole, draws included.
   */
  overTownCenterObjects: string[];
  /**
   * `Dwellings` — the four AdvMapDwellingShared hrefs the dwellings step
   * indexes by `min(tier, 3)` (the table the zone keeps at +0x1C→+0x28).
   */
  dwellings: string[];
  /**
   * `NewUpgradeBuildings` — the price list the upgrade-buildings step buys
   * from (`[zone+0x20]+0x168`), sorted ascending by Value in the shipped
   * table; the affordable-prefix draw depends on that order.
   */
  newUpgradeBuildings: PricedBuilding[];
  /** `NewResourceGivers` (`+0x15C`) — the resource-buildings step's list. */
  newResourceGivers: PricedBuilding[];
  /** `NewTreasuryBuildings` (`+0x180`) — the treasury step's list. */
  newTreasuryBuildings: PricedBuilding[];
  /** `NewLuckMoraleBuildings` (`+0x144`) — the luck/morale step's list. */
  newLuckMoraleBuildings: PricedBuilding[];
  /**
   * `NewShopBuildings` (`+0x150`) — the shops step's list; two entries are
   * dwelling hrefs (ElementalConflux, RefugeeCamp) and place as-is.
   */
  newShopBuildings: PricedBuilding[];
  /**
   * `BigStatics` (`+0xB4`) — the statics sweep's type list, in FILE ORDER
   * (the shipped tables order big→small, and the sweep leans on that).
   */
  bigStatics: string[];
  /** `Mountains` (`+0xC0`) — the pre-sweep mountain pass's list. */
  mountains: string[];
  /** `OverLakeCenterObjects` (`+0xCC`) — lake-seed decorations. */
  overLakeCenterObjects: string[];
  /** `OverLakeOneTileRandomObjects` (`+0xD8`) — the lakes' one-tile pass. */
  overLakeOneTileRandomObjects: string[];
  /** `OneTileSmallBlockers` (`+0x90`) — the one-tile step's blockers. */
  oneTileSmallBlockers: string[];
  /** `OneTileSmallNonblockers` (`+0x9C`) — its passable decorations. */
  oneTileSmallNonblockers: string[];
  /** `OneTileBigObjects` (`+0xA8`) — its larger-model one-tilers. */
  oneTileBigObjects: string[];
}

/** One `Building / Value / GuardStrenght` record of a preset's price lists. */
export interface PricedBuilding {
  href: string;
  value: number;
  /** The engine's own misspelling, kept. Guard power = this × BasicLeverGuardPower. */
  guardStrenght: number;
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

/** Every race's preset, keyed by the race enum. */
export function readPresets(dataRoot: string): Map<number, RacePreset> {
  const xml = readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'RMGPresetTable.xdb'), 'utf8');
  const root = parse(xml);
  const table = find(root, 'Table_RMGPreset_Race');
  const objects = table ? find(table, 'objects') : null;
  const out = new Map<number, RacePreset>();
  if (!objects) return out;
  const hrefs = (holder: XmlElement | null): string[] => holder
    ? findAll(holder, 'Item').map((i) => i.attrs['href']).filter((h): h is string => !!h)
    : [];
  const priced = (holder: XmlElement | null): PricedBuilding[] => holder
    ? findAll(holder, 'Item').map((i) => ({
        href: find(i, 'Building')?.attrs['href'] ?? '',
        value: Number.parseInt(childText(i, 'Value'), 10) || 0,
        guardStrenght: Number.parseInt(childText(i, 'GuardStrenght'), 10) || 0,
      })).filter((p) => p.href !== '')
    : [];
  for (const item of findAll(objects, 'Item')) {
    const id = childText(item, 'ID');
    const race = RACE_BY_NAME[id];
    if (race === undefined) continue;
    const obj = find(item, 'obj');
    const tiles = obj ? find(obj, 'Tiles') : null;
    const def = tiles ? find(tiles, 'DefaultTile')?.attrs['href'] : undefined;
    const road = tiles ? find(tiles, 'RoadTile')?.attrs['href'] : undefined;
    const secondary = tiles ? find(tiles, 'SecondaryRoadTile')?.attrs['href'] : undefined;
    out.set(race, {
      defaultTile: def ? readTileInfo(dataRoot, def) : null,
      otherTiles: tiles ? hrefs(find(tiles, 'OtherTiles')).map((h) => readTileInfo(dataRoot, h)) : [],
      roadTile: road ? readTileInfo(dataRoot, road) : null,
      secondaryRoadTile: secondary ? readTileInfo(dataRoot, secondary) : null,
      townProto: (obj ? find(obj, 'TownProto')?.attrs['href'] : undefined) ?? null,
      overTownCenterObjects: obj ? hrefs(find(obj, 'OverTownCenterObjects')) : [],
      dwellings: obj ? hrefs(find(obj, 'Dwellings')) : [],
      newUpgradeBuildings: obj ? priced(find(obj, 'NewUpgradeBuildings')) : [],
      newResourceGivers: obj ? priced(find(obj, 'NewResourceGivers')) : [],
      newTreasuryBuildings: obj ? priced(find(obj, 'NewTreasuryBuildings')) : [],
      newLuckMoraleBuildings: obj ? priced(find(obj, 'NewLuckMoraleBuildings')) : [],
      newShopBuildings: obj ? priced(find(obj, 'NewShopBuildings')) : [],
      bigStatics: obj ? hrefs(find(obj, 'BigStatics')) : [],
      mountains: obj ? hrefs(find(obj, 'Mountains')) : [],
      overLakeCenterObjects: obj ? hrefs(find(obj, 'OverLakeCenterObjects')) : [],
      overLakeOneTileRandomObjects: obj ? hrefs(find(obj, 'OverLakeOneTileRandomObjects')) : [],
      oneTileSmallBlockers: obj ? hrefs(find(obj, 'OneTileSmallBlockers')) : [],
      oneTileSmallNonblockers: obj ? hrefs(find(obj, 'OneTileSmallNonblockers')) : [],
      oneTileBigObjects: obj ? hrefs(find(obj, 'OneTileBigObjects')) : [],
    });
  }
  return out;
}
