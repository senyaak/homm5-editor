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
 * The room grid — 0xEC28E0 with mask 4: per tile of the zone, the truncated
 * distance to the nearest stamped point.
 *
 * With NO points the engine's answer is stale xmm0 — the conversion reads the
 * register, and nothing wrote it for this tile (docs/RMG.md). That path is
 * unmeasured: every zone of the reference run has at least one point by the
 * time mines are placed. This port answers 10000 — the engine's own "min
 * never beaten" start — which keeps every candidate, and says so here so the
 * divergence is findable if a template ever reaches it.
 */
export function roomGrid(size: number, grid: Int32Array[], zoneIndex: number, points: Tile[]): Int32Array[] {
  const out = Array.from({ length: size }, () => new Int32Array(size).fill(-1));
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      let m = 10000;
      for (const [px, py] of points) {
        const d = Math.hypot(px - x, py - y);
        if (d < m) m = d;
      }
      out[y]![x] = Math.trunc(m);
    }
  }
  return out;
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
  occupancy: Uint8Array,
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
  occupancy: Uint8Array;
  zoneIndex: number;
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
 * Unported, said rather than hidden: floor 1 adds a five-tile margin from
 * the map edge to every check (`0xEC365D`), and the reference has no
 * underground — that margin has never been measured.
 */
export function fits(ctx: FitContext, foot: Footprint, tile: Tile, q: number): boolean {
  const { size, grid, border, occupancy, zoneIndex } = ctx;
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
  occupancy: Uint8Array;
  /** MUTATED: the tiles marked 4 join the zone's room points. */
  points: Tile[];
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
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      occupancy[y * size + x] = value;
      if (intoPoints) points.push([x, y]);
      if (collect) active.push([x, y]);
    }
  };
  stamp(foot.blocked, 2, false, false);
  stamp(foot.active, 4, true, true);
  if (foot.marker[0] !== 0 || foot.marker[1] !== 0) stamp([foot.marker], 4, true, false);
  return active;
}
