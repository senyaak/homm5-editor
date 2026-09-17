// A building of ours in the town screen: a model from anywhere, placed.
//
// The screen is an `ArenaDesc` whose `objects` list every building as an
// `ArenaModObject` — named by the record's `ModObjectName`, one model per
// upgrade level (level 0 empty), the models exported from one Maya scene in
// WORLD coordinates — plus a static camera `<Name>_cam` the screen flies to
// when the building is looked at, and an `AIGeometry` hull the cursor picks.
//
// So a building of ours is: a model copied from anywhere (another town's
// screen, an adventure-map object), its positions moved to a spot in THIS
// scene (the one array a geometry file holds a coordinate in — the same
// edit every baked town building on a map goes through), an `ArenaModObject`
// naming it for every level, a camera, and the record's `ModObjectName`
// pointed at it. The spot is either given outright or is where a dropped
// building of the donor's stood — its own camera and pick hull then serve,
// since they were authored for exactly that place.
//
// What is NOT done: a pick hull for a model placed by coordinates. The AI
// hull is a container of its own that the geometry tools do not rewrite, so
// such a model has none; whether the screen still picks it is a launch.

import { placeGeometry, positionsBox, wideBase } from '../scene/geometry.ts';
import type { BBox } from '../scene/geometry.ts';
import { groundLevel, retuneBox } from './model-box.ts';
import { copyArt, resolve } from './mod-art.ts';
import { mustRead } from './mod-files.ts';
import type { DataReader } from './mod-files.ts';
import { EOL, hrefOf, insertBeforeLine, once } from './xml-edit.ts';

export interface BuildingModel {
  /** A `Model` document's data path — a building of another town's screen, an adventure-map object, anything with a Geometry. */
  source: string;
  /**
   * Where the dropped donor building stood, by its type: the model goes where
   * its level-1 model was, and its camera and pick hull are reused.
   */
  place?: string;
  /** Or a spot outright: where the model's ground centre goes, in the scene's units. */
  at?: { x: number; y: number; z: number };
  /** How wide the model should be across, in scene units; its own when absent. */
  across?: number;
}

export interface PlacedModel {
  /** The `ArenaModObject`'s name — what the records' `ModObjectName` becomes. */
  name: string;
  /** Files added or changed, by mod path. */
  files: Map<string, Buffer>;
}

/**
 * Copy `model.source`, place it, and put it in the screen `interior` (a copied
 * ArenaDesc's mod path) as `name`, one model for each of `levels`.
 *
 * `files` is the town copy so far — read for the scene, the donor's objects and
 * cameras; the result is what to add to it. `read` reaches the game's data for
 * the source model.
 */
