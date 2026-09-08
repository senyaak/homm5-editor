// Diff the engine's draw trace against the port's, draw by draw.
//
//   node tools/rmg-diff-draws.ts --game <dir>
//   node tools/rmg-diff-draws.ts --game <dir> --from game/bin/rmg-batch/10
//   node tools/rmg-diff-draws.ts --game <dir> --from <run> --full --context 20
//   node tools/rmg-diff-draws.ts --from <run> --full --log <kept trace>.log
//
// Reads the last run's `t*` lines out of bin/homm5-editor-rmg.log (written by
// the oracle when the config says `trace`), replays the same seed through the
// ported chain with the trace listener on, and names the FIRST draw where the
// two disagree — kind or value. For a jitter draw the port also knows which
// tile it was deciding, which is where the reading of the condition around it
// starts.
//
// THE ORDER IS NOT ASSUMED ANY MORE. This used to hardcode the reference
// (template S1P2Z2M1, 2 players, 96 tiles) because every ordered run had used
// it. The sweep of all twenty-two templates changed that: the port reproduces
// the object layer of the four TWO-ZONE templates and of nothing else, so the
// question worth asking is where a THREE-zone template first turns differently
// — and asking it means pointing this at that run. `--from <folder|.h5m>`
// takes the order out of the map the engine made, exactly as `rmg-diff-map`
// does; without it the reference order stands, which is what the boundary
// suites still use.
//
// The whole chain is replayed, not just FillZones — the engine's trace stops
// at its own twelfth boundary and the tool says so when the port outlives it.
// `--full` goes further still, through every phase the port has.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeOrder, readOrder } from './rmg-order.ts';
import { runChain } from './rmg-chain.ts';
import type { ChainOptions } from './rmg-chain.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// The oracle always writes `bin/homm5-editor-rmg.log`, and a trace worth
// keeping gets renamed beside it. `--log <path>` replays one of those kept
// files instead of the live one, so a reading can be re-checked without
// copying a 20 MB log back over the name the oracle owns.
const logPath = flag('--log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no ${logPath} — generate a map with \`trace\` in the oracle config first, or point --log at a kept one`);
  process.exit(1);
}

// The last run's lines: seed, then every draw in order.
let loggedSeed: number | null = null;
// `tb` lines carry a third number since the limit was added to the trace; a
// log made before that still parses, it just cannot say what was chosen among.
let engine: Array<{ kind: string; counter: number; value: number; limit?: number }> = [];
for (const line of readFileSync(logPath, 'latin1').split(/\r?\n/)) {
  const run = /^run seed (-?\d+) (\d+)$/.exec(line);
  if (run) {
    loggedSeed = Number(run[1]);
    engine = [];
  }
  const t = /^t([nb6f]) (\d+) (-?\d+)(?: (-?\d+))?$/.exec(line);
  if (t) {
    engine.push({
      kind: t[1]!, counter: Number(t[2]), value: Number(t[3]),
      ...(t[4] === undefined ? {} : { limit: Number(t[4]) }),
    });
  }
}
if (loggedSeed === null || engine.length === 0) {
  console.error('the log has no traced run — was `trace` in the config when the map was generated?');
  process.exit(1);
}
console.log(`engine: seed ${loggedSeed}, ${engine.length} draws traced`);

// The order: the reference unless a generated map is named, in which case the
// map's own record answers everything, including whether the log is even about
// the same seed.
const options: ChainOptions = {
  seed: loggedSeed,
  // The dialog SUPPLIES both — its dropdowns have no "random" — so the engine
  // spends discarded next()s here, and the first traced run proved it: draws
  // 4-5 are tn, not tb. Medium strength, water off, the dialog's defaults;
  // `--water` replays the water reference instead (the checkbox supplies 2).
  water: args.includes('--water') ? 2 : 0,
};
const from = flag('--from');
if (from) {
  const read = readOrder(from);
  if (typeof read === 'string') { console.error(read); process.exit(2); }
  const { order } = read;
  console.log(`order:  ${describeOrder(order)}`);
  if (order.seed !== loggedSeed) {
    console.error(`the log is seed ${loggedSeed} and ${from} is seed ${order.seed} —`
      + ' these are two different runs, and comparing them says nothing');
    process.exit(2);
  }
  options.template = order.template;
  options.size = order.size;
  options.players = order.players;
  options.underground = order.underground;
  options.water = order.water;
  // The rest of the order, which used to be left at the chain's defaults and
  // which a game-generated map never has at them.
  const MONSTER_LEVELS = [
    'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
    'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
  ];
  options.monsterStrength = Math.max(0, MONSTER_LEVELS.indexOf(order.monster));
  options.resourceMultiplier = order.extras.resourceIndex;
  options.expMultiplier = order.extras.expIndex;
  // A map from the GAME replays as the game's build — see `ChainOptions.gameBuild`.
  if (args.includes('--game-build')) options.gameBuild = true;
} else {
  console.log('order:  the reference (S1P2Z2M1, 2 players, 96 tiles) — `--from <run>` for another');
}

