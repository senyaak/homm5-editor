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
// skipped (LISTED in `.skipped`, by href), never fatal — real maps reference
// thousands of assets and a few always fail to decode.
//
// By href, not by count, because a count is a number nobody can act on. A map
// saved against an earlier build of the editor's own mod pointed at
// `/Dwellings/SharpshooterPalace/…`, which that mod stopped writing when
// dwellings became one of the sixteen building classes and moved under
// `/Buildings/`. The dwelling vanished from the map, and all anyone was told
// was "no model 1" — for one object out of eleven, on a map that has no other
// way to say which.
//
// What is left here is the WALK — the map, the floors, the resolver and its
// cache. Each thing the walk needs decoded has its own module beside this one:
//
//   payload.ts       the shapes below, and what the renderer is handed
//   xdb.ts           following one href to the document it names
//   model-geom.ts    a (Model).xdb to one GeomData, materials and all
//   materials.ts     which texture a submesh wears and how it blends
//   object-effects.ts  <Effect> to particle payloads, cards and models
//   skin.ts          the bones and the idle clip, when animation is asked for
//   splat.ts         the ground: its colours, its layers, its tile palette
//   water.ts · ambient.ts   the sea sheet and the floor's lighting preset

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseTerrain, readHeights, readGroundFlags, readPassability } from '../terrain/terrain.ts';
import { toAssets } from '../game/assets.ts';
import { loadMap } from '../map/map.ts';
import { followHref, resolveHref, dirOf } from './xdb.ts';
import { terrainColors, buildSplat } from './splat.ts';
import { buildWater, riverVertices, SEA_LEVEL } from './water.ts';
import { loadAmbient } from './ambient.ts';
import { TEXTURE_CAP } from './materials.ts';
import { decodeModelGeom, mergeGeom } from './model-geom.ts';
import { effectGeom, effectParticles, effectModelGeoms, clipEffectParticles } from './object-effects.ts';
import { attachAnimation } from './skin.ts';
import type { Assets } from '../game/assets.ts';
import type { HommMap } from '../map/map.ts';
import type { Terrain } from '../terrain/terrain.ts';
import type { ReadXdb } from './xdb.ts';
import type {
  BuildSceneOptions, Floor, Footprint, GeomData, Instance, Scene, SceneAnimationOptions,
  SplatData, TileOffset, WaterData,
} from './payload.ts';

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
 * A town's exterior document — the build-stage (Model, Effect) pairs that ARE
 * its adventure-map appearance — or null for anything that is not a town.
 *
 * A town keeps its top-level `<Model>`/`<Effect>` empty and holds the real
 * content in `<Exterior><AdvMapTownExterior>`. That exterior is inline for the
 * original towns (`href="#n:inline(...)"`) but an external file for the
 * Tribes-of-the-East ones (Orc_Stronghold), so it has to be followed either
 * way. Its hrefs are written relative to the exterior's own folder, not the
 * data root — reading them flat is why the stronghold refused to place at all.
 */
function townExterior(
  sharedXml: string, sharedHref: string, data: Assets,
): { xml: string; dir: string } | null {
  if (!sharedXml.includes('<Exterior')) return null;
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const extHref = sharedXml.match(/<Exterior href="([^"]+)"/)?.[1];
  // External: a real path beside the shared. Inline (`#…`) or absent: the
  // AdvMapTownExterior block sits in the shared itself.
  if (extHref && !extHref.startsWith('#')) return followHref(data, sharedXml, sharedDir, extHref);
  return { xml: sharedXml, dir: sharedDir };
}

/**
 * The first build stage's model href — the basic town, what a freshly placed
 * one shows — resolved against the exterior's folder, or null if it has none.
 */
function townModelHref(ext: { xml: string; dir: string }): string | null {
  const upgrades = ext.xml.match(/<upgrades>([\s\S]*?)<\/upgrades>/);
  const model = upgrades?.[1]?.match(/<Model href="([^"]+)"/)?.[1];
  return model ? '/' + resolveHref(ext.dir, model) : null;
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
  /**
   * Every shared href ever asked for, in first-ask order, with the index it
   * resolved to (-1 = undecodable). Resolution is deterministic, so replaying
   * this map through a fresh resolver reproduces the same `geoms` indices —
   * which is what lets animation data be built for a scene after the fact.
   */
  index: Map<string, number>;
  /** Index into `geoms`, or -1 when the model cannot be decoded. */
  resolve: (sharedHref: string) => number;
}

/** Read one `<tag><Item><x>..</x><y>..</y></Item>…</tag>` list; `<tag/>` = none. */
export function parseTileList(xml: string, tag: string): TileOffset[] {
  const block = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!block) return [];
  const out: TileOffset[] = [];
  const re = /<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]!))) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

