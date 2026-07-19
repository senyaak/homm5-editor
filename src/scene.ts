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
   * The part is a decal lying ON the ground: its material sets
   * <ProjectOnTerrain> AND the mesh is actually flat.
   *
   * The flatness test is not redundant. Measured over the shipped models, 393
   * parts carry the flag and the extreme is three times TALLER than it is wide.
   * So the flag alone does not mean "this lies on the ground", and treating it
   * that way sent a 10-unit mountain through the decal path — which sampled the
   * ground by world XY and smeared one column of texels up every cliff face,
   * the stripes and black wedges Senya reported on Mountain10x10.
   */
  projectOnTerrain: boolean;
  /**
   * The mesh lies flat, whatever its material says about projecting.
   *
   * Kept for the ProjectOnTerrain nudge only. It is NOT what decides depth
   * writing: flatness fails to tell a solid mountain from a feathered mound —
   * Mountain10x10 (h/span 0.505) and the Abandoned Mine's hill (0.284) are both
   * non-flat AM_OVERLAY bodies, yet one must occlude and the other must not.
   */
  flat: boolean;
  /**
   * The texture is a solid skin: most of its texels are opaque.
   *
   * This, not flatness, is what decides whether a blended part writes depth.
   * Measured on the two AM_OVERLAY cases that looked identical by every other
   * signal: Mountain10x10's rock is 96% opaque — a body that must occlude — while
   * the mine's GoldMineHill is 11% opaque and near-black, a layer meant to be
   * blended over the terrain it is projected onto. Writing depth for the mound
   * punched a hole: its near-invisible pixels occluded the ground behind it, so
   * the back showed through as if the earth were not there.
   */
  opaque: boolean;
  /**
   * This part takes the TERRAIN it stands on as its surface: the renderer
   * shades it with the same ground splat the terrain uses, sampled at the
   * part's own world position, with the part's own texture applied on top as a
   * darkening. That is what the engine does for the Abandoned Mine's mound — the
   * map's grass climbs up the hump — which Senya confirmed against the original.
   *
   * The signal is `<ProjectOnTerrain>` AND a sheer texture. The flag alone is
   * not enough: 393 shipped parts carry it, most of them solid bodies, and
   * projecting the ground onto Mountain10x10 (a 96%-opaque proj part) smeared
   * one column of texels up its cliffs. But a proj part whose texture is a sheer
   * overlay (the mound's GoldMineHill, 11% opaque) is exactly the take-the-
   * ground case, and opacity separates the two with a wide margin.
   */
  terrainProjected: boolean;
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


// --- effects ---------------------------------------------------------------
//
// Some objects have no mesh at all: `<Model/>` is empty and everything visible
// about them is a particle effect. The anti-magic garrison wall is one, and it
// is not a corner case — 616 shipped objects reference an effect and 319 of
// those have no model, so they were simply absent from the scene.
//
// A faithful particle system is a large piece of work and the wrong one for a
// map editor: what an editor needs is for the thing to be visible, selectable
// and movable. So an effect becomes a textured card, using the effect's OWN
// texture at the size the particle declares — recognisable at a glance, and
// honest about being a stand-in.
//
//   Shared -> Effect -> Instances[] -> ParticleInstance -> Textures[] + Particle
//
// The Particle's <Bound> is 28 bytes of hex: seven floats, centre then size
// then radius, confirmed on all 1055 shipped particles (the radius matches the
// half-diagonal of the size). Only the SIZE is used. The centre is in the
// coordinates of whatever scene the effect was authored in — the siege effects
// sit around (320, 284) — so honouring it would fling half the placeholders
// across the map.

/** Size of a particle's bounding box, from the hex-packed <Bound>. */
function particleBound(xml: string): [number, number, number] | null {
  const hex = xml.match(/<Bound>([0-9a-fA-F]{56})<\/Bound>/)?.[1];
  if (!hex) return null;
  const b = Buffer.from(hex, 'hex');
  return [b.readFloatLE(12), b.readFloatLE(16), b.readFloatLE(20)];
}

/**
 * A stand-in card for an object whose only content is an effect.
 *
 * Returns null when the chain does not lead to a texture, so the object stays
 * skipped rather than becoming an untextured rectangle.
 */
