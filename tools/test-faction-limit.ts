// The executable's side of a faction: the four numbers move together, and
// back together.
//
// A throwaway install under _tmp with the install's UNWRAPPED executable
// (H5_Game_H5E.exe — the shipped one is Steam-wrapped and unreadable) copied
// in as its shipped one, so the real one is only read — and read it is: the
// clamp's signature has to occur exactly once in it, and the generator's
// registration has to be found. The copy may already carry a faction's
// numbers (the probe's, a mod's), so the first patch is measured from what it
// holds and the last puts the shipped numbers back outright.
//
//   node tools/test-faction-limit.ts [--game <dir>]

// needs: game
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE, SHIPPED_EXE } from '../src/exe/creature-limit.ts';
import { findClamp, setFactionLimits } from '../src/exe/faction-limit.ts';
import { TOWN_SPEC_TABLE, TOWN_TYPE_TABLE, findLoadSite, readTableLimit } from '../src/exe/table-limit.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const game = gameDirIfAny();
if (!game || !existsSync(join(game, PATCHED_EXE))) {
  console.log('no unwrapped executable (HOMM5_GAME, bin/H5_Game_H5E.exe) — nothing to patch a copy of');
  process.exit(0);
}

const real = readFileSync(join(game, PATCHED_EXE));
console.log("the install's executable, read");
{
  let at = -1;
  try { at = findClamp(real); } catch (e) { check('the clamp is found once', false, (e as Error).message); }
  if (at >= 0) check('the clamp compares against 7 or more', real[at]! >= 7, `0x${at.toString(16)} holds ${real[at]}`);
  const rmg = findLoadSite(real, { what: 'generator presets', path: '/GameMechanics/RefTables/RMGPresetTable.xdb', shipped: 12 });
  check('the generator registers 12 rows or more', !!rmg && (rmg.width === 1 ? real.readUInt8(rmg.at) : real.readUInt32LE(rmg.at)) >= 12);
}

const dir = join(import.meta.dirname, '..', '_tmp', 'faction-limit-test');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'bin'), { recursive: true });
copyFileSync(join(game, PATCHED_EXE), join(dir, SHIPPED_EXE));

const numbers = (): { towns: number | null; specs: number | null; presets: number; clamp: number } => {
  const buf = readFileSync(join(dir, PATCHED_EXE));
  const rmg = findLoadSite(buf, { what: 'generator presets', path: '/GameMechanics/RefTables/RMGPresetTable.xdb', shipped: 12 })!;
  return {
    towns: readTableLimit(buf, TOWN_TYPE_TABLE).limit,
    specs: readTableLimit(buf, TOWN_SPEC_TABLE).limit,
    presets: rmg.width === 1 ? buf.readUInt8(rmg.at) : buf.readUInt32LE(rmg.at),
    clamp: buf[findClamp(buf)]!,
  };
};

console.log('a copy, patched');
{
  check('nothing to do on an untouched install', setFactionLimits(dir, 0, 0) === null && !existsSync(join(dir, PATCHED_EXE)));
  const r = setFactionLimits(dir, 1, 2);
  const n = numbers();
  check('one faction, two named towns: 12 / 257 / 13 / 8', n.towns === 12 && n.specs === 257 && n.presets === 13 && n.clamp === 8, JSON.stringify(n));
  check('the result says where it went', !!r && r.presets.to === 13 && r.clamp.to === 8 && r.towns.to === 12 && r.specs.to === 257);
  setFactionLimits(dir, 2, 5);
  const m = numbers();
  check('two factions, five towns: 13 / 260 / 14 / 9', m.towns === 13 && m.specs === 260 && m.presets === 14 && m.clamp === 9, JSON.stringify(m));
  const back = setFactionLimits(dir, 0, 0);
  const z = numbers();
  check('none: the shipped numbers, in the patched copy', !!back && z.towns === 11 && z.specs === 255 && z.presets === 12 && z.clamp === 7, JSON.stringify(z));
}
rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
