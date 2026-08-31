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
import type { Tile } from './placement.ts';
import type { WaterMark } from './water-border.ts';

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

/**
 * The carve's own terrain writes — the 200-marks of `0xECB7D0`, replayed in
 * the order carveWaterBorder recorded them. Per marked tile, four corner
 * vertices at the LITERAL 200 (0xECB9AE ff. — TransitiveTileIntensity is
 * never read here either): band 'sea' paints the params' DeepWaterBottom
 * (the engine re-resolves the shared ref per tile — same document), band
 * 'coast' the preset's WaterCoastTile with DeepWaterBottom as the
 * empty-ref fallback (0xECBB79; the shipped table has one empty entry, so
 * the branch is live). The corner order is the engine's — the second map
 * coordinate steps first — though four distinct vertices can't show it.
 *
 * The paint arithmetic is what turns 200 into the reference's bytes: the
 * bottom tile's class-0 base includes the zone tile's own 255 (priority
 * 20 <= everything), so one 200 lands as 255 and steals 400 from every
 * other land layer — River-bed is {0,255} and DarkGround dies; the coast
 * tile's higher priority (Dead_Land 60) usually finds base 0 and keeps
 * the bare 200.
 */
export function paintWaterMarks(
  layers: TerrainLayer[],
  marks: WaterMark[],
  coastTile: TerrainTileInfo | null,
  deepWaterBottom: TerrainTileInfo | null,
  size: number,
): void {
  const v = size + 1;
  for (const m of marks) {
    const tile = m.band === 'sea' ? deepWaterBottom : coastTile ?? deepWaterBottom;
    paint(layers, tile, m.y, m.x, 200, v);
    paint(layers, tile, m.y + 1, m.x, 200, v);
    paint(layers, tile, m.y, m.x + 1, 200, v);
    paint(layers, tile, m.y + 1, m.x + 1, 200, v);
  }
}

/**
 * The half-tile river plane, laid out the way GroundTerrain.bin stores it —
 * data[(2y+j)*w + (2x+i)], w = 2*(size+1)-1, y-major like every other
 * plane. (The engine's in-memory rows (floor+0x48) came out TRANSPOSED
 * against the file in the byte comparison; the kernels and the stamp are
 * swap-symmetric and the cell visit order transposes with them, so the
 * port holds the plane in file orientation outright.)
 */
export interface RiverPlane {
  w: number;
  data: Uint8Array;
}

export function makeRiverPlane(size: number): RiverPlane {
  const w = 2 * (size + 1) - 1;
  return { w, data: new Uint8Array(w * w) };
}

/**
 * `0xECF080` — the terrain processor's sea half, called once per zone from
 * the carve's tail (0xECBD2A) with that zone's sea vector, before the
 * +0xCC rebuild. Two stages, drawless:
 *
 * Per sea tile in vector order: the DeepWaterTile (params +0x150) at the
 * four corners, the literal 200 again — interior vertices reach 255 on
 * their second paint (base 200 + 200), the one-vertex ring around the
 * deep sea keeps 200; then the river-plane stamp: the 4x4 half-tile block
 * at (2x, 2y) takes v = 7 - border[y][x] (the ADJUSTED border, so a sea
 * tile always lands the > 5 branch = 255; the v*80 ladder below it is
 * dead code on this path), each cell guarded against the plane's dims.
 *
 * Then the blur: k = 0..2*count-1 walks the vector TWICE (list[k % count],
 * 0xECF380's idiv), skipping tiles outside 1 <= x,y <= size-3 (the guard
 * that keeps every kernel read in bounds — the reads themselves are
 * unguarded). Per tile, two in-place sub-passes over its 4x4 block, cells
 * row-major: first a DISTANCE-2 kernel — the four neighbours one full
 * tile away on the half-grid — then a distance-1 kernel, both
 * (N + S + E + W + 2*C) / 6 in unsigned integers (the 0xAAAAAAABh magic).
 *
 * The engine interleaves the corner paints and the stamp per tile; the
 * port splits them — the paints live on the layers, the stamp on the
 * plane, and the two never read each other — because the chain must
 * stamp the plane at carve time (the border seed is dented later by the
 * connections) while the layers only exist once fillTerrain has run.
 */
