// The sea: a flat sheet over every cell that touches water-flagged ground.
//
// There are two distinct kinds of water in this engine, and only one of them is
// a texture. "Rivers" (Bog / LavaFlow / Water) are TILE BRUSHES painted onto
// whatever the ground already is — riverVertices below reads that plane. The
// Terraforming `water` tool instead DIGS a basin, which the engine then fills
// to a flat level, and that sheet is what buildWater describes.
//
// Evidence from the shipped maps: the floor of a dug basin often sits BELOW its
// water level (heights of 0 and 1.6 under bodies whose level is 2.0), and 2.0
// dominates by a wide margin (5334 vertices on A2C1M5, 2379 on A2C2M4) — that's
// sea level. Elevated lakes exist too (5.92, 14.53, 15.32), so the level is
// resolved per connected body rather than hard-coded.
//
// Rendering only the heightmap therefore leaves a dry pit where water should
// be, and anything the game places at water level — boats, shipyards — appears
// to hover over it.

import { existsSync } from 'node:fs';
import { readGroundFlags, readWaterPlane, FLAG_WATER } from '../terrain/terrain.ts';
import { decodeDDS } from '../format/dds.ts';
import { pngDataUri } from '../format/png.ts';
import type { Assets } from '../game/assets.ts';
import type { Terrain } from '../terrain/terrain.ts';
import type { WaterData } from './payload.ts';


// Sea level. `lower` digs the bed to exactly 0 while ordinary ground stays at
// the 2.0 default, and the editor lays a shore ring at exactly 1.6 between them
// (90 vertices of it on map 12). That ring is the beach, so the surface has to
// sit just UNDER it — at 1.6 the ring submerges and the brown rim the original
// editor shows above the waterline disappears.
// Not recorded anywhere in the format, so it stays tunable from the toolbar.
export const SEA_LEVEL = 1.5;

// The sea's own sheet. Water.dds is CLAMP and near-black by design — the game's
// sea reads dark, while rivers painted with the _TNL brushes read blue. Loaded
// straight rather than through tileTexture, which deliberately swaps CLAMP
// textures out for their tiling siblings.
const SEA_TEXTURE = '/Textures/Terrain/Water/Water.dds';

function seaTexture(data: Assets, size: number): string | null {
  try {
    const p = data.path(SEA_TEXTURE);
    if (!existsSync(p)) return null;
    const img = decodeDDS(p);
    const out = new Uint8Array(size * size * 4);
    const bw = Math.max(1, img.width / size | 0), bh = Math.max(1, img.height / size | 0);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx0 = x * img.width / size | 0, sy0 = y * img.height / size | 0;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) {
        const sy = sy0 + dy, sx = sx0 + dx;
        if (sy >= img.height || sx >= img.width) continue;
        const si = (sy * img.width + sx) * 4;
        r += img.rgba[si]; g += img.rgba[si + 1]; b += img.rgba[si + 2]; n++;
      }
      const o = (y * size + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    return pngDataUri(size, size, out);
  } catch { return null; }
}

/** Vertices whose half-tile river cell is set. */
export function riverVertices(t: Terrain): number[] {
  const r = readWaterPlane(t);
  if (!r) return [];
  const out: number[] = [];
  for (let y = 0; y < t.V; y++) for (let x = 0; x < t.V; x++) {
    if (r.data[(2 * y) * r.W + 2 * x]!) out.push(y * t.V + x);
  }
  return out;
}

export function buildWater(t: Terrain, level: number, data: Assets): WaterData | null {
  const flags = readGroundFlags(t);
  if (!flags) return null;
  const V = t.V, N = t.N;

  let wet = 0;
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (flags[i] === FLAG_WATER) { water[i] = 1; wet++; }

  // Cover every cell that touches water, then let the terrain occlude the sheet:
  // the bed is at 0 and the shore climbs to the 2.0 default, so a flat sheet at
  // `level` is cut exactly where the beach crosses it. That gives a real
  // waterline for free — no alpha feathering needed.
  const cells = [];
  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    const a = y * V + x;
    if (water[a] || water[a + 1] || water[a + V] || water[a + V + 1]) cells.push(a);
  }
  // A dry map still gets its sheet description, with no cells. The editor needs
  // the texture and level in hand so that digging a basin can raise a sea right
  // away instead of only after a reload. Callers gate on cells.length.
  return { V, level, cells, wet, tex: seaTexture(data, 256) };
}
