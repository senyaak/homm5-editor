// The test matrix: which orders to put to the engine, and the two tables the
// choice rests on.
//
//   node tools/rmg-matrix.ts tables                    both tables, as markdown
//   node tools/rmg-matrix.ts orders A                  one block, as an orders file
//   node tools/rmg-matrix.ts orders A B > orders.txt   several
//   node tools/rmg-matrix.ts orders all --seeds 3
//
// WHY A GENERATOR AND NOT A LIST. The orders are a product of the templates'
// own numbers — a template's `MinMapSize` decides which sizes are even
// reachable, and its `MinPlayers`/`MaxPlayers` which player counts are — so a
// hand-written list would go stale the moment the data does. `tables` prints
// what the choice was made from, and `orders` prints the orders themselves, in
// the form `tools/rmg-batch.ts --orders` reads.
//
// THE BLOCKS, and what each is for. The parameters split in two: those that
// change the map's SHAPE (template, size, players, underground, water) have to
// be swept per template, and those that only SCALE its contents (monsters,
// resource, exp) reach the same code on every template and are swept once.
//
//   A  every template, its smallest reachable size, one floor      — the floor
//   B  every template, two floors                                  — the carve, two zones a floor
//   C  every template, one size up and the largest                  — the size fit
//   D  every template, water 1 and water 2                          — the sea and the islands
//   E  players: min and max, on the templates whose range is wider than one
//   F  monsters 0..4, resource 0..4, exp 0..4 on two templates      — the multipliers
//
// A block times `--seeds` (three by default) is its run count; `tables` prints
// the totals so the cost is known before the editor is started.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SIZE_UNITS } from '../src/rmg/create-map.ts';
import { readTemplate } from '../src/rmg/template.ts';
import type { RmgTemplate } from '../src/rmg/template.ts';
import { MULTIPLIERS, SIZE_NAMES } from './rmg-order.ts';
import { MAP_SIZES } from './rmg-build.ts';
import { dataDir } from './game-dir.ts';

/** The three seeds every row is run with — arbitrary, fixed, and not 0. */
const SEEDS = [1001, 2002, 3003];

const WATER_NAMES = ['WATER_NONE', 'WATER_PRESENT', 'WATER_ISLAND_MAP'] as const;
const MONSTER_NAMES = ['WEAK', 'MEDIUM', 'STRONG', 'VERY_STRONG', 'IMPOSSIBLE'] as const;

interface Entry { name: string; t: RmgTemplate }

function templates(): Entry[] {
  const dir = join(dataDir(), 'RMG', 'Templates');
  const out: Entry[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.xdb')) continue;
    const path = join(dir, f);
    if (!statSync(path).isFile()) continue;
    out.push({ name: f.replace(/\.xdb$/, ''), t: readTemplate(path) });
  }
  return out;
}

/**
 * The smallest `-size` index this template can be ordered at on `floors`
 * floors — the fit at `0xEAB616`, which multiplies the size's UNITS by the
 * floor count and lifts anything under `MinMapSize`. Ordering below it is
 * legal; the engine simply raises it, so the matrix names the fit's own answer
 * and a row means what it says.
 */
function smallestSize(t: RmgTemplate, floors: number): number {
  for (let i = 0; i < SIZE_UNITS.length; i++) if (SIZE_UNITS[i]! * floors >= t.minMapSize) return i;
  return SIZE_UNITS.length - 1;
}

/**
 * `CanBeWater` is false in every zone of every shipped template — checked, not
 * assumed — so it is NOT the gate on `-water`: the water order floods a zone
 * the setup picks, and the water reference is an ordinary template ordered with
 * `-water 2`. Block D therefore sweeps water over every template, and this is
 * kept as the record of why there is nothing to filter on.
 */
const holdsWater = (_t: RmgTemplate): boolean => true;

// --------------------------------------------------------------- the tables

