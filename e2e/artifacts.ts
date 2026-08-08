// Everything the suite makes, by name — and taking all of it back out.
//
// WHY A LIST AND NOT A PREFIX. Every name here begins with `e2e `, and the
// cleanup used to go by that alone. A convention answers "is this ours?" but
// never "what is ours?", so a run could only ever remove what it happened to
// find in one folder, and an artefact written somewhere else was invisible to
// it. Declared, the answer is exhaustive: clearing is a walk over this list.
//
// SO A NEW ARTEFACT GOES HERE FIRST. `checkDeclared` reads the specs and refuses
// to start a run that uses a name this file does not know — the coupling is
// enforced rather than remembered, which is the whole point of writing it down.
//
// AND ONLY AT THE START. A run that is killed part-way never reaches an
// end-of-run cleanup, which is exactly when leftovers matter: the next run then
// fails in whichever spec wanted that name, with "already exists" about a file
// the person watching never asked for. Clearing on the way in always happens.

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFillPresets, writeFillPresets } from '../src/fill/preset.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { DATA, E2E_GAME, REPO_ROOT } from './launch.ts';

/**
 * The name of every map, campaign and workspace a spec creates.
 *
 * Keyed by what makes it, so a spec's entry is findable from its file name.
 *
 * MOST begin with `e2e ` — "a name no real map would have" — and `checkDeclared`
 * finds those in the sources by itself. `Sharpshooter Test` does not, and it is
 * the reason this is a list rather than a rule: a cleanup that went by the
 * prefix walked straight past it, and left a map in the player's folder while
 * reporting that everything of the suite's had been taken out. A name that does
 * not follow the convention has to be written here by hand.
 */
export const MADE = {
  ABSENT_FIELD: 'e2e Absent Field',
  CAMPAIGN: 'e2e Campaign',
  CAMPAIGN_MAP: 'e2e Campaign Map',
  CARRY: 'e2e Carry',
  CARRY_M1: 'e2e Carry M1',
  CARRY_M2: 'e2e Carry M2',
  CARRY_M3: 'e2e Carry M3',
  CLICK_TERRAIN: 'e2e Click Terrain',
  CLOSE_MAP: 'e2e Close Map',
  DIALOGS: 'e2e Dialogs',
  DIALOGS_MAP: 'e2e Dialogs Map',
  FILL: 'e2e Fill',
  /** A fill preset, which lives INSIDE a file rather than as one — see below. */
  FILL_PRESET: 'e2e Own Rocks',
  LOCALIZE: 'e2e Localize',
  MONSTER_AMOUNT: 'e2e monster amount',
  NEW_MAP: 'e2e New Map',
  // One map for both effect questions — what a system is glued to, and how often
  // it starts again. It was two (`e2e Glued Effects`, `e2e Effect Timing`), each
  // a 72×72 built to stand one object on.
  OBJECT_EFFECTS: 'e2e Object Effects',
  OBJECT_TREE: 'e2e Object Tree',
  PACK: 'e2e Pack',
  PACK_EDITED: 'e2e Pack, edited',
  PAINT_BLEND: 'e2e Paint Blend',
  PAINT_BURST: 'e2e Paint Burst',
  PANEL_STRUCTURED: 'e2e panel structured',
  PLACE_OBJECTS: 'e2e Place Objects',
  PLACE_PRECISELY: 'e2e Place Precisely',
  REACH: 'e2e Reach',
  RECONSTRUCT_C1M1: 'e2e Reconstruct C1M1',
  SCRIPT_EDITOR: 'e2e Script Editor',
  /** mod-007 rebuilds this one, and it is named after what it rebuilds. The
   *  ORIGINAL it is compared against lives in `assets/maps/` and is in the
   *  repo; what stands in the game folder is this run's output. */
  SHARPSHOOTER_MAP: 'Sharpshooter Test',
  /** mod-010 stands every building the campaign adds on one map, to be looked at
   *  in the game. Named for what it holds rather than `e2e …`, because unlike
   *  the rest it is meant to be opened and played. */
  SOD_DWELLINGS_MAP: 'SoD Dwellings',
  TEXT: 'e2e Text',
  TOWN_SPEC: 'e2e town spec',
  TREE_EXPAND: 'e2e tree expand',
  UNITS_MAP: 'e2e Units Map',
} as const;

export type MadeName = (typeof MADE)[keyof typeof MADE];

/** What every one of them is called, whatever kind of thing it is. */
export const EVERY_NAME: readonly string[] = Object.values(MADE);

/**
 * Refuse to start when a spec uses a name this file has not been told about.
 *
 * Reading the sources rather than trusting them to import from here: the specs
 * are 28 files that each name their own map, and a check costs one pass over
 * them where making them all import would cost 28 edits and say no more.
 *
 * It can only catch the ones that follow the convention — a name like
 * `Sharpshooter Test` is invisible to it, and to any rule of the same shape.
 * That is what the list above is for.
 */
export function checkDeclared(): void {
  const declared = new Set<string>(EVERY_NAME);
  const undeclared = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.ts') || entry.name === 'artifacts.ts') continue;
      for (const [, name] of readFileSync(path, 'utf8').matchAll(/'(e2e [^']+)'/g)) {
        if (!declared.has(name!)) undeclared.set(name!, entry.name);
      }
    }
  };
  walk(join(REPO_ROOT, 'e2e'));
  if (!undeclared.size) return;
  const said = [...undeclared].map(([name, file]) => `  '${name}'  (${file})`).join('\n');
  throw new Error('e2e/artifacts.ts does not know about every name the specs use, so a run'
    + ` could not clear them all. Add these to MADE:\n${said}\n`);
}

/** Every place one name can leave something behind. */
function placesOf(name: string): string[] {
  return [
    modFile(E2E_GAME, 'map', name),
    modFile(E2E_GAME, 'campaign', name),
    join(DATA, 'Maps', 'SingleMissions', name),
    join(DATA, 'Campaigns', name),
  ];
}

/**
 * Take out everything the suite has ever made, wherever it made it.
 *
 * Returns what was actually there, so the caller can say so — a line at the
 * start turns a later "already exists" into something already accounted for.
 */
export function clearAll(): string[] {
  const gone: string[] = [];
  for (const name of EVERY_NAME) {
    for (const path of placesOf(name)) {
      if (!existsSync(path)) continue;
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      gone.push(path);
    }
  }
  gone.push(...clearFillPresets());
  return gone;
}

/**
 * Take the suite's fill presets out of the user's preset file.
 *
 * The odd one out: a preset is not a file, it is an entry IN one, and that file
 * belongs to whoever is using this install — so it is edited rather than
 * deleted, and only emptied of ours. When nothing of anybody's is left, the
 * file goes, since an empty one is something the suite created.
 */
function clearFillPresets(): string[] {
  const file = join(E2E_GAME, 'H5E', 'FillPresets.xml');
  if (!existsSync(file)) return [];
  let all;
  try { all = readFillPresets(readFileSync(file, 'utf8'), file); }
  catch { return []; }
  const ours = new Set<string>(EVERY_NAME);
  const rest = all.filter((p) => !ours.has(p.name));
  if (rest.length === all.length) return [];
  if (rest.length) writeFileSync(file, writeFillPresets(rest), 'utf8');
  else rmSync(file, { force: true });
  return [`${file} (${all.length - rest.length} preset(s))`];
}
