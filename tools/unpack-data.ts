// Unpack the game's archives into one data root — the tree the editor reads.
//
//   node tools/unpack-data.ts [<game dir>] [--out <dir>] [--dry] [--force]
//
// The merge itself lives in src/unpack.ts, because the packaged editor's
// first-run setup does the same thing without a terminal to run this in. What
// is left here is argument handling and the report.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listPaks, unpackData } from '../src/game/unpack.ts';
import { dataDir as cacheDir, gameDirIfAny } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));

// The game is SAID — the positional argument, --game, or HOMM5_GAME — never
// guessed from the checkout's position (tools/game-dir.ts).
const said = positional[0] || gameDirIfAny();
if (!said) {
  console.error('where is the game? pass the game directory, --game <dir>, or set HOMM5_GAME');
  process.exit(2);
}
const gameDir = resolve(said);
const dataDir = join(gameDir, 'data');
const outDir = resolve(value('--out') || cacheDir());
const dry = flag('--dry');
const force = flag('--force');

if (!existsSync(dataDir)) {
  console.error(`no data folder at ${dataDir} — pass the game directory as the first argument`);
  process.exit(1);
}
const paks = listPaks(dataDir);
if (!paks.length) { console.error(`no .pak files in ${dataDir}`); process.exit(1); }

console.log(`from ${dataDir}`);
console.log(`into ${outDir}${dry ? '  (dry run — nothing will be written)' : ''}`);
console.log(`order: ${paks.join(' → ')}\n`);

// Enough to see something is wrong without scrolling a wall of it past.
let shown = 0;
const report = unpackData(gameDir, outDir, {
  dry,
  force,
  onError: (member, err) => {
    if (++shown <= 3) console.log(`  ! ${member}: ${err instanceof Error ? err.message : String(err)}`);
  },
});

for (const p of report.paks) {
  console.log(`${p.pak.padEnd(18)} ${String(p.members).padStart(6)} members · ${p.written} new, ${p.replaced} replaced, ${p.unchanged} unchanged${p.failed ? `, ${p.failed} FAILED` : ''}`);
}
console.log(`\ntotal: ${report.written} new, ${report.replaced} replaced, ${report.unchanged} already current${report.failed ? `, ${report.failed} failed` : ''}`);
process.exit(report.failed ? 1 : 0);
