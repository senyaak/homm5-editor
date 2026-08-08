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
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { addImport, imports } from '../exe/exe-import.ts';
import { refuseIfRunning } from '../game/running.ts';
import {
  EFFECTS_FILE, effectsOf, skillRowsOf, specializationRowsOf, spellRowsOf, writeEffects,
} from './artifact-effects.ts';
import type {
  EffectRow, EffectsMod, SkillRow, SpecializationRow, SpellRow,
} from './artifact-effects.ts';
import { artifactNumbers } from './artifacts.ts';
import { abilityNumbers } from './ability-files.ts';

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
const NATIVE_DIR = 'native';
const ZIG = join('node_modules', '@zigc', 'win32-x64', 'bin', 'zig.exe');

// ---------------------------------------------------------------------------
// WHICH FILES OF THE EXTENSION SPEAK.
//
// Every native source names its own switch in one line near its top —
// `#define LOG_UNIT combat_spell_resolve` — and the compiler is handed
// `-DH5E_LOG_<unit>=1` for the ones asked for and `=0` for all the rest. See
// the bottom of `native/core/log.c` for what the switch does.
//
// THE SOURCES ARE THE REGISTER. This reads the units out of the files rather
// than holding a list of its own, so renaming a file cannot leave a flag here
// that quietly turns nothing on. The only list kept here is the DEFAULT, which
// is a policy — and it is checked against what was found, so it cannot drift
// either.

/** On unless a build says otherwise: did the mod load, and did it crash. */
export const LOG_UNITS_BY_DEFAULT = ['homm5_editor', 'core_faults'] as const;

/** A unit as the file spells it, and where it was found. */
export interface LogUnit { unit: string; file: string }

function nativeSources(editorRoot: string, dir = join(editorRoot, NATIVE_DIR)): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...nativeSources(editorRoot, path));
    else if (entry.name.endsWith('.c')) out.push(path);
  }
  return out.sort();
}

