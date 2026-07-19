// Scene builder — turn a map + its asset tree into renderable scene data.
//
// This is the bridge between the format layer (terrain, geometry, dds, map) and
// the 3D view. It resolves each map object to a decoded mesh + texture and emits
// a compact, JSON-serializable scene the renderer can consume directly:
//
//   { V, heights,            // terrain grid side (vertices) + height plane
//     geoms: [{pos, uv, idx, tex}],   // unique decoded meshes (+ data-URI texture)
//     instances: [{id, type, g, x, y, z, r}] }  // placed objects (g -> geoms index)
//
// `instances[].id` is the map object's Item id, so the renderer can map a picked
// mesh back to a HommMap object and edits round-trip through the model.
//
// Asset resolution chain (all pure XML hrefs, absolute from the asset root):
//   object <Shared> -> (AdvMap*Shared).xdb <Model> -> (Model).xdb (geometry uid +
//   bbox + <Texture>) -> bin/Geometries/<uid> + .dds
//
// buildScene is deliberately tolerant: objects whose assets don't resolve are
// skipped (counted in `.skipped`), never fatal — real maps reference thousands
// of assets and a few always fail to decode.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseTerrain, readHeights, readTextureLayers, readMask, readGroundFlags, readWaterPlane, readPassability, FLAG_WATER } from './terrain.ts';
import { extractMeshes, readGeometryRefFromModelXdb } from './geometry.ts';
import { decodeDDS } from './dds.ts';
import { loadMap } from './map.ts';
import type { HommMap } from './map.ts';
import type { Terrain, TextureLayer } from './terrain.ts';
import type { Mesh } from './geometry.ts';

/** Reads an asset .xdb by its href, or null when it is missing. */
type ReadXdb = (href: string) => string | null;

/**
 * How a material blends, straight from its <AlphaMode>.
 *
 * Counted across the shipped materials: ALPHA_TEST 2375, OPAQUE 1591,
 * TRANSPARENT 1049, OVERLAY 435, OVERLAY_ZWRITE 17, DECAL 4.
 */
export type AlphaMode =
  | 'AM_OPAQUE' | 'AM_ALPHA_TEST' | 'AM_TRANSPARENT'
  | 'AM_OVERLAY' | 'AM_OVERLAY_ZWRITE' | 'AM_DECAL';

/**
 * One submesh of a model, with the material it uses.
 *
 * A model's meshes are concatenated into a single vertex/index buffer, and each
 * part names the slice of `idx` it owns. The renderer turns these into geometry
 * groups with a material array, which is how a four-mesh building gets its four
 * textures without four draw-call-sized objects in the scene graph.
 */
export interface GeomPart {
  /** First index in `GeomData.idx` this part covers. */
  start: number;
  count: number;
  /** Downsampled texture as a PNG data URI, or null if unresolved. */
  tex: string | null;
  /** How this part blends, as its material declares. */
  alphaMode: AlphaMode;
  /**
   * <ProjectOnTerrain>: the part is a decal laid onto the ground rather than a
   * surface of its own. 918 of the shipped materials set it.
   */
  projectOnTerrain: boolean;
}

/** One decoded mesh, ready for the renderer. Arrays are plain JSON. */
export interface GeomData {
  pos: number[];
  /** Null when the mesh has no usable texture coordinates. */
  uv: number[] | null;
  /**
   * Normals as the model authored them, or null to compute from the faces.
   *
   * Worth carrying: averaging face normals smooths every hard edge a modeller
   * put in, which leaves a building evenly lit and flat — the shading is what
   * separates its planks, stone and rails when they all share one greyscale
   * texture, as the Abandoned Mine's do.
   */
  nrm: number[] | null;
  idx: number[];
  /** One entry per submesh, in index order; always covers all of `idx`. */
  parts: GeomPart[];
}

