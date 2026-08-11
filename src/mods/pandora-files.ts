// Pandora's Box: the object itself — model, texture, glow, definitions.
//
// The box is Heroes III's pandora brought over: a floating, tilted cube a hero
// opens for whatever the map author put inside. The MODEL is ours from the
// vertices up — eight positions, six faces, a texture drawn in code — because
// the container format is decoded well enough to write (geometry-write.ts, and
// docs/GEOMETRY_FORMAT.md §6). The glow is the game's own artifact effect. The
// BEHAVIOUR is not here: the object is a treasure the map's script hooks with a
// touch trigger (see pandora-scripts.ts).
//
// FOUR DOCUMENTS, NOT ONE. The glow's colour states what the box holds — the
// value of the contents, in the artifact glows the game already ships (blue,
// green, gold, red, poorest to richest). An effect is a document reference on
// the SHARED definition, not a per-placement field, so each colour is its own
// shared document and the editor points a placement at the tier its contents
// earn (pandora.ts).

import { parseTypeSpec } from '../schema/typespec.ts';
import {
  animSetDocument, boxGroup, buildGeometry, geometryDocument, groupBBox, materialDocument,
  modelDocument, rotateGroup, skelAnimDocument, skeletonDocument,
} from '../scene/geometry-write.ts';
import { spinClip, writeAnimationGR2, writeSkeletonGR2 } from '../format/gr2-write.ts';
import { textureDoc, writeDDS, writeDXT1 } from '../format/texture.ts';
import type { Image } from '../format/gif.ts';
import { buildingDoc, buildingLink } from './buildings.ts';
import type { BuildingSpec } from './buildings.ts';
import { copyArt, dataPath, resolve } from './mod-art.ts';
import { TYPES, mustRead, utf16 } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { PANDORA_TIERS } from './pandora-contents.ts';
import { pandoraBehaviourFiles } from './pandora-scripts.ts';

const EOL = '\r\n';

// --- what the box is made of -------------------------------------------------

/**
 * How the box sits, and it is a list of four things asked for by eye.
 *
 * SMALLER than a tile (a tile is two world units), FLOATING a little clear of
 * the ground, and TILTED — square to the world a cube reads as scenery, a few
 * degrees off it reads as something set down. The fourth, turning on its own
 * axis, is the rig below rather than a number.
 *
 * The half-extent was 0.55 and is three quarters of that, by eye in the game.
 */
const BOX_HALF = 0.4125;
const BOX_FLOAT = 0.45;
const BOX_TILT: [number, number, number] = [0.14, 0.10, 0.35];

/**
 * THE SPIN, and it is OURS — skeleton and clip both written by
 * `src/format/gr2-write.ts`, not borrowed from an artifact.
 *
 * Reading the game's rigs said what one has to be: a bone the mesh binds to, a
 * clip whose track is named after that bone, and a document chain naming both.
 * Ours is the smallest honest version — one bone at the identity, and a clip
 * that turns it once about the vertical while lifting and dropping it, sampled
 * into linear steps because a quaternion cannot hold a whole turn in one (slerp
 * takes the short way, so 360° would read as standing still).
 *
 * The numbers are ours to choose, and these are chosen to look like an object
 * hanging in the air rather than a fairground ride.
 */
const SPIN_JOINT = 'PandoraBox';
const SPIN_SECONDS = 7.5;
const SPIN_RISE = 0.2;

/** Where everything lives inside the mod. */
export const PANDORA_DIR = 'Buildings/PandoraBox';
const ART_DIR = `${PANDORA_DIR}/art`;

/**
 * The class the box IS: the treasure chest's. Not a Stand — the game refuses a
 * touch trigger on one out loud ('Object "…" cannot be touched', measured) —
 * and the chest class is also the one the AI knows to walk to. What is not
 * settled yet is its own pickup beside our touch, which the probe map's
 * disabled twin asks about.
 */
export const PANDORA_CLASS = 'AdvMapTreasureShared';

/** The shared document of one tier. */
export const pandoraShared = (tier: string): string =>
  `${PANDORA_DIR}/PandoraBox_${tier}.(${PANDORA_CLASS}).xdb`;