/**
 * A building shared's tile footprint, or null when it declares none.
 *
 * Exported because the footprint is what an object COSTS in ground, and that is
 * a question outside the renderer too: the Heroes III port places objects by
 * priority and has to know how much room each one wants before it puts it down.
 */
export function parseFootprint(sharedXml: string): Footprint | null {
  const fp: Footprint = {
    blocked: parseTileList(sharedXml, 'blockedTiles'),
    active: parseTileList(sharedXml, 'activeTiles'),
    hole: parseTileList(sharedXml, 'holeTiles'),
    passable: parseTileList(sharedXml, 'passableTiles'),
  };
  if (!fp.blocked.length && !fp.active.length && !fp.hole.length && !fp.passable.length) return null;
  return fp;
}

export function createGeomResolver(root: string | Assets, texSize = TEXTURE_CAP, options: SceneAnimationOptions = {}): GeomResolver {
  const data = toAssets(root);
  const readXdb: ReadXdb = (href) => {
    const p = data.path(href.split('#')[0]!);
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
      // A town keeps its building (and its glow) in an Exterior document rather
      // than the top-level <Model>/<Effect>: inline for the original towns, an
      // external file for the Tribes-of-the-East ones. Its models and effects
      // become the object's, so the effect chain reads from the exterior too.
      const ext = shared ? townExterior(shared, sharedHref, data) : null;
      const content = ext ? ext.xml : shared;
      // The model href: a town's first build stage (resolved against the
      // exterior's folder), otherwise the shared's top-level <Model>, written
      // from the data root. A town whose exterior is EMPTY — `<Exterior/>`,
      // the unshipped Hill_Castle — has no build stages and falls back to its
      // top-level <Model> like any other object.
      let modelRel = ext ? townModelHref(ext) : null;
      if (!modelRel) modelRel = (shared && shared.match(/<Model href="([^"]+)"/)?.[1]) || null;
      // The ghost-mode hero: GhostFSLord ships with an EMPTY <Model/> and
      // <AnimSet/> — its body is wired per class in GameMechanics/RefTables/
      // GhostMode/Classes.xdb, and every class points at the same Ghost
      // character. Resolved through that character, so the palette's ghost
      // shows the wisp the original editor shows.
      if (!modelRel && shared && /<AdvMapHeroShared/.test(shared)
        && /<Model\/>/.test(shared) && /<AnimSet\/>/.test(shared)) {
        const ch = readXdb('/Characters/Heroes/Ghost.(Character).xdb');
        const m = ch?.match(/<Model href="([^"]+)"/)?.[1];
        if (m) modelRel = '/' + resolveHref('Characters/Heroes', m);
      }
      const model = modelRel ? readXdb(modelRel) : null;
      // The object's own model. Its <Geometry href> is written relative to the
      // model's own folder as often as absolute (spell_shop.mb points at
      // "SpellShop-geom.xdb" beside it), which decodeModelGeom handles — read
      // flat, a bare name misses and the object silently meshes to nothing.
      const own = model && modelRel
        ? decodeModelGeom(model, modelRel, data, readXdb, texSize, { skin: !!options.animate })
        : null;
      if (own) { idx = geoms.length; geoms.push(own); }
      // The effect's own models come first: a teleporter's Spiral and Rune ARE
      // the object (its own model is a throwaway minimap quad), so they must land
      // even when there is no base mesh to hang them on.
      if (content) {
        for (const em of effectModelGeoms(content, sharedHref, data, readXdb, texSize)) {
          if (idx < 0) { idx = geoms.length; geoms.push(em); }
          else mergeGeom(geoms[idx]!, em);
        }
      }
      // A particle card is worth adding whether or not there is a mesh. 307
      // shipped objects are nothing but an effect, and another 257 carry one
      // ALONGSIDE a model — the anti-magic garrison wall is the second kind, so
      // taking its mesh and stopping drew the flat sparkle patch on the ground
      // and left out the glowing wall that is the whole point of it.
      if (content) {
        const card = effectGeom(content, sharedHref, data, texSize);
        if (card && idx < 0) { idx = geoms.length; geoms.push(card); }
        else if (card) mergeGeom(geoms[idx]!, card);
      }
      // The living version of the same effect: the baked particles. Attached
      // alongside the card rather than instead of it — the card is what a
      // raycast hits for the 307 objects that are nothing but an effect.
      if (content && idx >= 0) {
        const fx = effectParticles(content, sharedHref, data, texSize);
        if (fx.length) geoms[idx]!.fx = fx;
      }
      // The idle CLIP's effect on top — a creature's mist, flames, eye glow
      // (empty <Effect/> on every monster shared; the real one hangs off the
      // animation). Appended so an object carrying both keeps both. The same
      // clip's skeleton root carries the creature's display scale.
      if (shared && idx >= 0) {
        const cfx = clipEffectParticles(shared, sharedHref, data, texSize);
        if (cfx.fx.length) geoms[idx]!.fx = [...(geoms[idx]!.fx ?? []), ...cfx.fx];
        if (cfx.scale !== 1) geoms[idx]!.scale = cfx.scale;
      }
      // Only AdvMapBuildingShared declares a footprint, so this is null for
      // everything else and the renderer skips it. Attached to the geom because
      // the geom is 1:1 with the shared here (no cross-shared dedup).
      if (shared && idx >= 0) geoms[idx]!.footprint = parseFootprint(shared);
      // Bones and the idle clip last: the geom is complete by now, so the
      // binding it carries covers every vertex the renderer will draw.
      if (options.animate && shared && idx >= 0) {
        attachAnimation(geoms[idx]!, shared, sharedHref, data, readXdb, options.animationFps ?? 15,
          model && modelRel ? { xml: model, rel: modelRel } : null);
      }
    } catch { idx = -1; }
    geomIndex.set(sharedHref, idx);
    return idx;
  };
  return { geoms, index: geomIndex, resolve };
}