/** A placed object: tile position, rotation about Z, and its mesh index. */
export interface Instance {
  id: string | null;
  type: string;
  /** Index into Scene.geoms. */
  g: number;
  shared: string;
  x: number; y: number; z: number; r: number;
}

/** The sea: a flat sheet at  over every cell touching water-flagged ground. */
export interface WaterData {
  V: number;
  level: number;
  /** Vertex index of each covered cell corner (y*V + x). */
  cells: number[];
  wet: number;
  tex: string | null;
}

/** Everything the splat shader needs: tile textures plus their weight masks. */
export interface SplatData {
  V: number;
  size: number;
  layerCount: number;
  /** One PNG data URI per layer, sorted by the tile`s <Priority>. */
  layerTex: string[];
  /** Masks packed three per RGB image. */
  maskGroups: string[];
  rockTex: string | null;
  paths: string[];
}

/** One floor of a map: its terrain and the objects standing on it. */
export interface Floor {
  name: string;
  V: number;
  heights: number[];
  colors: number[] | null;
  /** Per-vertex ground kind; see readGroundFlags. Null if absent. */
  flags: number[] | null;
  /**
   * Vertices already marked in the half-tile river plane.
   *
   * The river brush sinks a bed exactly once. Without knowing what is already
   * river, a second stroke over the same water digs it again and a few passes
   * turn a stream into a canyon.
   */
  riverVerts: number[];
  /**
   * Explicit passability mask: 0 blocked, 1 walkable. The editor's Masks tab
   * writes this. Water is blocked implicitly by its flag and is normally NOT
   * recorded here, so anything showing "where can I walk" has to union the two.
   */
  passable: number[] | null;
  water: WaterData | null;
  splat: SplatData | null;
  instances: Instance[];
}

/** The renderable scene — this is the payload that crosses the IPC boundary. */
export interface Scene { geoms: GeomData[]; floors: Floor[] }

export interface BuildSceneOptions {
  /** Edge length for embedded object textures. */
  texSize?: number;
  /** Edge length for ground tile textures. */
  tileSize?: number;
  seaLevel?: number;
}

/** A ground tile in the palette, previewed from its own .dds. */
export interface TileInfo {
  name: string;
  category: string;
  path: string;
  priority: number;
  type: string;
  thumb: string;
}

/** Internal: a terrain plane set plus everything derived from it. */
interface LoadedTerrain {
  V: number;
  H: Float32Array;
  flags: number[] | null;
  riverVerts: number[];
  passable: number[] | null;
  water: WaterData | null;
  colors: number[] | null;
  splat: SplatData | null;
}


/**
 * A shared-href -> mesh resolver with its own growing geom list.
 *
 * Split out of buildScene so a single object can be resolved after the scene is
 * built: placing one from the palette must not mean decoding the whole map
 * again. The cache is part of the resolver, so asking twice for the same model
 * costs nothing and a newly placed copy of an existing object adds no geometry.
 */
export interface GeomResolver {
  /** Meshes decoded so far; `resolve` appends to this. */
  geoms: GeomData[];
  /** Index into `geoms`, or -1 when the model cannot be decoded. */
  resolve: (sharedHref: string) => number;
}

export function createGeomResolver(assetRoot: string, texSize = 128): GeomResolver {
  const readXdb: ReadXdb = (href) => {
    const p = join(assetRoot, href.split('#')[0]!);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const geoms: GeomData[] = [];
  const geomIndex = new Map<string, number>();
  const resolve = (sharedHref: string): number => {
    const hit = geomIndex.get(sharedHref);
    if (hit !== undefined) return hit;
    let idx = -1;
    try {
      const shared = readXdb(sharedHref);
      const modelHref = shared && shared.match(/<Model href="([^"]+)"/);
      const model = modelHref && readXdb(modelHref[1]!);
      const ref = model && readGeometryRefFromModelXdb(model);
      if (ref) {
        const binPath = join(assetRoot, 'bin', 'Geometries', ref.uid);
        if (existsSync(binPath)) {
          const meshes = extractMeshes(readFileSync(binPath), ref.bbox);
          if (meshes.length) idx = addGeom(geoms, meshes, model, assetRoot, texSize);
        }
      }
    } catch { idx = -1; }
    geomIndex.set(sharedHref, idx);
    return idx;
  };
  return { geoms, resolve };
}

