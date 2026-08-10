// Pandora's Box: the object itself — model, texture, glow, definitions.
//
// The box is Heroes III's pandora brought over: a floating, spinning cube a
// hero opens for whatever the map author put inside. The VISUAL rides the
// game's own artifact machinery — the model is the Artefakt donor's container
// with a clean cube built into its slots, so the artifact idle animation
// (the spin and the bob) and the artifact glow effects apply unchanged. The
// BEHAVIOUR is not here: the object is an AdvMapStandShared — the class that
// does nothing on its own — and everything it does is the touch trigger the
// map's script hooks (see pandora-scripts.ts).
//
// FOUR DOCUMENTS, NOT ONE. The glow's colour states what the box holds — the
// value of the contents, in the artifact glows the game already ships (blue,
// green, gold, red, poorest to richest). An effect is a document reference on
// the SHARED definition, not a per-placement field, so each colour is its own
// shared document and the editor points a placement at the tier its contents
// earn (pandora.ts).

import { parseTypeSpec } from '../schema/typespec.ts';
import { parseTree } from '../scene/geometry.ts';
import type { BlockRecord, ContainerRecord, RecordTree } from '../scene/geometry.ts';
import { textureDoc, writeDDS } from '../format/texture.ts';
import type { Image } from '../format/gif.ts';
import { buildingDoc, buildingLink } from './buildings.ts';
import type { BuildingSpec } from './buildings.ts';
import { copyArt, dataPath, resolve } from './mod-art.ts';
import type { ArtCopy } from './mod-art.ts';
import { TYPES, mustRead, utf16 } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { pandoraBehaviourFiles } from './pandora-scripts.ts';

const EOL = '\r\n';

// --- what the box is made of -------------------------------------------------

/** The donor: the floating artifact stone, whose skeleton and idle we keep. */
const DONOR_MODEL = '_(Model)/Cutscenes/Artefakt.(Model).xdb';
const DONOR_ANIMSET = '_(AnimSet)/Cuscenes/Artefakt.(AnimSet).xdb';

/** The glow tiers, poorest first — the game's own artifact glows. */
export interface PandoraTier {
  key: string;
  /** The shipped glow effect this tier copies. */
  effect: string;
  /** Contents worth at least this much, in gold, earn the tier. */
  from: number;
}

export const PANDORA_TIERS: readonly PandoraTier[] = [
  { key: 'Blue', effect: 'Effects/_(Effect)/Artefacts/General/Blue.xdb', from: 0 },
  { key: 'Green', effect: 'Effects/_(Effect)/Artefacts/General/Green.xdb', from: 5000 },
  { key: 'Gold', effect: 'Effects/_(Effect)/Artefacts/General/Gold.xdb', from: 15000 },
  { key: 'Red', effect: 'Effects/_(Effect)/Artefacts/General/Red.xdb', from: 40000 },
];

/** Where everything lives inside the mod. */
export const PANDORA_DIR = 'Buildings/PandoraBox';
const ART_DIR = `${PANDORA_DIR}/art`;

export const PANDORA_CLASS = 'AdvMapStandShared';

/** The shared document of one tier. */
export const pandoraShared = (tier: string): string =>
  `${PANDORA_DIR}/PandoraBox_${tier}.(${PANDORA_CLASS}).xdb`;

/** The palette entry — one, pointing at the poorest tier a fresh box is. */
export const PANDORA_LINK = 'MapObjects/_(AdvMapObjectLink)/Objects-All-Terra/PandoraBox.xdb';

/** The chest-class probe: same box, the class the AI knows to want. */
export const PANDORA_CHEST_CLASS = 'AdvMapTreasureShared';
export const PANDORA_CHEST_SHARED = `${PANDORA_DIR}/PandoraBox_Chest.(${PANDORA_CHEST_CLASS}).xdb`;
export const PANDORA_CHEST_LINK = 'MapObjects/_(AdvMapObjectLink)/Objects-All-Terra/PandoraBoxChest.xdb';

