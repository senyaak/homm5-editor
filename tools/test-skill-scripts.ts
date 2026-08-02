// The Lua half of a skill: two contexts, two files, two global scripts.
//
// Nothing here is visible until a battle runs, and a mistake in it is silent —
// the perk simply never happens. So the things that must hold are checked
// against the shipped files themselves: that our block goes where the game will
// still have run its own declarations, and that neither global script loses a
// line it came with.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMBAT_STARTUP, patchCombatStartup, skillCombatScripts, skillMapScripts, skillScriptFiles,
} from '../src/mods/skill-scripts.ts';
import { SCRIPT_DIR, patchCommonScript } from '../src/mods/artifact-scripts.ts';
import { luaDiagnostics } from '../src/script/lua-lint.ts';
import type { ModHeroSkill } from '../src/mods/hero-skills.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- the perk, as its author writes it ---------------------------------------
//
// «Запасной комплект»: a first aid tent destroyed in battle is back afterwards.
// Two halves, because one context knows the battle and the other owns the hero.
// The battle half asks nothing of the engine's hooks — by the time this runs the
// battle is built, so it just looks.

const IN_BATTLE = [
  '-- Was there a tent when the fighting started? Only the battle can say.',
  'local attacker = GetAttackerHero();',
  'if attacker ~= nil then',
  '\tif GetAttackerWarMachine(WAR_MACHINE_FIRST_AID_TENT) ~= nil then',
  '\t\tSetGameVar("h5e.tent."..GetHeroName(attacker), "1");',
  '\tend;',
  'end;',
  'local defender = GetDefenderHero();',
  'if defender ~= nil then',
  '\tif GetDefenderWarMachine(WAR_MACHINE_FIRST_AID_TENT) ~= nil then',
  '\t\tSetGameVar("h5e.tent."..GetHeroName(defender), "1");',
  '\tend;',
  'end;',
].join('\n');

const ON_THE_MAP = [
  'function SpareKit_AfterCombat(combatIndex)',
  '\tfor side = 0, 1 do',
  '\t\tlocal hero = GetSavedCombatArmyHero(combatIndex, side);',
  '\t\tif hero ~= nil then',
  '\t\t\tif GetGameVar("h5e.tent."..hero, "") == "1" then',
  '\t\t\t\tif HasHeroSkill(hero, HERO_SKILL_SPARE_KIT) then',
  '\t\t\t\t\tif not HasHeroWarMachine(hero, WAR_MACHINE_FIRST_AID_TENT) then',
  '\t\t\t\t\t\tGiveHeroWarMachine(hero, WAR_MACHINE_FIRST_AID_TENT);',
  '\t\t\t\t\tend;',
  '\t\t\t\tend;',
  '\t\t\t\tSetGameVar("h5e.tent."..hero, "");',
  '\t\t\tend;',
  '\t\tend;',
  '\tend;',
  'end;',
  '',
  'Trigger(COMBAT_RESULTS_TRIGGER, "SpareKit_AfterCombat");',
].join('\n');

const SPARE_KIT: ModHeroSkill = {
  id: 'HERO_SKILL_SPARE_KIT',
  number: 224,
  kind: 'perk',
  heroClass: 'HERO_CLASS_WITCH',
  name: 'Запасной комплект',
  description: 'Разрушенная в бою палатка первой помощи восстанавливается после сражения.',
  basicSkill: 'HERO_SKILL_TENT_MASTER',
  script: ON_THE_MAP,
  combatScript: IN_BATTLE,
};

check('what an author writes passes the linter, both halves',
  luaDiagnostics(IN_BATTLE).length === 0 && luaDiagnostics(ON_THE_MAP).length === 0,
  JSON.stringify([...luaDiagnostics(IN_BATTLE), ...luaDiagnostics(ON_THE_MAP)].slice(0, 1)));

// --- the files ---------------------------------------------------------------

const bare: ModHeroSkill = { ...SPARE_KIT, script: undefined, combatScript: undefined };
check('a skill with no script contributes no file', skillScriptFiles([bare]).length === 0);

const files = skillScriptFiles([SPARE_KIT]);
check('one file per side it carries', files.length === 2, files.map((f) => f.path).join());
check('each lands where a doFile can name it',
  files[0]!.path === `${SCRIPT_DIR}/SPARE_KIT.lua` && files[1]!.path === `${SCRIPT_DIR}/SPARE_KIT-combat.lua`,
  files.map((f) => f.path).join());
