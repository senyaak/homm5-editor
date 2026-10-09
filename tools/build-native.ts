// Build the extension the game loads — native/homm5-editor.c into a 32-bit DLL.
//
//   node tools/build-native.ts [--out <dir>] [--dev] [--log <files>]
//
// LOGS ARE FOR DEVELOPMENT ONLY. A plain build writes no log at all — no file,
// no line, no crash report — and that is what a game gets.
//
//   npm run build-native                    # the ordinary build: silent
//   npm run build-native -- --dev           # the load and crash reports, the agent
//   npm run build-native -- --log combat/spell-resolve,lua/battle
//                                           # --dev, and those files speaking too
//   npm run build-native -- --list-log      # what there is to ask for
//
// Everything not named is cut out by the preprocessor, so it costs the built
// DLL nothing. See the bottom of native/core/log.c.
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

import {
  EXTENSION_DLL, LOG_UNITS_DEV, buildExtension, logUnits,
} from '../src/mods/extension.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// What there is to ask for, and what each one is about — both read out of the
// sources at the moment it is asked. Deliberately printed rather than written
// into a document: a list in a file is a list somebody has to notice has gone
// stale, and this one cannot, because it does not exist between runs.
if (args.includes('--list-log')) {
  const units = logUnits(here);
  const width = Math.max(...units.map((u) => u.file.length)) - 1;
  console.log('files of the extension that can be asked to log:\n');
  for (const { file, about } of units) {
    console.log(`  ${file.replace(/\.c$/, '').padEnd(width)}  ${about}`);
  }
  console.log('\nname them with --log, comma separated:');
  console.log('  npm run build-native -- --log combat/spell-resolve,lua/battle');
  console.log('\nany of them makes a development build, as --dev does, in which these speak too:');
  console.log(`  ${LOG_UNITS_DEV.join(', ')} — the load report, the crash report, the agent.`);
  console.log('without either, the build writes no log at all.');
  process.exit(0);
}

// Commas or repeated flags, because both get typed. `--log a,b` and
// `--log a --log b` mean the same thing.
const logging = [
  ...(args.includes('--dev') ? ['dev'] : []),
  ...args.flatMap((arg, i) => (arg === '--log' ? (args[i + 1] ?? '').split(',') : [])),
].filter((s) => s.trim() !== '');

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
