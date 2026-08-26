// The last phase of the generator — `CTreasureBlockDistributor`, entered from
// GenerateMap at 0xeac0b0 through the per-zone loop 0xEA3AE0 and 0xEBA420.
// Two halves, and they are two functions:
//
//   0xED5650  grow the blocks   — one below(8) per surviving seed tile
//   0xED49D0  fill them         — a guard, an artifact, and the piles
//
// Read from the GAME executable. Beware 0xED3F00: it carries the same log
// string and looks like this phase, but nothing calls it and it is in no
// vtable — an older redaction left as a COMDAT duplicate, and its artifact
// pool is picked differently. The live path is 0xED49D0.
//
// WHAT A BLOCK IS. Before either half runs, 0xEBA420 recomputes the room grid
// with mask 0x38 — the three road lists — so `room` here is the distance to
// the nearest ROAD tile. A seed is a free tile at room EXACTLY 1, more than
// 3.0 (squared) away from the town, with at least two free neighbours FURTHER
// from the road than itself; the block then grows into those of its eight
// neighbours that touch at least two footprints (occupancy 2) and no guard
// (occupancy 4). Fewer than two grown points and the seed is dropped. So the
// piles hug the roads and lean on what is already built.
//
// THE VALUE. Every block starts valueless; once they all exist, the zone's
// `TreasureBlocksTotalValue` is split among them — in a zone WITH a town by
// each block's distance to it, so the far blocks are the rich ones, and in a
// townless zone evenly. A block under 600 is then skipped whole: no guard, no
// artifact, no piles, and no draws.
//
// THE DRAWS, per filled block:
//
//   SetMonster            trunc(value * 2.5 + 0.5) of power, 4 or 5 draws
//   below(candidates)     the artifact, or below(1) when nothing fits
//   per point of the spot 0..3 draws, then betweenFloat(0,1) for the rotation
//                         and two below(65535) minting the name
//
// The artifact is spent on the point at index 1 and only there, and that
// point gets nothing else. Its cost is a FIFTH of the artifact's own, both in
// the window that admits it and in what it takes out of the block.

