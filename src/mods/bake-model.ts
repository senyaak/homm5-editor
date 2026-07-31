// Bringing a town-screen building down to the adventure map.
//
// Two things are wrong with a town building as it ships, and both are in the
// GEOMETRY rather than in any field: it is 2 to 3 times map scale, and its
// positions are where it stands in the town scene rather than around the origin
// (the Unicorn Glade's centre is at 280, 328). Nothing in the format scales a
// model, so the copy's positions are moved and scaled in place — the only array
// in the file that holds a coordinate, see placeGeometry.
//
// What follows the positions is the geometry document's own bounding box, which
// the engine and the editor both take at face value, and the AI geometry beside
// it, which is the same container and gets the same treatment.
//
// This works on an art tree ALREADY COPIED into the mod, so whatever wanted the
// copy — a dwelling, a building — decides what else went into it.

import { placeGeometry, positionsBox, wideBase } from '../scene/geometry.ts';
import type { Footprint } from './footprint.ts';
import { groundLevel, retuneBox } from './model-box.ts';
import { resolve } from './mod-art.ts';
import type { ArtCopy } from './mod-art.ts';
import { hrefOf } from './xml-edit.ts';

/** How big the result should be, and where its ground is. */
export interface BakeOptions {
  /** How many tiles across the result should be, at its widest. */
  tiles: number;
  /**
   * Where the ground is in the SOURCE model's own coordinates, when the
   * measurement gets it wrong. Everything below goes under the map, which the
   * terrain then hides. Omitted: found from the model — see groundLevel.
   */
  ground?: number;
}

export interface BakeResult {
  /** Its pedestal ended up under the map, so cutting a hole would show the hole. */
  sunk: boolean;
  /** What will be SEEN, in tiles — the footprint to declare. */
  visible: Footprint;
}

/**
 * Rescale and recentre a copied model, in place.
 *
 * `copied` is MUTATED: the geometry binaries and the documents describing them
 * are replaced with the placed versions.
 */
export function bakeCopiedModel(
  copied: ArtCopy, modelPath: string, opt: BakeOptions, label: string,
): BakeResult {
  let pedestalSunk = false;
  let visible: Footprint = { w: 1, h: 1 };
  if (!(opt.tiles > 0)) throw new Error(`${label}: bake needs a size in tiles`);
  const target = opt.tiles * 2;
  let placement: { scale: number; shift: [number, number, number] } | null = null;

  const geometryOf = (docPath: string): { path: string; text: string; uid: string; bin: string } | null => {
    const doc = copied.files.get(docPath)?.toString('latin1');
    if (!doc) return null;
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
    if (!uid) return null;
    const bin = /<AIGeometry\b/.test(doc.slice(0, 200))
      ? `bin/AIGeometries/${uid.toUpperCase()}`
      : `bin/Geometries/${uid.toUpperCase()}`;
    return { path: docPath, text: doc, uid, bin };
  };

  /** Every geometry document the copy holds, the model's own first. */
  const geometries: string[] = [];
  const modelDoc = copied.files.get(modelPath)?.toString('latin1');
  if (!modelDoc) throw new Error(`${label}: ${modelPath} is not in the copied art`);
  const first = hrefOf(modelDoc, 'Geometry');
  if (!first) throw new Error(`${label}: ${modelPath} names no geometry`);
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
      if (!box) throw new Error(`${label}: cannot read the positions of ${geom.bin}`);
      const widest = Math.max(box.sx, box.sy);
      if (!(widest > 0)) throw new Error(`${label}: ${modelPath} has no size`);
      // Where the ground is. A town building does not stand on its own base: the
      // Sylvan town is built up in terraces, so every one of its buildings sits
      // on a PEDESTAL — a column the town's landscape hides — and a model placed
      // by its lowest point is a building on a stalk. The pedestal mesh is named
      // in the geometry document (`…Pod_O`, the game's word for a base, the same
      // one its materials use), so the ground is the TOP of that column and the
      // column goes below the map. The terrain then hides it, which is why a
      // baked building cuts no hole in the ground.
      const found = opt.ground ?? groundLevel(geom.text, bytes) ?? wideBase(bytes);
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
      // The footprint follows what will be SEEN, not the whole file: a buried
      // base is wider than the building on it often enough (the Hall of
      // Darkness) that measuring the finished bounding box asks for tiles
      // nothing stands on.
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
    if (i === 0) throw new Error(`${label}: cannot place ${geom.bin}`);
    // The AI's copy of it is a different container, and a mesh the AI thinks is
    // three times the size is worse than none: 598 shipped models carry no AI
    // geometry at all, so the reference goes and its files with it.
    copied.files.delete(geom.path);
    copied.files.delete(geom.bin);
    const owner = geometries[i - 1]!;
    const doc = copied.files.get(owner)?.toString('latin1');
    if (doc) copied.files.set(owner, Buffer.from(doc.replace(/<AIGeometry href="[^"]*"\s*\/>/, '<AIGeometry/>'), 'latin1'));
  }

  return { sunk: pedestalSunk, visible };
}
