// The ground: what colour it is, what it is painted with, and what the brush
// palette offers to paint it with.
//
// All three answers come from the same place — the terrain's texture layers and
// the AdvMapTile documents they name — so they share their readers and their
// caches here. The cheap answer (per-vertex MinimapColor blending) and the real
// one (the layer textures plus their masks, for the splat shader) are both
// wanted: the first is what a freshly loaded map draws with while the second is
// still being decoded.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseTerrain, readTextureLayers, readMask } from '../terrain/terrain.ts';
import { decodeDDS } from '../format/dds.ts';
import { pngDataUri } from '../format/png.ts';
import { toAssets } from '../game/assets.ts';
import type { Assets } from '../game/assets.ts';
import type { Terrain, TextureLayer } from '../terrain/terrain.ts';
import type { ReadXdb } from './xdb.ts';
import type { SplatData, TileInfo } from './payload.ts';


// Per-vertex ground colour: blend each texture layer's representative colour
// (the AdvMapTile <MinimapColor>) weighted by its per-vertex opacity mask. This
// paints grass/dirt/sand/water and, crucially, ROADS, in one cheap pass without
// decoding any .dds. Returns [r,g,b,…] in 0..1, or null if no layers resolved.
export function terrainColors(t: Terrain, readXdb: ReadXdb, cache: Map<string, number[] | null>): number[] | null {
  const layers = readTextureLayers(t);
  const N = t.N;
  const acc = new Float32Array(N * 3);
  const total = new Float32Array(N);
  let any = false;
  for (const layer of layers) {
    if (!layer.path) continue;
    const col = tileColor(layer.path, readXdb, cache);
    if (!col) continue;
    const mask = readMask(t, layer);
    for (let i = 0; i < N; i++) {
      const w = mask[i]; if (!w) continue;
      acc[i * 3] += col[0] * w; acc[i * 3 + 1] += col[1] * w; acc[i * 3 + 2] += col[2] * w;
      total[i] += w; any = true;
    }
  }
  if (!any) return null;
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const tw = total[i];
    if (tw > 0) { out[i * 3] = acc[i * 3] / tw; out[i * 3 + 1] = acc[i * 3 + 1] / tw; out[i * 3 + 2] = acc[i * 3 + 2] / tw; }
    else { out[i * 3] = 0.30; out[i * 3 + 1] = 0.33; out[i * 3 + 2] = 0.24; } // bare default
  }
  return Array.from(out, (v) => +v.toFixed(3));
}

// ---- terrain texture splatting -------------------------------------------
// The ground is painted by blending N tile textures, each weighted by a
// per-vertex opacity mask. Flat MinimapColor blending (terrainColors above)
// gets the hues right but loses ALL texture detail, so we also ship the real
// thing: every layer's .dds downsampled to `size`, plus the masks packed into
// RGB images. The renderer feeds both to a splat shader, which tiles each
// texture across the map at full resolution — no giant baked atlas needed.
//
// Masks are packed 3-per-image (RGB) and alpha is pinned to 255 on purpose:
// weights stored in an alpha channel get mangled by the canvas premultiply
// round-trip the renderer uses to read pixels back.

/**
 * AdvMapTile.xdb -> its ground texture as `size`×`size` opaque RGBA, or null.
 *
 * Splat layers tile across the map, so a CLAMP texture is the wrong asset for
 * one. The Water tile points at Water.dds — CLAMP, uncompressed, near-black
 * ([0,15,15]) — which is the SEA sheet, not a brush; painting a river with it
 * came out almost black. Its siblings show the convention: Bog and LavaFlow use
 * Bog_TNL / Lava_TNL, WRAP DXT3 brush textures, and Water_TNL sits right beside
 * them unused at [0,64,79] — the blue Senya sees on rivers in the original
 * editor. So when a tile resolves to a CLAMP texture that has a _TNL sibling,
 * take the sibling.
 */
