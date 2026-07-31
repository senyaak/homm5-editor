// Watches an open map folder for edits made outside this editor.
//
// The original Nival editor and this one can be pointed at the same map folder
// at once, and people do exactly that: sculpt terrain there, place objects here.
// Whoever saves last wins, silently, and the other side keeps working from a
// stale model. So we watch the folder and say when the files underneath us move.
//
// Two things make this less trivial than an fs.watch call:
//
//   * Our own saves touch the same files. The watcher therefore compares content
//     hashes against a snapshot, and `resync()` refreshes that snapshot right
//     after we write — so a save of ours is never reported back to us.
//   * Editors write in bursts (temp file, rename, several files in a row) and
//     fs.watch on Windows coalesces and duplicates events unpredictably. Rather
//     than reason about individual events, any event schedules a full rescan
//     after a quiet period; the rescan is the source of truth. A map folder is
//     a few dozen small files, so hashing all of it costs a couple of ms.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** What changed in the folder since the last snapshot. Paths are posix-style, relative to the watched dir. */
export interface DirChange {
  /** Files that exist in both snapshots with different content. */
  changed: string[];
  added: string[];
  removed: string[];
}

/** A running watch. Stop it when the map closes, or the handle leaks a native watcher. */
export interface MapWatch {
  /** Take a fresh snapshot without reporting anything — call after our own writes. */
  resync(): void;
  /** Compare the folder against the snapshot right now, without waiting for an event. */
  poll(): DirChange | null;
  stop(): void;
}

export interface WatchOptions {
  /** Quiet period before a rescan, in ms. Long enough to let a multi-file save finish. */
  debounceMs?: number;
}

/** Files we ignore: our own project manifest, and editor scratch. */
const IGNORE = /(^|\/)(project\.json|.*\.tmp|.*~|Thumbs\.db)$/i;

type Snapshot = Map<string, string>;

function hashFile(path: string): string | null {
  try {
    return createHash('sha1').update(readFileSync(path)).digest('hex');
  } catch {
    // Mid-write the file may be locked or briefly gone; the next rescan sees it.
    return null;
  }
}

/** Hash every file under `dir`, keyed by posix-relative path. */
function snapshot(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (cur: string): void => {
    let ents: string[];
    try { ents = readdirSync(cur); } catch { return; }
    for (const e of ents) {
      const full = join(cur, e);
      let dirent;
      try { dirent = statSync(full); } catch { continue; }
      if (dirent.isDirectory()) { walk(full); continue; }
      const rel = relative(dir, full).split(sep).join('/');
      if (IGNORE.test(rel)) continue;
      const h = hashFile(full);
      if (h !== null) out.set(rel, h);
    }
  };
  walk(dir);
  return out;
}

function diff(before: Snapshot, after: Snapshot): DirChange | null {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [rel, h] of after) {
    const old = before.get(rel);
    if (old === undefined) added.push(rel);
    else if (old !== h) changed.push(rel);
  }
  for (const rel of before.keys()) if (!after.has(rel)) removed.push(rel);
  if (!changed.length && !added.length && !removed.length) return null;
  changed.sort(); added.sort(); removed.sort();
  return { changed, added, removed };
}

/**
 * Watch `dir` and call `onChange` when its contents differ from the snapshot.
 *
 * `onChange` fires once per settled burst of edits. The snapshot advances with
 * every report, so a folder that keeps changing keeps reporting — but the same
 * unchanged state is never reported twice.
 */
export function watchMapDir(dir: string, onChange: (c: DirChange) => void, opts: WatchOptions = {}): MapWatch {
  const debounceMs = opts.debounceMs ?? 400;
  let snap = snapshot(dir);
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const rescan = (): DirChange | null => {
    const next = snapshot(dir);
    const d = diff(snap, next);
    snap = next;
    return d;
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const d = rescan();
      if (d) onChange(d);
    }, debounceMs);
  };

  let watcher: FSWatcher | null = null;
  try {
    // Recursive watching is supported on Windows and macOS. On Linux it throws,
    // and we fall back to polling — the folder is small enough that a 2s scan
    // is cheap, and a missed notification is worse than a little CPU.
    watcher = watch(dir, { recursive: true }, schedule);
  } catch {
    watcher = null;
  }
  const poller = watcher ? null : setInterval(schedule, 2000);

  return {
    resync(): void {
      if (timer) { clearTimeout(timer); timer = null; }
      snap = snapshot(dir);
    },
    poll(): DirChange | null {
      return stopped ? null : rescan();
    },
    stop(): void {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (poller) clearInterval(poller);
      watcher?.close();
    },
  };
}