/** The spin probes: the SKINNED cube with the artifact idle, on the classes
 * that might animate it. Stand showed nothing on the first run; the windmill
 * proves the Building class plays an AnimSet on the adventure map. */
export const PANDORA_SPIN_SHARED = `${PANDORA_DIR}/PandoraBox_Spin.(${PANDORA_CLASS}).xdb`;
export const PANDORA_SPIN_LINK = 'MapObjects/_(AdvMapObjectLink)/Objects-All-Terra/PandoraBoxSpin.xdb';
export const PANDORA_MILL_CLASS = 'AdvMapBuildingShared';
export const PANDORA_MILL_SHARED = `${PANDORA_DIR}/PandoraBox_Mill.(${PANDORA_MILL_CLASS}).xdb`;
export const PANDORA_MILL_LINK = 'MapObjects/_(AdvMapObjectLink)/Objects-All-Terra/PandoraBoxMill.xdb';

/** The tier a contents value earns. */
export function pandoraTier(value: number): PandoraTier {
  let tier = PANDORA_TIERS[0]!;
  for (const t of PANDORA_TIERS) if (value >= t.from) tier = t;
  return tier;
}

// --- the cube ---------------------------------------------------------------

/** The box in world units: a tile is 2, so a 1.0 cube floats over its middle. */
const HALF = 0.5;
const BOX_C = [0, 0, 2.0] as const;

/** For face ±x / ±y / ±z: [outward axis, u axis, v axis]. */
const FACE_AXES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
];

/** One vertex-to-bone binding: full weight on the donor's main bone, bone 3 —
 * the one 434 of the stone's 610 vertices ride rigidly, and the one the idle
 * animation spins. 4 float weights, 4 quantized weights, 4 bone indices with
 * 12 as the donor's filler. */
const RIGID_SKIN = Buffer.from('0000803f000000000000000000000000ff000000030c0c0c', 'hex');

/** And the binding a STATIC model carries — read off the shipped treasure
 * chest, whose every vertex is this exact entry: full weight on bone 0, no
 * filler. A skinned mesh on a class that raises no skeleton draws NOTHING
 * (the probe map showed glow and no cube), and this is the other half of
 * being static; the first is the model document's empty `<Skeleton/>`. */
const STATIC_SKIN = Buffer.from('0000803f000000000000000000000000ff00000000000000', 'hex');

interface GroupPart { int: number; leaf: BlockRecord }

/** A mesh group's parts by tag: 2 positions, 3 attributes, 4 skin, 5/6 remaps, 7 indices. */
interface MeshGroup { part: (tag: number) => GroupPart | null }

const isBlock = (r: ContainerRecord): r is BlockRecord => !('int' in r);

/**
 * Every mesh group in a parsed geometry container.
 *
 * A group is a node whose children are `{scalar count, leaf}` nodes tagged 2
 * (positions) and 3 (attributes) — tags 5..7 are NOT required, because the
 * parser stops short of them in the donor's second group (an undocumented
 * corner of the container past its skin block), and a group is a group whether
 * or not its tail parses.
 */
function meshGroups(tree: RecordTree): MeshGroup[] {
  const out: MeshGroup[] = [];
  const walk = (t: RecordTree): void => {
    for (const r of t.records) {
      if (!isBlock(r) || !r.node) continue;
      const kids = r.node.records;
      const part = (tag: number): GroupPart | null => {
        const n = kids.find((k) => k.tag === tag && isBlock(k) && k.node) as BlockRecord | undefined;
        if (!n?.node) return null;
        const scalar = n.node.records.find((k) => 'int' in k);
        const leaf = n.node.records.find((k) => isBlock(k) && k.leaf) as BlockRecord | undefined;
        return scalar && 'int' in scalar && leaf ? { int: scalar.int, leaf } : null;
      };
      const pos = part(2), attr = part(3);
      if (pos && attr && pos.leaf.byteLen === pos.int * 12 && attr.leaf.byteLen === attr.int * 20) {
        out.push({ part });
        continue;
      }
      walk(r.node);
    }
  };
  walk(tree);
  return out;
}

