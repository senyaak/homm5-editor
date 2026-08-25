// One-tile statics — the surface CGameZone's vtable slot +0x30
// (`0xEBAA70`), the second virtual step of the statics driver. No budget,
// no density: the step is one room recompute, a drawless bucket scan, and
// four placement passes that between them visit every qualifying tile of
// the zone exactly once.
//
// PROLOGUE. Room recomputes with mask 0x3C (actives + the three road
// lists). Then one drawless pass over `zone+0xCC`: a tile qualifies for a
// bucket when its occupancy is EXACTLY 0 and its border distance is not 0;
// by room it lands in near (r == 2), mid (r in {3,4}) or far (r > 4) —
// r <= 1 lands nowhere.
//
// PASS 1 — the border fence (`0xebabdb`). EVERY zone tile: below(4) is
// drawn FIRST, unconditionally — the bare filler of the traced stream —
// then the filters (border == 0 required; occupancy in {0, 1, 8, 0x10,
// 0x20}) cost nothing more. A surviving tile ALWAYS gets an object; the
// betweenFloat is a selector, not a gate: roll < 0.4 with SmallBlockers
// in stock picks a blocker, else BigObjects if any, else a blocker anyway
// (both lists empty would divide by zero in the engine — this port
// throws instead). below(len) picks the entry; a SmallBlocker whose path
// carries "FireDot" ignores the quadrant and takes the MAP angle —
// mapSetup's one betweenFloat(0, 2pi), finally consumed. Mint, then
// occupancy = 2, written directly over whatever was there (roads
// included).
//
// PASS 2 — near, r == 2 (`0xebaf54`). Per bucket tile: below(4) and a
// base roll, then a cascade where every stage with a non-empty list draws
// its OWN roll and a failed roll falls through: base < 0.15 -> BigObjects
// (occupancy 2); else SmallBlockers on a fresh roll < 0.4 (occupancy 2);
// else SmallNonblockers on a fresh roll < 0.6 — occupancy 1, the only 1
// this step writes. An empty list falls through without drawing.
//
// PASS 3 — mid, r in {3,4} (`0xebb578`): base < 0.3 -> BigObjects, else
// blockers on a fresh roll < 0.5. No nonblocker stage.
//
// PASS 4 — far, r > 4 (`0xebb946`): base <= 0.5 — the ONE gate where
// equality passes (`comiss; ja`) — and BigObjects only. A race with no
// BigObjects pays two draws per far tile for nothing.
//
// One-tile statics never stamp through `0xEC2F90` and never join
// `+0x5C`/`+0x68`/`+0x98` — they steer neither rooms nor roads.

import type { DrawSource } from './armies.ts';
import { mintName } from './armies.ts';
import { recomputeRoom } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';
import type { PlacedStatic } from './statics-big.ts';

const fl = Math.fround;

export interface OneTileStaticsInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: 2 under blockers and big objects, 1 under nonblockers. */
  occupancy: Uint8Array;
  /** MUTATED IN PLACE — the level's persistent room grid. */
  room: Int32Array[];
  /** The zone's `+0x68` points — read by the recompute only. */
  points: Tile[];
  zoneIndex: number;
  /** The three road lists, for the 0x3C room mask. */
  roads: Tile[];
  /** The preset's OneTileSmallBlockers, resolved, file order. */
  smallBlockers: Footprint[];
  /** The preset's OneTileSmallNonblockers, resolved, file order. */
  smallNonblockers: Footprint[];
  /** The preset's OneTileBigObjects, resolved, file order. */
  bigObjects: Footprint[];
  /** `world+0x5C` — the FireDot angle. */
  mapAngle: number;
}

/** The whole slot-+0x30 step for one surface-class zone. */
export function placeZoneOneTileStatics(input: OneTileStaticsInput, rng: DrawSource): PlacedStatic[] {
  const { size, grid, border, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];

  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  // The bucket scan — zone+0xCC order, drawless.
  const near: Tile[] = [];
  const mid: Tile[] = [];
  const far: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (occupancy[y * size + x] !== 0) continue;
      if (border[y]![x] === 0) continue;
      const r = room[y]![x]!;
      if (r > 4) far.push([x, y]);
      else if (r >= 3) mid.push([x, y]);
      else if (r === 2) near.push([x, y]);
    }
  }

  const create = (list: Footprint[], at: Tile, q: number, fireDot: boolean, occ: number): void => {
    if (!list.length) throw new Error('one-tile statics: both lists empty — the engine would divide by zero');
    const entry = list[rng.below(list.length)]!;
    const angle = fireDot && entry.path.includes('FireDot') ? input.mapAngle : q * (Math.PI / 2);
    placed.push({ type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle });
    occupancy[at[1] * size + at[0]] = occ;
  };

  // Pass 1 — the border fence.
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      const q = rng.below(4);
      if (border[y]![x] !== 0) continue;
      const occ = occupancy[y * size + x]!;
      if (occ !== 0 && occ !== 1 && occ !== 8 && occ !== 0x10 && occ !== 0x20) continue;
      const roll = rng.betweenFloat(0, 1);
      if (roll < fl(0.4) && input.smallBlockers.length) create(input.smallBlockers, [x, y], q, true, 2);
      else if (input.bigObjects.length) create(input.bigObjects, [x, y], q, false, 2);
      else create(input.smallBlockers, [x, y], q, true, 2);
    }
  }

  // Pass 2 — near, the three-stage cascade.
  for (const t of near) {
    const q = rng.below(4);
    const base = rng.betweenFloat(0, 1);
    if (base < fl(0.15) && input.bigObjects.length) {
      create(input.bigObjects, t, q, false, 2);
      continue;
    }
    if (input.smallBlockers.length && rng.betweenFloat(0, 1) < fl(0.4)) {
      create(input.smallBlockers, t, q, true, 2);
      continue;
    }
    if (input.smallNonblockers.length && rng.betweenFloat(0, 1) < fl(0.6)) {
      create(input.smallNonblockers, t, q, true, 1);
    }
  }

  // Pass 3 — mid, no nonblocker stage.
  for (const t of mid) {
    const q = rng.below(4);
    const base = rng.betweenFloat(0, 1);
    if (base < fl(0.3) && input.bigObjects.length) {
      create(input.bigObjects, t, q, false, 2);
      continue;
    }
    if (input.smallBlockers.length && rng.betweenFloat(0, 1) < fl(0.5)) {
      create(input.smallBlockers, t, q, true, 2);
    }
  }

  // Pass 4 — far, big objects only, equality passes.
  for (const t of far) {
    const q = rng.below(4);
    const base = rng.betweenFloat(0, 1);
    if (base <= fl(0.5) && input.bigObjects.length) create(input.bigObjects, t, q, false, 2);
  }

  return placed;
}
