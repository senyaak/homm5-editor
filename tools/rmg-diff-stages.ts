// The late pass, step by step: the engine's plane against the port's.
//
//   node tools/rmg-diff-stages.ts --template S3-4P2-4Z4K1M --size 176
//   node tools/rmg-diff-stages.ts --log _tmp/hs-s3-4.log --template ... --stage 3
//
// WHY IT EXISTS. `rmg-diff-heights` proved the plane going INTO the late pass
// is bit-identical on both problem maps, so the whole remaining height debt is
// made inside the pass. This cuts that half into its nine steps and names the
// FIRST one that diverges — after which every later step is just carrying the
// same error forward, so only the first line of this report is a lead.
//
// TO TAKE THE DUMP: `trace` and `stages` on their own lines in
// `<game>/bin/homm5-editor-rmg.txt`, then one order per launch through
// `tools/rmg-batch.ts`. The dump writes `hs <stage> <floor> <row> <bits…>`,
// nine stages per floor, and the numbers are the running order:
//
//   0 base field   1 dents      2 craters       3 flatten 1   4 smooth 1
//   5 smooth 2     6 flatten 2  7 lake flatten  8 smooth 3
//
// Each float is printed as the INT its bits are, so a match is bit equality.
// Rows are indexed by the plane's SECOND component, the same convention as the
// `heights` dump — see the note in `rmg-diff-heights.ts` about how convincing
// the other orientation looks when it is wrong.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { latePass } from '../src/rmg/heights.ts';
import type { ChainOptions } from './rmg-chain.ts';
import { readOrder, unreplayable } from './rmg-order.ts';
import { heightsInput, runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TAKES_A_VALUE = new Set(['--game', '--data', '--log', '--template', '--size', '--seed', '--players', '--floor', '--stage']);
const mapPath = args.find((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1] ?? ''));

const logPath = flag('log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no dump at ${logPath}`);
  process.exit(2);
}
// The order comes out of the map when one is given (`--game-build` for a map
// the game generated — the game's stage hooks go in under `stages` alone, no
// `trace` needed there); the flags are the older way of saying it.
const MONSTER_LEVELS = [
  'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
  'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
];
let options: ChainOptions;
let size: number;
if (mapPath) {
  const read = readOrder(mapPath);
  if (typeof read === 'string') { console.error(read); process.exit(2); }
  const { order } = read;
  const cannot = unreplayable(order);
  if (cannot.length) { console.error(`this order is not one the port replays: ${cannot.join('; ')}`); process.exit(3); }
  size = order.size;
  options = {
    seed: order.seed, template: order.template, size, players: order.players,
    underground: order.underground, water: order.water || undefined,
    monsterStrength: Math.max(0, MONSTER_LEVELS.indexOf(order.monster)),
    resourceMultiplier: order.extras.resourceIndex, expMultiplier: order.extras.expIndex,
  };
} else {
  size = Number(flag('size') ?? 96);
  options = {
    template: flag('template') ?? 'S1P2Z2M1', size, seed: Number(flag('seed') ?? 1785351845),
    players: Number(flag('players') ?? 2), monsterStrength: 1, water: 0,
  };
}
if (args.includes('--game-build')) options.gameBuild = true;
const floorWanted = Number(flag('floor') ?? 0);
const only = flag('stage') === undefined ? -1 : Number(flag('stage'));

const NAMES = [
  'base field', 'dents', 'craters', 'flatten 1', 'smooth 1',
  'smooth 2', 'flatten 2', 'lake flatten', 'smooth 3',
];

// ------------------------------------------------------------- the dump

