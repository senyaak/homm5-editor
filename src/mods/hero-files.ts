// The files a mod ships for its heroes.
//
// A hero costs the game nothing global (see heroes.ts): no table, no enum, no
// ceiling. So this is only the hero's own document, its palette entry and the
// art copied in beside them — and the art is the reason it is not a one-liner,
// since a hero's face and its model come from different documents and both
// have to be repointed at our copies.



import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { artOf, heroArtDir, heroDoc, heroLink, heroPaths, repointArt, textureHref } from './heroes.ts';

import { fitSquare, magnify, textureDoc, writeDDS } from '../format/texture.ts';
import { readPicture } from '../format/png.ts';
import { copyArt } from './mod-art.ts';
import { mustRead, utf16 } from './mod-files.ts';
import type { HeroPaths, HeroSpec } from './heroes.ts';
import type { ModSpecialization } from './specializations.ts';
import type { Image } from '../format/gif.ts';
import type { DataReader, ModFile } from './mod-files.ts';

/**
 * One picture, as the pair the game reads.
 *
 * The artifact side does exactly this for its icons; the only thing added here
 * is that a portrait may have to GROW — see `magnify`. Enlargement is by whole
 * pixels and only when the picture is smaller than the canvas, so an icon that
 * already fits is placed rather than touched.
 */
export function texturePair(picture: string, size: number, dds: string, xdb: string): ModFile[] {
  let image: Image = readPicture(readFileSync(picture), basename(picture));
  const times = Math.floor(size / Math.max(image.width, image.height));
  if (times > 1) image = magnify(image, times);
  const fitted = fitSquare(image, size);
  return [
    { path: dds, data: writeDDS(fitted) },
    {
      path: xdb,
      data: Buffer.from(textureDoc({
        dds: basename(dds),
        width: fitted.width,
        height: fitted.height,
        // The picture's NAME, not the author's filesystem — the same rule the
        // artifact icons follow, and for the same reason.
        source: basename(picture),
      }), 'latin1'),
    },
  ];
}

/**
 * His own face and specialization icon, built from pictures — and the hrefs
 * that have to point at them.
 *
 * Returned rather than applied, because the document is written from the spec:
 * what this hands back is merged into the spec BEFORE `heroDoc` reads it, so
 * the document comes out already naming his own textures instead of naming the
 * donor's and being corrected afterwards.
 */
function ownPictures(h: HeroSpec, p: HeroPaths): { files: ModFile[]; hrefs: Partial<HeroSpec> } {
  const files: ModFile[] = [];
  const hrefs: Partial<HeroSpec> = {};
  if (h.portrait) {
    files.push(...texturePair(h.portrait, 128, p.faceDDS, p.faceXDB));
    files.push(...texturePair(h.portrait, 64, p.faceSmallDDS, p.faceSmallXDB));
    hrefs.face = textureHref(p.faceXDB);
    hrefs.faceSmall = textureHref(p.faceSmallXDB);
  }
  if (h.specializationPicture) {
    files.push(...texturePair(h.specializationPicture, 64, p.specIconDDS, p.specIconXDB));
    hrefs.specializationIcon = textureHref(p.specIconXDB);
  }
  return { files, hrefs };
}

/**
 * A hero holding a specialization of the mod's, with its words and picture
 * filled in — unless he brought his own.
 *
 * The game keeps a specialization's name, description and icon on the HERO and
 * not with the specialization, which is why a Sylvan hero borrowing a Necropolis
 * one is described as an embalmer. That is the right place for an override and
 * the wrong place for a default: a specialization of OURS knows what it is
 * called, and every hero holding it should say the same thing without anyone
 * retyping it. So this fills the three fields and steps back.
 *
 * WHAT IT DOES NOT DO IS HAND OUT THE ABILITY. A specialization whose gift is a
 * spell could have it written into every holder's `spellIDs` right here, in one
 * line, with no code anywhere — and that would be the wrong answer twice over.
 * The engine would know nothing about the specialization at all: the connection
 * would exist only in files this build happened to write, so a hero it did not
 * build would hold the specialization and get nothing. The gift is handed out at
 * RUN TIME instead, by the script the mod generates, over
 * `H5EHeroSpecialization` — see artifact-scripts.ts and
 * native/lua/hero-specialization.c.
 */