/**
 * @param root the mounted asset chain, or one unpacked data root (MapObjects/, bin/…)
 * @param mapXdbPath absolute path to the map's map.xdb (its folder holds GroundTerrain.bin)
 * @param opt.texSize longest side an embedded texture is reduced to (default TEXTURE_CAP)
 * @returns { map, scene, skipped (the hrefs that did not mesh), resolver } —
 *   map is the HommMap model (kept for
 *   editing) and resolver stays alive so objects placed later can be meshed
 *   without rebuilding the scene.
 *   scene = { geoms, floors:[{ name, V, heights, instances }] }. A map can have a
 *   surface floor and an underground floor; each has its OWN terrain (a separate
 *   *Terrain.bin at a different height range) and its own objects, split by the
 *   object's <Floor> field. They are distinct layers — the editor shows one at a
 *   time — so underground objects must not be dumped onto the surface terrain.
 */
export function buildScene(
  root: string | Assets, mapXdbPath: string, opt: BuildSceneOptions = {},
): { map: HommMap; skipped: string[]; scene: Scene; resolver: GeomResolver } {
  const data = toAssets(root);
  const texSize = opt.texSize || TEXTURE_CAP;
  const readXdb: ReadXdb = (href) => {
    const p = data.path(href.split('#')[0]);
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
      water: buildWater(t, opt.seaLevel ?? SEA_LEVEL, data),
      colors: terrainColors(t, readXdb, tileColorCache),
      splat: buildSplat(t, readXdb, data, tileTexCache, tileColorCache, opt.tileSize || 256),
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
  const resolver = createGeomResolver(data, texSize, { animate: opt.animate, animationFps: opt.animationFps });
  const geoms = resolver.geoms;
  const resolveGeom = resolver.resolve;

  // --- place objects onto their own floor's terrain ---
  const floorInstances: Instance[][] = [[], []];
  const skipped: string[] = [];
  for (const obj of [...map.objects, ...(opt.extraObjects ?? [])]) {
    const shared = obj.shared;
    const pos = obj.pos;
    if (!shared || !pos) { skipped.push(shared ?? `${obj.type} (no <Shared>)`); continue; }
    const gi = resolveGeom(shared);
    if (gi < 0) { skipped.push(shared); continue; }
    const floor = obj.floor === 1 && terrains[1] ? 1 : 0;
    const lights = obj.pointLights;
    floorInstances[floor].push({
      id: obj.id, type: obj.type, g: gi, shared: shared.split('#')[0],
      x: pos.x, y: pos.y, z: heightAt(floor, pos.x, pos.y), r: obj.rot || 0,
      ...(lights.length ? { lights } : {}),
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
      // Full precision, deliberately. Rounding these to 3 decimals shrank the
      // payload and quietly became an EDIT: a brush stroke works from this copy
      // (`fl.heights[v] + force`) and sends the result back, so every vertex a
      // stroke touched landed up to 0.0005 off what the file held — invisible in
      // the game, fatal to a reconstruction, and it made "the app's heights" and
      // "the file's heights" two different answers.
      heights: Array.from(t.H),
      colors: t.colors,
      flags: t.flags,
      riverVerts: t.riverVerts,
      passable: t.passable,
      water: t.water,
      splat: t.splat,
      ambient: loadAmbient(data, map.ambientLightRef(f), { readXdb, texSize }),
      instances: floorInstances[f] ?? [],
    });
  }

  return { map, skipped, scene: { geoms, floors }, resolver };
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