/**
 * @param assetRoot absolute path to the unpacked data root (contains MapObjects/, bin/…)
 * @param mapXdbPath absolute path to the map's map.xdb (its folder holds GroundTerrain.bin)
 * @param opt.texSize downsample size for embedded textures (default 128)
 * @returns { map, scene, skipped, resolver } — map is the HommMap model (kept for
 *   editing) and resolver stays alive so objects placed later can be meshed
 *   without rebuilding the scene.
 *   scene = { geoms, floors:[{ name, V, heights, instances }] }. A map can have a
 *   surface floor and an underground floor; each has its OWN terrain (a separate
 *   *Terrain.bin at a different height range) and its own objects, split by the
 *   object's <Floor> field. They are distinct layers — the editor shows one at a
 *   time — so underground objects must not be dumped onto the surface terrain.
 */
export function buildScene(
  assetRoot: string, mapXdbPath: string, opt: BuildSceneOptions = {},
): { map: HommMap; skipped: number; scene: Scene; resolver: GeomResolver } {
  const texSize = opt.texSize || 128;
  const readXdb: ReadXdb = (href) => {
    const p = join(assetRoot, href.split('#')[0]);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };

  // --- map model ---
  const map = loadMap(readFileSync(mapXdbPath, 'latin1'));

  // --- terrains, one per floor (surface = 0, underground = 1) ---
  const mapDir = dirname(mapXdbPath);
  const tileColorCache = new Map();
  const tileTexCache = new Map(); // tile path -> texture data URI (shared across floors)
  const loadTerrain = (file: string): LoadedTerrain | null => {
    const p = join(mapDir, file);
    if (!existsSync(p)) return null;
    const t = parseTerrain(readFileSync(p));
    const H = readHeights(t);
    const flags = readGroundFlags(t);
    return {
      V: t.V,
      H,
      // Bit 3 marks ramp vertices — the deliberate walkable slopes. Measured
      // across every shipped map, flags carrying it sit on a slope essentially
      // always (8: 100%, 24: 97.4%, 56: 100%) against 38% for plain ground, so
      // the renderer uses it to tell a designed incline from a cut edge.
      flags: flags ? Array.from(flags) : null,
      riverVerts: riverVertices(t),
      passable: (() => { const p = readPassability(t); return p ? Array.from(p) : null; })(),
      water: buildWater(t, opt.seaLevel ?? SEA_LEVEL, assetRoot),
      colors: terrainColors(t, readXdb, tileColorCache),
      splat: buildSplat(t, readXdb, assetRoot, tileTexCache, tileColorCache, opt.tileSize || 256),
    };
  };
  const terrains = [loadTerrain('GroundTerrain.bin')];
  const ground = terrains[0];
  // Every map has a ground plane; without it nothing below can place an object,
  // and the failure used to surface as a null dereference deep in heightAt.
  if (!ground) throw new Error('GroundTerrain.bin not found next to ' + mapXdbPath);
  if (map.hasUnderground) { const u = loadTerrain('UndergroundTerrain.bin'); if (u) terrains[1] = u; }
  const heightAt = (floor: number, x: number, y: number): number => {
    const t = terrains[floor] ?? ground;
    const V = t.V;
    const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
    return t.H[iy * V + ix]!;
  };

  // --- geometry/texture resolution (cached per Shared href) ---
  const resolver = createGeomResolver(assetRoot, texSize);
  const geoms = resolver.geoms;
  const resolveGeom = resolver.resolve;

  // --- place objects onto their own floor's terrain ---
  const floorInstances: Instance[][] = [[], []];
  let skipped = 0;
  for (const obj of map.objects) {
    const shared = obj.shared;
    const pos = obj.pos;
    if (!shared || !pos) { skipped++; continue; }
    const gi = resolveGeom(shared);
    if (gi < 0) { skipped++; continue; }
    const floor = obj.floor === 1 && terrains[1] ? 1 : 0;
    floorInstances[floor].push({
      id: obj.id, type: obj.type, g: gi, shared: shared.split('#')[0],
      x: pos.x, y: pos.y, z: heightAt(floor, pos.x, pos.y), r: obj.rot || 0,
    });
  }

  const floors: Floor[] = [];
  const NAMES = ['surface', 'underground'];
  for (let f = 0; f < terrains.length; f++) {
    const t = terrains[f];
    if (!t) continue;
    floors.push({
      name: NAMES[f] ?? String(f),
      V: t.V,
      heights: Array.from(t.H, (v) => +v.toFixed(3)),
      colors: t.colors,
      flags: t.flags,
      riverVerts: t.riverVerts,
      passable: t.passable,
      water: t.water,
      splat: t.splat,
      instances: floorInstances[f] ?? [],
    });
  }

  return { map, skipped, scene: { geoms, floors }, resolver };
}

