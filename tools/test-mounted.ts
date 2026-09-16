// The install as the game mounts it — `src/game/mounted.ts`.
//
//   node tools/test-mounted.ts
//
// A made-up install: an `H5E/` with three archives, two of which carry the
// same path with different dates, one of which is dated at the ZIP epoch, and
// a file that is not one of the five masks; an unpacked data root under all of
// it. The rule under test is the executable's (docs/ARCHIVES.md): the newest
// member wins, an epoch-dated member is ignored, a file outside the masks is
// not read, and the data answers what no archive has.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeArchive } from '../src/format/pak.ts';
import { mountArchives, mountableArchives } from '../src/game/mounted.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const tmp = mkdtempSync(join(tmpdir(), 'homm5-mounted-'));
try {
  const game = join(tmp, 'game');
  const base = join(tmp, 'data');
  const cache = join(tmp, 'cache');
  mkdirSync(join(game, 'H5E'), { recursive: true });
  mkdirSync(join(base, 'RMG', 'Templates'), { recursive: true });
  writeFileSync(join(base, 'RMG', 'Templates', 'S1P2Z2M1.xdb'), 'shipped template');
  writeFileSync(join(base, 'RMG', 'Params.xdb'), 'shipped params');

  const member = (name: string, text: string) => ({ name, data: Buffer.from(text) });
  // Folder order says "a" before "z"; the DATE says z's copy is older.
  writeFileSync(join(game, 'H5E', 'a-mod.h5u'), writeArchive([
    member('RMG/Params.xdb', 'a params'),
    member('RMG/Templates/Extra.xdb', 'a extra'),
  ], { mtime: new Date(2026, 5, 2, 12, 0, 0) }));
  writeFileSync(join(game, 'H5E', 'z-map.h5m'), writeArchive([
    member('RMG/Params.xdb', 'z params'),
    member('Maps/Multiplayer/z/map.xdb', 'z map'),
  ], { mtime: new Date(2026, 5, 1, 12, 0, 0) }));
  // Dated at the epoch: mounted, correct, and without effect.
  writeFileSync(join(game, 'H5E', 'epoch.h5u'), writeArchive([
    member('RMG/Templates/S1P2Z2M1.xdb', 'epoch template'),
  ], { mtime: new Date(1980, 0, 1, 0, 0, 0) }));
  // Not one of the five masks: the folder tolerates it, the game never reads it.
  writeFileSync(join(game, 'H5E', 'notes.txt'), 'not an archive');

  console.log('\nwhat is mounted');
  const names = mountableArchives(game).map((p) => p.slice(p.lastIndexOf('\\') + 1).slice(p.lastIndexOf('/') + 1));
  check('the three archives and nothing else, in folder order', names.join(',') === 'a-mod.h5u,epoch.h5u,z-map.h5m', names.join(','));

  const chain = mountArchives(game, cache, base);

  console.log('\nwhich copy wins');
  check('the NEWEST member wins, not the first in the folder', chain.text('RMG/Params.xdb') === 'a params',
    chain.text('RMG/Params.xdb') ?? 'null');
  check('an archive adds a path the data lacks', chain.text('RMG/Templates/Extra.xdb') === 'a extra');
  check('a map archive is mounted for the whole game', chain.text('Maps/Multiplayer/z/map.xdb') === 'z map');
  check('an epoch-dated member is ignored — the data answers', chain.text('RMG/Templates/S1P2Z2M1.xdb') === 'shipped template',
    chain.text('RMG/Templates/S1P2Z2M1.xdb') ?? 'null');
  check('a path nobody has reads null', chain.text('RMG/Nothing.xdb') === null);
  check('paths compare without case, and a leading slash is fine', chain.text('/rmg/params.XDB') === 'a params');
  check('path() is a real file in the cache', chain.path('RMG/Params.xdb').startsWith(cache)
    && chain.bytes('RMG/Params.xdb')?.toString() === 'a params');
  check('path() falls back to the data for a path nobody has', chain.path('RMG/Nothing.xdb') === join(base, 'RMG/Nothing.xdb'));

  console.log('\nscanning');
  const dirs = chain.dirs('RMG/Templates');
  check('dirs() walks every root that has the folder, the data last', dirs.length === 3 && dirs[dirs.length - 1] === join(base, 'RMG/Templates'),
    dirs.join('|'));
  check('the base is the last root', chain.roots[chain.roots.length - 1] === base);

  console.log('\nno H5E at all');
  const bare = mountArchives(join(tmp, 'nowhere'), cache, base);
  check('a game folder without H5E is the data alone', bare.roots.length === 1 && bare.text('RMG/Params.xdb') === 'shipped params');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
