// `FillTerrain` — the ground gets its look: texture masks, and nothing else.
//
// Read from 0xED0AD0 (`CTerrainProcessor::Process`, thiscall on map+0x60)
// plus the dwarven-only pre-step 0xED17F0; the reading was cross-checked
// against the reference GroundTerrain.bin down to individual vertices,
// weight-stealing arithmetic included. The phase paints ONLY the texture
// layers — heights, ground flags and passability are somebody else's,
// later. Process draws nothing; the pre-step draws exactly one below(8),
// and only for a dwarven underground (dwarvenCoarse below).
//
// Per VERTEX of the (W+1)x(H+1) plane — outer loop the second coordinate,
// inner the first, floors in order:
//
//   * the vertex takes the zone of its clamped tile, and the zone's ground
//     tile is picked by THE CONSTRUCTOR'S ROLL (zone+0x13C — the draw whose
//     reader was unknown until this phase): odd roll, or an empty pool,
//     takes the preset's DefaultTile; even takes OtherTiles[roll % n].
//     Painted at weight 255. A vertex whose zone cannot be found is skipped
//     — the engine logs "no zone found" and moves on;
//   * floor 0 only, and only for vertices with both coordinates in
//     [1, size-2]: the first DIAGONAL neighbour of another zone decides —
//     another RACE paints the transitive tile at 128 (Haven and Preserve
//     count as one race); then the first ORTHOGONAL foreign-race neighbour
//     paints it again at 255. `TransitiveTileIntensity` is never read — the
//     weights are the literals 128 and 255, proven by the reference masks.
//
// PaintTile (0xEB1590) is where layers live: identity is the tile's href
// path, insertion keeps the list ordered by ascending Priority (a new layer
// goes BEFORE its equals), and adding weight STEALS from same-class layers
// of other priorities — base is the maximum same-class mask at priority >=
// ours, and past 255 every other same-class layer loses twice the overflow.
// The reference map shows both behaviours in the data: 244 vertices where
// the 128-then-255 sequence zeroed the zone tile, 26 where a bare 255 left
// it standing.

import type { RmgRandom } from './random.ts';
import type { RacePreset, TerrainTileInfo } from './preset-table.ts';

export interface TerrainZone {
  index: number;
  floor: number;
  race: number;
  terrainRace: number;
  ctorRoll: number;
}

export interface TerrainLayer {
  /** The tile's href path — the identity GroundTerrain.bin stores. */
  path: string;
  priority: number;
  type: string;
  /** (size+1)^2 vertex weights, laid out plane[outer * (size+1) + inner]. */
  mask: Uint8Array;
}

