// Build the extension the game loads — native/homm5-editor.c into a 32-bit DLL.
//
//   node tools/build-native.ts [--out <dir>] [--log <files>]
//
// `--log` names the extension's own files that may write to the log, by their
// path under `native/`:
//
//   npm run build-native -- --log combat/spell-resolve,lua/battle
//   npm run build-native -- --list-log      # what there is to ask for
//   npm run build-native -- --log none      # a DLL that says nothing at all
//
// Everything not named is cut out by the preprocessor, so it costs the built
// DLL nothing. Two units speak without being asked — the load report and the
// crash report — because they are how anybody finds out the mod is there and
// what it did when it stopped. See the bottom of native/core/log.c.
//
// The compile itself lives in src/extension.ts (`buildExtension`), because the
// editor's first run does the same thing without a terminal to run this in —
// the same split as tools/unpack-data.ts over src/unpack.ts. What is left here
// is argument handling and the report.
//
// The compiler is Zig, a devDependency: it is a C compiler that arrives as a
// folder, needs no installer and no administrator, and cross-compiles to
// 32-bit Windows out of the box — which is what the game is. Nobody running the
// editor needs it; the DLL is built once and shipped, the same bytes for every
// install.

import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXTENSION_DLL, buildExtension, logUnits } from '../src/mods/extension.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--list-log')) {
  console.log('files of the extension that can be asked to log:\n');
  for (const { file } of logUnits(here)) console.log(`  ${file.replace(/\.c$/, '')}`);
  console.log('\nname them with --log, comma separated. --log none silences even the defaults.');
  process.exit(0);
}

// Commas or repeated flags, because both get typed. `--log a,b` and
// `--log a --log b` mean the same thing.
const logging = args
  .flatMap((arg, i) => (arg === '--log' ? (args[i + 1] ?? '').split(',') : []))
  .filter((s) => s.trim() !== '');

const dll = buildExtension(here, (s) => console.log(s), logging);

// `--out` is for a caller that wants the file somewhere else. The build itself
// always writes where the rest of the editor looks for it, so this is a copy
// rather than a different target.
const out = flag('out');
if (out) {
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  const copy = join(dir, EXTENSION_DLL);
  copyFileSync(dll, copy);
  console.log(`copied to ${copy}`);
}
