// A faction in the mod — the model's edits, and the build's faction pass:
//
//   the model: the type is the identifier's, the ordinal is appended, a
//     shipped type and a duplicate are refused, a hero of the type holds the
//     faction in place, the ones after a removal move down;
//   the build: every registry a twelfth type has to be in has ours in it —
//     types.xml's two enums and three table sizes, TownTypesInfo, the
//     generator's table, the music, the picker's two lists and their texts,
//     the random-town group, the hero pool, TownSpecs, UIGameRoot's grid,
//     the global script's doFile — and two factions do not fight over any of
//     them;
//   the install's rows: the picker's order, the buttons, the features.
//
//   node tools/test-faction-mod.ts [dataRoot]

// needs: data
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MOD_MANIFEST, dataReader, TYPES, UI_ROOT } from '../src/mods/mod-files.ts';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addFaction, newCreatureMod, removeFaction, updateFaction } from '../src/mods/mod-model.ts';
import type { CreatureMod } from '../src/mods/mod-model.ts';
import { GRID, SHIPPED_TOWN_TYPES, factionProblems, raceFor, townTypeFor } from '../src/mods/factions.ts';
import type { FactionSpec } from '../src/mods/factions.ts';
import { PICKER_DIR, PICKER_TEXTS, PICKER_TEXTURES, RMG_PRESETS, pickerNames } from '../src/mods/faction-files.ts';
import { TOWN_SPECS } from '../src/mods/town-files.ts';
import { RACE_MUSIC, TOWN_TYPES_INFO } from '../src/mods/town-type-info.ts';
import { HERO_GROUP, TOWN_GROUP, groupMembers } from '../src/mods/shared-groups.ts';
import { COMMON_SCRIPT } from '../src/mods/artifact-scripts.ts';
import { factionScriptPath } from '../src/mods/town-button.ts';
import { BONE_ON_PLUM } from '../src/mods/faction-icons.ts';
import { dataDir } from './game-dir.ts';
import type { BuildReport } from '../src/mods/mod-files.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function throws(name: string, f: () => unknown, mentions: string): void {
  try { f(); check(name, false, 'did not throw'); } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mentions), msg);
  }
}
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);

const spec = (file: string, extra: Partial<FactionSpec> = {}): FactionSpec => ({
  file, type: townTypeFor(file), donor: 'TOWN_HEAVEN', name: `${file}burg`,
  race: { name: `The ${file}` },
  towns: [{ file: 'First', name: 'First Town', biography: 'The first.', bonus: 'TOWN_NO_BONUS' }],
  ...extra,
});

console.log('the model');
{
  check('the type is the identifier\'s', townTypeFor('BoneCourt') === 'TOWN_BONE_COURT' && townTypeFor('Test') === 'TOWN_TEST');
  check('the race is the type\'s, but the dwarves', raceFor('TOWN_TEST') === 'RACE_TEST' && raceFor('TOWN_FORTRESS') === 'RACE_DWARF');
  check('a blank faction names what it lacks', factionProblems({ ...spec('X'), name: '', towns: [] }).length === 2);
  const mod = newCreatureMod();
  const a = addFaction(mod, spec('Alpha'));
  const b = addFaction(mod, spec('Beta'));
  check('ordinals append after the shipped eleven', a.number === SHIPPED_TOWN_TYPES && b.number === SHIPPED_TOWN_TYPES + 1);
  throws('a shipped type is refused', () => addFaction(mod, spec('Heaven'), new Set(['TOWN_HEAVEN'])), 'game\'s own');
  throws('a duplicate is refused', () => addFaction(mod, spec('Alpha')), 'already in the mod');
  throws('a wrong type is refused', () => addFaction(mod, { ...spec('Gamma'), type: 'TOWN_OTHER' }), 'TOWN_GAMMA');
  throws('a rename is refused', () => updateFaction(mod, 'Alpha', spec('Alpha2')), 'renamed');
  const changed = updateFaction(mod, 'Alpha', spec('Alpha', { name: 'Alphaville' }));
  check('an update keeps the ordinal', changed.number === SHIPPED_TOWN_TYPES && mod.factions![0]!.name === 'Alphaville');
  mod.heroes = [{ id: 'H', name: 'H', biography: '', town: 'TOWN_BETA', heroClass: 'HERO_CLASS_KNIGHT' } as never];
  throws('a hero of the type holds it', () => removeFaction(mod, 'Beta'), 'town of H');
  mod.heroes = [];
  removeFaction(mod, 'Alpha');
  check('the ones after a removal move down', mod.factions!.length === 1 && mod.factions![0]!.number === SHIPPED_TOWN_TYPES);
  check('the grid is five by six', GRID.columns === 5 && GRID.rows === 6);
}