export function placeBuildingModel(o: {
  name: string;
  levels: number;
  model: BuildingModel;
  interior: string;
  files: ReadonlyMap<string, Buffer>;
  read: DataReader;
  /** Where the copied art goes. */
  dir: string;
  /** The donor record's `ModObjectName`, whose camera is borrowed when the spot is given outright. */
  donorObject: string;
  /** The donor's building records by type, for `place`: type → `ModObjectName`. */
  donorObjects: ReadonlyMap<string, string>;
}): PlacedModel {
  const { name, model, interior, files, read } = o;
  const text = (path: string): string => {
    const data = files.get(path);
    if (!data) throw new Error(`${name}: ${path} is not in the town copy`);
    return data.toString('latin1');
  };
  const scene = text(interior);
  const sceneDir = interior.slice(0, interior.lastIndexOf('/'));
  const out = new Map<string, Buffer>();

  // Where it goes, and whose camera and hull serve.
  let target: { x: number; y: number; z: number };
  let cameraFrom: string;
  let hull: string | null = null;
  if (model.place) {
    const object = o.donorObjects.get(model.place);
    if (!object) throw new Error(`${name}: place ${model.place} names no building of the donor's`);
    const modObject = sceneObject(scene, sceneDir, object, files);
    const modelPath = levelOneModel(modObject);
    if (!modelPath) throw new Error(`${name}: ${object} in the screen has no level-1 model to take the place of`);
    const theirs = geometryOf(modelPath, files, name);
    const box = positionsBox(theirs.bin);
    if (!box) throw new Error(`${name}: cannot read the positions of ${object}'s model`);
    target = { x: box.cx, y: box.cy, z: groundOf(theirs.doc, theirs.bin, box) };
    cameraFrom = object;
    const ai = hrefOf(theirs.doc, 'AIGeometry');
    hull = ai ? `/${resolve(theirs.docPath, ai)}#xpointer(/AIGeometry)` : null;
  } else if (model.at) {
    target = model.at;
    cameraFrom = o.donorObject;
  } else {
    throw new Error(`${name}: a model needs a place or a spot (at)`);
  }

  // The source, copied whole under the faction — geometry, materials, textures.
  const copy = copyArt([model.source], o.dir, read, `building:${name}`);
  const copiedModel = copy.at.get(model.source);
  if (!copiedModel) throw new Error(`${name}: ${model.source} is not a document the copy could reach`);
  for (const m of copy.missing) if (m.toLowerCase().endsWith('.xdb')) throw new Error(`${name}: ${model.source} reaches ${m}, which the data has not`);
  for (const [path, data] of copy.files) out.set(path, data);
  const ours = geometryOf(copiedModel, copy.files, name);
  const whole = positionsBox(ours.bin);
  if (!whole) throw new Error(`${name}: cannot read the positions of ${model.source}`);
  const floor = groundOf(ours.doc, ours.bin, whole);
  const seen = positionsBox(ours.bin, floor) ?? whole;
  const across = Math.max(seen.sx, seen.sy);
  const scale = model.across && across > 0 ? model.across / across : 1;
  // Moved to the origin, scaled, then to the spot: one shift-then-scale pass
  // lands on `target` when the shift carries the target divided by the scale.
  const placement = {
    scale,
    shift: [target.x / scale - seen.cx, target.y / scale - seen.cy, target.z / scale - floor] as [number, number, number],
  };
  const placed = placeGeometry(ours.bin, placement);
  if (!placed) throw new Error(`${name}: cannot place ${model.source}'s geometry`);
  out.set(ours.binPath, placed.data);
  // The hull: the dropped building's where there is one, none otherwise.
  let doc = retuneBox(ours.doc, placed.bbox, placement);
  doc = doc.replace(/<AIGeometry href="[^"]*"\s*\/>/, hull ? `<AIGeometry href="${hull}"/>` : '<AIGeometry/>');
  out.set(ours.docPath, Buffer.from(doc, 'latin1'));
  const aiOfOurs = hrefOf(ours.doc, 'AIGeometry');
  const aiPath = aiOfOurs && resolve(ours.docPath, aiOfOurs);
  if (aiPath) {
    const aiDoc = out.get(aiPath)?.toString('latin1');
    const uid = aiDoc && /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(aiDoc)?.[1];
    out.delete(aiPath);
    if (uid) out.delete(`bin/AIGeometries/${uid.toUpperCase()}`);
  }

  // The object: level 0 empty, then the model at every level of the building.
  const objectPath = `${sceneDir}/${name}.(ArenaModObject).xdb`;
  const empty = ['\t\t<Item>', '\t\t\t<ruins>', '\t\t\t\t<Item>', '\t\t\t\t\t<Model/>', '\t\t\t\t\t<effects/>',
    '\t\t\t\t\t<TextDescFileRef href=""/>', '\t\t\t\t\t<AnimSet/>', '\t\t\t\t</Item>', '\t\t\t</ruins>', '\t\t</Item>'];
  const built = empty.map((l) => l.replace('<Model/>', `<Model href="/${copiedModel}#xpointer(/Model)"/>`));
  out.set(objectPath, Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ArenaModObject>',
    `\t<placement>${'0'.repeat(128)}</placement>`,
    `\t<Name>${name}</Name>`,
    '\t<DefUpgLevel>1</DefUpgLevel>',
    '\t<DefRuinLevel>0</DefRuinLevel>',
    '\t<upgrades>',
    ...empty,
    ...Array.from({ length: o.levels }, () => built).flat(),
    '\t</upgrades>',
    '</ArenaModObject>',
  ].join(EOL) + EOL, 'latin1'));

  // The camera: the one authored for the spot, or the donor building's moved
  // by as much as the building moved, renamed for ours.
  const from = sceneCamera(scene, sceneDir, cameraFrom, files);
  let camera = from.text.replace(/<Name>[^<]*<\/Name>/, `<Name>${name}_cam</Name>`).replace(/<RootJoint>[^<]*<\/RootJoint>/, `<RootJoint>${name}_cam</RootJoint>`);
  if (!model.place) {
    const donorModel = levelOneModel(sceneObject(scene, sceneDir, cameraFrom, files));
    const donorBox = donorModel ? positionsBox(geometryOf(donorModel, files, name).bin) : null;
    if (!donorBox) throw new Error(`${name}: ${cameraFrom}'s model cannot be measured to move its camera`);
    const donorGeom = geometryOf(donorModel!, files, name);
    const delta = [target.x - donorBox.cx, target.y - donorBox.cy, target.z - groundOf(donorGeom.doc, donorGeom.bin, donorBox)];
    camera = camera.replace(/(<Pos>\s*<x>)([^<]*)(<\/x>\s*<y>)([^<]*)(<\/y>\s*<z>)([^<]*)(<\/z>)/, (_, a, x, b, y, c, z, d) =>
      `${a}${(Number(x) + delta[0]!).toFixed(3)}${b}${(Number(y) + delta[1]!).toFixed(3)}${c}${(Number(z) + delta[2]!).toFixed(3)}${d}`);
  }
  const cameraPath = `${sceneDir}/${name}_cam.(Camera).xdb`;
  out.set(cameraPath, Buffer.from(camera, 'latin1'));

  // Both into the scene's lists.
  let desc = insertBeforeLine(scene, once(scene, '</objects>', `${name} scene objects`), [`<Item href="${name}.(ArenaModObject).xdb#xpointer(/ArenaModObject)"/>`]);
  desc = insertBeforeLine(desc, once(desc, '</staticCameras>', `${name} scene cameras`), [`<Item href="${name}_cam.(Camera).xdb#xpointer(/Camera)"/>`]);
  out.set(interior, Buffer.from(desc, 'latin1'));
  return { name, files: out };
}