/**
 * Build a clean cube into the donor geometry's own slots, in place.
 *
 * Nothing about the container changes shape: 8 corner positions and 24 render
 * vertices take the first slots, 12 triangles take the first index rows, and
 * every remaining slot is parked where it draws nothing — surplus positions on
 * corner 0, surplus triangles degenerate. The undocumented bytes past the
 * second group's skin block are never touched, which is the reason to reuse
 * the donor's container instead of writing one.
 *
 * Returns the box's bounding box for the geometry document.
 */
export function cubifyGeometry(bin: Buffer, skin: 'static' | 'rigid' = 'static'): { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number } {
  const SKIN = skin === 'rigid' ? RIGID_SKIN : STATIC_SKIN;
  const groups = meshGroups(parseTree(bin));
  if (!groups.length) throw new Error('pandora: the donor geometry has no mesh groups');

  const corner = (i: number): [number, number, number] => [
    BOX_C[0] + ((i & 1) ? HALF : -HALF),
    BOX_C[1] + ((i & 2) ? HALF : -HALF),
    BOX_C[2] + ((i & 4) ? HALF : -HALF),
  ];

  const main = groups[0]!;
  const pos = main.part(2)!, attr = main.part(3)!, skinPart = main.part(4);
  const remap = main.part(5), remap2 = main.part(6), idx = main.part(7);
  if (!remap || !idx) throw new Error('pandora: the donor geometry lost its remap or indices');
  if (pos.int < 8 || attr.int < 24 || idx.int < 12) throw new Error('pandora: the donor mesh is too small to hold a cube');

  for (let i = 0; i < pos.int; i++) {
    const p = corner(i < 8 ? i : 0);
    const o = pos.leaf.body + i * 12;
    for (let k = 0; k < 3; k++) bin.writeFloatLE(p[k]!, o + k * 4);
  }
  if (skinPart) for (let i = 0; i < pos.int; i++) SKIN.copy(bin, skinPart.leaf.body + i * 24);

  // 6 faces, corners listed in the face's own (u, v) order
  const faces: { axis: number; neg: boolean; corners: number[] }[] = [];
  for (let axis = 0; axis < 3; axis++) for (const neg of [false, true]) {
    const bit = 1 << axis;
    const others = [0, 1, 2].filter((a) => a !== axis).map((a) => 1 << a);
    const base = neg ? 0 : bit;
    faces.push({ axis, neg, corners: [base, base | others[0]!, base | others[1]!, base | others[0]! | others[1]!] });
  }

  const writeAttr = (rv: number, u: number, v: number, n: number[], ua: number[], va: number[], sign: number): void => {
    const o = attr.leaf.body + rv * 20;
    bin.writeInt16LE(Math.round(u * 2047), o);
    bin.writeInt16LE(Math.round(v * 2047), o + 2);
    bin.writeInt16LE(0, o + 4); bin.writeInt16LE(0, o + 6);
    const pack = (vec: number[], s: number, at: number): void => {
      for (let k = 0; k < 3; k++) bin[o + at + k] = Math.round(vec[k]! * s * 127 + 128);
      bin[o + at + 3] = 0;
    };
    pack(n, sign, 8); pack(ua, 1, 12); pack(va, 1, 16);
  };

  for (let f = 0; f < 6; f++) {
    const { axis, neg, corners } = faces[f]!;
    const [n, ua, va] = FACE_AXES[axis]!;
    for (let v = 0; v < 4; v++) {
      const rv = f * 4 + v;
      const ci = corners[v]!;
      bin.writeUInt16LE(ci, remap.leaf.body + rv * 2);
      if (remap2) bin.writeUInt16LE(ci, remap2.leaf.body + rv * 2);
      const p = corner(ci);
      const local = (a: number[]): number =>
        (a[0]! * (p[0] - BOX_C[0]) + a[1]! * (p[1] - BOX_C[1]) + a[2]! * (p[2] - BOX_C[2])) / HALF;
      // Texture V runs down the image; the mirror keeps the pattern reading the
      // same way round on every face.
      const u = neg ? (local(ua) + 1) / 2 : 1 - (local(ua) + 1) / 2;
      writeAttr(rv, u, 1 - (local(va) + 1) / 2, n, ua, va, neg ? -1 : 1);
    }
  }
  for (let rv = 24; rv < attr.int; rv++) {
    bin.writeUInt16LE(0, remap.leaf.body + rv * 2);
    if (remap2) bin.writeUInt16LE(0, remap2.leaf.body + rv * 2);
    writeAttr(rv, 0, 0, FACE_AXES[0]![0], FACE_AXES[0]![1], FACE_AXES[0]![2], 1);
  }

  // 12 triangles wound outward — checked against the face normal, not assumed
  const rvPos = (rv: number): [number, number, number] => corner(bin.readUInt16LE(remap.leaf.body + rv * 2));
  for (let f = 0; f < 6; f++) {
    const { axis, neg } = faces[f]!;
    const out = FACE_AXES[axis]![0].map((v) => v * (neg ? -1 : 1));
    const rv = f * 4;
    for (let t = 0; t < 2; t++) {
      let tri = t === 0 ? [rv, rv + 1, rv + 3] : [rv, rv + 3, rv + 2];
      const [A, B, D] = tri.map(rvPos);
      const e1 = B.map((v, k) => v - A[k]!), e2 = D.map((v, k) => v - A[k]!);
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      if (n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]! < 0) tri = [tri[0]!, tri[2]!, tri[1]!];
      const o = idx.leaf.body + (f * 2 + t) * 6;
      for (let k = 0; k < 3; k++) bin.writeUInt16LE(tri[k]!, o + k * 2);
    }
  }
  for (let t = 12; t < idx.int; t++) {
    const o = idx.leaf.body + t * 6;
    bin.writeUInt16LE(0, o); bin.writeUInt16LE(0, o + 2); bin.writeUInt16LE(0, o + 4);
  }

  // Groups past the first are the donor's decoration (the stone's base sits
  // wholly inside the cube already); park their positions at the centre so
  // nothing of them can ever poke out.
  for (const g of groups.slice(1)) {
    const gp = g.part(2)!;
    for (let i = 0; i < gp.int; i++) {
      const o = gp.leaf.body + i * 12;
      bin.writeFloatLE(BOX_C[0], o); bin.writeFloatLE(BOX_C[1], o + 4); bin.writeFloatLE(BOX_C[2], o + 8);
    }
    const gs = g.part(4);
    if (gs) for (let i = 0; i < gp.int; i++) SKIN.copy(bin, gs.leaf.body + i * 24);
  }

  return { cx: BOX_C[0], cy: BOX_C[1], cz: BOX_C[2], sx: HALF * 2, sy: HALF * 2, sz: HALF * 2 };
}

