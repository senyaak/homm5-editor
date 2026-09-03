// SEVERAL MAPS FROM THE ENGINE, one launch of the editor each.
//
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt
//   node tools/rmg-batch.ts --game <dir> --order "RMG/Templates/S1P2Z2M1.xdb -seed 1 -size 1"
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt --keep somewhere/else
//
// WHY A LOOP OUT HERE rather than a loop inside the extension, which is where
// it used to be and was faster. A launch's SECOND generation does not repeat
// what its first would have made alone: two identical orders in one process
// came out with different statics, their draw counters still agreeing at the
// border table, so state survives between generations inside the executable.
// The numbers it gave were plausible, stable and wrong — two rows of the
// `-size` table had to be re-measured. The extension now runs the first order
// of a file and reports the rest untouched; this writes a one-line file per
// order and starts the editor again, which is the same convenience with a
// fresh process under every map.
//
// Each order's documents land in `bin/rmg-batch/<n>/`, numbered in the order
// given, and `rmg-diff-map` takes such a folder directly. That is deliberately
// NOT `bin/rmg-runs`, which the extension owns and overwrites on every launch:
// keeping results in the slot they are written to means order two destroys
// order one.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const game = gameDir();
const bin = join(game, 'bin');
const editor = join(bin, 'H5_MapEditor_H5E.exe');
const ordersFile = join(bin, 'homm5-editor-rmg-orders.txt');
const runs = join(bin, 'rmg-runs');
const keep = resolve(flag('keep') ?? join(bin, 'rmg-batch'));

const orders: string[] = [];
const listed = flag('orders');
if (listed) {
  for (const line of readFileSync(listed, 'utf8').split(/\r?\n/)) {
    const order = line.trim();
    if (order && !order.startsWith('#')) orders.push(order);
  }
}
for (let i = 0; i < args.length; i++) if (args[i] === '--order' && args[i + 1]) orders.push(args[i + 1]!);

if (!orders.length) {
  console.error('nothing to order: --orders <file> or --order "<one order>"');
  process.exit(2);
}
if (!existsSync(editor)) {
  console.error(`no ${editor} — install the extension first (tools/install-native.ts --editor)`);
  process.exit(2);
}

mkdirSync(keep, { recursive: true });
console.log(`${orders.length} order(s), one launch each`);

let made = 0;
for (const [i, order] of orders.entries()) {
  process.stdout.write(`  ${i + 1}. ${order} … `);
  rmSync(join(runs, '1'), { recursive: true, force: true });
  writeFileSync(ordersFile, `# written by tools/rmg-batch.ts — one launch, one order\n${order}\n`, 'latin1');
  // A LAUNCH IS ALLOWED TO DIE. An order can crash the editor — a bad `-poke`
  // will — and one dead launch must not take the rest of the list with it.
  try {
    execFileSync(editor, ['--rmg'], { cwd: bin, stdio: 'ignore' });
  } catch {
    console.log('the editor did not come back — read bin/homm5-editor-rmg.log');
    continue;
  }
  const one = join(runs, '1');
  if (!existsSync(one)) {
    console.log('the engine kept nothing — read bin/homm5-editor-rmg.log');
    continue;
  }
  const into = join(keep, String(i + 1));
  rmSync(into, { recursive: true, force: true });
  renameSync(one, into);
  made++;
  console.log(into);
}

console.log(`${made} of ${orders.length} generated`);
