// The engine's height plane BEFORE the late pass, against the port's.
//
//   node tools/rmg-diff-heights.ts --game <dir> --template S3-4P2-4Z4K1M --size 176
//
// WHY IT EXISTS. The plane a map file carries is the sum of two halves — the
// level constructor's fill plus the statics' relief cones, and then the late
// pass (`0xECF760`) over the top — and a difference in the sum says nothing
// about which half owns it. The oracle's `heights` dump writes the plane at
// "treasure blocks set", the last boundary before the late pass runs and one
// no draw separates from "finished creating map", so it is exactly the first
// half. This diffs it against `runFull`'s `heightPlane`, which is the same
// half of the port.
//
// TO TAKE THE DUMP: `trace` and `heights` on their own lines in
// `<game>/bin/homm5-editor-rmg.txt` (`heights` alone dumps nothing — the zone
// pointers it reaches the level through are harvested by the trace hook), then
// one order per launch through `tools/rmg-batch.ts`.
//
// The dump prints each float as the INT its bits are, so a match here is bit
// equality, not a tolerance.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const logPath = flag('log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no dump at ${logPath}`);
  process.exit(2);
}
const template = flag('template') ?? 'S1P2Z2M1';
const size = Number(flag('size') ?? 96);
const seed = Number(flag('seed') ?? 1785351845);
const players = Number(flag('players') ?? 2);
const floorWanted = Number(flag('floor') ?? 0);

// ------------------------------------------------------------- the dump

// ONLY THE LAST BLOCK. The editor appends to its log, so a second order leaves
// two dumps in one file — and the older one is wider when the older map was
// bigger. A row index that does not advance starts a new block.
let rows: number[][] = [];
let previous = -1;
for (const line of readFileSync(logPath, 'latin1').split(/\r?\n/)) {
  const m = /^hp (-?\d+) (\d+) (.*)$/.exec(line);
  if (!m || Number(m[1]) !== floorWanted) continue;
  const r = Number(m[2]);
  if (r <= previous) rows = [];
  previous = r;
  rows[r] = m[3]!.trim().split(/\s+/).map(Number);
}
const present = rows.filter(Boolean).length;
console.log(`${logPath}`);
console.log(`  dump: ${present} rows for floor ${floorWanted}`);
if (!present) {
  console.error('  nothing parsed — was `trace` in the config beside `heights`?');
  process.exit(2);
}

// ------------------------------------------------------------- the port

const run = runFull(dataDir(), { template, size, players, seed, monsterStrength: 1, water: 0 });
const v = size + 1;
const ours = run.heightPlane.mem;
console.log(`  port: ${template} ${size}x${size}, seed ${seed}, plane ${v}x${v}`);

// BOTH ORIENTATIONS, and the fitting one named. The plane's two conventions are
// transposed against each other throughout this port (see the file header of
// `heights.ts`), and taking the wrong one here costs a whole afternoon: it made
// the pre-late-pass planes look 1,764 vertices apart in cone-shaped deltas,
// which read exactly like misplaced relief cones and were nothing of the kind.
const bits = new Int32Array(1);
const asFloat = (b: number): number => { bits[0] = b; return new Float32Array(bits.buffer)[0]!; };

let missing = 0;
for (let r = 0; r < v; r++) if (!rows[r]) missing++;
if (missing) console.log(`  ${missing} rows were not in the dump`);

const total = v * v;
const best = { label: '', diffs: Number.POSITIVE_INFINITY, worst: 0, wr: -1, wc: -1, hist: new Map<string, number>() };
for (const [label, idx] of [
  ["rows are the plane's FIRST index", (r: number, c: number) => r * v + c],
  ["rows are the plane's SECOND index", (r: number, c: number) => c * v + r],
] as const) {
  let diffs = 0, worst = 0, wr = -1, wc = -1;
  const hist = new Map<string, number>();
  for (let r = 0; r < v; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < v && c < row.length; c++) {
      const eng = asFloat(row[c]!);
      const our = ours[idx(r, c)]!;
      if (Object.is(eng, our)) continue;
      diffs++;
      const d = eng - our;
      if (Math.abs(d) > Math.abs(worst)) { worst = d; wr = r; wc = c; }
      const key = Math.abs(d) < 1e-6 ? 'one ulp or less' : d.toFixed(2);
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
  }
  if (diffs < best.diffs) Object.assign(best, { label, diffs, worst, wr, wc, hist });
}
console.log(best.diffs
  ? `  ${best.diffs} of ${total} vertices differ; worst ${best.worst.toFixed(4)} at row ${best.wr}, col ${best.wc} — ${best.label}`
  : `  the pre-late-pass plane is BIT-IDENTICAL — ${total} vertices, ${best.label}`);
if (best.diffs) {
  const top = [...best.hist].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`      engine minus ours: ${top.map(([d, n]) => `${d}×${n}`).join('  ')}`);
}
