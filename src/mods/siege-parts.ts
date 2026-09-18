// Siege parts of our own: the walls, the towers, the gate, the moat as
// models from disk, standing where the donor's stand.
//
// A siege building is an `ArenaBuilding` record in the town's `Combat`
// block — its tiles, its hit and ruin effects, its texts — pointing at an
// `ArenaModObject` in the arena's folder that names a model per upgrade and
// RUIN level (a wall has three: whole, breached, razed; a tower two; the gate
// three, animated; the moat one). The layout is the same in every shipped
// town, so a part of ours keeps the record and swaps the OBJECT: one of ours,
// with the donor's shape (as many upgrades, as many ruin levels) and models
// of ours in every slot — the whole one required, the damaged ones falling
// back to the level before when not given. Each model is moved so its ground
// centre is the donor piece's, the way a building of ours is stood on the
// town screen (town-screen.ts); the donor piece's pick hull serves it, since
// a hull is a container the geometry tools do not write.
//
// What a part of ours does not carry: the gate's animation (the donor's
// AnimSet plays on the donor's skeleton; ours stands still and is razed by
// its ruin level), and any effect a ruin level named — those are the
// record's, not the object's, and the record stays.

import { placeGeometry, positionsBox } from '../scene/geometry.ts';
import { retuneBox } from './model-box.ts';
import { copyArt, dataPath, resolve } from './mod-art.ts';
import type { DataReader } from './mod-files.ts';
import { mountOwn } from './own-files.ts';
import { geometryOf, groundOf } from './town-screen.ts';
import { EOL, hrefOf } from './xml-edit.ts';

/** A siege part as models of ours: one per piece, whole; and the damaged and razed ones, optional. */
export interface OwnSiegePart {
  /**
   * The whole models, one per piece the part has: four walls (in the
   * donor's order), three towers (left, right, big), one gate, one moat.
   */
  models: readonly string[];
  /** Breached, per piece; the whole one when absent. */
  damaged?: readonly (string | undefined)[];
  /** Razed, per piece; the breached one when absent. */
  destroyed?: readonly (string | undefined)[];
}

/** The building types each part is made of, in the order the town lists them. */
export const SIEGE_PIECES = {
  walls: ['WALL', 'WALL', 'WALL', 'WALL'],
  towers: ['LEFT_TOWER', 'RIGHT_TOWER', 'BIG_TOWER'],
  gate: ['GATE'],
  moat: ['MOAT'],
} as const;
export type SiegePartName = keyof typeof SIEGE_PIECES;

/**
 * Put every own part into the town copy: `files` is the copy so far (the
 * town document at `shared`, the arena's objects under it), and it is
 * changed in place — the objects of ours added under `dir`, the records and
 * the arena's list pointed at them.
 */
