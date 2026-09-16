// SEVERAL MAPS FROM THE ENGINE, one launch of the editor each.
//
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt
//   node tools/rmg-batch.ts --game <dir> --order "RMG/Templates/S1P2Z2M1.xdb -seed 1 -size 1"
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt --keep somewhere/else
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt --timeout 120
//   node tools/rmg-batch.ts --game <dir> --orders orders.txt --resume   (skip the slots already made)
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
//
// The oracle's log goes with each map, as `<keep>/<n>.log` beside the slot
// (not inside it — the slot is compared file for file). Without `trace` it is
// the `step` counters and the probes' lines, a few kilobytes, and it is the
// first thing a diverging map needs: which step's counter parted from the
// port's. Block C's tenth order was the one that had to be re-ordered for it.
//
// The extension APPENDS to that log — one file holds every launch since it
// was last deleted, 348 of them and 167 MB when this was noticed, and the
// first copies carried all of it, once a slot (11 GB for block B). So the
// log is emptied before each launch: what a slot keeps is its own run, and
// the previous run is already in the previous slot.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
// A LAUNCH GETS A CLOCK. The editor makes a Direct3D device before it reads
// the console command, and anything that takes the display away from it —
// another game going fullscreen, a driver reset — leaves it alive, not
// responding, and never returning. Without a timeout the batch waits on that
// forever; worse, the run after it reads the PREVIOUS launch's log and folder
// and reports a comparison that never happened. Ten minutes is far past the
// slowest honest order (a 256-tile map is about two).
const timeout = Number(flag('timeout') ?? 600) * 1000;

/**
 * One launch of the editor: resolves with null when it exits on its own, or
 * with a sentence when it was killed — by the timeout, or by the watcher
 * (`rmg-batch-watch.ps1`) because its top window became the CRT's abort box.
 * The frame is NOT hidden — the extension waits for the visible window
 * before it orders anything, and a hidden one hung every launch; see the
 * watcher's header.
 */
function launch(exe: string, cwd: string, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(exe, ['--rmg'], { cwd, stdio: 'ignore' });
    let verdict: string | null = null;
    const kill = (why: string): void => {
      if (verdict) return;
      verdict = why;
      child.kill('SIGKILL');
    };
    const watcher = child.pid === undefined ? null : spawn('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'rmg-batch-watch.ps1'),
        '-ProcessId', String(child.pid)],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    watcher?.stdout.on('data', (d: Buffer) => {
      if (/aborted/.test(d.toString())) verdict ??= 'the generator aborted (the CRT box was up)';
    });
    const clock = setTimeout(() => kill('the editor did not come back'), ms);
    child.on('exit', () => { clearTimeout(clock); watcher?.kill(); resolve(verdict); });
    child.on('error', () => { clearTimeout(clock); watcher?.kill(); resolve(verdict ?? 'the editor could not be started'); });
  });
}

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
// `--resume`: a slot that already holds a map is not ordered again, so a list
// interrupted at order 80 — or one whose dead launches are being re-tried —
// picks up where it stopped and keeps its numbering.
const resume = args.includes('--resume');
for (const [i, order] of orders.entries()) {
  if (resume && existsSync(join(keep, String(i + 1), 'map.xdb'))) { made++; continue; }
  process.stdout.write(`  ${i + 1}. ${order} … `);
  rmSync(join(runs, '1'), { recursive: true, force: true });
  // The kept slot goes with it: a launch that dies must not leave the PREVIOUS
  // order's documents where the next reader looks for this one's.
  rmSync(join(keep, String(i + 1)), { recursive: true, force: true });
  writeFileSync(ordersFile, `# written by tools/rmg-batch.ts — one launch, one order\n${order}\n`, 'latin1');
  writeFileSync(join(bin, 'homm5-editor-rmg.log'), '');
  // A LAUNCH IS ALLOWED TO DIE. An order can crash the editor — a bad `-poke`
  // will, and so does the generator itself on some IMPOSSIBLE-size orders —
  // and one dead launch must not take the rest of the list with it.
  //
  // AND IT MUST DIE QUIETLY. The CRT's abort() puts up "Microsoft Visual C++
  // Runtime Library" and waits for OK, which nobody at the keyboard signed
  // up for: the batch is meant to show nothing, and block C's sweep put that
  // box on the user's screen for fifteen minutes an order, five orders in a
  // row, until the timeout killed each one. So the launch is watched, and a
  // process whose top window is that box is killed the moment it appears —
  // the map it was making is lost either way.
  const died = await launch(editor, bin, timeout);
  if (died) {
    console.log(`${died} — read bin/homm5-editor-rmg.log`);
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
  const log = join(bin, 'homm5-editor-rmg.log');
  if (existsSync(log)) copyFileSync(log, `${into}.log`);
  made++;
  console.log(into);
}

console.log(`${made} of ${orders.length} generated`);