function tileTexture(tilePath: string, readXdb: ReadXdb, data: Assets, size: number): Uint8Array | null {
  const xml = readXdb(tilePath); if (!xml) return null;
  const t = xml.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/);
  if (!t || !t[1]) return null;                       // <Texture/> = no texture
  let texXdb = t[1].split('#')[0];
  let tx = readXdb(texXdb); if (!tx) return null;
  if (/<AddrType>CLAMP<\/AddrType>/.test(tx)) {
    const tnl = texXdb.replace(/\.xdb$/i, '_TNL.xdb');
    const alt = readXdb(tnl);
    if (alt) { texXdb = tnl; tx = alt; }
  }
  const dest = tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
  const ddsPath = data.path(join(dirname(texXdb), dest[1]));
  if (!existsSync(ddsPath)) return null;
  const img = decodeDDS(ddsPath);
  const out = new Uint8Array(size * size * 4);
  // Box filter, not point sampling: these are 1024² textures shrunk to 256², so
  // taking every 4th texel would throw away 15/16 of the image and turn grass
  // and gravel into noise. Averaging the whole source block keeps them smooth.
  const bw = Math.max(1, img.width / size | 0), bh = Math.max(1, img.height / size | 0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx0 = x * img.width / size | 0, sy0 = y * img.height / size | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < bh; dy++) {
      const sy = sy0 + dy; if (sy >= img.height) break;
      for (let dx = 0; dx < bw; dx++) {
        const sx = sx0 + dx; if (sx >= img.width) break;
        const si = (sy * img.width + sx) * 4;
        r += img.rgba[si]; g += img.rgba[si + 1]; b += img.rgba[si + 2]; n++;
      }
    }
    const o = (y * size + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return out;
}

/** AdvMapTile.xdb -> its <Priority> (the engine's paint order), cached by path. */
function tilePriority(path: string, readXdb: ReadXdb, cache: Map<string, number>): number {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  const xml = readXdb(path);
  const p = xml ? +(xml.match(/<Priority>(-?\d+)<\/Priority>/)?.[1] ?? 0) : 0;
  cache.set(path, p);
  return p;
}

function flatTexture(col: number[], size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const [r, g, b] = col.map((v) => Math.max(0, Math.min(255, v * 255 | 0)));
  for (let i = 0; i < size * size; i++) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
  return px;
}

/**
 * Rebuild just the splat for a terrain buffer.
 *
 * Adding a texture layer changes how many layers the shader composites, so the
 * renderer needs fresh mask groups and tile textures. This goes through the
 * same buildSplat the loader uses rather than a second construction path —
 * the two drifting apart is exactly how a live edit ends up looking different
 * from the same map reloaded.
 *
 * Caches are local: this runs on a deliberate one-off action, not per frame.
 */
export function splatFor(raw: Buffer, root: string | Assets, tileSize = 256): SplatData | null {
  const data = toAssets(root);
  const readXdb: ReadXdb = (href) => {
    const p = data.path(href.split('#')[0]);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  return buildSplat(parseTerrain(raw), readXdb, data, new Map(), new Map(), tileSize);
}

export function buildSplat(
  t: Terrain, readXdb: ReadXdb, data: Assets,
  texCache: Map<string, string>, colCache: Map<string, number[] | null>, size: number,
): SplatData | null {
  // A predicate, not a plain truthiness filter: only this tells the checker the
  // surviving layers definitely carry a path.
  let layers = readTextureLayers(t).filter((l): l is TextureLayer & { path: string } => l.path !== null);
  if (!layers.length) return null;
  const V = t.V, N = t.N;

  // Paint order. Each tile carries a <Priority> and it is a real layering order
  // (grass 10-14, roads 111-113, rocks 193-210, river bed 277). Sorting by it
  // lets the shader composite low-to-high — a road painted OVER grass — instead
  // of averaging every layer together, which dilutes each one against the base
  // and leaves the whole map washed out.
  const priCache = new Map<string, number>();
  layers = layers
    .map((l, ord) => ({ ...l, priority: tilePriority(l.path, readXdb, priCache), ord }))
    .sort((a, b) => a.priority - b.priority || a.ord - b.ord);

  const layerTex = layers.map((l): string => {
    const hit = texCache.get(l.path);
    if (hit !== undefined) return hit;
    let px = tileTexture(l.path, readXdb, data, size);
    if (!px) px = flatTexture(tileColor(l.path, readXdb, colCache) || [0.3, 0.33, 0.24], size);
    const uri = pngDataUri(size, size, px);
    texCache.set(l.path, uri);
    return uri;
  });

  const maskGroups = [];
  for (let g = 0; g * 3 < layers.length; g++) {
    const rgba = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) rgba[i * 4 + 3] = 255;
    for (let c = 0; c < 3; c++) {
      const li = g * 3 + c; if (li >= layers.length) continue;
      const m = readMask(t, layers[li]);
      for (let i = 0; i < N; i++) rgba[i * 4 + c] = m[i];
    }
    maskGroups.push(pngDataUri(V, V, rgba));
  }

  // Cliff face texture. Where the ground drops steeply (the `lower`/`plato`
  // tools leave jumps of up to 11 units across a single tile) the engine shows
  // rock, not stretched grass. One shared texture, projected vertically.
  const rockPx = tileTexture(ROCK_TILE, readXdb, data, size);
  const rockTex = rockPx ? pngDataUri(size, size, rockPx) : null;

  return { V, size, layerCount: layers.length, layerTex, maskGroups, rockTex, paths: layers.map((l) => l.path) };
}

