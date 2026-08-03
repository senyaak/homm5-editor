// Which texture a submesh wears, and how it blends.
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

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decodeDDS } from '../format/dds.ts';
import { pngDataUri } from '../format/png.ts';
import { resampleTo, shrinkToFit } from '../format/texture.ts';
import { resolveHref, dirOf } from './xdb.ts';
import type { Assets } from '../game/assets.ts';
import type { Mesh } from './geometry.ts';
import type { AlphaMode } from './payload.ts';

/** A material as the renderer needs it: what to draw and how to blend it. */
export interface MaterialInfo {
  tex: string | null;
  alphaMode: AlphaMode;
  projectOnTerrain: boolean;
  additive: boolean;
  selfIllum: boolean;
}

const NO_MATERIAL: MaterialInfo = { tex: null, alphaMode: 'AM_OPAQUE', projectOnTerrain: false, additive: false, selfIllum: false };

/**
 * Read one material, following an external <Item href> when it is not inline.
 *
 * @param baseDir where the model lives, for hrefs written relative to it
 */
function materialInfo(itemXml: string, data: Assets, baseDir: string): MaterialInfo {
  const read = (xml: string, from: string): MaterialInfo => {
    const tex = xml.match(/<Texture href="([^"]*)"/)?.[1];
    return {
      // A texture href is relative to the MATERIAL, which is not always beside
      // the model that named it.
      tex: tex ? '/' + resolveHref(from, tex) : null,
      alphaMode: (xml.match(/<AlphaMode>([^<]*)<\/AlphaMode>/)?.[1] ?? 'AM_OPAQUE') as AlphaMode,
      projectOnTerrain: /<ProjectOnTerrain>\s*true\s*<\/ProjectOnTerrain>/.test(xml),
      additive: /<AddPlaced>\s*true\s*<\/AddPlaced>/.test(xml),
      selfIllum: /<LightingMode>\s*L_SELFILLUM\s*<\/LightingMode>/.test(xml),
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
    const p = data.path(rel);
    return existsSync(p) ? read(readFileSync(p, 'utf8'), dirOf(rel)) : NO_MATERIAL;
  } catch { return NO_MATERIAL; }
}

/** Every material, in the order <Materials> lists them. */
export function modelMaterials(model: string, data: Assets, baseDir: string): MaterialInfo[] {
  const open = model.indexOf('<Materials>');
  const close = model.indexOf('</Materials>');
  if (open < 0 || close < 0) return [];
  // A <Material> body has no nested <Item>, so splitting on <Item is safe here.
  const parts = model.slice(open + 11, close).split(/<Item\b/).slice(1);
  return parts.map((p) => materialInfo(p, data, baseDir));
}

/**
 * Drop the groups the game itself never draws, and give each survivor its
 * material.
 *
 * <MaterialQuantities> counts DRAWN groups per named mesh (block), and the
 * binary can hold more groups than that: the bare Dirt trees share their
 * geometry container with the Mossy variants, whose branch cards are a second
 * group. The bare model declares one material, so the game draws only the
 * trunk — but drawing every group painted those cards with the bark texture,
 * and every dead tree grew wooden planks. Measured over the shipped models:
 * of 1250 with inline geometry, 1240 declare exactly as many groups as the
 * binary holds, 9 hold extras within a declared block (the eight bare Dirt
 * trees and the interface Spellbook), and 1 declares more than it holds
 * (MountainBig's known defect, absorbed by the material-index clamp).
 *
 * A binary can also hold extra whole BLOCKS (5 models, all with external
 * (Geometry).xdb declarations — hence the geomDoc parameter, since the model
 * xml carries no <MaterialQuantities> in that layout). Which blocks the
 * engine then draws is a name-matching question this code cannot answer from
 * order alone, so the block-count guard keeps everything: four are battle
 * effects no map places, and the one building (the snowed Elemental
 * Stockpile) holds an extra that is a byte-exact copy of a block it draws, so
 * keeping it changes nothing visible.
 *
 * Group j of block i takes material sum(MQ[0..i)) + j — the walk the engine
 * itself must be doing, since the Mossy cards land on the moss material this
 * way. Needs the block tags the structured decoder writes; heuristic meshes
 * carry none and fall back to the name-level walk (meshMaterialIndex).
 */
export function declaredGroups(geomDoc: string, meshes: Mesh[], materialCount: number): { meshes: Mesh[]; pick: number[] } {
  const mq = geomDoc.match(/<MaterialQuantities>([\s\S]*?)<\/MaterialQuantities>/);
  const q = mq ? [...mq[1]!.matchAll(/<Item>(\d+)<\/Item>/g)].map((m) => +m[1]!) : [];
  const blocks = meshes.length && meshes.every((m) => m.block !== undefined)
    ? meshes.reduce((mx, m) => Math.max(mx, m.block!), -1) + 1
    : 0;
  // A declaration that does not match the binary's block count is not the
  // binary's declaration — keep everything rather than drop by a wrong map.
  if (!q.length || q.length !== blocks) {
    return { meshes, pick: meshMaterialIndex(geomDoc, meshes.length, materialCount) };
  }
  const offset: number[] = [];
  let at = 0;
  for (const n of q) { offset.push(at); at += n; }
  const kept: Mesh[] = [], pick: number[] = [];
  const seen = Array<number>(blocks).fill(0);
  for (const m of meshes) {
    const j = seen[m.block!]++;
    // A zero quantity would drop the block outright; no shipped model declares
    // one, so draw a group rather than trust it if it ever appears.
    if (j >= Math.max(1, q[m.block!]!)) continue;
    kept.push(m);
    pick.push(Math.min(offset[m.block!]! + j, Math.max(0, materialCount - 1)));
  }
  return { meshes: kept, pick };
}

