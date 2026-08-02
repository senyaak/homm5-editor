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
    '-- yours to pick. Uncomment one, or write another — the editor completes',
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
): string {
  const files = [...setScriptFiles(sets).map((f) => f.path), ...extra];
  if (!files.length) return shipped;
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
    ...files.map((f) => `doFile("/${f}");`),
  ].join(EOL);
  return shipped.replace(/\s*$/, EOL) + block + EOL;
}
