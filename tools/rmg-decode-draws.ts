// The draw stream, with the objects it created written against it.
//
//   node tools/rmg-decode-draws.ts --game <dir>                    the whole run
//   node tools/rmg-decode-draws.ts --game <dir> --step mines       one step, every zone
//   node tools/rmg-decode-draws.ts --game <dir> --from 18491 --to 18566
//   node tools/rmg-decode-draws.ts --game <dir> --count            the tally, no lines
//
// WHY THIS EXISTS. A trace is 92,438 numbers and a phase boundary says only how
// many of them a step spent. What it does not say is what any single one was
// FOR, and reading a step out of the disassembly gives a model that has to be
// held against the stream somehow.
//
// The join is the object name. Every object the generator creates is named
// `item_<signed int32>`, minted from two `below(65535)` draws (src/rmg/armies.ts),
// and the reference map records that name. So a pair of consecutive draws whose
// two values compose a name the map has IS the moment that object was created —
// and all 1,556 objects in the reference map find their pair. That turns an
// anonymous stream into a labelled one: the draws between two named objects are
// what the code did to decide the second, and there are only so many things
// they can be.
//
// It is how the mines step was decoded — the retry that costs two draws, the
// guard that costs four, the 0.8 the piles are rolled against — and it is meant
// for the steps after it, which are the same problem again.
//
// A false pair is possible in principle: two draws that happen to compose the
// name of some other object. It has not happened here, and it announces itself
// when it does, because the label lands where the step's shape says nothing was
// created. Names are reported at every position they could have been minted at.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

const root = gameDir();
const logPath = join(root, 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.log(`nothing to read — ${logPath} does not exist`);
  process.exit(0);
}

interface Draw {
  kind: string;
  value: number;
}
interface Step {
  at: number;
  zone: number;
  what: string;
}

/** The LAST run in the log — it appends, and the newest run is the one meant. */
function lastRun(): { draws: Map<number, Draw>; steps: Step[]; seed: number | null } {
  const draws = new Map<number, Draw>();
  const steps: Step[] = [];
  let seed: number | null = null;
  for (const line of readFileSync(logPath, 'latin1').split(/\r?\n/)) {
    const run = /^run seed (-?\d+) (\d+)$/.exec(line);
    if (run) {
      seed = Number(run[1]);
      draws.clear();
      steps.length = 0;
      continue;
    }
    const draw = /^t([nb6f]) (\d+) (-?\d+)$/.exec(line);
    if (draw) draws.set(Number(draw[2]), { kind: draw[1], value: Number(draw[3]) });
    const step = /^step (\d+) (-?\d+) (.+)$/.exec(line);
    if (step) steps.push({ at: Number(step[1]), zone: Number(step[2]), what: step[3] });
  }
  return { draws, steps, seed };
}

const { draws, steps, seed } = lastRun();
if (!draws.size) {
  console.log('the log has no traced run — was `trace` in the config when the map was generated?');
  process.exit(1);
}

/** The reference map's objects, by the name they were minted with. */
function objects(): Map<number, { kind: string; shared: string }> {
  // `--reference <dir>` names a sibling of `reference` under `_tmp/oracle` —
  // the run in the log decides which map the names come from.
  const path = join(import.meta.dirname, '..', '_tmp', 'oracle',
    flagValue('reference') ?? 'reference', 'map.xdb');
  const out = new Map<number, { kind: string; shared: string }>();
  if (!existsSync(path)) return out;
  const xdb = readFileSync(path, 'utf8');
  for (const m of xdb.matchAll(
    /<Item href="#n:inline\((AdvMap\w+)\)" id="item_(-?\d+)">([\s\S]*?)<Shared href="([^"#]*)/g,
  )) {
    out.set(Number(m[2]), {
      kind: m[1].replace('AdvMap', ''),
      shared: m[4].split('/').pop()!.replace(/\.\(.*/, ''),
    });
  }
  return out;
}

const byName = objects();
const MINT_LIMIT = 65535;

/** What each draw is, where the objects say so. */
const label = new Map<number, string>();
let named = 0;
for (const [counter, draw] of draws) {
  const next = draws.get(counter + 1);
  if (!next || draw.kind !== 'b' || next.kind !== 'b') continue;
  if (draw.value >= MINT_LIMIT || next.value >= MINT_LIMIT) continue;
  const object = byName.get((draw.value * 65536 + next.value) | 0);
  if (!object) continue;
  label.set(counter, `${object.kind} ${object.shared}`);
  label.set(counter + 1, '"');
  named++;
}

/** A `betweenFloat` line logs the bits, not the number. */
function asFloat(bits: number): string {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(bits);
  return buf.readFloatLE().toFixed(4);
}

// What to show. `--step <word>` takes every step whose name contains it, which
// is one line per zone; the range is that step's own draws, boundary to
// boundary, so the numbers line up with what `rmg-oracle --read` reports.
const ranges: Array<{ from: number; to: number; what: string }> = [];
const wanted = flagValue('step');
if (wanted) {
  let previous = 0;
  for (const step of steps) {
    if (step.what.includes(wanted)) {
      ranges.push({
        from: previous,
        to: step.at,
        what: `${step.what}${step.zone < 0 ? '' : ` (zone ${step.zone})`}`,
      });
    }
    previous = step.at;
  }
  if (!ranges.length) {
    console.log(`no step is called that — try one of: ${[...new Set(steps.map((s) => s.what))].join(', ')}`);
    process.exit(1);
  }
} else {
  const from = Number(flagValue('from') ?? 0);
  const to = Number(flagValue('to') ?? Math.max(...draws.keys()));
  ranges.push({ from, to, what: `${from}..${to}` });
}

console.log(`seed ${seed}, ${draws.size} draws, ${named} of them minting one of ${byName.size} objects\n`);

for (const range of ranges) {
  const spent = range.to - range.from;
  console.log(`=== ${range.what} — ${spent} draws, ${range.from + 1}..${range.to}`);
  if (args.includes('--count')) {
    const tally = new Map<string, number>();
    for (let c = range.from + 1; c <= range.to; c++) {
      const draw = draws.get(c);
      if (!draw) continue;
      const what = label.get(c)?.split(' ')[0] ?? (draw.kind === 'f' ? 'roll' : 'below');
      tally.set(what, (tally.get(what) ?? 0) + 1);
    }
    console.log(
      '  ' +
        [...tally].map(([what, n]) => `${what} ${n}`).join('  '),
    );
    continue;
  }
  for (let c = range.from + 1; c <= range.to; c++) {
    const draw = draws.get(c);
    if (!draw) continue;
    const value = draw.kind === 'f' ? asFloat(draw.value) : String(draw.value);
    console.log(`  ${String(c).padStart(7)}  ${draw.kind}  ${value.padStart(11)}  ${label.get(c) ?? ''}`);
  }
}