function tables(): void {
  const list = templates();
  console.log('### The templates, and what an order may say to each\n');
  const head = ['template', 'zones', 'players', 'MinMapSize', 'smallest, 1 floor', 'smallest, 2 floors'];
  const rows = list.map(({ name, t }) => [
    name, String(t.zones.length), `${t.minPlayers}..${t.maxPlayers}`, String(t.minMapSize),
    `${MAP_SIZES[smallestSize(t, 1)]}`, `${MAP_SIZES[smallestSize(t, 2)]}`,
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]): string => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(' | ')} |`;
  console.log(line(head));
  console.log(`|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`);
  for (const r of rows) console.log(line(r));

  console.log('\n### The parameters, and the values each takes\n');
  const p = [
    ['template', 'the order\'s first word', `${list.length} shipped, as a path under RMG/Templates`],
    ['seed', '-seed', 'any int32 but 0 — the dialog draws it, the console may name it'],
    ['size', '-size', `0..6 = ${MAP_SIZES.join(', ')} (${SIZE_NAMES.map((s) => s.replace('MAP_SIZE_', '')).join('/')}), lifted by the fit`],
    ['players', '-players', 'the template\'s MinPlayers..MaxPlayers, clamped again by the map'],
    ['underground', '-underground', '0 or 1 — the ORDER decides the second floor, never the template'],
    ['water', '-water', `0..2 = ${WATER_NAMES.join(', ')}`],
    ['monsters', '-monsters', `0..4 = ${MONSTER_NAMES.join(', ')}`],
    ['resource', '-resource', `0..4 = ${MULTIPLIERS.join(', ')}`],
    ['exp', '-exp', `0..4 = ${MULTIPLIERS.join(', ')}`],
    ['random towns', 'dialog only', 'on/off — the port takes each player\'s race from the template'],
    ['grail', 'dialog only', 'on/off — the port places none'],
  ];
  const ph = ['parameter', 'how an order says it', 'values'];
  const pw = ph.map((h, i) => Math.max(h.length, ...p.map((r) => r[i]!.length)));
  const pline = (r: string[]): string => `| ${r.map((c, i) => c.padEnd(pw[i]!)).join(' | ')} |`;
  console.log(pline(ph));
  console.log(`|${pw.map((n) => '-'.repeat(n + 2)).join('|')}|`);
  for (const r of p) console.log(pline(r));

  console.log('\n### The blocks, and what each costs\n');
  let total = 0;
  for (const b of BLOCKS) {
    const n = rows_of(b.key, list).length * seeds.length;
    total += n;
    console.log(`  ${b.key}  ${String(n).padStart(4)} runs — ${b.what}`);
  }
  console.log(`  ${'='.padEnd(2)}  ${String(total).padStart(4)} runs in all (rows x ${seeds.length} seeds), one editor launch each`);
}

// --------------------------------------------------------------- the orders

interface Row { template: string; size: number; players: number; underground: number; water: number; monsters: number; resource: number; exp: number }

const base = (name: string, t: RmgTemplate, floors: number): Row => ({
  template: name, size: smallestSize(t, floors), players: t.minPlayers,
  underground: floors === 2 ? 1 : 0, water: 0, monsters: 1, resource: 2, exp: 2,
});

const BLOCKS = [
  { key: 'A', what: 'every template, smallest size, one floor' },
  { key: 'B', what: 'every template, two floors' },
  { key: 'C', what: 'every template, one size up and the largest' },
  { key: 'D', what: 'water 1 and 2, every template' },
  { key: 'E', what: 'players min and max, where the range is wider than one' },
  { key: 'F', what: 'monsters, resource and exp across all five rungs, two templates' },
] as const;

function rows_of(key: string, list: Entry[]): Row[] {
  const out: Row[] = [];
  for (const { name, t } of list) {
    if (key === 'A') out.push(base(name, t, 1));
    if (key === 'B') out.push(base(name, t, 2));
    if (key === 'C') {
      const smallest = smallestSize(t, 1);
      if (smallest + 1 < MAP_SIZES.length) out.push({ ...base(name, t, 1), size: smallest + 1 });
      if (smallest + 1 < MAP_SIZES.length - 1) out.push({ ...base(name, t, 1), size: MAP_SIZES.length - 1 });
    }
    if (key === 'D' && holdsWater(t)) {
      out.push({ ...base(name, t, 1), water: 1 });
      out.push({ ...base(name, t, 1), water: 2 });
    }
    if (key === 'E' && t.maxPlayers > t.minPlayers) {
      out.push({ ...base(name, t, 1), players: t.maxPlayers });
    }
    if (key === 'F' && (name === 'S1P2Z2M1' || name === 'S1-2P2-8Z8K2S')) {
      for (let v = 0; v < 5; v++) {
        if (v !== 1) out.push({ ...base(name, t, 1), monsters: v });
        if (v !== 2) out.push({ ...base(name, t, 1), resource: v });
        if (v !== 2) out.push({ ...base(name, t, 1), exp: v });
      }
    }
  }
  return out;
}

const order = (r: Row, seed: number): string =>
  `RMG/Templates/${r.template}.xdb -seed ${seed} -size ${r.size} -players ${r.players}`
  + ` -underground ${r.underground} -water ${r.water} -monsters ${r.monsters}`
  + ` -resource ${r.resource} -exp ${r.exp}`;

// --------------------------------------------------------------- the driver

const args = process.argv.slice(2);
const command = args[0] ?? 'tables';
const seedsFlag = Number(args[args.indexOf('--seeds') + 1]);
const seeds = args.includes('--seeds') && seedsFlag > 0 ? SEEDS.slice(0, seedsFlag) : SEEDS;

if (command === 'tables') {
  tables();
} else if (command === 'orders') {
  const list = templates();
  const keys = args.slice(1).filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--seeds');
  const wanted = keys.includes('all') || !keys.length ? BLOCKS.map((b) => b.key) : keys;
  for (const key of wanted) {
    const rows = rows_of(key, list);
    if (!rows.length) { console.error(`no such block: ${key}`); process.exit(2); }
    console.log(`# block ${key} — ${BLOCKS.find((b) => b.key === key)?.what}`);
    for (const r of rows) for (const s of seeds) console.log(order(r, s));
  }
} else {
  console.error('node tools/rmg-matrix.ts tables | orders <A..F|all> [--seeds n]');
  process.exit(2);
}
