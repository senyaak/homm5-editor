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

/** `RESOURCE_*` / `EXP_*` in the enum's own order — types.xml, not guessed. */
export const MULTIPLIERS = ['MISERABLE', 'LITTLE', 'NORMAL', 'LOTS', 'MUCH'] as const;

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
  /** MonsterLevel as the map spells it; `rmg-diff-map` replays the level it names. */
  monster: string;
  underground: boolean;
  /** The order's Minimap tick: an order made with it off writes no minimap. */
  minimap: boolean;
  /**
   * The dialog's settings the port does NOT replay, as the map spells them.
   *
   * The console command cannot set most of these, so a batch-ordered map
   * always has them at the constructor's values and they never came up. A map
   * SAVED from the dialog can carry any of them, and then the port replays a
   * different order than the one it is being diffed against — which reads as
   * a bug in a phase rather than as an order nobody asked the port to make.
   * `unreplayable` turns that into a sentence before a single byte is compared.
   */
  extras: {
    resource: string;
    exp: string;
    /** The two as the enum counts them, 0 MISERABLE .. 4 MUCH; -1 when absent. */
    resourceIndex: number;
    expIndex: number;
    randomTowns: boolean;
    grail: boolean;
    /** One per player, `TOWN_*`; empty when the map names none. */
    races: string[];
    /** A hero picked in the dialog rather than left to the generator. */
    startHeroes: string[];
  };
}

/**
 * What in this order the port cannot replay, one line each — empty when it can.
 *
 * Each of these is a real generator input: the two multipliers are the
 * `+0x98`/`+0xA0` the reference pinned to LITTLE and they move the draw count,
 * random towns is `+0x95` and the grail `+0xA5`. The port is written for the
 * reference's values and has no option for the others, so the honest answer to
 * a map that carries them is to say so rather than to diff it.
 */
export function unreplayable(o: MapOrder): string[] {
  const out: string[] = [];
  const { randomTowns, grail, startHeroes, resourceIndex, expIndex } = o.extras;
  // The two multipliers ARE replayed now — the treasures step takes its ladder
  // index from them. Only a value outside the enum would stop the comparison.
  if (resourceIndex < 0 || expIndex < 0) {
    out.push('one of the two multipliers is not a value this enum has');
  }
  if (randomTowns) out.push('RandomTowns is on; the port takes each player\'s race from the template');
  if (grail) out.push('Grail is on; the port does not place one');
  if (startHeroes.length) {
    out.push(`a starting hero was chosen (${startHeroes.join(', ')}); the port leaves that to the generator`);
  }
  return out;
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
      extras: {
        resource: /<ResourceMultiplier>(\w+)</.exec(text)?.[1] ?? '',
        exp: /<ExpMultiplier>(\w+)</.exec(text)?.[1] ?? '',
        resourceIndex: MULTIPLIERS.indexOf(
          (/<ResourceMultiplier>RESOURCE_(\w+)</.exec(text)?.[1] ?? 'LITTLE') as never),
        expIndex: MULTIPLIERS.indexOf(
          (/<ExpMultiplier>EXP_(\w+)</.exec(text)?.[1] ?? 'LITTLE') as never),
        randomTowns: /<RandomTowns>true</.test(text),
        grail: /<Grail>true</.test(text),
        // ONLY the order's own PlayersInfo. `<Race>` appears again for each of
        // the map's eight player slots, where it is TOWN_NO_TYPE on a generated
        // map, and reading those as the order's races prints ten for a
        // two-player map.
        races: [...(/<PlayersInfo>([\s\S]*?)<\/PlayersInfo>/.exec(text)?.[1] ?? '')
          .matchAll(/<Race>(\w+)</g)].map((m) => m[1]!),
        // `<StartHero/>` is the empty one the generator fills; a chosen hero
        // arrives as a href, and only that is worth reporting.
        startHeroes: [...(/<PlayersInfo>([\s\S]*?)<\/PlayersInfo>/.exec(text)?.[1] ?? '')
          .matchAll(/<StartHero href="([^"]+)"/g)].map((m) => m[1]!),
      },
    },
  };
}

/** The order in one line, the way both diff tools print it. */
export function describeOrder(o: MapOrder): string {
  return `${o.template} ${o.sizeName.replace('MAP_SIZE_', '').toLowerCase()} ${o.size}x${o.size},`
    + ` ${o.players} players, seed ${o.seed}, ${o.waterName}, ${o.monster}`
    + `${o.underground ? ', underground' : ''}${o.minimap ? '' : ', no minimap'}`;
}
