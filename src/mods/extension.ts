// Installing the native extension into a game — and saying whether it is there.
//
// Two files and one patch: the DLL beside the executable, and OUR copy of the
// executable naming it in its import table. The game's own files are never
// touched, so the mod is turned off the way every other one is — by launching
// `H5_Game.exe` instead of `H5_Game_H5E.exe`.
//
// The DLL is BUILT BY US and shipped: it is the same bytes for every install,
// it reads a config rather than being generated per artifact, and nobody
// running the editor needs a compiler. `buildExtension` makes it — from a
// checkout, where the compiler comes with the dependencies — and this puts it
// where the game will find it. `npm run build-native` is a front door onto the
// same function, and first-run.ts calls it when the file is not there yet.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { addImport, imports } from '../exe/exe-import.ts';
import { EFFECTS_FILE, writeEffects } from './artifact-effects.ts';
import type { EffectRow, SkillRow, SpecializationRow } from './artifact-effects.ts';

export const EXTENSION_DLL = 'homm5-editor.dll';
/** The export the import table names. Never called — the point is `DllMain`. */
const EXTENSION_ENTRY = 'homm5_editor_present';
/** Our copy of the game's executable, the only one ever written to. */
const PATCHED_EXE = join('bin', 'H5_Game_H5E.exe');

export interface ExtensionState {
  /** The DLL is beside the executable. */
  present: boolean;
  /** The executable names it, so it will actually be loaded. */
  imported: boolean;
  /** Both — the only state in which an effect does anything. */
  installed: boolean;
  /** Bytes of the installed DLL, when there is one. */
  size?: number;
}

/** What `dir` (a built editor, or this checkout) ships the DLL as. */
export function builtDll(editorRoot: string): string {
  return join(editorRoot, 'native', 'build', EXTENSION_DLL);
}

/** The source it is compiled from, and the compiler that comes with the deps. */
const NATIVE_SOURCE = join('native', 'homm5-editor.c');
const ZIG = join('node_modules', '@zigc', 'win32-x64', 'bin', 'zig.exe');

/**
 * Compile the extension out of a checkout.
 *
 * `x86-windows-gnu` is the 32-bit target; the game is a PE32 and will not load
 * anything else. The C runtime comes along, and that is Zig's call rather than
 * ours: it serves the Windows headers as part of libc, so `-nostdlib` takes
 * `windows.h` with it. What arrives is the UCRT, which every Windows 10 and 11
 * has — and the source calls none of it, so the import is a formality.
 *
 * Only a checkout can do this: a packaged editor has no `node_modules` and
 * therefore no compiler, which is why the built DLL is something a build ships
 * rather than something it makes.
 *
 * The binary is called directly rather than through the package's `zig` shim:
 * the shim concatenates its arguments into a shell command, and this repo lives
 * under a path with spaces in it.
 */
export function buildExtension(editorRoot: string, log: (s: string) => void = () => {}): string {
  const zig = join(editorRoot, ZIG);
  if (!existsSync(zig)) {
    throw new Error(`no compiler at ${zig}\n  a checkout builds the extension; run "npm install" first`);
  }
  const source = join(editorRoot, NATIVE_SOURCE);
  const dll = builtDll(editorRoot);
  mkdirSync(dirname(dll), { recursive: true });
  execFileSync(zig, [
    'cc', '-target', 'x86-windows-gnu',
    '-shared', '-Os', '-fno-stack-protector',
    '-o', dll, source,
  ], { stdio: 'pipe' });
  log(`built ${dll} — ${statSync(dll).size} bytes`);
  return dll;
}

/**
 * Answering "is it imported" means reading the executable, and the executable
 * is fourteen megabytes.
 *
 * The dialog asks every time it opens, and the main process is single-threaded:
 * reading and parsing that much on each open stops the whole window while it
 * happens. So the answer is kept, keyed on the file's size and mtime — patching
 * the import changes both, and nothing else can change the answer.
 */
const importedCache = new Map<string, { key: string; imported: boolean }>();

function namesUs(exe: string): boolean {
  if (!existsSync(exe)) return false;
  const stat = statSync(exe);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const seen = importedCache.get(exe);
  if (seen?.key === key) return seen.imported;
  const imported = imports(readFileSync(exe)).includes(EXTENSION_DLL.toLowerCase());
  importedCache.set(exe, { key, imported });
  return imported;
}

export function extensionState(gameRoot: string): ExtensionState {
  const dll = join(gameRoot, 'bin', EXTENSION_DLL);
  const present = existsSync(dll);
  const imported = namesUs(join(gameRoot, PATCHED_EXE));
  return { present, imported, installed: present && imported, ...(present ? { size: statSync(dll).size } : {}) };
}

export interface InstallResult extends ExtensionState {
  /** Set when this call added the import — it is idempotent otherwise. */
  patchedExe?: string;
}

/**
 * Put the extension in place. Safe to run twice.
 *
 * The import is added only once; a second call finds it already there and
 * writes nothing, so the executable does not grow a section every time
 * somebody presses the button.
 */
export function installExtension(gameRoot: string, editorRoot: string): InstallResult {
  const built = builtDll(editorRoot);
  if (!existsSync(built)) {
    throw new Error(`the extension has not been built — no ${built}\n  run: npm run build-native`);
  }
  const exe = join(gameRoot, PATCHED_EXE);
  if (!existsSync(exe)) {
    throw new Error(`no ${exe} — the extension loads through our copy of the executable, not the game's`);
  }

  copyFileSync(built, join(gameRoot, 'bin', EXTENSION_DLL));
  const { buf, added } = addImport(readFileSync(exe), EXTENSION_DLL, EXTENSION_ENTRY);
  if (added) writeFileSync(exe, buf);

  return { ...extensionState(gameRoot), ...(added ? { patchedExe: exe } : {}) };
}

/**
 * Write the effects file.
 *
 * Always written, even empty: a stale file from a previous mod would keep
 * granting bonuses for artifacts that are no longer there, and an empty one
 * says plainly that nothing is in effect.
 */
export function writeEffectsFile(
  gameRoot: string,
  rows: readonly EffectRow[],
  specializations: readonly SpecializationRow[] = [],
  skills: readonly SkillRow[] = [],
): string {
  const path = join(gameRoot, EFFECTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writeEffects(rows, specializations, skills), 'latin1');
  return path;
}
