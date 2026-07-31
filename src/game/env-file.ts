// The one file that says where this machine keeps things.
//
// WHAT IT IS FOR. Every path the editor needs outside itself — the game, the
// unpacked data — differs per machine and belongs in no commit. They were
// environment variables, which meant a terminal that had exported them, and
// therefore worked for the person who typed them and nobody else: the e2e suite
// got them from `start-editor.bat`, the tools guessed from the checkout's
// position, and a second machine had neither.
//
// WHAT IT IS NOT FOR. It does not decide anything. The setup window's picker is
// the only place an install is ever chosen; this file fills that picker's fields
// in, so the answer is one Enter away instead of one folder walk. Nothing here
// is read as "the game is there" — only as "start looking there".
//
// PRECEDENCE. A variable already in the environment wins: an explicit
// `HOMM5_ROOT=… npm start` is someone saying something about this one run, and a
// file must not talk over it.
//
// THE APP READS IT AND THE TESTS DO NOT, on purpose. `HOMM5_ROOT` means two
// different things either side of that line: to the editor it is "the install",
// to the e2e suite it is "the install to play in", and the suite's default is a
// throwaway under `_tmp` precisely so a run cannot leave `e2e …` maps in a real
// game folder (e2e/launch.ts). A file that quietly set it for every run would
// turn that default off for good, on one machine, invisibly. So the suite keeps
// its explicit variables and this is loaded by electron/paths.ts alone.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file, relative to the editor's root. Never committed — see `.env.example`. */
export const ENV_FILE = '.env';

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
  const path = join(editorRoot, ENV_FILE);
  if (!existsSync(path)) return { applied: [] };
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (env[key] !== undefined || !value) continue;
    env[key] = value;
    applied.push(key);
  }
  return { path, applied };
}