console.log('the build, one faction');
let one: BuildReport;
{
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('Test', {
    icons: BONE_ON_PLUM,
    magic: 'none',
    race: { name: 'Bone Court', siloIncome: { Gem: 1 }, music: 'TOWN_NECROMANCY' },
    buildings: {
      'TB_SHIPYARD': null,
      'TB_SPECIAL_1': { name: 'Bone Pit', cost: { Gold: 2000 }, devLevel: 3, slot: { x: 5, y: 5 }, button: { lua: 'BonePit' } },
      'TB_DWELLING_5': { requires: ['TB_FORT/2'] },
    },
    script: 'function BonePit(town) end;',
    towns: [
      { file: 'Ossuary', name: 'Ossuary', biography: 'Bones.', bonus: 'TOWN_NO_BONUS' },
      { file: 'Charnel', name: 'Charnel', biography: 'More bones.', bonus: 'TOWN_NO_BONUS' },
    ],
  }));
  one = buildCreatureMod(mod, read);
  const text = (path: string): string => {
    const f = one.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path} in the build`);
    return f.data.toString('latin1');
  };
  const has = (path: string): boolean => one.files.some((x) => x.path === path);
  const types = text(TYPES);
  check('types.xml: the type in both shapes', types.includes('<Item>TOWN_TEST</Item>') && /<Name>TOWN_TEST<\/Name>\s*<Value>11<\/Value>/.test(types));
  check('types.xml: the race in both shapes', types.includes('<Item>RACE_TEST</Item>') && /<Name>RACE_TEST<\/Name>\s*<Value>11<\/Value>/.test(types));
  check('types.xml: __RACE_COUNT is 12', /<Name>__RACE_COUNT<\/Name>\s*<Value>12<\/Value>/.test(types));
  const size = (table: string): string | undefined => new RegExp(`<TypeName>${table}</TypeName>[\\s\\S]*?<Data>(\\d+)</Data>`).exec(types)?.[1];
  check('types.xml: the town table holds 12', size('Table_TownTypeInfo_TownType') === '12', size('Table_TownTypeInfo_TownType'));
  check('types.xml: the RMG table holds 13', size('Table_RMGPreset_Race') === '13', size('Table_RMGPreset_Race'));
  check('types.xml: the town specs hold 257', size('Table_TownSpecRef_TownSpec') === '257', size('Table_TownSpecRef_TownSpec'));
  check('types.xml: the named towns', types.includes('<Item>TOWNSPEC_TEST_RANDOM_OSSUARY</Item>') && /<Name>TOWNSPEC_TEST_RANDOM_CHARNEL<\/Name>\s*<Value>256<\/Value>/.test(types));
  check('TownTypesInfo: twelve records, ours last', count(text(TOWN_TYPES_INFO), /<ID>/g) === 12 && text(TOWN_TYPES_INFO).includes('<ID>TOWN_TEST</ID>'));
  check('RMGPresetTable: thirteen rows, ours before the count', count(text(RMG_PRESETS), /<ID>/g) === 13 && text(RMG_PRESETS).indexOf('<ID>RACE_TEST</ID>') < text(RMG_PRESETS).indexOf('<ID>__RACE_COUNT</ID>'));
  check('music: a row for the type', text(RACE_MUSIC).includes('<race>TOWN_TEST</race>'));
  const names = pickerNames({ file: 'Test' });
  check('the picker: a tile and two texts', text(PICKER_TEXTURES).includes(`<TextureName>${names.texture}</TextureName>`)
    && text(PICKER_TEXTS).includes(`<TextName>${names.tooltip}</TextName>`) && has(`${PICKER_DIR}/${names.texture}.txt`));
  check('the random-town group seats the town', groupMembers(text(TOWN_GROUP)).some((m) => m.includes('/Factions/Test/Test.(AdvMapTownShared).xdb')));
  check('TownSpecs: two named towns', count(text(TOWN_SPECS), /<ID>TOWNSPEC_TEST_RANDOM_/g) === 2);
  check('UIGameRoot: town_buildings_8', text(UI_ROOT).includes('<ID>town_buildings_8</ID>'));
  check('the script is loaded on every map', has(factionScriptPath('Test')) && text(COMMON_SCRIPT).includes(`doFile("/${factionScriptPath('Test')}");`));
  check('the town files are the faction\'s', has('Factions/Test/Test.(AdvMapTownShared).xdb') && has('Factions/Test/race.txt'));
  check('the rows: the picker, nine wide, ours last', one.factions?.picker.length === 9 && one.factions.picker[8]!.name === 'TOWN_TEST' && one.factions.picker[8]!.town === 11);
  check('the rows: the button', one.factions?.buttons.length === 1 && one.factions.buttons[0]!.lua === 'BonePit' && one.factions.buttons[0]!.town === 11);
  check('the manifest carries the faction', text(MOD_MANIFEST).includes('"factions"'));
}

console.log('the build, two factions');
{
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('One'));
  addFaction(mod, spec('Two', { donor: 'TOWN_NECROMANCY', towns: [
    { file: 'A', name: 'A', biography: 'a', bonus: 'TOWN_NO_BONUS' },
    { file: 'B', name: 'B', biography: 'b', bonus: 'TOWN_NO_BONUS' },
  ] }));
  const two = buildCreatureMod(mod, read);
  const text = (path: string): string => {
    const f = two.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path} in the build`);
    return f.data.toString('latin1');
  };
  const types = text(TYPES);
  const size = (table: string): string | undefined => new RegExp(`<TypeName>${table}</TypeName>[\\s\\S]*?<Data>(\\d+)</Data>`).exec(types)?.[1];
  check('types.xml: 13 towns, 14 presets, 258 specs', size('Table_TownTypeInfo_TownType') === '13' && size('Table_RMGPreset_Race') === '14' && size('Table_TownSpecRef_TownSpec') === '258',
    `${size('Table_TownTypeInfo_TownType')} ${size('Table_RMGPreset_Race')} ${size('Table_TownSpecRef_TownSpec')}`);
  check('types.xml: the second\'s named towns number after the first\'s', /<Name>TOWNSPEC_TWO_RANDOM_B<\/Name>\s*<Value>257<\/Value>/.test(types));
  check('ONE types.xml, ONE UIGameRoot', two.files.filter((f) => f.path === TYPES).length === 1 && two.files.filter((f) => f.path === UI_ROOT).length === 1);
  check('UIGameRoot: both grids', text(UI_ROOT).includes('<ID>town_buildings_8</ID>') && text(UI_ROOT).includes('<ID>town_buildings_9</ID>'));
  check('TownTypesInfo: thirteen', count(text(TOWN_TYPES_INFO), /<ID>/g) === 13);
  check('the group seats both', groupMembers(text(TOWN_GROUP)).filter((m) => m.includes('/Factions/')).length === 2);
  check('the picker is ten wide', two.factions?.picker.length === 10);
  check('the second town is Necropolis\'s copy', two.files.some((f) => f.path.startsWith('Factions/Two/town/') && /Necro/i.test(f.path)));
  check('the hero pool is the shipped one without heroes of ours', groupMembers(text(HERO_GROUP)).length === groupMembers(read(HERO_GROUP)!.toString('latin1')).length);
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
