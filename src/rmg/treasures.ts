// The tail of the zone fill before the road — read from 0xEBF930 (the
// Redwood Observatories and the Den of Thieves roll) and 0xEB9DC0 (the
// treasures/chests worker behind the 0xEA57B0 dispatcher), held to the
// traced run draw for draw: 9/15/5/5 across the four zones, every one
// accounted.
//
// OBSERVATORIES (0xEBF930). The zone-params element is passed in and never
// read — RedwoodObservatoryDensity and DenOfThieves are dead template
// fields. The count is trunc(len(zone+0xCC) / 4000) + 1 (one per zone up
// to 4000 tiles; the divisor is read out of the magic multiply, but every
// traced zone lands N = 1). Each observatory is the 0xEC1500-family
// placement — shared candidate helper, two draws per attempt, two for the
// name — with a 100-attempt cap per object.
//
// THE DEN ROLL. After the observatories, a zone with NO player
// (zone+0xF0 == 0) draws below(10) and on 0 or 1 places one Den of
// Thieves through the same single-object placer. Both town zones of the
// reference skip the roll, both townless zones take it and miss (9, 8) —
// which is the measurement that pins the gate to the player index.
//
// TREASURES AND CHESTS (0xEB9DC0). Surface zones only — the dispatcher is
// behind `zone->0xF4 == 0`, and underground zones get theirs later in the
// additional-objects phase. The worker:
//
//   prefilter  zone+0xCC once, keep border >= 1
//   count      trunc(len(RAW zone+0xCC) · trunc(density · ladder) / 10000)
//              — density is TreasureDensity (+0x40) for treasures with the
//              {0.2,0.5,1,2,4} ladder on generator+0xA8, and
//              TreasureChestDensity (+0x44) on generator+0xB0 for chests
//   filter     per object: room > trunc(2·max/3) AND border >= 1 AND
//              occupancy != 2 — the occ gate is this worker's own; roads
//              and guard tiles are acceptable seats
//   type       treasures draw below(9) over the table at 0x121C910 —
//              Campfire, Chest, Crystal, Gems, Gold, Mercury, Ore, Sulfur,
//              Wood — so a "treasure" can be a Chest; the chests step is
//              the same body with the type FIXED at index 1, no draw
//   amount     never drawn, never written — the object keeps its shared
//              document's default
//   failure    exhausted candidates abandon the whole step
//
// The engine's mint-failure paths differ (observatories retry without
// erasing, treasures skip the object); this port's mint cannot fail.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { filterByRoom, fits, roomGrid, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

export const OBSERVATORY_HREF = '/MapObjects/Redwood_Observatory.(AdvMapBuildingShared).xdb';
export const DEN_OF_THIEVES_HREF = '/MapObjects/Den_Of_Thieves.(AdvMapBuildingShared).xdb';

/** The nine-entry table at 0x121C910 — below(9) indexes it; Chest is 1. */
export const TREASURE_TYPES: readonly string[] = [
  'Campfire', 'Chest', 'Crystal', 'Gems', 'Gold', 'Mercury', 'Ore', 'Sulfur', 'Wood',
];

export interface PlacedObject {
  type: string;
  name: string;
  x: number;
  y: number;
  q: number;
}

interface ZoneContext {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  occupancy: Uint8Array;
  points: Tile[];
  zoneIndex: number;
}

/**
 * One object through the 0xEC1500-family machinery with the observatory
 * placer's 100-attempt cap — the shape of 0xEBFCF0 and of each iteration
 * of 0xEBF930.
 */
function placeSingle(ctx: ZoneContext, foot: Footprint, rng: DrawSource): PlacedObject | null {
  const { size, grid, border, occupancy, zoneIndex } = ctx;
  const room = roomGrid(size, grid, zoneIndex, ctx.points);
  const { kept } = filterByRoom(zoneTiles(size, grid, zoneIndex), room, grid, border, occupancy, size, zoneIndex, 3);
  const pool = kept.filter(([x, y]) => border[y]![x]! >= 1);

  for (let attempts = 0; pool.length && attempts < 100; attempts++) {
    const pick = rng.below(pool.length);
    const q = rng.below(4);
    const tile = pool[pick]!;
    if (fits(ctx, foot, tile, q)) {
      const name = mintName(rng);
      stampFootprint(ctx, foot, tile, q);
      return { type: foot.path, name, x: tile[0], y: tile[1], q };
    }
    pool.splice(pick, 1);
  }
  return null;
}

export interface ObservatoriesInput extends ZoneContext {
  observatory: Footprint;
  denOfThieves: Footprint;
  /** `zone+0xF0` — 1-based player number, 0 when the zone seats nobody. */
  playerNo: number;
}

/** `0xEBF930` — the observatories and the Den of Thieves roll. */
export function placeObservatories(input: ObservatoriesInput, rng: DrawSource): PlacedObject[] {
  const placed: PlacedObject[] = [];
  const tiles = zoneTiles(input.size, input.grid, input.zoneIndex).length;
  const count = Math.trunc(tiles / 4000) + 1;
  for (let i = 0; i < count; i++) {
    const one = placeSingle(input, input.observatory, rng);
    if (one) placed.push(one);
  }
  if (input.playerNo === 0 && rng.below(10) < 2) {
    const den = placeSingle(input, input.denOfThieves, rng);
    if (den) placed.push(den);
  }
  return placed;
}

export interface TreasureStepInput extends ZoneContext {
  /** TreasureDensity or TreasureChestDensity, raw from the template. */
  density: number;
  /** The `{0.2, 0.5, 1, 2, 4}` ladder index — generator+0xA8 / +0xB0. */
  multIndex: number;
  /** Chests fix the type at index 1 and spend no type draw. */
  kind: 'treasures' | 'chests';
  /** Footprints for TREASURE_TYPES, in table order. */
  footprints: Footprint[];
}

const LADDER: readonly number[] = [0.2, 0.5, 1, 2, 4];

/** `0xEB9DC0` — the treasures/chests worker. Surface zones only (caller's gate). */
export function placeZoneTreasures(input: TreasureStepInput, rng: DrawSource): PlacedObject[] {
  const { size, grid, border, occupancy, zoneIndex } = input;
  const placed: PlacedObject[] = [];

  const raw = zoneTiles(size, grid, zoneIndex);
  const prefiltered = raw.filter(([x, y]) => border[y]![x]! >= 1);
  const mult = LADDER[input.multIndex] ?? 1;
  const count = Math.trunc((raw.length * Math.trunc(input.density * mult)) / 10000);

  for (let i = 0; i < count; i++) {
    const type = input.kind === 'treasures' ? rng.below(9) : 1;
    const foot = input.footprints[type]!;

    const room = roomGrid(size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(prefiltered, room, grid, border, occupancy, size, zoneIndex, 3);
    const pool = kept.filter(([x, y]) => border[y]![x]! >= 1 && occupancy[y * size + x] !== 2);

    // Exhaustion is the "Can't place treasure" line — terminal for the step.
    const found = tryPlace(input, foot, pool, rng);
    if (!found) return placed;
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, foot, tile, q);
    placed.push({ type: TREASURE_TYPES[type]!, name, x: tile[0], y: tile[1], q });
  }
  return placed;
}