// --- the texture ------------------------------------------------------------

/**
 * The face of the box, painted: a bronze panel with gold X-straps, a riveted
 * gold border and a wheel medallion in the middle — Heroes III's pandora as a
 * cube face. Drawn rather than borrowed, so it owes nothing to anyone's art.
 */
export function pandoraTexture(size = 256): Image {
  const T = size;
  const rgba = new Uint8Array(T * T * 4);
  const mix = (a: number[], b: number[], t: number): number[] => a.map((x, i) => x + (b[i]! - x) * t);
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const BRONZE_D = [72, 44, 20], BRONZE = [110, 70, 34];
  const GOLD = [212, 164, 55], GOLD_H = [244, 210, 110], GOLD_D = [140, 100, 30];
  const S = T / 256; // every measure below is authored at 256

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const cx = x - T / 2 + 0.5, cy = y - T / 2 + 0.5;
      const r = Math.hypot(cx, cy) / S;
      const edge = Math.min(x, y, T - 1 - x, T - 1 - y) / S;
      const grain = (hash(x >> 2, 0) - 0.5) * 0.25 + (hash(x >> 1, y >> 3) - 0.5) * 0.1;
      let col = mix(BRONZE_D, BRONZE, 0.5 + grain + 0.25 * Math.sin((y / T) * Math.PI));

      const strap = Math.min(Math.abs(cx - cy), Math.abs(cx + cy)) / Math.SQRT2 / S;
      if (strap < 9) {
        col = mix(GOLD, GOLD_D, (strap / 9) ** 2);
        if (strap < 2.2) col = mix(GOLD_H, GOLD, strap / 2.2);
      }

      if (edge < 14) {
        const t = edge / 14;
        col = mix(GOLD_D, GOLD, t < 0.5 ? t * 2 : 2 - t * 2);
        if (edge < 2) col = GOLD_D;
        if (edge >= 12) col = mix(GOLD_D, BRONZE_D, (edge - 12) / 2);
        const along = (Math.min(x, T - 1 - x) < Math.min(y, T - 1 - y) ? y : x) / S;
        const riv = Math.hypot(((along + 16) % 32) - 16, edge - 7);
        if (riv < 4) col = mix(GOLD_H, GOLD, riv / 4);
      }

      if (r < 52) {
        if (r > 46) col = mix(GOLD_D, GOLD, (52 - r) / 6);
        else if (r > 40) col = GOLD;
        else {
          const spoke = Math.abs((((Math.atan2(cy, cx) / Math.PI) * 4 % 1) + 1) % 1 - 0.5) * 2;
          col = spoke > 0.72 ? mix(GOLD, GOLD_H, (spoke - 0.72) / 0.28) : mix(BRONZE_D, [50, 30, 14], r / 40);
          if (r < 12) col = mix(GOLD_H, GOLD, r / 12);
          else if (r < 15) col = GOLD_D;
        }
      }

      const o = (y * T + x) * 4;
      rgba[o] = col[0]!; rgba[o + 1] = col[1]!; rgba[o + 2] = col[2]!; rgba[o + 3] = 255;
    }
  }
  return { width: T, height: T, rgba };
}

