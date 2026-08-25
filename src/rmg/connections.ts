// `ZoneConnections` — the passages between zones, and what stands on them.
//
// Read from 0xEA3930 with `0xEC1630` doing the land passages; ported here.
// Sixteen draws on the reference run, and every one is accounted for: three
// passages, each spending a tile pick and then a guard (see armies.ts).
//
// A passage is found by scanning, not by the distance table. A tile of the
// zone qualifies when it keeps 5 tiles from the map edge
// (`JunctionMinBorderDistance`), has EXACTLY ONE foreign value among its
// eight neighbours, and that value appears 3 to 5 times — a tile on a
// straight stretch of border, not at a corner and not where three zones
// meet. Unassigned tiles count as a value of their own, so a tile touching
// both a neighbour and a hole is not a candidate.
//
// The candidates are collected per neighbour in scan order (the second
// coordinate outermost, like every other scan in this port) and kept in a
// hash map, so the NEIGHBOURS are visited in bucket order — which is what
// decides the order of the draws when a zone borders several others. A
// neighbour with 7 candidates or fewer is skipped outright.
//
// Then: one draw picks the tile, the guard costs four or five more, and the
// pair is marked done from BOTH sides — the neighbour finds a tile of its own
// adjacent to the passage (four orthogonals first, then four diagonals) and
// records the passage there too, so the passage is never dug twice.
//
// Both sides also stamp distance-to-border 1 on the passage mouth and its
// orthogonal neighbours inside the zone, which is how later phases learn to
// keep the passage clear.
//
// TELEPORTS ARE NOT PORTED. When a connection finds no land passage — a
// different floor, or a border too thin — the engine's second pass plants a
// monolith or a subterranean gate pair instead. Every connection on the
// reference run got a land passage, so that path has never been measured
// against a real run; rather than invent it, this port reports the
// connections it could not dig and leaves them alone.

import { setMonster } from './armies.ts';
import type { GuardTables } from './armies.ts';
import type { RmgRandom } from './random.ts';
import type { RmgConnection, RmgTemplate } from './template.ts';
import { floorIterationOrder } from './zones.ts';

/** Tiles nearer than this to the map edge cannot carry a passage. */
export const JUNCTION_MIN_BORDER_DISTANCE = 5;
/** Fewer candidates than this and the neighbour is skipped. */
const MIN_CANDIDATES = 8;

/**
 * The engine's neighbour tables (`0x1093968`, then `0x1093988`), and the pairs
 * are MAP-coordinate offsets: the first number moves x — the SECOND grid
 * index — and the second moves y. An earlier reading applied them to
 * (row, column) instead, which adopts a different tile whenever the first
 * fitting neighbour differs between the two orders — and the adopted tile
 * seeds the room grid the mines step filters by, so the mistake surfaced as
 * two zones' first mines landing one draw away from the reference. The
 * mines-step measurements pinned it: with x-first offsets all four zones'
 * first picks land on the engine's tiles; with row-first, two do not.
 */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1],
];

export interface ConnectionZone {
  index: number;
  floor: number;
}

export interface PassageGuard {
  /** `item_<signed int32>` — the instance name the two draws minted. */
  name: string;
  /** Map coordinates, as the map file records them. */
  x: number;
  y: number;
  stacks: Array<{ creature: string; amount: number }>;
  /** 2 HOSTILE, 3 WILD — the engine's own enum values. */
  mood: number;
  between: [number, number];
}

export interface ConnectionsResult {
  guards: PassageGuard[];
  /** Per zone index, the tiles a passage opens onto. */
  passages: Map<number, Array<[number, number]>>;
  /** Connections no land passage could be dug for — teleport territory. */
  unconnected: RmgConnection[];
}

export interface ConnectionsInput {
  size: number;
  template: RmgTemplate;
  zones: ConnectionZone[];
  /** Per floor, the zone grid — as the phases before this one left it. */
  floors: Int32Array[][];
  /** Per floor, the distance-to-border table — WRITTEN to at each passage. */
  distances: Int32Array[][];
  /** `BasicLeverGuardPower` × `ConnectionGuardLevel`, from RMGParameters. */
  guardPowerUnit: number;
  /** The map's monster strength, 0..4. */
  monsterStrength: number;
  tables: GuardTables;
}

/**
 * The tiles of `zone` that face exactly one other zone, grouped by which —
 * in scan order, and returned in the engine's hash-bucket order of the
 * neighbour index.
 */
