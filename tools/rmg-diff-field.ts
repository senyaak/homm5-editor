// The engine's road cost fields against the port's, route by route.
//
//   node tools/rmg-diff-field.ts --game <dir> "game/H5E/<the run>.h5m" --game-build
//   node tools/rmg-diff-field.ts --game <dir> game/bin/rmg-batch/3
//   node tools/rmg-diff-field.ts --log some/other/homm5-editor-rmg.log ...
//
// WHY. `tools/rmg-diff-grids.ts` says the game's road LISTS part from the
// port's a few tiles in, on nearly every list of a map, with the zone grid,
// the border table and the room identical underneath. A road is a walk down a
// converged cost field, so the field is the next thing to look at, and the
// oracle's `field` instrument writes every route's field from the live engine
// (`fld` header, `fc` rows, floats as their bits). This replays the same order
// with `RoadInput.field` collecting the port's, pairs them by zone, kind, from
// and to in call order, and reports the first route whose field differs and
// the first cell where it does — bit for bit, so an ulp is a finding.
//
// HOW TO TAKE THE DUMP. `field` on its own line in
// `<game>/bin/homm5-editor-rmg.txt`, one map generated, from either build.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tile } from '../src/rmg/placement.ts';
import { MAP_SIZES } from './rmg-build.ts';
import { readOrder, unreplayable } from './rmg-order.ts';
import type { ChainOptions } from './rmg-chain.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TAKES_A_VALUE = new Set(['--game', '--data', '--log']);
const mapPath = args.find((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1] ?? ''));
if (!mapPath) {
  console.error('point me at the generated map: node tools/rmg-diff-field.ts --game <dir> <map.h5m|folder> [--game-build]');
  process.exit(2);
}
const logPath = flag('log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) { console.error(`no dump at ${logPath}`); process.exit(2); }

// ---------------------------------------------------------------- the order

const MONSTER_LEVELS = [
  'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
  'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
];
const read = readOrder(mapPath);
if (typeof read === 'string') { console.error(read); process.exit(2); }
const { order } = read;
const cannot = unreplayable(order);
if (cannot.length) {
  console.error('this order is not one the port replays:');
  for (const line of cannot) console.error(`  - ${line}`);
  process.exit(3);
}
const monsterStrength = MONSTER_LEVELS.indexOf(order.monster);
if (monsterStrength < 0) { console.error(`unknown MonsterLevel ${order.monster}`); process.exit(2); }
const gameBuild = args.includes('--game-build');
const size = order.size;
const options: ChainOptions = {
  seed: order.seed, template: order.template, size, players: order.players,
  underground: order.underground, water: order.water || undefined, monsterStrength,
  resourceMultiplier: order.extras.resourceIndex, expMultiplier: order.extras.expIndex,
};
if (gameBuild) options.gameBuild = true;
console.log(`${mapPath}`);
console.log(`  ordered: ${order.template} ${MAP_SIZES[order.sizeIndex]} seed ${order.seed}, ${order.players} players,`
  + ` water ${order.water}, ${order.underground ? 'with' : 'no'} underground, ${order.monster}`);

// ---------------------------------------------------------------- the dump

interface Route { zone: number; kind: number; from: Tile; to: Tile; rows: Int32Array[] }

const lines = readFileSync(logPath, 'latin1').split(/\r?\n/);
// The LAST run in the log: from its final `run seed` line on.
let runStart = 0;
for (let i = 0; i < lines.length; i++) if (/^run seed /.test(lines[i]!)) runStart = i;
const theirs: Route[] = [];
let current: Route | null = null;
for (let i = runStart; i < lines.length; i++) {
  const line = lines[i]!;
  let m = /^fld (\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\d+) (\d+) (\d+)$/.exec(line);
  if (m) {
    current = {
      zone: Number(m[1]), from: [Number(m[2]), Number(m[3])], to: [Number(m[4]), Number(m[5])],
      kind: Number(m[8]), rows: [],
    };
    theirs.push(current);
    continue;
  }
  m = /^fc (\d+) (.*)$/.exec(line);
  if (m && current) current.rows[Number(m[1])] = Int32Array.from(m[2]!.trim().split(/\s+/).map(Number));
}
console.log(`${logPath}`);
console.log(`  ${theirs.length} routes dumped from the last run (from line ${runStart + 1})`);
if (!theirs.length) { console.error('no `fld` lines — was `field` in the config?'); process.exit(2); }

// ---------------------------------------------------------------- the port

interface Ours { zone: number; kind: number; from: Tile; to: Tile; cost: Float32Array }
const ours: Ours[] = [];
runFull(dataDir(), {
  ...options,
  roadField: (zone, kind, cost, from, to) => ours.push({ zone, kind, from, to, cost: Float32Array.from(cost) }),
});
console.log(`  port: ${ours.length} routes${gameBuild ? ", as the GAME's build" : ''}`);

// ---------------------------------------------------------------- compare

const bits = new Int32Array(1);
const f32 = new Float32Array(bits.buffer);
const asFloat = (i: number): number => { bits[0] = i; return f32[0]!; };
const asBits = (f: number): number => { f32[0] = f; return bits[0]!; };

let same = 0, shown = 0;
const n = Math.min(theirs.length, ours.length);
for (let r = 0; r < n; r++) {
  const t = theirs[r]!, o = ours[r]!;
  const head = `  route ${r}: zone ${t.zone} kind 0x${t.kind.toString(16)} ${t.from[0]},${t.from[1]} -> ${t.to[0]},${t.to[1]}`;
  if (t.zone !== o.zone || t.kind !== o.kind || t.to[0] !== o.to[0] || t.to[1] !== o.to[1]) {
    console.log(`${head} — THE PORT ROUTES zone ${o.zone} kind 0x${o.kind.toString(16)} ${o.from[0]},${o.from[1]} -> ${o.to[0]},${o.to[1]} here; the call order parted`);
    break;
  }
  // `from` is paired loosely: the hook reads it as two floats, and on the
  // roads phase's 0x08 routes the first came back 0 where the port had a
  // real x — the field itself says where the wave started, at its one zero
  // cell, so that is reported instead of trusting the header.
  if (t.from[0] !== o.from[0] || t.from[1] !== o.from[1]) {
    let zero = 'none';
    for (let a = 0; a < size && zero === 'none'; a++) {
      const row = t.rows[a];
      if (!row) continue;
      for (let b = 0; b < size; b++) if (row[b] === 0) { zero = `${a},${b}`; break; }
    }
    console.log(`${head}: the header's from differs from the port's ${o.from[0]},${o.from[1]}; the engine's field is zero at ${zero}`);
  }
  // The port's field is [x][y] x-major; the engine's rows are tried both ways.
  let best = { orient: '', diffs: Number.POSITIVE_INFINITY, first: '' };
  for (const orient of ['row is x', 'row is y'] as const) {
    let diffs = 0, first = '';
    for (let a = 0; a < size; a++) {
      const row = t.rows[a];
      if (!row) continue;
      for (let b = 0; b < size; b++) {
        const [x, y] = orient === 'row is x' ? [a, b] : [b, a];
        const ov = o.cost[x * size + y]!;
        const ev = row[b]!;
        if (ev === asBits(ov)) continue;
        diffs++;
        if (!first) first = `x ${x} y ${y}: engine ${asFloat(ev)} (0x${(ev >>> 0).toString(16)}), ours ${ov} (0x${(asBits(ov) >>> 0).toString(16)})`;
      }
    }
    if (diffs < best.diffs) best = { orient, diffs, first };
  }
  if (!best.diffs) { same++; continue; }
  if (shown++ < 12) console.log(`${head}: ${best.diffs} cells differ (${best.orient}); first ${best.first}`);
}
console.log(`  ${same} of ${n} fields identical${theirs.length !== ours.length ? ` (engine ${theirs.length} routes, port ${ours.length})` : ''}`);
