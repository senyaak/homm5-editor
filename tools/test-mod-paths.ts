// Moving the mod search into a folder of ours.
//
// The proof that matters is the game reading a `.mod` and ignoring a `.h5m`, and
// that cannot happen here. What can: that the five patterns are found in the real
// executable, that writing them leaves a file the same length with nothing of the
// old names left in it, that it goes back byte for byte, and that a build without
// them is refused rather than half-written.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MASKS, MOD_DIR, findMaskSites, patchModPaths, readModPaths } from '../src/mod-paths.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- what the patterns are ----------------------------------------------------

check('every replacement fits where the shipped one was',
  MASKS.every((m) => m.ours.length <= m.shipped.length));
check('and they all live in the one folder',
  MASKS.every((m) => m.ours.startsWith(`${MOD_DIR}/`)), MOD_DIR);
check('no two patterns are the same',
  new Set(MASKS.map((m) => m.ours)).size === MASKS.length, 'or a file would be mounted twice');

// --- a file that holds them ---------------------------------------------------

/** The five, laid out as the executable lays them out: one after another. */
function fakeRdata(): Buffer {
  const parts = [Buffer.from('\0some other string\0', 'latin1')];
  for (const m of MASKS) parts.push(Buffer.from(`${m.shipped}\0`, 'latin1'));
  parts.push(Buffer.from('and one after\0', 'latin1'));
  return Buffer.concat(parts);
}

{
  const shipped = fakeRdata();
  check('all five are found', findMaskSites(shipped).length === MASKS.length);
  check('and read as shipped', readModPaths(shipped).state === 'shipped');

  const ours = patchModPaths(shipped, 'ours');
  check('writing ours changes all five', ours.written === MASKS.length);
  check('the file does not change length', ours.data.length === shipped.length);
  check('and it now reads as ours', readModPaths(ours.data).state === 'ours');
  // The tail matters: `H5E/*.h5c\0aigns/*.h5c` would still be a valid string, and
  // the leftovers would be there for anyone reading the file to puzzle over.
  check('nothing of the old names is left',
    !MASKS.some((m) => ours.data.includes(Buffer.from(m.shipped.split('/')[0]!, 'latin1'))),
    'no Maps/, UserMODs/, UserCampaigns/, DuelPresets/');
  check('the string after them is untouched', ours.data.includes(Buffer.from('and one after\0', 'latin1')));

  const again = patchModPaths(ours.data, 'ours');
  check('a second run writes nothing', again.written === 0);

  const back = patchModPaths(ours.data, 'shipped');
  check('and it goes back byte for byte', back.data.equals(shipped), `${back.written} written`);
}

// A build missing one of the five is a build we do not know: all five or none.
{
  const partial = Buffer.concat([
    Buffer.from('\0', 'latin1'),
    ...MASKS.slice(1).map((m) => Buffer.from(`${m.shipped}\0`, 'latin1')),
  ]);
  let said = '';
  try { patchModPaths(partial, 'ours'); } catch (e) { said = e instanceof Error ? e.message : String(e); }
  check('a build missing one pattern is refused, and the message says which',
    said.includes('unknown build') && said.includes(MASKS[0]!.shipped), said);
}

// Two of the same pattern cannot be told apart, so neither is written.
{
  const twice = Buffer.concat([
    Buffer.from('\0', 'latin1'),
    ...MASKS.map((m) => Buffer.from(`${m.shipped}\0`, 'latin1')),
    Buffer.from(`${MASKS[0]!.shipped}\0`, 'latin1'),
  ]);
  check('a pattern that occurs twice is not written',
    !findMaskSites(twice).some((s) => s.mask === MASKS[0]));
}

// --- the real thing, read only ------------------------------------------------

const gameRoot = process.env.HOMM5_GAME ?? resolve(import.meta.dirname, '..', '..');
for (const rel of [join('bin', 'H5_Game.exe'), join('bin', 'H5_Game_H5E.exe')]) {
  const path = join(gameRoot, rel);
  if (!existsSync(path)) continue;
  const buf = readFileSync(path);
  const r = readModPaths(buf);
  // The patterns are in `.rdata`, which Steam's wrapper leaves in the clear, so
  // even the shipped executable answers this one.
  check(`${rel} holds all five`, r.missing.length === 0, `scanning ${r.state}`);
  if (r.state !== 'ours' && r.state !== 'shipped') continue;
  // Out of whatever state this file is in and back into it — a patched copy is
  // as good a starting point as a fresh one.
  const other = r.state === 'ours' ? 'shipped' : 'ours';
  const round = patchModPaths(patchModPaths(buf, other).data, r.state);
  check(`${rel} survives there and back`, round.data.equals(buf));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
