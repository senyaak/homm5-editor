// The races the generator knows — `src/rmg/races.ts`:
//
//   the enum comes from types.xml: the shipped eleven by name, the town of
//     each race by value (the dwarves' town is TOWN_FORTRESS), a mod's
//     twelfth in both once its copy is on the chain;
//   the slot list is the extension's file beside an executable that imports
//     the extension, the compiled eight beside one that does not, and the
//     compiled eight when there is no file.
//
//   node tools/test-rmg-races.ts [--game <dir>]

// needs: game
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATCHED_EXE, SHIPPED_EXE } from '../src/exe/creature-limit.ts';
import { imports } from '../src/exe/exe-import.ts';
import { RACES_FILE, racesFileText } from '../src/mods/race-order.ts';
import { raceByName, slotRaceList, townByRace } from '../src/rmg/races.ts';
import { RACE } from '../src/rmg/load-template.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => JSON.stringify(a) === JSON.stringify(b);

const game = gameDirIfAny();
const data = dataDir();
if (!game || !existsSync(join(game, PATCHED_EXE)) || !existsSync(join(data, 'types.xml'))) {
  console.log('skipping — no game said (--game <dir> or HOMM5_GAME), no unwrapped H5_Game_H5E.exe, or no unpacked data');
  process.exit(0);
}

console.log('the enum, out of the data');
{
  const races = raceByName(data);
  check('the shipped eleven by name', races['RACE_SPECIAL'] === 0 && races['RACE_HEAVEN'] === RACE.HEAVEN && races['RACE_DWARF'] === RACE.DWARF && races['RACE_STRONGHOLD'] === RACE.STRONGHOLD);
  const towns = townByRace(data);
  check('the town of each race, by value', towns[RACE.HEAVEN] === 'TOWN_HEAVEN' && towns[RACE.DWARF] === 'TOWN_FORTRESS' && towns[RACE.STRONGHOLD] === 'TOWN_STRONGHOLD');
  check('the three service values have no town', towns[0] === undefined && towns[1] === undefined && towns[2] === undefined);
  // A mod's copy on the chain: the twelfth in both enums.
  const dir = join(import.meta.dirname, '..', '_tmp', 'rmg-races-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const types = readFileSync(join(data, 'types.xml'), 'latin1');
  // Into the named type's own entries — the last shipped name recurs in
  // other listings (the preset table's rows), and the first match is not
  // the enum's.
  const grow = (text: string, type: string, name: string, value: number): string => {
    const at = text.indexOf(`<TypeName>${type}</TypeName>`);
    const end = text.indexOf('</Entries>', at);
    if (at < 0 || end < 0) throw new Error(`types.xml: no ${type} entries`);
    return `${text.slice(0, end)}<Item><Name>${name}</Name><Value>${value}</Value></Item>${text.slice(end)}`;
  };
  const grown = grow(grow(types, 'Race', 'RACE_TEST', 11), 'TownType', 'TOWN_TEST', 11);
  check('the fixture grew both enums', grown !== types && (grown.match(/RACE_TEST|TOWN_TEST/g) ?? []).length === 2);
  writeFileSync(join(dir, 'types.xml'), grown, 'latin1');
  check("a mod's race is in the enum", raceByName(dir)['RACE_TEST'] === 11);
  check("and its town is the race's", townByRace(dir)[11] === 'TOWN_TEST');
  rmSync(dir, { recursive: true, force: true });
}

console.log('the slot list, out of the install');
{
  const dir = join(import.meta.dirname, '..', '_tmp', 'rmg-races-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const patched = join(dir, PATCHED_EXE);
  copyFileSync(join(game, PATCHED_EXE), patched);
  const withExtension = imports(readFileSync(patched)).includes('homm5-editor.dll');
  const compiled = [3, 8, 7, 4, 6, 5, 9, 10];
  const install = (exe: string) => ({ data, exe });
  check('no file beside it: the compiled eight', same(slotRaceList(install(patched)), compiled), slotRaceList(install(patched)).join(' '));
  if (withExtension) {
    writeFileSync(join(dir, RACES_FILE), racesFileText([
      ...compiled.map((town) => ({ name: `TOWN_${town}`, town })),
      { name: 'TOWN_TEST', town: 11, texture: 'race_test' },
    ]), 'latin1');
    const again = join(dir, 'bin', 'H5_Game_H5E_2.exe');
    copyFileSync(patched, again);
    check('the file beside an executable that imports the extension: nine, the file\'s order', same(slotRaceList(install(again)), [...compiled, 11]), slotRaceList(install(again)).join(' '));
    check('the list is read once per executable', slotRaceList(install(again)) === slotRaceList(install(again)));
  } else {
    console.log('  (the install\'s H5_Game_H5E.exe does not import the extension — the file half is not tried)');
  }
  if (existsSync(join(game, SHIPPED_EXE))) {
    const shipped = join(dir, 'bin', 'H5_Game_3.exe');
    copyFileSync(join(game, SHIPPED_EXE), shipped);
    writeFileSync(join(dir, RACES_FILE), racesFileText([{ name: 'TOWN_TEST', town: 11 }]), 'latin1');
    let list: readonly number[] | null = null;
    try { list = slotRaceList(install(shipped)); } catch { list = null; }
    check('the file beside the game\'s own executable is not its business', list === null || !list.includes(11), list ? list.join(' ') : 'the shipped executable is wrapped — not readable, as expected');
  }
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
