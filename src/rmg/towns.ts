// `PlaceTowns` — the zones that carry a town get one, and the ones that do
// not get their centre computed instead.
//
// Read from 0xEA5B70 (the phase) and 0xEB4CB0 (`CGameZone::PlaceTown`, its
// vt+0x20). The reading was reconciled against the reference run draw for
// draw: 16 draws, and every value they produced — both rotations, both
// instance ids, the decoration's pick/rotation/id, and both specialisations —
// matches the map the engine wrote.
//
// The phase walks the TEMPLATE's zones in FILE order (not the hash order the
// zone phases use), looks each one up by index, and either places a town or
// stores the zone's centroid. Placing one is a retry loop:
//
//   tile = pool[below(pool.length)]      pool = the zone's tiles, in the
//   q    = below(4)                      order FillZones collected them,
//                                        keeping only depth > R/2
//   then three gates, none of which draws:
//     * the town's own tile must sit inside the 1 .. size-1 frame
//     * the ENTRANCE — tile + rot_q(1,-1) — must be at least (2*R)/3 deep
//     * the footprint, rotated with it, must stay inside the zone, on free
//       tiles, none of them right against the zone border
//
// A frame or depth refusal keeps the tile in the pool (it can be drawn
// again); a footprint refusal drops it. Past a hundred retries the depth gate
// is skipped, which is the engine's way of eventually placing SOMETHING.
//
// THREE POINTS, and telling them apart is the whole difficulty of this phase:
//
//   tile — the drawn one. The town's Pos, the footprint's anchor, and what
//          gets reserved. The reference proves it: both towns stand exactly
//          on their drawn tiles, under two different rotations.
//   MARK — tile + rot_q(PossessionMarkerTile), where the flag would stand.
//          The FRAME and DEPTH gates read this, and it is also the point the
//          next phase grows its distance-to-town wave from. Without it the
//          reading cannot be squared with the reference: zone 1's town sits
//          on a depth-9 tile with the gate at 10, and only its marker (11
//          deep) passes; zone 2's refused attempt sat on depth 9 with a
//          marker 8 deep.
//   entry — tile + rot_q(1,-1), a literal in the code. Only the decoration
//          uses it.
//
// OPEN, and named rather than hidden: MARK is read out of the document at an
// offset the disassembly reached but has not yet named (the field could be
// PossessionMarkerTile or another one-element list). The two candidates agree
// for Inferno — whose marker IS (1,-1) — and the reference happens not to
// separate them for Academy either, so this port follows the disassembly's
// "from the document" and takes the marker.

import type { RmgRandom } from './random.ts';
import type { RacePreset } from './preset-table.ts';
import type { Offset, TownShared, TownSpecialization } from './town-data.ts';
import type { LoadedZone } from './load-template.ts';
import type { RmgTemplate } from './template.ts';

/**
 * COORDINATES. Inside the port a grid is `grid[a][b]`, and the map file's
 * x is `b`, its y is `a` — pinned twice over: the terrain plane matched the
 * engine's bytes with `plane[a*(size+1)+b]`, and the towns below land on
 * their drawn tiles only under this reading. Offsets in the game's documents
 * are in the FILE's axes, so rotating one gives (dx, dy) = (db, da).
 */
export interface MapPos {
  x: number;
  y: number;
}

const toMapPos = (a: number, b: number): MapPos => ({ x: b, y: a });

/** A quarter-turn of a document offset, the engine's own four cases. */
export function rotate(q: number, off: Offset): Offset {
  const [x, y] = off;
  if (q === 1) return [-y, x];
  if (q === 2) return [-x, -y];
  if (q === 3) return [y, -x];
  return [x, y];
}

export interface PlacedObject {
  kind: 'town' | 'decoration';
  /** `item_<signed int32>` — the name the engine mints from two draws. */
  name: string;
  pos: MapPos;
  /** Radians: q * pi/2, as the map file records it. */
  rot: number;
  /** The prototype href path this instance is an instance of. */
  shared: string;
  /** Towns only: 1-based player, 0 for a neutral one. */
  playerId?: number;
  /** Towns only: the drawn specialisation's path. */
  specialization?: string;
  /** Towns only: a player's town also gets a tavern (the engine's rule). */
  hasTavern?: boolean;
}

export interface TownsResult {
  objects: PlacedObject[];
  /**
   * Per zone index, the point FillDistToTownsTable will grow its wave from:
   * a town's position, or the zone's centroid when it has no town.
   */
  centres: Map<number, { a: number; b: number }>;
  /** Per floor: 0 free, 2 under a building's blocked tiles, 4 under the rest. */
  occupancy: Uint8Array[];
}

export interface TownsInput {
  size: number;
  template: RmgTemplate;
  zones: LoadedZone[];
  /** Per floor, the zone grid as FillZones left it. */
  floors: Int32Array[][];
  /** Per floor, the distance-to-border table. */
  distances: Int32Array[][];
  /** Per zone index, its radius R from GenerateGameZones. */
  radii: Map<number, number>;
  presets: Map<number, RacePreset>;
  /** Resolved `AdvMapTownShared` documents, by href path. */
  towns: Map<string, TownShared>;
  /** `RMG/TownRandomSpecGroup.xdb`, in file order. */
  specializations: TownSpecialization[];
}

const HALF_PI = Math.PI / 2;

/**
 * The zone's tiles in the order the engine collected them — the same scan
 * nesting FillZones uses, the second coordinate outermost. Every later phase
 * that indexes "the zone's tiles" indexes THIS list.
 */
