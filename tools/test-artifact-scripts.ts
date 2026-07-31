// The Lua half of an artifact set: what the mod carries, and what loads it.
//
// Two things have to hold, and neither is visible until a map runs: the file is
// generated where a `doFile` will look for it, and the game's own
// `advmap-common.lua` keeps every line it shipped with. A mod that drops those
// 73 lines breaks every mission's script, and it breaks them silently.

import { COMMON_SCRIPT, SCRIPT_DIR, patchCommonScript, setScriptFiles, starterScript } from '../src/mods/artifact-scripts.ts';
import { luaDiagnostics } from '../src/script/lua-lint.ts';
import type { ModArtifactSet } from '../src/mods/mod-model.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const SET: ModArtifactSet = {
  effect: 'ARTFSET_EFFECT_H3_UNDEAD_KING',
  number: 11,
  file: 'H3UndeadKing',
  name: 'Плащ короля нежити',
  description: 'три предмета',
  artifacts: ['ARTIFACT_H3_UNDERTAKERS_AMULET', 'ARTIFACT_H3_VAMPIRES_CLOAK', 'ARTIFACT_H3_DEAD_MANS_BOOTS'],
};

// --- what an author writes ---------------------------------------------------
//
// A script is a script: nothing wraps it and nothing is generated but the head
// naming the members. This is the shape one takes, and it has to survive the
// linter — a set whose script does not is a set that does nothing in game.

const AUTHORED = [
  'function H3UndeadKing_NewDay()',
  '\tfor player = 1, 8 do',
  '\t\tlocal hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);',
  '\t\tif hero then RestoreDarkEnergy(player); end;',
  '\tend;',
  'end;',
  '',
  'Trigger(NEW_DAY_TRIGGER, "H3UndeadKing_NewDay");',
].join('\r\n');
check('the shape an author writes passes the linter', luaDiagnostics(AUTHORED).length === 0,
  JSON.stringify(luaDiagnostics(AUTHORED).slice(0, 1)));

// --- the files ---------------------------------------------------------------

check('a set with no script contributes no file', setScriptFiles([SET]).length === 0);

const withScript: ModArtifactSet = { ...SET, script: AUTHORED };
const files = setScriptFiles([withScript]);
check('one file per set that carries one', files.length === 1, files.map((f) => f.path).join());
check('it lands where a doFile can name it', files[0]!.path === `${SCRIPT_DIR}/H3UndeadKing.lua`, files[0]!.path);
check('the generated head declares the members', files[0]!.text.includes(
  'H3UndeadKing_MEMBERS = { ARTIFACT_H3_UNDERTAKERS_AMULET, ARTIFACT_H3_VAMPIRES_CLOAK, ARTIFACT_H3_DEAD_MANS_BOOTS };'));
check('the author\'s text is carried verbatim', files[0]!.text.includes('Trigger(NEW_DAY_TRIGGER, "H3UndeadKing_NewDay");'));
check('the whole file still passes the linter', luaDiagnostics(files[0]!.text).length === 0);
check('and the engine reads it byte by byte, so lines end CRLF',
  files[0]!.text.includes('\r\n') && !/[^\r]\n/.test(files[0]!.text));

// --- the global script -------------------------------------------------------

const SHIPPED = 'doFile("/scripts/common.lua")\n\nfunction GiveExp( heroName, exp )\nend\n';
check('a mod with no scripted set leaves advmap-common.lua alone',
  patchCommonScript(SHIPPED, [SET]) === SHIPPED);

const common = patchCommonScript(SHIPPED, [withScript]);
check('the game\'s own lines are all still there', common.startsWith(SHIPPED.trimEnd()));
check('the set\'s file is loaded', common.includes(`doFile("/${SCRIPT_DIR}/H3UndeadKing.lua");`));
check('the helpers a script leans on are defined', common.includes('function EditorHeroWearing(')
  && common.includes('function EditorWornCount('));
// The third argument is the one the manuals omit and the whole reason the
// helper exists: a piece in the backpack is not worn.
check('worn means WORN', common.includes('HasArtefact(hero, id, 1)'));
check('the patched file passes the linter', luaDiagnostics(common).length === 0,
  JSON.stringify(luaDiagnostics(common).slice(0, 1)));
check('it is named where the game looks for it', COMMON_SCRIPT === 'scripts/advmap-common.lua');

// --- the starter --------------------------------------------------------------
//
// The thing an author cannot know from an empty editor: what the members are
// called, what question to ask about them, and that a file which never calls
// Trigger does nothing at all. It is checked against the GENERATOR, because a
// starter naming a constant the head does not write is worse than none.

const starter = starterScript('H3UndeadKing', 3);
check('the starter names the constant the head writes',
  starter.includes('H3UndeadKing_MEMBERS') && files[0]!.text.includes('H3UndeadKing_MEMBERS ='));
check('it asks the question the helper answers', starter.includes('EditorHeroWearing(player, H3UndeadKing_MEMBERS, x)'));
// The count is a named knob rather than a number buried in the call: a set with
// a second behaviour at another number is that function copied with another x.
check('the count is a knob with the whole set as its first value', starter.includes('local x = 3;'));
// WHICH event a set acts on is the author's — "once a day" fits a granting
// effect and nothing else. So the hook is shown and not made: the starter as it
// stands runs nothing, and says in as many words that this is why.
check('it does not decide when the set acts',
  !/^\s*Trigger\(/m.test(starter), 'an uncommented Trigger line');
check('but it says a hook is what makes it run, and offers shapes',
  starter.includes('-- Trigger(NEW_DAY_TRIGGER, "H3UndeadKing_Worn");')
  && starter.includes('-- Trigger(OBJECT_TOUCH_TRIGGER, "someObjectName", "H3UndeadKing_Worn");')
  && /hooked to an event/.test(starter));
check('it leaves a place to write in', /your code/i.test(starter));
check('it passes the linter as it stands', luaDiagnostics(starter).length === 0,
  JSON.stringify(luaDiagnostics(starter).slice(0, 1)));
check('a set with no stem still gets something that parses',
  luaDiagnostics(starterScript('', 0)).length === 0);
// A stem is a file name, not a Lua name: `My Set-2` has to become a symbol.
check('a stem that is not a Lua name is made into one',
  starterScript('My Set-2', 2).includes('function My_Set_2_Worn()'));
check('and the head would spell it the same way',
  setScriptFiles([{ ...withScript, file: 'My Set-2' }])[0]!.text.includes('My_Set_2_MEMBERS ='));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
