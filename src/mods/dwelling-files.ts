// The files a mod ships for its dwellings, and the model baking that goes with
// them.
//
// Like a hero, a dwelling costs the game nothing global — but unlike one it is
// a BUILDING, so its model has to sit on the ground at the right size: the
// bake reads the borrowed geometry, finds where its ground plane is, and
// retunes the bounding box the game places it by.



import { parseTypeSpec } from '../schema/typespec.ts';
import { bakeCopiedModel } from './bake-model.ts';
import {
  MESSAGE_SLOTS, dwellingDoc, dwellingLink, dwellingPaths, footprintOf, isRef, refPath,
} from './dwellings.ts';
import { copyArt, dataPath } from './mod-art.ts';
import { TYPES, mustRead, utf16 } from './mod-files.ts';
import type { DwellingPaths, DwellingSpec, Footprint } from './dwellings.ts';
import type { DataReader, ModFile } from './mod-files.ts';

export function buildDwellings(dwellings: readonly DwellingSpec[], read: DataReader): ModFile[] {
  if (!dwellings.length) return [];
  const files: ModFile[] = [];
  // Once for all of them: the field order every document is written in.
  const types = parseTypeSpec(mustRead(read, TYPES));
  const text = (rel: string): string | null => {
    const b = read(rel);
    return b ? b.toString('latin1') : null;
  };
  // What earlier dwellings put in the mod. A second dwelling may point at a model
  // the first one baked — two buildings that look alike and hire differently — and
  // baking the same town art twice would double a megabyte for nothing.
  const produced = new Map<string, Buffer>();
  const readAny = (rel: string): string | null => {
    const mine = produced.get(rel);
    return mine ? mine.toString('latin1') : text(rel);
  };
  const emit = (path: string, data: Buffer): void => {
    files.push({ path, data });
    produced.set(path, data);
  };

  for (const d of dwellings) {
    const p = dwellingPaths(d);
    if (!readAny(refPath(d.model))) throw new Error(`${d.file}: no model at ${d.model}`);

    // A town building has to be copied and resized before it is a map object;
    // anything already at map scale is referenced where it lies.
    let model = d.model;
    let ground = d.ground;
    let baked: Footprint | null = null;
    if (d.bake) {
      const made = bakeModel(d, p, read);
      for (const f of made.files) emit(f.path, f.data);
      model = made.model;
      baked = made.visible;
      // Its pedestal is under the map; cutting a hole would show the hole.
      if (made.sunk && ground === undefined) ground = null;
    } else if (produced.has(refPath(model)) && ground === undefined) {
      // Pointing at a model another dwelling baked: its pedestal is under the map
      // too, so this one must not cut a hole either.
      ground = null;
    }
    // Measured off the art; the spec overrides either area if it wants to.
    const measured = d.footprint && ground ? ground : baked ?? footprintOf(model, readAny);
    if (!measured) {
      throw new Error(`${d.file}: cannot measure ${model} — give footprint and ground in the spec instead`);
    }
    emit(p.shared, Buffer.from(dwellingDoc({ ...d, model, ground }, p, types, measured), 'latin1'));
    // The palette tile. The editor's thumbnail cache is keyed by link path and
    // only the game's installer writes it, so the link names a texture instead —
    // the dwelling's own icon, which is a shipped one unless the mod says else.
    emit(p.link, Buffer.from(dwellingLink(p, refPath(d.icon ?? '')), 'latin1'));
    for (const slot of MESSAGE_SLOTS) {
      const message = d[slot];
      if (message && !isRef(message)) emit(p.text[slot], utf16(message));
    }
  }
  return files;
}

/**
 * Copy a town-screen building into the mod as an adventure-map model.
 *
 * The whole art closure is copied first (fresh uids, exactly as a creature's is)
 * and then the copy is rescaled and recentred in place — see bake-model.ts,
 * which does that part for a building too.
 */
function bakeModel(d: DwellingSpec, p: DwellingPaths, read: DataReader): {
  files: ModFile[]; model: string; sunk: boolean; visible: Footprint;
} {
  const source = dataPath(d.model);
  const copied = copyArt([source], p.art, read, `dwelling:${d.file}`);
  const modelPath = copied.at.get(source);
  if (!modelPath) throw new Error(`${d.file}: ${d.model} is not in the game's data`);

  const baked = bakeCopiedModel(copied, modelPath, d.bake!, d.file);
  return {
    files: [...copied.files].map(([path, data]) => ({ path, data })),
    model: `/${modelPath}#xpointer(/Model)`,
    sunk: baked.sunk,
    visible: baked.visible,
  };
}
