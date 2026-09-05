// The engine's own level grids against the port's, for any ordered map.
//
//   node tools/rmg-diff-grids.ts --template S3-4P2-4Z4K1M --size 176
//   node tools/rmg-diff-grids.ts --template S1-2P2-8Z8K2S --size 96 --seed 1785351845
//   node tools/rmg-diff-grids.ts --log some/other/homm5-editor-rmg.log --template ...
//
// WHY IT EXISTS. The height plane's base field scales a `dist` term by the
// distance-to-border table, and on several templates the plane says that table
// is not the one this port computes — too large on `S1-2P2-8Z8K2S`, too small
// on `S3-4P2-4Z4K1M`. Every step between `CalcBorderTiles` and the late pass
// has been read and matches, so the remaining suspect is the table itself, and
// a table is a thing you can just LOOK at: the oracle's `grids` dump already
// writes all four of a level's grids at the roads boundary.
//
// HOW TO TAKE THE DUMP. Put `grids` on its own line in
// `<game>/bin/homm5-editor-rmg.txt`, order the map with `tools/rmg-batch.ts`,
// and the rows land in `<game>/bin/homm5-editor-rmg.log`. One order per
// launch — a second generation in one process does not repeat the first.
//
// WHAT IT COMPARES. `bd` (distance to border) and `zg` (zone ids) against the
// chain replayed to the same point. `oc` and `rm` are dumped too but the port's
// occupancy and room move on after the roads boundary, so they are reported as
// sizes only. The dump indexes rows by a point's FIRST component, so both
// orientations are tried and the better one named — the map is square and
// nothing else in the port would notice a transpose here.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChain } from './rmg-chain.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const logPath = flag('log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no dump at ${logPath}`);
  console.error('put `grids` in <game>/bin/homm5-editor-rmg.txt and order a map with tools/rmg-batch.ts');
  process.exit(2);
}
const template = flag('template') ?? 'S1P2Z2M1';
const size = Number(flag('size') ?? 96);
const seed = Number(flag('seed') ?? 1785351845);
const players = Number(flag('players') ?? 2);

// ---------------------------------------------------------------- the dump

const lines = readFileSync(logPath, 'latin1').split(/\r?\n/);
let start = -1;
for (let i = 0; i < lines.length; i++) if (/roads created/.test(lines[i]!)) start = i;
if (start < 0) {
  console.error('the log holds no "roads created" boundary — was `grids` in the config?');
  process.exit(2);
}
const NAMES = ['zg', 'oc', 'bd', 'rm'] as const;
type Name = (typeof NAMES)[number];
const dump: Record<string, number[][]> = {};
for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i]!;
  if (/^grids dumped/.test(line)) break;
  const m = /^(zg|oc|bd|rm) (-?\d+) (\d+) (.*)$/.exec(line);
  if (!m) continue;
  const [, name, , row] = m;
  (dump[name!] ??= [])[Number(row)] = m[4]!.trim().split(/\s+/).map(Number);
}
const dumped = NAMES.filter((n) => dump[n]);
console.log(`${logPath}`);
console.log(`  dump at line ${start + 1}: ${dumped.length ? dumped.map((n) => `${n} (${dump[n]!.length} rows)`).join(', ') : 'nothing parsed'}`);
if (!dumped.length) process.exit(2);

// ---------------------------------------------------------------- the port

const c = runChain(dataDir(), { template, size, players, seed, monsterStrength: 1, water: 0 });
console.log(`  port: ${template} ${size}x${size}, seed ${seed}, ${c.loaded.zones.length} zones`);

/** How many cells differ, under each orientation, plus where and by how much. */
function compare(name: Name, ours: Int32Array[]): void {
  const eng = dump[name];
  if (!eng) { console.log(`  ${name}: not in the dump`); return; }
  const best = { orient: '', diffs: Number.POSITIVE_INFINITY, first: '', hist: new Map<number, number>() };
  for (const orient of ['rows are the FIRST index', 'rows are the SECOND index'] as const) {
    let diffs = 0, first = '';
    const hist = new Map<number, number>();
    for (let r = 0; r < size; r++) {
      for (let j = 0; j < size; j++) {
        const ev = eng[r]?.[j];
        const ov = orient === 'rows are the FIRST index' ? ours[j]?.[r] : ours[r]?.[j];
        if (ev === undefined || ov === undefined || ev === ov) continue;
        diffs++;
        const d = ev - ov;
        hist.set(d, (hist.get(d) ?? 0) + 1);
        if (!first) first = `row ${r} col ${j}: engine ${ev}, ours ${ov}`;
      }
    }
    if (diffs < best.diffs) { best.orient = orient; best.diffs = diffs; best.first = first; best.hist = hist; }
  }
  const total = size * size;
  console.log(`  ${name}: ${best.diffs ? `${best.diffs} of ${total} cells differ` : `identical (${total} cells)`} — ${best.orient}`);
  if (best.first) console.log(`      first ${best.first}`);
  if (best.diffs) {
    const top = [...best.hist].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`      engine minus ours: ${top.map(([d, n]) => `${d > 0 ? '+' : ''}${d}×${n}`).join('  ')}`);
  }
}

compare('bd', c.border);
compare('zg', c.grid);
for (const n of ['oc', 'rm'] as const) {
  if (dump[n]) console.log(`  ${n}: ${dump[n]!.length} rows dumped, not compared — the port's ${n === 'oc' ? 'occupancy' : 'room'} moves on after this boundary`);
}
