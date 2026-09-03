// THE ORDER A GENERATED MAP CARRIES, read back out of it.
//
// `sRMGProps` in `map.xdb` records what the map was asked for — the seed, the
// template, the size, the players, the water, the monster level, the floors —
// so nothing about a comparison has to be typed twice. Point a tool at a map
// and it knows the order.
//
// A MODULE rather than a copy in each tool, because the second reader was
// about to be a second set of regexes for the same eleven fields, and the
// first one already had a bug the second would have inherited: the template
// name was matched with `[^.]+` and half the stock templates have a dot in it.
//
// Either an archive or a folder: the editor's Save writes a packed `.h5m`,
// the console command the batch uses leaves the documents loose, and they hold
// the same map.xdb either way.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readEntries } from '../src/format/pak.ts';
import { MAP_SIZES } from './rmg-build.ts';

/** The map sizes an order can name, by the dialog's MapSize index. */
export const SIZE_NAMES = [
  'MAP_SIZE_TINY', 'MAP_SIZE_SMALL', 'MAP_SIZE_MEDIUM', 'MAP_SIZE_LARGE',
  'MAP_SIZE_EXTRALARGE', 'MAP_SIZE_HUGE', 'MAP_SIZE_IMPOSSIBLE',
] as const;

export interface MapOrder {
  seed: number;
  guid: string;
  mapName: string;
  /** Template file name without `.xdb`. */
  template: string;
  /** MapSize index, and the side in tiles it stands for. */
  sizeIndex: number;
  sizeName: string;
  size: number;
  players: number;
  /** WaterAmount as 0/1/2. */
  water: number;
  waterName: string;
  /** MonsterLevel as the map spells it — the port only replays MEDIUM. */
  monster: string;
  underground: boolean;
  /** The order's Minimap tick: an order made with it off writes no minimap. */
  minimap: boolean;
}

/** Every file of a generated map, by its name inside the map folder. */
export function readMapFiles(path: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      const inside = join(path, name);
      if (statSync(inside).isFile()) files.set(name, readFileSync(inside));
    }
    return files;
  }
  const entries = readEntries(readFileSync(path));
  const holder = entries.find((e) => e.name.endsWith('/map.xdb') || e.name === 'map.xdb');
  if (!holder) return files;
  const folder = holder.name.slice(0, holder.name.lastIndexOf('/'));
  for (const e of entries) {
    if (folder && !e.name.startsWith(`${folder}/`)) continue;
    files.set(e.name.slice(folder ? folder.length + 1 : 0), e.data);
  }
  return files;
}

/**
 * The order, or a sentence saying why this is not a generated map. Callers
 * decide what to do about it; nothing here calls `process.exit`.
 */
export function readOrder(path: string): { order: MapOrder; files: Map<string, Buffer> } | string {
  if (!existsSync(path)) return `${path} is not there`;
  const files = readMapFiles(path);
  const mapEntry = files.get('map.xdb');
  if (!mapEntry) return `${path} holds no map.xdb — is it a map?`;

  const text = mapEntry.toString('utf8');
  let missing: string | null = null;
  const one = (re: RegExp, what: string): string => {
    const m = re.exec(text);
    if (!m) { missing ??= what; return ''; }
    return m[1]!;
  };
  const seed = Number(one(/<RMGstartseed>(\d+)</, 'RMGstartseed'));
  const guid = one(/<RMGguid>([^<]*)</, 'RMGguid');
  const mapName = one(/<MapName>([^<]*)</, 'MapName');
  const sizeName = one(/<MapSize>(\w+)</, 'MapSize');
  const players = Number(one(/<Players>(\d+)</, 'Players'));
  // `[^"]+` and not `[^.]+`: half the stock templates have a dot in the NAME —
  // `S0-1P2Z2K3.1T.xdb`, `S3-5P2Z7N2.2.xdb` — and a stricter class stopped at
  // the first one, so those maps read as "not generated".
  const template = one(/<Template href="\/RMG\/Templates\/([^"]+)\.xdb/, 'Template');
  const waterName = one(/<WaterAmount>(\w+)</, 'WaterAmount');
  const monster = one(/<MonsterLevel>(\w+)</, 'MonsterLevel');
  if (missing) return `${path}: no ${missing} — this map was not generated`;

  const sizeIndex = SIZE_NAMES.indexOf(sizeName as (typeof SIZE_NAMES)[number]);
  const size = MAP_SIZES[sizeIndex];
  const water = ['WATER_NONE', 'WATER_PRESENT', 'WATER_ISLAND_MAP'].indexOf(waterName);
  if (size === undefined || water < 0) {
    return `${path}: ${sizeName} / ${waterName} is not an order this port can replay`;
  }
  return {
    files,
    order: {
      seed, guid, mapName, template, sizeIndex, sizeName, size, players,
      water, waterName, monster,
      underground: /<HasUnderground>true</.test(text),
      minimap: !/<Minimap>false</.test(text),
    },
  };
}

/** The order in one line, the way both diff tools print it. */
export function describeOrder(o: MapOrder): string {
  return `${o.template} ${o.sizeName.replace('MAP_SIZE_', '').toLowerCase()} ${o.size}x${o.size},`
    + ` ${o.players} players, seed ${o.seed}, ${o.waterName}, ${o.monster}`
    + `${o.underground ? ', underground' : ''}${o.minimap ? '' : ', no minimap'}`;
}
