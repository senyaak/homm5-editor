// Run Playwright and keep the WHOLE output — on the screen and in a file.
//
// WHY THIS EXISTS. A run's report is long and the interesting line is rarely at
// the end: `gaps()` prints a full diff-map report and the line that names the
// value ("ref 353 item(s) vs ours 357") sits in the middle of it. A run piped
// through `tail` throws exactly that away — and worse, a pipe replaces the exit
// status with the pipe's own, so a run with four failures reports success.
//
// So every runner goes through here: nothing is trimmed, the file holds what the
// screen held, and the process exits with Playwright's own status. It is the
// same rule the probes follow — capture everything, filter when READING.

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** A file name that sorts by time and needs no separator to read. */
function stamp(): string {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`
    + `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/**
 * Run `playwright test` with these arguments, tee the output, and answer with
 * Playwright's exit status.
 *
 * `label` names the log file, so a live run and a release gate do not overwrite
 * each other's report.
 */
export async function runPlaywright(
  args: readonly string[], env: NodeJS.ProcessEnv = {}, label = 'e2e',
): Promise<number> {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-logs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${label}-${stamp()}.log`);
  const file = createWriteStream(path);
  // Said BEFORE the run, not after: a run that is killed half way through still
  // leaves the file, and the only way to know where it is is to have been told.
  console.log(`[e2e] the whole output goes to ${path}\n`);

  // The CLI by path, run by this node — not `npx` through a shell. A shell would
  // want the arguments escaped (Node says so out loud on Windows), and a spec
  // path with a space in it is the ordinary case here.
  const cli = join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  const child = spawn(process.execPath, [cli, 'test', ...args], {
    cwd: REPO_ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const tee = (from: NodeJS.ReadableStream | null, to: NodeJS.WriteStream): void => {
    from?.on('data', (chunk: Buffer) => { to.write(chunk); file.write(chunk); });
  };
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);

  const status = await new Promise<number>((resolve) => {
    // A signal is not a status: killed is a failure, and `?? 1` on a null code
    // is what makes Ctrl-C read as one rather than as a pass.
    child.on('close', (code) => resolve(code ?? 1));
  });
  await new Promise<void>((resolve) => file.end(resolve));
  console.log(`\n[e2e] ${status ? 'FAILED' : 'passed'} — the whole output is in ${path}`);
  return status;
}