// --- putting the files together ---------------------------------------------

const hrefOf = (doc: string, field: string): string | null =>
  new RegExp(`<${field} href="([^"]+)"`).exec(doc)?.[1] ?? null;

/** Our texture pair — the painted face and the document describing it. */
export const PANDORA_TEXTURE = `${PANDORA_DIR}/PandoraBox.(Texture).xdb`;
const PANDORA_DDS = 'PandoraBox.dds';

/**
 * Point every material of the copied model at OUR texture — and only the
 * model's materials; the glow effects keep the game's rays and sparks.
 *
 * The donor's own texture cannot be repainted because it is not there: the
 * Artefakt materials name a vanilla-campaign scene texture
 * (`/Scenes/C1M5_NikolayDeath/…`) that Tribes of the East never shipped. So
 * the painted face is written as a texture of ours and the materials are
 * rewritten to name it.
 */
function paintModelTextures(copied: ArtCopy, modelCopyPath: string): ModFile[] {
  const doc = copied.files.get(modelCopyPath)?.toString('latin1');
  if (!doc) throw new Error(`pandora: no copied model at ${modelCopyPath}`);
  const materials = [...doc.matchAll(/<Item href="([^"]+)"/g)].map((m) => m[1]!);
  let painted = 0;
  for (const m of materials) {
    const mAt = resolve(modelCopyPath, m);
    const mDoc = mAt ? copied.files.get(mAt)?.toString('latin1') : null;
    if (!mAt || !mDoc) continue;
    copied.files.set(mAt, Buffer.from(mDoc.replace(
      /<Texture(?: href="[^"]*")?\s*\/?>(?:<\/Texture>)?/,
      `<Texture href="/${PANDORA_TEXTURE}#xpointer(/Texture)"/>`,
    ), 'latin1'));
    painted++;
  }
  if (!painted) throw new Error('pandora: the donor model names no materials to repaint');
  const image = pandoraTexture();
  return [
    { path: PANDORA_TEXTURE, data: Buffer.from(textureDoc({ dds: PANDORA_DDS, width: image.width, height: image.height, addressing: 'CLAMP' }), 'latin1') },
    { path: `${PANDORA_DIR}/${PANDORA_DDS}`, data: writeDDS(image) },
  ];
}

