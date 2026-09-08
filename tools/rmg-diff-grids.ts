// The engine's own road lists and level grids against the port's, at the
// roads boundary, for any generated map.
//
//   node tools/rmg-diff-grids.ts --game <dir> "game/H5E/<the run>.h5m" --game-build
//   node tools/rmg-diff-grids.ts --game <dir> game/bin/rmg-batch/3
//   node tools/rmg-diff-grids.ts --game <dir> --template S1-2P2-8Z8K2S --size 96 --seed 1785351845
//   node tools/rmg-diff-grids.ts --log some/other/homm5-editor-rmg.log ...
//
// WHY IT EXISTS. The draw counter is blind to WHICH tiles a road walked — the
// walk spends one coin per tile, so two corridors of equal length cost the same
// coins and the route can move while the stream stays in step. The game's
// router computes its cost field in SSE where the editor's keeps the chain on
// the x87 stack, and the port's model of that moved the first underground
// crater to two tiles from the game's without landing on it. The one measured
// way to say where the model is wrong is to read the engine's lists where they
// live: the oracle's `grids` instrument dumps every zone's three road lists
// (`rl`/`rt`) and all four level grids (`zg`/`oc`/`bd`/`rm`) at "roads
// created", and this compares them with the port's at the same boundary.
//
// HOW TO TAKE THE DUMP. Put `grids` on its own line in
// `<game>/bin/homm5-editor-rmg.txt` and generate ONE map — through
// `tools/rmg-batch.ts` for the editor's build, or in the game's own screen for
// the game's — and the rows land in `<game>/bin/homm5-editor-rmg.log`. One
// order per launch: a second generation in one process does not repeat the
// first. Then point this at the map it produced; the map carries its order.
//
// WHAT IT COMPARES. Per zone and kind, the road list against the port's — its
// length, and the first tile that differs. Per floor, the four grids cell by
// cell, both orientations tried (the dump indexes rows by a point's first
// component and the map is square, so nothing else would notice a transpose).
// The port's occupancy and room are SNAPSHOTTED at the boundary, which is why
// they are comparable here and were not in an earlier cut of this tool.

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
const TAKES_A_VALUE = new Set(['--game', '--data', '--log', '--template', '--size', '--seed', '--players', '--water']);
const mapPath = args.find((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1] ?? ''));

const logPath = flag('log') ?? join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no dump at ${logPath}`);
  console.error('put `grids` in <game>/bin/homm5-editor-rmg.txt and generate one map');
  process.exit(2);
}

// ---------------------------------------------------------------- the order

const MONSTER_LEVELS = [
  'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
  'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
];
const gameBuild = args.includes('--game-build');
let options: ChainOptions;
let size: number;
if (mapPath) {
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
  size = order.size;
  options = {
    seed: order.seed, template: order.template, size, players: order.players,
    underground: order.underground, water: order.water || undefined, monsterStrength,
    resourceMultiplier: order.extras.resourceIndex, expMultiplier: order.extras.expIndex,
  };
  console.log(`${mapPath}`);
  console.log(`  ordered: ${order.template} ${MAP_SIZES[order.sizeIndex]} seed ${order.seed}, ${order.players} players,`
    + ` water ${order.water}, ${order.underground ? 'with' : 'no'} underground, ${order.monster}`);
} else {
  size = Number(flag('size') ?? 96);
  options = {
    template: flag('template') ?? 'S1P2Z2M1', size, seed: Number(flag('seed') ?? 1785351845),
    players: Number(flag('players') ?? 2), monsterStrength: 1, water: Number(flag('water') ?? 0) || undefined,
  };
}
// The two builds are the same source compiled twice and do not agree — see
// `tools/rmg-diff-map.ts` for what `--game-build` stands for.
if (gameBuild) options.gameBuild = true;

// ---------------------------------------------------------------- the dump

const lines = readFileSync(logPath, 'latin1').split(/\r?\n/);
let start = -1;
for (let i = 0; i < lines.length; i++) if (/roads created/.test(lines[i]!)) start = i;
if (start < 0) {
  console.error('the log holds no "roads created" boundary — was `grids` in the config?');
  process.exit(2);
}
const stepAt = /^step (\d+) /.exec(lines[start]!);
const NAMES = ['zg', 'oc', 'bd', 'rm'] as const;
type Name = (typeof NAMES)[number];
/** `dump[name][floor][row]` */
const dump: Record<string, number[][][]> = {};
/** Per zone id, per kind bit, the tiles in list order. */
const lists = new Map<number, Map<number, Tile[]>>();
let current: Tile[] | null = null;
let dumpEnd = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i]!;
  if (/^grids dumped/.test(line)) { dumpEnd = i; break; }
  let m = /^(zg|oc|bd|rm) (-?\d+) (\d+) (.*)$/.exec(line);
  if (m) {
    const [, name, floor, row] = m;
    ((dump[name!] ??= [])[Number(floor)] ??= [])[Number(row)] = m[4]!.trim().split(/\s+/).map(Number);
    current = null;
    continue;
  }
  m = /^rl (\d+) (\d+) (\d+)$/.exec(line);
  if (m) {
    const id = Number(m[1]), kind = Number(m[2]);
    current = [];
    if (!lists.has(id)) lists.set(id, new Map());
    lists.get(id)!.set(kind, current);
    continue;
  }
  m = /^rt (-?\d+) (-?\d+)$/.exec(line);
  if (m && current) current.push([Number(m[1]), Number(m[2])]);
}
const dumped = NAMES.filter((n) => dump[n]);
console.log(`${logPath}`);
console.log(`  dump at lines ${start + 1}..${dumpEnd + 1}${stepAt ? `, engine at ${stepAt[1]} draws` : ''}:`
  + ` ${lists.size} zones' road lists, ${dumped.map((n) => `${n} (${dump[n]!.length} floors)`).join(', ') || 'no grids'}`);