function effectGeom(
  sharedXml: string, sharedHref: string, assetRoot: string, texSize: number,
): GeomData | null {
  const read = (rel: string): string | null => {
    try {
      const p = join(assetRoot, rel);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    } catch { return null; }
  };
  /**
   * Follow one href from a file, honouring the inline form.
   *
   * `href="#n:inline(ParticleInstance)"` means the thing is written INSIDE the
   * file that points at it — the same convention map.xdb uses for its objects.
   * Treating that as a path is why most of these chains dead-ended: 249 of the
   * 307 effect-only objects failed at exactly this step.
   */
  const follow = (xml: string, dir: string, href: string): { xml: string; dir: string } | null => {
    if (href.startsWith('#')) return { xml, dir };
    const rel = resolveHref(dir, href);
    const doc = read(rel);
    return doc ? { xml: doc, dir: dirOf(rel) } : null;
  };

  const effHref = sharedXml.match(/<Effect href="([^"]+)"/)?.[1];
  if (!effHref) return null;
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const effect = follow(sharedXml, sharedDir, effHref);
  if (!effect) return null;

  // The first instance is enough for a placeholder; effects that layer several
  // are still one object on the map.
  const instHref = effect.xml.match(/<Instances>[\s\S]*?<Item href="([^"]+)"/)?.[1];
  if (!instHref) return null;
  const instance = follow(effect.xml, effect.dir, instHref);
  if (!instance) return null;
  const inst = instance.xml;

  const texHref = inst.match(/<Textures>[\s\S]*?<Item href="([^"]+)"/)?.[1];
  if (!texHref) return null;
  const texRel = resolveHref(instance.dir, texHref);
  const t = textureDataUri('', assetRoot, texSize, '/' + texRel);
  if (!t) return null;

  const partHref = inst.match(/<Particle href="([^"]+)"/)?.[1];
  const particle = partHref ? follow(inst, instance.dir, partHref) : null;
  const part = particle?.xml ?? null;
  const bound = part ? particleBound(part) : null;
  const scale = +(inst.match(/<Scale>([\d.]+)<\/Scale>/)?.[1] ?? 1) || 1;
  // A default that reads as "something is here" when the particle declares no
  // useful extent.
  const w = Math.max(0.5, Math.min(12, (bound ? Math.max(bound[0], bound[1]) : 2) * scale));
  const h = Math.max(0.5, Math.min(12, (bound ? bound[2] : 2) * scale));

  // A vertical card standing on the object's origin: most of these are glows
  // and columns, and a card lying flat would be hidden by the ground.
  const hw = w / 2;
  return {
    pos: [-hw, 0, 0, hw, 0, 0, hw, 0, h, -hw, 0, h],
    uv: [0, 1, 1, 1, 1, 0, 0, 0],
    nrm: [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    idx: [0, 1, 2, 0, 2, 3],
    parts: [{ start: 0, count: 6, tex: t.uri, alphaMode: 'AM_TRANSPARENT', projectOnTerrain: false, flat: false, opaque: false, terrainProjected: false }],
  };
}

/**
 * Append an effect card to a model that already has geometry.
 *
 * The card becomes one more part, so it keeps its own texture and its own
 * blending without disturbing the mesh's.
 */
