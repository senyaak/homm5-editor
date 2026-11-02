// Failures by kind, shared by every layer.
//
// A catch either knows what it caught — and gives it a class and a message of
// its own — or it does not, and then it says so: `throw new UnknownFailure(what,
// e)`. Nothing is swallowed while it is being decided. An UnknownFailure is
// loud everywhere: thrown up to the renderer's net (renderer/core/failure.ts)
// or the main process's ([main error]), it is on the status line, in the
// terminal, and it fails an e2e test at once (e2e/failures.ts). Each one is a
// place still to be looked at; tools/test-silent-catches.ts counts them, and
// the count only goes down.

/** The message of anything thrown. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Is this the file system saying the path is not there? The one failure a
 * "may not exist yet" catch is about: anything else — a lock, no permission, a
 * broken disk — is a failure and goes on.
 */
export const isMissing = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';

/**
 * Say a failure that is not handed on: one item of many that could not be
 * read, while the rest still are. A line under the `[failure]` marker, which
 * the e2e harness fails a test on (e2e/failures.ts) wherever it is printed —
 * the main process, the renderer's console, a tool's terminal.
 */
export function noteFailure(what: string, e: unknown): void {
  console.error(`[failure] ${what}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
}

/** A failure nobody has classified yet: what was being done, and what was caught. */
export class UnknownFailure extends Error {
  constructor(what: string, cause: unknown) {
    super(`${what}: ${messageOf(cause)}`, { cause });
    this.name = 'UnknownFailure';
  }
}
