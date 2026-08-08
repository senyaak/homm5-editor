// A set that reacts to something: the Lua half of an artifact set.
//
// The extension adds NUMBERS to the engine's own arithmetic — a percentage, a
// ceiling — because those live inside calculations no script can reach. What it
// cannot do is decide WHEN: "at the start of every day", "when this building is
// visited", "after that battle" are events, and the engine already hands events
// to Lua. So the two halves split along that line, and this file is the second
// one: the script a set carries, and how it reaches the game.
//
// HOW IT REACHES THE GAME. `scripts/advmap-startup.lua` ends with
// `doFile("/scripts/advmap-common.lua")`, and both are ordinary files under the
// data root, so a mod that carries its own copy runs code on EVERY adventure
// map — the game's own included. Measured, not assumed: see
// docs/NAMES_AND_SCRIPTING.md, where a probe answered both this and whether a
// trigger set here survives a map that sets its own (it does; triggers stack).
//
// WHAT IS GENERATED AND WHAT IS AUTHORED. The header is ours: the set's members
// as the constants a script names them by, and the helpers in the global file
// hide the walk over heroes. Everything else is the author's, verbatim — a
// script is a script, and what runs is what they wrote.

import type { ModArtifactSet } from './mod-model.ts';

/** Where a set's script goes inside the mod. */
export const SCRIPT_DIR = 'scripts/homm5-editor';
/** The game's global script, which we carry a copy of when there is anything to load. */
export const COMMON_SCRIPT = 'scripts/advmap-common.lua';

const EOL = '\r\n';

/** A Lua name from a file stem: what the generated symbols are prefixed with. */
export const symbolOf = (file: string): string => file.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * What a set's script looks like before anybody has written anything.
 *
 * Not a nicety. Everything above the author's first line is knowledge they have
 * no way to have: that the members arrive as `<Set>_MEMBERS`, that the walk over
 * the eight players is theirs to write, that `EditorHeroWearing` is the question
 * to ask, and that a function nothing hooks to an event never runs.
 *
 * WHICH event is not ours to decide. "Once a day" fits a granting effect and
 * fits nothing else — a set that acts on a battle, on touching an object, on a
 * hero levelling up is the same function under a different `Trigger`. So the
 * hook is left as commented shapes to choose from: the starter as it stands
 * does nothing, and that is honest, where a `NEW_DAY_TRIGGER` line put there by
 * us would be an answer to a question nobody asked.
 *
 * Written ONCE, when the editor is opened on a set that has no script. The name
 * is right from the start because the stem is typed before the script is —
 * nothing here is ever rewritten afterwards, and a set that wants a second
 * behaviour at a different number of pieces gets a copy of the function.
 *
 * Nothing here ever UNHOOKS anything either: a trigger stays on for the whole
 * map and the check inside is what changes its mind (docs/NAMES_AND_SCRIPTING.md
 * — the trigger is the WHEN, the condition is the WHETHER).
 *
 * It lives beside the generator so the two cannot drift: the constant this
 * names is the constant `header()` writes.
 *
 * @param file    the set's file stem — the same one the header is built from
 * @param members how many pieces the set has, which is the count to start from
 */
export function starterScript(file: string, members: number): string {
  const name = symbolOf(file || 'MySet');
  return [
    `-- \`${name}_MEMBERS\` is written for you in the head above.`,
    '-- Everything from here down is yours.',
    `function ${name}_Worn()`,
    `	local x = ${Math.max(1, members || 1)};   -- pieces that have to be on`,
    '	for player = 1, 8 do',
    `		local hero = EditorHeroWearing(player, ${name}_MEMBERS, x);`,
    '		if hero then',
    '			-- Your code. `hero` is wearing them, `player` owns him.',
    '		end;',
    '	end;',
    'end;',
    '',
    '-- Nothing above runs until it is hooked to an event, and WHICH event is',
    '-- yours to pick. Uncomment one, or write another - the editor completes',
    '-- the trigger names:',
    `-- Trigger(NEW_DAY_TRIGGER, "${name}_Worn");`,
    `-- Trigger(COMBAT_RESULTS_TRIGGER, "${name}_Worn");`,
    `-- Trigger(OBJECT_TOUCH_TRIGGER, "someObjectName", "${name}_Worn");`,
    '',
    '-- A second behaviour at a different number of pieces is a copy of the',
    '-- function above with another x, under its own trigger.',
    '',
  ].join(EOL);
}

/**
 * The generated head of a set's script: its members, by the names a script uses.
 *
 * The ids are the constants `advmap-startup.lua` defines — the mod appends its
 * own artifacts to that list already, so a member of ours is as nameable as a
 * shipped one.
 */
