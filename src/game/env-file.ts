// The one file that says where this machine keeps things.
//
// WHAT IT IS FOR. Every path the editor needs outside itself — the game, the
// unpacked data — differs per machine and belongs in no commit. This file, the
// environment, and the command line are now the WHOLE of how those are decided
// (electron/paths.ts): there is no fourth answer and no guess behind them.
//
// It used to fill the setup window's fields in and decide nothing, while paths
// were remembered in a settings.json shared by every checkout, every worktree
// and the packaged build — with two "the folder above this one" guesses ranked
// ABOVE it. Which folder a run had actually settled on was then unknowable from
// outside, and a wrong one is silent: the map opens, everything a mod supplies
// is on it, the game's own objects are not, and the tile list is empty. One
// file per checkout, written where it can be read, replaces all of that.
//
// PRECEDENCE. The command line beats the environment beats this file. Each is
// more specific to this one run than the next: `--game=…` is about this launch,
// `HOMM5_ROOT=… npm start` about this shell, the file about this checkout.
//
// THE APP READS IT AND THE TESTS DO NOT, on purpose. `HOMM5_ROOT` means two
// different things either side of that line: to the editor it is "the install",
// to the e2e suite it is "the install to play in", and the suite's default is a
// throwaway under `_tmp` precisely so a run cannot leave `e2e …` maps in a real
// game folder (e2e/launch.ts). A file that quietly set it for every run would
// turn that default off for good, on one machine, invisibly. So the suite keeps
// its explicit variables and this is loaded by electron/paths.ts alone.
//
// The one spec that cannot avoid the file — the cold start, which walks the real
// setup window to its end — says `--setup-test` and gets `.env.test` for both
// halves (`envFileName` below).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Windows line endings: this file is read and edited in Notepad as often as not. */
const EOL = '\r\n';

/** The file, relative to the editor's root. Never committed — see `.env.example`. */
export const ENV_FILE = '.env';

/** The one a `--setup-test` run reads and writes instead. Never committed either. */
export const ENV_FILE_TEST = '.env.test';

/**
 * Which of the two this run uses.
 *
 * The cold-start spec drives the REAL setup window to its end, and that end
 * writes — there is no way to walk that path without a file being written. Sent
 * at the checkout's `.env` it rewrites the one the developer's editor reads, with
 * the paths of a sandbox the same run deletes on the way out; the file then
 * survives, names nothing, and the next `npm start` opens setup as if the machine
 * were new. So the run says which file it is talking about.
 *
 * A FLAG rather than a variable or a marker file, because a flag is about one
 * launch and cannot be left behind: a `.env.test` forgotten in a checkout is
 * inert, since nothing without the flag ever opens it.
 */
export const envFileName = (argv: readonly string[] = process.argv): string =>
  argv.includes('--setup-test') ? ENV_FILE_TEST : ENV_FILE;

/** The keys this file is allowed to carry, and what each one means. */
export const ENV_KEYS = {
  HOMM5_ROOT: 'the Heroes 5 install — data/*.pak, bin/, and where our folder goes',
  HOMM5_DATA: 'where those archives are unpacked to, the tree the editor reads',
} as const;

export type EnvKey = keyof typeof ENV_KEYS;

/**
 * Parse `KEY=value` lines.
 *
 * Deliberately small: no export, no interpolation, no multi-line values. A path
 * with spaces needs no quoting because everything after the first `=` is the
 * value, but surrounding quotes are stripped for anyone who adds them anyway.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Write the file, replacing whatever was there.
 *
 * The setup window's picker calls this, which is what makes the picker's answer
 * durable without a settings file: the same file a developer edits by hand is
 * the one the window writes, so there is one place to look either way.
 *
 * Comments in a hand-edited file do not survive — the header below is written
 * fresh every time. That is the trade for a writer small enough to trust.
 */
export function writeEnvFile(editorRoot: string, values: Partial<Record<EnvKey, string>>): string {
  const path = join(editorRoot, envFileName());
  const lines = [
    "# Where this machine keeps the game. Written by the editor's setup window,",
    '# and safe to edit by hand. Not committed — see .env.example.',
    '#',
    '# This file DECIDES: the editor reads nothing else, and guesses nothing.',
    '# A variable exported in your shell wins over it, and --game=/--data= on the',
    '# command line wins over both.',
  ];
  for (const [key, note] of Object.entries(ENV_KEYS)) {
    const value = values[key as EnvKey];
    if (!value) continue;
    lines.push('', `# ${note}`, `${key}=${value}`);
  }
  writeFileSync(path, lines.join(EOL) + EOL, 'utf8');
  return path;
}

export interface LoadedEnv {
  /** The file that was read, when there was one. */
  path?: string;
  /** What it set that the environment did not already have. */
  applied: string[];
}

/**
 * Read `<editorRoot>/.env` into the environment, without overwriting anything.
 *
 * Safe to call more than once and safe to call when the file is not there —
 * both are the ordinary case (a checkout that has not made one, a packaged
 * build that has no such file at all).
 */
export function loadEnvFile(editorRoot: string, env: NodeJS.ProcessEnv = process.env): LoadedEnv {
  const path = join(editorRoot, envFileName());
  if (!existsSync(path)) return { applied: [] };
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (env[key] !== undefined || !value) continue;
    env[key] = value;
    applied.push(key);
  }
  return { path, applied };
}
