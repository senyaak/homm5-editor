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
  occupancy: Int32Array;
  /** MUTATED IN PLACE — the level's persistent room grid. */
  room: Int32Array[];
  /** The zone's `+0x68` points — read by the recompute only. */
  points: Tile[];
  /**
   * The zone's `+0xCC` — what this step WALKS, both in the bucket scan and
   * in the fence, and not the same set as "the zone's tiles in the grid":
   * the list is FillZones' and nothing rebuilds it, while the grid has since
   * been dented (dist-to-towns disowns a zone's unreachable tiles with -2,
   * the water carve takes the rim). The fence spends a below(4) on every
   * entry, so the difference is DRAWN — which is how `S3-5P4Z12B4` was
   * caught one quadrant short of the engine here.
   */
  tiles: Tile[];
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
  for (const [x, y] of input.tiles) {
    if (occupancy[y * size + x] !== 0) continue;
    if (border[y]![x] === 0) continue;
    const r = room[y]![x]!;
    if (r > 4) far.push([x, y]);
    else if (r >= 3) mid.push([x, y]);
    else if (r === 2) near.push([x, y]);
  }

  const create = (list: Footprint[], at: Tile, q: number, fireDot: boolean, occ: number): void => {
    if (!list.length) throw new Error('one-tile statics: both lists empty — the engine would divide by zero');
    const entry = list[rng.below(list.length)]!;
    const angle = fireDot && entry.path.includes('FireDot') ? input.mapAngle : q * (Math.PI / 2);
    placed.push({ type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle });
    occupancy[at[1] * size + at[0]] = occ;
  };

  // Pass 1 — the border fence.
  for (const [x, y] of input.tiles) {
    const q = rng.below(4);
    if (border[y]![x] !== 0) continue;
    const occ = occupancy[y * size + x]!;
    if (occ !== 0 && occ !== 1 && occ !== 8 && occ !== 0x10 && occ !== 0x20) continue;
    const roll = rng.betweenFloat(0, 1);
    if (roll < fl(0.4) && input.smallBlockers.length) create(input.smallBlockers, [x, y], q, true, 2);
    else if (input.bigObjects.length) create(input.bigObjects, [x, y], q, false, 2);
    else create(input.smallBlockers, [x, y], q, true, 2);
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
// The water one-tile statics — CGameWaterBorderedZone's vtable +0x30
// (`0xECCB50`). The base skeleton with two subtractions and one gate:
//
// - NO border fence — the pass that walked every zone tile is simply
//   absent, so the step starts at the near bucket;
// - the bucket scan walks the zone's `+0xCC` LIST (the carve's rebuilt
//   one) and a tile qualifies when its occupancy is EXACTLY 0 and its
//   border is AT LEAST 3 — the coast band and the rim never bucket;
// - the three cascades are the base's, constants and strictness included
//   (near 0.15/0.4/0.6, mid 0.3/0.5, far <= 0.5 with equality passing).

export type WaterOneTileStaticsInput = OneTileStaticsInput;

/** The whole slot-+0x30 step for one water-bordered zone. */
export function placeWaterOneTileStatics(input: WaterOneTileStaticsInput, rng: DrawSource): PlacedStatic[] {
  const { size, grid, border, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];

  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  const near: Tile[] = [];
  const mid: Tile[] = [];
  const far: Tile[] = [];
  for (const [x, y] of input.tiles) {
    if (occupancy[y * size + x] !== 0) continue;
    if (border[y]![x]! < 3) continue;
    const r = room[y]![x]!;
    if (r > 4) far.push([x, y]);
    else if (r >= 3) mid.push([x, y]);
    else if (r === 2) near.push([x, y]);
  }

  const create = (list: Footprint[], at: Tile, q: number, fireDot: boolean, occ: number): void => {
    if (!list.length) throw new Error('water one-tile statics: empty list reached');
    const entry = list[rng.below(list.length)]!;
    const angle = fireDot && entry.path.includes('FireDot') ? input.mapAngle : q * (Math.PI / 2);
    placed.push({ type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle });
    occupancy[at[1] * size + at[0]] = occ;
  };

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
  /**
   * The substrings this zone's class tests before hanging a light — see
   * `LIGHT_NAMES`. Each subterranean class has its own `+0x3C` and its own
   * predicate: `0xEB2EF0` "Crystal", `0xEB2FB0` then `0xEB3010` "Fakel" or
   * "FireColumn", `0xEB3070` "Crater" or "Lavacrack" or "Hellpikes". The test
   * is a case-sensitive substring of the SHARED resource's path.
   */
  lightNames: readonly string[];
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
  for (const [x, y] of input.tiles) {
    if (occupancy[y * size + x] !== 0) continue;
    if (border[y]![x] === 0) continue;
    if (rock(x, y)) continue;
    if (!inBounds(x, y)) continue;
    const r = room[y]![x]!;
    if (r > 4) far.push([x, y]);
    else if (r >= 3) mid.push([x, y]);
    else if (r === 2) near.push([x, y]);
  }

  // A blocker or nonblocker whose path carries "Crystal" takes the point
  // light's two draws (`0xEC6280`); big objects bypass vt+0x3C entirely.
  const create = (list: Footprint[], at: Tile, q: number, lit: boolean, occ: number): void => {
    if (!list.length) throw new Error('subterra one-tile statics: both lists empty — the engine would draw below(0)');
    const entry = list[rng.below(list.length)]!;
    const angle = lit && entry.path.includes('FireDot') ? input.mapAngle : q * (Math.PI / 2);
    const item: PlacedStatic = { type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle };
    if (lit && input.lightNames.some((sub) => entry.path.includes(sub))) {
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
  for (const [x, y] of input.tiles) {
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

// ---------------------------------------------------------------------------
// The DWARVEN one-tile statics — CGameDwarvenZone's vtable +0x30 (`0xEC7090`,
// vtable `0xFF5214`), read instruction by instruction from the game and held
// against a game map whose underground coin fell dwarven (seed 1788807597).
//
// It shares nothing with the other classes' passes: no room buckets by 2/3-4/
// >4, no fence, no below(4) quadrant, no survival rolls. It is a LATTICE
// torch-and-column placer:
//
//   recomputeRoom(0x3C, 0)
//   A. the rock/edge mask, over the whole LEVEL: a tile whose three corners
//      (x,y), (x,y+1), (x+1,y) of the byte vertex grid are all != 0x10, or
//      with y < 2, x < 2, y > 3*floor((size-1)/3) or x > the same, gets
//      occupancy |= 0x40 and |= 0x400 — TWO bits, and they have to stay two:
//      a tile left at exactly 0x40 is the value the next zone's massif carve
//      turns into a footprint, and the engine's 0x440 is not that value.
//   recomputeRoom(0x400, all=1): room = trunc(distance to the nearest marked
//      tile), over the whole level.
//   B. over the zone's tiles, room == 1 -> list A, room == 2 -> list B.
//   1. list A: only x % 10 == 5 or y % 10 == 5; OneTileBigObjects non-empty;
//      no ledger point nearer than 4.0; entry 1 + below(n - 1) (entry 0 is
//      reserved for pass 3); mint; light for "Fakel"/"FireColumn" (two
//      draws); occupancy = 2; the tile joins the zone's +0x148 ledger.
//   2. list B: the same with x % 10 == 0 or y % 10 == 0, OneTileSmallBlockers
//      and entry below(n).
//   recomputeRoom(0x3C, 0)
//   C. over the zone's tiles with occupancy == 0: room > 2 -> list C,
//      room == 2 -> list D.
//   3. list C: no gates, no draw for the entry — OneTileBigObjects[0]
//      (the Dwarf_Column), mint, occupancy = 2 | 0x400, no ledger.
//   4. list D: no lattice, the spacing rule, entry below(n - 1) (never the
//      last), mint, light, occupancy = 2, ledger.
//
// Every rotation is the literal 0. The trace of the first dwarven zone seen
// spends 2,289 draws in exactly this rhythm: below(3), the mint's two
// below(65535), below(5), below(5), per placed object.

export function placeDwarvenOneTileStatics(
  input: SubterraOneTileStaticsInput,
  rng: DrawSource,
): PlacedStatic[] {
  const { size, grid, occupancy, room, zoneIndex } = input;
  const w = size + 1;
  const placed: PlacedStatic[] = [];
  const fl = Math.fround;

  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  // A. The rock and frame mask, level-wide.
  const V = (x: number, y: number): number => input.vertexHeights.bytes[y * w + x]!;
  const fence = 3 * Math.floor((size - 1) / 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rock3 = y < size - 1 && V(x, y) !== 0x10 && V(x, y + 1) !== 0x10 && V(x + 1, y) !== 0x10;
      if (rock3 || y < 2 || x < 2 || y > fence || x > fence) occupancy[y * size + x] = occupancy[y * size + x]! | 0x40 | 0x400;
    }
  }
  const marked: Tile[] = [];
  for (const [x, y] of input.tiles) if ((occupancy[y * size + x]! & 0x400) !== 0) marked.push([x, y]);
  recomputeRoom(room, size, grid, zoneIndex, marked, true);

  // B. The two rings hugging the walls.
  const listA: Tile[] = [];
  const listB: Tile[] = [];
  for (const [x, y] of input.tiles) {
    const r = room[y]![x]!;
    if (r === 1) listA.push([x, y]);
    else if (r === 2) listB.push([x, y]);
  }

  const ledger: Tile[] = [];
  const dist = ([ax, ay]: Tile, [bx, by]: Tile): number =>
    fl(Math.sqrt(fl((ax - bx) * (ax - bx) + (ay - by) * (ay - by))));
  const tooClose = (at: Tile): boolean => ledger.some((p) => dist(p, at) < fl(4));
  const create = (entry: Footprint, at: Tile, occ: number, join: boolean): void => {
    const item: PlacedStatic = { type: entry.path, name: mintName(rng), x: at[0], y: at[1], angle: 0 };
    if (input.lightNames.some((sub) => entry.path.includes(sub))) {
      const p = input.pointLight;
      item.light = {
        z: p.zMin + rng.below(p.zMax - p.zMin),
        radius: p.lightRadiusMin + rng.below(p.lightRadiusMax - p.lightRadiusMin),
      };
    }
    placed.push(item);
    occupancy[at[1] * size + at[0]] = occ;
    if (join) ledger.push(at);
  };

  // 1. The inner ring, on the 5-lattice, from the columns past the first.
  for (const t of listA) {
    if (t[0] % 10 !== 5 && t[1] % 10 !== 5) continue;
    if (!input.bigObjects.length) continue;
    if (tooClose(t)) continue;
    create(input.bigObjects[1 + rng.below(input.bigObjects.length - 1)]!, t, 2, true);
  }
  // 2. The second ring, on the 0-lattice, from the torches.
  for (const t of listB) {
    if (t[0] % 10 !== 0 && t[1] % 10 !== 0) continue;
    if (!input.smallBlockers.length) continue;
    if (tooClose(t)) continue;
    create(input.smallBlockers[rng.below(input.smallBlockers.length)]!, t, 2, true);
  }

  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  // C. The open floor, by room.
  const listC: Tile[] = [];
  const listD: Tile[] = [];
  for (const [x, y] of input.tiles) {
    if (occupancy[y * size + x] !== 0) continue;
    const r = room[y]![x]!;
    if (r > 2) listC.push([x, y]);
    else if (r === 2) listD.push([x, y]);
  }
  // 3. Every deep tile takes the reserved column, no draw for the choice.
  for (const t of listC) {
    if (!input.bigObjects.length) throw new Error('dwarven one-tile statics: OneTileBigObjects empty — the engine reads past its end');
    create(input.bigObjects[0]!, t, 2 | 0x400, false);
  }
  // 4. The room-2 tiles, spaced, from the torches but the last.
  for (const t of listD) {
    if (!input.smallBlockers.length) continue;
    if (tooClose(t)) continue;
    create(input.smallBlockers[rng.below(input.smallBlockers.length - 1)]!, t, 2, true);
  }
  return placed;
}