function header(set: ModArtifactSet): string {
  const name = symbolOf(set.file);
  return [
    // ASCII: the file is written latin1, and a dash of ours came out as a hole.
    `-- ${set.name || set.effect} - generated by the editor. Do not edit this head;`,
    '-- it is rewritten whenever the set changes. The code below it is yours.',
    `${name}_MEMBERS = { ${set.artifacts.join(', ')} };`,
    '',
  ].join(EOL) + EOL;
}

/** One file per set that carries a script, plus nothing when none do. */
export function setScriptFiles(sets: readonly ModArtifactSet[]): { path: string; text: string }[] {
  return sets
    .filter((s) => s.script?.trim())
    .map((s) => ({
      path: `${SCRIPT_DIR}/${s.file}.lua`,
      text: header(s) + s.script!.replace(/\r?\n/g, EOL),
    }));
}

/**
 * A specialization handing out its ability, on every map, at run time.
 *
 * THE POINT OF DOING IT HERE. The build could write the spell into the document
 * of every hero holding the specialization, in one line and with no code — and
 * then the engine would know nothing about the specialization at all. The
 * connection would exist only in the files this build wrote, so a hero it did
 * not build would hold the specialization and get nothing. Asked and answered on
 * the map instead, it is the specialization that gives the ability, to whoever
 * holds it, however he got there.
 *
 * The question itself is the extension's — no registered function of the game's
 * can say which specialization a hero holds (native/lua/hero-specialization.c).
 * Without the extension the block does nothing at all rather than erroring: a
 * mod is installed into games that may not have it.
 *
 * NAMES, and the values declared once at the top. `HERO_SPEC_…` and `SPELL_…`
 * are entries the mod appended to enums, so Lua has never heard of either name
 * and the engine deals only in values — but a table written in bare numbers is a
 * table that goes stale the moment the mod's order changes, and unreadable long
 * before that. Same rule a spell's own script already follows (spellScriptFile).
 * Declaring them here also puts them in reach of whatever the author writes:
 * `SPELL_H3_TRAIN_SHARPSHOOTERS` means something on every map.
 *
 * Two ways in, because heroes arrive two ways: the sweep catches everyone the
 * map starts with, and the trigger catches everyone hired or raised afterwards.
 * Setting a trigger here does not take it from a map that sets its own — they
 * stack, which is measured (docs/NAMES_AND_SCRIPTING.md).
 */
export interface ModAbility {
  spec: { id: string; number: number };
  spell: { id: string; number: number };
}

function abilityLines(abilities: readonly ModAbility[]): string[] {
  if (!abilities.length) return [];
  // One declaration per name, however many pairings use it: two specializations
  // may grant the same spell, and a name assigned twice reads like a mistake.
  const declared = new Map<string, number>();
  for (const a of abilities) {
    declared.set(a.spec.id, a.spec.number);
    declared.set(a.spell.id, a.spell.number);
  }
  return [
    '-- The values the mod assigned, under the names everything below says them by.',
    '-- The engine deals in numbers; a script written against a bare one goes stale',
    '-- the moment the mod\'s order changes.',
    ...[...declared].map(([id, number]) => `${id} = ${number};`),
    '',
    '-- What a specialization of the mod GIVES.',
    'H5E_SPEC_ABILITY = {};',
    ...abilities.map((a) => `H5E_SPEC_ABILITY[${a.spec.id}] = ${a.spell.id};`),
    '',
    '-- One hero, given whatever his specialization promises.',
    '--',
    '-- ASKED PER PAIRING rather than "which one has he": the engine answers "is it',
    '-- this" through a virtual it already uses for the first aid tent, and that',
    '-- needs no field offset - where the value LIVES cost three runs to look for',
    '-- and never had to be found. Without the extension this does nothing at all',
    '-- rather than failing: a mod is installed into games that may not have it.',
    // A BARE `return`, three times. Lua 4 rejects `return;` — and rejects the
    // WHOLE FILE for it, so one stray semicolon here stops every script of ours
    // on every map, silently. It did exactly that once.
    'function H5EGrantAbility(hero)',
    '\tif H5EHeroHasSpecialization == nil then return end;',
    '\tlocal spec, spell;',
    '\tfor spec, spell in H5E_SPEC_ABILITY do',
    '\t\tif H5EHeroHasSpecialization(hero, spec) then',
    '\t\t\tif KnowHeroSpell(hero, spell) == nil then TeachHeroSpell(hero, spell); end;',
    '\t\tend;',
    '\tend;',
    'end;',
    '',
    '-- Everyone the map starts with. It waits one turn first: when this file runs',
    '-- the map is still being built, and GetPlayerHeroes would answer for a world',
    '-- that is not finished. Started as a thread for the same reason - nothing may',
    '-- sleep while the map is loading.',
    'function H5EGrantAbilities()',
    '\tsleep(1);',
    '\tfor player = 1, 8 do',
    '\t\tlocal heroes = GetPlayerHeroes(player);',
    '\t\tif heroes ~= nil then',
    '\t\t\tfor index, hero in heroes do H5EGrantAbility(hero); end;',
    '\t\tend;',
    '\tend;',
    'end;',
    '',
    '-- And everyone who arrives later - hired, raised, handed over by a script.',
    '--',
    '-- WHICH ARGUMENT IS THE HERO is not settled: no shipped script uses this',
    '-- trigger, so there is nothing to read it off. Both shapes are served, and',
    '-- the sweep above covers the map either way - this only decides whether a',
    '-- hero hired later has to wait for one.',
    'function H5EHeroArrived(one, two)',
    '\tif two == nil then H5EGrantAbility(one) else H5EGrantAbility(two) end;',
    'end;',
    '',
    '-- PER PLAYER, and that is the whole of the bug this line had: this trigger',
    '-- takes whose it is before it takes the function, the way a region trigger',
    '-- takes the region. Handed the name straight away, the engine reads it as the',
    '-- player and says so - "player ID must be number", once, in the game.',
    'for player = 1, 8 do',
    '\tTrigger(PLAYER_ADD_HERO_TRIGGER, player, "H5EHeroArrived");',
    'end;',
    'startThread(H5EGrantAbilities);',
    '',
  ];
}

