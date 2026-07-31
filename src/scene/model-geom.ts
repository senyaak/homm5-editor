// A model document turned into one GeomData: its meshes concatenated, each
// group given the material the model declares for it, and the whole thing
// merged into whatever the caller is already building.
//
// This is the step every path through the scene builder shares — placed
// objects, the objects inside an effect, and the palette's previews all end
// here — so the drift the split turned up (two copies of the mesh walk) has
// one home now.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractMeshes, readGeometryRefFromModelXdb } from './geometry.ts';
import { modelMaterials, declaredGroups, textureDataUri } from './materials.ts';
import { resolveHref, dirOf } from './xdb.ts';
import type { Assets } from '../game/assets.ts';
import type { Mesh, MeshOptions } from './geometry.ts';
import type { MaterialInfo } from './materials.ts';
import type { ReadXdb } from './xdb.ts';
import type { GeomData, GeomPart, AlphaMode } from './payload.ts';


/**
 * Rotate, scale and translate a geom in place by a ModelInstance transform.
 * Positions take the full transform; normals take only the rotation.
 */
export function transformGeom(
  g: GeomData, pos: [number, number, number], q: [number, number, number, number], scale: number,
): void {
  const [qx, qy, qz, qw] = q;
  // v' = v + 2·qw·(q×v) + 2·(q×(q×v)) — the standard quaternion-rotates-vector form.
  const rot = (x: number, y: number, z: number): [number, number, number] => {
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [
      x + qw * tx + (qy * tz - qz * ty),
      y + qw * ty + (qz * tx - qx * tz),
      z + qw * tz + (qx * ty - qy * tx),
    ];
  };
  for (let i = 0; i < g.pos.length; i += 3) {
    const [x, y, z] = rot(g.pos[i]! * scale, g.pos[i + 1]! * scale, g.pos[i + 2]! * scale);
    g.pos[i] = x + pos[0]; g.pos[i + 1] = y + pos[1]; g.pos[i + 2] = z + pos[2];
  }
  if (g.nrm) for (let i = 0; i < g.nrm.length; i += 3) {
    const [x, y, z] = rot(g.nrm[i]!, g.nrm[i + 1]!, g.nrm[i + 2]!);
    g.nrm[i] = x; g.nrm[i + 1] = y; g.nrm[i + 2] = z;
  }
}

/** Append every part of `add` onto `into`, offsetting vertex indices. */
export function mergeGeom(into: GeomData, add: GeomData): void {
  const base = into.pos.length / 3;
  const idxBase = into.idx.length;
  for (const v of add.pos) into.pos.push(v);
  // A geom counts as textured only if EVERY part carries UVs, so a part without
  // them drops the whole geom to untextured rather than leaving a ragged array.
  if (into.uv && add.uv) for (const v of add.uv) into.uv.push(v); else into.uv = null;
  if (into.nrm && add.nrm) for (const v of add.nrm) into.nrm.push(v); else into.nrm = null;
  for (const i of add.idx) into.idx.push(i + base);
  for (const p of add.parts) into.parts.push({ ...p, start: p.start + idxBase });
  // The skin arrays run one entry per vertex, so anything appended has to be
  // bound too or the buffers no longer line up with the positions. What gets
  // merged in is an effect's own geometry — a brazier's flame, a portal's glow —
  // which has no bones of its own, so it is pinned to the root bone: it then
  // rides the object as a whole, which is what an effect attached to a creature
  // does anyway. Weight 1 on bone 0, the rest zero.
  if (into.skin) {
    const added = add.pos.length / 3;
    for (let v = 0; v < added; v++) {
      into.skin.index.push(0, 0, 0, 0);
      into.skin.weight.push(1, 0, 0, 0);
    }
  }
}

/**
 * Decode a Model xdb into a standalone geom (its own meshes, materials and
 * textures), or null when it has no usable geometry. Shared by an object's own
 * model and by the models an effect layers on top of it — the same decode, just
 * a different source of the href.
 *
 * @param modelHref the model's data-root-relative href, for resolving the
 *   geometry and material references written relative to the model's folder
 */
