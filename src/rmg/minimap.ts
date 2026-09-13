// The minimap — `minimap_floor_%02d.dds`, the last document the generator
// writes and the only one that is a PICTURE rather than a record.
//
// The chain, read out of `H5_Game_H5E.exe`: `0xEA30D0` is the RMG's minimap
// step; it builds a pos converter over the map, calls `0xDD0C70` to draw and
// `0xDD1BD0` to write. The drawer makes TWO images per floor — a terrain
// layer one pixel per playable tile, and a 256x256 icon layer the objects are
// stamped into — resamples each to 256x256 through `0x9743A0` (see
// [`resample.ts`](resample.ts)) and merges them, icon over terrain.
//
// THE TERRAIN PASS is `0xDD0660`, small enough to state whole. With `A` the
// map's TileX, `B` its BorderSize and `N = A - 2B`, for pixel (x, y):
//
//   tile = (B + x, B + (N - 1 - y))              ; the row index is N-1-outer
//   colour = 0xFF000000
//   if flags[ty][tx] > 0x15:              leave it black
//   elif sea(tx, ty):                     colour = the owner's flat colour
//   else: rec = tileDocument(tx, ty)
//         colour = 0xFF<<24 | trunc(rec.minimapColor.x * 255) << 16
//                           | trunc(rec.minimapColor.y * 255) << 8
//                           | trunc(rec.minimapColor.z * 255)
//   if mask(tx, ty) and not spared(tx, ty):  R, G, B >>= 1
//
// The multiplier is the float 255.0 at `0xF4A1E8` and the convert `0x949FF0`
// is `cvttss2si` — truncation, which is why Water.xdb's 0.00784314 comes out
// as 2 and not 3. On a generated map the first two arms are dead: the flags
// plane is a uniform 16 everywhere (the RMG's water is texture layers over
// ordinary ground, never a dug sea), so only the third is reachable, and the
// flat colour the owner would pass is 0x00000000 anyway — measured by the
// probe, `mm sea test calls 8836` against `mm sea test true 0`.
//
// WHICH DOCUMENT a tile gets is `0x9EB800`: `0x9ED3E0` walks the tile's layers
// from the TOP down over the WATER ones (`TT_SMALL_WATER` / `TT_BIG_WATER`),
// and if the winner does not beat 32.0 of 255 (`0xF4BB38`) `0x9ED2A0` runs the
// same walk with the gate inverted and that answer stands. Coverage is
// `0x9ED7D0`, a bilinear sample of the layer's byte mask at the tile CENTRE
// with each byte widened `b >= 0x80 ? 0xFF : b * 2`.
//
// THE DARKENING MASK is the passability plane, the tiles the map's objects
// occupy and the tiles big water covers — see [`minimap-mask.ts`](minimap-mask.ts).
//
// THE WATER EXEMPTION is `0x9EC3C0`, the terrain's "is this tile water", and
// the halving site reads its answer the plain way round: bit set AND the
// predicate FALSE halves (`0xDD0784` calls it, `jne` past the shifts on a
// non-zero `al`). `waterTile` below is the predicate, every branch read; the
// rule it held before that reading — "spared when wet by the river half-grid
// and NOT under big water" — was fitted to four maps and turned out to be the
// live arm exactly, with the big-water layer forcing FALSE, as guessed.
//
// The reference cannot test it: its river plane is empty on all 9,216 tiles.
// Maps that do show both halves — a lava LAKE and a `-water 2` sea are
// `TT_BIG_WATER` and the engine halves every one of their tiles; a
// `TT_SMALL_WATER` lake has river cells over the threshold too and the engine
// halves NONE of them.

import type { EngineSine } from '../exe/sine-table.ts';
import { mul24, parse24, parse53 } from '../exe/x87.ts';
import { LANCZOS3_SUPPORT, lanczos3, resampleFiltered, type Bitmap } from './resample.ts';
import { bigWaterCovers } from './minimap-mask.ts';
import type { TerrainLayer } from './terrain.ts';