/**
 * The game's own `advmap-common.lua`, plus our library and one `doFile` per set.
 *
 * Appended rather than replaced: the 73 lines the game ships are what every
 * mission's script expects to find, and a mod that dropped them would break far
 * more than it added.
 *
 * `extra` is for the other things in a mod that carry adventure-map Lua — a
 * skill's own script, today. They load through the same file because there is
 * only one such file: the game does one doFile at the end of its startup, and
 * everything of ours that wants to run on every map hangs off it.
 */
export function patchCommonScript(
  shipped: string,
  sets: readonly ModArtifactSet[],
  extra: readonly string[] = [],
  abilities: readonly ModAbility[] = [],
  /**
   * Lua a spell of the mod carries — its own "may it be cast" and "what the
   * click does", plus whatever they need, already written out.
   *
   * IT GOES IN HERE because there is one file: the game does one `doFile` at
   * the end of its startup and everything of ours that must run on every map
   * hangs off it. Until this existed, the training spell's script reached the
   * game through a hand-run tool in `_tmp` — which is to say it was not part of
   * the mod at all, and nobody who rebuilt the mod got it.
   */
  spellScript = '',
): string {
  const files = [...setScriptFiles(sets).map((f) => f.path), ...extra];
  if (!files.length && !abilities.length && !spellScript) return shipped;
  const block = [
    '',
    '-- --- homm5-editor ----------------------------------------------------------',
    '-- Helpers for artifact sets that carry a script, and the scripts themselves.',
    '-- Generated; the editor rewrites this block whenever the mod is built.',
    '',
    '-- How many of `members` this hero is WEARING. A piece in the backpack does',
    '-- not count: HasArtefact\'s third argument is the one the manuals omit.',
    'function EditorWornCount(hero, members)',
    '\tlocal worn = 0;',
    '\tfor index, id in members do',
    '\t\tif HasArtefact(hero, id, 1) then worn = worn + 1; end;',
    '\tend;',
    '\treturn worn;',
    'end;',
    '',
    '-- The first hero of this player wearing at least `count` of them, or nil.',
    'function EditorHeroWearing(player, members, count)',
    '\tlocal heroes = GetPlayerHeroes(player);',
    '\tif heroes == nil then return nil; end;',
    '\tfor index, hero in heroes do',
    '\t\tif EditorWornCount(hero, members) >= count then return hero; end;',
    '\tend;',
    '\treturn nil;',
    'end;',
    '',
    '-- Ask the player how many of `creature` to turn into `becomes`, and WAIT',
    '-- for the answer. Both are CREATURE_ numbers; the answer is 1..most, or -1',
    '-- if the window was closed without one.',
    '--',
    '-- The window is the extension\'s (H5EAskCount) and THE WAITING HAS TO BE HERE:',
    '-- a registered function\'s results are counted the moment it returns, so the',
    '-- one that opens a window cannot answer with a number that does not exist yet.',
    'function ShowSliderDialog(creature, becomes, most)',
    '\tif H5EAskCount == nil then return -1; end;',
    '\tH5EAskCount(creature, becomes, most);',
    '\tlocal chosen = H5EAskedCount();',
    '\twhile chosen == nil do',
    '\t\tsleep(1);',
    '\t\tchosen = H5EAskedCount();',
    '\tend;',
    '\treturn chosen;',
    'end;',
    '',
    ...abilityLines(abilities),
    ...files.map((f) => `doFile("/${f}");`),
    ...(spellScript ? spellScript.split(/\r?\n/) : []),
  ].join(EOL);
  return shipped.replace(/\s*$/, EOL) + block + EOL;
}
