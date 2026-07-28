// Installing the native extension into a game — and saying whether it is there.
//
// Two files and one patch: the DLL beside the executable, and OUR copy of the
// executable naming it in its import table. The game's own files are never
// touched, so the mod is turned off the way every other one is — by launching
// `H5_Game.exe` instead of `H5_Game_NCF.exe`.
//
// The DLL is BUILT BY US and shipped: it is the same bytes for every install,
// it reads a config rather than being generated per artifact, and nobody
// running the editor needs a compiler. `npm run build-native` makes it; this
// puts it where the game will find it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { addImport, imports } from './exe-import.ts';
import { EFFECTS_FILE, writeEffects } from './artifact-effects.ts';
import type { EffectRow } from './artifact-effects.ts';

export const EXTENSION_DLL = 'homm5-editor.dll';
/** The export the import table names. Never called — the point is `DllMain`. */
const EXTENSION_ENTRY = 'homm5_editor_present';
/** Our copy of the game's executable, the only one ever written to. */
const PATCHED_EXE = join('bin', 'H5_Game_NCF.exe');

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
export function writeEffectsFile(gameRoot: string, rows: readonly EffectRow[]): string {
  const path = join(gameRoot, EFFECTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writeEffects(rows), 'latin1');
  return path;
}