/** The engine's tile classes (0x9EC370): land, road, sea, river. */
function tileClass(type: string): number {
  if (type === 'TT_DIRT_ROAD' || type === 'TT_GRAVEL_ROAD' || type === 'TT_COBBLESTONE_ROAD') return 1;
  if (type === 'TT_BIG_WATER') return 3;
  if (type === 'TT_SMALL_WATER') return 4;
  return 0;
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function paint(layers: TerrainLayer[], tile: TerrainTileInfo | null, o: number, i: number, weight: number, v: number): void {
  if (!tile) return;
  let layer = layers.find((l) => l.path === tile.path);
  if (!layer) {
    // CanAdd: a DIFFERENT tile of the same class at the same priority refuses
    // the whole write — except that TT_DIRT layers sit out the check.
    const conflict = layers.some((l) =>
      l.type !== 'TT_DIRT' && tileClass(l.type) === tileClass(tile.type) && l.priority === tile.priority);
    if (conflict) return;
    layer = { path: tile.path, priority: tile.priority, type: tile.type, mask: new Uint8Array(v * v) };
    let at = layers.findIndex((l) => l.priority >= tile.priority);
    if (at === -1) at = layers.length;
    layers.splice(at, 0, layer);
  }
  const idx = o * v + i;
  if (weight > 0) {
    let base = 0;
    for (const m of layers) {
      if (tileClass(m.type) === tileClass(tile.type) && m.priority >= tile.priority) {
        if (m.mask[idx]! > base) base = m.mask[idx]!;
      }
    }
    let total = base + weight;
    if (total > 255) {
      const steal = 2 * (total - 255);
      for (const m of layers) {
        if (tileClass(m.type) === tileClass(tile.type) && m.priority !== tile.priority) {
          m.mask[idx] = clamp(m.mask[idx]! - steal);
        }
      }
      total = 255;
    }
    layer.mask[idx] = clamp(total);
  } else {
    layer.mask[idx] = clamp(layer.mask[idx]! + weight);
  }
}

export interface RoadPaintZone {
  zoneIndex: number;
  /** The race whose preset names the road tiles — the zone's terrain race. */
  roadTile: TerrainTileInfo | null;
  secondaryRoadTile: TerrainTileInfo | null;
}

/**
 * The road painter — `0xECE3E0`, thiscall on the same CTerrainProcessor
 * that ran FillTerrain. GenerateMap calls it at 0xEAC1FE, AFTER "treasure
 * blocks set" and just before "finished creating map" — late, but nothing
 * between the roads phase and it touches the road bits (the statics fit
 * refuses occupied tiles, roads included), so replaying it right after the
 * roads phase paints the same masks.
 *
 * ONE scan of the occupancy grid — outer loop the SECOND port index, inner
 * the first (0xECE632/0xECE622; the reverse of FillTerrain's vertex walk)
 * — and the occupancy decides, not the road lists: a network's seed tile
 * sits in the list but never gets its bit, and its corners stay unpainted.
 * `test al, 18h`: only 0x08 and 0x10 paint, the zone road's 0x20 not at
 * all. A tile with 0x08 takes the tile-zone's RoadTile (preset +0x4C),
 * else the SecondaryRoadTile (+0x58) — the zone is the TILE's, so a shared
 * corner vertex gets both zones' tiles in scan order, which is what leaves
 * 34:63 holding SandRoad AND LavaRoad (the earlier, lower-priority paint
 * builds no base for the later one to overflow) while 51:50 and 52:50 lose
 * their LavaRoad to a SandRoad that scanned later. Four corner vertices at
 * the literal 255 — the `*Strenght` fields are never read — through the
 * same PaintTile as everything else, which is also Dead_Land's whole
 * mechanism: it shares Lava's class, so its 255 overflows the base and
 * strips Lava's 175 vertices. No draws.
 */
export function paintRoads(
  layers: TerrainLayer[],
  size: number,
  grid: Int32Array[],
  occupancy: Uint8Array,
  zones: RoadPaintZone[],
): void {
  const v = size + 1;
  const byIndex = new Map(zones.map((z) => [z.zoneIndex, z]));
  for (let b = 0; b < size; b++) {
    for (let a = 0; a < size; a++) {
      const occ = occupancy[a * size + b]!;
      if ((occ & 0x18) === 0) continue;
      const zone = byIndex.get(grid[a]![b]!);
      if (!zone) continue; // GetZone came back empty — skipped without a log
      const tile = occ & 0x08 ? zone.roadTile : zone.secondaryRoadTile;
      if (!tile) continue;
      for (const da of [0, 1]) {
        for (const db of [0, 1]) paint(layers, tile, a + da, b + db, 255, v);
      }
    }
  }
}

/** Haven and Preserve share a border-free peace (0xED0E1E). */
const sameRace = (a: number, b: number): boolean =>
  a === b || (a === 3 && b === 4) || (a === 4 && b === 3);

/** Diagonals first (0x1093ABC), then orthogonals (0x1093A9C) — (d_inner, d_outer). */
const DIAG: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
const ORTHO: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * The dwarven pre-step's only observable outside the coarse grid: one draw,
 * 8 + below(8) — the underground's single random "variant". Call it before
 * fillTerrain when the map is a two-floor dwarven one, the way GenerateMap
 * calls 0xED17F0 before Process.
 */
export function dwarvenCoarse(rng: RmgRandom): number {
  return 8 + rng.below(8);
}

/**
 * @param floors zone grids exactly as fillZones left them, grid[a][b]
 * @param presets each race's preset (readPresets)
 * @param transitiveTile RMGParameters.DefaultTransitiveTile, resolved
 * @returns per floor, the texture layers in the order the file will hold them
 */
export function fillTerrain(
  width: number,
  height: number,
  zones: TerrainZone[],
  floors: Int32Array[][],
  presets: Map<number, RacePreset>,
  transitiveTile: TerrainTileInfo | null,
): TerrainLayer[][] {
  if (width !== height) throw new Error('fillTerrain: the engine is only ever run square — rectangle semantics unread');
  const size = width;
  const v = size + 1;

  // GetZone order: floor 0 answers before floor 1 for a duplicated index.
  const byIndex = new Map<number, TerrainZone>();
  for (let f = 0; f < floors.length; f++) {
    for (const z of zones) if (z.floor === f && !byIndex.has(z.index)) byIndex.set(z.index, z);
  }

  return floors.map((grid, f) => {
    const layers: TerrainLayer[] = [];
    // Vertex (va, vb) in OUR grid's coordinates: its zone is the clamped
    // tile's, and the plane is laid out plane[va*(size+1)+vb] — pinned by
    // probing the reference file at the four corners and the zone starts.
    for (let va = 0; va <= size; va++) {
      for (let vb = 0; vb <= size; vb++) {
        const zi = grid[Math.min(va, size - 1)]![Math.min(vb, size - 1)]!;
        const zone = byIndex.get(zi);
        if (!zone) continue; // "no zone found with index %d"

        const preset = presets.get(zone.terrainRace);
        let tile: TerrainTileInfo | null = null;
        if (preset) {
          const pool = preset.otherTiles;
          const useDefault = pool.length === 0 || (zone.ctorRoll & 1) !== 0;
          tile = useDefault ? preset.defaultTile : pool[zone.ctorRoll % pool.length]!;
        }
        paint(layers, tile, va, vb, 255, v);

        if (f !== 0) continue; // no borders underground

        // Diagonals: the first foreign-zone neighbour settles this ring.
        for (const [d1, d2] of DIAG) {
          const a2 = va + d2;
          const b2 = vb + d1;
          if (a2 < 1 || a2 > size - 2 || b2 < 1 || b2 > size - 2) continue;
          const zn = grid[a2]![b2]!;
          if (zn === zi) continue;
          const nz = byIndex.get(zn);
          if (!nz) continue;
          if (sameRace(zone.race, nz.race)) break;
          if (!transitiveTile) continue;
          paint(layers, transitiveTile, va, vb, 128, v);
          break;
        }
        // The orthogonal scan runs whether or not a diagonal decided.
        for (const [d1, d2] of ORTHO) {
          const a2 = va + d2;
          const b2 = vb + d1;
          if (a2 < 1 || a2 > size - 2 || b2 < 1 || b2 > size - 2) continue;
          const zn = grid[a2]![b2]!;
          if (zn === zi) continue;
          const nz = byIndex.get(zn);
          if (!nz) continue;
          if (sameRace(zone.race, nz.race)) break;
          if (!transitiveTile) continue;
          paint(layers, transitiveTile, va, vb, 255, v);
          break;
        }
      }
    }
    return layers;
  });
}