import { mintName, setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { EIGHT } from './placement.ts';
import type { Tile } from './placement.ts';

const fl = Math.fround;

/** One grown spot: the seed, its points, and the value it was handed. */
export interface TreasureBlock {
  /** The SEED tile — 0xed5d47 stores it raw; no centroid is ever computed. */
  x: number;
  y: number;
  /** The grown neighbours, in the neighbour table's fixed order. */
  points: Tile[];
  /** Filled by the split at 0xed5f4a, not by the growth. */
  value: number;
  /** `trunc(distance to the town)`, the weight the split divides by. */
  distToTown: number;
}

export interface BuildBlocksInput {
  size: number;
  /** The zone grid is not read by this phase — occupancy and room are. */
  occupancy: Uint8Array;
  /** The room grid AFTER `0xEC28E0(0x38, 0)`: distance to the nearest road. */
  room: Int32Array[];
  /** `zone+0xCC` — every tile of the zone, in FillZones' scan order. */
  tiles: Tile[];
  /** `zone+0xC` under the town flag; a townless zone reads .bss zeroes. */
  town: Tile;
  /** `zone+0xF8` — with a town the split is by distance, without it even. */
  hasTown: boolean;
  /** `zone+0x98` — points a block must stay `distBetween` away from. */
  repel: Tile[];
  /** The zone record's `TreasureBlocksTotalValue`. */
  totalValue: number;
  /** `params+0x84`, `DistBetweenTreasureBlocks` — an int, compared as float. */
  distBetween: number;
}

/** A tile the phase will consider: untouched, or carrying bit 0. */
const seedFree = (v: number): boolean => v === 0 || (v & 1) !== 0;

/** The engine's own single-precision distance: float square, double sqrt. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = fl(ax - bx);
  const dy = fl(ay - by);
  return fl(Math.sqrt(fl(fl(dy * dy) + fl(dx * dx))));
}

/**
 * `0xED5650` — grow the zone's blocks and split the zone's value among them.
 * Spends exactly one below(8) per tile that passes the occupancy, room and
 * town-distance gates; everything after the draw only decides whether the
 * seed becomes a block.
 */
export function buildTreasureBlocks(input: BuildBlocksInput, rng: DrawSource): TreasureBlock[] {
  const { size, occupancy, room, tiles, town, repel, distBetween } = input;
  const blocks: TreasureBlock[] = [];

  // The bounds test the engine runs in floats, on the neighbour's coordinate:
  // at least 1, and strictly under size - 1. A tile on the outermost ring is
  // never a neighbour, which is why a block never grows off the map.
  const inBounds = (x: number, y: number): boolean =>
    y >= 1 && size - 1 > y && x >= 1 && size - 1 > x;
  const occAt = (x: number, y: number): number => occupancy[y * size + x]!;

  for (const [tx, ty] of tiles) {
    const ix = Math.trunc(tx);
    const iy = Math.trunc(ty);
    if (!seedFree(occAt(ix, iy))) continue;
    if (room[iy]![ix] !== 1) continue;

    const ax = fl(ix - town[0]);
    const ay = fl(iy - town[1]);
    if (!(fl(fl(ay * ay) + fl(ax * ax)) > 3)) continue;

    // ------------------------------------------------ the phase's only draw
    const start = rng.below(8);

    let rejected = false;
    let boundary = 0;
    for (let i = start; i < start + 8; i++) {
      if (rejected) break; // the engine tests at the TOP of the next turn
      const [dx, dy] = EIGHT[i & 7]!;
      const nx = Math.trunc(ix + dx);
      const ny = Math.trunc(iy + dy);
      if (!inBounds(nx, ny)) continue;
      // A guard anywhere around the seed kills it outright; a free neighbour
      // further from the road than the seed is what the growth will use.
      if (occAt(nx, ny) & 4) rejected = true;
      if (seedFree(occAt(nx, ny)) && room[ny]![nx]! > 1) boundary++;
    }
    if (rejected) continue;
    if (boundary <= 1) continue;

    // Distances are measured from the RAW tile, and the limit is the int
    // parameter converted to float — so a seed exactly `distBetween` away
    // from a block survives, and one a hair nearer does not.
    let tooClose = false;
    for (const b of blocks) {
      if (dist(tx, ty, b.x, b.y) < distBetween) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      for (const [rx, ry] of repel) {
        if (dist(tx, ty, rx, ry) < distBetween) {
          tooClose = true;
          break;
        }
      }
    }
    if (tooClose) continue;

    // ----------------------------------------------------- grow the spot
    const points: Tile[] = [];
    for (const [dx, dy] of EIGHT) {
      const cx = Math.trunc(ix + dx);
      const cy = Math.trunc(iy + dy);
      if (!inBounds(cx, cy)) continue;
      if (!seedFree(occAt(cx, cy))) continue;
      if (room[cy]![cx]! < 1) continue;

      let touching = 0;
      let guarded = false;
      for (const [mx, my] of EIGHT) {
        const px = Math.trunc(cx + mx);
        const py = Math.trunc(cy + my);
        if (!inBounds(px, py)) continue;
        if (occAt(px, py) & 2) touching++;
        if (occAt(px, py) & 4) guarded = true;
      }
      if (touching < 2 || guarded) continue;
      points.push([cx, cy]);
    }
    if (points.length < 2) continue;

    blocks.push({
      x: tx,
      y: ty,
      points,
      value: 0,
      distToTown: Math.trunc(dist(tx, ty, town[0], town[1])),
    });
  }

  // ------------------------------------------------------- split the value
  if (blocks.length) {
    let sum = 0;
    for (const b of blocks) sum += b.distToTown;
    for (const b of blocks) {
      b.value = input.hasTown
        ? Math.trunc(Math.imul(b.distToTown, input.totalValue) / sum)
        : Math.trunc(input.totalValue / blocks.length);
    }
  }
  return blocks;
}

/** An artifact as the distributor's pool holds it: the id order, and a cost. */
export interface ArtifactEntry {
  id: number;
  cost: number;
  href: string;
}

/** Below this the block is skipped whole, draws included. */
export const MIN_BLOCK_VALUE = 600;

/** `0x121EBA0` — the seven resources, in the order `below(7)` indexes them. */
export const BLOCK_RESOURCES: readonly string[] = [
  'Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gems', 'Gold',
];
export const BLOCK_CHEST = 'Chest';

const treasureHref = (name: string): string =>
  `/MapObjects/${name}.(AdvMapTreasureShared).xdb#xpointer(/AdvMapTreasureShared)`;

export interface PlacedTreasure {
  /** `item_<signed int32>`, minted from two below(65535). */
  name: string;
  href: string;
  x: number;
  y: number;
  rotation: number;
  /** Written as Amount, with IsCustom, unless this is the artifact. */
  amount: number | null;
  kind: 'resource' | 'chest' | 'artifact';
}

export interface FillBlocksInput {
  size: number;
  /** Read for the guard's facing only — this phase stamps nothing. */
  occupancy: Uint8Array;
  blocks: TreasureBlock[];
  /** The distributor's `+0x70`, in ascending id order. */
  artifacts: readonly ArtifactEntry[];
  monsterStrength: number;
  tables: GuardTables;
}

export interface FilledBlock {
  guard: Guard | null;
  /** The guard's tile — the block's seed — and its computed facing. */
  guardAt: Tile;
  guardRotation: number;
  items: PlacedTreasure[];
}

/**
 * `0xED49D0` — fill the grown blocks. The guard comes first and sits on the
 * seed, facing away from whatever surrounds it; then one draw picks the
 * artifact; then the points are walked in growth order.
 */
export function fillTreasureBlocks(input: FillBlocksInput, rng: DrawSource): FilledBlock[] {
  const { size, occupancy, blocks } = input;
  const out: FilledBlock[] = [];
  const occAt = (x: number, y: number): number => occupancy[y * size + x]!;
  const inBounds = (x: number, y: number): boolean =>
    y >= 1 && size - 1 > y && x >= 1 && size - 1 > x;

  for (const block of blocks) {
    const opening = block.value;
    if (opening < MIN_BLOCK_VALUE) continue;

    // The facing: sum the directions to the block's own points and to every
    // surrounding tile that carries a footprint or a guard, nudge both by a
    // hundredth so a null vector still has an angle, and turn your back on it.
    let accX = 0;
    let accY = 0;
    for (const [px, py] of block.points) {
      accX = fl(accX + fl(px - block.x));
      accY = fl(accY + fl(py - block.y));
    }
    for (const [dx, dy] of EIGHT) {
      const nx = Math.trunc(block.x + dx);
      const ny = Math.trunc(block.y + dy);
      if (!inBounds(nx, ny)) continue;
      if ((occAt(nx, ny) & 6) === 0) continue;
      accX = fl(accX + fl(nx - block.x));
      accY = fl(accY + fl(ny - block.y));
    }
    accX = fl(accX + fl(0.01));
    accY = fl(accY + fl(0.01));
    const guardRotation = fl(-Math.atan2(accX, accY));

    const power = Math.trunc(fl(fl(opening * fl(2.5)) + fl(0.5)));
    const guard = setMonster(power, input.monsterStrength, input.tables, rng);

    // ------------------------------------------------------- the artifact
    // The window is in FIFTHS of the artifact's cost: dear enough to be worth
    // the block's value, cheap enough that a seventh of it still is.
    let value = block.value;
    const candidates = input.artifacts.filter((a) => {
      const c = Math.trunc(a.cost / 5);
      return c + 500 < value && c * 7 > value;
    });
    let artifact: ArtifactEntry | null = null;
    if (!candidates.length) {
      rng.below(1); // the draw is spent even when there is nothing to pick
    } else {
      artifact = candidates[rng.below(candidates.length)]!;
      value -= Math.trunc(artifact.cost / 5);
    }

    // ----------------------------------------------------------- the piles
    const items: PlacedTreasure[] = [];
    const pc = block.points.length;
    for (let j = 0; j < pc; j++) {
      const [px, py] = block.points[j]!;
      const place = (href: string, amount: number | null, kind: PlacedTreasure['kind']): void => {
        const rotation = rng.betweenFloat(0, 1);
        items.push({ name: mintName(rng), href, x: px, y: py, rotation, amount, kind });
      };

      if (artifact && j === 1) {
        // The artifact takes the point whole — no pile shares it.
        place(artifact.href, null, 'artifact');
        continue;
      }

      let perPoint = Math.trunc(Math.trunc(value / pc) / 100);
      if (perPoint <= 1) {
        place(treasureHref(BLOCK_CHEST), Math.trunc(perPoint / 6) + 1, 'chest');
        continue;
      }
      if (perPoint > 10) perPoint = rng.below(6) + 7;
      // Three points or more, and the pile may become a chest instead.
      const chest = pc >= 3 && rng.below(2) !== 0;
      if (chest) place(treasureHref(BLOCK_CHEST), Math.trunc(perPoint / 6) + 1, 'chest');
      else place(treasureHref(BLOCK_RESOURCES[rng.below(7)]!), perPoint, 'resource');
    }

    out.push({ guard, guardAt: [block.x, block.y], guardRotation, items });
  }
  return out;
}