/** The side of the picture the `.dds` carries, both axes. */
export const MINIMAP_SIDE = 256;

/** `0x9ED7D0` — the layer's mask, bilinear at a point, bytes widened first. */
function coverage(mask: Uint8Array, dim: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const last = dim - 1;
  const clamp = (v: number): number => (v < 0 ? 0 : v > last ? last : v);
  const x0 = clamp(ix), x1 = clamp(ix + 1), y0 = clamp(iy), y1 = clamp(iy + 1);
  // `cmp cl,80h / or cl,0FFh` on one side, `add cl,cl` on the other.
  const widen = (b: number): number => (b >= 0x80 ? 0xff : b * 2);
  const a = widen(mask[y0 * dim + x0]!), b = widen(mask[y0 * dim + x1]!);
  const c = widen(mask[y1 * dim + x0]!), d = widen(mask[y1 * dim + x1]!);
  const fx = Math.fround(x - ix), fy = Math.fround(y - iy);
  const lerp = (p: number, q: number, t: number): number =>
    Math.trunc(Math.fround(Math.fround(Math.fround(q - p) * t) + p));
  const top = lerp(a, b, fx) & 0xff;
  const bottom = lerp(c, d, fx) & 0xff;
  return lerp(top, bottom, fy);
}

/** `0x9ED3E0` — the dominant layer of one class, or null when none covers. */
function dominant(
  layers: readonly TerrainLayer[], dim: number, tx: number, ty: number, water: boolean,
): { layer: TerrainLayer | null; score: number } {
  let best = 0;
  let winner: TerrainLayer | null = null;
  let remaining = 1;
  // The engine walks the vector backwards, and the vector is in ascending
  // priority order, so this is the topmost layer first.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    const isWater = layer.type === 'TT_SMALL_WATER' || layer.type === 'TT_BIG_WATER';
    if (isWater !== water) continue;
    // THE BASE LAYER COVERS EVERYTHING. The map is created with one ground
    // under all of it and the zones paint on top; nothing carves the base
    // back, because the painter only takes from layers of the same class at a
    // DIFFERENT priority once a vertex would pass 255, which a single 255
    // never does. `GroundTerrain.bin` then stores the base cut down to where
    // it still shows — so the file and the live terrain disagree about this
    // one layer, and the drawer reads the live one. Measured: the probe's
    // dump of the vector the drawer walks has the first layer at 255 on all
    // 9,409 vertices where the file has 4,668, the other six byte-identical.
    // It is worth 53 tiles of 8,836, every one at a zone boundary where the
    // top layer covers two corners of four: 127 against the base's 255 taken
    // at the transparency the top layer left, 128 — which is why the base
    // wins there and only there.
    const c = i === 0 ? 255 : coverage(layer.mask, dim, tx + 0.5, ty + 0.5) & 0xff;
    const score = Math.fround(remaining * c);
    if (score > best) {
      best = score;
      winner = layer;
    }
    // The running transparency drops whether this layer won or not.
    remaining = Math.fround(Math.fround(1 - Math.fround(c * Math.fround(1 / 255))) * remaining);
  }
  return { layer: winner, score: best };
}

/** `0xF4BB38` — how much of a tile water must cover to speak for it. */
const WATER_SCORE = 32;

/** `0x9EB800` — the document a tile is drawn from: water first, then land. */
export function tileDocument(
  layers: readonly TerrainLayer[], dim: number, tx: number, ty: number,
): TerrainLayer | null {
  const wet = dominant(layers, dim, tx, ty, true);
  if (wet.score > WATER_SCORE) return wet.layer;
  return dominant(layers, dim, tx, ty, false).layer;
}

