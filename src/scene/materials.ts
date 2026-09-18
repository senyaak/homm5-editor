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
import { resampleTo, shrinkToFit } from '../format/texture.ts';
import { resolveHref, dirOf } from './xdb.ts';
import type { Assets } from '../game/assets.ts';
import type { Mesh } from './geometry.ts';
import type { AlphaMode, Picture } from './payload.ts';

/** A material as the renderer needs it: what to draw and how to blend it. */
export interface MaterialInfo {
  tex: string | null;
  alphaMode: AlphaMode;
  projectOnTerrain: boolean;
  /**
   * Draw additive (rgb adds to what is behind) — `<AddPlaced>`, and ONLY
   * when the material blends at all.
   *
   * Read out of H5_Game_H5E.exe rather than guessed from the vortex it was
   * first seen on. The material's pass builder (`CGenericMaterial` vt+0x38,
   * `0x52e1f0`) forms the pass flags from AddPlaced (`+0x96`, record byte
   * `+0xB5`): `0x80` when set, `0x140` when not, and with fog on `0x400`
   * against `0x200` — the fog-to-black flavour an additive surface needs
   * so the fog colour is not added to it. But those flags are handed over
   * only on the BLENDED branches — OVERLAY, OVERLAY_ZWRITE, TRANSPARENT,
   * DECAL (blend class `+0x64` 1..4). The OPAQUE branch (class 0, which is
   * also where ALPHA_TEST goes, its test a separate flag `+0x7C`) pushes a
   * different slot holding only the fog bit. So a gold pile — AM_OPAQUE,
   * L_SELFILLUM, AddPlaced true — is a solid heap in the game, and was a
   * see-through one in the editor for as long as the flag alone decided.
   */
  additive: boolean;
  selfIllum: boolean;
  /** `<Is2Sided>`: draw the back faces too. False in 11209 of the 11639 shipped
   *  materials, so a culled face is the norm and a two-sided one the exception. */
  twoSided: boolean;
  /**
   * THE terrain-skin material: the mesh wearing it is drawn as a piece of the
   * ground, its own texture unused.
   *
   * The engine picks it out by identity. `CTerrainMaterialChecker` (NRender)
   * loads one document — `/_(Material)/dev/Test/Malkovsky/CragTerrain
   * .(Material).xdb` — and its one test (`0xa0d140` of H5_Game_H5E.exe) is
   * `material == that`; the submesh walk that builds a render object
   * (`0x9fc960` and three more like it) sends a mesh down the terrain path
   * when `material->ProjectOnTerrain()` OR this test holds. So the crag
   * skirt under BigStone02, the coincident "underground shell" of every
   * mountain and the mine's crag pad are not props with a grey rock
   * texture; they are the terrain, taking whatever ground the map paints
   * there — snow under the stone in the game, where the editor drew a black
   * pad.
   */
  terrainSkin: boolean;
}

/** The alpha modes the engine blends — the only ones on which AddPlaced acts (see MaterialInfo.additive). */
const BLENDED: ReadonlySet<AlphaMode> = new Set<AlphaMode>(['AM_OVERLAY', 'AM_OVERLAY_ZWRITE', 'AM_TRANSPARENT', 'AM_DECAL']);

/** The one document the engine's terrain-material test compares against. */
const TERRAIN_SKIN_MATERIAL = '_(Material)/dev/Test/Malkovsky/CragTerrain.(Material).xdb';

const NO_MATERIAL: MaterialInfo = {
  tex: null, alphaMode: 'AM_OPAQUE', projectOnTerrain: false, additive: false, selfIllum: false, twoSided: false,
  terrainSkin: false,
};

/**
 * Read one material, following an external <Item href> when it is not inline.
 *
 * @param baseDir where the model lives, for hrefs written relative to it
 */
