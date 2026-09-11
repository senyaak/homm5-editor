// The dwellings step of MainObjects — read from 0xEB8C10, held to the traced
// run (docs/RMG.md). The shape is the mines step stripped to its skeleton:
// no rings, no guard, no piles — two draws per attempt at a tile, two for
// the name, and that is the whole cost.
//
//   candidates  EVERY tile of the zone, nothing else — the list `zone+0xCC`,
//               built once back in FillZones by 0xEB7790 with no border, room
//               or occupancy test, and never rebuilt
//   room        recomputed per dwelling with the same (4, 0) as mines
//   filter      room > trunc(2 * max / 3), strictly — divisor 3, not the
//               mines' 5, and the only test a candidate faces
//   fit         the shared 0xEC3510, same arguments as mines
//   descriptor  the zone race's preset `Dwellings` list, index min(tier, 3);
//               a missing or unloadable entry skips the instance, no draws
//   failure     an exhausted candidate list ABANDONS the whole step for the
//               zone — remaining instances and types included; the engine's
//               "Can't place dwelling %s at zone #%d" has no edge back into
//               either loop (0xEB9647)
//
// The worker is two-moded on `generator+0xA5`, which is the request's `+0x95`
// — the dialog's RANDOM TOWNS checkbox (the map records `<RandomTowns>true`;
// `-pokeb 149 1` says it through the console). Both modes are read off
// `0xEB8C10` and both are now held to a map from the engine:
//
//   mode 0  descriptors come from the race preset, index min(tier, 3)
//           (0xEB8E03); a tier below 3 sets no properties at all, and a tier
//           of 3 or more reuses descriptor 3 and switches its creature on
//           through `creaturesEnabled[tier-3]` (0xEB90CF).
//   mode 1  the descriptor is the tier's OWN stand-in, `RandomDwelling<tier+1>`
//           — `0x121C570 + tier*0x20` at 0xEB8DF8, seven of them, filled at
//           start-up by 0x4D5A60 — and the tier test is skipped (0xEB904A):
//           whatever the tier, when the zone has a town (`zone+0xF8`, 0xEB935E)
//           the instance gets `RndSource = 2` (RND_TOWN) and `LinkToTown` = the
//           town's minted name (`zone+0xFC`); a zone without one sets nothing.
//
// Neither mode spends draws differently — the properties come after the fit —
// so the draw stream tells them apart only through the footprints they measure.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { ensureRoom, filterByRoom, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

/** The dwellings' threshold — `trunc(2 * max / 3)` at 0xEB8CD3. */
const DWELLING_ROOM_DIVISOR = 3;

export interface PlacedDwelling {
  /** The shared document's href path — ImpCrucible, Workshop, … */
  type: string;
  name: string;
  x: number;
  y: number;
  /** The quadrant drawn — the rotation is `q * PI/2`. */
  q: number;
  /** The requested tier — tier >= 3 reuses descriptor 3 and writes `creaturesEnabled[tier-3]`. */
  tier: number;
  /**
   * Mode 1 only, and only in a zone with a town: the town's name, which the
   * record links to (`RndSource` RND_TOWN, `LinkToTown` the town's id).
   */
  linkToTown?: string;
}

export interface DwellingStepInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4 the way the engine does. */
  occupancy: Int32Array;
  /** MUTATED: the zone's stamped points — what the room is measured from. */
  points: Tile[];
  /** MUTATED when carried: stamped-blocked tiles join the zone's `+0x5C` ledger. */
  blocked?: Tile[];
  zoneIndex: number;
  /** The zone's floor — floor 1 adds the fit's five-tile margin. */
  floor?: number;
  /** The level's persistent room grid, recomputed in place when carried. */
  room?: Int32Array[];
  /**
   * The zone's `+0xCC` when the grid no longer derives it — after the water
   * carve the rim keeps list membership with grid -1 (and room 1000, so it
   * sits in every pool until the fit rejects it, the engine's own shape).
   */
  tiles?: Tile[];
  /** The template's seven per-tier counts for this zone (`zone params +0x30`). */
  counts: number[];
  /**
   * The zone race's preset `Dwellings`, in file order — at most the first
   * four are ever reached (`min(tier, 3)` at 0xEB8E0C).
   */
  descriptors: Footprint[];
  /**
   * Mode 1 — the RANDOM TOWNS flag (`generator+0xA5`). `randomDescriptors`
   * are the seven `RandomDwellingN` stand-ins in tier order, and `townName`
   * the zone's town when it has one (`zone+0xF8`/`+0xFC`).
   */
  randomTowns?: boolean;
  randomDescriptors?: Footprint[];
  townName?: string;
}

/** One zone's dwellings — the loops of `0xEB8C10`, draws and all. */
export function placeZoneDwellings(input: DwellingStepInput, rng: DrawSource): PlacedDwelling[] {
  const { size, grid, border, occupancy, zoneIndex } = input;
  const candidates = input.tiles ?? zoneTiles(size, grid, zoneIndex);
  const placed: PlacedDwelling[] = [];
  const randomTowns = Boolean(input.randomTowns);
  if (randomTowns && !input.randomDescriptors) throw new Error('random towns ordered, but no RandomDwelling documents were given');

  for (let tier = 0; tier < input.counts.length; tier++) {
    const count = input.counts[tier] ?? 0;
    for (let instance = 0; instance < count; instance++) {
      // The room and the filter are redone per instance, from the ORIGINAL
      // candidate list — a candidate struck out by a failed fit is back for
      // the next dwelling.
      const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
      const { kept } = filterByRoom(
        candidates, room, grid, border, occupancy, size, zoneIndex, DWELLING_ROOM_DIVISOR,
      );

      // The descriptor resolves AFTER the filter and before any draw; a hole
      // in the preset skips the instance with nothing spent (0xEB9602). Mode 1
      // indexes the stand-ins by the tier itself, not by min(tier, 3).
      const foot = randomTowns ? input.randomDescriptors![tier] : input.descriptors[Math.min(tier, 3)];
      if (!foot) continue;

      // The exhausted list is terminal for the STEP, not the instance —
      // "Can't place dwelling" returns out of both loops.
      const found = tryPlace(input, foot, kept, rng);
      if (!found) return placed;
      const { tile, q } = found;

      const name = mintName(rng);
      stampFootprint(input, foot, tile, q);
      placed.push({
        type: foot.path, name, x: tile[0], y: tile[1], q, tier,
        ...(randomTowns && input.townName ? { linkToTown: input.townName } : {}),
      });
    }
  }
  return placed;
}
