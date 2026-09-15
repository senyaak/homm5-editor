// THE GENERATOR AS THE EDITOR SEES IT — one door.
//
// Everything under `src/rmg` is the engine's random map generator, phase by
// phase, held byte-for-byte to the maps the engine writes (docs/RMG.md). The
// tools reach into the phases because the tests are about the phases; the
// application is not, and what it needs is the dialog's shape: which
// templates the dialog would offer for a size, an order in the dialog's own
// units, and a `.h5m` at the end. That is what this file exports, and it is
// the ONLY file outside `src/rmg` should import from.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { initProject, packProject } from '../map/project.ts';
import { buildMapFiles, mapSizes } from './build.ts';
import type { MapFile } from './build.ts';
import type { ChainOptions } from './chain.ts';
import { toAssets, enumNames } from './data.ts';
import { installTables } from './install.ts';
import type { RmgInstall } from './install.ts';
import { runFull } from './run.ts';
import { TEMPLATE_EXTENSIONS, readTemplateNamed } from './template.ts';
import type { RmgTemplate } from './template.ts';

export type { RmgInstall } from './install.ts';
export type { MapFile } from './build.ts';
export type { RecordedOrder } from './recorded-order.ts';
export { readOrder, describeOrder, unreplayable } from './recorded-order.ts';

/**
 * An order in the dialog's units — what its controls hold, nothing the
 * generator derives. Indices are the enums' (`MapSize`, `WaterAmount`,
 * `MonsterLevel`, `ResourceMultiplier`, `ExpMultiplier` in `types.xml`),
 * which `dialogChoices` spells out.
 */
export interface RmgOrder {
  seed: number;
  /** Template FILE name without `.xdb` — `S1P2Z2M1`; see `templatesOffered`. */
  template: string;
  /** MapSize index into `dialogChoices().sizes`. */
  sizeIndex: number;
  underground: boolean;
  /** WaterAmount index: 0 none, 2 is what the dialog's checkbox records. */
  water: number;
  players: number;
  /** MonsterLevel index, 0 weak .. 4 impossible. */
  monsterLevel: number;
  resourceMultiplier: number;
  expMultiplier: number;
  grail: boolean;
  randomTowns: boolean;
  /** The Minimap tick; off writes no thumbnail and points the map at a stock one. */
  minimap: boolean;
  mapName: string;
  /** `CoCreateGuid`'s shape; drawn when left out. */
  guid?: string;
}

/** What the dialog's lists say, read from the install rather than typed here. */
export interface DialogChoices {
  /** `MapSize` names by index, and the side in tiles each stands for. */
  sizes: { name: string; tiles: number }[];
  water: string[];
  monsterLevels: string[];
  resourceMultipliers: string[];
  expMultipliers: string[];
}

export function dialogChoices(install: RmgInstall): DialogChoices {
  const data = install.data;
  const tiles = mapSizes(install);
  return {
    sizes: enumNames(data, 'MapSize').slice(0, tiles.length).map((name, i) => ({ name, tiles: tiles[i]! })),
    water: enumNames(data, 'WaterAmount'),
    monsterLevels: enumNames(data, 'MonsterLevel'),
    resourceMultipliers: enumNames(data, 'ResourceMultiplier'),
    expMultipliers: enumNames(data, 'ExpMultiplier'),
  };
}

/** A template as the dialog lists it. */
export interface OfferedTemplate {
  /** The file name without `.xdb` — what an order names. */
  file: string;
  /** The document's own `<Name>`, which may differ from the file's. */
  name: string;
  minPlayers: number;
  maxPlayers: number;
  minMapSize: number;
  maxMapSize: number;
}

/** Every template the install mounts — a mod's beside the shipped ones. */
export function allTemplates(install: RmgInstall): OfferedTemplate[] {
  const assets = toAssets(install.data);
  const seen = new Set<string>();
  const out: OfferedTemplate[] = [];
  for (const dir of assets.dirs('RMG/Templates')) {
    for (const f of readdirSync(dir)) {
      const ext = TEMPLATE_EXTENSIONS.find((e) => f.endsWith(e));
      if (!ext) continue;
      const file = f.slice(0, -ext.length);
      if (seen.has(file)) continue;
      seen.add(file);
      const t: RmgTemplate = readTemplateNamed(assets, file);
      out.push({ file, name: t.name, minPlayers: t.minPlayers, maxPlayers: t.maxPlayers,
        minMapSize: t.minMapSize, maxMapSize: t.maxMapSize });
    }
  }
  return out;
}

