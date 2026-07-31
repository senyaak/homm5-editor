// Put the extension where the game will load it.
//
//   node tools/install-native.ts [--game <dir>] [--uninstall]
//
// Two things: the DLL goes beside the executable, and OUR copy of the
// executable — `bin/H5_Game_H5E.exe`, never the game's own — gets our library
// added to its import table. So the game's files are untouched and the mod is
// turned off the way it always was, by launching `H5_Game.exe` instead.
//
// `--uninstall` removes the DLL. The import stays: an executable naming a
// library that is not there refuses to start, so removing the file alone would
// break the patched copy — rebuild it with `npm run unwrap-exe` after deleting
// it if that is what you want. Said here rather than discovered later.

import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { addImport, imports } from '../src/exe/exe-import.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const DLL = 'homm5-editor.dll';
const ENTRY = 'homm5_editor_present';

const game = resolve(flag('game') ?? process.env.HOMM5_GAME ?? join(here, '..'));
const exe = join(game, 'bin', 'H5_Game_H5E.exe');
const target = join(game, 'bin', DLL);

if (args.includes('--uninstall')) {
  rmSync(target, { force: true });
  console.log(`removed ${target}`);
  console.log('the import in H5_Game_H5E.exe is still there — it will not start without the file.');
  process.exit(0);
}

const built = join(here, 'native', 'build', DLL);
if (!existsSync(built)) {
  console.error(`no ${built}\n  run: npm run build-native`);
  process.exit(1);
}
if (!existsSync(exe)) {
  console.error(`no ${exe}\n  run: npm run unwrap-exe`);
  process.exit(1);
}

copyFileSync(built, target);
console.log(`copied ${DLL} — ${statSync(target).size} bytes`);

const before = readFileSync(exe);
const { buf, added, rva } = addImport(before, DLL, ENTRY);
if (!added) {
  console.log(`${exe} already imports ${DLL} — nothing to do`);
} else {
  writeFileSync(exe, buf);
  console.log(`patched ${exe}: import added in a new section at 0x${(rva ?? 0).toString(16)}`);
}
console.log(`  now imports ${imports(readFileSync(exe)).length} libraries`);
console.log('\nLaunch H5_Game_H5E.exe. bin/homm5-editor.log says whether it loaded.');