/**
 * Is this placement one of our boxes?
 *
 * Asked of the `<Shared>` href, because that is what a placed object HAS: the
 * class alone would answer yes for every chest on the map, and the name is the
 * author's to change. The tier is part of the file name, so a box that has
 * changed colour is still the same question answered the same way.
 *
 * The four tiers are the whole set — the probe twins are not boxes an author
 * places, and a map holding one is asking about the model, not the contents.
 */
export function isPandoraShared(href: string | null | undefined): boolean {
  if (!href) return false;
  const path = href.split('#')[0]!.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return PANDORA_TIERS.some((t) => path === pandoraShared(t.key).toLowerCase());
}

/** The tier a placement is wearing, read off its `<Shared>`, or null. */
export function pandoraTierOfShared(href: string | null | undefined): string | null {
  if (!href) return null;
  const path = href.split('#')[0]!.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return PANDORA_TIERS.find((t) => path === pandoraShared(t.key).toLowerCase())?.key ?? null;
}

/** The `<Shared>` href a placement of this tier points at — document and class,
 *  because the game resolves neither half without the other. */
export const pandoraSharedHref = (tier: string): string =>
  `/${pandoraShared(tier)}#xpointer(/${PANDORA_CLASS})`;

/**
 * The palette entry — one, pointing at the poorest tier a fresh box is.
 *
 * UNDER `Treasures/`, which is not decoration: the Objects tab's groups come
 * from `Editor/MapFilters.xml`, a loose file no mod can add to, and each group
 * is a set of FOLDER PREFIXES. So which group an object lands in is decided by
 * where its link file sits, and the box belongs with the chests and the
 * resource piles rather than among the all-terrain scenery it started in.
 */
export const PANDORA_LINK = 'MapObjects/_(AdvMapObjectLink)/Treasures/PandoraBox.xdb';

// THE PROBE TWINS ARE GONE, and what they answered is written down instead.
//
// Five hidden objects used to ship beside the box — the same cube on a
// windmill-type Building and on an artifact, a twin with no rig, and the rig
// taken apart into bones-without-a-clip and clip-without-bones. They existed to
// ask why a rigged box did not draw, and they answered: a skinned model's
// `<RootMesh>` names the BONE, and a clip binds to a rig through a
// `granny_model` by name (docs/engineInternals/PANDORA_OBJECT.md). The box has
// turned on its own axis ever since, so the twins are five documents, five
// palette entries and five ways for a map to reference something that is not a
// box. Removed rather than kept "just in case": the questions they asked are
// answered, and the answers are cheaper to read than to re-run.

/**
 * The vertex-to-bone binding every vertex of the box carries: full weight on
 * bone 0 and nothing else.
 *
 * Read off the shipped treasure chest, whose every vertex is this exact entry,
 * and it is also the whole binding an artifact needs — that rig HAS only bone 0.
 * Four float weights, the same four quantized to bytes, then four bone indices
 * (docs/ANIMATION_FORMAT.md §4).
 */
const BONE0_SKIN = Buffer.from('0000803f000000000000000000000000ff00000000000000', 'hex');

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
 * And the box itself: geometry, model document, and the same picture again as a
 * compressed surface a material can read.
 *
 * The icon pair above is uncompressed because the interface reads it at one
 * size; a model's texture is DXT1 with a mip chain, and one document cannot be
 * both. The uid is ours and fixed — the engine keys the binary by that name and
 * nothing else, so a constant is a name, not an identifier to be generated.
 */
const PANDORA_UID = 'B0AD0000-1111-4222-8333-C0DE0BADC0DE';
export const PANDORA_MODEL = `${PANDORA_DIR}/PandoraBox.(Model).xdb`;
const PANDORA_GEOMETRY = `${PANDORA_DIR}/PandoraBox.(Geometry).xdb`;
const PANDORA_MATERIAL = `${PANDORA_DIR}/PandoraBox.(Material).xdb`;
const PANDORA_SKIN_TEXTURE = `${PANDORA_DIR}/PandoraBoxSkin.(Texture).xdb`;
const PANDORA_SKIN_DDS = 'PandoraBoxSkin.dds';
const PANDORA_SKELETON = `${PANDORA_DIR}/PandoraBox.(Skeleton).xdb`;
const PANDORA_SKELETON_UID = 'B0AD0002-1111-4222-8333-C0DE0BADC0DE';
const PANDORA_CLIP = `${PANDORA_DIR}/PandoraBoxIdle.(BasicSkelAnim).xdb`;
const PANDORA_CLIP_UID = 'B0AD0003-1111-4222-8333-C0DE0BADC0DE';
const PANDORA_ANIMSET = `${PANDORA_DIR}/PandoraBox.(AnimSet).xdb`;
/** The control's documents — same mesh, no rig named anywhere. */