// Per-vertex ground colour: blend each texture layer's representative colour
// (the AdvMapTile <MinimapColor>) weighted by its per-vertex opacity mask. This
// paints grass/dirt/sand/water and, crucially, ROADS, in one cheap pass without
// decoding any .dds. Returns [r,g,b,…] in 0..1, or null if no layers resolved.
function terrainColors(t: Terrain, readXdb: ReadXdb, cache: Map<string, number[] | null>): number[] | null {
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
function tileTexture(tilePath: string, readXdb: ReadXdb, assetRoot: string, size: number): Uint8Array | null {
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
  const ddsPath = join(assetRoot, dirname(texXdb), dest[1]);
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
export function splatFor(raw: Buffer, assetRoot: string, tileSize = 256): SplatData | null {
  const readXdb: ReadXdb = (href) => {
    const p = join(assetRoot, href.split('#')[0]);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  return buildSplat(parseTerrain(raw), readXdb, assetRoot, new Map(), new Map(), tileSize);
}

function buildSplat(
  t: Terrain, readXdb: ReadXdb, assetRoot: string,
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
    let px = tileTexture(l.path, readXdb, assetRoot, size);
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
  const rockPx = tileTexture(ROCK_TILE, readXdb, assetRoot, size);
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

// Merge a model's submeshes into one buffer and register it as a scene geom.
/**
 * Drop a mesh that duplicates a terrain-projected one.
 *
 * A building's mound is in the file twice, as the same triangles: once opaque
 * with a fixed texture, once with ProjectOnTerrain so it takes the ground it
 * stands on. 92 of the shipped models carry such a pair — the Abandoned Mine's
 * podShape and CragShape are byte-identical in positions, UVs, indices and
 * normals, and the fixed one is textured with SubTerrain, the UNDERGROUND
 * ground. Drawing both puts an opaque slab of underground rock on the grass.
 *
 * Only the projected copy is kept, because it is the one that is right on any
 * floor: it takes whatever ground is under it, rock included. Matched on the
 * geometry rather than on the mesh name, so a model that names them differently
 * is handled the same.
 */
function dropProjectedDuplicates(meshes: Mesh[], pick: number[], mats: MaterialInfo[]): boolean[] {
  const keep = meshes.map(() => true);
  const key = (m: Mesh): string => `${m.vertexCount}:${m.triCount}:${m.indices.length}`;
  for (let i = 0; i < meshes.length; i++) {
    const projected = mats[pick[i] ?? 0]?.projectOnTerrain;
    if (!projected) continue;
    for (let j = 0; j < meshes.length; j++) {
      if (j === i || !keep[j]) continue;
      if (mats[pick[j] ?? 0]?.projectOnTerrain) continue;
      if (key(meshes[i]!) !== key(meshes[j]!)) continue;
      // Cheap key first, then confirm the positions really do coincide.
      const a = meshes[i]!.positions, b = meshes[j]!.positions;
      let same = a.length === b.length;
      for (let k = 0; same && k < a.length; k++) if (Math.abs(a[k]! - b[k]!) > 1e-6) same = false;
      if (same) keep[j] = false;
    }
  }
  return keep;
}

function addGeom(geoms: GeomData[], meshes: Mesh[], model: string, assetRoot: string, texSize: number): number {
  // Materials are resolved before the meshes are packed, because which meshes
  // survive depends on them: a copy of a terrain-projected mesh is redundant.
  const allMats = modelMaterials(model, assetRoot);
  const allPick = meshMaterialIndex(model, meshes.length, allMats.length);
  const keep = dropProjectedDuplicates(meshes, allPick, allMats);
  const pick = allPick.filter((_, i) => keep[i]);
  meshes = meshes.filter((_, i) => keep[i]);

  let vc = 0, tc = 0;
  for (const m of meshes) { vc += m.vertexCount; tc += m.indices.length; }
  const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idxs = new Uint32Array(tc);
  const nrm = new Float32Array(vc * 3);
  let vo = 0, io = 0, hasUV = true, hasNrm = true;
  for (const m of meshes) {
    pos.set(m.positions, vo * 3);
    if (m.normals.length === m.positions.length) nrm.set(m.normals, vo * 3); else hasNrm = false;
    if (m.uvs) uv.set(m.uvs, vo * 2); else hasUV = false;
    for (let i = 0; i < m.indices.length; i++) idxs[io + i] = m.indices[i] + vo;
    vo += m.vertexCount; io += m.indices.length;
  }
  const idx = geoms.length;
  // One part per mesh, each with its own material, so a building whose crag and
  // crystals are separate meshes stops being painted entirely in the first
  // texture the model happened to list.
  const mats = allMats;
  const cache = new Map<number, { uri: string; hasAlpha: boolean } | null>();
  const parts: GeomPart[] = [];
  let start = 0;
  for (let i = 0; i < meshes.length; i++) {
    const count = meshes[i]!.indices.length;
    const mi = pick[i] ?? 0;
    if (!cache.has(mi)) {
      // Without UVs a texture cannot be placed, so those parts stay untextured.
      const href = mats[mi]?.tex;
      cache.set(mi, hasUV && href ? textureDataUri(model, assetRoot, texSize, href) : null);
    }
    const t = cache.get(mi) ?? null;
    // How to blend is the material's own declaration, not a guess from the
    // texels. Reading it off the image said "this has soft edges, alpha-test
    // it", which is the wrong answer for a decal that is meant to be blended.
    parts.push({
      start, count, tex: t ? t.uri : null,
      alphaMode: mats[mi]?.alphaMode ?? 'AM_OPAQUE',
      projectOnTerrain: mats[mi]?.projectOnTerrain ?? false,
    });
    start += count;
  }
  geoms.push({
    pos: Array.from(pos, (v) => +v.toFixed(3)),
    uv: hasUV ? Array.from(uv, (v) => +v.toFixed(4)) : null,
    nrm: hasNrm ? Array.from(nrm, (v) => +v.toFixed(4)) : null,
    idx: Array.from(idxs),
    parts,
  });
  return idx;
}

// ---- texture -> downsampled RGBA PNG data URI (embeds in the scene JSON) ----
// RGBA (colour type 6) so transparency survives; foliage cutouts need the alpha.
const crcTab: number[] = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b: Uint8Array | Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function pngDataUri(w: number, h: number, rgba: Uint8Array): string {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (t: string, d: Buffer): Buffer => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(body)); return Buffer.concat([l, body, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
// --- materials -------------------------------------------------------------
//
// A model carries a LIST of materials and a list of meshes, and the two are
// joined by <MaterialQuantities>: mesh i uses the next MaterialQuantities[i]
// materials, taken in order. Extra materials at the end are simply unused.
//
// Measured over the 1260 shipped models that have both: the rule holds for
// 1259. The one exception (TerrainObjects/Grass/Mountains/MountainBig) asks for
// 3 materials while listing 2, which is a defect in the data, so the index is
// clamped to the list.
//
// Before this was decoded, every submesh was painted with the model's FIRST
// texture. On a single-material model that is right by accident; on the
// Abandoned Mine — four meshes, four materials — it put the gold-mine texture
// on the crystals, the mound and the crag alike.

/** A material as the renderer needs it: what to draw and how to blend it. */
interface MaterialInfo {
  tex: string | null;
  alphaMode: AlphaMode;
  projectOnTerrain: boolean;
}

const NO_MATERIAL: MaterialInfo = { tex: null, alphaMode: 'AM_OPAQUE', projectOnTerrain: false };

/** Read one material, following an external <Item href> when it is not inline. */
function materialInfo(itemXml: string, assetRoot: string): MaterialInfo {
  const read = (xml: string): MaterialInfo => ({
    tex: xml.match(/<Texture href="([^"]*)"/)?.[1] ?? null,
    alphaMode: (xml.match(/<AlphaMode>([^<]*)<\/AlphaMode>/)?.[1] ?? 'AM_OPAQUE') as AlphaMode,
    projectOnTerrain: /<ProjectOnTerrain>\s*true\s*<\/ProjectOnTerrain>/.test(xml),
  });
  if (/<Material\b/.test(itemXml)) return read(itemXml);
  // Not inline: the Item itself points at a (Material).xdb elsewhere. The
  // Abandoned Mine's crag is one of these, and reading only inline materials
  // missed it entirely.
  const ext = itemXml.match(/^\s*href="([^"]+)"/);
  if (!ext || !ext[1]) return NO_MATERIAL;
  try {
    const p = join(assetRoot, ext[1].split('#')[0]!);
    return existsSync(p) ? read(readFileSync(p, 'utf8')) : NO_MATERIAL;
  } catch { return NO_MATERIAL; }
}

/** Every material, in the order <Materials> lists them. */
function modelMaterials(model: string, assetRoot: string): MaterialInfo[] {
  const open = model.indexOf('<Materials>');
  const close = model.indexOf('</Materials>');
  if (open < 0 || close < 0) return [];
  // A <Material> body has no nested <Item>, so splitting on <Item is safe here.
  const parts = model.slice(open + 11, close).split(/<Item\b/).slice(1);
  return parts.map((p) => materialInfo(p, assetRoot));
}

/**
 * Which material each mesh uses, from <MaterialQuantities>.
 *
 * A mesh that consumes several materials is given the first of them: our
 * decoder emits one mesh per <MeshNames> entry, so there is no finer split to
 * hang the rest on. 407 of 2281 models have such a mesh, so this is a real
 * approximation and not a corner case — but one texture chosen from the right
 * group beats one texture chosen for the whole model.
 */
function meshMaterialIndex(model: string, meshCount: number, materialCount: number): number[] {
  const mq = model.match(/<MaterialQuantities>([\s\S]*?)<\/MaterialQuantities>/);
  const q = mq ? [...mq[1]!.matchAll(/<Item>(\d+)<\/Item>/g)].map((m) => +m[1]!) : [];
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < meshCount; i++) {
    out.push(Math.min(at, Math.max(0, materialCount - 1)));
    at += q[i] ?? 1;
  }
  return out;
}

function textureDataUri(model: string, assetRoot: string, size: number, href?: string): { uri: string; hasAlpha: boolean } | null {
  try {
    const t = href ? [href, href] : model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const tx = readFileSync(join(assetRoot, t[1].split('#')[0]), 'utf8');
    const dest = tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const ddsPath = join(assetRoot, dirname(t[1].split('#')[0]), dest[1]);
    if (!existsSync(ddsPath)) return null;
    const img = decodeDDS(ddsPath);
    const out = new Uint8Array(size * size * 4);
    let hasAlpha = false;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = x * img.width / size | 0, sy = y * img.height / size | 0, si = (sy * img.width + sx) * 4, o = (y * size + x) * 4;
      out[o] = img.rgba[si]; out[o + 1] = img.rgba[si + 1]; out[o + 2] = img.rgba[si + 2];
      const a = img.rgba[si + 3]; out[o + 3] = a;
      if (a < 200) hasAlpha = true;
    }
    return { uri: pngDataUri(size, size, out), hasAlpha };
  } catch { return null; }
}

// ---- water surface --------------------------------------------------------
// There are two distinct kinds of water in this engine, and only one of them is
// a texture. "Rivers" (Bog / LavaFlow / Water) are TILE BRUSHES painted onto
// whatever the ground already is. The Terraforming `water` tool instead DIGS a
// basin, which the engine then fills to a flat level.
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
// Sea level. `lower` digs the bed to exactly 0 while ordinary ground stays at
// the 2.0 default, and the editor lays a shore ring at exactly 1.6 between them
// (90 vertices of it on map 12). That ring is the beach, so the surface has to
// sit just UNDER it — at 1.6 the ring submerges and the brown rim the original
// editor shows above the waterline disappears.
// Not recorded anywhere in the format, so it stays tunable from the toolbar.
const SEA_LEVEL = 1.5;

// The sea's own sheet. Water.dds is CLAMP and near-black by design — the game's
// sea reads dark, while rivers painted with the _TNL brushes read blue. Loaded
// straight rather than through tileTexture, which deliberately swaps CLAMP
// textures out for their tiling siblings.
const SEA_TEXTURE = '/Textures/Terrain/Water/Water.dds';

function seaTexture(assetRoot: string, size: number): string | null {
  try {
    const p = join(assetRoot, SEA_TEXTURE);
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
function riverVertices(t: Terrain): number[] {
  const r = readWaterPlane(t);
  if (!r) return [];
  const out: number[] = [];
  for (let y = 0; y < t.V; y++) for (let x = 0; x < t.V; x++) {
    if (r.data[(2 * y) * r.W + 2 * x]!) out.push(y * t.V + x);
  }
  return out;
}

function buildWater(t: Terrain, level: number, assetRoot: string): WaterData | null {
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
  return { V, level, cells, wet, tex: seaTexture(assetRoot, 256) };
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
 * @param assetRoot unpacked data root
 * @param thumbSize preview edge in px (default 64)
 * @returns {{name, category, path, priority, type, thumb}[]} sorted by category, name
 */
export function listTiles(assetRoot: string, thumbSize = 64): TileInfo[] {
  const base = join(assetRoot, TILE_DIR);
  if (!existsSync(base)) return [];
  const readXdb: ReadXdb = (href) => {
    const p = join(assetRoot, href.split('#')[0]);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const colCache = new Map<string, number[] | null>();
  const out: TileInfo[] = [];

  const walk = (dir: string, rel: string): void => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full, rel ? `${rel}/${e.name}` : e.name); continue; }
      if (!e.name.toLowerCase().endsWith('.xdb')) continue;
      const href = `/${TILE_DIR}/${rel ? rel + '/' : ''}${e.name}`;
      const xml = readXdb(href);
      if (!xml) continue;
      let px = tileTexture(href, readXdb, assetRoot, thumbSize);
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
  walk(base, '');
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return out;
}

// Find the asset root (folder holding MapObjects/ and bin/) by walking up from a
// map.xdb path. Returns null if not found within a few levels.
export function findAssetRoot(mapXdbPath: string): string | null {
  let dir = dirname(mapXdbPath);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'MapObjects')) || existsSync(join(dir, 'bin', 'Geometries'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