// ONLY THE LAST BLOCK per stage: the editor appends to its log, so a second
// order leaves two dumps in one file. A row index that does not advance within
// a stage starts that stage over.
const dump = new Map<number, number[][]>();
const previous = new Map<number, number>();
for (const line of readFileSync(logPath, 'latin1').split(/\r?\n/)) {
  const m = /^hs (\d+) (-?\d+) (\d+) (.*)$/.exec(line);
  if (!m || Number(m[2]) !== floorWanted) continue;
  const stage = Number(m[1]);
  const r = Number(m[3]);
  let rows = dump.get(stage);
  if (!rows || r <= (previous.get(stage) ?? -1)) dump.set(stage, (rows = []));
  previous.set(stage, r);
  rows[r] = m[4]!.trim().split(/\s+/).map(Number);
}
console.log(logPath);
if (!dump.size) {
  console.error('  nothing parsed — were `trace` AND `stages` both in the config?');
  process.exit(2);
}
console.log(`  dump: floor ${floorWanted}, stages ${[...dump.keys()].sort((a, b) => a - b).join(' ')}`);

// ------------------------------------------------------------- the port

const run = runFull(dataDir(), options);
const v = size + 1;
console.log(`  port: ${options.template} ${size}x${size}, seed ${options.seed}, plane ${v}x${v}${options.gameBuild ? ", as the GAME's build" : ''}`);

const bits = new Int32Array(1);
const asFloat = (b: number): number => { bits[0] = b; return new Float32Array(bits.buffer)[0]!; };

type Report = { diffs: number; worst: number; wr: number; wc: number; hist: Map<string, number>; transposed: boolean };

/** One stage, in the orientation the dump is known to use. */
function compare(stage: number, ours: Float32Array): Report | undefined {
  const rows = dump.get(stage);
  if (!rows) return undefined;
  // BOTH ORIENTATIONS, the better one reported: the game's dump came out
  // indexed the other way round from the editor's, and a plane read the wrong
  // way looks like whole cones and dents in the wrong places.
  let best: Report | undefined;
  for (const transposed of [false, true]) {
    let diffs = 0, worst = 0, wr = -1, wc = -1;
    const hist = new Map<string, number>();
    for (let r = 0; r < v; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < v && c < row.length; c++) {
        const eng = asFloat(row[c]!);
        const our = transposed ? ours[r * v + c]! : ours[c * v + r]!;
        if (Object.is(eng, our)) continue;
        diffs++;
        const d = eng - our;
        if (Math.abs(d) > Math.abs(worst)) { worst = d; wr = r; wc = c; }
        const key = Math.abs(d) < 1e-6 ? 'one ulp or less' : d.toFixed(2);
        hist.set(key, (hist.get(key) ?? 0) + 1);
      }
    }
    if (!best || diffs < best.diffs) best = { diffs, worst, wr, wc, hist, transposed };
  }
  return best;
}

const reports = new Map<number, Report>();
// Stage 9 is the plane on the way IN — the constructor fill plus the relief
// cones — which the entry hook dumps before anything of the pass has run.
{
  const r = compare(9, run.heightPlane.mem);
  if (r) console.log(`  entry (cones)    ${r.diffs ? `${r.diffs} of ${v * v} differ, worst ${r.worst.toFixed(4)} at row ${r.wr}, col ${r.wc}` : 'identical'}`);
}
latePass(
  run.heightPlane,
  heightsInput(run),
  (stage, h) => {
    if (only >= 0 && stage !== only) return;
    const r = compare(stage, h.mem);
    if (r) reports.set(stage, r);
  },
  run.c.arith,
);

let firstBad = -1;
for (let stage = 0; stage < NAMES.length; stage++) {
  const r = reports.get(stage);
  if (!r) continue;
  const label = `${stage} ${NAMES[stage]}`.padEnd(16);
  if (!r.diffs) { console.log(`  ${label} identical`); continue; }
  if (firstBad < 0) firstBad = stage;
  console.log(`  ${label} ${r.diffs} of ${v * v} differ, worst ${r.worst.toFixed(4)} at row ${r.wr}, col ${r.wc}${r.transposed ? ' (transposed)' : ''}`);
  const top = [...r.hist].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  ${' '.repeat(16)} engine minus ours: ${top.map(([d, n]) => `${d}×${n}`).join('  ')}`);
}
console.log(firstBad < 0
  ? '\n  every stage of the late pass is bit-identical'
  : `\n  the FIRST stage that diverges is ${firstBad} (${NAMES[firstBad]}) — everything after it inherits this`);