/** Every `#define LOG_UNIT` in the extension's sources, in path order. */
export function logUnits(editorRoot: string): LogUnit[] {
  const found: LogUnit[] = [];
  for (const file of nativeSources(editorRoot)) {
    const rel = relative(join(editorRoot, NATIVE_DIR), file).split(sep).join('/');
    for (const m of readFileSync(file, 'utf8').matchAll(/^#define LOG_UNIT (\w+)/gm)) {
      found.push({ unit: m[1]!, file: rel });
    }
  }
  return found;
}

/**
 * What a person typed, as the name a file uses.
 *
 * The unit IS the path, so every way of writing that path is accepted rather
 * than one blessed spelling: `combat/spell-resolve`, the same with `.c`, the
 * same with `native/` in front, or the underscored name itself. A person
 * debugging has the file open and will type what the editor's tab says.
 */
export function asLogUnit(typed: string): string {
  return typed.trim()
    .replace(/^[./\\]+/, '')
    .replace(/^native[/\\]/, '')
    .replace(/\.c$/, '')
    .replace(/[/\\-]/g, '_');
}

/**
 * `-D` for every unit there is: 1 for the ones asked for, 0 for the rest.
 *
 * ALL of them, including the zeroes — `LOG_ON` pastes the unit's name onto
 * `H5E_LOG_`, and a name nothing defined is an undeclared identifier rather
 * than a quiet no. The compiler refusing is the right answer there, but only a
 * unit this never saw should ever reach it.
 */
export function logDefines(editorRoot: string, asked: readonly string[]): string[] {
  const units = logUnits(editorRoot);
  const known = new Set(units.map((u) => u.unit));

  for (const unit of LOG_UNITS_BY_DEFAULT) {
    if (!known.has(unit)) {
      throw new Error(`no native file defines LOG_UNIT ${unit}\n  LOG_UNITS_BY_DEFAULT in src/mods/extension.ts names a unit that no longer exists`);
    }
  }

  // `none` is the build meant for playing: not the defaults either, not one
  // string of ours left in the DLL. It is a word rather than a second flag
  // because it belongs to the same question — who speaks — and the answer here
  // is nobody.
  const silent = asked.some((t) => t.trim() === 'none');
  const on = new Set<string>(silent ? [] : LOG_UNITS_BY_DEFAULT);
  for (const typed of asked) {
    if (typed.trim() === 'none') continue;
    const unit = asLogUnit(typed);
    if (!known.has(unit)) {
      const near = units.map((u) => u.file.replace(/\.c$/, '')).join('\n    ');
      throw new Error(`nothing logs under "${typed}"\n  the extension's files are:\n    ${near}`);
    }
    on.add(unit);
  }
  return units.map(({ unit }) => `-DH5E_LOG_${unit}=${on.has(unit) ? 1 : 0}`);
}

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
 *
 * `logging` names the files that may speak — see `logDefines`. The default is
 * the two units that answer "did it load" and "did it crash"; anything else has
 * to be asked for, and `['none']` builds a DLL with no logging in it at all.
 */
export function buildExtension(
  editorRoot: string,
  log: (s: string) => void = () => {},
  logging: readonly string[] = [],
): string {
  const zig = join(editorRoot, ZIG);
  if (!existsSync(zig)) {
    throw new Error(`no compiler at ${zig}\n  a checkout builds the extension; run "npm install" first`);
  }
  const source = join(editorRoot, NATIVE_SOURCE);
  const dll = builtDll(editorRoot);
  const defines = logDefines(editorRoot, logging);
  mkdirSync(dirname(dll), { recursive: true });
  try {
    execFileSync(zig, [
      'cc', '-target', 'x86-windows-gnu',
      '-shared', '-Os', '-fno-stack-protector',
      ...defines,
      '-o', dll, source,
    ], { stdio: 'pipe' });
  } catch (e) {
    // WHAT THE COMPILER SAID, not what Node made of it. `stdio: 'pipe'` keeps
    // the message out of the terminal, and the error Node throws instead prints
    // as a page of byte arrays with the file name spelled out one character per
    // line — which is how a two-line "undeclared identifier" cost a rebuild to
    // read. The compiler names the file, the line and the identifier; that is
    // the whole of what anybody wants here.
    const said = (e as { stderr?: Buffer }).stderr;
    throw new Error(`the extension did not compile\n\n${said ? said.toString() : String(e)}`);
  }
  const speaking = defines.filter((d) => d.endsWith('=1')).map((d) => d.slice('-DH5E_LOG_'.length, -2));
  log(`built ${dll} — ${statSync(dll).size} bytes`);
  log(speaking.length ? `logging: ${speaking.join(', ')}` : 'logging: nothing — this DLL says nothing at all');
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
  // A file at that name that cannot be read as one is not an error HERE. This
  // is a question — "does it name us" — asked every time the panel opens, and a
  // truncated copy or somebody's junk under that name would otherwise throw
  // "not a PE file" out of a dialog that was only trying to show some
  // checkboxes. It does not name us; that is the whole answer. Installing is
  // where an unreadable executable still fails loudly, and should.
  let imported = false;
  try {
    imported = imports(readFileSync(exe)).includes(EXTENSION_DLL.toLowerCase());
  } catch { /* not something we can read — so not something that names us */ }
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
  // Before either write, not between them. A running game holds both of these
  // and the copy would fail with a sentence about EBUSY; worse, whichever of the
  // two succeeded first would leave the install half installed.
  refuseIfRunning(gameRoot, 'cannot install the extension');

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
  spells: readonly SpellRow[] = [],
): string {
  const path = join(gameRoot, EFFECTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writeEffects(rows, specializations, skills, spells), 'latin1');
  return path;
}

/**
 * The same file, written from the WHOLE mod — the form every caller wants.
 *
 * There are four kinds of row now and three places that write the file, and the
 * arithmetic was copied into each: the app's install, the e2e fixture, and the
 * tool that rebuilds the file alone. A caller that knew about three kinds and
 * not the fourth did not write a wrong row — it wrote the file WITHOUT the
 * fourth, silently, over the rows another caller had just put there. Which is
 * exactly what happened the day spells got a row of their own.
 *
 * `types` is the game's own `types.xml`, and it is asked for rather than read
 * here so this stays a pure function of what the caller already has: the names
 * a mod uses for things it does not own — a shipped artifact in a set, an
 * ability a spell spares — are numbers only that file knows.
 */
export function writeModEffectsFile(gameRoot: string, mod: EffectsMod, types: string): string {
  let artifacts: Map<string, number> | undefined;
  let abilities: Map<string, number> | undefined;
  return writeEffectsFile(
    gameRoot,
    effectsOf(mod.artifacts ?? [], mod.sets ?? [], (id) => {
      artifacts ??= artifactNumbers(types);
      return artifacts.get(id);
    }),
    specializationRowsOf(mod.specializations ?? []),
    skillRowsOf(mod.skills ?? []),
    spellRowsOf(mod.spells ?? [], (name) => {
      abilities ??= abilityNumbers(types);
      return abilities.get(name);
    }),
  );
}
