// Package build/ into a runnable Windows app — dist/homm5-editor-win32-x64/.
//
//   node tools/package-app.ts [--platform win32] [--arch x64]
//
// A folder rather than an installer: the editor is a tool you keep beside the
// game, and an installer would only add a place for it to be half-removed from.
// Copy the folder anywhere and run homm5-editor.exe.
//
// The build is unsigned. On another machine SmartScreen will warn about an
// unknown publisher — that is a code-signing certificate's job, not a packaging
// flag, and the warning is honest.

import { packager } from '@electron/packager';
import type { OfficialPlatform, SupportedArch } from '@electron/packager';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

const paths = await packager({
  dir: join(root, 'build'),
  out: join(root, 'dist'),
  // Whatever we are running on, unless told otherwise. Packager validates the
  // names itself and errors on anything it cannot build for, so the casts only
  // wave the strings past the compiler.
  platform: (value('--platform') || process.platform) as OfficialPlatform,
  arch: (value('--arch') || process.arch) as SupportedArch,
  appVersion: pkg.version,
  overwrite: true,
  // build/ is self-contained — everything is inside main.js and app.js — so
  // there is nothing to prune and no node_modules to walk.
  prune: false,
  asar: true,
});

for (const p of paths) console.log(`packaged ${p}`);
