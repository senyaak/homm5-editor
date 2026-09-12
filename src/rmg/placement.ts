// The placement machinery MainObjects' workers share — read once out of the
// mines worker and confirmed against the dwellings worker instruction for
// instruction: the room grid (0xEC28E0 with mask 4), the maximum-and-filter
// (0xEC2EB0 plus the caller's threshold), the drawless fit test (0xEC3510)
// and the stamp (0xEC2F90). Each worker keeps its own candidate gathering and
// its own threshold divisor — mines 5, dwellings 3 — and hands the rest here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';
import type { Offset } from './town-data.ts';
import { rotate } from './towns.ts';

export type Tile = readonly [number, number];

/**
 * The distance between two tiles, the way the engine takes it: the squares
 * summed and `sqrtss`'d in single precision (`0xEC28E0` ends in
 * `cvttss2si` over that register). NOT `Math.hypot`, which scales before it
 * squares and is off by an ulp on exact answers — `Math.hypot(99, 20)` is
 * 100.99999999999999 where the engine has 101.0 — and every consumer of a
 * distance here truncates it or compares it against an integer bound, so
 * that ulp is the difference between a candidate and none. Block E's
 * `S7-22P2-8Z15K2.4c` at seed 2002 is where it showed: one tile at room
 * 100 against the engine's 101, one candidate short of the engine's 821,
 * and the first teleport of zone 8 on a different tile.
 */
export function tileDistance(dx: number, dy: number): number {
  return Math.fround(Math.sqrt(dx * dx + dy * dy));
}

/**
 * The room grid — 0xEC28E0 with mask 4: per tile of the zone, the truncated
 * distance to the nearest stamped point.
 *
 * With NO points the answer is 10000, and that is READ rather than assumed.
 * The note here used to call it "stale xmm0, unmeasured": the conversion at
 * `0xEC2E26` does read the register (`cvttss2si ecx,xmm0`), but `0xEC29AE`
 * writes it per tile before the point loops — `movss xmm0,[0xFAA664]`, and that
 * dword is 10000.0f. Each loop's tail leaves the running minimum in xmm0
 * (`minss xmm0,[running]; movss [running],xmm0`), so an empty list leaves the
 * initialisation standing. Every candidate is kept, which is what this port
 * already answered — for the right reason now.
 */
export function roomGrid(size: number, grid: Int32Array[], zoneIndex: number, points: Tile[]): Int32Array[] {
  const out = Array.from({ length: size }, () => new Int32Array(size).fill(-1));
  recomputeRoom(out, size, grid, zoneIndex, points);
  return out;
}

/**
 * The recompute as the engine runs it — IN PLACE on the level's one
 * persistent grid, this zone's tiles only. Every other tile keeps whatever
 * the previous recompute (of any zone) left there, and that staleness is
 * load-bearing: the statics fit `0xEC39D0` reads room without a zone test,
 * so a footprint spilling over the border sees the neighbour's LAST
 * recomputed values, not fresh ones.
 */
/**
 * Recompute into the level's persistent grid when the caller carries one,
 * else into a fresh throwaway — same values either way for this zone's own
 * tiles, which is all the first-loop steps ever read.
 */
export function ensureRoom(
  room: Int32Array[] | undefined,
  size: number,
  grid: Int32Array[],
  zoneIndex: number,
  points: Tile[],
): Int32Array[] {
  const out = room ?? Array.from({ length: size }, () => new Int32Array(size).fill(-1));
  recomputeRoom(out, size, grid, zoneIndex, points);
  return out;
}

export function recomputeRoom(
  room: Int32Array[],
  size: number,
  grid: Int32Array[],
  zoneIndex: number,
  points: Tile[],
  // `0xEC28E0`'s second argument: with it every cell of the level takes the
  // fresh distance, foreign zones' included — the dwarven one-tile pass's
  // rock-distance recompute (`mask 0x400, all=1`) is the one caller.
  all = false,
): void {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      // 0xEC28E0 walks EVERY cell of the level: a zoneless cell (grid < 0)
      // is written 1000 on every recompute, a foreign zone's cell is left
      // alone, and only this zone's cells get the fresh distances.
      if (grid[y]![x]! < 0) {
        room[y]![x] = 1000;
        continue;
      }
      if (!all && grid[y]![x] !== zoneIndex) continue;
      let m = 10000;
      for (const [px, py] of points) {
        const d = tileDistance(px - x, py - y);
        if (d < m) m = d;
      }
      room[y]![x] = Math.trunc(m);
    }
  }
  // THE WALK IS THE GRID'S, not the zone's tile list, and the water order is
  // where that stops being a distinction without a difference. A rim tile the
  // carve took out of the grid but left on the list used to be given its real
  // distance here — fitted to the island reference, and wrong: `0xEC28E0`
  // reads the ZONE GRID cell by cell (`+0xC4` → `test eax,eax; jns`), writes
  // 1000 wherever it is negative and never looks at a list at all. The three
  // seeds that patch smuggled into `S0-1P2Z2K3T`'s treasure blocks are what
  // named it; with the walk as the engine walks it, that order comes out on
  // the engine's own 64933 draws, byte for byte.
}

