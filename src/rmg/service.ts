// THE GENERATOR AS A RESIDENT — one install, read once, asked many times.
//
// Every question the dialog asks — what its lists hold, which templates fit
// a size, a template's own fields, a map — reads the install: the archives
// mounted by the engine's rule, the executable's tables, every template, the
// hero roster. Read fresh for every question, that was seconds a question
// (two to mount, five for the roster), and seconds in the main process are
// seconds in which the window does not paint. So the questions go to a
// process of their own (`electron/rmg-worker.ts`) that keeps the install for
// the length of the session and answers out of what it has read: the
// archives are indexed once (`mounted.ts`), the roster walked once
// (`heroes.ts`), the executable's tables read once (`exe.ts`) — each kept
// where it is read, by the chain object this file builds once. The one thing
// that changes under a running editor is a template the editor saves or
// removes, and the editor says so (`forget-templates`).
//
// Everything crosses as plain paths and numbers, so the same `answer` runs
// in a child with no window and no `app`, or in the main process when no
// child could be forked — the bargain `scene-jobs.ts` makes. The map's files
// are WRITTEN where the request says rather than posted back: sixteen
// documents of up to a few megabytes cross a MessagePort as copies.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assets, inFront } from '../game/assets.ts';
import { mountArchives } from '../game/mounted.ts';
import { allTemplates, dialogChoices, forgetTemplates, generateMap, templatesOffered } from './index.ts';
import type { DialogChoices, OfferedTemplate, RmgInstall, RmgOrder } from './index.ts';
import { readTemplateNamed } from './template-files.ts';
import type { RmgTemplate } from './template.ts';

/** Where the install is — what a process with no `app` needs to mount it. */
export interface RmgPaths {
  /** The game folder — `<game>/H5E/` is mounted from it. */
  gameRoot: string;
  /** The unpacked data the mounted archives sit over. */
  dataRoot: string;
  /**
   * With the archives of `<game>/H5E/` mounted over the data, the way the
   * game would read it (true), or the game's data alone — a vanilla map
   * from a modded install. A mod can change everything the generator reads:
   * the creature table (and its guards), the templates, the roster.
   */
  mods: boolean;
  /** Where mounted archives are unpacked to (cached by size and date). */
  cacheDir: string;
  /** The game's UNWRAPPED executable. */
  exe: string;
  /**
   * Roots in front of everything the game mounts, the first in front of the
   * rest: the install's own templates (`<game>/H5E`, where the editor saves
   * them — `user-templates.ts`) and the application's (`assets/rmg`, the
   * templates shipped with it). Optional: without them the game's templates
   * alone are read.
   */
  ownRoots?: string[];
}

/** A control of the dialog: its value, or left to chance. */
export type Wish<T> = T | 'random';

/**
 * An order as the dialog holds it — every control but the name, the seed and
 * the minimap may say `random`, and `resolve` draws it: the size, then the
 * floors, then a template the game's dialog would offer for those (and that
 * takes the players, when they are fixed), then the players inside its range;
 * the rest independently.
 */
export interface RmgWish {
  template: Wish<string>;
  sizeIndex: Wish<number>;
  underground: Wish<boolean>;
  water: Wish<number>;
  players: Wish<number>;
  monsterLevel: Wish<number>;
  resourceMultiplier: Wish<number>;
  expMultiplier: Wish<number>;
  grail: Wish<boolean>;
  randomTowns: Wish<boolean>;
  /** OURS: per player slot, a `TOWN_*` race or `random`; the first `players` entries count. */
  races?: string[];
  /** OURS: every hero of the players' races, once the run has seated them — see `heroes.ts`. */
  heroesOfRaces?: boolean;
  /** OURS: or exactly these — the dialog's white list of hrefs. */
  heroes?: string[];
}

/** The order as it was generated — every `random` of the wish resolved. */
export interface RmgResolvedOrder {
  template: string;
  sizeIndex: number;
  tiles: number;
  underground: boolean;
  water: number;
  players: number;
  monsterLevel: number;
  resourceMultiplier: number;
  expMultiplier: number;
  grail: boolean;
  randomTowns: boolean;
  /** The wish's races, cut to the players; absent when all random. */
  races?: string[];
  heroesOfRaces?: boolean;
  /** The white list, when there is one and the races' rule is off. */
  heroes?: string[];
}

