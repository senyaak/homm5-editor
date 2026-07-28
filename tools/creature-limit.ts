// The creature ceiling from the command line.
//
//   node tools/creature-limit.ts                        what the install is at
//   node tools/creature-limit.ts --set 181              put it there
//   node tools/creature-limit.ts --game <dir> --set 181
//   node tools/creature-limit.ts inspect <exe>          read any one executable
//
// The ceiling has to equal a units mod's creature count exactly, so this is not
// usually run by hand: `units-mod build --install` sets it as part of installing,
// which is the whole point — the number and the mod cannot drift apart if one
// action writes both. This exists for looking, and for fixing by hand.
//
// See src/creature-limit.ts for what is patched and why, docs/NEW_CREATURES.md in
// the port for the evidence behind each offset.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUILDS, ORIGINAL_LIMIT, PATCHED_EXE, SHIPPED_EXE, readExe, setCreatureLimit, showBytes,
} from '../src/creature-limit.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));

/** The install this editor sits in, when it sits in one. */
const defaultGame = resolve(import.meta.dirname, '..', '..');

if (positional[0] === 'inspect') {
  const path = positional[1];
  if (!path) {
    console.error('usage: creature-limit.ts inspect <exe>');
    process.exit(2);
  }
  const buf = readFileSync(resolve(path));
  const r = readExe(buf);
  console.log(`${path}  ${r.size} bytes`);
  if (r.build) console.log(`  ${r.build.name}`);
  if (r.limit !== null) {
    console.log(`  creature ceiling ${r.limit}${r.limit === ORIGINAL_LIMIT ? ' (as shipped)' : ''}`);
    if (r.build?.code.length) console.log(`  generator stub ${r.stubbed ? 'in place' : 'not applied'}`);
  }
  for (const p of r.problems) console.log(`  ${p}`);
  if (!r.build) {
    console.log('  known builds:');
    for (const b of BUILDS) console.log(`    ${showBytes(b.check.bytes)}  ${b.name}`);
  }
  process.exit(r.problems.length ? 1 : 0);
}

const game = flag('game') ?? defaultGame;
const set = flag('set');

if (!set) {
  // What the install is at — both files, since which one is launched is the
  // difference between the mod being on and off.
  for (const rel of [SHIPPED_EXE, PATCHED_EXE]) {
    const path = resolve(game, rel);
    if (!existsSync(path)) {
      console.log(`${rel}  — not there`);
      continue;
    }
    const r = readExe(readFileSync(path));
    const what = r.limit !== null ? `ceiling ${r.limit}` : (r.problems[0] ?? 'unreadable');
    console.log(`${rel}  ${r.build?.name ?? '?'}  ${what}`);
  }
  console.log('\npass --set <n> to put the ceiling there (writes only the _H5E copy)');
  process.exit(0);
}

const limit = Number(set);
try {
  const r = setCreatureLimit(game, limit);
  const how = r.created ? 'created from the shipped executable and patched'
    : r.changed ? `patched ${r.from} → ${r.to}` : `already at ${r.to}`;
  console.log(`${r.path}\n  ${r.build}\n  ${how}`);
  console.log(`\nids ${ORIGINAL_LIMIT}..${r.to - 1} must all exist in the ref table — that is what the mod writes`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
