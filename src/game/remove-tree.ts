// Removing a folder tree on Windows, where a delete is a promise.
//
// A Windows delete marks the entry and finishes when the last handle closes,
// so a folder whose files were just unlinked can refuse to go for a moment —
// EPERM or ENOTEMPTY — with nothing of ours holding it. Node's `rmSync` used
// to retry that in its own JavaScript (`maxRetries`); the newer C++ one under
// Electron's Node throws through it, and the map that opens into a folder
// that already exists died with "EPERM, Permission denied: \\?\…" on a
// workspace whose files it had just removed (16.09, pack-roundtrip on a
// workspace left by July). The retry lives here instead.

import { rmSync } from 'node:fs';

/** The reasons Windows gives for "not yet": a pending delete, a handle still closing. */
const LATER = new Set(['EPERM', 'ENOTEMPTY', 'EBUSY']);

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** `rmSync(dir, { recursive, force })`, and again when Windows says not yet — up to about a second. */
export function removeTree(dir: string, tries = 10, delayMs = 100): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (attempt >= tries || !LATER.has(code)) throw e;
      pause(delayMs);
    }
  }
}
