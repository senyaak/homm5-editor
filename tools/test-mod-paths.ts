// Moving the mod search into a folder of ours.
//
// The proof that matters is the game reading our folder and ignoring the five it
// used to, and that cannot happen here. What can: that the six literals are found
// in the real executable, that writing them leaves a file the same length with
// nothing of the old names left in it, that it goes back byte for byte, and that
// a build without them is refused rather than half-written.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { LITERALS, MASKS, MOD_DIR, WRITES, findSites, modFile, patchModPaths, readModPaths } from '../src/game/mod-paths.ts';
import { MOD_MANIFEST, findCreatureMods, installCreatureMod, newCreatureMod } from '../src/mods/creature-mod.ts';
import { writeArchive } from '../src/format/pak.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- what the literals are ----------------------------------------------------

check('every replacement fits where the shipped one was',
  LITERALS.every((m) => m.ours.length <= m.shipped.length));
check('and they all live in the one folder',
  LITERALS.every((m) => m.ours.startsWith(`${MOD_DIR}/`)), MOD_DIR);
check('no two are the same',
  new Set(LITERALS.map((m) => m.ours)).size === LITERALS.length, 'or a file would be mounted twice');
// The generator's folder is appended by (begin, end) and copied with an
// allocation size that is an immediate, so a byte shorter is a path that ends at
// the folder. See src/mod-paths.ts.
check('a folder the game writes to keeps the length it had',
  WRITES.every((w) => w.ours.length === w.shipped.length),
  WRITES.map((w) => `${w.shipped} -> ${w.ours}`).join(', '));
check('every map of ours is a .h5m, the name the game gave it',
  MASKS[0]!.ours === `${MOD_DIR}/*.h5m` && modFile('.', 'map', 'x').endsWith('.h5m'));

// --- a file that holds them ---------------------------------------------------

/** The six, laid out as the executable lays them out: one after another. */
function fakeRdata(): Buffer {
  const parts = [Buffer.from('\0some other string\0', 'latin1')];
  for (const m of LITERALS) parts.push(Buffer.from(`${m.shipped}\0`, 'latin1'));
  parts.push(Buffer.from('and one after\0', 'latin1'));
  return Buffer.concat(parts);
}

{
  const shipped = fakeRdata();
  check('all six are found', findSites(shipped).length === LITERALS.length);
  check('and read as shipped', readModPaths(shipped).state === 'shipped');

  const ours = patchModPaths(shipped, 'ours');
  check('writing ours changes all six', ours.written === LITERALS.length);
  check('the file does not change length', ours.data.length === shipped.length);
  check('and it now reads as ours', readModPaths(ours.data).state === 'ours');
  // The tail matters: `H5E/*.h5c\0aigns/*.h5c` would still be a valid string, and
  // the leftovers would be there for anyone reading the file to puzzle over.
  check('nothing of the old names is left',
    !LITERALS.some((m) => ours.data.includes(Buffer.from(m.shipped.split('/')[0]!, 'latin1'))),
    'no Maps/, UserMODs/, UserCampaigns/, DuelPresets/');
  check('the string after them is untouched', ours.data.includes(Buffer.from('and one after\0', 'latin1')));

  const again = patchModPaths(ours.data, 'ours');
  check('a second run writes nothing', again.written === 0);

  const back = patchModPaths(ours.data, 'shipped');
  check('and it goes back byte for byte', back.data.equals(shipped), `${back.written} written`);
}

// A build missing one of the six is a build we do not know: all six or none.
{
  const partial = Buffer.concat([
    Buffer.from('\0', 'latin1'),
    ...LITERALS.slice(1).map((m) => Buffer.from(`${m.shipped}\0`, 'latin1')),
  ]);
  let said = '';
  try { patchModPaths(partial, 'ours'); } catch (e) { said = e instanceof Error ? e.message : String(e); }
  check('a build missing one of them is refused, and the message says which',
    said.includes('unknown build') && said.includes(LITERALS[0]!.shipped), said);
}

// Two of the same literal cannot be told apart, so neither is written.
{
  const twice = Buffer.concat([
    Buffer.from('\0', 'latin1'),
    ...LITERALS.map((m) => Buffer.from(`${m.shipped}\0`, 'latin1')),
    Buffer.from(`${LITERALS[0]!.shipped}\0`, 'latin1'),
  ]);
  check('one that occurs twice is not written',
    !findSites(twice).some((s) => s.literal === LITERALS[0]));
}

// --- and that everything that installs goes there ------------------------------
//
// The patch is only half of it: a build that reads `H5E/` and an editor that
// still writes into `UserMODs` is a mod that silently stops being installed.
// This is that half, headless — the window's own path through the same
// functions is e2e's business.

{
  const dir = mkdtempSync(join(tmpdir(), 'modpaths-'));
  try {
    const mod = newCreatureMod('test-mod');
    const archive = writeArchive([{ name: MOD_MANIFEST, data: Buffer.from(JSON.stringify(mod)) }]);
    // No creatures in it, so no ceiling has to agree and no executable is needed.
    const installed = installCreatureMod(dir, mod, archive);
    check('an installed mod lands in our folder',
      installed.archive === join(dir, MOD_DIR, 'test-mod.h5u'), installed.archive);
    check('...and nothing was put in UserMODs', !existsSync(join(dir, 'UserMODs')));
    check('...and the folder was made rather than assumed', existsSync(join(dir, MOD_DIR)));
    check('the editor finds it where it put it',
      findCreatureMods(dir).map((f) => f.path).join() === installed.archive);
    check('a map of ours is a .h5m beside it',
      modFile(dir, 'map', 'My Map') === join(dir, MOD_DIR, 'My Map.h5m'));
    check('and a campaign keeps its own extension',
      modFile(dir, 'campaign', 'My Campaign') === join(dir, MOD_DIR, 'My Campaign.h5c'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the real thing, read only ------------------------------------------------

const gameRoot = process.env.HOMM5_GAME ?? resolve(import.meta.dirname, '..', '..');
for (const rel of [join('bin', 'H5_Game.exe'), join('bin', 'H5_Game_H5E.exe')]) {
  const path = join(gameRoot, rel);
  if (!existsSync(path)) continue;
  const buf = readFileSync(path);
  const r = readModPaths(buf);
  // They are all in `.rdata`, which Steam's wrapper leaves in the clear, so even
  // the shipped executable answers this one.
  check(`${rel} holds all six`, r.missing.length === 0, `scanning ${r.state}`);
  if (r.state !== 'ours' && r.state !== 'shipped') continue;
  // Out of whatever state this file is in and back into it — a patched copy is
  // as good a starting point as a fresh one.
  const other = r.state === 'ours' ? 'shipped' : 'ours';
  const round = patchModPaths(patchModPaths(buf, other).data, r.state);
  check(`${rel} survives there and back`, round.data.equals(buf));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