export function paintSeaCorners(
  layers: TerrainLayer[],
  sea: Tile[],
  deepWaterTile: TerrainTileInfo | null,
  size: number,
): void {
  const v = size + 1;
  for (const [x, y] of sea) {
    paint(layers, deepWaterTile, y, x, 200, v);
    paint(layers, deepWaterTile, y, x + 1, 200, v);
    paint(layers, deepWaterTile, y + 1, x, 200, v);
    paint(layers, deepWaterTile, y + 1, x + 1, 200, v);
  }
}

/** The river-plane half of `0xECF080` — the 4x4 stamps, then the two-kernel blur. */
export function stampZoneSeaRiver(
  river: RiverPlane,
  sea: Tile[],
  border: Int32Array[],
  size: number,
): void {
  const { w, data } = river;
  for (const [x, y] of sea) {
    const b = 7 - border[y]![x]!;
    const val = b > 5 || b * 80 >= 255 ? 255 : b * 80;
    for (let hx = 2 * x; hx < 2 * x + 4; hx++) {
      for (let hy = 2 * y; hy < 2 * y + 4; hy++) {
        if (hx < w && hy < w) data[hy * w + hx] = val;
      }
    }
  }

  const n = sea.length;
  for (let k = 0; k < 2 * n; k++) {
    const [x, y] = sea[k % n]!;
    if (x < 1 || y < 1 || x > size - 3 || y > size - 3) continue;
    for (const d of [2, 1]) {
      for (let hx = 2 * x; hx < 2 * x + 4; hx++) {
        for (let hy = 2 * y; hy < 2 * y + 4; hy++) {
          const sum = data[hy * w + hx - d]! + data[hy * w + hx + d]!
            + data[(hy - d) * w + hx]! + data[(hy + d) * w + hx]! + 2 * data[hy * w + hx]!;
          data[hy * w + hx] = Math.trunc(sum / 6);
        }
      }
    }
  }
}

/**
 * What the lake painter is handed for one zone: the blob the lakes head
 * collected, the two preset tiles it resolves and the race that picks its
 * ladder. The room and border readings travel WITH the tiles because the
 * painter runs inside the statics sweep while the layers only exist once
 * fillTerrain has been replayed — and the room grid is recomputed again by
 * every zone behind this one.
 */
export interface LakePaint {
  /** The blob in the head's collection order — the vector the painter gets. */
  tiles: Tile[];
  /** Per tile, the room grid as the lakes head left it. */
  room: Int32Array;
  /** Per tile, the border table (the carve's adjustment included). */
  border: Int32Array;
  /** The preset's `WaterTile` (+0x64), resolved. */
  waterTile: TerrainTileInfo | null;
  /** The preset's `WaterBottomTile` (+0x70), resolved. */
  waterBottomTile: TerrainTileInfo | null;
  /** `zone+0x18` — RACE_NECROMANCY (7) reads the gentler ladder. */
  settingRace: number;
}

/**
 * How many of the four ORTHOGONAL neighbours are blob tiles themselves —
 * the engine rescans the whole vector per neighbour with an exact float
 * compare (0xECE785). The neighbour ORDER cannot show in a count.
 */
function lakeNeighbours(tiles: Tile[], x: number, y: number): number {
  let n = 0;
  for (const [d1, d2] of ORTHO) {
    if (tiles.some(([tx, ty]) => tx === x + d1 && ty === y + d2)) n++;
  }
  return n;
}

/**
 * The lakes' terrain half — `0xECE680`, thiscall on the same
 * CTerrainProcessor, called once per zone from the lakes head's tail
 * (0xEBCA90) with that zone's blob, the zone's preset index (`zone+0xEC`)
 * and its setting race (`zone+0x18`), and BEFORE the head's decorations.
 * The phase's own tail — the 0x82 occupancy conversion — lives in
 * `growLakes`, where the sweep behind it needs the result; this is
 * everything the phase writes to the LAYERS. Drawless.
 *
 * Per blob tile, in vector order:
 *
 *   * the preset's WaterTile at the four corners, the LITERAL 150 (0x96 —
 *     TransitiveTileIntensity is not read here either). Water.xdb is
 *     priority 253 TT_SMALL_WATER, alone in its class, so a rim vertex
 *     painted once keeps 150 and an interior one painted again overflows
 *     to 255 — the reference's 28 and 129;
 *   * (the river-plane stamp, `stampZoneLakeRiver` below);
 *   * the preset's WaterBottomTile at the same four corners, at
 *     `min(200, (min(room, border) - c) * k)` — c/k are 4/15 when the
 *     setting race is RACE_NECROMANCY (`cmp [ebp+18h],7` at 0xECE720) and
 *     2/30 for everyone else. Nothing clamps this from BELOW: a shallow
 *     tile can ask for a negative weight, which PaintTile takes down its
 *     subtract branch. Haven's bed is River-bed_grass, priority 53 and
 *     class 0, so it competes with the zone tile the same way the water
 *     carve's bottom does.
 *
 * The two corner walks differ in order — the surface goes (x, x+1) then
 * (y, y+1), the bed the other way round — which four distinct vertices
 * cannot show; both are kept as the engine has them.
 */