/**
 * Where a town model's ground is, in its own coordinates. A town building
 * carries a hidden part below its terrace — the Necropolis graves reach 7.5
 * units down into rock under 4 units of graves — so the lowest vertex is not
 * the ground: the named pedestal is (`groundLevel`), or failing that the
 * level the model is widest at (`wideBase`); the bottom only when neither
 * says. Placed by the lowest vertex, the graves floated 6 units up (launch 21).
 */
function groundOf(doc: string, bin: Buffer, box: BBox): number {
  return groundLevel(doc, bin) ?? wideBase(bin) ?? box.cz - box.sz / 2;
}

/** An object's level-1 model (level 0 is `<Model/>`, so the first href is it), as a mod path. */
function levelOneModel(object: { path: string; text: string }): string | null {
  const href = hrefOf(object.text.slice(object.text.indexOf('<upgrades>')), 'Model');
  return href ? resolve(object.path, href) : null;
}

/** The scene's `ArenaModObject` named `object`, by its `<Name>`. */
function sceneObject(scene: string, sceneDir: string, object: string, files: ReadonlyMap<string, Buffer>): { path: string; text: string } {
  for (const m of scene.matchAll(/<Item href="([^"#]+)#xpointer\(\/ArenaModObject\)"\/>/g)) {
    const path = resolve(`${sceneDir}/x`, m[1]!);
    const text = path && files.get(path)?.toString('latin1');
    if (text && text.includes(`<Name>${object}</Name>`)) return { path, text };
  }
  throw new Error(`the screen has no object named ${object}`);
}

/** The scene's static camera named `<object>_cam`. */
function sceneCamera(scene: string, sceneDir: string, object: string, files: ReadonlyMap<string, Buffer>): { path: string; text: string } {
  for (const m of scene.matchAll(/<Item href="([^"#]+)#xpointer\(\/Camera\)"\/>/g)) {
    const path = resolve(`${sceneDir}/x`, m[1]!);
    const text = path && files.get(path)?.toString('latin1');
    if (text && text.includes(`<Name>${object}_cam</Name>`)) return { path, text };
  }
  throw new Error(`the screen has no camera named ${object}_cam`);
}

/** A model's geometry document and binary, out of a set of files. */
function geometryOf(modelPath: string, files: ReadonlyMap<string, Buffer>, what: string): { docPath: string; doc: string; binPath: string; bin: Buffer } {
  const model = files.get(modelPath)?.toString('latin1');
  if (!model) throw new Error(`${what}: no model at ${modelPath}`);
  const href = hrefOf(model, 'Geometry');
  const docPath = href && resolve(modelPath, href);
  const doc = docPath && files.get(docPath)?.toString('latin1');
  if (!docPath || !doc) throw new Error(`${what}: ${modelPath} names no geometry the files hold`);
  const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
  const binPath = uid && `bin/Geometries/${uid.toUpperCase()}`;
  const bin = binPath && files.get(binPath);
  if (!binPath || !bin) throw new Error(`${what}: ${docPath} names no geometry binary the files hold`);
  return { docPath, doc, binPath, bin };
}

/** The donor's `ModObjectName` for every listed building type, for `place`. */
export function donorObjectsOf(town: string, from: string, read: DataReader): Map<string, string> {
  const start = once(town, '<buildings>', 'town buildings');
  const end = once(town, '</buildings>', 'town buildings end');
  const out = new Map<string, string>();
  for (const m of town.slice(start, end).matchAll(/<Item href="([^"]+)"\/>/g)) {
    const path = resolve(from, m[1]!);
    if (!path) continue;
    const record = mustRead(read, path);
    const type = /<Type>(TB_\w+)<\/Type>/.exec(record)?.[1];
    const object = /<ModObjectName>([^<]*)<\/ModObjectName>/.exec(record)?.[1];
    if (type && object && !out.has(type)) out.set(type, object);
  }
  return out;
}