function appendCard(into: GeomData, card: GeomData): void {
  const base = into.pos.length / 3;
  into.pos.push(...card.pos);
  // A geom is only textured if EVERY part has coordinates, so a card joining a
  // model without them cannot introduce a half-filled array.
  if (into.uv && card.uv) into.uv.push(...card.uv);
  else into.uv = null;
  if (into.nrm && card.nrm) into.nrm.push(...card.nrm);
  else into.nrm = null;
  const start = into.idx.length;
  for (const i of card.idx) into.idx.push(i + base);
  into.parts.push({ ...card.parts[0]!, start, count: card.idx.length });
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
      const ref = model && readGeometryRefFromModelXdb(model, readXdb);
      if (ref) {
        const binPath = join(assetRoot, 'bin', 'Geometries', ref.uid);
        if (existsSync(binPath)) {
          const meshes = extractMeshes(readFileSync(binPath), ref.bbox);
          if (meshes.length) idx = addGeom(geoms, meshes, model, modelHref[1]!, assetRoot, texSize);
        }
      }
      // An effect is worth a card whether or not there is also a mesh. 307
      // shipped objects are nothing but an effect, and another 257 carry one
      // ALONGSIDE a model — the anti-magic garrison wall is the second kind, so
      // taking its mesh and stopping drew the flat sparkle patch on the ground
      // and left out the glowing wall that is the whole point of it.
      if (shared) {
        const card = effectGeom(shared, sharedHref, assetRoot, texSize);
        if (card && idx < 0) { idx = geoms.length; geoms.push(card); }
        else if (card) appendCard(geoms[idx]!, card);
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
 * Is this mesh flat enough to be a decal lying on the ground?
 *
 * Height against the larger of its two footprint spans. Used for one thing: a
 * surface lying ON the ground is coplanar with it and z-fights, so it wants a
 * depth nudge, and a solid body does not.
 *
 * Measured over every part whose material sets ProjectOnTerrain, the ratios run
 * from 0 (a quarter are below 0.077) to past 3.0, so the flag alone says
 * nothing about flatness. 0.15 keeps the nudge for things that really are
 * coplanar; a mine's mound at 0.284 and an 8x8 mountain at 0.340 are both
 * bodies sitting on the ground, not decals painted onto it, and neither needs
 * it.
 */
function isFlat(m: Mesh): boolean {
  const p = m.positions;
  if (!p.length) return false;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    xmin = Math.min(xmin, p[i]!); xmax = Math.max(xmax, p[i]!);
    ymin = Math.min(ymin, p[i + 1]!); ymax = Math.max(ymax, p[i + 1]!);
    zmin = Math.min(zmin, p[i + 2]!); zmax = Math.max(zmax, p[i + 2]!);
  }
  const span = Math.max(xmax - xmin, ymax - ymin);
  return span > 1e-6 && (zmax - zmin) / span < 0.15;
}

/**
 * Drop meshes that duplicate another one's geometry.
 *
 * 104 of the shipped models contain the same triangles twice, and drawing both
 * copies means two coplanar surfaces fighting over every pixel. The pairs come
 * in two shapes, and neither wants both copies drawn:
 *
 *  - 75 pairs are the model's own texture against `SubTerrain`, the UNDERGROUND
 *    ground — the Abandoned Mine's podShape and CragShape, byte-identical in
 *    positions, UVs, indices and normals. The authored texture is the visible
 *    one; the SubTerrain copy is what the object looks like on the rock floor.
 *  - 17 pairs carry the SAME texture twice under different alpha modes
 *    (AM_OVERLAY plus AM_TRANSPARENT). That is one surface the engine draws in
 *    two passes, not two surfaces.
 *
 * So: keep exactly one copy, preferring the one that is not textured with the
 * shared SubTerrain image. Only those two shapes are dropped — coincident
 * meshes carrying two DIFFERENT authored textures are left alone, because
 * nothing measured says they are redundant rather than two blended layers.
 *
 * Matched on the geometry rather than on the mesh name, so a model that names
 * them differently is handled the same. Two copies are "the same" when they
 * share a topology — identical index arrays — and their vertices sit within a
 * tenth of the model's diagonal of each other. Demanding EXACT positions was
 * too strict and is what left Mountain10x10 broken: its underground shell is
 * the same 448 vertices and 662 triangles under the same indices and the same
 * UVs, merely pushed out by up to one unit on a twenty-unit model, and the
 * dark grey copy swallowed the textured one whole.
 */
function dropDuplicateMeshes(meshes: Mesh[], pick: number[], mats: MaterialInfo[], sheer: (i: number) => boolean, projected: (i: number) => boolean): boolean[] {
  const keep = meshes.map(() => true);
  const tex = (i: number): string => mats[pick[i] ?? 0]?.tex ?? '';
  const isSub = (i: number): boolean => /SubTerrain/i.test(tex(i));
  const coincident = (a: Mesh, b: Mesh): boolean => {
    if (a.positions.length !== b.positions.length || a.indices.length !== b.indices.length) return false;
    for (let k = 0; k < a.indices.length; k++) if (a.indices[k] !== b.indices[k]) return false;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let far = 0;
    for (let k = 0; k < a.positions.length; k += 3) {
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c]!, a.positions[k + c]!);
        hi[c] = Math.max(hi[c]!, a.positions[k + c]!);
      }
      far = Math.max(far, Math.hypot(
        a.positions[k]! - b.positions[k]!,
        a.positions[k + 1]! - b.positions[k + 1]!,
        a.positions[k + 2]! - b.positions[k + 2]!,
      ));
    }
    const diag = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) || 1;
    return far / diag <= 0.1;
  };
  for (let i = 0; i < meshes.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < meshes.length; j++) {
      if (!keep[j] || !coincident(meshes[i]!, meshes[j]!)) continue;
      if (isSub(i) !== isSub(j)) {
        // A SubTerrain copy is usually the underground skin of the authored
        // surface — redundant on the surface, so the authored one wins (a
        // mountain's rock beats its grey shell). Two exceptions turn on what the
        // authored partner is:
        //  - a terrain-PROJECTED sheer overlay (the mine's GoldMineHill) becomes
        //    an opaque grass mound in its own right, so its SubTerrain twin is
        //    redundant again — drop it, exactly as for a solid body.
        //  - a sheer overlay that is NOT projected has no body of its own, so the
        //    SubTerrain copy IS the solid ground it is painted onto — keep both.
        const authored = isSub(i) ? j : i;
        const sub = isSub(i) ? i : j;
        if (projected(authored) || !sheer(authored)) keep[sub] = false;
      }
      else if (tex(i) === tex(j)) keep[j] = false;                 // one surface, two passes
      if (!keep[i]) break;
    }
  }
  return keep;
}

