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

export function textureDataUri(model: string, data: Assets, size: number, href?: string): { uri: string; hasAlpha: boolean; opaque: boolean } | null {
  try {
    const t = href ? [href, href] : model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const tx = readFileSync(data.path(t[1].split('#')[0]), 'utf8');
    const dest = tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const ddsPath = data.path(join(dirname(t[1].split('#')[0]), dest[1]));
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
    const img = decodeDDS(ddsPath);
    const c = new Uint8Array(size * size * 4);
    const a = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = x * img.width / size | 0, sy = y * img.height / size | 0;
      const si = (sy * img.width + sx) * 4, o = (y * size + x) * 4;
      c[o] = img.rgba[si]!; c[o + 1] = img.rgba[si + 1]!; c[o + 2] = img.rgba[si + 2]!; c[o + 3] = 255;
      const av = img.rgba[si + 3]!;
      a[o] = av; a[o + 1] = av; a[o + 2] = av; a[o + 3] = 255;
    }
    return { c: pngDataUri(size, size, c), a: pngDataUri(size, size, a) };
  } catch { return null; }
}