if (!dumped.length && !lists.size) process.exit(2);

// ---------------------------------------------------------------- the port

/** The four grids per floor, copied at the boundary — the run moves on after. */
interface Snapshot { grid: Int32Array[]; border: Int32Array[]; occ: Int32Array; room: Int32Array[] }
let snapshot: Snapshot[] | null = null;
let drawsAt = -1;
const run = runFull(dataDir(), options, (label, draws, chain) => {
  if (label !== 'roads phase') return;
  drawsAt = draws;
  snapshot = chain.floors.map((f) => ({
    grid: f.grid.map((r) => Int32Array.from(r)),
    border: f.border.map((r) => Int32Array.from(r)),
    occ: Int32Array.from(f.occ),
    room: f.room.map((r) => Int32Array.from(r)),
  }));
});
if (!snapshot) { console.error('the run never reached the roads boundary'); process.exit(2); }
const floors: Snapshot[] = snapshot;
console.log(`  port: ${options.template} ${size}x${size}, seed ${options.seed}, ${run.c.loaded.zones.length} zones,`
  + ` ${drawsAt} draws at the boundary${gameBuild ? ", as the GAME's build" : ''}`);
if (stepAt && Number(stepAt[1]) !== drawsAt) {
  console.log(`  THE DRAW COUNT DIFFERS: engine ${stepAt[1]}, port ${drawsAt} — a phase before the roads parts, read that first`);
}

// ---------------------------------------------------------------- road lists

const KINDS: Array<[number, 'road20' | 'road08' | 'road10']> = [[32, 'road20'], [8, 'road08'], [16, 'road10']];
let listsSame = 0, listsTotal = 0;
for (const [id, byKind] of [...lists].sort((a, b) => a[0] - b[0])) {
  const ours = run.roadLists.get(id);
  for (const [kind, name] of KINDS) {
    const eng = byKind.get(kind);
    if (!eng) continue;
    listsTotal++;
    const our = ours?.[name] ?? [];
    // The list as the engine stores it, then transposed — one line says which.
    const firstDiff = (swap: boolean): number => {
      const n = Math.min(eng.length, our.length);
      for (let i = 0; i < n; i++) {
        const [ox, oy] = swap ? [our[i]![1], our[i]![0]] : our[i]!;
        if (eng[i]![0] !== ox || eng[i]![1] !== oy) return i;
      }
      return eng.length === our.length ? -1 : n;
    };
    const straight = firstDiff(false);
    if (straight < 0) { listsSame++; continue; }
    const swapped = firstDiff(true);
    const at = swapped < 0 ? -1 : Math.max(straight, swapped);
    const orient = swapped < 0 || swapped > straight ? ' (transposed)' : '';
    const i = at;
    console.log(`  zone ${id} road 0x${kind.toString(16).padStart(2, '0')}: engine ${eng.length} tiles, ours ${our.length}`
      + (i < 0 ? `${orient} — identical` : `, part at tile ${i}: engine ${eng[i] ? `${eng[i]![0]},${eng[i]![1]}` : 'end'},`
        + ` ours ${our[i] ? `${our[i]![0]},${our[i]![1]}` : 'end'}${orient}`));
    if (swapped < 0) listsSame++;
  }
}
if (listsTotal) console.log(`  road lists: ${listsSame} of ${listsTotal} identical`);

// ---------------------------------------------------------------- the grids

function ourRows(name: Name, f: Snapshot): (r: number, c: number) => number | undefined {
  switch (name) {
    case 'zg': return (r, c) => f.grid[r]?.[c];
    case 'bd': return (r, c) => f.border[r]?.[c];
    case 'rm': return (r, c) => f.room[r]?.[c];
    case 'oc': return (r, c) => (r < size && c < size ? f.occ[r * size + c] : undefined);
  }
}

/** How many cells differ, under each orientation, plus where and by how much. */
function compare(name: Name, floor: number): void {
  const eng = dump[name]?.[floor];
  const f = floors[floor];
  if (!eng || !f) { console.log(`  ${name} floor ${floor}: not in the dump`); return; }
  const at = ourRows(name, f);
  const best = { orient: '', diffs: Number.POSITIVE_INFINITY, first: '', hist: new Map<number, number>() };
  for (const orient of ['rows are the FIRST index', 'rows are the SECOND index'] as const) {
    let diffs = 0, first = '';
    const hist = new Map<number, number>();
    for (let r = 0; r < size; r++) {
      for (let j = 0; j < size; j++) {
        const ev = eng[r]?.[j];
        const ov = orient === 'rows are the FIRST index' ? at(j, r) : at(r, j);
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
  console.log(`  ${name} floor ${floor}: ${best.diffs ? `${best.diffs} of ${total} cells differ` : `identical (${total} cells)`} — ${best.orient}`);
  if (best.first) console.log(`      first ${best.first}`);
  if (best.diffs) {
    const top = [...best.hist].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`      engine minus ours: ${top.map(([d, n]) => `${d > 0 ? '+' : ''}${d}×${n}`).join('  ')}`);
  }
}

for (let floor = 0; floor < floors.length; floor++) {
  for (const n of NAMES) if (dump[n]?.[floor]) compare(n, floor);
}