/** What can be asked. Every request names the install, so an answerer has nothing to be told first. */
export type RmgRequest =
  | { kind: 'choices'; paths: RmgPaths }
  | { kind: 'offered'; paths: RmgPaths; sizeIndex: number; underground: boolean }
  | { kind: 'template'; paths: RmgPaths; file: string }
  | { kind: 'forget-templates'; paths: RmgPaths }
  | {
    kind: 'generate'; paths: RmgPaths; wish: RmgWish;
    seed: number; guid: string; mapName: string; minimap: boolean;
    /** The folder to write the map's files into; created if missing. */
    mapDir: string;
  };

/** A generated map, as the answer describes it: the files are in `mapDir` already. */
export interface RmgGenerated {
  order: RmgResolvedOrder;
  guid: string;
  seed: number;
  draws: number;
  objects: number;
  files: string[];
  ms: number;
  /** The generator's warnings — a named object the zone had no room for, say. */
  warnings: string[];
  /** The players' races as the run seated them, in slot order. */
  playerRaces: string[];
  /** The heroes the map lists; empty for the engine's own roster. */
  heroes: string[];
}

/** The answer to each kind of request. */
export interface RmgAnswers {
  choices: DialogChoices & { templates: OfferedTemplate[] };
  offered: OfferedTemplate[];
  template: { template: RmgTemplate; entry: OfferedTemplate };
  'forget-templates': null;
  generate: RmgGenerated;
}

export type RmgAnswer<K extends RmgRequest['kind']> = RmgAnswers[K];

/**
 * The install, mounted ONCE for these paths and kept: every memo downstream
 * hangs off the chain object, so keeping it is what makes them memos. A
 * different game folder is a different install.
 */
const installs = new Map<string, RmgInstall>();

const keyOf = (paths: RmgPaths): string => JSON.stringify(paths);

function installOf(paths: RmgPaths): RmgInstall {
  const key = keyOf(paths);
  let have = installs.get(key);
  if (!have) {
    const started = performance.now();
    const game = paths.mods ? mountArchives(paths.gameRoot, paths.cacheDir, paths.dataRoot) : assets([paths.dataRoot]);
    const data = (paths.ownRoots ?? []).reduceRight((chain, root) => inFront(root, chain), game);
    have = { data, exe: paths.exe };
    installs.set(key, have);
    console.log(`[rmg] install mounted: ${data.roots.length} roots${paths.mods ? '' : ', the data alone'} in ${Math.round(performance.now() - started)}ms`);
  }
  return have;
}

/** The lists, read once an install: five enumerations out of `types.xml` and the roster. */
const choicesOf = new WeakMap<RmgInstall, DialogChoices>();

function choices(install: RmgInstall): DialogChoices {
  let have = choicesOf.get(install);
  if (!have) {
    const started = performance.now();
    have = dialogChoices(install);
    choicesOf.set(install, have);
    console.log(`[rmg] choices read: ${have.heroes.length} heroes in ${Math.round(performance.now() - started)}ms`);
  }
  return have;
}

/** A draw for the dialog's "Random" choices — the SUITE's kind, not the engine's stream. */
const below = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;

/**
 * Every `random` of the wish, drawn — in the order the dialog's own
 * dependencies run: the size, then the floors, then a template the game's
 * dialog would offer for those (and one that takes the players, when they
 * are fixed), then the players inside its range. The rest are independent.
 * A fixed template narrows the sizes to the ones it fits, so "random size,
 * this template" never draws a size the engine would lift.
 */