/** Rewrite the copied geometry document's box to the cube the binary now holds. */
function retuneGeometryDoc(copied: ArtCopy, geomDocPath: string, box: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }): void {
  const doc = copied.files.get(geomDocPath)?.toString('latin1');
  if (!doc) throw new Error(`pandora: no copied geometry document at ${geomDocPath}`);
  const vec = (tag: string, x: number, y: number, z: number): [RegExp, string] => [
    new RegExp(`(<${tag}>\\s*<x>)[^<]*(</x>\\s*<y>)[^<]*(</y>\\s*<z>)[^<]*(</z>)`),
    `$1${x.toFixed(4)}$2${y.toFixed(4)}$3${z.toFixed(4)}$4`,
  ];
  let out = doc;
  for (const [re, to] of [
    vec('Size', box.sx, box.sy, box.sz),
    vec('Center', box.cx, box.cy, box.cz),
  ]) out = out.replace(re, to);
  copied.files.set(geomDocPath, Buffer.from(out, 'latin1'));
}

/** What the box says for itself, one file per message slot. */
const MESSAGES: Record<string, string> = {
  name: "Pandora's Box",
  description: 'A box that holds whatever its maker sealed inside — riches or ruin. Opening it is the only way to find out which.',
};

/**
 * Every file the Pandora's Box ships: the four shared documents, the palette
 * link, the copied-and-rebuilt art, the texts.
 */