function addGeom(geoms: GeomData[], meshes: Mesh[], model: string, modelHref: string, assetRoot: string, texSize: number): number {
  // Materials are resolved before the meshes are packed, because which meshes
  // survive depends on them: a copy of a terrain-projected mesh is redundant.
  const modelDir = dirOf(resolveHref('', modelHref));
  const allMats = modelMaterials(model, assetRoot, modelDir);
  const allPick = meshMaterialIndex(model, meshes.length, allMats.length);
  // Decode each material's texture once, up front: the dedup needs to know how
  // opaque the authored partner of a SubTerrain pair is (a sheer overlay is not
  // a body, so its SubTerrain base survives), and the parts loop needs the same
  // images afterwards. Opacity is a property of the texture, not the UVs, so it
  // is read here whether or not the mesh ends up with usable UVs.
  const texInfo = new Map<number, { uri: string; hasAlpha: boolean; opaque: boolean } | null>();
  const infoFor = (mi: number): { uri: string; hasAlpha: boolean; opaque: boolean } | null => {
    if (!texInfo.has(mi)) {
      const href = allMats[mi]?.tex;
      texInfo.set(mi, href ? textureDataUri(model, assetRoot, texSize, href) : null);
    }
    return texInfo.get(mi) ?? null;
  };
  // A part is a sheer overlay when its material blends AND its texture is mostly
  // transparent — detail painted over a body, not the body itself.
  const sheer = (meshIdx: number): boolean => {
    const mi = allPick[meshIdx] ?? 0;
    const mode = allMats[mi]?.alphaMode ?? 'AM_OPAQUE';
    const blended = mode === 'AM_OVERLAY' || mode === 'AM_TRANSPARENT' || mode === 'AM_DECAL';
    const info = infoFor(mi);
    return blended && !!info && !info.opaque;
  };
  // A part takes the terrain as its surface when its material declares
  // <ProjectOnTerrain> AND its texture is a sheer overlay. The projected shading
  // is opaque and IS the body, so its coincident SubTerrain twin is redundant.
  const projected = (meshIdx: number): boolean =>
    (allMats[allPick[meshIdx] ?? 0]?.projectOnTerrain ?? false) && sheer(meshIdx);
  const keep = dropDuplicateMeshes(meshes, allPick, allMats, sheer, projected);
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
  const parts: GeomPart[] = [];
  let start = 0;
  for (let i = 0; i < meshes.length; i++) {
    const count = meshes[i]!.indices.length;
    const mi = pick[i] ?? 0;
    const t = infoFor(mi);
    const alphaMode: AlphaMode = mats[mi]?.alphaMode ?? 'AM_OPAQUE';
    const flat = isFlat(meshes[i]!);
    const blended = alphaMode === 'AM_OVERLAY' || alphaMode === 'AM_TRANSPARENT' || alphaMode === 'AM_DECAL';
    const isSheer = blended && !!t && !t.opaque;
    // How to blend is the material's own declaration, not a guess from the
    // texels. Reading it off the image said "this has soft edges, alpha-test
    // it", which is the wrong answer for a decal that is meant to be blended.
    // Without UVs a texture cannot be placed, so those parts stay untextured —
    // but the opacity read still stands, since it does not need UVs.
    parts.push({
      start, count, tex: hasUV && t ? t.uri : null,
      alphaMode,
      projectOnTerrain: (mats[mi]?.projectOnTerrain ?? false) && flat,
      flat,
      // No texture means nothing to read alpha from — an untextured body is
      // solid, so it occludes.
      opaque: t ? t.opaque : true,
      terrainProjected: (mats[mi]?.projectOnTerrain ?? false) && isSheer,
    });
    start += count;
  }
  geoms.push({
    // Left in the world units the file is authored in. The renderer builds its
    // world in those units too, so nothing here has to be converted.
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

/**
 * Resolve an asset href the way the game's own references are written.
 *
 * An href beginning with `/` is from the data root; anything else is relative to
 * the file that wrote it. The split is not even: 5469 of the material
 * references in the shipped models are relative against 2019 absolute, and 6009
 * of the texture references inside materials against 3461. Reading a relative
 * href as absolute finds nothing at all, which is how the Alchemist Lab came
 * out as untextured grey.
 *
 * @param baseDir directory of the file the href was read from, data-root relative
 */
function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0]!;
  if (clean.startsWith('/')) return clean.slice(1);
  const out = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

/** Directory part of a data-root-relative path. */
function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/**
 * Read one material, following an external <Item href> when it is not inline.
 *
 * @param baseDir where the model lives, for hrefs written relative to it
 */
function materialInfo(itemXml: string, assetRoot: string, baseDir: string): MaterialInfo {
  const read = (xml: string, from: string): MaterialInfo => {
    const tex = xml.match(/<Texture href="([^"]*)"/)?.[1];
    return {
      // A texture href is relative to the MATERIAL, which is not always beside
      // the model that named it.
      tex: tex ? '/' + resolveHref(from, tex) : null,
      alphaMode: (xml.match(/<AlphaMode>([^<]*)<\/AlphaMode>/)?.[1] ?? 'AM_OPAQUE') as AlphaMode,
      projectOnTerrain: /<ProjectOnTerrain>\s*true\s*<\/ProjectOnTerrain>/.test(xml),
    };
  };
  if (/<Material\b/.test(itemXml)) return read(itemXml, baseDir);
  // Not inline: the Item itself points at a (Material).xdb elsewhere. The
  // Abandoned Mine's crag is one of these, and reading only inline materials
  // missed it entirely.
  const ext = itemXml.match(/^\s*href="([^"]+)"/);
  if (!ext || !ext[1]) return NO_MATERIAL;
  try {
    const rel = resolveHref(baseDir, ext[1]);
    const p = join(assetRoot, rel);
    return existsSync(p) ? read(readFileSync(p, 'utf8'), dirOf(rel)) : NO_MATERIAL;
  } catch { return NO_MATERIAL; }
}

