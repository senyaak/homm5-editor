// One test run at a time on this machine, in the order they asked.
//
// A full run and every e2e run launch Electron with a 3D scene, and the specs'
// timeouts are short on purpose; two of them side by side starve each other
// into false reds, and several checkouts (the fleet's slots, the main one) share
// one machine. So `npm test`, its levels, every e2e runner and a bare
// `playwright test` stand in ONE queue, kept outside every checkout:
//
//   %LOCALAPPDATA%/homm5-editor/run-queue/      (HOMM5_RUN_QUEUE overrides)
//     <time>-<pid>-<n>.json                     one ticket per waiting run
//
// The oldest ticket whose process is alive runs; the rest wait inside Node, so
// a caller never needs a shell sleep. A ticket whose process is gone, or that
// has been at the front past STALE_MINUTES, is removed with a line saying so.
// A run started BY a ticket holder (npm test starting its e2e half) inherits
// HOMM5_RUN_QUEUE_HELD and does not queue behind itself.
//
// A single unit suite (`node tools/test-x.ts`) does not queue: seconds, no window.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Longer than the longest run there is (the release gate's C1M1 half). */
const STALE_MINUTES = 120;
const POLL_MS = 2000;
const SAY_EVERY_MS = 60_000;

export const HELD_ENV = 'HOMM5_RUN_QUEUE_HELD';

interface Ticket {
  pid: number;
  checkout: string;
  label: string;
  since: number;
}

export function queueDir(): string {
  return process.env.HOMM5_RUN_QUEUE
    ?? join(process.env.LOCALAPPDATA ?? tmpdir(), 'homm5-editor', 'run-queue');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function read(path: string): Ticket | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Ticket;
  } catch {
    return null;
  }
}

let serial = 0;

/**
 * Take a place in the queue and wait until it is this run's turn. Answers with
 * the function that leaves the queue; leaving also happens on exit by itself.
 * `signals: false` leaves Ctrl-C to a process that has its own (Playwright).
 */
export async function enterRunQueue(label: string, { signals = true } = {}): Promise<() => void> {
  const held = process.env[HELD_ENV];
  if (held) {
    const t = read(held);
    if (t && alive(t.pid)) return () => {};
  }
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });
  const name = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${serial++}.json`;
  const mine = join(dir, name);
  const ticket: Ticket = { pid: process.pid, checkout: resolve(import.meta.dirname, '..'), label, since: Date.now() };
  writeFileSync(mine, JSON.stringify(ticket));

  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    rmSync(mine, { force: true });
  };
  process.on('exit', leave);
  if (signals) {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
      process.once(signal, () => { leave(); process.exit(130); });
    }
  }

  let said = 0;
  for (;;) {
    const ahead = readdirSync(dir).filter((f) => f.endsWith('.json') && f < name).sort();
    let first: Ticket | null = null;
    for (const f of ahead) {
      const path = join(dir, f);
      const t = read(path);
      if (!t) continue;
      if (!alive(t.pid)) {
        console.log(`[run-queue] removing the ticket of a run that is gone: ${t.label} in ${t.checkout} (pid ${t.pid})`);
        rmSync(path, { force: true });
        continue;
      }
      if (!first && Date.now() - t.since > STALE_MINUTES * 60_000) {
        console.log(`[run-queue] removing a ticket older than ${STALE_MINUTES} min: ${t.label} in ${t.checkout} (pid ${t.pid})`);
        rmSync(path, { force: true });
        continue;
      }
      first ??= t;
    }
    if (!first) break;
    if (Date.now() - said >= SAY_EVERY_MS) {
      const minutes = Math.round((Date.now() - first.since) / 60_000);
      console.log(`[run-queue] waiting behind ${first.label} in ${first.checkout} (${minutes} min in the queue)`);
      said = Date.now();
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
  process.env[HELD_ENV] = mine;
  console.log(`[run-queue] ${label}: this run's turn`);
  return leave;
}