function materialInfo(itemXml: string, data: Assets, baseDir: string): MaterialInfo {
  const read = (xml: string, from: string): MaterialInfo => {
    const tex = xml.match(/<Texture href="([^"]*)"/)?.[1];
    const alphaMode = (xml.match(/<AlphaMode>([^<]*)<\/AlphaMode>/)?.[1] ?? 'AM_OPAQUE') as AlphaMode;
    return {
      // A texture href is relative to the MATERIAL, which is not always beside
      // the model that named it.
      tex: tex ? '/' + resolveHref(from, tex) : null,
      alphaMode,
      projectOnTerrain: /<ProjectOnTerrain>\s*true\s*<\/ProjectOnTerrain>/.test(xml),
      additive: BLENDED.has(alphaMode) && /<AddPlaced>\s*true\s*<\/AddPlaced>/.test(xml),
      selfIllum: /<LightingMode>\s*L_SELFILLUM\s*<\/LightingMode>/.test(xml),
      twoSided: /<Is2Sided>\s*true\s*<\/Is2Sided>/.test(xml),
      terrainSkin: false,
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
    const doc = data.text(rel);
    if (doc === null) return NO_MATERIAL;
    const info = read(doc, dirOf(rel));
    // By the document's path, as the engine goes by the document's identity.
    if (rel.replace(/^\/+/, '') === TERRAIN_SKIN_MATERIAL) info.terrainSkin = true;
    return info;
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

interface DecodedTexture { picture: Picture; hasAlpha: boolean; opaque: boolean }

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
 * The budget is generous next to one scene's worth (a shipped map's 223
 * textures are ~70 MB of texels at this cap) so that a build never evicts
 * inside itself.
 */
const decoded = new Map<string, DecodedTexture | null>();
const DECODED_BUDGET = 384 * 1024 * 1024;
let decodedBytes = 0;
/**
 * The same, by the texture document's href — so that a texture already
 * decoded is not found by reading its document again to learn which file it
 * names. Every part of every object asks; the read was most of the asking.
 */
const byHref = new Map<string, DecodedTexture | null>();

function remember(key: string, value: DecodedTexture | null): DecodedTexture | null {
  decoded.set(key, value);
  decodedBytes += value ? value.picture.rgba.byteLength : 0;
  for (const old of decoded.keys()) {
    if (decodedBytes <= DECODED_BUDGET) break;
    if (old === key) break;                    // never evict what was just asked for
    decodedBytes -= decoded.get(old)?.picture.rgba.byteLength ?? 0;
    decoded.delete(old);
  }
  return value;
}

/**
 * One material's texture as the renderer takes it: its texels, plus the two
 * things about its alpha that decide how the part is drawn.
 *
 * `cap` is the longest side allowed, not the size produced — see `shrinkToFit`.
 */
export function textureDataUri(model: string, data: Assets, cap: number, href?: string): DecodedTexture | null {
  try {
    const t = href ? [href, href] : model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const docPath = data.path(t[1].split('#')[0]);
    const hkey = `${docPath}|${cap}`;
    const byDoc = byHref.get(hkey);
    if (byDoc !== undefined && (byDoc === null || decoded.get(byDoc.picture.key!) === byDoc)) return byDoc;
    const tx = data.text(t[1].split('#')[0]!);
    const dest = tx?.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const ddsPath = data.path(join(dirname(t[1].split('#')[0]), dest[1]));
    if (!existsSync(ddsPath)) return null;
    const key = `${ddsPath}|${cap}`;
    const known = decoded.get(key);
    if (known !== undefined) { byHref.set(hkey, known); return known; }
    const img = shrinkToFit(decodeDDS(ddsPath, cap), cap);
    let hasAlpha = false, solidTexels = 0;
    for (let i = 3; i < img.rgba.length; i += 4) {
      const a = img.rgba[i]!;
      if (a < 200) hasAlpha = true;
      if (a > 128) solidTexels++;
    }
    // Half the texels opaque is far from either measured case (a solid rock
    // skin sits at 96%, a feathered overlay at 11%), so where the line lands
    // between them does not matter.
    const made = remember(key, {
      picture: { width: img.width, height: img.height, rgba: img.rgba, key },
      hasAlpha,
      opaque: solidTexels > img.width * img.height * 0.5,
    });
    byHref.set(hkey, made);
    return made;
  } catch { return null; }
}

/**
 * Particle frames already decoded, by file and cap — the same object every
 * time, which is what lets the renderer tell two instances wearing one frame
 * apart from two frames (FxInstancePayload.textures). A frame is at most
 * 64 KB and the shipped effects name about a thousand distinct ones, so the
 * budget is generous the same way `decoded`'s is: a map never evicts inside
 * its own build.
 */
const frames = new Map<string, Picture | null>();
const FRAMES_BUDGET = 96 * 1024 * 1024;
let frameBytes = 0;

/**
 * A particle frame's texture as FxInstancePayload.textures documents it: the
 * straight-alpha texels, no larger than `size` on either side.
 */
export function particleFrame(data: Assets, size: number, href: string): Picture | null {
  try {
    const tx = data.text(href.split('#')[0]!);
    const dest = tx?.match(/<DestName href="([^"]+)"/);
    if (!dest) return null;
    const ddsPath = data.path(join(dirname(href.split('#')[0]!), dest[1]!));
    if (!existsSync(ddsPath)) return null;
    const key = `${ddsPath}|${size}`;
    const known = frames.get(key);
    if (known !== undefined) return known;
    const raw = decodeDDS(ddsPath, size);
    // Down to the atlas cell and no further: `size` is a ceiling on each side
    // rather than the shape produced, so a small frame is not blown up into
    // four times the bytes on its way to a cell that would scale it anyway.
    // (The file's own mip level usually is the size already; this is for a
    // file without one.)
    const img = resampleTo(raw, Math.min(size, raw.width), Math.min(size, raw.height));
    const frame: Picture = { width: img.width, height: img.height, rgba: img.rgba, key };
    frames.set(key, frame);
    frameBytes += frame.rgba.byteLength;
    for (const old of frames.keys()) {
      if (frameBytes <= FRAMES_BUDGET || old === key) break;
      frameBytes -= frames.get(old)?.rgba.byteLength ?? 0;
      frames.delete(old);
    }
    return frame;
  } catch { return null; }
}
