// The race's record in TownTypesInfo — `src/mods/town-type-info.ts`:
//
//   the donor's record copied under our type, at the end of the table;
//   its texts ours: the race's name, the three walls' names out of the copy;
//   its overview icons drawn, its neutral creature the tier-2 base, the silo,
//     the machine and the moat from the spec, the rest the donor's;
//   a table already carrying the type is refused.
//
//   node tools/test-town-type-info.ts [dataRoot]

// needs: data
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataReader } from '../src/mods/mod-files.ts';
import { buildTown } from '../src/mods/town-files.ts';
import type { TownSpec } from '../src/mods/town-files.ts';
import { RACE_MUSIC, TOWN_TYPES_INFO, patchRaceMusic, patchTownTypesInfo, raceFiles, recordAround } from '../src/mods/town-type-info.ts';
import { BONE_ON_PLUM } from '../src/mods/faction-icons.ts';
import { dataDir } from './game-dir.ts';

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

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);
const spec: TownSpec = {
  file: 'Test', type: 'TOWN_TEST', donor: 'TOWN_HEAVEN', name: 'Testburg', icons: BONE_ON_PLUM,
  dwellings: { 2: { base: 'CREATURE_TEST_WALKING_DEAD', upgrade: 'CREATURE_TEST_ZOMBIE' } },
  race: {
    name: 'Bone Court', siloIncome: { Crystal: 0, Gem: 1 }, warMachine: 'WAR_MACHINE_FIRST_AID_TENT',
    moat: { damage: 120, spells: [{ spell: 'SPELL_ABILITY_POISONOUS_ATTACK', chance: 100, mastery: 'MASTERY_ADVANCED', power: 20 }] },
  },
};

console.log('the race record');
{
  const build = buildTown(spec, 3, read);
  const race = raceFiles(spec, spec.race!, spec.icons);
  check('the name text and four icons', race.files.length === 1 + 8 && race.name === 'Factions/Test/race.txt' && race.kingdomIcons.length === 4);
  check('the name is UTF-16 with a BOM', race.files[0]!.data[0] === 0xff && race.files[0]!.data.subarray(2).toString('utf16le') === 'Bone Court');
  const shipped = read(TOWN_TYPES_INFO)!.toString('latin1');
  const table = patchTownTypesInfo(shipped, spec, build, race);
  check('twelve records, ours last', (table.match(/<ID>/g) ?? []).length === 12 && table.lastIndexOf('<ID>TOWN_TEST</ID>') > table.lastIndexOf('<ID>TOWN_STRONGHOLD</ID>'));
  const [s, e] = recordAround(table, 'TOWN_TEST');
  const rec = table.slice(s, e);
  check('the race name is ours', rec.includes('<textType href="/Factions/Test/race.txt"/>'));
  check("the walls' names are the copy's", rec.includes('<textFort href="/Factions/Test/town/Text/Game/TownBuildings/Haven/Fort/Fort_Name.txt"/>') && rec.includes('<textCaste href="/Factions/Test/town/Text/Game/TownBuildings/Haven/Fort/Castle_Name.txt"/>') && rec.includes('<textCitadel href="/Factions/Test/town/Text/Game/TownBuildings/Haven/Fort/Citadel_Name.txt"/>'));
  check('the overview icons are ours, four', (rec.match(/\/Factions\/Test\/icons\/kingdom_\d\.xdb/g) ?? []).length === 4 && !rec.includes('KingdomOverview'));
  check('the neutral creature is the tier-2 base', rec.includes('<NeutralCreature>CREATURE_TEST_WALKING_DEAD</NeutralCreature>'));
  check('the silo pays gems, not crystal', rec.includes('<Crystal>0</Crystal>') && rec.includes('<Gem>1</Gem>') && rec.includes('<Wood>0</Wood>'));
  check('the tent, the moat, the poison', rec.includes('<NativeWarMachine>WAR_MACHINE_FIRST_AID_TENT</NativeWarMachine>') && rec.includes('<MoatMaxDamage>120</MoatMaxDamage>') && rec.includes('<Spell>SPELL_ABILITY_POISONOUS_ATTACK</Spell>') && rec.includes('<SpellPower>20</SpellPower>'));
  check("the path arrows stay the donor's", rec.includes('/UI/HeroPlotitng/Heaven/TargetGreen.(Model).xdb'));
  const [hs, he] = recordAround(table, 'TOWN_HEAVEN');
  check("Heaven's own record untouched", table.slice(hs, he) === shipped.slice(...recordAround(shipped, 'TOWN_HEAVEN')));
  throws('the type already there', () => patchTownTypesInfo(table, spec, build, race), 'already has TOWN_TEST');
  const plain = patchTownTypesInfo(shipped, { ...spec, race: undefined, dwellings: undefined }, build, raceFiles(spec, { name: 'X' }, undefined));
  const prec = plain.slice(...recordAround(plain, 'TOWN_TEST'));
  check("without a race spec: the name still ours, the values the donor's", prec.includes('/Factions/Test/race.txt') && prec.includes('<NeutralCreature>CREATURE_ARCHER</NeutralCreature>') && prec.includes('KingdomOverview/TownsIcons/Haven_1'));
}

console.log('the music');
{
  const shipped = read(RACE_MUSIC)!.toString('latin1');
  const rows = (t: string): string[] => [...t.matchAll(/<race>(\w+)<\/race>/g)].map((m) => m[1]!);
  const necro = patchRaceMusic(shipped, { ...spec, race: { ...spec.race!, music: 'TOWN_NECROMANCY' } });
  check('a tenth row, ours, last', rows(necro).length === rows(shipped).length + 1 && rows(necro).at(-1) === 'TOWN_TEST');
  const ours = necro.slice(necro.lastIndexOf('<Item>'), necro.lastIndexOf('</Item>'));
  check("Necropolis's music under our type", ours.includes('<race>TOWN_TEST</race>') && ours.includes('Battle-Themes/Necropolis') && ours.includes('<SiegeMusic href="Seige-Battle/Necropolis'));
  check("the shipped rows untouched", necro.startsWith(shipped.slice(0, shipped.lastIndexOf('</Item>') + '</Item>'.length)));
  const donor = patchRaceMusic(shipped, spec);
  check("unsaid: the donor's", donor.slice(donor.lastIndexOf('<Item>')).includes('Battle-Themes/Haven.xdb'));
  throws('a row already there', () => patchRaceMusic(necro, spec), 'already has TOWN_TEST');
  throws('a race without music', () => patchRaceMusic(shipped, { ...spec, race: { ...spec.race!, music: 'TOWN_ATLANTIS' } }), 'no row for TOWN_ATLANTIS');
}

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
