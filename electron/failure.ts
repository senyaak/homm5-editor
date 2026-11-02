// The one way the main process reports a failure it cannot hand to a caller.
//
// A failure inside a channel handler is thrown: the renderer's call rejects and
// the renderer reports it (renderer/core/failure.ts). What has no caller — a
// watcher, a job finishing in the background, a clean-up at exit — comes here:
// one line under the marker the e2e harness fails a test on (e2e/failures.ts),
// in the terminal that started the app.

/** Report a failure nobody is waiting on: `what` was being done, `e` went wrong. */
export function mainFailed(what: string, e: unknown): void {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(`[main error] ${what}: ${text}`);
}