export function resolve(install: RmgInstall, w: RmgWish): RmgResolvedOrder {
  const c = choices(install);
  const tiles = c.sizes.map((s) => s.tiles);
  const fits = (t: OfferedTemplate): boolean =>
    (w.template === 'random' || t.file === w.template)
    && (w.players === 'random' || (t.minPlayers <= w.players && w.players <= t.maxPlayers));
  const sizes = w.sizeIndex === 'random' ? tiles.map((_, i) => i) : [w.sizeIndex];
  const floors = w.underground === 'random' ? [false, true] : [w.underground];
  // What is on offer for each (size, floors) — and only the pairs with something on it.
  const offered = new Map<string, OfferedTemplate[]>();
  for (const s of sizes) for (const u of floors) {
    const list = templatesOffered(install, s, u).filter(fits);
    if (list.length) offered.set(`${s}/${u}`, list);
  }
  if (!offered.size) {
    throw new Error(`nothing the game's dialog would offer fits this order`
      + `${w.template !== 'random' ? ` — ${w.template}` : ''}${w.players !== 'random' ? `, ${w.players} players` : ''}`
      + `${w.sizeIndex !== 'random' ? `, ${c.sizes[w.sizeIndex]?.name ?? w.sizeIndex}` : ''}`
      + `${w.underground !== 'random' ? (w.underground ? ', with an underground' : ', one floor') : ''}`);
  }
  const sizeIndex = pick([...new Set([...offered.keys()].map((k) => Number(k.split('/')[0])))]);
  const underground = pick([...new Set([...offered.keys()].filter((k) => k.startsWith(`${sizeIndex}/`)).map((k) => k.endsWith('true')))]);
  const template = pick(offered.get(`${sizeIndex}/${underground}`)!);
  const players = w.players === 'random' ? template.minPlayers + below(template.maxPlayers - template.minPlayers + 1) : w.players;
  return {
    template: template.file, sizeIndex, tiles: tiles[sizeIndex]!, underground, players,
    // Water the way the checkbox records it, or none.
    water: w.water === 'random' ? pick([0, 2]) : w.water,
    monsterLevel: w.monsterLevel === 'random' ? below(c.monsterLevels.length) : w.monsterLevel,
    resourceMultiplier: w.resourceMultiplier === 'random' ? below(c.resourceMultipliers.length) : w.resourceMultiplier,
    expMultiplier: w.expMultiplier === 'random' ? below(c.expMultipliers.length) : w.expMultiplier,
    grail: w.grail === 'random' ? below(2) === 1 : w.grail,
    randomTowns: w.randomTowns === 'random' ? below(2) === 1 : w.randomTowns,
    races: w.races?.slice(0, players).some((r) => r !== 'random') ? w.races.slice(0, players) : undefined,
    heroesOfRaces: w.heroesOfRaces || undefined,
    heroes: !w.heroesOfRaces && w.heroes?.length ? [...w.heroes] : undefined,
  };
}

/** One request answered, in whichever process this runs. */
export function answer<R extends RmgRequest>(req: R): RmgAnswers[R['kind']] {
  const out = ((): RmgAnswers[RmgRequest['kind']] => {
    switch (req.kind) {
      case 'choices': {
        const install = installOf(req.paths);
        return { ...choices(install), templates: allTemplates(install) };
      }
      case 'offered':
        return templatesOffered(installOf(req.paths), req.sizeIndex, req.underground);
      case 'template': {
        const install = installOf(req.paths);
        const entry = allTemplates(install).find((t) => t.file === req.file);
        if (!entry) throw new Error(`no template ${req.file} in the install`);
        return { template: readTemplateNamed(install.data, req.file), entry };
      }
      case 'forget-templates': {
        // Every install of this game folder, mods or not — the user's folder
        // is in front of both. One never mounted has no list, and is not
        // mounted for it.
        for (const [key, have] of installs) if (key.includes(JSON.stringify(req.paths.gameRoot))) forgetTemplates(have);
        return null;
      }
      case 'generate': {
        const install = installOf(req.paths);
        const started = performance.now();
        const order = resolve(install, req.wish);
        const full: RmgOrder = { ...order, seed: req.seed, guid: req.guid, minimap: req.minimap, mapName: req.mapName };
        const map = generateMap(install, full);
        mkdirSync(req.mapDir, { recursive: true });
        for (const f of map.files) writeFileSync(join(req.mapDir, f.name), f.data);
        return {
          order, guid: map.guid, seed: req.seed, draws: map.draws, objects: map.objects,
          files: map.files.map((f) => f.name), ms: Math.round(performance.now() - started),
          warnings: map.warnings, playerRaces: map.playerRaces, heroes: map.heroes,
        };
      }
    }
  })();
  return out as RmgAnswers[R['kind']];
}
