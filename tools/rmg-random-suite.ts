// A RANDOM SUITE FOR THE PORT: a few orders a size, every input drawn, the
// engine generates them, the port replays them, and the verdict is written
// down next to the maps.
//
//   node tools/rmg-random-suite.ts --game <dir>                    3 a size, a fresh suite seed
//   node tools/rmg-random-suite.ts --game <dir> --per-size 5
//   node tools/rmg-random-suite.ts --game <dir> --suite-seed 1234  the same orders again
//   node tools/rmg-random-suite.ts --game <dir> --keep <dir> --diff-only   re-judge maps already made
//   node tools/rmg-random-suite.ts --game <dir> --dry               write the orders, order nothing
//
// WHY, WHEN THE MATRIX ALREADY PASSES. Every block of the matrix was designed:
// three fixed seeds, one axis moved at a time. This suite is the opposite —
// the seed, the template, the floors, the players, the water, the monster
// level, both multipliers and both checkboxes are all drawn, and a run never
// repeats the last one's orders unless asked to (`--suite-seed`). It is the
// check the matrix cannot be: inputs nobody chose.
//
// THE INPUT SPACE IS THE DIALOG'S, not "anything the console takes". A size
// index of the ladder minus its last rung (IMPOSSIBLE — the engine's own
// generator aborts on some of those orders, and a suite that dies there says
// nothing about the rest); a template the dialog would OFFER for that size —
// its `[MinMapSize, MaxMapSize]` holds the size's units, or with an
// underground holds twice them and `MaxMapSize >= 10` (`0xCF7B58`, the
// dialog's filter, read in docs/RMG.md); players within the template's range;
// water as the checkbox records it (WATER_ISLAND_MAP, 2) or none.
//
// Every run keeps its own folder — `_tmp/to_check_maps_new/<stamp>/` unless
// `--keep` says otherwise — with `orders.txt` (the suite seed in its header,
// so the run is reproducible), one slot a map exactly as `rmg-batch` leaves
// it, `diff/<n>.txt` with the whole comparison, and `diff.txt`, the verdict.
// The batch runs ALONE and the diffs come after it: replays beside the editor
// have made the generator abort (docs/RMG.md, block C).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { dialogChoices, templatesOffered } from '../src/rmg/index.ts';
import { gameDir, gameInstall } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const game = gameDir();
const repo = resolve(import.meta.dirname, '..');
const perSize = Number(flag('per-size') ?? 3);
const diffOnly = args.includes('--diff-only');
const timeout = flag('timeout') ?? '900';

// The suite's own seed: said, or taken from the clock and WRITTEN DOWN. A
// run that cannot be repeated is a rumour.
const suiteSeed = Number(flag('suite-seed') ?? (Date.now() % 2147483647));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/T(\d{4})\d{2}\..*$/, '-$1');
const keep = resolve(flag('keep') ?? join(repo, '_tmp', 'to_check_maps_new', stamp));
const ordersFile = join(keep, 'orders.txt');

// mulberry32 — a small seeded generator for the SUITE's choices. Not the
// engine's: the maps' own seeds are drawn from this and handed to the engine.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  size: number;
  underground: boolean;
  template: string;
  seed: number;
  players: number;
  water: number;
  monsters: number;
  resource: number;
  exp: number;
  randomTowns: boolean;
  grail: boolean;
}

function orderLine(d: Draft): string {
  return `RMG/Templates/${d.template}.xdb -seed ${d.seed} -size ${d.size} -players ${d.players}`
    + ` -underground ${d.underground ? 1 : 0}${d.water ? ` -water ${d.water}` : ''}`
    + ` -monsters ${d.monsters} -resource ${d.resource} -exp ${d.exp}`
    // The two checkboxes have no word of their own; `-pokeb` writes the field
    // (`+0x95` random towns, `+0xA5` the grail — docs/RMG.md).
    + `${d.randomTowns ? ' -pokeb 149 1' : ''}${d.grail ? ' -pokeb 165 1' : ''}`;
}

