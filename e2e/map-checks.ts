// Is the Rules Test map's SPEC one the game can actually build?
//
// WHY THIS EXISTS, and why it is a module rather than a few lines in a spec.
// Every mistake this catches is a SILENT one: a perk the hero does not qualify
// for is simply not granted, a shared path with a typo places nothing, a
// creature id the table does not have is an empty slot, a flag missing from
// `FIXES_UNDER_TEST` is a fix that the "turn them all on" run never turns on.
// In every case the map is written, the map loads, and the thing the test was
// going to watch is not there — which is a play-through spent on nothing, and
// it has already happened once (the warlock, with Payback and no Dark Magic).
//
// So the questions are asked of the GAME'S OWN FILES, not remembered here, and
// they are asked from two doors: `tools/test-fix-map.ts` in the unit suite,
// where they cost a second and need no install, and `fix-001` before it builds
// anything, where they are the last gate before somebody spends an evening.
//
// The one number this file does keep is the ranger's army, and it keeps it with
// its reason attached: see LOG_READ_ARMY.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXES_UNDER_TEST, HEROES, OPPONENT } from './fixes.ts';
import type { Kit } from './fixes.ts';
import { kitComplaints, skillRules } from './perk-rules.ts';
import { QOL_FLAGS } from '../src/mods/qol.ts';
import { takenSpells } from '../src/mods/spells.ts';
import { OUR_SPELL_FIXTURES } from './mods.ts';

/**
 * Spells the MOD adds, which the shipped types.xml naturally does not list.
 *
 * Written down rather than inferred, so that a typo in a kit is still caught: an
 * unknown spell is an error, and a spell of ours is an error until it is named
 * here. The list is the fixture's, so it stays one place.
 */
const OUR_SPELLS = new Set<string>(OUR_SPELL_FIXTURES.map((s) => s.id));

/**
 * How many creatures a side needs when the result is read from a LOG.
 *
 * Rounds are the instrument for exactly one hero. The ranger's fix reports
 * itself once per ballista shot and says six things at most; everything else on
 * this map is seen in a turn. Five hundred Air Elementals a side take about a
 * fifth of each other off per round, so the battle runs five rounds or so —
 * five shots, and the bar keeps moving between them because they act at
 * initiative 17 to the hero's 10. Drop the count to make the map build faster
 * and the battle ends before the log has said anything twice, which looks
 * exactly like a fix that did not fire. Hence a floor, and hence this comment.
 */
export const LOG_READ_ARMY = 500;

/** Kits whose result is read from `bin/homm5-editor.log` rather than watched. */
const READ_FROM_THE_LOG = new Set(['ranger']);

/** Every creature id the game's table knows. */
function creatureIds(dataRoot: string): Set<string> {
  const text = readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'Creatures.xdb'), 'latin1');
  return new Set([...text.matchAll(/CREATURE_[A-Z0-9_]+/g)].map((m) => m[0]));
}

/** Every shared record a kit points at, with what it was for. */
function sharedPaths(kit: Kit): Array<{ what: string; path: string }> {
  const out = [{ what: 'his own record', path: kit.shared }];
  if (kit.foe) out.push({ what: 'the stack he fights', path: kit.foe.shared });
  if (kit.artifact) out.push({ what: 'the artifact beside him', path: kit.artifact.shared });
  for (const n of kit.nearby ?? []) out.push({ what: 'a building behind him', path: n.shared });
  return out;
}

/**
 * Everything wrong with the map's spec, in sentences. Empty means nothing is.
 *
 * `dataRoot` is the unpacked game data. Without it the questions that need the
 * game's tables cannot be asked at all, and the caller is told so rather than
 * handed a pass it did not earn — see `dataIsThere`.
 */
