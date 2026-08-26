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
import type { VertexHeights } from './massif-carve.ts';
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

// ---------------------------------------------------------------------------
// The subterranean one-tile statics — CGameSubterraZone's vtable +0x30
// (`0xEC50C0`; SubInferno's `0xEC9920` is an instruction-identical clone).
// The base skeleton — bucket scan, fence, near/mid/far with the same
// cascade constants and strictness — with three changes:
//
// - a ROCK + BOUNDS filter everywhere: a tile whose corner vertex byte
//   (`level+0x24`, read through `0xED17A0` with the pair swapped into the
//   grid's own transposed convention) is above 0x10 is rock, and a tile
//   within one of the map edge is out; both are tested BEFORE any draw;
// - a SURVIVAL pre-roll opens every pass — fence >= 0.7, near >= 0.6,
//   mid and far >= 0.9 (`comiss K, roll; ja skip`: equality survives) —
//   and in near/mid/far it comes BEFORE the below(4) quadrant, where the
//   base drew below(4) first;
// - created blockers and nonblockers go through vt+0x3C (`0xEC6280`): a
//   resource path containing "Crystal" takes a point light for two draws
//   (z = zMin + below(zMax - zMin), radius likewise); big objects never
//   do. The colour is drawless — preset Colors[zoneId % count].
//
// The fence keeps the base's oddity of drawing below(4) before its border
// and occupancy tests (only rock/bounds precede it), and no pass here
// stamps or joins the ledgers, same as base.

export interface SubterraOneTileStaticsInput extends OneTileStaticsInput {
  /** The floor's vertex height grids — the rock tests read the bytes. */
  vertexHeights: VertexHeights;
  /** `SRMGParameters.PointLightParams` — spans for the two light draws. */
  pointLight: { zMin: number; zMax: number; lightRadiusMin: number; lightRadiusMax: number };
}

/** The whole slot-+0x30 step for one subterranean-class zone. */
export function placeSubterraOneTileStatics(
  input: SubterraOneTileStaticsInput,
  rng: DrawSource,
): PlacedStatic[] {
  const { size, grid, border, occupancy, room, zoneIndex } = input;
  const w = size + 1;
  const placed: PlacedStatic[] = [];

  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  // `0xED17A0` — the corner vertex byte, in the vertex grids' own
  // transposed convention; above 0x10 is rock.
  const rock = (x: number, y: number): boolean => input.vertexHeights.bytes[y * w + x]! > 0x10;
  const inBounds = (x: number, y: number): boolean =>
    x >= 1 && x < size - 1 && y >= 1 && y < size - 1;

  // The bucket scan — base thresholds plus the rock and bounds filters.
  const near: Tile[] = [];
  const mid: Tile[] = [];
  const far: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (occupancy[y * size + x] !== 0) continue;
      if (border[y]![x] === 0) continue;
      if (rock(x, y)) continue;
      if (!inBounds(x, y)) continue;
      const r = room[y]![x]!;
      if (r > 4) far.push([x, y]);
      else if (r >= 3) mid.push([x, y]);
      else if (r === 2) near.push([x, y]);
    }
  }

  // A blocker or nonblocker whose path carries "Crystal" takes the point
  // light's two draws (`0xEC6280`); big objects bypass vt+0x3C entirely.
  const create = (list: Footprint[], at: Tile, q: number, lit: boolean, occ: number): void => {
    if (!list.length) throw new Error('subterra one-tile statics: both lists empty — the engine would draw below(0)');
    const entry = list[rng.below(list.length)]!;
    const angle = lit && entry.path.includes('FireDot') ? input.mapAngle : q * (Math.PI / 2);
    const item: PlacedStatic = { type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle };
    if (lit && entry.path.includes('Crystal')) {
      const p = input.pointLight;
      item.light = {
        z: p.zMin + rng.below(p.zMax - p.zMin),
        radius: p.lightRadiusMin + rng.below(p.lightRadiusMax - p.lightRadiusMin),
      };
    }
    placed.push(item);
    occupancy[at[1] * size + at[0]] = occ;
  };

  // Pass 1 — the fence: rock and bounds before the bare below(4), the
  // survival roll after the border and occupancy tests.
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (rock(x, y)) continue;
      if (!inBounds(x, y)) continue;
      const q = rng.below(4);
      if (border[y]![x] !== 0) continue;
      const occ = occupancy[y * size + x]!;
      if (occ !== 0 && occ !== 1 && occ !== 8 && occ !== 0x10 && occ !== 0x20) continue;
      if (rng.betweenFloat(0, 1) < fl(0.7)) continue;
      const roll = rng.betweenFloat(0, 1);
      if (roll < fl(0.4) && input.smallBlockers.length) create(input.smallBlockers, [x, y], q, true, 2);
      else if (input.bigObjects.length) create(input.bigObjects, [x, y], q, false, 2);
      else create(input.smallBlockers, [x, y], q, true, 2);
    }
  }

  // Pass 2 — near: survival, THEN the quadrant, then the base cascade.
  for (const t of near) {
    if (rng.betweenFloat(0, 1) < fl(0.6)) continue;
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

  // Pass 3 — mid: survival at 0.9, no nonblocker stage.
  for (const t of mid) {
    if (rng.betweenFloat(0, 1) < fl(0.9)) continue;
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

  // Pass 4 — far: survival at 0.9, big objects only, equality passes.
  for (const t of far) {
    if (rng.betweenFloat(0, 1) < fl(0.9)) continue;
    const q = rng.below(4);
    const base = rng.betweenFloat(0, 1);
    if (base <= fl(0.5) && input.bigObjects.length) create(input.bigObjects, t, q, false, 2);
  }

  return placed;
}