// AdvMapTile.xdb -> its representative RGB (0..1), cached by path.
function tileColor(path: string, readXdb: ReadXdb, cache: Map<string, number[] | null>): number[] | null {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  let col: number[] | null = null;
  const xml = readXdb(path);
  if (xml) {
    const m = xml.match(/<MinimapColor>\s*<x>([-\d.]+)<\/x>\s*<y>([-\d.]+)<\/y>\s*<z>([-\d.]+)<\/z>/);
    if (m) col = [+m[1], +m[2], +m[3]];
  }
  cache.set(path, col);
  return col;
}

// ---- terrain tile palette -------------------------------------------------
// Every ground tile the game ships, for the editor's terrain brush palette —
// the same set the original editor lists under "Terra skin". Categories come
// from the folder layout under MapObjects/_(AdvMapTile) (Grass, Dirt, Sand,
// Lava, Snow, Water, Orc_Terrain, SubTerrain…).
//
// `thumb` is the tile's own texture, so the palette shows what you're painting
// with rather than a name. Tiles with no <Texture> fall back to a flat swatch
// of their MinimapColor.
const TILE_DIR = 'MapObjects/_(AdvMapTile)';
const ROCK_TILE = '/MapObjects/_(AdvMapTile)/Rock.xdb';

/**
 * @param root the mounted asset chain, or one unpacked data root
 * @param thumbSize preview edge in px (default 64)
 * @returns {{name, category, path, priority, type, thumb}[]} sorted by category, name
 */
export function listTiles(root: string | Assets, thumbSize = 64): TileInfo[] {
  const data = toAssets(root);
  // Every mounted root's copy of the folder, so a mod's own tiles are listed
  // beside the shipped ones. A tile the topmost root also has is skipped when
  // the deeper root reaches it, which is the same rule the readers follow.
  const bases = data.dirs(TILE_DIR);
  if (!bases.length) return [];
  const readXdb: ReadXdb = (href) => {
    const p = data.path(href.split('#')[0]);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const colCache = new Map<string, number[] | null>();
  const seen = new Set<string>();
  const out: TileInfo[] = [];

  const walk = (dir: string, rel: string): void => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full, rel ? `${rel}/${e.name}` : e.name); continue; }
      if (!e.name.toLowerCase().endsWith('.xdb')) continue;
      const href = `/${TILE_DIR}/${rel ? rel + '/' : ''}${e.name}`;
      if (seen.has(href)) continue;
      seen.add(href);
      const xml = readXdb(href);
      if (!xml) continue;
      let px = tileTexture(href, readXdb, data, thumbSize);
      if (!px) px = flatTexture(tileColor(href, readXdb, colCache) || [0.3, 0.33, 0.24], thumbSize);
      out.push({
        name: e.name.replace(/\.xdb$/i, ''),
        category: rel || 'Other',
        path: href,
        priority: +(xml.match(/<Priority>(-?\d+)<\/Priority>/)?.[1] ?? 0),
        type: xml.match(/<Type>(\w+)<\/Type>/)?.[1] || '',
        thumb: pngDataUri(thumbSize, thumbSize, px),
      });
    }
  };
  for (const base of bases) walk(base, '');
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return out;
}
