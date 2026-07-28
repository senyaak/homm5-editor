// Where the game looks for mods, from the command line.
//
//   node tools/mod-paths.ts                 what each executable scans
//   node tools/mod-paths.ts --set ours      scan H5E/ only          (our copy)
//   node tools/mod-paths.ts --set shipped   scan the five as shipped
//   node tools/mod-paths.ts --game <dir>
//
// Only our copy is ever written; the shipped executable is read so the two can be
// seen side by side, which is the whole point — launching it is how the change is
// turned off. See src/mod-paths.ts for what is patched and why.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PATCHED_EXE, SHIPPED_EXE } from '../src/creature-limit.ts';
import { MASKS, MOD_DIR, readModPaths, setModPaths } from '../src/mod-paths.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The install this editor sits in, when it sits in one. */
const game = flag('game') ?? resolve(import.meta.dirname, '..', '..');
const set = flag('set');

if (!set) {
  for (const rel of [SHIPPED_EXE, PATCHED_EXE]) {
    const path = resolve(game, rel);
    if (!existsSync(path)) {
      console.log(`${rel}  — not there`);
      continue;
    }
    const r = readModPaths(readFileSync(path));
    console.log(`${rel}  scanning: ${r.state}`);
    for (const s of r.sites) {
      const text = s.holds === 'ours' ? s.mask.ours : s.mask.shipped;
      console.log(`    ${text.padEnd(20)} ${s.mask.what}`);
    }
    for (const m of r.missing) console.log(`    ${m.shipped} — not found`);
  }
  console.log(`\npass --set ours to read only ${MOD_DIR}/, or --set shipped to read the five again`);
  console.log(`(${MASKS.map((m) => m.ours).join('  ')})`);
  process.exit(0);
}

if (set !== 'ours' && set !== 'shipped') {
  console.error('usage: mod-paths.ts --set ours|shipped');
  process.exit(2);
}

try {
  const r = setModPaths(game, set);
  console.log(`${r.path}\n  ${r.changed ? 'now scanning' : 'already scanning'} ${r.state === 'ours' ? `${MOD_DIR}/ only` : 'the shipped five'}`);
  if (r.state === 'ours') console.log(`  put maps in ${r.dir} as *.mod`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
