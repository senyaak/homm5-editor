// The machine-wide run queue (tools/run-queue.ts): one run at a time, in the
// order the runs asked, nobody stuck behind a run that is gone.
//
// Each check starts real processes against a queue folder of its own, so it
// says something about processes and files, not about one process's memory.
//   1. Three runs, started a beat apart, never overlap and go in start order.
//   2. A ticket left by a process that no longer exists is removed, and the
//      next run does not wait for it.
//   3. A run started by the holder (HOMM5_RUN_QUEUE_HELD) does not queue
//      behind its own parent.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOLD_MS = 1500;
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const dir = mkdtempSync(join(tmpdir(), 'h5e-run-queue-'));
const queue = join(dir, 'queue');
const record = join(dir, 'record.txt');
writeFileSync(record, '');

const moduleUrl = new URL('./run-queue.ts', import.meta.url).href;
const child = (label: string, env: NodeJS.ProcessEnv = {}): Promise<number> => {
  const code = `
    import { appendFileSync } from 'node:fs';
    const { enterRunQueue } = await import(${JSON.stringify(moduleUrl)});
    const leave = await enterRunQueue(${JSON.stringify(label)});
    appendFileSync(${JSON.stringify(record)}, 'enter ${label} ' + Date.now() + '\\n');
    await new Promise((d) => setTimeout(d, ${HOLD_MS}));
    appendFileSync(${JSON.stringify(record)}, 'leave ${label} ' + Date.now() + '\\n');
    leave();
  `;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, HOMM5_RUN_QUEUE: queue, HOMM5_RUN_QUEUE_HELD: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  p.stdout.on('data', () => {});
  return new Promise((done) => p.on('close', (c) => done(c ?? 1)));
};
const pause = (ms: number): Promise<void> => new Promise((d) => setTimeout(d, ms));
const events = (): Array<{ kind: string; label: string; at: number }> =>
  readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const [kind, label, at] = l.split(' ');
    return { kind: kind!, label: label!, at: Number(at) };
  });

const watchdog = setTimeout(() => { console.log('FAIL hung'); process.exit(1); }, 60_000);

// 1. Three runs in order, no overlap.
{
  const runs = [child('a')];
  await pause(300);
  runs.push(child('b'));
  await pause(300);
  runs.push(child('c'));
  const codes = await Promise.all(runs);
  check(codes.every((c) => c === 0), 'three queued runs all exit 0');
  const ev = events();
  check(ev.map((e) => `${e.kind}-${e.label}`).join(',') === 'enter-a,leave-a,enter-b,leave-b,enter-c,leave-c',
    `they go one at a time, in start order (${ev.map((e) => `${e.kind}-${e.label}`).join(',')})`);
}

// 2. A dead holder's ticket is cleared.
{
  writeFileSync(record, '');
  const dead = 999_999;
  writeFileSync(join(queue, `${'1'.padStart(15, '0')}-${dead}-0.json`),
    JSON.stringify({ pid: dead, checkout: 'nowhere', label: 'gone', since: Date.now() }));
  const started = Date.now();
  check(await child('d') === 0, 'a run behind a dead ticket exits 0');
  check(Date.now() - started < HOLD_MS + 8000, 'and did not wait for it');
}

// 3. A run started by the holder does not queue behind it.
{
  writeFileSync(record, '');
  const parent = join(queue, `${'2'.padStart(15, '0')}-${process.pid}-0.json`);
  writeFileSync(parent, JSON.stringify({ pid: process.pid, checkout: 'here', label: 'parent', since: Date.now() }));
  const started = Date.now();
  check(await child('e', { HOMM5_RUN_QUEUE_HELD: parent }) === 0, 'a child of the holder exits 0');
  check(Date.now() - started < HOLD_MS + 8000, 'without waiting behind its parent');
  const other = child('f');
  await pause(HOLD_MS + 2500);
  check(!events().some((e) => e.label === 'f'), 'while an unrelated run still waits behind the holder');
  rmSync(parent, { force: true });
  check(await other === 0, 'and goes once the holder leaves');
}

clearTimeout(watchdog);
rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.log(`\ntest-run-queue: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\ntest-run-queue: all good');