/** Every material, in the order <Materials> lists them. */
function modelMaterials(model: string, assetRoot: string, baseDir: string): MaterialInfo[] {
  const open = model.indexOf('<Materials>');
  const close = model.indexOf('</Materials>');
  if (open < 0 || close < 0) return [];
  // A <Material> body has no nested <Item>, so splitting on <Item is safe here.
  const parts = model.slice(open + 11, close).split(/<Item\b/).slice(1);
  return parts.map((p) => materialInfo(p, assetRoot, baseDir));
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

function textureDataUri(model: string, assetRoot: string, size: number, href?: string): { uri: string; hasAlpha: boolean; opaque: boolean } | null {
  try {
    const t = href ? [href, href] : model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const tx = readFileSync(join(assetRoot, t[1].split('#')[0]), 'utf8');
    const dest = tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const ddsPath = join(assetRoot, dirname(t[1].split('#')[0]), dest[1]);
    if (!existsSync(ddsPath)) return null;
    const img = decodeDDS(ddsPath);
    const out = new Uint8Array(size * size * 4);
    let hasAlpha = false, solidTexels = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = x * img.width / size | 0, sy = y * img.height / size | 0, si = (sy * img.width + sx) * 4, o = (y * size + x) * 4;
      out[o] = img.rgba[si]; out[o + 1] = img.rgba[si + 1]; out[o + 2] = img.rgba[si + 2];
      const a = img.rgba[si + 3]; out[o + 3] = a;
      if (a < 200) hasAlpha = true;
      if (a > 128) solidTexels++;
    }
    // Half the texels opaque is far from either measured case (a solid rock
    // skin sits at 96%, a feathered overlay at 11%), so where the line lands
    // between them does not matter.
    return { uri: pngDataUri(size, size, out), hasAlpha, opaque: solidTexels > size * size * 0.5 };
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
