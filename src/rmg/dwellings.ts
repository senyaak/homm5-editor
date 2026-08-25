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
// The worker is two-moded on `generator+0xA5`. Every traced editor run has it
// zero: descriptors come from the race preset, and a tier below 3 sets no
// properties at all — which is exactly the reference map's dwellings, all
// PLAYER_NONE with empty RndSource/LinkToTown. What is NOT ported, said
// rather than hidden: mode 1 (the seven /MapObjects/Random/RandomDwellingN
// stand-ins, RndSource=2 and LinkToTown set when the zone has a town), and
// mode 0 with tier >= 3, which reuses descriptor 3 and switches the creature
// on via `creaturesEnabled[tier-3]`. Neither spends draws differently up to
// the properties, but neither has ever been measured.

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
}

export interface DwellingStepInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4 the way the engine does. */
  occupancy: Uint8Array;
  /** MUTATED: the zone's stamped points — what the room is measured from. */
  points: Tile[];
  zoneIndex: number;
  /** The level's persistent room grid, recomputed in place when carried. */
  room?: Int32Array[];
  /** The template's seven per-tier counts for this zone (`zone params +0x30`). */
  counts: number[];
  /**
   * The zone race's preset `Dwellings`, in file order — at most the first
   * four are ever reached (`min(tier, 3)` at 0xEB8E0C).
   */
  descriptors: Footprint[];
}

/** One zone's dwellings — the loops of `0xEB8C10`, draws and all. */
export function placeZoneDwellings(input: DwellingStepInput, rng: DrawSource): PlacedDwelling[] {
  const { size, grid, border, occupancy, zoneIndex } = input;
  const candidates = zoneTiles(size, grid, zoneIndex);
  const placed: PlacedDwelling[] = [];

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
      // in the preset skips the instance with nothing spent (0xEB9602).
      const foot = input.descriptors[Math.min(tier, 3)];
      if (!foot) continue;

      // The exhausted list is terminal for the STEP, not the instance —
      // "Can't place dwelling" returns out of both loops.
      const found = tryPlace(input, foot, kept, rng);
      if (!found) return placed;
      const { tile, q } = found;

      const name = mintName(rng);
      stampFootprint(input, foot, tile, q);
      placed.push({ type: foot.path, name, x: tile[0], y: tile[1], q });
    }
  }
  return placed;
}
