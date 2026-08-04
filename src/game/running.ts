// Is our build of the game open right now — asked of the files, not the process
// list.
//
// WHY IT HAS TO BE ASKED. Everything this editor installs is written into
// `bin`: the executable's ceilings, the import that loads the extension, the
// extension itself. Windows will not let any of those be replaced while the
// game holds them open, and what comes back is `EBUSY` on a rename — a sentence
// about a temporary file with a `.new` suffix, from a button that said
// "Apply". The failure is entirely ordinary and the message was not.
//
// THE FILES, NOT THE PROCESSES. Reading the process list means naming
// executables and asking what is running, which is a different question: it
// answers yes for a copy of the game somewhere else on the disk, and no for one
// started before a rename that has the file open anyway. A lock is the thing
// that will actually stop the write, so a lock is what is asked about. It is
// also the same test the game itself makes — its own refusal to run beside the
// map editor is a file it cannot open.
//
// OURS ONLY. `H5_Game.exe` is never written to by anything here, so somebody
// playing the unmodded game is no reason to refuse: the two can be open at once
// and neither is in the other's way. What is asked about is our copy and the
// extension beside it.

import { closeSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';

import { EXTENSION_DLL } from '#src/mods/extension.ts';
import { PATCHED_EXE } from '#src/exe/creature-limit.ts';

/**
 * The files a running game of ours holds, in the order worth reporting.
 *
 * A function rather than a constant, and that is not style: the modules those
 * two names come from are the very modules that ask this question, so the
 * imports form a cycle. Read at call time the cycle is harmless; read while
 * this module is initialising, whichever half loads second is still in its
 * temporal dead zone and the answer is a ReferenceError.
 */
const heldWhilePlaying = (): string[] => [PATCHED_EXE, join('bin', EXTENSION_DLL)];

/**
 * Can this file be written right now?
 *
 * Opened for APPEND rather than for writing: `w` truncates, and a probe that
 * empties the executable when it succeeds is a worse bug than the one it is
 * looking for. Nothing is written either way — the handle is opened and closed.
 *
 * A file that is not there is not locked. That is not a quibble: an install
 * being prepared for the first time has neither of these, and "the game is
 * running" would be a strange thing to tell somebody about a file that does not
 * exist yet.
 */
function locked(path: string): boolean {
  if (!existsSync(path)) return false;
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r+');
    return false;
  } catch (e) {
    // EBUSY is Windows' sharing violation, which is what a loaded image gives.
    // EPERM and EACCES are the same refusal seen through other paths — a
    // read-only attribute among them, which is not the game running but is
    // equally a file this editor must not try to write.
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The first file of ours the game is holding, or null when nothing is held.
 *
 * A path rather than a boolean, because the two files fail for different
 * reasons and the message is better for saying which one was in the way.
 */
export function heldByRunningGame(gameRoot: string): string | null {
  for (const rel of heldWhilePlaying()) {
    const path = join(gameRoot, rel);
    if (locked(path)) return path;
  }
  return null;
}

/** The same question as a yes or no, for a caller that only wants to warn. */
export const gameIsRunning = (gameRoot: string): boolean => heldByRunningGame(gameRoot) !== null;

/**
 * Refuse before writing anything, in words that say what to do.
 *
 * Called at the TOP of an install, not around the write: a half-applied change
 * — the config file written, the extension not — is a state somebody then has
 * to reason about, and there is no reason to create it when the answer is known
 * beforehand.
 */
export function refuseIfRunning(gameRoot: string, what: string): void {
  const held = heldByRunningGame(gameRoot);
  if (!held) return;
  throw new Error(`${what}: the game has ${held} open — close it and try again.`
    + '\n  Only our own build holds these; the unmodded H5_Game.exe can stay open.');
}