/** The planes `0x9EC3C0` reads, all of them the floor's own. */
export interface WaterTileInput {
  /** The map's TileX; every plane below is on `(side + 1)^2` vertices. */
  side: number;
  /** The texture layers — only the `TT_BIG_WATER` ones are looked at. */
  layers: readonly TerrainLayer[];
  /**
   * The ground flags on the vertex grid, `terrain[+0x28]`. Never 0 on a
   * generated floor (the constructor's 16, the carve's 32/26/21/16), so its
   * arm cannot fire here; it is kept because the predicate has it.
   */
  flags?: Uint8Array;
  /**
   * The river half-grid, `terrain[+0x48]`, `(2 * side + 1)` wide. An
   * underground floor has none of its own — the generator stamps only the
   * surface's — so the field is left out there and every cell reads 0.
   */
  river?: { w: number; data: Uint8Array };
}

/**
 * `0x9EC3C0` — is this tile WATER? READ, all four arms (13.09.2026):
 *
 *   xc = clamp(x, 0, W - 2), yc = clamp(y, 0, H - 2)       ; W, H = the vertex dims
 *   if flags[yc][xc], [yc][xc+1], [yc+1][xc], [yc+1][xc+1] all 0:  -> tail
 *   elif 0x9EBAE0(xc, yc):                    return false   ; big water covers a corner
 *   elif river[2*yc+1][2*xc+1] <= 0x8C:       return false   ; unsigned, STRICTLY above goes on
 *   tail: if the float plane at +0x58 covers the tile and reads > 0.0f: return false
 *   return true
 *
 * The float plane is the sea's (`0x9EC480` reads it the same way, against the
 * same zero); a generated map never digs one and the arm never fires — the
 * spared tiles of three lake maps are the measurement, each of them ≤ 0 there.
 * The flags arm is dead the same way, and both are written here because the
 * port carries the planes and the transcript should say what the executable
 * says, not what a generated floor happens to make of it.
 *
 * The shipyard's ring asks the same question (`0xCB19C9`) — see `shipTile` in
 * `shipyards.ts`, which keeps only the river arm: when the shipyards are placed
 * no texture layer has been painted yet, so the big-water arm has nothing to
 * read there, and 44 sea maps place theirs byte-identically without it.
 */
export function waterTile(input: WaterTileInput, x: number, y: number): boolean {
  const dim = input.side + 1;
  const clamp = (v: number): number => (v < 0 ? 0 : v > dim - 2 ? dim - 2 : v);
  const xc = clamp(x), yc = clamp(y);
  const flags = input.flags;
  const cornersZero = flags !== undefined
    && flags[yc * dim + xc] === 0 && flags[yc * dim + xc + 1] === 0
    && flags[(yc + 1) * dim + xc] === 0 && flags[(yc + 1) * dim + xc + 1] === 0;
  if (!cornersZero) {
    if (bigWaterCovers(input.layers, dim, xc, yc)) return false;
    const river = input.river;
    const cell = river ? river.data[(2 * yc + 1) * river.w + (2 * xc + 1)]! : 0;
    if (cell <= 0x8c) return false;
  }
  // The float plane's arm: a generated floor has no sea, so nothing to test.
  return true;
}

/** What one floor's terrain layer is drawn from. */
export interface MinimapFloor {
  /** The map's TileX — `desc[+0x4C]`. */
  side: number;
  /** The map's BorderSize — `desc[+0x1DC]`. */
  border: number;
  /** The floor's texture layers, in the order `GroundTerrain.bin` holds them. */
  layers: readonly TerrainLayer[];
  /** The vertex dimension the masks are laid out on, `side + 1`. */
  dim: number;
  /** Is this tile darkened? The mask of [`minimap-mask.ts`](minimap-mask.ts). */
  masked: (tx: number, ty: number) => boolean;
  /**
   * A masked tile the halving spares — `waterTile` over the floor's planes.
   * Left out, nothing is spared, which is what an underground floor gets: its
   * river plane is empty and its flags are never zero.
   */
  spared?: (tx: number, ty: number) => boolean;
  /**
   * THE GAME'S BUILD: its tile colours come out of its own digit-by-digit
   * chopping parse (`parse24` in `src/exe/x87.ts`) and a chopping multiply,
   * so a few of them are one below the editor's. Measured on a large game
   * map: 62,090 of the surface floor's 65,536 pixels identical without it,
   * 65,532 with it; the underground floor 63,056 to 65,535.
   */
  gameParse?: boolean;
  /**
   * The floor's ground flags, `(side + 1)^2` on the vertex grid.
   *
   * A SURFACE floor's are the constructor's uniform 16 and the arm that reads
   * them is dead, which is why the pass ran without them for so long. An
   * UNDERGROUND floor's are the massif carve's byte grid — 32 for solid rock,
   * 26 and 21 for the two ramp steps down, 16 for open cave floor — and a tile
   * over 0x15 is left BLACK, which is most of an underground map.
   */
  flags?: Uint8Array;
}