export interface RoomFilterResult {
  kept: Tile[];
  /** 0xEC2EB0's answer — the room's maximum over the qualifying candidates. */
  max: number;
  /** `trunc(2 * max / divisor)` — signed, so 0 when nothing qualifies. */
  threshold: number;
}

/**
 * The per-object filter — mines at 0xEB60B7, dwellings at 0xEB8CD0, told
 * apart only by the divisor (5 against 3). The zone, border and occupancy
 * tests decide what counts toward the MAXIMUM (0xEC2EB0); the survival test
 * is the room against the threshold and nothing else. The kept list is built
 * fresh from the original each time, so a candidate struck out by a failed
 * fit earlier is back for the next object.
 */
export function filterByRoom(
  candidates: Tile[],
  room: Int32Array[],
  grid: Int32Array[],
  border: Int32Array[],
  occupancy: Int32Array,
  size: number,
  zoneIndex: number,
  divisor: number,
): RoomFilterResult {
  let max = 0;
  for (const [x, y] of candidates) {
    if (grid[y]![x] !== zoneIndex) continue;
    if (border[y]![x]! <= 2) continue;
    if (occupancy[y * size + x] === 2) continue;
    const r = room[y]![x]!;
    if (r > max) max = r;
  }
  const threshold = Math.trunc((2 * max) / divisor);
  return { kept: candidates.filter(([x, y]) => room[y]![x]! > threshold), max, threshold };
}

// ---------------------------------------------------------------------------
// Footprints — the three offset lists a shared document carries and the
// placement routines read.

export interface Footprint {
  /** The href path, xpointer stripped — the identity the map file keeps. */
  path: string;
  blocked: Offset[];
  active: Offset[];
  marker: Offset;
}

/**
 * Read any `AdvMap*Shared` document by its href. The tag is taken from the
 * `#xpointer(...)` suffix — a preset's Academy/Workshop.xdb has no tag in its
 * file name, only in the pointer.
 */
export function readFootprint(dataRoot: string, href: string): Footprint {
  const path = href.replace(/#xpointer\(.*\)$/, '');
  const tag = /#xpointer\(\/(\w+)\)/.exec(href)?.[1] ?? /\.\((\w+)\)\.xdb$/.exec(path)?.[1];
  if (!tag) throw new Error(`${href}: no document tag in the href`);
  const doc = find(parse(readFileSync(join(dataRoot, path.replace(/^\//, '')), 'utf8')), tag);
  if (!doc) throw new Error(`${path}: not an ${tag}`);
  const offsets = (name: string): Offset[] => {
    const holder = find(doc, name);
    return holder
      ? findAll(holder, 'Item').map((i): Offset => [
          Number.parseInt(childText(i, 'x'), 10) || 0,
          Number.parseInt(childText(i, 'y'), 10) || 0,
        ])
      : [];
  };
  const marker = find(doc, 'PossessionMarkerTile');
  return {
    path,
    blocked: offsets('blockedTiles'),
    active: offsets('activeTiles'),
    marker: marker
      ? [Number.parseInt(childText(marker, 'x'), 10) || 0, Number.parseInt(childText(marker, 'y'), 10) || 0]
      : [0, 0],
  };
}

/**
 * The direction tables — map-coordinate pairs, the first number moves x.
 * `0x1093928` is eight offsets, orthogonals then diagonals: the piles walk
 * all eight, the border stamps use the first four. `0x1093968` is the guard's
 * four orthogonals.
 */
export const EIGHT: ReadonlyArray<Offset> = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
];
export const FOUR: ReadonlyArray<Offset> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** A tile is free when nothing touched it, or only a road did. */
export const isFree = (v: number): boolean => v === 0 || (v & 0x38) !== 0;

export interface FitContext {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  occupancy: Int32Array;
  zoneIndex: number;
  /** The zone's floor — floor 1 adds the five-tile margin (0xEC365D). */
  floor?: number;
}

/**
 * Whether the object fits at `tile` rotated by `q` — the port of `0xEC3510`,
 * which spends no draws and which mines and dwellings call with the same six
 * arguments. Three loops, read out of the function itself:
 *
 * - blocked tiles and the marker: in the map, in this zone, occupancy
 *   EXACTLY 0 — a road blocks the object even though it counts as free
 *   elsewhere — and border distance at least 1. The marker's (0,0) pair is
 *   skipped whole.
 * - active tiles: the same, but border distance at least THREE.
 *
 * The active gate is what the traced run shows: zone 1's Sulfur_Dune fails
 * its first drawn tile — whose active tile would stand at border distance
 * 2 — and succeeds on the second, whose sits at 5. The live replay walks
 * through both.
 *
 * Floor 1 (exactly — `cmp [zone+0xF4], 1` at 0xEC3667) adds a five-tile
 * margin from the map edge to every checked tile: the coordinate must be
 * at least 5 and strictly under size-5, tested between the bounds and the
 * grid reads.
 */
export function fits(ctx: FitContext, foot: Footprint, tile: Tile, q: number): boolean {
  const { size, grid, border, occupancy, zoneIndex } = ctx;
  const margin = ctx.floor === 1;
  const lists: Array<{ offs: readonly Offset[]; minDepth: number; skipZero: boolean }> = [
    { offs: foot.blocked, minDepth: 1, skipZero: false },
    { offs: [foot.marker], minDepth: 1, skipZero: true },
    { offs: foot.active, minDepth: 3, skipZero: false },
  ];
  for (const { offs, minDepth, skipZero } of lists) {
    for (const off of offs) {
      if (skipZero && off[0] === 0 && off[1] === 0) continue;
      const [dx, dy] = rotate(q, off);
      const x = tile[0] + dx;
      const y = tile[1] + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) return false;
      if (margin && (x < 5 || x >= size - 5 || y < 5 || y >= size - 5)) return false;
      if (grid[y]![x] !== zoneIndex) return false;
      if (occupancy[y * size + x] !== 0) return false;
      if (border[y]![x]! < minDepth) return false;
    }
  }
  return true;
}

/**
 * The candidate list `zone+0xCC` — every tile of the zone in FillZones' scan
 * order, the same map-x outer walk the mines gather uses. `0xEB7790` (its
 * only caller is FillZones) tests nothing but zone membership, and the list
 * is never rebuilt. Dwellings draw from it raw; the price-list placers
 * (upgrade buildings, shrines) filter it by room per object.
 */
export function zoneTiles(size: number, grid: Int32Array[], zoneIndex: number): Tile[] {
  const out: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] === zoneIndex) out.push([x, y]);
    }
  }
  return out;
}

