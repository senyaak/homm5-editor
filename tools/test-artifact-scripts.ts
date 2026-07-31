// The Lua half of an artifact set: what the mod carries, and what loads it.
//
// Two things have to hold, and neither is visible until a map runs: the file is
// generated where a `doFile` will look for it, and the game's own
// `advmap-common.lua` keeps every line it shipped with. A mod that drops those
// 73 lines breaks every mission's script, and it breaks them silently.

import { COMMON_SCRIPT, SCRIPT_DIR, patchCommonScript, setScriptFiles } from '../src/mods/artifact-scripts.ts';
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

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
