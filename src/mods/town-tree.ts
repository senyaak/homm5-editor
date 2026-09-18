// A shipped town's building tree, read for a form: what the faction window
// draws when "fill from donor" is pressed, and what a faction's building
// edits are a diff against.
//
// The tree is the town document's `buildings` list — one
// `TownBuildingSharedStats` per (type, level): texts, cost, town level,
// dependencies, the creature a dwelling hires — and the build grid
// (`TownBuildDefinition`) that gives each level its cell. Read only; the
// copier (town-files.ts) is what writes.

import { RESOURCES, SHIPPED_TOWN_ORDINALS, buildingKey, donorBuildDefinition, donorTown } from './town-files.ts';
import type { BuildingKey, Resource } from './town-files.ts';
import { mustRead } from './mod-files.ts';
import type { DataReader } from './mod-files.ts';
import { hrefOf, once } from './xml-edit.ts';
import { resolve } from './mod-art.ts';

/** One record of the tree, as a form shows it. */
export interface TreeBuilding {
  key: BuildingKey;
  type: string;
  level: number;
  name: string;
  description: string;
  cost: Record<Resource, number>;
  devLevel: number;
  /** What has to stand first, by key. */
  requires: BuildingKey[];
  /** Its cell on the build grid, 1-based; null for a record the grid does not place (the grail, a guild stub). */
  cell: { x: number; y: number } | null;
  /** The creature a dwelling hires, when it is one. */
  creature?: string;
}

export interface TownTree {
  type: string;
  ordinal: number;
  buildings: TreeBuilding[];
}

/** A game text: UTF-16 LE with a byte-order mark, or plain. */
export function readText(read: DataReader, path: string): string {
  const b = read(path);
  if (!b) return '';
  const s = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8');
  return s.replace(/\0+$/, '');
}

/** The value of a simple element, or null. */
const valueOf = (text: string, tag: string): string | null => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1] ?? null;

/** Every cell of a grid, by (type, level). */
export function gridCells(build: string): Map<BuildingKey, { x: number; y: number }> {
  const out = new Map<BuildingKey, { x: number; y: number }>();
  const slots = /<BuildingType>(TB_\w+)<\/BuildingType>\s*(?:<buildings\/>|<buildings>([\s\S]*?)<\/buildings>)/g;
  for (const slot of build.matchAll(slots)) {
    for (const cell of (slot[2] ?? '').matchAll(/<Upgrade>BLD_UPG_(\d)<\/Upgrade>\s*<XSlotPos>(\d+)<\/XSlotPos>\s*<YSlotPos>(\d+)<\/YSlotPos>/g)) {
      out.set(buildingKey(slot[1]!, Number(cell[1])), { x: Number(cell[2]), y: Number(cell[3]) });
    }
  }
  return out;
}

/** The tree of the shipped town of `type`. */
export function readTownTree(type: string, read: DataReader): TownTree {
  const ordinal = SHIPPED_TOWN_ORDINALS[type];
  if (!ordinal) throw new Error(`${type} is not a shipped town`);
  const source = donorTown(type, read);
  const town = mustRead(read, source);
  const cells = gridCells(mustRead(read, donorBuildDefinition(ordinal, read)));
  const start = once(town, '<buildings>', `${type}'s building list`);
  const end = once(town, '</buildings>', `${type}'s building list end`);
  // Two passes: the records first, so a dependency can be named by key.
  const records: { path: string; text: string; type: string; level: number }[] = [];
  for (const m of town.slice(start, end).matchAll(/<Item href="([^"]+)"\/>/g)) {
    const path = resolve(source, m[1]!);
    if (!path) throw new Error(`${source}: building href ${m[1]} resolves nowhere`);
    const text = mustRead(read, path);
    const t = valueOf(text, 'Type');
    const l = /<Upgrade>BLD_UPG_(\d)<\/Upgrade>/.exec(text)?.[1];
    if (!t || !l) throw new Error(`${path}: no <Type>/<Upgrade> in the building record`);
    records.push({ path, text, type: t, level: Number(l) });
  }
  const keyOfPath = new Map(records.map((r) => [r.path, buildingKey(r.type, r.level)]));
  const buildings: TreeBuilding[] = records.map((r) => {
    const key = buildingKey(r.type, r.level);
    const cost = {} as Record<Resource, number>;
    for (const res of RESOURCES) cost[res] = Number(valueOf(r.text, res) ?? 0);
    const requires: BuildingKey[] = [];
    const deps = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(r.text)?.[1] ?? '';
    for (const d of deps.matchAll(/<Item href="([^"]+)"\/>/g)) {
      const path = resolve(r.path, d[1]!);
      const dep = path && keyOfPath.get(path);
      // A dependency on a record the town never lists (Necropolis's Ruined
      // Tower needs Preserve's fort, in the shipped data) is not one the
      // screen can draw an arrow for; the form does not show it either.
      if (dep) requires.push(dep);
    }
    const nameRef = hrefOf(r.text, 'NameFileRef');
    const descRef = hrefOf(r.text, 'DescriptionFileRef');
    const creature = valueOf(r.text, 'Creature');
    return {
      key, type: r.type, level: r.level,
      name: nameRef ? readText(read, resolve(r.path, nameRef) ?? '') : '',
      description: descRef ? readText(read, resolve(r.path, descRef) ?? '') : '',
      cost,
      devLevel: Number(valueOf(r.text, 'DevLevelNeeded') ?? 0),
      requires,
      cell: cells.get(key) ?? null,
      ...(creature && creature !== 'CREATURE_UNKNOWN' ? { creature } : {}),
    };
  });
  return { type, ordinal, buildings };
}
