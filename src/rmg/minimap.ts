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
//   if mask(tx, ty) and not water(tx, ty):  R, G, B >>= 1
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
// THE DARKENING MASK is the passability plane plus the tiles the map's
// objects occupy — see [`minimap-mask.ts`](minimap-mask.ts).

import type { EngineSine } from '../exe/sine-table.ts';
import { lanczos3, resampleFiltered, type Bitmap } from './resample.ts';
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
    const c = coverage(layer.mask, dim, tx + 0.5, ty + 0.5) & 0xff;
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
  /** `0x9EC3C0`, the shipyard's water test — a water tile is never darkened. */
  water?: (tx: number, ty: number) => boolean;
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
      const doc = tileDocument(layers, dim, tx, ty);
      const at = (y * n + x) * 4;
      let b = 0, g = 0, r = 0;
      if (doc) {
        const [cr, cg, cb] = doc.minimapColor;
        r = Math.trunc(Math.fround(Math.fround(cr) * 255));
        g = Math.trunc(Math.fround(Math.fround(cg) * 255));
        b = Math.trunc(Math.fround(Math.fround(cb) * 255));
      }
      if (floor.masked(tx, ty) && !(floor.water?.(tx, ty) ?? false)) {
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
  const filter = lanczos3(sine);
  const terrain = resampleFiltered(drawTerrainLayer(floor), MINIMAP_SIDE, MINIMAP_SIDE, filter);
  const stamped = resampleFiltered(icons, MINIMAP_SIDE, MINIMAP_SIDE, filter);
  return mergeLayers(terrain, stamped);
}
