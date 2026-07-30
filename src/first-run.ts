// Turning a Heroes 5 install into one the editor can work in.
//
// FOUR THINGS HAVE TO BE TRUE before the editor is any use, and until now only
// the first of them was ever done for anybody: the game's archives unpacked into
// a tree we can read, a readable copy of the executable, our extension loaded by
// it, and that copy pointed at our own folder. The other three were four npm
// commands typed by hand, which meant they were done once on this machine, by
// the person who wrote them, and were never exercised again — the e2e suite
// builds its sandbox by COPYING the executable those commands had already made
// (e2e/mods.ts), so the making of it was the one part nothing tested.
//
// WHERE THE PATHS COME FROM: not from here. `gameRoot` and `dataRoot` are given
// to every function below, and the only place they are ever decided is the
// picker in the setup window — the environment fills that picker's fields in,
// and nothing more. So a step never guesses at an install, and a test hands it
// a throwaway one exactly the way the window hands it a real one.
//
// EVERY STEP IS IDEMPOTENT and says so through `done()`, because the second run
// is the normal one: an install that has three of the four wants the fourth, not
// a fresh start. `firstRun` skips what is already true and reports both lists.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCleanExe } from './exe-unwrap.ts';
import { buildExtension, builtDll, extensionState, installExtension } from './extension.ts';
import { readModPaths, setModPaths } from './mod-paths.ts';
import { looksLikeDataRoot, looksLikeGameFolder, unpackSteps } from './unpack.ts';

/** Our copy of the executable, relative to the install. */
const PATCHED_EXE = join('bin', 'H5_Game_H5E.exe');

/**
 * The three folders every step is a function of.
 *
 * `editorRoot` is where the editor itself lives — a checkout, or an installed
 * build. It is where the extension is compiled and read from, and it is the one
 * of the three the editor knows about itself.
 */
export interface Install {
  /** The Heroes 5 install: `data/*.pak`, `bin/`, and where our folder goes. */
  gameRoot: string;
  /** Where those archives are unpacked to — the tree the editor reads. */
  dataRoot: string;
  /** The editor's own root. */
  editorRoot: string;
}

export type StepId = 'data' | 'exe' | 'extension' | 'paths';

/** Progress from inside a step, for a window that has to show something. */
export type Note = (line: string) => void;

export interface Step {
  id: StepId;
  /** What it does, one line, addressed to the person waiting for it. */
  what: string;
  /** Already true in this install? Never throws — an unreadable install is "no". */
  done(install: Install): boolean;
  /** Do it, and answer with what happened, in the past tense. */
  run(install: Install, note?: Note): Promise<string>;
}

/**
 * How long to stay inside the unpack loop before yielding.
 *
 * Unpacking is minutes of synchronous file work, and the window this runs under
 * is the same process: run flat out and Windows stops getting messages, greys
 * the window and calls the app hung. Time, not member count — a slice of small
 * text entries goes by in no time while one 100 MB video is a slice of its own.
 */
const SLICE_MS = 100;

/** Hand the event loop back, so a window under this stays alive. */
const breathe = (): Promise<void> => new Promise<void>((r) => { setImmediate(r); });

export const STEPS: readonly Step[] = [
  {
    id: 'data',
    what: 'unpack the game archives',
    done: (i) => !!i.dataRoot && looksLikeDataRoot(i.dataRoot),
    run: async (i, note) => {
      const steps = unpackSteps(i.gameRoot, i.dataRoot);
      try {
        let due = 0;
        for (;;) {
          const s = steps.next();
          if (s.done) {
            const r = s.value;
            return `unpacked ${r.written + r.replaced} files from ${r.paks.length} archives`;
          }
          const now = Date.now();
          if (now < due) continue;
          due = now + SLICE_MS;
          note?.(`${s.value.pak} — ${s.value.done} of ${s.value.total}`);
          await breathe();
        }
      } finally {
        steps.return(undefined as never);   // closes the archive if we bailed out
      }
    },
  },
  {
    id: 'exe',
    // Said plainly because it is the step that touches a file of the game's own
    // — by copying it, never by writing to it.
    what: 'make a readable copy of the executable',
    done: (i) => existsSync(join(i.gameRoot, PATCHED_EXE)),
    run: async (i, note) => {
      const r = await ensureCleanExe(i.gameRoot, { editorRoot: i.editorRoot, log: (s) => note?.(s) });
      return `${r.action} ${PATCHED_EXE} (${r.kind})`;
    },
  },
  {
    id: 'extension',
    what: 'load our extension into that copy',
    done: (i) => extensionState(i.gameRoot).installed,
    run: async (i, note) => {
      // A checkout compiles it; a build ships it already compiled. Either way
      // the file has to be there before the executable can be made to name it.
      if (!existsSync(builtDll(i.editorRoot))) {
        note?.('building the extension');
        buildExtension(i.editorRoot);
      }
      const r = installExtension(i.gameRoot, i.editorRoot);
      return r.patchedExe ? 'installed the extension and added its import' : 'the extension was already installed';
    },
  },
  {
    id: 'paths',
    what: 'point that copy at our own mod folder',
    done: (i) => {
      // An executable that is not there, or is a build we do not know, is a "no"
      // rather than a throw: done() is asked about strangers' installs too.
      const exe = join(i.gameRoot, PATCHED_EXE);
      if (!existsSync(exe)) return false;
      try {
        return readModPaths(readFileSync(exe)).state === 'ours';
      } catch {
        return false;
      }
    },
    run: async (i) => {
      const r = setModPaths(i.gameRoot, 'ours');
      return r.changed ? `${r.dir} is what the game reads now` : `${r.dir} was already what it reads`;
    },
  },
];

export interface StepState {
  id: StepId;
  what: string;
  done: boolean;
}

/** What is true of this install, step by step. */
export function installState(install: Install): StepState[] {
  return STEPS.map((s) => ({ id: s.id, what: s.what, done: s.done(install) }));
}

/** Nothing left to do — the editor can be opened on this install. */
export function isReady(install: Install): boolean {
  return STEPS.every((s) => s.done(install));
}

export interface FirstRunResult {
  /** What this run did, in order, each with what the step said afterwards. */
  ran: Array<{ id: StepId; said: string }>;
  /** What was already true and therefore not run. */
  skipped: StepId[];
}

export interface FirstRunOptions {
  /** Called as each step starts, and again with its progress lines. */
  onStep?: (step: Step) => void;
  note?: Note;
  /** Do these and no others. The default is all four, in order. */
  only?: readonly StepId[];
}

/**
 * Do whatever this install still needs, in order.
 *
 * The game folder is checked once, here, rather than inside every step: a path
 * that is not an install fails on the first archive it cannot find, minutes in,
 * with a message about a `.pak`. This says the one true thing instead.
 */
export async function firstRun(install: Install, opt: FirstRunOptions = {}): Promise<FirstRunResult> {
  if (!looksLikeGameFolder(install.gameRoot)) {
    throw new Error(`${install.gameRoot || '(nothing)'} is not a Heroes 5 install — no data/*.pak in it`);
  }

  const result: FirstRunResult = { ran: [], skipped: [] };
  for (const step of STEPS) {
    if (opt.only && !opt.only.includes(step.id)) continue;
    if (step.done(install)) { result.skipped.push(step.id); continue; }
    opt.onStep?.(step);
    result.ran.push({ id: step.id, said: await step.run(install, opt.note) });
  }
  return result;
}