// The number is assigned by the build. A script naming it by hand is a script
// that goes wrong the day a skill is added before it.
check('the head declares the skill\'s own id', files[0]!.text.includes('HERO_SKILL_SPARE_KIT = 224;'));
// Neither context ships these, and a bare 3 in a script is a puzzle.
check('and the war machine types, which neither context declares',
  files[0]!.text.includes('WAR_MACHINE_FIRST_AID_TENT = 3;')
  && files[1]!.text.includes('WAR_MACHINE_FIRST_AID_TENT = 3;'));
check('the author\'s text is carried verbatim',
  files[0]!.text.includes('Trigger(COMBAT_RESULTS_TRIGGER, "SpareKit_AfterCombat");')
  && files[1]!.text.includes('GetAttackerWarMachine(WAR_MACHINE_FIRST_AID_TENT)'));
check('both whole files pass the linter',
  files.every((f) => luaDiagnostics(f.text).length === 0));
check('and the engine reads them byte by byte, so lines end CRLF',
  files.every((f) => f.text.includes('\r\n') && !/[^\r]\n/.test(f.text)));

check('the two sides are told apart for their global scripts',
  skillMapScripts([SPARE_KIT]).length === 1 && skillCombatScripts([SPARE_KIT]).length === 1
  && skillMapScripts([{ ...SPARE_KIT, script: undefined }]).length === 0);

// --- the adventure side ------------------------------------------------------

const SHIPPED_COMMON = 'doFile("/scripts/common.lua")\n\nfunction GiveExp( heroName, exp )\nend\n';
check('a mod with no scripted skill and no scripted set leaves advmap-common.lua alone',
  patchCommonScript(SHIPPED_COMMON, [], []) === SHIPPED_COMMON);
const common = patchCommonScript(SHIPPED_COMMON, [], skillMapScripts([SPARE_KIT]));
check('the game\'s own lines are all still there', common.startsWith(SHIPPED_COMMON.trimEnd()));
check('the skill\'s map file is loaded', common.includes(`doFile("/${SCRIPT_DIR}/SPARE_KIT.lua");`));
check('the patched common script passes the linter', luaDiagnostics(common).length === 0);

// --- the battle side ---------------------------------------------------------
//
// Against the real file, because the whole point of the tail is WHERE it sits:
// `combat-startup.lua` loads `combat-common.lua` on its first line and declares
// the empty hooks afterwards, so anything of ours placed earlier is overwritten
// a moment later by a declaration that does nothing.

const gameRoot = process.env.HOMM5_GAME ?? resolve(import.meta.dirname, '..', '..');
let shippedCombat: string | null = null;
try {
  shippedCombat = readFileSync(resolve(import.meta.dirname, '..', 'data-unpacked', COMBAT_STARTUP), 'latin1');
} catch {
  shippedCombat = null;
}

check('a mod with no battle script leaves combat-startup.lua alone',
  patchCombatStartup('doFile("/scripts/combat-common.lua")\n', [bare])
  === 'doFile("/scripts/combat-common.lua")\n');

if (shippedCombat === null) {
  console.log(`  skip  the shipped combat-startup.lua is not unpacked (${gameRoot})`);
} else {
  const combat = patchCombatStartup(shippedCombat, [SPARE_KIT]);
  check('every line the game ships is still there', combat.startsWith(shippedCombat.trimEnd()));
  check('the vocabulary a combat script is written against survives',
    combat.includes('function IsWarMachine(unit)') && combat.includes('function GetAttackerHero()'));
  // The reason for the tail, stated as a test: our doFile has to come after the
  // declarations, or the file we load is undone by them.
  check('our load comes after the game\'s declarations',
    combat.indexOf(`doFile("/${SCRIPT_DIR}/SPARE_KIT-combat.lua");`)
      > combat.lastIndexOf('function DefenderWarMachineDeath('));
  // And it does not take a name the game owns: the block is straight-line code.
  check('and it redefines nothing of the game\'s',
    !/^\s*function\s/m.test(combat.slice(shippedCombat.trimEnd().length)));
  check('the patched combat startup passes the linter', luaDiagnostics(combat).length === 0,
    JSON.stringify(luaDiagnostics(combat).slice(0, 1)));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