/**
 * The attempt loop every placement worker shares: `below(candidates)` picks a
 * tile, `below(4)` a quadrant — the quadrant is drawn BEFORE the fit is
 * tested, so a rejected candidate has already cost both draws — and a failed
 * fit strikes the candidate out and draws again. Exhaustion returns null;
 * what that means (skip the instance, or abandon the step) is the caller's.
 */
export function tryPlace(
  ctx: FitContext,
  foot: Footprint,
  kept: Tile[],
  rng: { below(limit: number): number },
): { tile: Tile; q: number } | null {
  const pool = [...kept];
  while (pool.length) {
    const pick = rng.below(pool.length);
    const q = rng.below(4);
    const candidate = pool[pick]!;
    if (fits(ctx, foot, candidate, q)) return { tile: candidate, q };
    pool.splice(pick, 1);
  }
  return null;
}

export interface StampContext {
  size: number;
  /** MUTATED: blocked tiles mark 2, active tiles and the marker mark 4. */
  occupancy: Int32Array;
  /** MUTATED: the tiles marked 4 join the zone's room points. */
  points: Tile[];
  /**
   * MUTATED when carried: the stamped-blocked ledger — the zone's `+0x5C`
   * list, the extra bit of the lakes' 0x3E room mask. Only the STAMP
   * feeds it: a mine's piles and the one-tile statics write their 2s
   * directly and stay out (measured on the underground run's zone-2 lake
   * candidates — a pile in the list is one candidate short, all stamps
   * out is thirteen over).
   */
  blocked?: Tile[];
}

/**
 * The stamp — 0xEC2F90's three passes: blocked tiles into the 2s, active
 * tiles and a non-zero marker into the 4s and the room points. Returns the
 * active tiles in stamp order — the footprint vector (`zone+0x11C`) whose
 * LAST entry seats a mine's guard; the marker stays out of it.
 */
export function stampFootprint(ctx: StampContext, foot: Footprint, at: Tile, q: number): Tile[] {
  const { size, occupancy, points } = ctx;
  const active: Tile[] = [];
  const stamp = (offs: readonly Offset[], value: number, intoPoints: boolean, collect: boolean): void => {
    for (const off of offs) {
      const [dx, dy] = rotate(q, off);
      const x = at[0] + dx;
      const y = at[1] + dy;
      // `0xEC2F90` bounds-checks NOTHING: the vector pushes take the RAW
      // pair (out-of-range included — the room recomputes then measure
      // distance to it as-is), and the occupancy write wraps through the
      // grid's contiguous x-major buffer (rows[x][y] = buf[x*size+y]) —
      // an out-of-range y bleeds into the neighbouring row, an
      // out-of-range x leaves the buffer and is dropped here.
      if (intoPoints) points.push([x, y]);
      if (collect) active.push([x, y]);
      if (value === 2) ctx.blocked?.push([x, y]);
      const flat = x * size + y;
      if (x < 0 || x >= size || flat < 0 || flat >= size * size) continue;
      const xw = Math.floor(flat / size);
      const yw = flat - xw * size;
      occupancy[yw * size + xw] = value;
    }
  };
  stamp(foot.blocked, 2, false, false);
  stamp(foot.active, 4, true, true);
  if (foot.marker[0] !== 0 || foot.marker[1] !== 0) stamp([foot.marker], 4, true, false);
  return active;
}