export function buildPandora(read: DataReader): ModFile[] {
  const types = parseTypeSpec(mustRead(read, TYPES));

  const seeds = [DONOR_MODEL, DONOR_ANIMSET, ...PANDORA_TIERS.map((t) => t.effect)];
  const copied = copyArt(seeds, ART_DIR, read, 'pandora:box');
  const absent = seeds.filter((s) => !copied.at.has(s));
  if (absent.length) throw new Error(`pandora: the game's data has no ${absent.join(', ')}`);

  // The cube, in place of the stone.
  const modelCopy = copied.at.get(DONOR_MODEL)!;
  const modelDoc = copied.files.get(modelCopy)!.toString('latin1');
  const geomHref = hrefOf(modelDoc, 'Geometry');
  const geomAt = geomHref ? resolve(modelCopy, geomHref) : null;
  const geomDoc = geomAt ? copied.files.get(geomAt)?.toString('latin1') : null;
  if (!geomAt || !geomDoc) throw new Error('pandora: the donor model names no geometry');
  const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(geomDoc)?.[1];
  const binPath = uid ? `bin/Geometries/${uid.toUpperCase()}` : null;
  const bin = binPath ? copied.files.get(binPath) : null;
  if (!binPath || !bin) throw new Error('pandora: the donor geometry binary did not copy');
  // STATIC, deliberately. The first probe run showed glow and no cube: a
  // skinned mesh on a class that raises no skeleton draws nothing, and neither
  // Stand nor Treasure raises one. So the box that ships is a static model —
  // every vertex on bone 0 and the model's Skeleton reference cleared, the
  // exact shape of the shipped treasure chest. The spin lives on in the two
  // hidden probes below, on the classes that might animate.
  const box = cubifyGeometry(bin, 'static');
  retuneGeometryDoc(copied, geomAt, box);
  copied.files.set(modelCopy, Buffer.from(
    copied.files.get(modelCopy)!.toString('latin1').replace(/<Skeleton href="[^"]*"\s*\/>/, '<Skeleton/>'), 'latin1'));
  const texture = paintModelTextures(copied, modelCopy);

  const files: ModFile[] = [...copied.files].map(([path, data]) => ({ path, data }));
  files.push(...texture);

  // The four shared documents — same box, four glows.
  const at = (path: string | undefined): string | undefined => {
    const to = path ? copied.at.get(dataPath(path)) : undefined;
    return to ? `/${to}` : undefined;
  };
  const texts: Record<string, string> = {};
  for (const [slot, message] of Object.entries(MESSAGES)) {
    texts[slot] = `${PANDORA_DIR}/PandoraBox_${slot[0]!.toUpperCase()}${slot.slice(1)}.txt`;
    files.push({ path: texts[slot]!, data: utf16(message) });
  }
  for (const tier of PANDORA_TIERS) {
    const spec: BuildingSpec = {
      file: `PandoraBox_${tier.key}`,
      className: PANDORA_CLASS,
      messages: MESSAGES,
      model: DONOR_MODEL,
      effect: tier.effect,
      footprint: { w: 1, h: 1 },
      ground: null,
    };
    const doc = buildingDoc(spec, { dir: PANDORA_DIR, shared: pandoraShared(tier.key), link: PANDORA_LINK, art: ART_DIR, text: texts }, types, { w: 1, h: 1 }, at);
    files.push({ path: pandoraShared(tier.key), data: Buffer.from(doc, 'latin1') });
  }

  // One palette entry; a fresh box is empty, and empty is the poorest glow.
  const first = PANDORA_TIERS[0]!;
  const linkSpec: BuildingSpec = {
    file: 'PandoraBox', className: PANDORA_CLASS, messages: MESSAGES, model: DONOR_MODEL,
  };
  // the painted face doubles as the palette icon
  files.push({
    path: PANDORA_LINK,
    data: Buffer.from(buildingLink(linkSpec, { dir: PANDORA_DIR, shared: pandoraShared(first.key), link: PANDORA_LINK, art: ART_DIR, text: texts }, PANDORA_TEXTURE), 'latin1'),
  });

  // THE CHEST-CLASS PROBE. A Stand is invisible to the AI — no AI hero ever
  // walks to an object that does nothing — where a treasure chest is a thing
  // the AI knows to want. Whether a chest's own pickup can be silenced
  // (SetObjectEnabled) while the touch trigger still fires is a question only
  // the game can answer, so the box ships in both classes and the probe map
  // (e2e stage 009) asks. Hidden in the palette until it earns its place.
  const chestDoc = buildingDoc(
    {
      file: 'PandoraBox_Chest', className: PANDORA_CHEST_CLASS, messages: MESSAGES,
      model: DONOR_MODEL, effect: PANDORA_TIERS[2]!.effect,
      footprint: { w: 1, h: 1 }, ground: null,
      type: 'TREASURE_CHEST', fields: { MinResource: '1', MaxResource: '1' },
    },
    { dir: PANDORA_DIR, shared: PANDORA_CHEST_SHARED, link: PANDORA_CHEST_LINK, art: ART_DIR, text: texts },
    types, { w: 1, h: 1 }, at,
  );
  files.push({ path: PANDORA_CHEST_SHARED, data: Buffer.from(chestDoc, 'latin1') });
  // The behaviour the maps' generated blocks doFile, and its texts.
  files.push(...pandoraBehaviourFiles());

  const hiddenLink = (link: string, shared: string, className: string): ModFile => ({
    path: link,
    data: Buffer.from([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<AdvMapObjectLink>',
      `\t<Link href="/${shared}#xpointer(/${className})"/>`,
      '\t<RndGroup/>',
      `\t<IconFile>${PANDORA_TEXTURE}</IconFile>`,
      '\t<HideInEditor>true</HideInEditor>',
      '</AdvMapObjectLink>',
    ].join(EOL) + EOL, 'latin1'),
  });
  files.push(hiddenLink(PANDORA_CHEST_LINK, PANDORA_CHEST_SHARED, PANDORA_CHEST_CLASS));

  // THE SPIN PROBES. A second copy of the donor, cube built in with the skin
  // KEPT — bone 3, the one the artifact idle turns — plus the skeleton and the
  // AnimSet. On a Stand (does that class animate at all?) and on a Building of
  // the windmill's type, the one shipped proof that Building plays an AnimSet.
  // Hidden in the palette; the probe map places them by name.
  const spin = copyArt([DONOR_MODEL, DONOR_ANIMSET], `${PANDORA_DIR}/spin`, read, 'pandora:spin');
  const spinModel = spin.at.get(DONOR_MODEL);
  if (!spinModel) throw new Error('pandora: the spin probe lost its model');
  const spinModelDoc = spin.files.get(spinModel)!.toString('latin1');
  const spinGeomAt = resolve(spinModel, hrefOf(spinModelDoc, 'Geometry') ?? '');
  const spinGeomDoc = spinGeomAt ? spin.files.get(spinGeomAt)?.toString('latin1') : null;
  const spinUid = spinGeomDoc ? /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(spinGeomDoc)?.[1] : null;
  const spinBin = spinUid ? spin.files.get(`bin/Geometries/${spinUid.toUpperCase()}`) : null;
  if (!spinGeomAt || !spinBin) throw new Error('pandora: the spin probe lost its geometry');
  const spinBox = cubifyGeometry(spinBin, 'rigid');
  retuneGeometryDoc(spin, spinGeomAt, spinBox);
  paintModelTextures(spin, spinModel); // the texture pair is already in `files`
  files.push(...[...spin.files].map(([path, data]) => ({ path, data })));

  const spinAt = (path: string | undefined): string | undefined => {
    const to = path ? spin.at.get(dataPath(path)) : undefined;
    return to ? `/${to}` : at(path);
  };
  const spinDoc = buildingDoc(
    {
      file: 'PandoraBox_Spin', className: PANDORA_CLASS, messages: MESSAGES,
      model: DONOR_MODEL, animSet: DONOR_ANIMSET, effect: PANDORA_TIERS[0]!.effect,
      footprint: { w: 1, h: 1 }, ground: null,
    },
    { dir: PANDORA_DIR, shared: PANDORA_SPIN_SHARED, link: PANDORA_SPIN_LINK, art: `${PANDORA_DIR}/spin`, text: texts },
    types, { w: 1, h: 1 }, spinAt,
  );
  files.push({ path: PANDORA_SPIN_SHARED, data: Buffer.from(spinDoc, 'latin1') });
  files.push(hiddenLink(PANDORA_SPIN_LINK, PANDORA_SPIN_SHARED, PANDORA_CLASS));

  const millDoc = buildingDoc(
    {
      file: 'PandoraBox_Mill', className: PANDORA_MILL_CLASS, messages: MESSAGES,
      model: DONOR_MODEL, animSet: DONOR_ANIMSET, effect: PANDORA_TIERS[3]!.effect,
      footprint: { w: 1, h: 1 }, ground: null,
      type: 'BUILDING_WINDMILL',
    },
    { dir: PANDORA_DIR, shared: PANDORA_MILL_SHARED, link: PANDORA_MILL_LINK, art: `${PANDORA_DIR}/spin`, text: texts },
    types, { w: 1, h: 1 }, spinAt,
  );
  files.push({ path: PANDORA_MILL_SHARED, data: Buffer.from(millDoc, 'latin1') });
  files.push(hiddenLink(PANDORA_MILL_LINK, PANDORA_MILL_SHARED, PANDORA_MILL_CLASS));

  return files;
}
