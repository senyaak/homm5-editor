// The water border — CGameWaterBorderedZone's own piece of GenerateMap.
//
// When the order asked for water (gen+0xA6 != 0, the dialog's checkbox), a
// block between "towns placed" and the dist-to-towns tables (0xEABB1D) picks
// a SEA DEPTH by the map's size index — the jump table at 0xEAC3C0 —
// and calls every floor-0 zone's vtable +0x24 with it. The base CGameZone
// slot is a one-instruction ret (0xEB7B40); only CGameWaterBorderedZone
// answers (0xECB7D0), in two drawless halves and one drawing tail:
//
//   CARVE     every zone tile with border < depth leaves the zone: the zone
//             grid (+0xC4) takes -1 and the tile joins a local "sea" vector.
//             EVERY zone tile's border then takes += (1 - depth) — the
//             distance-to-border table is recalibrated to the new coastline.
//             Right there, per tile in list order, the carve paints terrain:
//             adjusted border in (-depth, 0) puts four corner writes of 200
//             (a literal — TransitiveTileIntensity is never read here either)
//             of the params' DeepWaterBottom through PaintTile 0xEB1590
//             (0xECB96A..0xECBA95), and adjusted border in {0,1} — the
//             unsigned `cmp ..,1 / ja` at 0xECBADE — the same four corners
//             of the PRESET's WaterCoastTile (+0x88, cached; an empty ref
//             falls back to DeepWaterBottom, 0xECBB79). The two bands are
//             exclusive; the marks are recorded here and painted by
//             terrain.ts's paintWaterMarks in the same order. After the
//             loop the zone hands its sea vector to the terrain processor
//             (0xECF080 at 0xECBD2A) — the DeepWaterTile corners and the
//             river-plane stamp+blur, see terrain.ts. Then the zone's
//             tile list (+0xCC) is rebuilt keeping
//             adjusted border >= 0 — note the RIM: a tile with original
//             border == depth-1 is disowned by the grid but KEPT in the
//             list — and the rest moves to the water ledger (+0x148).
//
//   TREASURES (0xECDB20, called with the sea vector): count =
//             trunc(len(rebuilt +0xCC) / 200) placements — the magic
//             0x51EB851F with `sar edx,6` — each exactly five draws. Candidates are the sea tiles inside [1, dim-2] on both
//             axes and at least 5.0 (0xF61F14) from every entry of the
//             repel ledger (+0x154) — rebuilt before every placement, so the
//             ledger the successes feed shrinks the pool. Then below(len)
//             picks the tile, below(len(WaterTreasures)) the type (the
//             params +0x210 list), below(4) a quarter-turn (x pi/2,
//             0xF4B538), and 0xEB3990 mints the name — two below(65535) —
//             on the way to creation. The island run placed all 36 of 36;
//             what a failed creation skips is unread (a named hole).
//
// The repel distance compares single-precision sqrt against 5.0, but the
// operands are whole tile coordinates: dist < 5.0 is exactly dx^2+dy^2 < 25
// in integers, so no float is needed (sqrt(25) == 5.0 exactly).

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import type { Tile } from './placement.ts';

/** The sea depth by size index — the jump table at 0xEAC3C0; >6 falls to 3. */
export function waterDepth(sizeIndex: number): number {
  const table = [2, 3, 4, 5, 7, 8, 10];
  return sizeIndex >= 0 && sizeIndex <= 6 ? table[sizeIndex]! : 3;
}

export interface WaterCarveInput {
  size: number;
  /** MUTATED: the floor-0 zone grid — carved tiles take -1. */
  grid: Int32Array[];
  /** MUTATED: every zone tile's entry takes += (1 - depth). */
  border: Int32Array[];
  zoneIndex: number;
  /** The zone's `+0xCC` in FillZones' scan order (zoneTiles before the carve). */
  tiles: Tile[];
  depth: number;
}

/** One coast/sea 200-mark — a tile whose four corners the carve paints. */
export interface WaterMark {
  x: number;
  y: number;
  /** 'sea' = DeepWaterBottom (adjusted border in (-depth, 0)); 'coast' = the preset's WaterCoastTile (adjusted in {0,1}). */
  band: 'sea' | 'coast';
}

export interface WaterCarveResult {
  /** The rebuilt `+0xCC` — adjusted border >= 0, rim included. */
  kept: Tile[];
  /** The carve's local vector — the treasure candidates. */
  sea: Tile[];
  /** The `+0x148` water ledger — adjusted border < 0. */
  waterLedger: Tile[];
  /** The carve's terrain marks, in tiles order — paintWaterMarks replays them. */
  marks: WaterMark[];
}

/** The carve half of `0xECB7D0` — no draws. */
export function carveWaterBorder(input: WaterCarveInput): WaterCarveResult {
  const { grid, border, zoneIndex, tiles, depth } = input;
  const sea: Tile[] = [];
  const marks: WaterMark[] = [];
  for (const [x, y] of tiles) {
    if (border[y]![x]! < depth) {
      sea.push([x, y]);
      grid[y]![x] = -1;
    }
    border[y]![x] += 1 - depth;
    const adj = border[y]![x]!;
    if (adj > -depth && adj < 0) marks.push({ x, y, band: 'sea' });
    else if (adj === 0 || adj === 1) marks.push({ x, y, band: 'coast' });
  }
  const kept: Tile[] = [];
  const waterLedger: Tile[] = [];
  for (const t of tiles) {
    if (border[t[1]]![t[0]]! >= 0) kept.push(t);
    else waterLedger.push(t);
  }
  return { kept, sea, waterLedger, marks };
}

export interface WaterTreasuresInput {
  size: number;
  /** len(rebuilt `+0xCC`) — the count's only input: trunc(len / 200). */
  landTiles: number;
  sea: Tile[];
  /** MUTATED: the `+0x154` repel ledger — every success joins it. */
  ledger: Tile[];
  /** The `WaterTreasures` list length (params `+0x210`). */
  typeCount: number;
}

export interface PlacedWaterTreasure {
  /** Index into params.waterTreasures. */
  typeIndex: number;
  name: string;
  x: number;
  y: number;
  /** below(4) — the quarter-turn (x pi/2). */
  q: number;
}

/** The treasure half — `0xECDB20`, five draws per placement. */
export function placeWaterTreasures(input: WaterTreasuresInput, rng: DrawSource): PlacedWaterTreasure[] {
  const { size, sea, ledger, typeCount } = input;
  const count = Math.trunc(input.landTiles / 200);
  const placed: PlacedWaterTreasure[] = [];
  for (let i = 0; i < count; i++) {
    const candidates = sea.filter(([x, y]) => {
      if (x < 1 || x > size - 2 || y < 1 || y > size - 2) return false;
      for (const [lx, ly] of ledger) {
        const dx = lx - x;
        const dy = ly - y;
        if (dx * dx + dy * dy < 25) return false;
      }
      return true;
    });
    const pick = rng.below(candidates.length);
    const typeIndex = rng.below(typeCount);
    const q = rng.below(4);
    const name = mintName(rng);
    const tile = candidates[pick]!;
    ledger.push(tile);
    placed.push({ typeIndex, name, x: tile[0], y: tile[1], q });
  }
  return placed;
}