const port: Array<{ kind: string; value: number; limit?: number }> = [];
const jitterTiles = new Map<number, { sweep: number; a: number; b: number }>();
options.onDraw = (kind, value, limit) => port.push({ kind, value, limit });
// port.length is the index the NEXT draw will take — the jitter draw this
// call announces.
options.jitter = (sweep, a, b) => jitterTiles.set(port.length, { sweep, a, b });
const phases: Array<{ label: string; draws: number }> = [];
options.onPhase = (label, draws) => phases.push({ label, draws });

// `--full` carries on past the chain — MainObjects, the roads, the statics and
// the treasure blocks. A template whose CHAIN is exact still writes a wrong
// map, and the phase that spoils it can only be named by replaying it too.
const full = args.includes('--full');
if (full) runFull(dataDir(), options, (label, draws) => phases.push({ label, draws }));
else runChain(dataDir(), options);
console.log(`port:   ${port.length} draws through ${full ? 'the whole run' : 'the chain'}`);

const describe = (i: number): string => {
  const context = jitterTiles.get(i);
  return context ? ` (port: sweep ${context.sweep}, tile ${context.a}:${context.b})` : '';
};
/** Which phase the port was inside when it took draw `i` (0-based). */
const phaseOf = (i: number): string => {
  let inside = phases[0]?.label ?? '?';
  for (const p of phases) if (p.draws <= i) inside = p.label;
  // The label marks where a phase ENDS, so a draw at or after it belongs to
  // whatever runs next — name that instead of the one just finished.
  const at = phases.findIndex((p) => p.draws > i);
  return at > 0 ? `${phases[at - 1]!.label} → ${phases[at]!.label}` : `after ${inside}`;
};

let diverged = -1;
const shared = Math.min(engine.length, port.length);
// TWO DIFFERENCES THE GAME'S BUILD HAS THAT ARE NOT DIVERGENCES: it inlines
// some `below(2)` coins as a bare `next()` (a `tn` where the port says `tb 0
// of 2`, the stream in step), and its `betweenFloat` lands one ulp under the
// port's (a `tf` a bit apart, the state untouched). Both are counted and
// skipped so the first divergence named is one that moves the stream.
let soft = 0;
for (let i = 0; i < shared; i++) {
  const e = engine[i]!, p = port[i]!;
  if (e.kind === 'n' && p.kind === 'b') { soft++; continue; }
  if (e.kind === 'f' && p.kind === 'f' && Math.abs(e.value - p.value) <= 2) { if (e.value !== p.value) soft++; continue; }
  if (e.kind !== p.kind || e.value !== p.value) { diverged = i; break; }
}
if (soft) console.log(`soft differences skipped: ${soft} (a tn for a tb, or a tf within two ulps)`);

if (diverged === -1) {
  if (port.length <= engine.length) {
    console.log(`\nthe port matches the engine for all ${shared} draws it makes — the chain ends aligned;`);
    console.log(`the engine goes on for ${engine.length - port.length} more (the phases not yet ported).`);
  } else {
    console.log(`\nno mismatch in ${shared} draws, but the PORT keeps drawing after the trace stopped —`);
    console.log(`${port.length - engine.length} extra, the first at index ${shared}${describe(shared)}`);
  }
  process.exit(0);
}

console.log(`\nFIRST DIVERGENCE at draw ${diverged + 1} (engine counter ${engine[diverged]!.counter}),`
  + ` in the port's ${phaseOf(diverged)}:`);
console.log(`  phases: ${phases.map((p) => `${p.label} ${p.draws}`).join(', ')}`);
const shown = (d: { kind: string; value: number; limit?: number }): string =>
  `t${d.kind} ${d.value}${d.limit === undefined ? '' : ` of ${d.limit}`}`;
console.log(`  engine: ${shown(engine[diverged]!)}`);
console.log(`  port:   ${shown(port[diverged]!)}${describe(diverged)}`);
// Five either side answers "did they agree a moment ago"; a wider window is
// what identifies a whole missing block, so `--context N` widens it.
const context = Number(flag('--context') ?? 5);
console.log('\ncontext (engine | port):');
for (let i = Math.max(0, diverged - context); i < Math.min(shared, diverged + context + 1); i++) {
  const mark = i === diverged ? ' <-- here' : '';
  console.log(`  #${i + 1}  ${shown(engine[i]!)}  |  ${shown(port[i]!)}${describe(i)}${mark}`);
}
process.exit(1);