/** `0xDD0660` — the N x N terrain layer, BGRA, one pixel per playable tile. */
export function drawTerrainLayer(floor: MinimapFloor): Bitmap {
  const { side, border, layers, dim } = floor;
  const n = side - 2 * border;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const ty = border + (n - 1 - y);
    for (let x = 0; x < n; x++) {
      const tx = border + x;
      const at = (y * n + x) * 4;
      let b = 0, g = 0, r = 0;
      // The pass's FIRST arm, and the only one a black pixel comes from.
      const rock = (floor.flags?.[ty * dim + tx] ?? 16) > 0x15;
      const doc = rock ? null : tileDocument(layers, dim, tx, ty);
      if (doc) {
        const [cr, cg, cb] = doc.minimapColor;
        // BOTH BUILDS READ THE TEXT with the same loop, at different
        // precisions: the game's SSE build rounds every step to a chopped
        // single (`parse24`), the editor's x87 build runs at 53 bits and
        // stores a single once (`parse53`) — see `x87.ts`. The multiply chops
        // either way; by then the process has its Direct3D device. `String(c)`
        // is the xdb's decimal again, since the port holds the nearest double
        // of a short decimal.
        const parse = floor.gameParse ? parse24 : parse53;
        const byte = (c: number): number => Math.trunc(mul24(parse(String(c)), 255));
        r = byte(cr);
        g = byte(cg);
        b = byte(cb);
      }
      if (floor.masked(tx, ty) && !(floor.spared?.(tx, ty) ?? false)) {
        b >>= 1; g >>= 1; r >>= 1;
      }
      data[at] = b;
      data[at + 1] = g;
      data[at + 2] = r;
      data[at + 3] = 0xff;
    }
  }
  return { width: n, height: n, data };
}

/** `0xDD2590` — the icon layer over the terrain one, alpha deciding. */
export function mergeLayers(terrain: Bitmap, icons: Bitmap): Bitmap {
  const data = Uint8Array.from(terrain.data);
  for (let i = 0; i < data.length; i += 4) {
    if (icons.data[i + 3] === 0) continue;
    data[i] = icons.data[i]!;
    data[i + 1] = icons.data[i + 1]!;
    data[i + 2] = icons.data[i + 2]!;
    data[i + 3] = icons.data[i + 3]!;
  }
  return { width: terrain.width, height: terrain.height, data };
}

/** The finished 256x256 picture: both layers resampled, then merged. */
export function drawMinimap(floor: MinimapFloor, icons: Bitmap, sine: EngineSine): Bitmap {
  // The game's build parses its colours its own way AND resamples on doubles
  // — one flag, since a map is one build's or the other's.
  const game = floor.gameParse ?? false;
  const filter = lanczos3(sine, game);
  const terrain = resampleFiltered(drawTerrainLayer(floor), MINIMAP_SIDE, MINIMAP_SIDE, filter, LANCZOS3_SUPPORT, game);
  const stamped = resampleFiltered(icons, MINIMAP_SIDE, MINIMAP_SIDE, filter, LANCZOS3_SUPPORT, game);
  return mergeLayers(terrain, stamped);
}
