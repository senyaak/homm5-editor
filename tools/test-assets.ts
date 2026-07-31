// Validates the asset chain — which copy of a path the editor reads.
//
// The game reads a path out of the last archive that carries it, so the editor
// layers the mounted mods over the unpacked data and resolves through the chain.
// Getting this wrong is not a crash: it is a creature that quietly does not
// exist, an object dropped from the scene, and a picker offering 180 of 181.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assets, baseRoot, singleRoot, toAssets } from '../src/game/assets.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const tmp = mkdtempSync(join(tmpdir(), 'homm5-assets-'));
try {
  // Two roots: a base holding the shipped copies, and a mod over it.
  const base = join(tmp, 'data');
  const mod = join(tmp, 'mod');
  mkdirSync(join(base, 'GameMechanics'), { recursive: true });
  mkdirSync(join(base, 'MapObjects', 'Preserve'), { recursive: true });
  mkdirSync(join(mod, 'GameMechanics'), { recursive: true });
  mkdirSync(join(mod, 'Units'), { recursive: true });
  writeFileSync(join(base, 'GameMechanics', 'Creatures.xdb'), 'shipped');
  writeFileSync(join(base, 'MapObjects', 'Preserve', 'Elf.xdb'), 'elf');
  writeFileSync(join(mod, 'GameMechanics', 'Creatures.xdb'), 'modded');
  writeFileSync(join(mod, 'Units', 'Sniper.xdb'), 'sniper');

  const chain = assets([mod, base]);

  console.log('\nresolving');
  check('the mod wins a path both roots have', chain.text('GameMechanics/Creatures.xdb') === 'modded');
  check('the base answers a path only it has', chain.text('MapObjects/Preserve/Elf.xdb') === 'elf');
  check('the mod answers a path only it has', chain.text('Units/Sniper.xdb') === 'sniper');
  check('a path nobody has reads null', chain.text('Units/Nothing.xdb') === null);
  check('exists() agrees', chain.exists('Units/Sniper.xdb') && !chain.exists('Units/Nothing.xdb'));
  check('bytes() reads the same copy', chain.bytes('GameMechanics/Creatures.xdb')?.toString() === 'modded');

  // path() answering for a file nobody has is deliberate: the callers that check
  // existsSync themselves still want to report the path a reader would have used.
  check('path() falls back to the base root', chain.path('Units/Nothing.xdb') === join(base, 'Units/Nothing.xdb'));
  check('path() points at the winning copy', chain.path('GameMechanics/Creatures.xdb') === join(mod, 'GameMechanics/Creatures.xdb'));
  check('baseRoot() is the last root', baseRoot(chain) === base);

  console.log('\nscanning');
  // A folder scan cannot pick one root: a mod adding an object does not replace
  // the shipped folder. So both are walked and the caller dedupes.
  check('dirs() lists every root that has the folder, most specific first',
    chain.dirs('GameMechanics').join('|') === [join(mod, 'GameMechanics'), join(base, 'GameMechanics')].join('|'));
  check('dirs() skips roots without it', chain.dirs('MapObjects').join('|') === join(base, 'MapObjects'));
  check('dirs() skips a FILE of that name', chain.dirs('Units/Sniper.xdb').length === 0);
  check('all() lists existing candidates', chain.all('GameMechanics/Creatures.xdb').length === 2
    && chain.all('Units/Sniper.xdb').length === 1);

  console.log('\none root, and taking either');
  const only = singleRoot(base);
  check('a chain of one reads the base', only.text('GameMechanics/Creatures.xdb') === 'shipped');
  check('and does not see the mod', only.text('Units/Sniper.xdb') === null);
  check('toAssets takes a directory string', toAssets(base).text('MapObjects/Preserve/Elf.xdb') === 'elf');
  check('toAssets passes a chain through', toAssets(chain) === chain);
  check('an empty chain is refused', (() => {
    try {
      assets([]);
      return false;
    } catch {
      return true;
    }
  })());
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
