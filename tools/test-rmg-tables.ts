// The generator's tables, read out of the executable — `src/exe/rmg-tables.ts`.
//
//   node tools/test-rmg-tables.ts --game <dir>      (or HOMM5_GAME)
//   node tools/test-rmg-tables.ts --print           just look
//
// Every table is located by a landmark and decoded from the code that uses
// it; this holds the decoding to what the vanilla game carries. A patched
// executable would fail here and that is right: the numbers below are the
// shipped game's, and a build that says otherwise is a different game.

// needs: game
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readRmgExeTables } from '../src/exe/rmg-tables.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => JSON.stringify(a) === JSON.stringify(b);

const game = gameDirIfAny();
const exe = game ? join(game, 'bin', 'H5_Game_H5E.exe') : null;
if (!exe || !existsSync(exe)) {
  console.log('skipping — no game said (--game <dir> or HOMM5_GAME), or no unwrapped H5_Game_H5E.exe in it');
  process.exit(0);
}

const t = readRmgExeTables(exe);
if (process.argv.includes('--print')) {
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}

const doc = (href: string): string => href.replace(/#xpointer\(.*\)$/, '');
const object = (name: string, tag: string): string => `/MapObjects/${name}.(${tag}).xdb`;

console.log('\nthe string globals');
check('three shrines at 6, 10, 12', same(t.shrines.map((s) => [doc(s.href), s.cost]), [1, 2, 3].map((n) => [object(`Shrine_Of_Magic_${n}`, 'AdvMapShrineShared'), [6, 10, 12][n - 1]])),
  JSON.stringify(t.shrines));
check('nine treasures, Chest second', same(t.treasures.map(doc), ['Campfire', 'Chest', 'Crystal', 'Gems', 'Gold', 'Mercury', 'Ore', 'Sulfur', 'Wood'].map((n) => object(n, 'AdvMapTreasureShared'))),
  t.treasures.map(doc).join(' '));
check('seven mines with their piles', same(t.mines.map((m) => [doc(m.href), doc(m.pile)]), [
  ['Sawmill', 'Wood'], ['Ore_Pit', 'Ore'], ['Alchemist_Lab', 'Mercury'], ['Crystal_Cavern', 'Crystal'],
  ['Sulfur_Dune', 'Sulfur'], ['Gem_Pond', 'Gems'], ['Gold_Mine', 'Gold'],
].map(([m, p]) => [object(m!, 'AdvMapMineShared'), object(p!, 'AdvMapTreasureShared')])), JSON.stringify(t.mines));
check('the gold mine is type 6', t.goldMineType === 6, String(t.goldMineType));
check('the random town', doc(t.randomTown) === '/MapObjects/RandomTown.xdb', t.randomTown);
check('seven random dwellings', same(t.randomDwellings.map(doc), [1, 2, 3, 4, 5, 6, 7].map((n) => `/MapObjects/Random/RandomDwelling${n}.xdb`)),
  t.randomDwellings.join(' '));
check('the prison', doc(t.prison) === object('Prison', 'AdvMapPrisonShared'), t.prison);
check('the cartographer', doc(t.cartographer) === object('Cartographer', 'AdvMapCartographerShared'), t.cartographer);
check('the shipyard', doc(t.shipyard) === object('Shipyard', 'AdvMapShipyardShared'), t.shipyard);
check('the monolith and the two gates', [t.monolith, t.gateIn, t.gateOut].map(doc).join(' ')
  === ['Monolith_Two_Way', 'Subterranean_Gate_In', 'Subterranean_Gate_Out'].map((n) => object(n, 'AdvMapBuildingShared')).join(' '),
  [t.monolith, t.gateIn, t.gateOut].map(doc).join(' '));
check('the observatory and the den', [t.observatory, t.denOfThieves].map(doc).join(' ')
  === ['Redwood_Observatory', 'Den_Of_Thieves'].map((n) => object(n, 'AdvMapBuildingShared')).join(' '), [t.observatory, t.denOfThieves].map(doc).join(' '));
check('the army template group', doc(t.armyTemplateGroup)
  === '/RMG/CustomArmyTemplates/SimpleTemplates/AutoTemplates/TestTemplateGroup.(RMGSimpleCustomArmyTemplateGroup).xdb', t.armyTemplateGroup);
check('the seven block resources and the chest', same(t.blockResources.map(doc), ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gems', 'Gold'].map((n) => object(n, 'AdvMapTreasureShared'))) && doc(t.blockChest) === object('Chest', 'AdvMapTreasureShared'), `${t.blockResources.map(doc).join(' ')} / ${t.blockChest}`);
check('the birds', doc(t.birds) === '/MapObjects/_(AdvMapBirds)/Pigeons_Adv.xdb', t.birds);
check('the minimap icon list', doc(t.minimapIcons) === '/UI/AdventureScreen-FPP-2/MinimapTextures.(WindowRelatedTextures).xdb', t.minimapIcons);

console.log('\nthe ladders');
check('map sizes', same(t.mapSizes, [72, 96, 136, 176, 216, 256, 320]), t.mapSizes.join(' '));
check('size units', same(t.sizeUnits, [5, 10, 18, 31, 47, 66, 102]), t.sizeUnits.join(' '));
check('units to size', same(t.unitsToSize, [8, 15, 25, 40, 60, 90]), t.unitsToSize.join(' '));
check('sea depth by size, 3 past the table', same(t.waterDepth.table, [2, 3, 4, 5, 7, 8, 10]) && t.waterDepth.fallback === 3,
  `${t.waterDepth.table.join(' ')} / ${t.waterDepth.fallback}`);
check('density multipliers', same(t.densityMultipliers.map((m) => Math.round(m * 10) / 10), [0.2, 0.5, 1, 2, 4]), t.densityMultipliers.join(' '));

console.log('\nthe races');
check('the enum', same(Object.entries(t.raceEnum), [
  ['SPECIAL', 0], ['RANDOM_TYPE', 1], ['NO_TYPE', 2], ['HEAVEN', 3], ['PRESERVE', 4], ['ACADEMY', 5],
  ['DUNGEON', 6], ['NECROMANCY', 7], ['INFERNO', 8], ['DWARF', 9], ['STRONGHOLD', 10], ['__RACE_COUNT', 11],
]), JSON.stringify(t.raceEnum));
check('the surface draw list', same(t.surfaceRaces, [3, 4, 5, 9, 8, 7, 10]), t.surfaceRaces.join(' '));
check('Dungeon joins it on a one-floor map', t.surfaceRaceWhenOneFloor === 6, String(t.surfaceRaceWhenOneFloor));
check('the underground draw list', same(t.undergroundRaces, [6, 8, 9, 7]), t.undergroundRaces.join(' '));
check('the slot list', same(t.slotRaceList, [3, 8, 7, 4, 6, 5, 9, 10]), t.slotRaceList.join(' '));
check('the lake races', same(t.lakeRaces, [3, 4, 7, 8, 9, 10]), t.lakeRaces.join(' '));

console.log('\nthe predicates');
check('subterra lights Crystal', same(t.lightNames['subterra']!, ['Crystal']), t.lightNames['subterra']!.join(' '));
check('sub-inferno lights Crater, Lavacrack, Hellpikes', same(t.lightNames['subInferno']!, ['Crater', 'Lavacrack', 'Hellpikes']), t.lightNames['subInferno']!.join(' '));
check('dwarven lights Fakel, FireColumn', same(t.lightNames['dwarven']!, ['Fakel', 'FireColumn']), t.lightNames['dwarven']!.join(' '));
check('the unflaggable dwelling types', same(t.unflaggableDwellingTypes, [0x54, 0x5e, 0x5f]), t.unflaggableDwellingTypes.join(' '));
check('the unplaceable creatures', same(t.unplaceableCreatures, [0, 89, 114]), t.unplaceableCreatures.join(' '));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
