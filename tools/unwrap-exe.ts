// A readable executable, from the command line.
//
//   node tools/unwrap-exe.ts                 make bin/H5_Game_H5E.exe if it is missing
//   node tools/unwrap-exe.ts --game <dir>
//   node tools/unwrap-exe.ts --check         say what each executable is, write nothing
//
// A clean executable is copied; a Steam-wrapped one is unwrapped with Steamless,
// downloaded once into tools/vendor/steamless. An existing copy is left alone —
// it is probably already carrying a patched ceiling.
//
// See src/exe-unwrap.ts for why, and docs/ENGINE_INTERNALS.md for what a wrapped
// file looks like from the inside.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CLEAN_EXE, SHIPPED_EXE, STEAMLESS, classify, ensureCleanExe } from '../src/exe/exe-unwrap.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The install this editor sits in, when it sits in one. */
const game = flag('game') ?? resolve(import.meta.dirname, '..', '..');

if (args.includes('--check')) {
  for (const rel of [SHIPPED_EXE, CLEAN_EXE]) {
    const path = resolve(game, rel);
    if (!existsSync(path)) {
      console.log(`${rel}  — not there`);
      continue;
    }
    const kind = classify(readFileSync(path));
    console.log(`${rel}  ${kind === 'wrapped' ? 'wrapped in Steam\'s DRM' : 'clean, readable code'}`);
  }
  process.exit(0);
}

try {
  const r = await ensureCleanExe(game, {
    editorRoot: resolve(import.meta.dirname, '..'),
    log: (s) => console.log(s),
  });
  const said = {
    kept: 'already there, left alone (it may hold a patched ceiling)',
    copied: 'copied from the shipped executable, which needed no unwrapping',
    unwrapped: `unwrapped with Steamless ${STEAMLESS.version}`,
  }[r.action];
  console.log(`${CLEAN_EXE}  ${said}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