function draftOrders(): { lines: string[]; drafts: Draft[] } {
  const install = gameInstall();
  const choices = dialogChoices(install);
  const rng = mulberry32(suiteSeed);
  const below = (n: number): number => Math.floor(rng() * n);
  const coin = (): boolean => below(2) === 1;

  // The dialog's own filter, through the generator's door — a mod's
  // templates are in the list too.
  const sizes = choices.sizes.length - 1; // the last rung is IMPOSSIBLE
  const drafts: Draft[] = [];
  for (let size = 0; size < sizes; size++) {
    for (let k = 0; k < perSize; k++) {
      let underground = coin();
      let pool = templatesOffered(install, size, underground);
      if (!pool.length) { underground = !underground; pool = templatesOffered(install, size, underground); }
      if (!pool.length) throw new Error(`no template fits size ${size} (${choices.sizes[size]!.name}) — the ladder or the templates changed`);
      const t = pool[below(pool.length)]!;
      drafts.push({
        size, underground, template: t.file,
        seed: 1 + below(2147483646),
        players: t.minPlayers + below(t.maxPlayers - t.minPlayers + 1),
        water: coin() ? 2 : 0,
        monsters: below(choices.monsterLevels.length),
        resource: below(choices.resourceMultipliers.length),
        exp: below(choices.expMultipliers.length),
        randomTowns: coin(),
        grail: coin(),
      });
    }
  }
  const lines = [
    `# random suite — suite seed ${suiteSeed}, ${perSize} a size, ${new Date().toISOString()}`,
    `# sizes 0..${sizes - 1} (${choices.sizes.slice(0, sizes).map((s) => s.name).join(' ')})`,
    ...drafts.map(orderLine),
  ];
  return { lines, drafts };
}

/** One child, its output on our stdout AND appended to a file. */
function run(cmd: string, argv: string[], log: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn(cmd, argv, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    const tee = (d: Buffer): void => { process.stdout.write(d); writeFileSync(log, d, { flag: 'a' }); };
    child.stdout.on('data', tee);
    child.stderr.on('data', tee);
    child.on('exit', (code) => done(code ?? 1));
  });
}

mkdirSync(keep, { recursive: true });

let orders: string[];
if (diffOnly) {
  if (!existsSync(ordersFile)) { console.error(`${ordersFile} is not there — nothing to judge`); process.exit(2); }
  orders = readFileSync(ordersFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
} else {
  if (existsSync(ordersFile)) { console.error(`${ordersFile} exists — a suite does not overwrite a run; pick another --keep or add --diff-only`); process.exit(2); }
  const { lines, drafts } = draftOrders();
  orders = drafts.map(orderLine);
  writeFileSync(ordersFile, `${lines.join('\n')}\n`, 'latin1');
  console.log(`suite seed ${suiteSeed}: ${orders.length} orders in ${ordersFile}`);
  for (const [i, o] of orders.entries()) console.log(`  ${i + 1}. ${o}`);
  // `--dry`: the orders alone, to read before an evening is spent on them.
  if (args.includes('--dry')) process.exit(0);

  // THE ENGINE, ALONE.
  const code = await run(process.execPath, [join(repo, 'tools', 'rmg-batch.ts'), '--game', game,
    '--orders', ordersFile, '--keep', keep, '--timeout', timeout, '--resume'], join(keep, 'batch.log'));
  console.log(`batch exit ${code}`);
}

// THE PORT, AFTER IT.
mkdirSync(join(keep, 'diff'), { recursive: true });
const verdicts: string[] = [];
let identical = 0;
let missing = 0;
for (let i = 1; i <= orders.length; i++) {
  const slot = join(keep, String(i));
  if (!existsSync(join(slot, 'map.xdb'))) {
    missing++;
    verdicts.push(`${i}: NO MAP — the engine kept nothing (read ${i}.log)`);
    continue;
  }
  const r = spawnSync(process.execPath, [join(repo, 'tools', 'rmg-diff-map.ts'), '--game', game, slot],
    { cwd: repo, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  writeFileSync(join(keep, 'diff', `${i}.txt`), out);
  const summary = out.split(/\r?\n/).filter((l) => /of \d+ entries|NOT ONE|differ|rror/.test(l)).join('; ');
  const m = /(\d+) of (\d+) entries byte-identical/.exec(out);
  if (m && m[1] === m[2]) identical++;
  verdicts.push(`${i}: ${summary || `exit ${r.status}`}`);
  console.log(`  ${verdicts[verdicts.length - 1]}`);
}
const total = orders.length;
const line = `${identical} of ${total} byte-identical${missing ? `, ${missing} not made` : ''} — suite seed ${suiteSeed}`;
writeFileSync(join(keep, 'diff.txt'), `${verdicts.join('\n')}\n${line}\nDONE\n`);
console.log(line);
process.exit(identical === total ? 0 : 1);