export function mapComplaints(dataRoot: string): string[] {
  const said: string[] = [];
  const kits = [...HEROES, OPPONENT];

  // 1. The game's own skill table: can this hero hold this kit?
  const rules = skillRules(dataRoot);
  for (const kit of kits) said.push(...kitComplaints(kit, rules));

  // 2. The class's racial skill comes first, when the kit lists it at all.
  //
  //    `Editable/skills` REPLACES the shared hero's list and the game reads it
  //    into slots whose first is the racial's, so a racial listed second is a
  //    hero screen with two skills swapped — silent, and found by playing.
  //    Measured, not decided: of the 118 shipped hero records with a skill
  //    list, 117 put the racial first, none put it anywhere else, and the last
  //    has no racial. Which skill that is comes from the same table, so a class
  //    added tomorrow needs nothing written here.
  const racial = new Map<string, string>();
  for (const rule of rules.values()) {
    if (rule.kind !== 'SKILLTYPE_SKILL') continue;
    if (!rule.heroClass || rule.heroClass === 'HERO_CLASS_NONE') continue;
    racial.set(rule.heroClass, rule.id);
  }
  for (const kit of kits) {
    const his = racial.get(kit.heroClass);
    const listed = (kit.skills ?? []).map((s) => s.id);
    const at = his ? listed.indexOf(his) : -1;
    if (at > 0) {
      said.push(`${kit.key}: ${his} is ${kit.heroClass}'s racial skill and is listed ${at + 1}`
        + `, not first — the game puts ${listed[0]} in its slot and the two show up swapped`);
    }
  }

  // 3. Every creature named is one the game has.
  const creatures = creatureIds(dataRoot);
  for (const kit of kits) {
    for (const stack of kit.army) {
      if (!creatures.has(stack.creature)) {
        said.push(`${kit.key}: no such creature as ${stack.creature}`);
      }
    }
  }

  // 3b. Every spell named is one the game has — or one the mod adds.
  //
  //     A hero's `Editable/spells` names a spell by id, and an id types.xml does
  //     not declare is a map the game refuses to load: not a hero missing a
  //     spell, the whole map. Spells of ours are legal here and the fixture
  //     installs them before the map is built (installSpellFixture), so they are
  //     named as what they are rather than left to look like typos.
  const spells = takenSpells(readFileSync(join(dataRoot, 'types.xml'), 'latin1'));
  for (const kit of kits) {
    for (const spell of kit.spells ?? []) {
      if (spells.has(spell) || OUR_SPELLS.has(spell)) continue;
      said.push(`${kit.key}: no such spell as ${spell} — a map naming one is a map that will not load`);
    }
  }

  // 4. Every shared record named is a file that is there. A path with a typo
  //    places NOTHING and says nothing about it.
  for (const kit of kits) {
    for (const { what, path } of sharedPaths(kit)) {
      const onDisk = join(dataRoot, path.replace(/^\//, '').replace(/\//g, '\\'));
      if (!existsSync(onDisk)) said.push(`${kit.key}: ${what} is not in the data — ${path}`);
    }
  }

  // 5. Every fix the panel offers has a hero standing for it, and every flag a
  //    kit claims is on the list 002 asserts went on. That a flag EXISTS is the
  //    type's job (`QolName`); what types cannot say is that the map and the
  //    panel still describe the same set — a fix added tomorrow with no hero is
  //    turned on by the master switch and watched by nobody.
  const onTheMap = new Set<string>(kits.flatMap((kit) => kit.fixes));
  for (const kit of kits) {
    for (const flag of kit.fixes) {
      if (!FIXES_UNDER_TEST.includes(flag)) {
        said.push(`${kit.key}: ${flag} is not in FIXES_UNDER_TEST, so 002 never checks it went on`);
      }
    }
  }
  for (const flag of QOL_FLAGS) {
    if (flag.tab !== 'fixes') continue;
    if (!onTheMap.has(flag.name)) {
      said.push(`${flag.name} is a fix with no hero on the map — add one, or say here why not`);
    }
    if (!FIXES_UNDER_TEST.includes(flag.name)) {
      said.push(`${flag.name} is a fix that 002 never checks went on`);
    }
  }

  // 6. Nothing stands where something else already does. The row is numbered by
  //    hand, and a hero on top of another hero's foe is a battle that starts
  //    itself.
  const taken = new Map<string, string>();
  for (const kit of kits) {
    const spots: Array<{ what: string; at: { x: number; y: number } }> = [{ what: kit.key, at: kit.at }];
    if (kit.foe) spots.push({ what: `${kit.key}'s foe`, at: kit.foe.at });
    if (kit.artifact) spots.push({ what: `${kit.key}'s artifact`, at: kit.artifact.at });
    for (const n of kit.nearby ?? []) spots.push({ what: `a building of ${kit.key}'s`, at: n.at });
    for (const spot of spots) {
      const key = `${spot.at.x},${spot.at.y}`;
      const already = taken.get(key);
      if (already) said.push(`${spot.what} stands on ${already} at ${key}`);
      else taken.set(key, spot.what);
    }
  }

  // 7. The battle that has to LAST, lasts. See LOG_READ_ARMY.
  for (const kit of kits) {
    if (!READ_FROM_THE_LOG.has(kit.key)) continue;
    const mine = kit.army.reduce((n, s) => n + s.count, 0);
    if (mine < LOG_READ_ARMY) {
      said.push(`${kit.key}: reads his result from the log and has only ${mine} creatures`
        + ` — the battle ends before the log has said enough (${LOG_READ_ARMY} a side)`);
    }
    if (!kit.foe?.count) {
      said.push(`${kit.key}: his foe has no pinned count, so the game rolls its own size`
        + ' and how long the battle runs is not ours to know');
    } else if (kit.foe.count < LOG_READ_ARMY) {
      said.push(`${kit.key}: fights only ${kit.foe.count} — see LOG_READ_ARMY`);
    }
  }

  return said;
}

/** Is there unpacked game data to ask? The checks above need its tables. */
export function dataIsThere(dataRoot: string): boolean {
  return existsSync(join(dataRoot, 'GameMechanics', 'RefTables', 'Skills.xdb'))
    && existsSync(join(dataRoot, 'MapObjects'));
}
