// The files a mod ships for its heroes.
//
// A hero costs the game nothing global (see heroes.ts): no table, no enum, no
// ceiling. So this is only the hero's own document, its palette entry and the
// art copied in beside them — and the art is the reason it is not a one-liner,
// since a hero's face and its model come from different documents and both
// have to be repointed at our copies.



import { readFileSync } from 'node:fs';
import { artOf, heroArtDir, heroDoc, heroLink, heroPaths, repointArt } from './heroes.ts';
import { copyArt } from './mod-art.ts';
import { mustRead, utf16 } from './mod-files.ts';
import type { HeroSpec } from './heroes.ts';
import type { DataReader, ModFile } from './mod-files.ts';

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
export function buildHeroes(heroes: readonly HeroSpec[], read: DataReader): ModFile[] {
  const files: ModFile[] = [];
  for (const h of heroes) {
    const p = heroPaths(h);
    let doc = heroDoc(h, mustRead(read, h.basedOn), p);

    // His looks, copied into his own folder — the same closure walk a creature
    // gets, and for the same reason: with the art inside, recolouring a texture
    // or swapping a mesh is an edit to the mod and reaches nothing else. It was
    // hrefs at the shipped files for a while, which is three kilobytes and no
    // way to change how he looks without changing how the donor looks too.
    //
    // Files the author brought are NOT seeds: they are already in his folder,
    // and walking them would copy whatever they point at back out of the game.
    const own = new Set(Object.keys(h.ownFiles ?? {}).map((href) => href.replace(/^\/+/, '')));
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
