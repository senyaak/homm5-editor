// Build the extension the game loads — native/homm5-editor.c into a 32-bit DLL.
//
//   node tools/build-native.ts [--out <dir>]
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

import { EXTENSION_DLL, buildExtension } from '../src/extension.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dll = buildExtension(here, (s) => console.log(s));

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
