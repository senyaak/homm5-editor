// The files a mod ships for its dwellings, and the model baking that goes with
// them.
//
// Like a hero, a dwelling costs the game nothing global — but unlike one it is
// a BUILDING, so its model has to sit on the ground at the right size: the
// bake reads the borrowed geometry, finds where its ground plane is, and
// retunes the bounding box the game places it by.



import { placeGeometry, positionsBox, wideBase } from '../scene/geometry.ts';
import { parseTypeSpec } from '../schema/typespec.ts';
import {
  MESSAGE_SLOTS, dwellingDoc, dwellingLink, dwellingPaths, footprintOf, isRef, refPath,
} from './dwellings.ts';
import { copyArt, dataPath, resolve } from './mod-art.ts';
import { TYPES, mustRead, utf16 } from './mod-files.ts';
import { groundLevel, retuneBox } from './model-box.ts';
import { hrefOf } from './xml-edit.ts';
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
 * Two things are wrong with a town building as it ships, and both are in the
 * geometry rather than in any field: it is 2 to 3 times map scale, and its
 * positions are where it stands in the town scene rather than around the origin.
 * So the whole art closure is copied (fresh uids, exactly as a creature's is) and
 * then the copied POSITIONS are moved to the origin and scaled — the only array
 * in the file that holds a coordinate, see placeGeometry.
 *
 * What follows the positions is the geometry document's own bounding box, which
 * the engine and the editor both take at face value, and the AI geometry beside
 * it, which is the same container and gets the same treatment.
 */
function bakeModel(d: DwellingSpec, p: DwellingPaths, read: DataReader): {
  files: ModFile[]; model: string; sunk: boolean; visible: Footprint;
} {
  let pedestalSunk = false;
  let visible: Footprint = { w: 1, h: 1 };
  const source = dataPath(d.model);
  const copied = copyArt([source], p.art, read, `dwelling:${d.file}`);
  const modelPath = copied.at.get(source);
  if (!modelPath) throw new Error(`${d.file}: ${d.model} is not in the game's data`);

  const tiles = d.bake!.tiles;
  if (!(tiles > 0)) throw new Error(`${d.file}: bake needs a size in tiles`);
  // The first geometry is the model's own; the AI geometry hanging off it follows
  // by the same transform so the two do not disagree about where the walls are.
  const target = tiles * 2;
  let placement: { scale: number; shift: [number, number, number] } | null = null;

  const geometryOf = (docPath: string): { path: string; text: string; uid: string; bin: string } | null => {
    const doc = copied.files.get(docPath)?.toString('latin1');
    if (!doc) return null;
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
    if (!uid) return null;
    const bin = doc.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<AIGeometry')
      || /<AIGeometry\b/.test(doc.slice(0, 200))
      ? `bin/AIGeometries/${uid.toUpperCase()}`
      : `bin/Geometries/${uid.toUpperCase()}`;
    return { path: docPath, text: doc, uid, bin };
  };

  /** Every geometry document the copy holds, model's own first. */
  const geometries: string[] = [];
  const modelDoc = copied.files.get(modelPath)!.toString('latin1');
  const first = hrefOf(modelDoc, 'Geometry');
  if (!first) throw new Error(`${d.file}: ${d.model} names no geometry`);
  const at = resolve(modelPath, first);
  if (at) geometries.push(at);
  for (const g of [...geometries]) {
    const doc = copied.files.get(g)?.toString('latin1');
    const ai = doc ? hrefOf(doc, 'AIGeometry') : null;
    const aiAt = ai ? resolve(g, ai) : null;
    if (aiAt && copied.files.has(aiAt)) geometries.push(aiAt);
  }

  for (const [i, g] of geometries.entries()) {
    const geom = geometryOf(g);
    if (!geom) continue;
    const bytes = copied.files.get(geom.bin);
    if (!bytes) continue;
    if (!placement) {
      const box = positionsBox(bytes);
      if (!box) throw new Error(`${d.file}: cannot read the positions of ${geom.bin}`);
      const widest = Math.max(box.sx, box.sy);
      if (!(widest > 0)) throw new Error(`${d.file}: ${d.model} has no size`);
      // Where the ground is. A town building does not stand on its own base: the
      // Sylvan town is built up in terraces, so every one of its buildings sits
      // on a PEDESTAL — a column the town's landscape hides — and a model placed
      // by its lowest point is a building on a stalk. The pedestal mesh is named
      // in the geometry document (`…Pod_O`, the game's word for a base, the same
      // one its materials use), so the ground is the TOP of that column and the
      // column goes below the map. The terrain then hides it, which is why a baked
      // dwelling cuts no hole in the ground.
      const found = d.bake!.ground ?? groundLevel(geom.text, bytes) ?? wideBase(bytes);
      pedestalSunk = found !== null;
      const floor = found ?? box.cz - box.sz / 2;
      // Sized and centred on what will be ABOVE the ground, not on the whole
      // model: a town building's art keeps going below its terrace, and the
      // Necropolis Estate's buried rock makes the file half again as wide as the
      // manor on top of it. Scaling by that shrank the manor to a doormat.
      const seen = positionsBox(bytes, floor) ?? box;
      const across = Math.max(seen.sx, seen.sy);
      const scale = target / (across > 0 ? across : widest);
      placement = { scale, shift: [-seen.cx, -seen.cy, -floor] };
      // The footprint follows what will be SEEN, not the whole file: a buried base
      // is wider than the building on it often enough (the Hall of Darkness) that
      // measuring the finished bounding box asks for tiles nothing stands on.
      const tiles = (size: number): number => Math.max(1, Math.round((size * scale) / 2));
      visible = { w: tiles(seen.sx), h: tiles(seen.sy) };
    }
    const placed = placeGeometry(bytes, placement);
    if (placed) {
      copied.files.set(geom.bin, placed.data);
      copied.files.set(geom.path, Buffer.from(retuneBox(geom.text, placed.bbox, placement), 'latin1'));
      continue;
    }
    // The model's own geometry must be placeable — that is the mesh on screen.
    if (i === 0) throw new Error(`${d.file}: cannot place ${geom.bin}`);
    // The AI's copy of it is a different container, and a mesh the AI thinks is
    // three times the size is worse than none: 598 shipped models carry no AI
    // geometry at all, so the reference goes and its files with it.
    copied.files.delete(geom.path);
    copied.files.delete(geom.bin);
    const owner = geometries[i - 1]!;
    const doc = copied.files.get(owner)?.toString('latin1');
    if (doc) copied.files.set(owner, Buffer.from(doc.replace(/<AIGeometry href="[^"]*"\s*\/>/, '<AIGeometry/>'), 'latin1'));
  }

  return {
    files: [...copied.files].map(([path, data]) => ({ path, data })),
    model: `/${modelPath}#xpointer(/Model)`,
    sunk: pedestalSunk,
    visible,
  };
}
