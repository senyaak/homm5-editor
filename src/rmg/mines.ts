// The mines step of MainObjects — read from 0xEB5C50, held to the traced run.
//
// The step in one breath: gather the candidates once per zone, then for each
// of seven mine types in table order place `count` mines — each one costs two
// draws per attempt at a tile, two for its name, four or five for its guard,
// and one roll per pile candidate with two more for each pile that lands.
// The rules, each with its address in docs/RMG.md:
//
//   candidates  every tile of the zone with border distance ABOVE 1, scanned
//               map-x outer; a zone with a town keeps two rings around it —
//               near (Mine1Level radii) for types 0-1, far (Mine2Level) for
//               the rest, bounds strict; no town — every tile, both lists
//   room        per tile, trunc of the distance to the nearest stamped point
//   filter      room > trunc(2 * max / 5), strictly — the ONLY filter; the
//               zone, border and occupancy tests only decide the maximum
//   fit         every footprint tile in the map, in the zone, and free
//   guard       no draws to seat: first free orthogonal of the footprint's
//               last tile, starting from the quadrant's direction
//   piles       eight neighbours of the same tile, from two past the guard's
//               direction; free and within 2.0 of the GUARD earns a roll,
//               under 0.8 lands, two is the ceiling
//
// The engine computes distances in single precision and this port in double;
// every measured draw lands regardless, and if a future template diverges by
// one tile at a threshold boundary, this is the first place to look.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mintName, setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { childText, find, findAll, parse } from '../format/xml.ts';
import type { Offset } from './town-data.ts';
import { rotate } from './towns.ts';

export type Tile = readonly [number, number];

export interface MineListsInput {
  size: number;
  /** The floor's zone grid, `[a][b]` with `b` the map x. */
  grid: Int32Array[];
  /** The distance-to-border table, as the phases before this one left it. */
  border: Int32Array[];
  zoneIndex: number;
  /** Rings are measured from here — the TOWN (zone+0x0C, written by PlaceTowns). */
  town: { x: number; y: number } | null;
  nearMin: number;
  nearMax: number;
  farMin: number;
  farMax: number;
}

export interface MineLists {
  /** Types 0-1: Sawmill, Ore_Pit. */
  near: Tile[];
  /** Types 2 and up: the rarer mines, and the Gold_Mine. */
  far: Tile[];
}

/** The once-per-zone gather — 0xEB5C72..0xEB601A. */
export function mineLists(input: MineListsInput): MineLists {
  const { size, grid, border, zoneIndex, town } = input;
  const near: Tile[] = [];
  const far: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (border[y]![x]! <= 1) continue;
      if (!town) {
        // No town yet: no rings, every tile of the zone in both lists.
        near.push([x, y]);
        far.push([x, y]);
        continue;
      }
      const d = Math.hypot(town.x - x, town.y - y);
      if (input.farMax > d && d > input.farMin) far.push([x, y]);
      if (input.nearMax > d && d > input.nearMin) near.push([x, y]);
    }
  }
  return { near, far };
}

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
  /** `trunc(2 * max / 5)` — signed, so 0 when nothing qualifies. */
  threshold: number;
}

/**
 * The per-mine filter — 0xEB60B7..0xEB61C6. The zone, border and occupancy
 * tests decide what counts toward the MAXIMUM (0xEC2EB0); the survival test
 * is the room against the threshold and nothing else. The kept list is built
 * fresh from the original each time, so a candidate struck out by a failed
 * fit earlier is back for the next mine.
 */
export function filterByRoom(
  candidates: Tile[],
  room: Int32Array[],
  grid: Int32Array[],
  border: Int32Array[],
  occupancy: Uint8Array,
  size: number,
  zoneIndex: number,
): RoomFilterResult {
  let max = 0;
  for (const [x, y] of candidates) {
    if (grid[y]![x] !== zoneIndex) continue;
    if (border[y]![x]! <= 2) continue;
    if (occupancy[y * size + x] === 2) continue;
    const r = room[y]![x]!;
    if (r > max) max = r;
  }
  const threshold = Math.trunc((2 * max) / 5);
  return { kept: candidates.filter(([x, y]) => room[y]![x]! > threshold), max, threshold };
}

// ---------------------------------------------------------------------------
// The placement half: the mine, its guard, its piles, and the footprint the
// placement stamps for the next mine's room.