export function decodeModelGeom(
  model: string, modelHref: string, data: Assets, readXdb: ReadXdb, texSize: number,
  meshOptions: MeshOptions = {},
): GeomData | null {
  const modelDir = dirOf(resolveHref('', modelHref));
  const readRel: ReadXdb = (href) =>
    readXdb(href.startsWith('/') || href.startsWith('#') ? href : resolveHref(modelDir, href));
  const ref = readGeometryRefFromModelXdb(model, readRel);
  if (!ref) return null;
  const binPath = data.path(join('bin', 'Geometries', ref.uid));
  if (!existsSync(binPath)) return null;
  const meshes = extractMeshes(readFileSync(binPath), ref.bbox, meshOptions);
  if (!meshes.length) return null;
  const tmp: GeomData[] = [];
  const i = addGeom(tmp, meshes, model, modelHref, data, texSize, ref.doc);
  return i >= 0 ? tmp[i]! : null;
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
  // A looser match, for flat ground pads only. The SubTerrain pad and the
  // authored surface can be the SAME quad welded differently: the mine's are
  // byte-identical, but the Black Market's carry the same 16 triangles under 13
  // and 18 vertices, so identical index arrays miss them and both draw — two
  // coplanar pads on the terrain, the flicker Senya saw under the artifact
  // merchant. When two flat meshes share a triangle count and a bounding box,
  // they are the same pad. Safe next to `coincident` because the keep-decision
  // below only drops a SubTerrain copy or a same-texture one; two DIFFERENT
  // authored textures still keep both.
  const bounds = (m: Mesh): [number[], number[]] => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.positions.length; k += 3) for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c]!, m.positions[k + c]!);
      hi[c] = Math.max(hi[c]!, m.positions[k + c]!);
    }
    return [lo, hi];
  };
  const coincidentPad = (a: Mesh, b: Mesh): boolean => {
    if (a.indices.length !== b.indices.length || !isFlat(a) || !isFlat(b)) return false;
    const [la, ha] = bounds(a), [lb, hb] = bounds(b);
    const diag = Math.hypot(ha[0]! - la[0]!, ha[1]! - la[1]!, ha[2]! - la[2]!) || 1;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(la[c]! - lb[c]!) > 0.1 * diag || Math.abs(ha[c]! - hb[c]!) > 0.1 * diag) return false;
    }
    return true;
  };
  for (let i = 0; i < meshes.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < meshes.length; j++) {
      if (!keep[j] || !(coincident(meshes[i]!, meshes[j]!) || coincidentPad(meshes[i]!, meshes[j]!))) continue;
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

/**
 * @param geomDoc the `<Geometry>` element the meshes were resolved from — the
 *   home of <MaterialQuantities>, which for an external geometry is absent
 *   from the model xml itself. Defaults to the model for callers that predate
 *   the split.
 */
export function addGeom(geoms: GeomData[], meshes: Mesh[], model: string, modelHref: string, data: Assets, texSize: number, geomDoc: string = model): number {
  // Materials are resolved before the meshes are packed, because which meshes
  // survive depends on them: a copy of a terrain-projected mesh is redundant.
  const modelDir = dirOf(resolveHref('', modelHref));
  const allMats = modelMaterials(model, data, modelDir);
  const declared = declaredGroups(geomDoc, meshes, allMats.length);
  meshes = declared.meshes;
  const allPick = declared.pick;
  // Decode each material's texture once, up front: the dedup needs to know how
  // opaque the authored partner of a SubTerrain pair is (a sheer overlay is not
  // a body, so its SubTerrain base survives), and the parts loop needs the same
  // images afterwards. Opacity is a property of the texture, not the UVs, so it
  // is read here whether or not the mesh ends up with usable UVs.
  const texInfo = new Map<number, { uri: string; hasAlpha: boolean; opaque: boolean } | null>();
  const infoFor = (mi: number): { uri: string; hasAlpha: boolean; opaque: boolean } | null => {
    if (!texInfo.has(mi)) {
      const href = allMats[mi]?.tex;
      texInfo.set(mi, href ? textureDataUri(model, data, texSize, href) : null);
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
  // A world mesh textured with a minimap UI icon is a placeholder, not scene
  // geometry: the One-Way Exit's own model is one such quad, the real portal
  // living in its effect. Drop it so it neither draws nor bloats the bounds.
  for (let i = 0; i < keep.length; i++) {
    if (allMats[allPick[i] ?? 0]?.tex?.includes('/MinimapIcons/')) keep[i] = false;
  }
  const pick = allPick.filter((_, i) => keep[i]);
  meshes = meshes.filter((_, i) => keep[i]);
  // Everything was a duplicate or a placeholder: report no geom so the caller
  // falls back to the effect (or skips the object) rather than adding a hollow
  // one whose only trace is an empty bounding box.
  if (!meshes.length) return -1;

  let vc = 0, tc = 0;
  for (const m of meshes) { vc += m.vertexCount; tc += m.indices.length; }
  const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idxs = new Uint32Array(tc);
  const nrm = new Float32Array(vc * 3);
  // The binding is packed alongside the positions and in the same order, so it
  // survives the concatenation of several meshes into one buffer. It is only
  // usable if EVERY kept mesh carries one — a model with a bound body and an
  // unbound prop would otherwise leave the prop weighted to bone 0 and drag it
  // along with the creature's hip.
  const skinned = meshes.every((m) => m.skin);
  const skinIndex = skinned ? new Uint8Array(vc * 4) : null;
  const skinWeight = skinned ? new Float32Array(vc * 4) : null;
  let vo = 0, io = 0, hasUV = true, hasNrm = true;
  for (const m of meshes) {
    pos.set(m.positions, vo * 3);
    if (m.normals.length === m.positions.length) nrm.set(m.normals, vo * 3); else hasNrm = false;
    if (m.uvs) uv.set(m.uvs, vo * 2); else hasUV = false;
    if (skinIndex && skinWeight && m.skin) {
      skinIndex.set(m.skin.indices, vo * 4);
      skinWeight.set(m.skin.weights, vo * 4);
    }
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
      additive: mats[mi]?.additive ?? false,
      selfIllum: mats[mi]?.selfIllum ?? false,
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
    // The bones themselves are not known here — the model file has the binding,
    // the animation set has the skeleton and the clip, and only the caller knows
    // the shared that names it. So the binding is packed now and the resolver
    // fills the rest in (or drops `skin` outright when there is no clip to play).
    ...(skinIndex && skinWeight
      ? { skin: { index: Array.from(skinIndex), weight: Array.from(skinWeight, (v) => +v.toFixed(4)), bones: [], bind: [], clip: null } }
      : {}),
  });
  return idx;
}