export function placeSiegeParts(o: {
  faction: string;
  parts: Partial<Record<SiegePartName, OwnSiegePart>>;
  files: Map<string, Buffer>;
  shared: string;
  dir: string;
  read: DataReader;
}): void {
  const { faction, files } = o;
  let town = files.get(o.shared)?.toString('latin1');
  if (!town) throw new Error(`${faction}: no town document at ${o.shared}`);
  const combatStart = town.indexOf('<Combat ');
  const combatEnd = town.indexOf('</Combat>');
  if (combatStart < 0 || combatEnd < 0) throw new Error(`${faction}: the town has no siege`);
  const arenaHref = hrefOf(town.slice(combatStart, combatEnd), 'ArenaDesc');
  const arenaPath = arenaHref && resolve(o.shared, arenaHref);
  let arena = arenaPath ? files.get(arenaPath)?.toString('latin1') : undefined;
  if (!arenaPath || !arena) throw new Error(`${faction}: the siege names no ArenaDesc the copy holds`);

  for (const [part, own] of Object.entries(o.parts) as [SiegePartName, OwnSiegePart | undefined][]) {
    if (!own) continue;
    const types = SIEGE_PIECES[part];
    if (own.models.length !== types.length) throw new Error(`${faction}: ${part} has ${types.length} piece(s), ${own.models.length} model(s) given`);
    // The records of the part, in the town's order — the walls are four
    // records of one type, the towers three of three.
    const records = [...town.matchAll(/<Item href="#n:inline\(ArenaBuilding\)"[^>]*>[\s\S]*?<\/ArenaBuilding>\s*<\/Item>/g)]
      .map((m) => ({ text: m[0], type: /<Type>(\w+)<\/Type>/.exec(m[0])?.[1] ?? '' }));
    const pieces: string[] = [];
    for (const type of types) {
      const found = records.find((r) => r.type === type && !pieces.includes(r.text));
      if (!found) throw new Error(`${faction}: the siege has no ${type} for ${part}`);
      pieces.push(found.text);
    }
    for (const [i, record] of pieces.entries()) {
      const name = `${faction}_${part}_${i + 1}`;
      const what = `${faction}: ${part} ${i + 1}`;
      const objectHref = hrefOf(record, 'Object');
      const objectPath = objectHref && resolve(o.shared, objectHref);
      const object = objectPath && files.get(objectPath)?.toString('latin1');
      if (!objectPath || !object) throw new Error(`${what}: the record's object is not in the copy`);
      // The donor's shape: upgrades, and ruin levels per upgrade; its whole
      // model is where ours goes.
      const upgrades = [...object.slice(object.indexOf('<upgrades>')).matchAll(/<ruins>([\s\S]*?)<\/ruins>/g)]
        .map((m) => (m[1]!.match(/<Model(?:\s[^>]*)?\/>/g) ?? []).length);
      const first = hrefOf(object.slice(object.indexOf('<upgrades>')), 'Model');
      const donorModel = first && resolve(objectPath, first);
      if (!donorModel) throw new Error(`${what}: the donor's object has no model to stand where`);
      const theirs = geometryOf(donorModel, files, what);
      const box = positionsBox(theirs.bin);
      if (!box) throw new Error(`${what}: cannot read the positions of the donor's piece`);
      const target = { x: box.cx, y: box.cy, z: groundOf(theirs.doc, theirs.bin, box) };
      const ai = hrefOf(theirs.doc, 'AIGeometry');
      const hull = ai ? `/${resolve(theirs.docPath, ai)}#xpointer(/AIGeometry)` : null;

      // Ours, per ruin level, each copied and moved to the spot.
      const givenLevels = [own.models[i], own.damaged?.[i], own.destroyed?.[i]];
      const placed: string[] = [];
      for (const [r, file] of givenLevels.entries()) {
        if (!file) continue;
        const mount = mountOwn(o.read, file);
        const dest = `${o.dir}/siege/${part}_${i + 1}/r${r}`;
        const copy = copyArt([mount.rel], dest, mount.read, `siege:${name}:r${r}`);
        const copied = copy.at.get(mount.rel);
        if (!copied) throw new Error(`${what}: ${file} is not a document the copy could reach`);
        for (const m of copy.missing) if (m.toLowerCase().endsWith('.xdb')) throw new Error(`${what}: ${file} reaches ${m}, which neither its folder nor the data has`);
        for (const [path, data] of copy.files) files.set(path, data);
        const ours = geometryOf(copied, files, what);
        const whole = positionsBox(ours.bin);
        if (!whole) throw new Error(`${what}: cannot read the positions of ${file}`);
        const floor = groundOf(ours.doc, ours.bin, whole);
        const placement = { scale: 1, shift: [target.x - whole.cx, target.y - whole.cy, target.z - floor] as [number, number, number] };
        const moved = placeGeometry(ours.bin, placement);
        if (!moved) throw new Error(`${what}: cannot place ${file}'s geometry`);
        files.set(ours.binPath, moved.data);
        let doc = retuneBox(ours.doc, moved.bbox, placement);
        doc = doc.replace(/<AIGeometry href="[^"]*"\s*\/>/, hull ? `<AIGeometry href="${hull}"/>` : '<AIGeometry/>');
        files.set(ours.docPath, Buffer.from(doc, 'latin1'));
        // The own hull, if the folder had one, is not what stands here.
        const aiOfOurs = hrefOf(ours.doc, 'AIGeometry');
        const aiPath = aiOfOurs && resolve(ours.docPath, aiOfOurs);
        if (aiPath) {
          const aiDoc = files.get(aiPath)?.toString('latin1');
          const uid = aiDoc && /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(aiDoc)?.[1];
          files.delete(aiPath);
          if (uid) files.delete(`bin/AIGeometries/${uid.toUpperCase()}`);
        }
        placed[r] = copied;
      }
      // Every ruin level gets a model: the one given, else the level before's.
      const modelFor = (r: number): string => placed[r] ?? placed[r - 1] ?? placed[0]!;

      // The object of ours, shaped as the donor's.
      const objectOurs = `${o.dir}/siege/${part}_${i + 1}/${name}.(ArenaModObject).xdb`;
      const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<ArenaModObject>',
        `\t<placement>${'0'.repeat(128)}</placement>`, `\t<Name>${name}</Name>`,
        '\t<DefUpgLevel>1</DefUpgLevel>', '\t<DefRuinLevel>0</DefRuinLevel>', '\t<upgrades>'];
      for (const [u, ruins] of upgrades.entries()) {
        lines.push('\t\t<Item>', '\t\t\t<ruins>');
        for (let r = 0; r < ruins; r++) {
          // The first upgrade is the unbuilt one — no model, as the donor's.
          const model = u === 0 ? '<Model/>' : `<Model href="/${modelFor(r)}#xpointer(/Model)"/>`;
          lines.push('\t\t\t\t<Item>', `\t\t\t\t\t${model}`, '\t\t\t\t\t<effects/>', '\t\t\t\t\t<TextDescFileRef href=""/>', '\t\t\t\t\t<AnimSet/>', '\t\t\t\t</Item>');
        }
        lines.push('\t\t\t</ruins>', '\t\t</Item>');
      }
      lines.push('\t</upgrades>', '</ArenaModObject>');
      files.set(objectOurs, Buffer.from(lines.join(EOL) + EOL, 'latin1'));

      // The record points at ours; the arena lists ours where it listed the donor's.
      const ourHref = `/${objectOurs}#xpointer(/ArenaModObject)`;
      town = town.replace(record, record.replace(/<Object href="[^"]*"\/>/, `<Object href="${ourHref}"/>`));
      const base = dataPath(objectHref).split('/').pop()!;
      const listed = new RegExp(`<Item href="${base.replace(/[.()]/g, '\\$&')}#[^"]*"/>`);
      if (!listed.test(arena)) throw new Error(`${what}: the arena lists no ${base}`);
      arena = arena.replace(listed, `<Item href="${ourHref}"/>`);
    }
  }
  files.set(o.shared, Buffer.from(town, 'latin1'));
  files.set(arenaPath, Buffer.from(arena, 'latin1'));
}