/**
 * The seven mine types, in the order of the engine's own string table at
 * `0x121C670` — the order IS the placement order, and the reference map's
 * mines come out in exactly this sequence. The template's per-zone counts
 * index this list; the pile column is the parallel table at `0x121C830`.
 */
export const MINE_TYPES: ReadonlyArray<{ mine: string; pile: string; guardLevel: 'mine1' | 'mine2' | 'gold' }> = [
  { mine: 'Sawmill', pile: 'Wood', guardLevel: 'mine1' },
  { mine: 'Ore_Pit', pile: 'Ore', guardLevel: 'mine1' },
  { mine: 'Alchemist_Lab', pile: 'Mercury', guardLevel: 'mine2' },
  { mine: 'Crystal_Cavern', pile: 'Crystal', guardLevel: 'mine2' },
  { mine: 'Sulfur_Dune', pile: 'Sulfur', guardLevel: 'mine2' },
  { mine: 'Gem_Pond', pile: 'Gems', guardLevel: 'mine2' },
  { mine: 'Gold_Mine', pile: 'Gold', guardLevel: 'gold' },
];

export interface MineFootprint {
  path: string;
  blocked: Offset[];
  active: Offset[];
  marker: Offset;
}

/** `/MapObjects/<name>.(AdvMapMineShared).xdb` — the lists the stamp reads. */
export function readMineShared(dataRoot: string, name: string): MineFootprint {
  const path = `/MapObjects/${name}.(AdvMapMineShared).xdb`;
  const doc = find(parse(readFileSync(join(dataRoot, path.slice(1)), 'utf8')), 'AdvMapMineShared');
  if (!doc) throw new Error(`${path}: not an AdvMapMineShared`);
  const offsets = (tag: string): Offset[] => {
    const holder = find(doc, tag);
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
const EIGHT: ReadonlyArray<Offset> = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
];
const FOUR: ReadonlyArray<Offset> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** A tile is free when nothing touched it, or only a road did. */
const isFree = (v: number): boolean => v === 0 || (v & 0x38) !== 0;

export interface PlacedMine {
  type: string;
  name: string;
  x: number;
  y: number;
  /** The quadrant drawn — the rotation is `q * PI/2`. */
  q: number;
  guard: (Guard & { x: number; y: number }) | null;
  piles: Array<{ name: string; x: number; y: number }>;
}

export interface MineStepInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the step marks 2 and 4 the way the engine does. */
  occupancy: Uint8Array;
  /** MUTATED: the zone's stamped points — what the room is measured from. */
  points: Tile[];
  zoneIndex: number;
  town: { x: number; y: number } | null;
  /** The template's seven counts for this zone. */
  counts: number[];
  radii: { nearMin: number; nearMax: number; farMin: number; farMax: number };
  guardPower: { basic: number; mine1: number; mine2: number; gold: number };
  monsterStrength: number;
  tables: GuardTables;
  footprints: Map<string, MineFootprint>;
}

