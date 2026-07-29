// Where the game keeps its mods, from the command line.
//
//   node tools/mod-paths.ts                 what each executable reads and writes
//   node tools/mod-paths.ts --set ours      H5E/ only               (our copy)
//   node tools/mod-paths.ts --set shipped   the folders as shipped
//   node tools/mod-paths.ts --game <dir>
//
// Only our copy is ever written; the shipped executable is read so the two can be
// seen side by side, which is the whole point — launching it is how the change is
// turned off. See src/mod-paths.ts for what is patched and why.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PATCHED_EXE, SHIPPED_EXE } from '../src/creature-limit.ts';
import { LITERALS, MOD_DIR, MOD_EXT, readModPaths, setModPaths } from '../src/mod-paths.ts';

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
    console.log(`${rel}  using: ${r.state}`);
    for (const s of r.sites) {
      const text = s.holds === 'ours' ? s.literal.ours : s.literal.shipped;
      console.log(`    ${text.padEnd(20)} ${s.literal.what}`);
    }
    for (const m of r.missing) console.log(`    ${m.shipped} — not found`);
  }
  console.log(`\npass --set ours to use only ${MOD_DIR}/, or --set shipped to use the game's own folders again`);
  console.log(`(${LITERALS.map((m) => m.ours).join('  ')})`);
  process.exit(0);
}

if (set !== 'ours' && set !== 'shipped') {
  console.error('usage: mod-paths.ts --set ours|shipped');
  process.exit(2);
}

try {
  const r = setModPaths(game, set);
  console.log(`${r.path}\n  ${r.changed ? 'now using' : 'already using'} ${r.state === 'ours' ? `${MOD_DIR}/ only` : "the game's own folders"}`);
  if (r.state === 'ours') console.log(`  maps live in ${r.dir} as *.${MOD_EXT.map} — the generator writes them there too`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
