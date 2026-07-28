// Build the extension the game loads — native/homm5-editor.c into a 32-bit DLL.
//
//   node tools/build-native.ts [--out <dir>]
//
// The compiler is Zig, a devDependency: it is a C compiler that arrives as a
// folder, needs no installer and no administrator, and cross-compiles to
// 32-bit Windows out of the box — which is what the game is. Nobody running the
// editor needs it; the DLL is built once and shipped, the same bytes for every
// install.
//
// The binary is called directly rather than through the package's `zig` shim:
// the shim concatenates its arguments into a shell command, and this repo lives
// under a path with spaces in it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const zig = join(here, 'node_modules', '@zigc', 'win32-x64', 'bin', 'zig.exe');
if (!existsSync(zig)) {
  console.error(`no compiler at ${zig}\n  run: npm install`);
  process.exit(1);
}

const source = join(here, 'native', 'homm5-editor.c');
const outDir = resolve(flag('out') ?? join(here, 'native', 'build'));
mkdirSync(outDir, { recursive: true });
const dll = join(outDir, 'homm5-editor.dll');

// `x86-windows-gnu` is the 32-bit target; the game is a PE32 and will not load
// anything else.
//
// The C runtime comes along, and that is Zig's call rather than ours: it serves
// the Windows headers as part of libc, so `-nostdlib` takes `windows.h` with
// it. What arrives is the UCRT, which every Windows 10 and 11 has — and the
// source calls none of it, so the import is a formality rather than a
// dependency the code relies on.
execFileSync(zig, [
  'cc', '-target', 'x86-windows-gnu',
  '-shared', '-Os', '-fno-stack-protector',
  '-o', dll, source,
], { stdio: 'inherit' });

console.log(`built ${dll} — ${statSync(dll).size} bytes`);
