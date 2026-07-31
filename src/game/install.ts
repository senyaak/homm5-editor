// Where this machine's install and its unpacked data actually are.
//
// WHY. Every tool worked this out for itself, as `HOMM5_GAME ?? <the folder
// above the checkout>` and `<checkout>/data-unpacked`. Both are true of a
// checkout that sits inside the install and false everywhere else: from a
// worktree under C:\Projects the first resolves to C:\Projects\bin\… and the
// second to a folder that was never unpacked, so the tool dies on a path that
// tells the reader nothing about what went wrong.
//
// Meanwhile `.env` already names both for the app and the setup window
// (env-file.ts). This reads the same file, so one answer serves everything.
//
// PRECEDENCE, deliberately: the environment first — an explicit
// `HOMM5_ROOT=… node tools/…` is someone speaking about that one run and a file
// must not talk over it — then `.env`, then the old guess. `HOMM5_GAME` is still
// honoured because the reverse tools' usage lines have always mentioned it.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadEnvFile } from './env-file.ts';
import { PEFile } from '../exe/pe.ts';

/** The copy `npm run unwrap-exe` writes — the shipped one disassembles to noise. */
export const UNWRAPPED_EXE = 'H5_Game_H5E.exe';

/** This checkout's root, wherever it happens to be. */
export function editorRoot(): string {
  return resolve(import.meta.dirname, '..', '..');
}

/**
 * The install, or null when nothing plausible holds a `bin/`.
 *
 * The `bin/` test is what makes the fallbacks safe to try in order: a stale
 * variable pointing at a folder that is not a game loses to the one that is.
 */
export function gameRoot(): string | null {
  const editor = editorRoot();
  loadEnvFile(editor);
  for (const candidate of [process.env.HOMM5_GAME, process.env.HOMM5_ROOT, resolve(editor, '..')]) {
    if (candidate && existsSync(join(candidate, 'bin'))) return candidate;
  }
  return null;
}

/**
 * The unpacked data tree (`npm run unpack-data` writes it), or null.
 *
 * A checkout inside the install keeps its own; a worktree normally points at
 * the one the main checkout already unpacked, which is why `.env` carries it.
 */
export function unpackedData(): string | null {
  const editor = editorRoot();
  loadEnvFile(editor);
  for (const candidate of [process.env.HOMM5_DATA, join(editor, 'data-unpacked')]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Where unpacked data BELONGS, whether or not it is there yet.
 *
 * Different question from `unpackedData()`, and the difference matters exactly
 * once: the unpacker has to write to the folder `.env` names even on the first
 * run, when that folder does not exist and "find an existing one" would send it
 * somewhere else entirely.
 */
export function dataTarget(): string {
  const editor = editorRoot();
  loadEnvFile(editor);
  return process.env.HOMM5_DATA || join(editor, 'data-unpacked');
}

/** Like `unpackedData()`, but says what to do instead of returning null. */
export function requireUnpackedData(): string {
  const data = unpackedData();
  if (!data) {
    throw new Error(
      'no unpacked data found — run `npm run unpack-data`, or set HOMM5_DATA in .env (see .env.example)',
    );
  }
  return data;
}

/**
 * Open the unwrapped executable.
 *
 * The two failures want different answers — "no install found" and "found one,
 * never unwrapped it" — so they are told apart here rather than arriving as one
 * ENOENT on a path the reader has to decode.
 */
export function openGameExe(explicitPath?: string): PEFile {
  if (explicitPath) return PEFile.read(explicitPath);
  const root = gameRoot();
  if (!root) {
    throw new Error('no game install found — set HOMM5_ROOT in .env (see .env.example), or pass --exe <path>');
  }
  const path = join(root, 'bin', UNWRAPPED_EXE);
  if (!existsSync(path)) throw new Error(`${path} is not there — run \`npm run unwrap-exe\` first`);
  return PEFile.read(path);
}