/**
 * Whether the mine fits at `tile` rotated by `q` — the port of `0xEC3510`,
 * which spends no draws. Three loops, read out of the function itself:
 *
 * - blocked tiles and the marker: in the map, in this zone, occupancy
 *   EXACTLY 0 — a road blocks a mine even though it counts as free
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
function fits(input: MineStepInput, foot: MineFootprint, tile: Tile, q: number): boolean {
  const { size, grid, border, occupancy, zoneIndex } = input;
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

/** One zone's mines — the per-instance loop of `0xEB5C50`, draws and all. */
export function placeZoneMines(input: MineStepInput, rng: DrawSource): PlacedMine[] {
  const { size, grid, border, occupancy, points, zoneIndex } = input;
  const lists = mineLists({
    size, grid, border, zoneIndex, town: input.town,
    nearMin: input.radii.nearMin, nearMax: input.radii.nearMax,
    farMin: input.radii.farMin, farMax: input.radii.farMax,
  });
  const placed: PlacedMine[] = [];

  for (let type = 0; type < MINE_TYPES.length; type++) {
    const count = input.counts[type] ?? 0;
    const spec = MINE_TYPES[type]!;
    const list = type <= 1 ? lists.near : lists.far;

    for (let instance = 0; instance < count; instance++) {
      const foot = input.footprints.get(spec.mine)!;
      const room = roomGrid(size, grid, zoneIndex, points);
      const { kept } = filterByRoom(list, room, grid, border, occupancy, size, zoneIndex);

      // Two draws per attempt; a failed fit strikes the candidate and draws
      // again. An empty list is the engine's "cant place mine" line — the
      // instance is skipped and nothing more is drawn for it.
      let tile: Tile | null = null;
      let q = 0;
      const pool = [...kept];
      while (pool.length) {
        const pick = rng.below(pool.length);
        q = rng.below(4);
        const candidate = pool[pick]!;
        if (fits(input, foot, candidate, q)) {
          tile = candidate;
          break;
        }
        pool.splice(pick, 1);
      }
      if (!tile) continue;
      const at = tile;

      // The mine: two draws for its name, then the stamp — blocked tiles
      // mark 2; active tiles and the marker mark 4 and join the room points.
      // The active tiles also form the footprint vector (`zone+0x11C`) whose
      // LAST entry seats the guard and the piles; the marker stays out of it,
      // and a (0,0) marker is skipped whole — pass 3's rule.
      const name = mintName(rng);
      const footprintTiles: Tile[] = [];
      const stamp = (offs: readonly Offset[], value: number, intoPoints: boolean, collect: boolean): void => {
        for (const off of offs) {
          const [dx, dy] = rotate(q, off);
          const x = at[0] + dx;
          const y = at[1] + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          occupancy[y * size + x] = value;
          if (intoPoints) points.push([x, y]);
          if (collect) footprintTiles.push([x, y]);
        }
      };
      stamp(foot.blocked, 2, false, false);
      stamp(foot.active, 4, true, true);
      if (foot.marker[0] !== 0 || foot.marker[1] !== 0) stamp([foot.marker], 4, true, false);

      // The guard costs no draws to seat: from the quadrant's direction, the
      // first free orthogonal of the footprint's last tile. None free means
      // no guard, and SetMonster is never called at all.
      const base = footprintTiles[footprintTiles.length - 1] ?? at;
      const start = Math.trunc(((q * Math.PI) / 2) * (4 / Math.PI) + 0.5);
      let guardAt: Tile | null = null;
      for (let j = 0; j < 4; j++) {
        const [dx, dy] = FOUR[(start + j) & 3]!;
        const x = base[0] + dx;
        const y = base[1] + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        if (isFree(occupancy[y * size + x]!)) {
          guardAt = [x, y];
          break;
        }
      }

      let guard: PlacedMine['guard'] = null;
      if (guardAt) {
        const level =
          spec.guardLevel === 'mine1' ? input.guardPower.mine1
          : spec.guardLevel === 'mine2' ? input.guardPower.mine2
          : input.guardPower.gold;
        const made = setMonster(input.guardPower.basic * level, input.monsterStrength, input.tables, rng);
        if (made) guard = { ...made, x: guardAt[0], y: guardAt[1] };
        occupancy[guardAt[1] * size + guardAt[0]] = 4;
      }

      // The piles: eight neighbours of the same base tile, starting two past
      // the guard's direction. The order is the engine's own — free first,
      // then within 2.0 of the GUARD, and only then the roll — so a candidate
      // failing either test spends nothing. Under 0.8 lands; two is the
      // ceiling, counted after a successful creation.
      //
      // With NO guard the engine still runs this block, and its distance test
      // reads a guard position nothing initialised (`0xEB64EB` jumps past the
      // only writes to that slot). That is stale stack, not a rule; the
      // reference run never reaches it, and this port skips the piles instead
      // — said here so the divergence is findable if a template hits it.
      const piles: PlacedMine['piles'] = [];
      if (guardAt) {
        const g = guardAt;
        for (let e = start + 2; e <= start + 9 && piles.length < 2; e++) {
          const [dx, dy] = EIGHT[e & 7]!;
          const x = base[0] + dx;
          const y = base[1] + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          if (!isFree(occupancy[y * size + x]!)) continue;
          if (Math.hypot(x - g[0], y - g[1]) >= 2.0) continue;
          const roll = rng.betweenFloat(0, 1);
          if (roll >= Math.fround(0.8)) continue;
          piles.push({ name: mintName(rng), x, y });
          occupancy[y * size + x] = 2;
        }
      }

      placed.push({ type: spec.mine, name, x: at[0], y: at[1], q, guard, piles });
    }
  }
  return placed;
}