/**
 * Every file the box's LOOK is made of, and only one of them copied.
 *
 * This is what reading the container bought. The cube is eight positions, six
 * faces, twenty-four render vertices and the two remaps the format asks for
 * (`src/scene/geometry-write.ts`); the documents beside it name our texture and
 * state the box the vertices came out in; the texture is our own drawing, DXT1
 * with mips. Nothing is sculpted out of somebody else's mesh, so nothing carries
 * a field we did not write on purpose — which is exactly the failure the donors
 * kept producing.
 *
 * That now includes the RIG. The skeleton and the clip are Granny files written
 * by `src/format/gr2-write.ts` — one bone at the identity, and a turn about the
 * vertical sampled into linear steps — so the box spins on a rig of ours rather
 * than on an artifact's borrowed bones.
 */
function boxArtFiles(): ModFile[] {
  const centre: [number, number, number] = [0, 0, BOX_FLOAT + BOX_HALF];
  const cube = boxGroup(centre, [BOX_HALF, BOX_HALF, BOX_HALF]);
  const group = rotateGroup(cube, BOX_TILT, centre);
  group.skin = Buffer.concat(Array.from({ length: group.positions.length / 3 }, () => BONE0_SKIN));
  const image = pandoraTexture();
  return [
    { path: `bin/Geometries/${PANDORA_UID}`, data: buildGeometry([[group]]) },
    {
      path: PANDORA_MODEL,
      data: Buffer.from(modelDocument({
        materials: [`/${PANDORA_MATERIAL}`],
        geometry: `/${PANDORA_GEOMETRY}`,
        skeleton: `/${PANDORA_SKELETON}`,
      }), 'latin1'),
    },
    {
      path: PANDORA_GEOMETRY,
      data: Buffer.from(geometryDocument({
        uid: PANDORA_UID, bbox: groupBBox([group]),
        // The node is the bone; the mesh hanging off it is `<node>Shape`, which
        // is the Maya naming every shipped model follows.
        meshNames: [`${SPIN_JOINT}Shape`], rootJoint: SPIN_JOINT,
      }), 'latin1'),
    },
    {
      path: PANDORA_SKELETON,
      data: Buffer.from(skeletonDocument({ uid: PANDORA_SKELETON_UID, rootJoint: SPIN_JOINT }), 'latin1'),
    },
    {
      path: `bin/Skeletons/${PANDORA_SKELETON_UID}`,
      // One name for the model, the skeleton, the track group and the bone —
      // the way the artifact rig is `Artefact` four times over.
      data: writeSkeletonGR2(SPIN_JOINT, [{ name: SPIN_JOINT }]),
    },
    {
      path: `bin/animations/${PANDORA_CLIP_UID}`,
      data: (() => {
        const clip = spinClip(SPIN_JOINT, SPIN_SECONDS, SPIN_RISE);
        // The clip carries the rig too — model, skeleton and track group under
        // one name, the way every shipped animation does.
        return writeAnimationGR2(clip.name, clip.duration, clip.tracks, [{ name: SPIN_JOINT }]);
      })(),
    },
    {
      path: PANDORA_CLIP,
      data: Buffer.from(skelAnimDocument({ uid: PANDORA_CLIP_UID, rootJoint: SPIN_JOINT }), 'latin1'),
    },
    {
      path: PANDORA_ANIMSET,
      data: Buffer.from(animSetDocument({
        clips: [{ kind: 'idle00', anim: `/${PANDORA_CLIP}` }],
        rootJoint: SPIN_JOINT,
      }), 'latin1'),
    },
    {
      path: PANDORA_MATERIAL,
      data: Buffer.from(materialDocument({ texture: `/${PANDORA_SKIN_TEXTURE}` }), 'latin1'),
    },
    {
      path: PANDORA_SKIN_TEXTURE,
      data: Buffer.from(textureDoc({
        dds: PANDORA_SKIN_DDS, width: image.width, height: image.height,
        addressing: 'CLAMP', compressed: true, conversion: 'CONVERT_ORDINARY',
      }), 'latin1'),
    },
    { path: `${PANDORA_DIR}/${PANDORA_SKIN_DDS}`, data: writeDXT1(image) },
  ];
}