export function paintLakes(layers: TerrainLayer[], lake: LakePaint, size: number): void {
  const v = size + 1;
  const sub = lake.settingRace === 7 ? 4 : 2;
  const mul = lake.settingRace === 7 ? 15 : 30;
  for (let i = 0; i < lake.tiles.length; i++) {
    const [x, y] = lake.tiles[i]!;
    paint(layers, lake.waterTile, y, x, 150, v);
    paint(layers, lake.waterTile, y, x + 1, 150, v);
    paint(layers, lake.waterTile, y + 1, x, 150, v);
    paint(layers, lake.waterTile, y + 1, x + 1, 150, v);

    const raw = (Math.min(lake.room[i]!, lake.border[i]!) - sub) * mul;
    const w = raw >= 200 ? 200 : raw;
    paint(layers, lake.waterBottomTile, y, x, w, v);
    paint(layers, lake.waterBottomTile, y + 1, x, w, v);
    paint(layers, lake.waterBottomTile, y, x + 1, w, v);
    paint(layers, lake.waterBottomTile, y + 1, x + 1, w, v);
  }
}

/**
 * The river-plane half of `0xECE680` — the interleaved middle of the walk
 * above, split out for the same reason the sea's is: the plane belongs to
 * the run, the layers to the replay.
 *
 * A tile stamps only where room > 3 AND at least THREE of its four
 * orthogonal neighbours are lake — the blob's interior, the rim left dry.
 * The 4x4 half-tile block at (2x, 2y) takes `v = (min(room, border) - 1) *
 * 60`, capped at 255, and — unlike the sea's stamp — is written with NO
 * guard against the plane's dimensions: a lake sits deep inside its zone
 * by construction, so the engine never needed one.
 *
 * Then the blur, the sea's verbatim: k = 0..2*count-1 over list[k % count],
 * two in-place sub-passes per tile (distance 2, then distance 1), each cell
 * (N + S + E + W + 2*C) / 6 in unsigned integers. The sea skips tiles
 * outside 1 <= x,y <= size-3; the lakes' blur has no such guard either.
 */
export function stampZoneLakeRiver(river: RiverPlane, lake: LakePaint): void {
  const { w, data } = river;
  for (let i = 0; i < lake.tiles.length; i++) {
    const [x, y] = lake.tiles[i]!;
    if (lake.room[i]! <= 3) continue;
    if (lakeNeighbours(lake.tiles, x, y) <= 2) continue;
    const raw = (Math.min(lake.room[i]!, lake.border[i]!) - 1) * 60;
    const val = raw >= 255 ? 255 : raw;
    for (let hx = 2 * x; hx < 2 * x + 4; hx++) {
      for (let hy = 2 * y; hy < 2 * y + 4; hy++) data[hy * w + hx] = val;
    }
  }

  const n = lake.tiles.length;
  for (let k = 0; k < 2 * n; k++) {
    const [x, y] = lake.tiles[k % n]!;
    for (const d of [2, 1]) {
      for (let hx = 2 * x; hx < 2 * x + 4; hx++) {
        for (let hy = 2 * y; hy < 2 * y + 4; hy++) {
          const sum = data[hy * w + hx - d]! + data[hy * w + hx + d]!
            + data[(hy - d) * w + hx]! + data[(hy + d) * w + hx]! + 2 * data[hy * w + hx]!;
          data[hy * w + hx] = Math.trunc(sum / 6);
        }
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