/**
 * The templates the game's dialog OFFERS for a size and floor count — the
 * filter at `0xCF7B58`, read: the size's units must lie inside the template's
 * `[MinMapSize, MaxMapSize]`; with an underground the units are doubled first
 * (a second floor costs exactly that) and the template must reach 10.
 *
 * An order outside this list is one the engine would not make: `createMap`
 * lifts the size to what the template's minimum requires, and the map that
 * comes out is not the one asked for. So `generateMap` refuses it.
 */
export function templatesOffered(install: RmgInstall, sizeIndex: number, underground: boolean): OfferedTemplate[] {
  const units = installTables(install).sizeUnits[sizeIndex];
  if (units === undefined) return [];
  return allTemplates(install).filter((t) => (underground
    ? t.maxMapSize >= 10 && t.minMapSize <= 2 * units && 2 * units <= t.maxMapSize
    : t.minMapSize <= units && units <= t.maxMapSize));
}

/** A generated map, as files, before it is an archive. */
export interface GeneratedMap {
  files: MapFile[];
  guid: string;
  /** The stream's length and the object count — the two numbers every corpus map is checked by. */
  draws: number;
  objects: number;
}

/**
 * CoCreateGuid's shape, which is what the engine stamps into the map and
 * names the folder with. Ours is random the same way; nothing reads it back.
 */
export function newGuid(): string {
  const hex = (n: number): string => Array.from({ length: n },
    () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

/**
 * The whole run for one order: every phase, then the sixteen documents the
 * archive holds. Pure but for reading the install; nothing is written.
 */
export function generateMap(install: RmgInstall, order: RmgOrder): GeneratedMap {
  const tiles = mapSizes(install)[order.sizeIndex];
  if (tiles === undefined) throw new Error(`size index ${order.sizeIndex} is not one of the dialog's`);
  const offered = templatesOffered(install, order.sizeIndex, order.underground);
  const template = offered.find((t) => t.file === order.template);
  if (!template) {
    throw new Error(`${order.template} is not a template the dialog offers at this size`
      + `${order.underground ? ' with an underground' : ''} — the engine would lift the size`);
  }
  if (order.players < template.minPlayers || order.players > template.maxPlayers) {
    throw new Error(`${order.template} takes ${template.minPlayers}..${template.maxPlayers} players, not ${order.players}`);
  }
  const options: ChainOptions = {
    seed: order.seed, template: order.template, size: tiles, underground: order.underground,
    water: order.water || undefined, players: order.players, monsterStrength: order.monsterLevel,
    resourceMultiplier: order.resourceMultiplier, expMultiplier: order.expMultiplier,
    grail: order.grail, randomTowns: order.randomTowns,
  };
  const run = runFull(install, options);
  const guid = order.guid ?? newGuid();
  // An `.h5m` is what the editor's SAVE writes, so its caption numbering is
  // the dialog's: two unreferenced documents at 0 and 1, the scenario's at 2.
  const files = buildMapFiles(install, run, {
    seed: order.seed, template: order.template, players: order.players, underground: order.underground,
    water: order.water, guid, mapName: order.mapName, minimap: order.minimap,
  }, { captionBase: 2 });
  return { files, guid, draws: run.c.rng.draws, objects: run.objects.length };
}

/**
 * The archive: the files laid out under `Maps/RMG/<guid>/` in `staging`
 * (emptied first), then packed to `out` the way the editor packs any map.
 */
export function writeMap(map: GeneratedMap, out: string, staging: string): { entries: number; bytes: number } {
  const prefix = `Maps/RMG/${map.guid}`;
  rmSync(staging, { recursive: true, force: true });
  const mapDir = join(staging, ...prefix.split('/'));
  mkdirSync(mapDir, { recursive: true });
  for (const file of map.files) writeFileSync(join(mapDir, file.name), file.data);
  initProject(mapDir);
  if (!existsSync(join(out, '..'))) mkdirSync(join(out, '..'), { recursive: true });
  const packed = packProject(mapDir, out, { prefix });
  return { entries: packed.entries, bytes: packed.bytes };
}
