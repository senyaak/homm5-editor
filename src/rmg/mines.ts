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
// The room, filter, fit and stamp are the machinery every placement worker
// shares — src/rmg/placement.ts; this file keeps what is the mines' own.
//
// The engine computes distances in single precision and this port in double;
// every measured draw lands regardless, and if a future template diverges by
// one tile at a threshold boundary, this is the first place to look.

import { mintName, setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { EIGHT, FOUR, ensureRoom, filterByRoom, isFree, readFootprint, stampFootprint, tryPlace } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

export type { Tile } from './placement.ts';

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

/** The mines' threshold — `trunc(2 * max / 5)` at 0xEB60BA. */
const MINE_ROOM_DIVISOR = 5;

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

export type MineFootprint = Footprint;

/** `/MapObjects/<name>.(AdvMapMineShared).xdb` — the lists the stamp reads. */
export function readMineShared(dataRoot: string, name: string): MineFootprint {
  return readFootprint(dataRoot, `/MapObjects/${name}.(AdvMapMineShared).xdb`);
}

export interface PlacedMine {
  type: string;
  name: string;
  x: number;
  y: number;
  /** The quadrant drawn — the rotation is `q * PI/2`. */
  q: number;
  guard: (Guard & { x: number; y: number }) | null;
  piles: Array<{ name: string; x: number; y: number }>;
  /**
   * The stamp's active tiles in stamp order — what the engine pushes into
   * `zone+0x11C`, the list the roads phase later wires with 0x10 roads.
   */
  actives: Tile[];
}

export interface MineStepInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the step marks 2 and 4 the way the engine does. */
  occupancy: Uint8Array;
  /** MUTATED: the zone's stamped points — what the room is measured from. */
  points: Tile[];
  /** MUTATED when carried: stamped-blocked tiles join the zone's `+0x5C` ledger. */
  blocked?: Tile[];
  zoneIndex: number;
  /** The zone's floor — floor 1 adds the fit's five-tile margin. */
  floor?: number;
  /** The level's persistent room grid, recomputed in place when carried. */
  room?: Int32Array[];
  town: { x: number; y: number } | null;
  /** The template's seven counts for this zone. */
  counts: number[];
  radii: { nearMin: number; nearMax: number; farMin: number; farMax: number };
  guardPower: { basic: number; mine1: number; mine2: number; gold: number };
  monsterStrength: number;
  tables: GuardTables;
  footprints: Map<string, MineFootprint>;
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
      const room = ensureRoom(input.room, size, grid, zoneIndex, points);
      const { kept } = filterByRoom(list, room, grid, border, occupancy, size, zoneIndex, MINE_ROOM_DIVISOR);

      // Two draws per attempt; an empty list is the engine's "cant place
      // mine" line — the instance is skipped and nothing more is drawn for it.
      const found = tryPlace(input, foot, kept, rng);
      if (!found) continue;
      const { tile: at, q } = found;

      // The mine: two draws for its name, then the stamp; the stamp's active
      // tiles form the footprint vector (`zone+0x11C`) whose LAST entry seats
      // the guard and the piles.
      const name = mintName(rng);
      const footprintTiles = stampFootprint(input, foot, at, q);

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

      placed.push({ type: spec.mine, name, x: at[0], y: at[1], q, guard, piles, actives: footprintTiles });
    }
  }
  return placed;
}

export interface AbandonedMinesInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4. */
  occupancy: Uint8Array;
  /** MUTATED: the stamp's 4s join the zone's room points. */
  points: Tile[];
  /** MUTATED when carried: stamped-blocked tiles join the zone's `+0x5C` ledger. */
  blocked?: Tile[];
  zoneIndex: number;
  /** The zone's floor — floor 1 adds the fit's five-tile margin. */
  floor?: number;
  /** The level's persistent room grid, recomputed per instance. */
  room?: Int32Array[];
  /** The template zone's AbandonedMines (`zoneRec+0x2C`). */
  count: number;
  /** The TOWN (zone+0x0C) under the town flag — the ring's centre. */
  town: { x: number; y: number } | null;
  /** `Mine3LevelMinRadius` / `Mine3LevelMaxRadius` — 25 and 45 shipped. */
  ringMin: number;
  ringMax: number;
  /** The preset's AbandonedMine footprint. */
  foot: Footprint;
}

export interface PlacedAbandonedMine {
  name: string;
  x: number;
  y: number;
  q: number;
  /** The stamp's active tiles — they join `zone+0x11C` with the mines'. */
  actives: Tile[];
}

/**
 * The abandoned mines — `0xEBD700`, its own worker called right AFTER the
 * ordinary mines of the same step, with the zone record's AbandonedMines
 * for a count. The candidates are gathered once: the zone's tiles inside
 * the map frame at border > 1, and — only under the town flag — inside the
 * ring `Mine3LevelMinRadius < d < Mine3LevelMaxRadius`, both ends strict.
 * Each instance recomputes room (mask 4), takes the maximum over the
 * GATHERED list and keeps room strictly above `trunc(4*max/5)` — the 4/5
 * that separates this pool from every divisor-3 cousin. Two draws a try, a
 * fit refusal strikes the candidate, an exhausted pool logs and moves to
 * the NEXT instance rather than abandoning the step. No guard, no piles;
 * the object takes AvailableResources = [0,0,1,1,1,1,1] drawlessly and its
 * stamp's actives join the mine-actives vector the roads phase wires.
 */
export function placeZoneAbandonedMines(input: AbandonedMinesInput, rng: DrawSource): PlacedAbandonedMine[] {
  const { size, grid, border, occupancy, zoneIndex, foot } = input;
  const placed: PlacedAbandonedMine[] = [];

  // The gather runs even at count 0 — it just costs nothing.
  const cand: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (x < 1 || x >= size - 1 || y < 1 || y >= size - 1) continue;
      if (border[y]![x]! <= 1) continue;
      if (input.town) {
        const d = Math.hypot(input.town.x - x, input.town.y - y);
        if (!(d < input.ringMax) || !(d > input.ringMin)) continue;
      }
      cand.push([x, y]);
    }
  }
  if (input.count <= 0) return placed;

  for (let i = 0; i < input.count; i++) {
    const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
    // The maximum over the GATHERED list, with 0xEC2EB0's own gates.
    let max = 0;
    for (const [x, y] of cand) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (border[y]![x]! <= 2) continue;
      if (occupancy[y * size + x] === 2) continue;
      const r = room[y]![x]!;
      if (r > max) max = r;
    }
    const threshold = Math.trunc((4 * max) / 5);
    const pool = cand.filter(([x, y]) => room[y]![x]! > threshold);

    const found = tryPlace(input, foot, pool, rng);
    if (!found) continue; // "Can't place aban mine" — the next instance still tries
    const { tile, q } = found;

    const name = mintName(rng);
    const actives = stampFootprint(input, foot, tile, q);
    placed.push({ name, x: tile[0], y: tile[1], q, actives });
  }
  return placed;
}
