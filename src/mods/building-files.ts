// The files a mod ships for its buildings.
//
// EVERY BUILDING CARRIES ITS OWN ART. The whole reachable closure behind the
// model — geometry, materials, textures, the binaries under `bin/…` — is copied
// under the building's folder with fresh uids, and so are its animation set,
// effects, sound and icon. The document then names the copies and nothing of the
// game's, which is what makes a building of ours editable: recolouring a texture
// or swapping a mesh is an edit to the mod, and the shipped file it came from is
// untouched.
//
// This is the opposite of what dwellings used to do (reference the shipped
// model, add no megabytes) and it is the deliberate call: a building nobody can
// change is not content, it is a pointer.

import { parseTypeSpec } from '../schema/typespec.ts';
import {
  buildingDoc, buildingLink, buildingPaths, footprintOf, messageSlots, refPath,
} from './buildings.ts';
import { copyArt, dataPath, repaint } from './mod-art.ts';
import { TYPES, mustRead, utf16 } from './mod-files.ts';
import type { BuildingSpec } from './buildings.ts';
import type { DataReader, ModFile } from './mod-files.ts';

/** The art slots, in the order a document names them. */
const ART_SLOTS = ['model', 'animSet', 'effect', 'effectWhenOwned', 'sound', 'icon'] as const;

export function buildBuildings(buildings: readonly BuildingSpec[], read: DataReader): ModFile[] {
  if (!buildings.length) return [];
  // Once for all of them: the field order every document is written in.
  const types = parseTypeSpec(mustRead(read, TYPES));
  const files: ModFile[] = [];

  for (const b of buildings) {
    const p = buildingPaths(b);
    if (!b.model) throw new Error(`${b.file}: a building needs a model`);

    // One copy per building, seeded with everything it points at. copyArt walks
    // the hrefs, so naming the six roots reaches the whole tree.
    const seeds = ART_SLOTS.map((s) => b[s]).filter((v): v is string => !!v).map(dataPath);
    const copied = copyArt(seeds, p.art, read, `building:${b.file}`);
    // `missing` is not an error by itself: shipped documents name their AUTHORING
    // sources (`models/…/windmill.mb`, `texture/…/Windmill.tga`) and those were
    // never in the game's data. What must be there is what the spec named.
    const absent = seeds.filter((s) => !copied.at.has(s));
    if (absent.length) throw new Error(`${b.file}: the game's data has no ${absent.join(', ')}`);
    // Recorded on the building and reapplied here, so a rebuild repaints rather
    // than losing the colours to a fresh copy of the donor's art.
    if (b.recolor) repaint(copied.files, b.recolor);

    /** Where a source path's copy landed, as an href into the mod. */
    const at = (path: string | undefined): string | undefined => {
      if (!path) return undefined;
      const to = copied.at.get(dataPath(path));
      return to ? `/${to}` : undefined;
    };

    const readCopy = (rel: string): string | null => {
      const mine = copied.files.get(rel);
      if (mine) return mine.toString('latin1');
      const data = read(rel);
      return data ? data.toString('latin1') : null;
    };
    // Measured off the COPY, which is what will stand on the map — a baked or
    // repainted model may not be the size its source was.
    const modelCopy = copied.at.get(dataPath(b.model));
    if (!modelCopy) throw new Error(`${b.file}: ${b.model} is not in the game's data`);
    const measured = b.footprint ?? footprintOf(modelCopy, readCopy);
    if (!measured) throw new Error(`${b.file}: cannot measure ${b.model} — give a footprint in the spec instead`);

    for (const [path, data] of copied.files) files.push({ path, data });
    files.push({ path: p.shared, data: Buffer.from(buildingDoc(b, p, types, measured, at), 'latin1') });
    // The palette tile. The editor's thumbnail cache is keyed by link path and
    // only the game's installer writes it, so the link names a texture instead —
    // our own copy of the icon, when the building has one.
    files.push({ path: p.link, data: Buffer.from(buildingLink(b, p, refPath(at(b.icon) ?? '')), 'latin1') });
    for (const slot of messageSlots(b.className)) {
      const message = b.messages[slot];
      if (message) files.push({ path: p.text[slot]!, data: utf16(message) });
    }
  }
  return files;
}