/** The palette icon — the painted face, uncompressed the way the interface
 *  reads it. The model wears the same drawing as DXT1; see boxArtFiles. */
function iconFiles(): ModFile[] {
  const image = pandoraTexture();
  return [
    { path: PANDORA_TEXTURE, data: Buffer.from(textureDoc({ dds: PANDORA_DDS, width: image.width, height: image.height, addressing: 'CLAMP' }), 'latin1') },
    { path: `${PANDORA_DIR}/${PANDORA_DDS}`, data: writeDDS(image) },
  ];
}

/** What the box says for itself, one file per message slot. The chest class
 *  reads FOUR — its pickup dialog is index 2 and the artifact-found line 3,
 *  and a document that stops short answers "Invalid message index" in game. */
const MESSAGES: Record<string, string> = {
  name: "Pandora's Box",
  description: 'A box that holds whatever its maker sealed inside — riches or ruin. Opening it is the only way to find out which.',
  dialogText: 'The box is sealed, and something waits inside. Open it?',
  artifactFound: 'Sealed inside the box:',
};

/**
 * Every file the Pandora's Box ships: the four shared documents, the palette
 * link, the copied-and-rebuilt art, the texts.
 */
export function buildPandora(read: DataReader): ModFile[] {
  const types = parseTypeSpec(mustRead(read, TYPES));

  // ONLY THE GLOWS ARE COPIED. Model, geometry, texture, skeleton and clip are
  // all written here — see boxArtFiles above, docs/GEOMETRY_FORMAT.md §6 for the
  // mesh container and src/format/gr2-write.ts for the rig.
  const seeds = PANDORA_TIERS.map((t) => t.effect);
  const copied = copyArt(seeds, ART_DIR, read, 'pandora:box');
  const absent = seeds.filter((s) => !copied.at.has(s));
  if (absent.length) throw new Error(`pandora: the game's data has no ${absent.join(', ')}`);

  const files: ModFile[] = [...copied.files].map(([path, data]) => ({ path, data }));
  files.push(...iconFiles(), ...boxArtFiles());

  // The four shared documents — same box, four glows.
  //
  // A path resolves to its COPY when the file came out of the game, and to
  // itself when it is one of ours: the model and its texture live in the mod
  // already, and asking the copy table for them would answer nothing.
  const at = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    const to = copied.at.get(dataPath(path));
    return to ? `/${to}` : `/${dataPath(path)}`;
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
      model: PANDORA_MODEL,
      // The turn on its own axis, and the bob with it: the artifact idle.
      animSet: PANDORA_ANIMSET,
      effect: tier.effect,
      footprint: { w: 1, h: 1 },
      ground: null,
      type: 'TREASURE_CHEST',
      fields: { MinResource: '1', MaxResource: '1' },
    };
    const doc = buildingDoc(spec, { dir: PANDORA_DIR, shared: pandoraShared(tier.key), link: PANDORA_LINK, art: ART_DIR, text: texts }, types, { w: 1, h: 1 }, at);
    files.push({ path: pandoraShared(tier.key), data: Buffer.from(doc, 'latin1') });
  }

  // One palette entry; a fresh box is empty, and empty is the poorest glow.
  const first = PANDORA_TIERS[0]!;
  const linkSpec: BuildingSpec = {
    file: 'PandoraBox', className: PANDORA_CLASS, messages: MESSAGES, model: PANDORA_MODEL,
  };
  // the painted face doubles as the palette icon
  files.push({
    path: PANDORA_LINK,
    data: Buffer.from(buildingLink(linkSpec, { dir: PANDORA_DIR, shared: pandoraShared(first.key), link: PANDORA_LINK, art: ART_DIR, text: texts }, PANDORA_TEXTURE), 'latin1'),
  });

  // The behaviour the maps' generated blocks doFile, and its texts.
  files.push(...pandoraBehaviourFiles());

  return files;
}