function withSpecialization(h: HeroSpec, specs: readonly ModSpecialization[]): HeroSpec {
  const spec = specs.find((s) => s.id === h.specialization);
  if (!spec) return h;
  return {
    ...h,
    specializationName: h.specializationName || spec.name,
    specializationDescription: h.specializationDescription || spec.description,
    specializationPicture: h.specializationPicture || spec.picture,
    specializationIcon: h.specializationIcon || spec.icon,
  };
}

/**
 * The files every hero contributes: his document, his name and his biography.
 *
 * Three files and nothing else. His art is REFERENCED like a dwelling's model —
 * he is built by reading a shipped hero of his faction and replacing what makes
 * him himself, so the model, animations, arena character and trace stay the
 * donor's hrefs. Copying that closure would add two megabytes to buy an ability
 * to recolour nobody has asked for yet; the day a hero wants his own look, the
 * copying already exists for creatures and this is where it hooks in.
 */
export function buildHeroes(
  heroes: readonly HeroSpec[], read: DataReader, specializations: readonly ModSpecialization[] = [],
): ModFile[] {
  const files: ModFile[] = [];
  for (const spec of heroes) {
    const h = withSpecialization(spec, specializations);
    const p = heroPaths(h);
    // His own pictures first: the document is written from the spec, so the
    // hrefs they produce have to be in it before it is written.
    const pictures = ownPictures(h, p);
    files.push(...pictures.files);
    let doc = heroDoc({ ...h, ...pictures.hrefs }, mustRead(read, h.basedOn), p);

    // His looks, copied into his own folder — the same closure walk a creature
    // gets, and for the same reason: with the art inside, recolouring a texture
    // or swapping a mesh is an edit to the mod and reaches nothing else. It was
    // hrefs at the shipped files for a while, which is three kilobytes and no
    // way to change how he looks without changing how the donor looks too.
    //
    // Files the author brought are NOT seeds: they are already in his folder,
    // and walking them would copy whatever they point at back out of the game.
    const own = new Set([
      ...Object.keys(h.ownFiles ?? {}),
      // The textures just built are his too, and for the same reason must not
      // be walked: they live in the mod, and the reader here reads the GAME.
      ...pictures.files.map((f) => f.path),
    ].map((href) => href.replace(/^\/+/, '')));
    const seeds = Object.values(artOf(doc))
      .map((href) => href.split('#')[0]!.replace(/^\/+/, ''))
      .filter((rel) => rel && !own.has(rel));
    if (seeds.length) {
      const copied = copyArt(seeds, heroArtDir(p), read, h.id);
      for (const [path, data] of copied.files) files.push({ path, data });
      doc = repointArt(doc, copied.at);
    }

    files.push({ path: p.shared, data: Buffer.from(doc, 'latin1') });
    // The palette entry, so he can be PLACED and not merely hired: the Objects
    // tab is built from these link files, read through the mounted chain.
    files.push({ path: p.link, data: Buffer.from(heroLink(p), 'latin1') });
    files.push({ path: p.name, data: utf16(h.name) });
    files.push({ path: p.biography, data: utf16(h.biography) });
    // Anything the author brought from disk, copied verbatim into his folder:
    // it is already in the game's format, so there is nothing to convert.
    for (const [href, from] of Object.entries(h.ownFiles ?? {})) {
      files.push({ path: href.replace(/^\/+/, ''), data: readFileSync(from) });
    }
    if (h.specializationName) files.push({ path: p.specName, data: utf16(h.specializationName) });
    if (h.specializationDescription) {
      files.push({ path: p.specDescription, data: utf16(h.specializationDescription) });
    }
  }
  return files;
}