export function collectZoneTiles(grid: Int32Array[], size: number, zoneIndex: number): Array<[number, number]> {
  const tiles: Array<[number, number]> = [];
  for (let b = 0; b < size; b++) {
    for (let a = 0; a < size; a++) if (grid[a]![b] === zoneIndex) tiles.push([a, b]);
  }
  return tiles;
}

/** `item_<signed int32>`, minted from two draws of below(65535). */
function mintName(rng: RmgRandom): string {
  const hi = rng.below(65535);
  const lo = rng.below(65535);
  return `item_${(hi * 65536 + lo) | 0}`;
}

/** Single-precision mean of a tile list — the centre of a townless zone. */
function centroid(tiles: Array<[number, number]>): { a: number; b: number } {
  const fl = Math.fround;
  let sa = 0;
  let sb = 0;
  for (const [a, b] of tiles) {
    sa = fl(sa + fl(a));
    sb = fl(sb + fl(b));
  }
  const n = fl(tiles.length);
  return { a: fl(sa / n), b: fl(sb / n) };
}

export function placeTowns(input: TownsInput, rng: RmgRandom): TownsResult {
  const { size, template, zones, floors, distances, radii, presets, towns, specializations } = input;
  const objects: PlacedObject[] = [];
  const centres = new Map<number, { a: number; b: number }>();
  const occupancy = floors.map(() => new Uint8Array(size * size));
  const byIndex = new Map(zones.map((z) => [z.index, z]));

  for (const item of template.zones) {
    const zone = byIndex.get(item.index);
    if (!zone) continue;
    const grid = floors[zone.floor]!;
    const tiles = collectZoneTiles(grid, size, zone.index);

    if (!item.town) {
      if (tiles.length) centres.set(zone.index, centroid(tiles));
      continue;
    }

    const preset = presets.get(zone.race);
    const proto = preset?.townProto ? towns.get(preset.townProto.replace(/#xpointer\(.*\)$/, '')) : undefined;
    if (!proto) continue; // no prototype, no town — the engine bails the same way

    const dist = distances[zone.floor]!;
    const occ = occupancy[zone.floor]!;
    const r = radii.get(zone.index) ?? 0;
    const pool = tiles.filter(([a, b]) => dist[a]![b]! > Math.trunc(r / 2));
    const depthGate = Math.trunc((2 * r) / 3);
    const footprint: Offset[] = [[0, 0], ...proto.blockedTiles, ...proto.holeTiles, ...proto.activeTiles];

    let retries = 0;
    while (pool.length) {
      const pick = rng.below(pool.length);
      const [ta, tb] = pool[pick]!;
      const q = rng.below(4);
      // MARK: what the frame and depth gates measure, and the zone's centre.
      const [mx, my] = rotate(q, proto.possessionMarker);
      const ma = ta + my;
      const mb = tb + mx;
      // The decoration's point, from the code's own literal.
      const [ex, ey] = rotate(q, [1, -1]);
      const ea = ta + ey;
      const eb = tb + ex;

      const inFrame = mb >= 1 && mb < size - 1 && ma >= 1 && ma < size - 1;
      const deepEnough = retries >= 100
        || (inFrame && dist[ma]![mb]! >= depthGate);
      if (!inFrame || !deepEnough) { retries++; continue; } // the tile stays in the pool

      let fits = true;
      for (const off of footprint) {
        const [dx, dy] = rotate(q, off);
        const fa = ta + dy;
        const fb = tb + dx;
        if (fa < 0 || fa >= size || fb < 0 || fb >= size
          || grid[fa]![fb] !== zone.index || occ[fa * size + fb] !== 0 || dist[fa]![fb]! < 1) {
          fits = false;
          break;
        }
      }
      if (!fits) { pool.splice(pick, 1); retries++; continue; } // this tile is done for

      const rot = q * HALF_PI;
      const name = mintName(rng);
      // Reserve: the blocked list marks 2, everything else 4 — the engine's
      // own two values, kept because later phases read them back.
      const mark = (offs: Offset[], value: number): void => {
        for (const off of offs) {
          const [dx, dy] = rotate(q, off);
          const fa = ta + dy;
          const fb = tb + dx;
          if (fa >= 0 && fa < size && fb >= 0 && fb < size) occ[fa * size + fb] = value;
        }
      };
      mark([[0, 0], ...proto.blockedTiles], 2);
      mark([...proto.holeTiles, ...proto.activeTiles], 4);

      const specs = specializations.filter((s) => s.townType === proto.townType && s.randomTown === 'TOWN_RANDOM');
      objects.push({
        kind: 'town',
        name,
        pos: toMapPos(ta, tb),
        rot,
        shared: proto.path,
        playerId: zone.playerNo,
        hasTavern: zone.playerNo !== 0,
      });
      const town = objects[objects.length - 1]!;
      // The wave the next phase runs starts at the MARK, not at the town.
      centres.set(zone.index, { a: ma, b: mb });

      // The decoration over the entrance — skipped WHOLE, draws included,
      // when the race lists none.
      const decorations = preset?.overTownCenterObjects ?? [];
      if (decorations.length) {
        const dq = rng.below(4);
        const dpick = rng.below(decorations.length);
        const dname = mintName(rng);
        objects.push({
          kind: 'decoration',
          name: dname,
          pos: toMapPos(ea, eb),
          rot: dq * HALF_PI,
          shared: decorations[dpick]!.replace(/#xpointer\(.*\)$/, ''),
        });
      }

      // The specialisation comes last, and only if the pool has one.
      if (specs.length) town.specialization = specs[rng.below(specs.length)]!.path;
      break;
    }
  }

  return { objects, centres, occupancy };
}