/**
 * Which material each mesh uses, from <MaterialQuantities> — the fallback for
 * meshes without block tags (the heuristic decoder's, one per <MeshNames>
 * entry).
 *
 * A mesh that consumes several materials is given the first of them: with no
 * group split there is no finer place to hang the rest on. 407 of 2281 models
 * have such a mesh, so this is a real approximation and not a corner case —
 * but one texture chosen from the right group beats one texture chosen for
 * the whole model.
 */
function meshMaterialIndex(model: string, meshCount: number, materialCount: number): number[] {
  // Meshes that line up one-to-one with the material list take the material at
  // their own index — right whenever the counts agree, whatever decoder ran.
  if (meshCount === materialCount) return Array.from({ length: meshCount }, (_, i) => i);
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

/**
 * The longest side an embedded texture is reduced to, unless a caller says
 * otherwise. One constant rather than the four separate `?? 128` defaults it
 * replaces — a scene, a map, an actor rig and an effect all have to agree, or
 * the same texture arrives twice at two sizes and neither cache helps.
 *
 * 512 because that is the size the art is authored at: 512 and 1024 skins are
 * 15% of the shipped textures and they are the ones a camera gets close to.
 * The cap only ever REDUCES — the 64x64 majority is untouched by it — so
 * raising it costs nothing on the textures it does not apply to.
 */
export const TEXTURE_CAP = 512;

interface DecodedTexture { uri: string; hasAlpha: boolean; opaque: boolean }

/**
 * Textures already decoded, by file and cap.
 *
 * A scene names the same texture over and over: C1M1's opening asks for 4659
 * and there are 296 distinct ones behind them. Without this, every mesh wearing
 * a texture decodes, reduces and PNG-encodes it again — which was most of the
 * build, and most of what got worse when the cap went up.
 *
 * Bounded, and evicting the oldest first, because the main process lives as
 * long as the editor does and every map opened would otherwise stay resident.
 * The budget is generous next to one scene's worth (23 MB at this cap) so that
 * a build never evicts inside itself.
 */
const decoded = new Map<string, DecodedTexture | null>();
const DECODED_BUDGET = 128 * 1024 * 1024;
let decodedBytes = 0;

function remember(key: string, value: DecodedTexture | null): DecodedTexture | null {
  decoded.set(key, value);
  decodedBytes += value ? value.uri.length : 0;
  for (const old of decoded.keys()) {
    if (decodedBytes <= DECODED_BUDGET) break;
    if (old === key) break;                    // never evict what was just asked for
    decodedBytes -= decoded.get(old)?.uri.length ?? 0;
    decoded.delete(old);
  }
  return value;
}

/**
 * One material's texture as the renderer takes it: a PNG data URI, plus the two
 * things about its alpha that decide how the part is drawn.
 *
 * `cap` is the longest side allowed, not the size produced — see `shrinkToFit`.
 */
export function textureDataUri(model: string, data: Assets, cap: number, href?: string): DecodedTexture | null {
  try {
    const t = href ? [href, href] : model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const tx = readFileSync(data.path(t[1].split('#')[0]), 'utf8');
    const dest = tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const ddsPath = data.path(join(dirname(t[1].split('#')[0]), dest[1]));
    if (!existsSync(ddsPath)) return null;
    const key = `${ddsPath}|${cap}`;
    const known = decoded.get(key);
    if (known !== undefined) return known;
    const img = shrinkToFit(decodeDDS(ddsPath), cap);
    let hasAlpha = false, solidTexels = 0;
    for (let i = 3; i < img.rgba.length; i += 4) {
      const a = img.rgba[i]!;
      if (a < 200) hasAlpha = true;
      if (a > 128) solidTexels++;
    }
    // Half the texels opaque is far from either measured case (a solid rock
    // skin sits at 96%, a feathered overlay at 11%), so where the line lands
    // between them does not matter.
    return remember(key, {
      uri: pngDataUri(img.width, img.height, img.rgba),
      hasAlpha,
      opaque: solidTexels > img.width * img.height * 0.5,
    });
  } catch { return null; }
}

/**
 * A particle frame's texture as the TWO images FxInstancePayload.textures
 * documents: colour with alpha forced opaque, and the real alpha as gray.
 * A single straight-alpha PNG cannot make the trip — the renderer's canvas
 * premultiplies and a fire texel (colour under alpha 0) comes out black.
 */
export function particleTextureUris(data: Assets, size: number, href: string): { c: string; a: string } | null {
  try {
    const tx = readFileSync(data.path(href.split('#')[0]!), 'utf8');
    const dest = tx.match(/<DestName href="([^"]+)"/);
    if (!dest) return null;
    const ddsPath = data.path(join(dirname(href.split('#')[0]!), dest[1]!));
    if (!existsSync(ddsPath)) return null;
    const raw = decodeDDS(ddsPath);
    // Down to the atlas cell and no further: `size` is a ceiling on each side
    // rather than the shape produced, so a small frame is not blown up into
    // four times the bytes on its way to a canvas that would scale it anyway.
    const img = resampleTo(raw, Math.min(size, raw.width), Math.min(size, raw.height));
    const n = img.width * img.height;
    const c = new Uint8Array(n * 4);
    const a = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const si = i * 4;
      c[si] = img.rgba[si]!; c[si + 1] = img.rgba[si + 1]!; c[si + 2] = img.rgba[si + 2]!; c[si + 3] = 255;
      const av = img.rgba[si + 3]!;
      a[si] = av; a[si + 1] = av; a[si + 2] = av; a[si + 3] = 255;
    }
    return { c: pngDataUri(img.width, img.height, c), a: pngDataUri(img.width, img.height, a) };
  } catch { return null; }
}