function collectCandidates(
  grid: Int32Array[],
  size: number,
  zoneIndex: number,
): Map<number, Array<[number, number]>> {
  const found = new Map<number, Array<[number, number]>>();
  const margin = JUNCTION_MIN_BORDER_DISTANCE;
  for (let b = margin; b < size - margin; b++) {
    for (let a = margin; a < size - margin; a++) {
      if (grid[a]![b] !== zoneIndex) continue;
      let only = 0;
      let times = 0;
      let mixed = false;
      for (const [da, db] of NEIGHBOURS) {
        const na = a + da;
        const nb = b + db;
        if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
        const z = grid[na]![nb]!;
        if (z === zoneIndex) continue;
        if (times === 0) { only = z; times = 1; continue; }
        if (z !== only) { mixed = true; break; }
        times++;
      }
      if (mixed || times < 3 || times > 5) continue;
      let list = found.get(only);
      if (!list) { list = []; found.set(only, list); }
      list.push([a, b]);
    }
  }
  // Bucket order, the same 13-bucket model the zones themselves iterate in.
  const ordered = new Map<number, Array<[number, number]>>();
  for (const key of floorIterationOrder([...found.keys()].map((index) => ({ index })))) {
    ordered.set(key.index, found.get(key.index)!);
  }
  return ordered;
}

/** The connection a pair of zones is named by, whichever way round it is. */
function connectionBetween(template: RmgTemplate, a: number, b: number): RmgConnection | undefined {
  return template.connections.find((c) =>
    (c.sourceZoneIndex === a && c.destZoneIndex === b) || (c.sourceZoneIndex === b && c.destZoneIndex === a));
}

export function zoneConnections(input: ConnectionsInput, rng: RmgRandom): ConnectionsResult {
  const { size, template, zones, floors, distances, guardPowerUnit, monsterStrength, tables } = input;
  const guards: PassageGuard[] = [];
  const passages = new Map<number, Array<[number, number]>>();
  const done = new Map<number, Set<number>>();
  const byIndex = new Map(zones.map((z) => [z.index, z]));

  const markDone = (a: number, b: number): void => {
    if (!done.has(a)) done.set(a, new Set());
    if (!done.has(b)) done.set(b, new Set());
    done.get(a)!.add(b);
    done.get(b)!.add(a);
  };
  const addPassage = (index: number, tile: [number, number]): void => {
    const list = passages.get(index);
    if (list) list.push(tile);
    else passages.set(index, [tile]);
  };
  /** The mouth and its own-zone orthogonal neighbours become depth 1. */
  const openMouth = (dist: Int32Array[], grid: Int32Array[], zoneIndex: number, a: number, b: number): void => {
    dist[a]![b] = 1;
    for (const [da, db] of NEIGHBOURS.slice(0, 4)) {
      const na = a + da;
      const nb = b + db;
      if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
      if (grid[na]![nb] === zoneIndex) dist[na]![nb] = 1;
    }
  };

  for (let f = 0; f < floors.length; f++) {
    const grid = floors[f]!;
    const dist = distances[f]!;
    for (const zone of floorIterationOrder(zones.filter((z) => z.floor === f))) {
      const candidates = collectCandidates(grid, size, zone.index);
      for (const [neighbour, tiles] of candidates) {
        if (done.get(zone.index)?.has(neighbour)) continue;
        if (!byIndex.has(neighbour)) continue;
        const connection = connectionBetween(template, zone.index, neighbour);
        if (!connection) continue;
        if (tiles.length < MIN_CANDIDATES) continue;

        const [ta, tb] = tiles[rng.below(tiles.length)]!;
        openMouth(dist, grid, zone.index, ta, tb);

        const guard = setMonster(guardPowerUnit * connection.guardStrenght, monsterStrength, tables, rng);
        if (guard) {
          guards.push({
            name: guard.name,
            x: tb,
            y: ta,
            stacks: guard.stacks,
            mood: guard.mood,
            between: [zone.index, neighbour],
          });
        }
        addPassage(zone.index, [ta, tb]);

        // The neighbour takes the passage from its own side: the first of
        // its tiles adjacent to the mouth, orthogonals before diagonals —
        // and the offsets are (dx, dy), so dx moves the SECOND index.
        for (const [dx, dy] of NEIGHBOURS) {
          const na = ta + dy;
          const nb = tb + dx;
          if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
          if (grid[na]![nb] !== neighbour) continue;
          openMouth(dist, grid, neighbour, na, nb);
          addPassage(neighbour, [na, nb]);
          break;
        }
        markDone(zone.index, neighbour);
      }
    }
  }

  const unconnected = template.connections.filter((c) =>
    !done.get(c.sourceZoneIndex)?.has(c.destZoneIndex));
  return { guards, passages, unconnected };
}
